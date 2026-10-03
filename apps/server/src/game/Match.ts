// One authoritative match. Owns the ChessEngine, the clocks, and who may see
// what. Clients only ever send intents (move / ability / resign...); this
// class validates them against server state and broadcasts the outcome.

import {
  ARCADE_DURATION, createEngine, type RulesEngine, FACTIONS, FACTION_IDS, SABOTAGE_IDS, GAME_MODES, MATCH_RULES, PIECE_KEYS, START_FEN, defaultCombatRegistry, isBuiltinFaction, other,
  type AbilityEventDTO, type AbilityVisibility, type BuiltinFactionId, type ClockState, type Color, type CustomArmy, type DeathTypeId,
  type FactionId, type FinisherSelection, type GameModeId, type GameResult, type MatchPlayer, type MatchState, type MatchStatus,
  type MatchUpdate, type MoveRecord, type PieceClass, type PieceType, type RigType, type Square, type TimeControl,
} from '@ashen/shared';
import type { Hub } from './hub.js';
import { spectatorRoom } from './hub.js';

export interface PlayerInit {
  id: string;
  name: string;
  avatar: string;
  rating: number;
  faction: FactionId;
  finishers: FinisherSelection;
  army?: CustomArmy;
  bot?: boolean;
}

export interface MatchOptions {
  id: string;
  arenaId: string;
  mode: GameModeId;
  timeControl: TimeControl;
  abilityVisibility: AbilityVisibility;
  white: PlayerInit;
  black: PlayerInit;
  isPrivate: boolean;
  startDelayMs: number;
  ranked: boolean;
  /** Pre-match draft length; 0 = start straight away (bot matches, tests). */
  pickMs?: number;
}

