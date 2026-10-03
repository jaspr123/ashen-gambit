// Simulated lobby players for development and for keeping the lobby alive.
// Bots are real participants from the server's point of view — they queue,
// spectate and play through the same Match API as humans — but their moves
// come from the shared alpha-beta AI.

import { FACTION_IDS, DEFAULT_FINISHERS, DEFAULT_RATING, chooseMove, type Color, type PieceType, type Square } from '@ashen/shared';
import type { UserRecord } from '../db/repository.js';
import type { ArenaManager } from './ArenaManager.js';
import type { LobbyManager } from './LobbyManager.js';
import type { Match } from './Match.js';
import type { MatchManager } from './MatchManager.js';
import type { MatchmakingManager } from './MatchmakingManager.js';
import { AVATARS, emptyStats, newId, type ProfileManager } from './ProfileManager.js';

const NAMES = ['Rustjaw', 'KnightHunter', 'Ashwalker', 'Sable', 'Grit', 'Cinder', 'Vex', 'Halftrack', 'Mother Rust', 'Static', 'Ironmonger', 'Dustdevil', 'Rook77', 'Gauge', 'Wraith', 'Scrapwell', 'Lantern', 'Bulwark', 'Nomad', 'Tinker'];

export class BotManager {
  readonly bots = new Map<string, UserRecord>();
  private scheduled = new Set<string>();
  private behaviorTimer: NodeJS.Timeout;

  constructor(private profiles: ProfileManager, private lobby: LobbyManager, private matches: MatchManager, private mm: MatchmakingManager, private arenas: ArenaManager) {
    matches.onMatchChanged.push((m) => this.maybeMove(m));
    matches.onMatchCreated.push((m) => setTimeout(() => this.maybeMove(m), m.startsAt - Date.now() + 200));
    matches.onMatchEnded.push((m) => this.afterGame(m));
    this.behaviorTimer = setInterval(() => this.behave(), 4000);
  }

  add(count: number) {
    const out: UserRecord[] = [];
    for (let i = 0; i < count; i++) {
      const used = new Set([...this.bots.values()].map((b) => b.name));
      const base = NAMES.find((n) => !used.has(n)) ?? `Drifter${Math.floor(Math.random() * 900 + 100)}`;
      const u: UserRecord = {
        id: newId('bot_'), name: base, avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], tokenHash: newId('x'), createdAt: Date.now(), lastSeen: Date.now(),
        isAdmin: false, bot: true, rating: DEFAULT_RATING + Math.floor(Math.random() * 600 - 300), ratingGames: 30, stats: emptyStats(), achievements: [], settings: {},
        loadout: { faction: FACTION_IDS[Math.floor(Math.random() * FACTION_IDS.length)], mode: ((r) => (r < 0.25 ? 'war' : r < 0.45 ? 'checkers' : 'standard'))(Math.random()), finishers: { ...DEFAULT_FINISHERS }, timeControl: { minutes: 5, incrementSec: 2 }, abilityVisibility: 'secret' },
      };
      this.bots.set(u.id, u);
      this.profiles.register(u);
      this.lobby.enter(u.id);
      out.push(u);
    }
    return out;
  }

  clear() {
    for (const b of this.bots.values()) {
      const m = this.matches.activeMatchOf(b.id);
      if (m) m.resign(b.id);
      this.mm.leave(b.id);
      this.arenas.leave(b.id, true);
      this.matches.unspectateAll(b.id);
      this.lobby.exit(b.id);
      this.profiles.forget(b.id);
    }
    this.bots.clear();
  }

  /** Start a bot-vs-bot match right away (spectator testing). */
  async exhibition() {
    let idle = [...this.bots.values()].filter((b) => !this.matches.isPlaying(b.id));
    if (idle.length < 2) idle = [...idle, ...this.add(2 - idle.length)];
    const [w, b] = idle;
    this.mm.leave(w.id); this.mm.leave(b.id); this.arenas.leave(w.id, true); this.arenas.leave(b.id, true);
    return this.matches.create({ mode: 'standard', timeControl: { minutes: 5, incrementSec: 2 }, abilityVisibility: 'off', white: w, black: b });
  }

  private behave() {
    for (const b of this.bots.values()) {
      if (this.matches.isPlaying(b.id) || this.mm.isQueued(b.id) || this.arenas.isQueued(b.id)) continue;
      const r = Math.random();
      if (r < 0.12) void this.mm.join(b).catch(() => {});
      else if (r < 0.2) void this.arenas.join(b).catch(() => {});
      else if (r < 0.3) {
        const live = this.matches.summaries().filter((s) => s.status === 'playing');
        if (live.length) { try { this.matches.spectate(b.id, live[Math.floor(Math.random() * live.length)].id); } catch { /* gone */ } }
      } else if (r < 0.34) this.matches.unspectateAll(b.id);
    }
  }

  /** Real-time Arcade matches: each bot acts on its own jittered timer instead of waiting for a turn. */
  private arcadeLoops = new Map<string, NodeJS.Timeout>();
  private runArcade(m: Match) {
    for (const c of ['w', 'b'] as Color[]) {
      const p = m.players[c];
      const key = `${m.id}:${c}`;
      if (!p.bot || this.arcadeLoops.has(key)) continue;
      const tick = () => {
        this.arcadeLoops.delete(key);
        if (m.status !== 'playing' || m.engine.kind !== 'arcade') return;
        const mv = m.engine.aiMove(c, Date.now(), 0.12);
        if (mv) m.move(p.id, { from: mv.from as Square, to: mv.to as Square, ply: m.ply });
        this.arcadeLoops.set(key, setTimeout(tick, 900 + Math.random() * 1400));
      };
      this.arcadeLoops.set(key, setTimeout(tick, 1200 + Math.random() * 1000));
    }
  }

  private maybeMove(m: Match) {
    if (m.status !== 'playing') return;
    if (m.engine.kind === 'arcade') { this.runArcade(m); return; }
    const turn = m.engine.turn();
    const p = m.players[turn];
    if (!p.bot) return;
    const key = `${m.id}:${m.ply}`;
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const last = m.engine.history[m.engine.history.length - 1];
    const animDelay = last?.captured ? 3200 : 900;
    const think = animDelay + 500 + Math.random() * 1800;
    setTimeout(() => {
      this.scheduled.delete(key);
      if (m.status !== 'playing' || m.ply !== Number(key.split(':')[1]) || m.engine.turn() !== turn) return;
      const choice = m.engine.kind === 'checkers'
        ? m.engine.aiMove(4, 300, 0.08)
        : m.engine.kind === 'arcade' ? null
        : chooseMove(m.engine.fen(), { depth: 2, timeMs: 250, blunderChance: 0.1, legal: m.engine.legalMoves() as never });
      if (!choice) return;
      const res = m.move(p.id, { from: choice.from as Square, to: choice.to as Square, promotion: ('promotion' in choice ? choice.promotion : undefined) as PieceType | undefined, ply: m.ply });
      if (!res.ok) console.warn('[bot] move rejected', res.error);
    }, think);
  }

  private afterGame(m: Match) {
    // Bots occasionally accept a rematch offer from a human.
    for (const c of ['w', 'b'] as Color[]) {
      const p = m.players[c];
      if (p.bot && m.opts.mode !== 'kotb' && Math.random() < 0.5) setTimeout(() => m.rematch(p.id), 2500);
    }
  }

  dispose() { clearInterval(this.behaviorTimer); this.clear(); }
}
