// GameController — client-side GameState for every session type:
//   online (player)  server-authoritative; we send intents, animate results
//   spectate         read-only view of a live match
//   local            hot-seat two players on one machine
//   ai               practice vs Stockfish
//   replay           step through a stored game with its fights
//   demo             AI-vs-AI battle behind the lobby
// It sequences on-board animations (queue), handles input/selection, clocks,
// War Chess ability targeting, and exposes a reactive HUD store.

import { create } from 'zustand';
import { ARCADE_DURATION,
  ChessEngine, FACTION_IDS, GAME_MODES, MATCH_RULES, PIECE_KEYS, abilitiesFor, chooseMove, createEngine, isBuiltinFaction, other,
  type RulesEngine, type RulesMove,
  type AbilityView, type AiLevelId, type BuiltinFactionId, type Color, type FactionId, type FinisherSelection, type GameModeId, type GameResult,
  type MatchState, type MatchUpdate, type MoveRecord, type PieceType, type ReplayData, type Square, type TimeControl, type AbilityEventDTO,
  ABILITIES_BY_ID, DEFAULT_FINISHERS, type AbilityVisibility,
} from '@ashen/shared';
import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';
import { NetworkManager } from '../core/NetworkManager';
import { useSettings } from '../core/settings';
import { describeError, useApp } from '../core/store';
import { AiPlayer } from './AiPlayer';
import type { BoardStage } from './BoardStage';
import { squareToWorld } from './coords';
import { FactionManager } from './FactionManager';

export type SessionKind = 'none' | 'online' | 'spectate' | 'local' | 'ai' | 'replay' | 'demo';

export interface HudPlayer { id: string; name: string; faction: FactionId; rating?: number; connected: boolean; bot?: boolean; finishers: FinisherSelection; avatar?: string }

export interface GameHud {
  kind: SessionKind;
  matchId: string | null;
  arenaId: string | null;
  mode: GameModeId;
  timeControl: TimeControl;
  abilityVisibility: AbilityVisibility;
  status: 'idle' | 'picking' | 'countdown' | 'playing' | 'ended';
  /** Pre-match draft (online), with endsAt in local time. */
  pick: import('@ashen/shared').MatchState['pick'] | null;
  /** Arcade: local time when the match timer ends (0 = none). */
  arcadeEndsAt: number;
  startsAt: number;
  fen: string;
  turn: Color;
  me: Color | 'both' | 'spectator';
  players: Record<Color, HudPlayer>;
  history: MoveRecord[];
  captured: Record<Color, PieceType[]>;
  clocks: { w: number; b: number; running: Color | null; since: number; graceUntil: number; offset: number };
  result: GameResult | null;
  inCheck: boolean;
  selected: Square | null;
  animating: boolean;
  abilityView: AbilityView | null;
  ability: { id: string; first: Square | null; targets: Square[] } | null;
  promotion: { from: Square; to: Square } | null;
  drawOffer: Color | null;
  rematchOffers: Color[];
  spectators: number;
  chat: { from: string; name: string; text: string; at: number }[];
  emote: { color: Color | 'spectator'; emote: string; at: number } | null;
  banner: { text: string; sub?: string; at: number } | null;
  combatLabel: { attacker: string; finisher: string; key: string } | null;
  replay: { index: number; playing: boolean; total: number } | null;
  aiLevel: AiLevelId;
  cinematic: boolean;
}

const EMPTY_PLAYER: HudPlayer = { id: '', name: '—', faction: 'remnants', connected: true, finishers: { ...DEFAULT_FINISHERS } };

export const useGame = create<GameHud>(() => ({
  kind: 'none', matchId: null, arenaId: null, mode: 'standard', timeControl: { minutes: 0, incrementSec: 0 }, abilityVisibility: 'off', status: 'idle', startsAt: 0,
  fen: '', turn: 'w', me: 'w', players: { w: EMPTY_PLAYER, b: EMPTY_PLAYER }, history: [], captured: { w: [], b: [] },
  clocks: { w: 0, b: 0, running: null, since: 0, graceUntil: 0, offset: 0 }, result: null, inCheck: false, selected: null, animating: false,
  abilityView: null, ability: null, promotion: null, drawOffer: null, rematchOffers: [], spectators: 0, chat: [], emote: null, banner: null, pick: null, arcadeEndsAt: 0,
  combatLabel: null, replay: null, aiLevel: 'soldier', cinematic: false,
}));

const set = (p: Partial<GameHud>) => useGame.setState(p);
const get = () => useGame.getState();

class GameControllerImpl {
  stage: BoardStage | null = null;
  /** Local mirror of the rules (authoritative for local/ai, advisory for online). */
  engine: RulesEngine = new ChessEngine();
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private unsub: (() => void)[] = [];
  private clockTimer: number | null = null;
  private demoTimer: number | null = null;
  private replayData: ReplayData | null = null;
  private replayTimer: number | null = null;
  private localWar: { w: BuiltinFactionId; b: BuiltinFactionId } | null = null;
  private skipRequested = false;
  private appliedPly = 0;

  attach(stage: BoardStage) {
    this.stage = stage;
    if (get().kind === 'none') this.startDemo();
  }