export interface MatchHooks {
  onEnd(m: Match): void;
  onChange(m: Match): void;
  onRematch(m: Match): void;
}

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export class Match {
  readonly id: string;
  readonly opts: MatchOptions;
  engine: RulesEngine;
  readonly players: Record<Color, MatchPlayer>;
  readonly startedAt = Date.now();
  status: MatchStatus = 'countdown';
  startsAt: number;
  clocks: ClockState;
  spectators = new Set<string>();
  drawOffer: Color | null = null;
  rematchOffers = new Set<Color>();
  endedAt = 0;
  private flagTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private abandonTimers = new Map<Color, NodeJS.Timeout>();
  private pickTimer: NodeJS.Timeout | null = null;
  pickEndsAt = 0;
  picks: Record<Color, { faction: FactionId; sabotage: string | null; ready: boolean }>;

  constructor(opts: MatchOptions, private hub: Hub, private hooks: MatchHooks, restore?: { engine: RulesEngine; clocks: ClockState; status: MatchStatus; startsAt: number }) {
    this.id = opts.id;
    this.opts = opts;
    const war = GAME_MODES[opts.mode].abilities && opts.abilityVisibility !== 'off'
      ? { w: abilityFaction(opts.white), b: abilityFaction(opts.black) }
      : null;
    this.engine = restore?.engine ?? createEngine(opts.mode, { war });
    const base = opts.timeControl.minutes * 60_000;
    this.players = {
      w: { ...pick(opts.white), connected: true },
      b: { ...pick(opts.black), connected: true },
    };
    this.picks = {
      w: { faction: opts.white.faction, sabotage: null, ready: !!opts.white.bot },
      b: { faction: opts.black.faction, sabotage: null, ready: !!opts.black.bot },
    };
    const drafting = !restore && (opts.pickMs ?? 0) > 0;
    if (drafting) {
      this.status = 'picking';
      this.pickEndsAt = Date.now() + opts.pickMs!;
      for (const c of ['w', 'b'] as Color[]) if (this.players_init(c).bot && this.sabotageOn) this.picks[c].sabotage = SABOTAGE_IDS[Math.floor(Math.random() * SABOTAGE_IDS.length)];
      this.pickTimer = setTimeout(() => this.finalizePicks(), opts.pickMs!);
    }
    this.startsAt = restore?.startsAt ?? (drafting ? this.pickEndsAt + 3000 : Date.now() + opts.startDelayMs);
    this.clocks = restore?.clocks ?? { w: base, b: base, running: null, since: this.startsAt, graceUntil: 0 };
    if (restore) {
      this.status = restore.status;
      if (this.status === 'playing') this.scheduleFlag();
    }
    if (this.status === 'countdown') this.startTimer = setTimeout(() => this.begin(), Math.max(0, this.startsAt - Date.now()));
  }

  get arcade() { return this.engine.kind === 'arcade'; }
  /** Real-time arcade games have a match timer instead of per-turn clocks. */
  get timed() { return this.opts.timeControl.minutes > 0 && this.engine.kind !== 'arcade'; }
  arcadeEndsAt = 0;
  private arcadeTimer: NodeJS.Timeout | null = null;
  private players_init(c: Color) { return c === 'w' ? this.opts.white : this.opts.black; }
  /** Sabotage cards exist only in War Chess with abilities on. */
  get sabotageOn() { return GAME_MODES[this.opts.mode].abilities && this.opts.abilityVisibility !== 'off'; }
  /** Armies a player may draft: the four built-ins plus the (custom) army they queued with. */
  allowedFactions(c: Color): FactionId[] {
    const own = this.players_init(c).faction;
    return [...new Set<FactionId>([...FACTION_IDS, own])];
  }

  /** Draft input during the 'picking' phase. */
  pick(userId: string, input: { faction?: FactionId; sabotage?: string | null; ready?: boolean }): Result {
    const color = this.colorOf(userId);
    if (!color) return { ok: false, error: 'not_a_player' };
    if (this.status !== 'picking') return { ok: false, error: 'draft_over' };
    const p = this.picks[color];
    if (input.faction !== undefined) {
      if (!this.allowedFactions(color).includes(input.faction)) return { ok: false, error: 'army_not_allowed' };
      p.faction = input.faction;
    }
    if (input.sabotage !== undefined) {
      if (input.sabotage !== null && (!this.sabotageOn || !SABOTAGE_IDS.includes(input.sabotage))) return { ok: false, error: 'bad_sabotage' };
      p.sabotage = input.sabotage;
    }
    if (input.ready !== undefined) p.ready = input.ready;
    if (this.picks.w.ready && this.picks.b.ready) this.finalizePicks();
    else this.sendStates();
    return { ok: true };
  }

  /** Lock the draft: swap in the chosen armies, rebuild the engine, arm sabotage, start the countdown. */
  private finalizePicks() {
    if (this.status !== 'picking') return;
    if (this.pickTimer) { clearTimeout(this.pickTimer); this.pickTimer = null; }
    for (const c of ['w', 'b'] as Color[]) {
      const init = this.players_init(c);
      const faction = this.picks[c].faction;
      const army = faction === init.faction ? init.army : undefined;
      this.players[c] = { ...this.players[c], faction, army };
    }
    const war = this.sabotageOn
      ? { w: abilityFaction({ ...this.opts.white, faction: this.players.w.faction, army: this.players.w.army }), b: abilityFaction({ ...this.opts.black, faction: this.players.b.faction, army: this.players.b.army }) }
      : null;
    this.engine = createEngine(this.opts.mode, { war });
    if (war && this.engine.kind === 'chess') {
      for (const c of ['w', 'b'] as Color[]) if (this.picks[c].sabotage) this.engine.armSabotage(c, this.picks[c].sabotage!);
    }
    this.status = 'countdown';
    this.startsAt = Date.now() + 3000;
    this.clocks.since = this.startsAt;
    this.startTimer = setTimeout(() => this.begin(), 3000);
    this.sendStates();
    this.hooks.onChange(this);
  }

  /** Full state to both players and spectators (army changes need a full reload). */
  private sendStates() {
    for (const c of ['w', 'b'] as Color[]) if (!this.players[c].bot) this.hub.emitUser(this.players[c].id, 'match:state', this.stateFor(this.players[c].id));
    this.hub.emitRoom(spectatorRoom(this.id), 'match:state', this.stateFor(null));
  }
  get ply() { return this.engine.ply; }
  colorOf(userId: string): Color | null {
    if (this.players.w.id === userId) return 'w';
    if (this.players.b.id === userId) return 'b';
    return null;
  }

  private begin() {
    if (this.status !== 'countdown') return;
    this.status = 'playing';
    if (this.timed) {
      this.clocks.running = 'w';
      this.clocks.since = Date.now();
    }
    if (this.engine.kind === 'arcade') {
      const eng = this.engine;
      this.arcadeEndsAt = Date.now() + ARCADE_DURATION;
      this.arcadeTimer = setTimeout(() => { if (this.status === 'playing') this.finish(eng.decideOnTime()); }, ARCADE_DURATION);
    } else this.scheduleFlag();
    this.broadcast();
    this.hooks.onChange(this);
  }

  // ------------------------------------------------------------------ clocks
  /** Time left for `c` right now, honouring grace periods. */
  timeLeft(c: Color, now = Date.now()): number {
    if (!this.timed) return Infinity;
    if (this.clocks.running !== c) return this.clocks[c];
    const startCounting = Math.max(this.clocks.since, this.clocks.graceUntil);
    return this.clocks[c] - Math.max(0, now - startCounting);
  }

  private scheduleFlag() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    this.flagTimer = null;
    if (this.status !== 'playing') return;
    // Abort if white never makes a first move.
    if (this.engine.ply === 0) {
      this.flagTimer = setTimeout(() => this.finish({ winner: null, reason: 'aborted' }), MATCH_RULES.firstMoveTimeoutMs);
      return;
    }
    if (!this.timed || !this.clocks.running) return;
    const c = this.clocks.running;
    this.flagTimer = setTimeout(() => this.checkFlag(), Math.max(50, this.timeLeft(c) + 30));
  }

  private checkFlag() {
    const c = this.clocks.running;
    if (!c || this.status !== 'playing') return;
    if (this.timeLeft(c) > 0) { this.scheduleFlag(); return; }
    this.clocks[c] = 0;
    // Timeout vs insufficient mating material is a draw.
    const opp = other(c);
    const draw = !hasMatingMaterial(this.engine, opp);
    this.finish({ winner: draw ? null : opp, reason: 'timeout' });
  }

  /** Switch clocks after a completed turn. `graceMs` keeps capture animations off the clock. */
  private passTurn(mover: Color, graceMs: number) {
    const now = Date.now();
    if (this.timed && this.engine.ply > 1) {
      this.clocks[mover] = this.timeLeft(mover, now) + this.opts.timeControl.incrementSec * 1000;
    }
    if (this.timed) {
      this.clocks.running = other(mover);
      this.clocks.since = now;
      this.clocks.graceUntil = now + graceMs;
    }
    this.drawOffer = this.drawOffer === mover ? this.drawOffer : null;
  }

  /** Same player continues (multi-jump): bank elapsed time, keep their clock running after the fight. */
  private continueTurn(color: Color, graceMs: number) {
    if (!this.timed) return;
    const now = Date.now();
    this.clocks[color] = this.timeLeft(color, now);
    this.clocks.since = now;
    this.clocks.graceUntil = now + graceMs;
  }

  // ------------------------------------------------------------------ intents
  move(userId: string, input: { from: Square; to: Square; promotion?: PieceType; ply: number }): Result<MoveRecord> {
    const color = this.colorOf(userId);
    if (!color) return { ok: false, error: 'not_a_player' };
    if (this.status !== 'playing') return { ok: false, error: this.status === 'countdown' || this.status === 'picking' ? 'not_started' : 'game_over' };
    const realTime = this.engine.kind === 'arcade';
    if (!realTime && this.engine.turn() !== color) return { ok: false, error: 'not_your_turn' };
    if (!realTime && input.ply !== this.engine.ply) return { ok: false, error: 'stale_ply' }; // duplicate / out-of-order submission
    if (this.timed && this.timeLeft(color) <= 0) { this.checkFlag(); return { ok: false, error: 'flagged' }; }

    const out = this.engine.move({ from: input.from, to: input.to, promotion: input.promotion, color });
    if (!out.ok) return out;
    const record = out.record;
    let grace = 0;
    if (record.captured) {
      const resolved = this.resolveCombat(color, record);
      record.combatId = resolved.key;
      grace = resolved.graceMs;
    }
    if ((out.events as AbilityEventDTO[]).some((e) => e.type === 'mine_detonated')) grace = Math.max(grace, 1800);
    // Checkers multi-jump: the same player keeps the move (and the clock) until the chain ends.
    if (realTime) { /* no turns, no clocks */ }
    else if (this.engine.turn() === color && !this.engine.result) this.continueTurn(color, grace);
    else this.passTurn(color, grace);
    this.afterPly(record, out.events as AbilityEventDTO[]);
    return { ok: true, data: record };
  }

  ability(userId: string, input: { abilityId: string; target?: Square; target2?: Square; ply: number }): Result {
    const color = this.colorOf(userId);
    if (!color) return { ok: false, error: 'not_a_player' };
    if (this.status !== 'playing') return { ok: false, error: 'not_playing' };
    if (input.ply !== this.engine.ply) return { ok: false, error: 'stale_ply' };
    const out = this.engine.useAbility(color, input);
    if (!out.ok) return out;
    if (out.record) {
      out.record.ability = input.abilityId;
      this.passTurn(color, 1500);
      this.afterPly(out.record, out.events as AbilityEventDTO[]);
    } else {
      this.broadcast(undefined, out.events as AbilityEventDTO[]);
      this.persistSoon();
    }
    return { ok: true };
  }

  private afterPly(record: MoveRecord, events: AbilityEventDTO[]) {
    if (this.engine.result) {
      this.broadcast(record, events);
      this.finish(this.engine.result, true);
      return;
    }
    this.scheduleFlag();
    this.broadcast(record, events);
    this.persistSoon();
    this.hooks.onChange(this);
  }

  resign(userId: string): Result {
    const color = this.colorOf(userId);
    if (!color) return { ok: false, error: 'not_a_player' };
    if (this.status === 'ended') return { ok: false, error: 'game_over' };
    if (this.status === 'picking' || this.status === 'countdown' || this.engine.ply < 2) this.finish({ winner: null, reason: 'aborted' });
    else this.finish({ winner: other(color), reason: 'resign' });
    return { ok: true };
  }

  draw(userId: string, action: 'offer' | 'accept' | 'decline'): Result {
    const color = this.colorOf(userId);
    if (!color || this.status !== 'playing') return { ok: false, error: 'not_allowed' };
    if (action === 'offer') { if (this.drawOffer) return { ok: false, error: 'pending' }; this.drawOffer = color; }
    else if (action === 'accept') {
      if (this.drawOffer !== other(color)) return { ok: false, error: 'no_offer' };
      this.finish({ winner: null, reason: 'agreement' });
      return { ok: true };
    } else { if (this.drawOffer !== other(color)) return { ok: false, error: 'no_offer' }; this.drawOffer = null; }
    this.broadcast();
    return { ok: true };
  }

  rematch(userId: string): Result {
    const color = this.colorOf(userId);
    if (!color || this.status !== 'ended') return { ok: false, error: 'not_allowed' };
    if (Date.now() - this.endedAt > MATCH_RULES.rematchWindowMs) return { ok: false, error: 'expired' };
    if (this.opts.mode === 'kotb') return { ok: false, error: 'kotb_no_rematch' };
    this.rematchOffers.add(color);
    if (this.rematchOffers.size === 2 || this.players[other(color)].bot) this.hooks.onRematch(this);
    else this.broadcast();
    return { ok: true };
  }

  setConnected(userId: string, connected: boolean) {
    const color = this.colorOf(userId);
    if (!color || this.players[color].bot) return;
    if (this.players[color].connected === connected) return;
    this.players[color].connected = connected;
    const t = this.abandonTimers.get(color);
    if (t) { clearTimeout(t); this.abandonTimers.delete(color); }
    if (!connected && this.status !== 'ended') {
      // Reconnect grace: the clock keeps running, but the game is only forfeited after the grace period.
      this.abandonTimers.set(color, setTimeout(() => {
        if (this.players[color].connected || this.status === 'ended') return;
        this.finish(this.engine.ply < 2 ? { winner: null, reason: 'aborted' } : { winner: other(color), reason: 'abandon' });
      }, MATCH_RULES.reconnectGraceMs));
    }
    this.broadcast();
  }

  addSpectator(userId: string) {
    this.spectators.add(userId);
    this.hub.joinRoom(userId, spectatorRoom(this.id));
    this.hub.emitUser(userId, 'match:state', this.stateFor(userId));
    this.broadcast();
  }
  removeSpectator(userId: string) {
    if (!this.spectators.delete(userId)) return;
    this.hub.leaveRoom(userId, spectatorRoom(this.id));
    this.broadcast();
  }

  /** End the game (idempotent). */
  finish(result: GameResult, alreadyBroadcast = false) {
    if (this.status === 'ended') return;
    if (this.timed && this.clocks.running) this.clocks[this.clocks.running] = Math.max(0, this.timeLeft(this.clocks.running));
    this.clocks.running = null;
    this.engine.setResult(result);
    this.status = 'ended';
    this.endedAt = Date.now();
    this.drawOffer = null;
    this.clearTimers();
    if (!alreadyBroadcast) this.broadcast();
    else this.broadcast(undefined, undefined, true);
    this.hooks.onEnd(this);
  }

  private clearTimers() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.pickTimer) clearTimeout(this.pickTimer);
    if (this.arcadeTimer) clearTimeout(this.arcadeTimer);
    for (const t of this.abandonTimers.values()) clearTimeout(t);
    this.abandonTimers.clear();
    this.flagTimer = this.startTimer = null;
  }

  dispose() {
    this.clearTimers();
    for (const s of this.spectators) this.hub.leaveRoom(s, spectatorRoom(this.id));
  }

  // ------------------------------------------------------------------ combat (for clock grace + replays)
  private resolveCombat(color: Color, rec: MoveRecord): { key: string; graceMs: number } {
    try {
      const atk = this.players[color], def = this.players[other(color)];
      const attackerClass = PIECE_KEYS[rec.piece];
      const defenderClass = PIECE_KEYS[rec.captured!];
      const r = defaultCombatRegistry.resolve({
        attackerClass, defenderClass, attackerFaction: atk.faction, defenderFaction: def.faction,
        finisherId: atk.finishers[attackerClass], attackerRig: rigOf(atk, attackerClass), defenderRig: rigOf(def, defenderClass),
        defenderDeaths: deathsOf(def, defenderClass), seed: rec.ply,
      });
      return { key: r.matchedKey, graceMs: Math.min(4500, Math.max(1500, r.sequence.duration * 1000 + 300)) };
    } catch {
      return { key: 'base_capture', graceMs: MATCH_RULES.captureGraceMs };
    }
  }

  // ------------------------------------------------------------------ views
  stateFor(userId: string | null): MatchState {
    const color = userId ? this.colorOf(userId) : null;
    return {
      id: this.id, arenaId: this.opts.arenaId, mode: this.opts.mode, ranked: this.opts.ranked, timeControl: this.opts.timeControl,
      abilityVisibility: this.opts.abilityVisibility, players: this.players, fen: this.engine.fen(), history: this.engine.history,
      clocks: this.clockView(), status: this.status, startsAt: this.startsAt, result: this.engine.result, youAre: color ?? 'spectator',
      spectators: this.spectators.size, abilityView: this.engine.abilityView(color ?? 'spectator', this.opts.abilityVisibility),
      drawOffer: this.drawOffer, rematchOffers: [...this.rematchOffers], serverNow: Date.now(), arcadeEndsAt: this.arcadeEndsAt || undefined,
      pick: this.status === 'picking' ? {
        endsAt: this.pickEndsAt, mine: color ? this.picks[color] : null, opponentReady: color ? this.picks[other(color)].ready : this.picks.w.ready && this.picks.b.ready,
        sabotage: this.sabotageOn, allowed: color ? this.allowedFactions(color) : [],
      } : undefined,
    };
  }

  private clockView(): ClockState {
    return { ...this.clocks, w: Number.isFinite(this.clocks.w) ? this.clocks.w : 0, b: Number.isFinite(this.clocks.b) ? this.clocks.b : 0 };
  }

  private updateFor(viewer: Color | 'spectator', move?: MoveRecord, events?: AbilityEventDTO[]): MatchUpdate {
    // Hidden-information filter: never leak hidden ability events (mine placement) to the opponent/spectators.
    const visibleEvents = events?.filter((e) => {
      if (viewer === e.color) return true;
      if (e.type === 'ability_used') return !isHiddenAbility(e.abilityId);
      // Passive triggers are private intel (Dead Man's Intel, Momentum) — owners only.
      if (e.type === 'ability_triggered') return false;
      return true;
    });
    return {
      matchId: this.id, ply: this.engine.ply, move, abilityEvents: visibleEvents, fen: this.engine.fen(), clocks: this.clockView(), status: this.status,
      result: this.engine.result, abilityView: this.engine.abilityView(viewer, this.opts.abilityVisibility), drawOffer: this.drawOffer,
      rematchOffers: [...this.rematchOffers], players: this.players, spectators: this.spectators.size, serverNow: Date.now(), arcadeEndsAt: this.arcadeEndsAt || undefined,
    };
  }

  broadcast(move?: MoveRecord, events?: AbilityEventDTO[], _final = false) {
    for (const c of ['w', 'b'] as Color[]) {
      if (!this.players[c].bot) this.hub.emitUser(this.players[c].id, 'match:update', this.updateFor(c, move, events));
    }
    this.hub.emitRoom(spectatorRoom(this.id), 'match:update', this.updateFor('spectator', move, events));
  }

  // ------------------------------------------------------------------ persistence
  private persistTimer: NodeJS.Timeout | null = null;
  persistHandler: ((m: Match) => void) | null = null;
  private persistSoon() {
    if (this.persistTimer || !this.persistHandler) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persistHandler?.(this); }, 500);
  }
}

