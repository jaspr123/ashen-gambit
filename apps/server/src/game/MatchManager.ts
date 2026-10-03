// Creates, tracks, persists and concludes matches. Applies ratings/stats.
import {
  ARENAS, CHECKERS_START_FEN, GAME_MODES, START_FEN, restoreEngine, rulesOf, eloUpdate, isBuiltinFaction, other,
  type AbilityVisibility, type Color, type GameModeId, type MatchSummary, type TimeControl,
} from '@ashen/shared';
import { config } from '../config.js';
import type { Repository } from '../db/index.js';
import type { GameRecord, UserRecord } from '../db/repository.js';
import type { Hub } from './hub.js';
import { Match, type PlayerInit } from './Match.js';
import { newId, type ProfileManager } from './ProfileManager.js';

export interface CreateMatchInput {
  arenaId?: string;
  mode: GameModeId;
  timeControl: TimeControl;
  abilityVisibility: AbilityVisibility;
  white: UserRecord;
  black: UserRecord;
  isPrivate?: boolean;
  startDelayMs?: number;
}

export class MatchManager {
  readonly matches = new Map<string, Match>();
  private playerMatch = new Map<string, string>();
  private arenaCounter = 0;
  onMatchEnded: ((m: Match) => void)[] = [];
  onMatchChanged: ((m: Match) => void)[] = [];
  onMatchCreated: ((m: Match) => void)[] = [];

  constructor(private hub: Hub, private repo: Repository, private profiles: ProfileManager, private armies: (id: string) => Promise<import('@ashen/shared').CustomArmy | undefined>) {}

  activeMatchOf(userId: string): Match | undefined {
    const id = this.playerMatch.get(userId);
    const m = id ? this.matches.get(id) : undefined;
    return m && m.status !== 'ended' ? m : undefined;
  }
  /** Last match the user played in, even if ended (for rematch/result screens). */
  lastMatchOf(userId: string) { const id = this.playerMatch.get(userId); return id ? this.matches.get(id) : undefined; }
  isPlaying(userId: string) { return !!this.activeMatchOf(userId); }

  private async playerInit(u: UserRecord): Promise<PlayerInit> {
    const l = u.loadout;
    let army;
    if (!isBuiltinFaction(l.faction)) army = await this.armies(l.faction.slice('custom:'.length));
    return { id: u.id, name: u.name, avatar: u.avatar, rating: u.rating, faction: army || isBuiltinFaction(l.faction) ? l.faction : 'remnants', finishers: l.finishers, army, bot: u.bot };
  }

  async create(input: CreateMatchInput): Promise<Match> {
    for (const u of [input.white, input.black]) {
      const existing = this.activeMatchOf(u.id);
      if (existing) throw new Error(`already_playing:${u.name}`);
    }
    const env = ARENAS[this.arenaCounter++ % ARENAS.length];
    const m = new Match({
      id: newId('m_'), arenaId: input.arenaId ?? env.id, mode: input.mode, timeControl: input.timeControl, abilityVisibility: input.abilityVisibility,
      white: await this.playerInit(input.white), black: await this.playerInit(input.black), isPrivate: !!input.isPrivate,
      startDelayMs: input.startDelayMs ?? 4000, pickMs: input.white.bot && input.black.bot ? 0 : config.pickMs, ranked: GAME_MODES[input.mode].ranked && !input.white.bot && !input.black.bot && !input.isPrivate,
    }, this.hub, {
      onEnd: (x) => void this.handleEnd(x),
      onChange: (x) => this.onMatchChanged.forEach((f) => f(x)),
      onRematch: (x) => void this.handleRematch(x),
    });
    m.persistHandler = (x) => void this.persist(x);
    this.register(m);
    for (const c of ['w', 'b'] as Color[]) {
      const p = m.players[c];
      if (!p.bot) this.hub.emitUser(p.id, 'match:state', m.stateFor(p.id));
    }
    this.onMatchCreated.forEach((f) => f(m));
    return m;
  }

  private register(m: Match) {
    this.matches.set(m.id, m);
    this.playerMatch.set(m.players.w.id, m.id);
    this.playerMatch.set(m.players.b.id, m.id);
  }

  private async persist(m: Match) {
    if (m.status === 'ended') return;
    await this.repo.saveActiveGame({
      id: m.id, updatedAt: Date.now(),
      data: { engine: m.engine.snapshot(), meta: { opts: m.opts, clocks: m.clocks, status: m.status, startsAt: m.startsAt } },
    }).catch((e) => console.error('[persist]', e));
  }

  /** Resume matches that were in progress when the server stopped. Clocks are paused for the downtime. */
  async restore() {
    for (const rec of await this.repo.listActiveGames()) {
      try {
        const meta = rec.data.meta as { opts: Match['opts']; clocks: Match['clocks']; status: Match['status']; startsAt: number };
        const engine = restoreEngine(rec.data.engine);
        const clocks = { ...meta.clocks, since: Date.now(), graceUntil: Date.now() + 15_000 };
        const m = new Match(meta.opts, this.hub, {
          onEnd: (x) => void this.handleEnd(x), onChange: (x) => this.onMatchChanged.forEach((f) => f(x)), onRematch: (x) => void this.handleRematch(x),
        }, { engine, clocks, status: meta.status === 'countdown' || meta.status === 'picking' ? 'playing' : meta.status, startsAt: meta.startsAt });
        m.persistHandler = (x) => void this.persist(x);
        // Players are offline until they reconnect; this starts their reconnect grace.
        for (const c of ['w', 'b'] as Color[]) if (!m.players[c].bot) m.setConnected(m.players[c].id, false);
        this.register(m);
        console.log(`[restore] resumed match ${m.id} at ply ${m.ply}`);
      } catch (e) {
        console.error('[restore] failed', rec.id, e);
        await this.repo.deleteActiveGame(rec.id);
      }
    }
  }