  // =================================================================== session setup
  private reset(kind: SessionKind) {
    this.unsub.forEach((f) => f());
    this.unsub = [];
    this.queue = [];
    this.running = false;
    this.skipRequested = false;
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.demoTimer) clearTimeout(this.demoTimer);
    if (this.replayTimer) clearTimeout(this.replayTimer);
    this.clockTimer = this.demoTimer = this.replayTimer = null;
    this.stage?.combat.skip();
    this.stage?.deaths.finishAll();
    this.stage?.camera.releaseShot();
    set({ kind, arenaId: null, selected: null, ability: null, promotion: null, result: null, chat: [], emote: null, banner: null, combatLabel: null, replay: null, animating: false, drawOffer: null, rematchOffers: [], cinematic: false });
  }

  private async setupBoard(factions: Record<Color, FactionId>, fen: string, side: Color | 'both' | 'spectator') {
    const st = this.stage;
    if (!st) return;
    await FactionManager.preload([factions.w, factions.b]);
    st.factions = factions;
    st.rebuildActors(fen);
    const view = side === 'b' ? 'b' : 'w';
    st.camera.setMode(side === 'spectator' ? 'free' : 'tactical');
    st.camera.setSide(view);
    st.camera.resetView();
    this.refreshOverlays();
  }

  /** Stop whatever is running (demo etc.) and hand the stage to an editor/lab. */
  enterLab() {
    this.reset('none');
    if (this.stage) this.stage.combat.speed = 1;
  }

  leave() {
    const g = get();
    if ((g.kind === 'online') && g.matchId && g.status !== 'ended') { /* resign is explicit; leaving keeps the game (reconnect) */ }
    if (g.kind === 'spectate' && g.matchId) void NetworkManager.call('match:unspectate', { matchId: g.matchId }, { quiet: true }).catch(() => {});
    this.startDemo();
  }

  // =================================================================== demo (lobby background)
  startDemo() {
    this.reset('demo');
    const pick = () => FACTION_IDS[Math.floor(Math.random() * FACTION_IDS.length)];
    const w = pick();
    let b = pick();
    if (b === w) b = FACTION_IDS[(FACTION_IDS.indexOf(w) + 1) % 4];
    this.engine = new ChessEngine();
    set({
      status: 'playing', me: 'spectator', fen: this.engine.fen(), history: [], captured: { w: [], b: [] }, mode: 'standard',
      players: { w: { ...EMPTY_PLAYER, name: 'Demo', faction: w }, b: { ...EMPTY_PLAYER, name: 'Demo', faction: b } },
    });
    void this.setupBoard({ w, b }, this.engine.fen(), 'spectator').then(() => {
      this.stage?.camera.setMode('showcase');
      this.scheduleDemoMove();
    });
  }

  private scheduleDemoMove() {
    this.demoTimer = window.setTimeout(() => {
      if (get().kind !== 'demo') return;
      if (this.engine.isOver() || this.engine.ply > 120) { this.startDemo(); return; }
      const legal = this.engine.legalMoves();
      // Prefer captures so the lobby shows off fights.
      const caps = legal.filter((m) => m.captured);
      const m = caps.length && Math.random() < 0.7 ? caps[Math.floor(Math.random() * caps.length)] : chooseMove(this.engine.fen(), { depth: 1, timeMs: 60, blunderChance: 0.3, legal: legal as never });
      if (!m) { this.startDemo(); return; }
      const out = this.engine.move({ from: m.from as Square, to: m.to as Square, promotion: (m.promotion as PieceType) ?? undefined });
      if (out.ok) this.enqueueRecord(out.record, { quietAudio: true });
      this.enqueue(async () => { this.scheduleDemoMove(); });
    }, 1400 + Math.random() * 1600);
  }

  // =================================================================== local + AI
  startLocal(opts: { factions: Record<Color, FactionId>; mode: GameModeId; timeControl: TimeControl; finishers: Record<Color, FinisherSelection>; visibility?: AbilityVisibility; vsAi?: { color: Color; level: AiLevelId } }) {
    this.reset(opts.vsAi ? 'ai' : 'local');
    const war = GAME_MODES[opts.mode].abilities && opts.visibility !== 'off' ? { w: doctrine(opts.factions.w), b: doctrine(opts.factions.b) } : null;
    this.localWar = war;
    this.engine = createEngine(opts.mode, { war });
    const ms = opts.timeControl.minutes * 60_000;
    const me: Color | 'both' = opts.vsAi ? other(opts.vsAi.color) : 'both';
    const profile = useApp.getState().profile;
    const name = (c: Color) => (opts.vsAi && opts.vsAi.color === c ? `AI · ${opts.vsAi.level}` : opts.vsAi ? profile?.name ?? 'You' : c === 'w' ? 'Player 1' : 'Player 2');
    set({
      status: 'playing', mode: opts.mode, timeControl: opts.timeControl, abilityVisibility: war ? (opts.visibility ?? 'visible') : 'off', me, fen: this.engine.fen(), turn: 'w', history: [], captured: { w: [], b: [] },
      players: {
        w: { id: 'w', name: name('w'), faction: opts.factions.w, connected: true, bot: opts.vsAi?.color === 'w', finishers: opts.finishers.w },
        b: { id: 'b', name: name('b'), faction: opts.factions.b, connected: true, bot: opts.vsAi?.color === 'b', finishers: opts.finishers.b },
      },
      clocks: { w: ms, b: ms, running: ms ? 'w' : null, since: Date.now(), graceUntil: Date.now() + 1500, offset: 0 },
      aiLevel: opts.vsAi?.level ?? 'soldier', matchId: null,
    });
    this.updateAbilityView();
    void this.setupBoard(opts.factions, this.engine.fen(), me === 'both' ? 'w' : me).then(() => (this.engine.kind === 'arcade' ? (this.startArcadeTimer(), this.startArcadeAi()) : this.maybeAiMove()));
    if (ms) this.clockTimer = window.setInterval(() => this.tickLocalClock(), 200);
  }

  private tickLocalClock() {
    const g = get();
    if (g.status !== 'playing' || !g.clocks.running || g.kind === 'online') return;
    const c = g.clocks.running;
    if (this.clockLeft(c) <= 0) this.endLocal({ winner: other(c), reason: 'timeout' });
  }

  clockLeft(c: Color): number {
    const k = get().clocks;
    if (k.running !== c) return k[c];
    const now = Date.now() - k.offset;
    return k[c] - Math.max(0, now - Math.max(k.since, k.graceUntil));
  }

  private passLocalClock(mover: Color, graceMs: number) {
    const g = get();
    if (!g.clocks.running) return;
    const left = this.clockLeft(mover) + g.timeControl.incrementSec * 1000;
    set({ clocks: { ...g.clocks, [mover]: left, running: other(mover), since: Date.now(), graceUntil: Date.now() + graceMs } });
  }

  private endLocal(result: GameResult) {
    this.engine.setResult(result);
    set({ status: 'ended', result, clocks: { ...get().clocks, running: null } });
    this.announceResult(result);
  }

  private async maybeAiMove() {
    const g = get();
    if (g.kind !== 'ai' || g.status !== 'playing' || this.engine.isOver()) return;
    const turn = this.engine.turn();
    if (!g.players[turn].bot) return;
    const fen = this.engine.fen();
    const think = new Promise((r) => setTimeout(r, 450 + Math.random() * 500));
    const eng = this.engine;
    const mv = eng.kind === 'checkers'
      ? eng.aiMove({ recruit: 2, soldier: 3, veteran: 5, commander: 7, warlord: 9 }[g.aiLevel], 900, { recruit: 0.3, soldier: 0.12, veteran: 0.04, commander: 0, warlord: 0 }[g.aiLevel])
      : await AiPlayer.bestMove(fen, g.aiLevel, eng.legalMoves() as never);
    await think;
    if (get().kind !== 'ai' || this.engine.fen() !== fen || !mv) return;
    this.applyLocalMove({ from: mv.from as Square, to: mv.to as Square, promotion: ('promotion' in mv ? mv.promotion : undefined) as PieceType | undefined });
  }

  /** Checkers multi-jump: pre-select the piece that must keep jumping. */
  private selectContinuation() {
    const e = this.engine;
    if (e.kind === 'checkers' && e.continuing) { set({ selected: e.continuing }); this.refreshOverlays(); }
  }

  private applyLocalMove(m: { from: Square; to: Square; promotion?: PieceType }) {
    const mover = this.engine.turn();
    const out = this.engine.move(m);
    if (!out.ok) { useApp.getState().toast('error', describeError(out.error)); return; }
    if (this.engine.kind !== 'arcade' && (this.engine.turn() !== mover || this.engine.result)) this.passLocalClock(mover, out.record.captured ? MATCH_RULES.captureGraceMs : 0);
    this.handleAbilityEvents(out.events as AbilityEventDTO[]);
    this.updateAbilityView();
    this.enqueueRecord(out.record);
    this.enqueue(async () => {
      if (this.engine.result) { set({ status: 'ended', result: this.engine.result, clocks: { ...get().clocks, running: null } }); this.announceResult(this.engine.result); }
      else if (this.engine.kind !== 'arcade') { this.selectContinuation(); void this.maybeAiMove(); }
    });
  }

  // =================================================================== online
  async loadOnline(s: MatchState) {
    const spectator = s.youAre === 'spectator';
    const same = get().matchId === s.id && (get().kind === 'online' || get().kind === 'spectate');
    if (!same) this.reset(spectator ? 'spectate' : 'online');
    for (const c of ['w', 'b'] as Color[]) if (s.players[c].army) FactionManager.registerArmy(s.players[c].army!);
    const offset = Date.now() - s.serverNow;
    set({
      matchId: s.id, arenaId: s.arenaId, mode: s.mode, timeControl: s.timeControl, abilityVisibility: s.abilityVisibility, status: s.status, startsAt: s.startsAt + offset,
      me: s.youAre, fen: s.fen, turn: s.fen.split(' ')[1] as Color, players: toHudPlayers(s.players), history: s.history, captured: capturedFrom(s.history),
      clocks: { ...s.clocks, offset }, result: s.result, abilityView: s.abilityView, drawOffer: s.drawOffer, rematchOffers: s.rematchOffers, spectators: s.spectators,
      pick: s.pick ? { ...s.pick, endsAt: s.pick.endsAt + offset } : null,
      arcadeEndsAt: s.arcadeEndsAt ? s.arcadeEndsAt + offset : 0,
    });
    this.engine = createEngine(s.mode, { fen: s.fen });
    this.appliedPly = s.history.length;
    if (!same) {
      await this.setupBoard({ w: s.players.w.faction, b: s.players.b.faction }, s.fen, spectator ? 'spectator' : s.youAre);
      if (spectator) this.stage?.camera.setSide('w');
      this.unsub.push(NetworkManager.onMatchUpdate((u) => this.onUpdate(u)));
      this.unsub.push(NetworkManager.on('match:chat', (m) => { if (m.matchId === get().matchId) set({ chat: [...get().chat.slice(-40), m] }); }));
      this.unsub.push(NetworkManager.on('match:emote', (m) => { if (m.matchId === get().matchId) set({ emote: { color: m.color, emote: m.emote, at: Date.now() } }); }));
      if (s.status === 'countdown') set({ banner: { text: 'Match found', sub: `${s.players.w.name} vs ${s.players.b.name}`, at: Date.now() } });
    } else if (this.boardKey !== `${s.players.w.faction}|${s.players.b.faction}`) {
      // The draft changed an army: rebuild the board with the chosen factions.
      await this.setupBoard({ w: s.players.w.faction, b: s.players.b.faction }, s.fen, spectator ? 'spectator' : s.youAre);
      if (s.status === 'countdown') set({ banner: { text: 'Armies locked', sub: `${s.players.w.name} vs ${s.players.b.name}`, at: Date.now() } });
    } else {
      this.stage?.setPosition(s.fen);
    }
    this.boardKey = `${s.players.w.faction}|${s.players.b.faction}`;
    this.refreshOverlays();
  }

  private boardKey = '';

  /** Draft: choose army / sabotage / ready during the 'picking' phase. */
  pickDraft(input: { faction?: import('@ashen/shared').FactionId; sabotage?: string | null; ready?: boolean }) {
    const id = get().matchId;
    if (id) void NetworkManager.call('match:pick', { matchId: id, ...input });
  }

  private onUpdate(u: MatchUpdate) {
    if (u.matchId !== get().matchId) return;
    const offset = Date.now() - u.serverNow;
    const prevStatus = get().status;
    if (u.arcadeEndsAt) set({ arcadeEndsAt: u.arcadeEndsAt + offset });
    set({ clocks: { ...u.clocks, offset }, status: u.status, abilityView: u.abilityView, drawOffer: u.drawOffer, rematchOffers: u.rematchOffers, players: toHudPlayers(u.players), spectators: u.spectators });
    if (u.abilityEvents?.length) this.handleAbilityEvents(u.abilityEvents);
    if (u.move && u.ply > this.appliedPly) {
      if (u.ply > this.appliedPly + 1) {
        // We missed something (reconnect / lag) — resync instantly.
        void this.resync();
        return;
      }
      this.appliedPly = u.ply;
      const eng = this.engine;
      if (eng.kind === 'arcade') eng.applyRemote(u.move, u.move.at + offset);
      else this.engine = createEngine(get().mode, { fen: u.fen });
      this.enqueueRecord(u.move);
      this.enqueue(async () => { set({ history: [...get().history.filter((h) => h.ply < u.move!.ply), u.move!], captured: capturedFrom([...get().history, u.move!]) }); });
    } else if (!u.move && u.fen !== this.engine.fen() && !this.running) {
      this.engine = createEngine(get().mode, { fen: u.fen });
      this.stage?.setPosition(u.fen);
    }
    if (u.status === 'playing' && prevStatus === 'countdown') { set({ banner: { text: 'Fight', at: Date.now() } }); AudioManager.play('ui_match_found'); }
    if (u.status === 'ended' && prevStatus !== 'ended') {
      this.enqueue(async () => { set({ result: u.result }); if (u.result) this.announceResult(u.result); });
    }
    this.refreshOverlays();
  }

  async resync() {
    const id = get().matchId;
    if (!id) return;
    const s = await NetworkManager.call('match:sync', { matchId: id }).catch(() => null) as MatchState | null;
    if (!s) return;
    this.queue = [];
    this.stage?.combat.skip();
    this.stage?.deaths.finishAll();
    await this.loadOnline(s);
  }

  // =================================================================== replay
  async startReplay(data: ReplayData) {
    this.reset('replay');
    this.replayData = data;
    for (const c of ['w', 'b'] as Color[]) { const a = data.armies?.[c]; if (a) FactionManager.registerArmy(a); }
    this.engine = createEngine(data.mode, { fen: data.startFen });
    set({
      status: 'playing', me: 'spectator', fen: data.startFen, mode: data.mode, history: [], captured: { w: [], b: [] }, result: null,
      players: {
        w: { id: data.white.id, name: data.white.name, faction: data.white.faction, connected: true, finishers: data.finishers.w },
        b: { id: data.black.id, name: data.black.name, faction: data.black.faction, connected: true, finishers: data.finishers.b },
      },
      replay: { index: 0, playing: false, total: data.moves.length },
    });
    await this.setupBoard({ w: data.white.faction, b: data.black.faction }, data.startFen, 'spectator');
    this.stage?.camera.setMode('tactical');
  }

  replayStep(dir: 1 | -1) {
    const d = this.replayData, r = get().replay;
    if (!d || !r || this.running) return;
    if (dir === 1 && r.index < d.moves.length) {
      const rec = d.moves[r.index];
      set({ replay: { ...r, index: r.index + 1 }, history: d.moves.slice(0, r.index + 1), captured: capturedFrom(d.moves.slice(0, r.index + 1)) });
      this.enqueueRecord(rec);
      if (r.index + 1 === d.moves.length) this.enqueue(async () => { set({ result: d.result }); this.announceResult(d.result, true); });
    } else if (dir === -1 && r.index > 0) this.replayJump(r.index - 1);
  }

  replayJump(index: number) {
    const d = this.replayData;
    if (!d) return;
    this.queue = [];
    this.stage?.combat.skip();
    this.stage?.deaths.finishAll();
    const i = Math.max(0, Math.min(d.moves.length, index));
    const fen = i === 0 ? d.startFen : d.moves[i - 1].fenAfter;
    this.engine = createEngine(get().mode, { fen });
    this.stage?.setPosition(fen);
    set({ fen, replay: { ...get().replay!, index: i }, history: d.moves.slice(0, i), captured: capturedFrom(d.moves.slice(0, i)), result: i === d.moves.length ? d.result : null });
    this.refreshOverlays();
  }

  replayPlay(on: boolean) {
    const r = get().replay;
    if (!r) return;
    set({ replay: { ...r, playing: on } });
    if (this.replayTimer) clearTimeout(this.replayTimer);
    if (!on) return;
    const loop = () => {
      const cur = get().replay;
      if (!cur?.playing || get().kind !== 'replay') return;
      if (cur.index >= cur.total) { set({ replay: { ...cur, playing: false } }); return; }
      if (!this.running) this.replayStep(1);
      this.replayTimer = window.setTimeout(loop, 500);
    };
    loop();
  }

  // =================================================================== animation queue
  private enqueue(job: () => Promise<void>) {
    this.queue.push(job);
    if (!this.running) void this.drain();
  }

  private async drain() {
    this.running = true;
    set({ animating: true });
    while (this.queue.length) {
      const job = this.queue.shift()!;
      try { await job(); } catch (e) { console.error('[anim]', e); }
    }
    this.running = false;
    this.skipRequested = false;
    set({ animating: false });
    this.refreshOverlays();
  }

  private enqueueRecord(rec: MoveRecord, opts: { quietAudio?: boolean } = {}) {
    this.enqueue(() => this.animateRecord(rec, opts));
  }

  /** Visualise one ply on the board, then hard-sync to its FEN. */
  private async animateRecord(rec: MoveRecord, _opts: { quietAudio?: boolean }) {
    const st = this.stage;
    if (!st) return;
    const g = get();
    // Catch up quickly if several plies are waiting (lag/reconnect/replay jumps).
    const backlog = this.queue.filter(Boolean).length;
    const settingSpeed = useSettings.getState().combatSpeed;
    // Arcade is real time: fights play fast so the board keeps up with the players.
    const arcade = this.engine.kind === 'arcade';
    const speed = this.skipRequested ? 0 : g.kind === 'demo' ? 1.15 : backlog > (arcade ? 3 : 2) ? 0 : settingSpeed * (arcade ? 2.2 : this.engine.kind === 'checkers' ? 1.6 : 1);
    set({ selected: null, fen: rec.fenAfter });

    if (rec.flags === 'A') {
      await this.animateAbilityRecord(rec, speed);
    } else {
      const mover = st.actorAt(rec.from);
      if (!mover) { st.setPosition(rec.fenAfter); return; }
      const capSq = (rec.captureSquare ?? (rec.flags.includes('e') ? `${rec.to[0]}${rec.from[1]}` : rec.to)) as Square;
      const defender = rec.captured ? st.actorAt(capSq) : undefined;
      if (defender && mover) {
        const pc = PIECE_KEYS[rec.piece];
        const finisherId = g.players[rec.color].finishers[pc] ?? DEFAULT_FINISHERS[pc];
        const resolved = st.combat.resolve(mover, defender, finisherId, rec.ply);
        set({ combatLabel: { attacker: FactionManager.combatInfo(mover.faction, pc).unitName, finisher: resolved.sequence.name, key: resolved.matchedKey } });
        await st.combat.capture(mover, defender, squareToWorld(rec.to), { finisherId, seed: rec.ply, speed });
        set({ combatLabel: null });
        st.removeActor(defender);
      } else {
        const jobs: Promise<void>[] = [st.combat.move(mover, rec.to, speed, { leap: rec.piece === 'n' })];
        if (rec.flags.includes('k') || rec.flags.includes('q')) {
          const rank = rec.color === 'w' ? '1' : '8';
          const rook = st.actorAt((rec.flags.includes('k') ? `h${rank}` : `a${rank}`) as Square);
          if (rook) jobs.push(st.combat.move(rook, rec.flags.includes('k') ? `f${rank}` : `d${rank}`, speed));
        }
        await Promise.all(jobs);
      }
      mover.square = rec.to;
      if (rec.promotion) {
        const pos = mover.position.clone();
        st.fx.emit('promotion', pos, { color: FactionManager.accent(mover.faction) });
        st.audio.play('ability', pos);
      }
      for (const e of rec.effects ?? []) {
        if (e.type === 'remove') {
          const victim = st.actorAt(e.square);
          const at = squareToWorld(e.square);
          st.fx.emit(e.cause === 'wl_mine' ? 'mine_blast' : 'fire_burst', at.clone().setY(0.2));
          st.audio.play(e.cause === 'wl_mine' ? 'mine_blast' : 'execution', at);
          st.camera.addShake(0.8, 0.4);
          if (victim) { await st.deaths.kill(victim, 'knockback_death', new THREE.Vector3(0, 0, victim.color === 'w' ? 1 : -1), rec.ply); st.removeActor(victim); }
        }
      }
    }
    st.setPosition(rec.fenAfter);
    this.engine = this.engine.fen() === rec.fenAfter ? this.engine : this.syncEngineFrom(rec.fenAfter);
    const turn = rec.fenAfter.split(' ')[1] as Color;
    const inCheck = this.engine.inCheck();
    set({ turn, inCheck });
    if (inCheck && !this.engine.isCheckmate()) st.audio.play('check');
    // Checkmate: the King Defeat sequence plays on the board.
    if (this.engine.isCheckmate()) await this.playKingDefeat(rec, speed);
    if (get().kind === 'local' || get().kind === 'ai') set({ history: this.engine.history, captured: capturedFrom(this.engine.history) });
  }

  private syncEngineFrom(fen: string) {
    const k = get().kind;
    if (k === 'local' || k === 'ai' || k === 'demo') return this.engine;
    return createEngine(get().mode, { fen });
  }

  private async animateAbilityRecord(rec: MoveRecord, speed: number) {
    const st = this.stage!;
    const def = ABILITIES_BY_ID[rec.ability ?? ''];
    for (const e of rec.effects ?? []) {
      if (e.type === 'relocate') {
        const a = st.actorAt(e.from);
        const from = squareToWorld(e.from), to = squareToWorld(e.to);
        st.fx.emit('energy_burst', from.clone().setY(0.4));
        st.audio.play('ability', from);
        if (a) {
          await st.tweens.to(0.35 / Math.max(0.5, speed || 1), (u) => { a.root.scale.setScalar(1 - u * 0.95); });
          a.placeAt(e.to);
          st.fx.emit('energy_burst', to.clone().setY(0.4));
          await st.tweens.to(0.35 / Math.max(0.5, speed || 1), (u) => { a.root.scale.setScalar(0.05 + u * 0.95); });
          a.root.scale.setScalar(1);
        }
      } else if (e.type === 'remove') {
        const v = st.actorAt(e.square);
        const at = squareToWorld(e.square).setY(0.2);
        st.fx.emit('fire_burst', at, { scale: 1.2 });
        st.audio.play('execution', at);
        if (v) { await st.deaths.kill(v, 'knockback_death', new THREE.Vector3(0, 0, v.color === 'w' ? 1 : -1), rec.ply); st.removeActor(v); }
      }
    }
    set({ banner: { text: def?.name ?? 'Ability', sub: `${get().players[rec.color].name}`, at: Date.now() } });
  }

  private async playKingDefeat(rec: MoveRecord, speed: number) {
    const st = this.stage!;
    const loser = other(rec.color);
    const king = st.actors.find((a) => a.alive && a.type === 'k' && a.color === loser);
    const attacker = st.actorAt(rec.to);
    if (!king || !attacker) return;
    set({ cinematic: true });
    const finisher = get().players[rec.color].finishers.king ?? 'king_f1';
    await st.combat.checkmate(attacker, king, finisher, rec.ply, this.skipRequested ? 4 : Math.max(0.6, speed || 1));
    set({ cinematic: false });
  }

  /** Skip the current fight / cinematic (and fast-forward queued ones). */
  skip() {
    this.skipRequested = true;
    this.stage?.combat.skip();
  }

  // =================================================================== input
  onSquareClick(s: Square | null) {
    const g = get();
    const arcade = this.engine.kind === 'arcade';
    if (!s || g.status !== 'playing' || (this.running && !arcade)) return;
    if (g.kind === 'demo' || g.kind === 'spectate' || g.kind === 'replay') return;
    if (arcade) { this.arcadeClick(s); return; }
    const turn = this.engine.turn();
    const mine = g.me === 'both' ? turn : g.me;
    if (mine !== turn) return;
    if (g.players[turn].bot) return;

    // Ability targeting mode.
    if (g.ability) {
      if (!g.ability.targets.includes(s)) { set({ ability: null }); this.refreshOverlays(); return; }
      const def = ABILITIES_BY_ID[g.ability.id];
      const twoStep = def.target.kind === 'own_then_empty' || def.target.kind === 'own_pair';
      if (twoStep && !g.ability.first) {
        set({ ability: { id: g.ability.id, first: s, targets: this.localAbilityTargets(g.ability.id, s) } });
        this.refreshOverlays();
        return;
      }
      void this.useAbility(g.ability.id, twoStep ? g.ability.first! : s, twoStep ? s : undefined);
      return;
    }

    const piece = this.engine.get(s);
    if (g.selected) {
      const moves = this.legalFrom(g.selected);
      const mv = moves.find((m) => m.to === s);
      if (mv) {
        if (mv.promotion && this.engine.kind === 'chess' && !useSettings.getState().autoQueen) { set({ promotion: { from: g.selected, to: s } }); return; }
        void this.submitMove(g.selected, s, mv.promotion && this.engine.kind === 'chess' ? 'q' : undefined);
        return;
      }
    }
    if (piece && piece.color === turn) {
      set({ selected: s });
      AudioManager.play('ui_select');
    } else set({ selected: null });
    this.refreshOverlays();
  }

  /** Arcade input: select any own piece; click a target to move as soon as its cooldown allows. */
  private arcadeClick(s: Square) {
    const g = get();
    const piece = this.engine.get(s);
    const mine = (c: Color) => g.me === 'both' || g.me === c;
    if (g.selected) {
      const mv = this.engine.legalMoves(g.selected).find((m) => m.to === s);
      if (mv) { void this.submitMove(g.selected, s, mv.promotion ? 'q' : undefined); return; }
    }
    if (piece && mine(piece.color) && !g.players[piece.color].bot) { set({ selected: s }); AudioManager.play('ui_select'); }
    else set({ selected: null });
    this.refreshOverlays();
  }

  /** Practice vs AI in Arcade: the bot moves on its own timer. */
  private arcadeAi: number | null = null;
  private arcadeTimer: number | null = null;
  /** Local (practice / hot-seat) Arcade: run the match timer on this machine. */
  private startArcadeTimer() {
    if (this.arcadeTimer) window.clearTimeout(this.arcadeTimer);
    const ends = Date.now() + ARCADE_DURATION;
    set({ arcadeEndsAt: ends });
    this.arcadeTimer = window.setTimeout(() => {
      const eng = this.engine;
      if (eng.kind === 'arcade' && get().status === 'playing' && (get().kind === 'ai' || get().kind === 'local')) this.endLocal(eng.decideOnTime());
    }, ARCADE_DURATION);
  }

  private startArcadeAi() {
    if (this.arcadeAi) window.clearTimeout(this.arcadeAi);
    const tick = () => {
      const g = get();
      const eng = this.engine;
      if (g.kind !== 'ai' || eng.kind !== 'arcade' || g.status === 'ended') { this.arcadeAi = null; return; }
      if (g.status === 'playing') {
        const bot: Color | null = g.players.w.bot ? 'w' : g.players.b.bot ? 'b' : null;
        const level = { recruit: 0.35, soldier: 0.2, veteran: 0.1, commander: 0.04, warlord: 0 }[g.aiLevel] ?? 0.15;
        const mv = bot ? eng.aiMove(bot, Date.now(), level) : null;
        if (mv) this.applyLocalMove({ from: mv.from as Square, to: mv.to as Square });
      }
      const pace = { recruit: 2200, soldier: 1700, veteran: 1300, commander: 1000, warlord: 800 }[g.aiLevel] ?? 1500;
      this.arcadeAi = window.setTimeout(tick, pace * (0.7 + Math.random() * 0.6));
    };
    this.arcadeAi = window.setTimeout(tick, 1500);
  }

  choosePromotion(p: PieceType | null) {
    const pr = get().promotion;
    set({ promotion: null });
    if (pr && p) void this.submitMove(pr.from, pr.to, p);
  }

  private legalFrom(s: Square): RulesMove[] {
    const g = get();
    if (g.kind === 'online') return filterByVisibleEffects(this.engine.legalMoves(s), g.abilityView, this.engine.turn(), this.engine.inCheck());
    return this.engine.legalMoves(s);
  }

  async submitMove(from: Square, to: Square, promotion?: PieceType) {
    const g = get();
    set({ selected: null });
    if (g.kind === 'local' || g.kind === 'ai') { this.applyLocalMove({ from, to, promotion }); return; }
    if (g.kind !== 'online' || !g.matchId) return;
    try {
      const rec = await NetworkManager.call('match:move', { matchId: g.matchId, from, to, promotion: promotion as 'q' | undefined, ply: this.appliedPly }) as MoveRecord;
      // Our own move: animate immediately from the ack; the broadcast for this ply is then ignored.
      if (rec && rec.ply > this.appliedPly) {
        this.appliedPly = rec.ply;
        this.engine = createEngine(get().mode, { fen: rec.fenAfter });
        this.enqueueRecord(rec);
        this.enqueue(async () => { set({ history: [...get().history.filter((h) => h.ply < rec.ply), rec], captured: capturedFrom([...get().history, rec]) }); this.selectContinuation(); });
      }
    } catch (e) {
      if ((e as Error).message === 'stale_ply') void this.resync();
      if ((e as Error).message === 'illegal_move' && g.mode === 'war') useApp.getState().toast('warn', 'Something on the board blocked that move…');
    }
    this.refreshOverlays();
  }

  // =================================================================== abilities
  beginAbility(id: string) {
    const g = get();
    const def = ABILITIES_BY_ID[id];
    if (!def || this.running) return;
    if (def.target.kind === 'none') { void this.useAbility(id); return; }
    const targets = this.localAbilityTargets(id);
    if (!targets.length) { useApp.getState().toast('warn', 'No valid targets'); return; }
    set({ ability: { id, first: null, targets }, selected: null });
    void g;
    this.refreshOverlays();
  }

  cancelAbility() { set({ ability: null }); this.refreshOverlays(); }

  private localAbilityTargets(id: string, first?: Square): Square[] {
    const g = get();
    const color = g.me === 'both' ? this.engine.turn() : (g.me as Color);
    if (g.kind === 'online') {
      // Mirror the server engine closely enough to offer targets; the server re-validates everything.
      const mirror = new ChessEngine({ fen: this.engine.fen(), war: { w: doctrine(g.players.w.faction), b: doctrine(g.players.b.faction) } });
      return mirror.abilityTargets(color, id, first);
    }
    return this.engine.abilityTargets(color, id, first);
  }

  private async useAbility(id: string, target?: Square, target2?: Square) {
    const g = get();
    set({ ability: null });
    const color = g.me === 'both' ? this.engine.turn() : (g.me as Color);
    if (g.kind === 'online' && g.matchId) {
      await NetworkManager.call('match:ability', { matchId: g.matchId, abilityId: id, target, target2, ply: this.appliedPly }).catch(() => {});
    } else {
      const out = this.engine.useAbility(color, { abilityId: id, target, target2 });
      if (!out.ok) { useApp.getState().toast('error', describeError(out.error)); return; }
      this.handleAbilityEvents(out.events as AbilityEventDTO[]);
      this.updateAbilityView();
      if (out.record) {
        this.passLocalClock(color, 1500);
        this.enqueueRecord(out.record);
        this.enqueue(async () => { void this.maybeAiMove(); });
      }
    }
    this.refreshOverlays();
  }

  private handleAbilityEvents(events: AbilityEventDTO[]) {
    const st = this.stage;
    for (const e of events) {
      const def = 'abilityId' in e ? ABILITIES_BY_ID[e.abilityId] ?? null : null;
      if (e.type === 'ability_used') {
        AudioManager.play('ability');
        if (e.target && st) st.fx.emit('ability_pulse', squareToWorld(e.target), { color: FactionManager.accent(get().players[e.color].faction) });
        if (def && !def.consumesTurn) set({ banner: { text: def.name, sub: get().players[e.color].name, at: Date.now() } });
      } else if (e.type === 'ability_revealed') {
        const mine = get().me === e.color || get().me === 'both';
        if (!mine && def) useApp.getState().toast('warn', `Enemy ability revealed: ${def.name}`);
      } else if (e.type === 'ability_triggered' && def) {
        useApp.getState().toast('info', `${def.name} triggered`);
      }
    }
  }

  private updateAbilityView() {
    const g = get();
    if (!this.engine.war) { set({ abilityView: null }); return; }
    const viewer = g.me === 'both' ? this.engine.turn() : g.me;
    set({ abilityView: this.engine.abilityView(viewer as Color | 'spectator', g.abilityVisibility === 'off' ? 'visible' : g.abilityVisibility) });
  }

  // =================================================================== actions
  resign() { const g = get(); if (g.kind === 'online' && g.matchId) void NetworkManager.call('match:resign', { matchId: g.matchId }); else if (g.kind === 'local' || g.kind === 'ai') this.endLocal({ winner: other(g.me === 'both' ? this.engine.turn() : (g.me as Color)), reason: 'resign' }); }
  offerDraw(action: 'offer' | 'accept' | 'decline') { const g = get(); if (g.kind === 'online' && g.matchId) void NetworkManager.call('match:draw', { matchId: g.matchId, action }); else if (g.kind === 'local') this.endLocal({ winner: null, reason: 'agreement' }); }
  rematch() {
    const g = get();
    if (g.kind === 'online' && g.matchId) void NetworkManager.call('match:rematch', { matchId: g.matchId });
    else if (g.kind === 'local' || g.kind === 'ai') {
      const ai = g.kind === 'ai' ? { color: (g.players.w.bot ? 'b' : 'w') as Color, level: g.aiLevel } : undefined;
      this.startLocal({ factions: { w: g.players.b.faction, b: g.players.w.faction }, mode: g.mode, timeControl: g.timeControl, finishers: { w: g.players.b.finishers, b: g.players.w.finishers }, visibility: g.abilityVisibility, vsAi: ai });
    }
  }
  chat(text: string) { const g = get(); if (g.matchId) void NetworkManager.call('match:chat', { matchId: g.matchId, text }); }
  emote(emote: 'gg' | 'wow' | 'taunt' | 'salute' | 'oops' | 'thinking') { const g = get(); if (g.matchId) void NetworkManager.call('match:emote', { matchId: g.matchId, emote }); else set({ emote: { color: g.me === 'both' ? this.engine.turn() : (g.me as Color), emote, at: Date.now() } }); }

  private announceResult(r: GameResult, quiet = false) {
    const g = get();
    const mine = g.me === 'w' || g.me === 'b' ? g.me : null;
    if (!quiet) AudioManager.play(!mine || r.winner === null ? 'victory' : r.winner === mine ? 'victory' : 'defeat');
  }

  // =================================================================== overlays
  /** Arcade: squares of own pieces still on cooldown (shown as a frost tint). */
  private coolingSquares(): Square[] {
    const eng = this.engine;
    if (eng.kind !== 'arcade') return [];
    const g = get();
    const out: Square[] = [];
    const now = Date.now();
    for (const [s] of eng.cooldown) {
      const p = eng.get(s);
      if (p && (g.me === 'both' || g.me === p.color) && eng.cooldownLeft(s, now) > 0) out.push(s);
    }
    return out;
  }

  private coolTimer: number | null = null;

  refreshOverlays() {
    const st = this.stage;
    if (!st) return;
    // Arcade: keep the cooldown tint ticking down while any own piece is cooling.
    if (this.engine.kind === 'arcade' && !this.coolTimer && get().status === 'playing') {
      this.coolTimer = window.setTimeout(() => { this.coolTimer = null; this.refreshOverlays(); }, 250);
    }
    const g = get();
    const show = useSettings.getState().showLegalMoves;
    const moves = g.selected && show ? this.legalFrom(g.selected) : [];
    const last = g.history.length ? g.history[g.history.length - 1] : null;
    const kingSq = this.engine.inCheck() ? this.engine.kingSquare(this.engine.turn()) ?? null : null;
    const view = g.abilityView;
    const myColor = g.me === 'both' ? this.engine.turn() : g.me;
    const threats = view?.effects.some((e) => e.kind === 'threats' && e.owner === myColor) && myColor !== 'spectator' ? this.engine.attackedSquares(other(myColor as Color)) : [];
    const intel: Square[] = [];
    if (this.engine.kind === 'chess') for (const e of view?.effects ?? []) if ((e.kind === 'mark' || e.kind === 'neural') && e.owner === myColor) for (const s of e.squares) {
      const probe = new ChessEngine({ fen: setTurn(this.engine.fen(), this.engine.get(s)?.color ?? 'w') });
      try { intel.push(...probe.legalMoves(s).map((m) => m.to as Square)); } catch { /* ignore */ }
    }
    st.setOverlays({
      selected: g.selected, moves: moves.map((m) => m.to as Square), captures: moves.filter((m) => m.captured).map((m) => m.to as Square),
      lastMove: last && last.flags !== 'A' ? [last.from, last.to] : null, check: kingSq, targets: g.ability?.targets ?? [], threats, intel,
      effects: [...(view?.effects ?? []).filter((e) => e.kind !== 'threats').map((e) => ({ kind: e.kind, squares: e.squares, mine: e.owner === myColor })),
        ...(this.engine.kind === 'arcade' ? [{ kind: 'freeze' as const, squares: this.coolingSquares(), mine: true }] : [])],
    });
    for (const a of st.actors) a.setSelected(a.square === g.selected && a.alive);
  }
}