function pick(p: PlayerInit): Omit<MatchPlayer, 'connected'> {
  return { id: p.id, name: p.name, avatar: p.avatar, rating: p.rating, faction: p.faction, finishers: p.finishers, bot: p.bot, army: p.army };
}

function abilityFaction(p: PlayerInit): BuiltinFactionId {
  if (isBuiltinFaction(p.faction)) return p.faction;
  return p.army?.doctrine ?? 'remnants';
}

function rigOf(p: MatchPlayer, pc: PieceClass): RigType {
  if (isBuiltinFaction(p.faction)) return FACTIONS[p.faction].pieces[pc].rig;
  return p.army?.pieces[pc]?.rig ?? 'static';
}
function deathsOf(p: MatchPlayer, pc: PieceClass): DeathTypeId[] {
  if (isBuiltinFaction(p.faction)) return FACTIONS[p.faction].pieces[pc].deaths;
  return p.army?.pieces[pc]?.deaths ?? ['light_death'];
}

function isHiddenAbility(id: string) {
  return id === 'wl_mine';
}

function hasMatingMaterial(e: RulesEngine, c: Color): boolean {
  if (e.kind === 'checkers') return true;
  let minors = 0;
  for (const row of e.board()) for (const p of row) {
    if (!p || p.color !== c || p.type === 'k') continue;
    if (p.type === 'n' || p.type === 'b') minors++;
    else return true;
  }
  return minors >= 2;
}

export { START_FEN };