  private async handleEnd(m: Match) {
    const result = m.engine.result!;
    await this.repo.deleteActiveGame(m.id).catch(() => {});
    const w = await this.profiles.get(m.players.w.id);
    const b = await this.profiles.get(m.players.b.id);
    if (!w || !b) return;
    const before = { w: w.rating, b: b.rating };
    const counted = result.reason !== 'aborted';
    if (counted) {
      let after: [number, number] | null = null;
      if (m.opts.ranked) {
        const score = result.winner === 'w' ? 1 : result.winner === 'b' ? 0 : 0.5;
        after = eloUpdate(w.rating, b.rating, score, w.ratingGames, b.ratingGames);
      }
      for (const [c, u] of [['w', w], ['b', b]] as [Color, UserRecord][]) {
        const outcome = result.winner === null ? 'draw' : result.winner === c ? 'win' : 'loss';
        const caps = m.engine.history.filter((r) => r.color === c && r.captured).map((r) => r.piece);
        const earned = this.profiles.applyGame(u, {
          outcome, captures: caps, kingDefeat: outcome === 'win' && result.reason === 'checkmate', faction: m.players[c].faction,
          kotbDefense: false, ratingAfter: after ? after[c === 'w' ? 0 : 1] : undefined,
        });
        await this.profiles.save(u);
        if (!u.bot) {
          this.hub.emitUser(u.id, 'profile:self', this.profiles.self(u));
          for (const a of earned) this.hub.emitUser(u.id, 'notify', { kind: 'success', text: `Achievement unlocked: ${a}` });
        }
      }
      const g: GameRecord = {
        id: m.id, arenaId: m.opts.arenaId, mode: m.opts.mode, ranked: m.opts.ranked, timeControl: m.opts.timeControl, abilityVisibility: m.opts.abilityVisibility,
        white: { id: w.id, name: w.name, faction: m.players.w.faction, finishers: m.players.w.finishers, ratingBefore: before.w, ratingAfter: w.rating, bot: w.bot },
        black: { id: b.id, name: b.name, faction: m.players.b.faction, finishers: m.players.b.finishers, ratingBefore: before.b, ratingAfter: b.rating, bot: b.bot },
        startFen: rulesOf(m.opts.mode) === 'checkers' ? CHECKERS_START_FEN : START_FEN, moves: m.engine.history, result, startedAt: m.startedAt, endedAt: m.endedAt,
        armies: m.players.w.army || m.players.b.army ? { w: m.players.w.army, b: m.players.b.army } : undefined,
      };
      if (g.moves.length) await this.repo.saveGame(g).catch((e) => console.error('[saveGame]', e));
    }
    // Refresh rating shown to viewers.
    m.players.w.rating = w.rating; m.players.b.rating = b.rating;
    m.broadcast();
    this.onMatchEnded.forEach((f) => f(m));
    setTimeout(() => this.retire(m), 90_000);
  }

  private retire(m: Match) {
    if (this.matches.get(m.id) !== m) return;
    m.dispose();
    this.matches.delete(m.id);
    for (const c of ['w', 'b'] as Color[]) if (this.playerMatch.get(m.players[c].id) === m.id) this.playerMatch.delete(m.players[c].id);
    this.onMatchChanged.forEach((f) => f(m));
  }

  private async handleRematch(m: Match) {
    const w = await this.profiles.get(m.players.b.id);
    const b = await this.profiles.get(m.players.w.id);
    if (!w || !b || this.activeMatchOf(w.id) || this.activeMatchOf(b.id)) return;
    const next = await this.create({ arenaId: m.opts.arenaId, mode: m.opts.mode, timeControl: m.opts.timeControl, abilityVisibility: m.opts.abilityVisibility, white: w, black: b, isPrivate: m.opts.isPrivate });
    // Carry spectators over.
    for (const s of m.spectators) { m.removeSpectator(s); next.addSpectator(s); }
    this.retire(m);
  }

  spectate(userId: string, matchId: string) {
    const m = this.matches.get(matchId);
    if (!m) throw new Error('no_match');
    if (m.colorOf(userId)) { this.hub.emitUser(userId, 'match:state', m.stateFor(userId)); return m; }
    for (const other of this.matches.values()) if (other !== m) other.removeSpectator(userId);
    m.addSpectator(userId);
    return m;
  }

  unspectateAll(userId: string) { for (const m of this.matches.values()) m.removeSpectator(userId); }
  spectating(userId: string) { for (const m of this.matches.values()) if (m.spectators.has(userId)) return m; return undefined; }

  summaries(): MatchSummary[] {
    return [...this.matches.values()].filter((m) => !m.opts.isPrivate).map((m) => ({
      id: m.id, arenaId: m.opts.arenaId, mode: m.opts.mode, ply: m.ply, spectators: m.spectators.size, status: m.status, timeControl: m.opts.timeControl, private: m.opts.isPrivate,
      white: { id: m.players.w.id, name: m.players.w.name, faction: m.players.w.faction, rating: m.players.w.rating },
      black: { id: m.players.b.id, name: m.players.b.name, faction: m.players.b.faction, rating: m.players.b.rating },
    }));
  }

  /** Called when a user's socket presence changes. */
  setConnected(userId: string, connected: boolean) {
    const m = this.activeMatchOf(userId);
    if (m) m.setConnected(userId, connected);
    if (!connected) this.unspectateAll(userId);
  }

  winnerLoser(m: Match): { winner?: string; loser?: string } {
    const r = m.engine.result;
    if (!r || !r.winner) return {};
    return { winner: m.players[r.winner].id, loser: m.players[other(r.winner)].id };
  }
}