// ----------------------------------------------------------------------------- helpers
function doctrine(f: FactionId): BuiltinFactionId {
  if (isBuiltinFaction(f)) return f;
  return FactionManager.army(f)?.doctrine ?? 'remnants';
}

function setTurn(fen: string, c: Color) { const p = fen.split(' '); p[1] = c; p[3] = '-'; return p.join(' '); }

function toHudPlayers(p: MatchState['players']): Record<Color, HudPlayer> {
  const m = (x: MatchState['players']['w']): HudPlayer => ({ id: x.id, name: x.name, faction: x.faction, rating: x.rating, connected: x.connected, bot: x.bot, finishers: x.finishers, avatar: x.avatar });
  return { w: m(p.w), b: m(p.b) };
}

export function capturedFrom(history: MoveRecord[]): Record<Color, PieceType[]> {
  const out: Record<Color, PieceType[]> = { w: [], b: [] };
  for (const h of history) {
    if (h.captured) out[h.color].push(h.captured);
    for (const e of h.effects ?? []) if (e.type === 'remove') out[h.color].push('p');
  }
  return out;
}

/** Client-side filter mirroring the server's visible War Chess restrictions. */
function filterByVisibleEffects(moves: RulesMove[], view: AbilityView | null, mover: Color, inCheck: boolean): RulesMove[] {
  if (!view || inCheck) return moves;
  const enemy = other(mover);
  const out = moves.filter((m) => {
    for (const e of view.effects) {
      if (e.owner !== enemy) continue;
      if (e.kind === 'freeze' && e.squares.includes(m.from as Square)) return false;
      if (m.captured && (e.kind === 'shield' || e.kind === 'no_capture') && e.squares.includes(m.to as Square)) return false;
    }
    return true;
  });
  return out.length ? out : moves;
}

export const GameController = new GameControllerImpl();
export { abilitiesFor };
