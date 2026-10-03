// ChessEngine — the single source of chess truth, used authoritatively by the
// server and locally by the client (practice/AI/local games, previews).
// chess.js provides move generation and check/mate detection; this wrapper
// adds our own history, repetition tracking, and the War Chess AbilitySystem
// (restrictions, board edits, hidden information).

import { Chess, type Move } from 'chess.js';
import type { BoardEffect, BuiltinFactionId, Color, GameResult, MoveRecord, PieceType, Square, AbilityVisibility } from '../types.js';
import { PIECE_KEYS, PIECE_NAMES } from '../types.js';
import { ABILITIES_BY_ID, AIRSTRIKE, KILLSTREAK, SABOTAGE_IDS, abilitiesFor, type AbilityDef } from '../game-data/abilities.js';
import { ALL_SQUARES, area, chebyshev, fileOf, onBoard, other, rankOf, sq } from './squares.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type EffectKind = 'shield' | 'freeze' | 'no_capture' | 'mine' | 'mark' | 'threats' | 'neural';

export interface ActiveEffect {
  id: string;
  kind: EffectKind;
  owner: Color;
  source: string;
  squares: Square[];
  /** Effect is removed once the game's ply count reaches this value. */
  expiresAtPly: number;
  /** Hidden from the opponent (mines). */
  hidden?: boolean;
  /** Squares follow the piece when it moves. */
  follows?: boolean;
}

export interface SideAbility {
  id: string;
  charges: number;
  cooldownUntilPly: number;
  /** Known to the opponent (matters in SECRET visibility). */
  revealed: boolean;
  uses: number;
}

export interface MoveInput { from: Square; to: Square; promotion?: PieceType }
export interface AbilityInput { abilityId: string; target?: Square; target2?: Square }

export interface MoveOutcome {
  ok: true;
  record: MoveRecord;
  /** Ability-driven events to animate and announce. */
  events: AbilityEvent[];
}
export interface Failure { ok: false; error: string }

export type AbilityEvent =
  | { type: 'ability_used'; color: Color; abilityId: string; target?: Square; target2?: Square }
  | { type: 'ability_triggered'; color: Color; abilityId: string; square?: Square }
  | { type: 'mine_detonated'; color: Color; square: Square; victim: PieceType }
  | { type: 'ability_revealed'; color: Color; abilityId: string };

export interface AbilitySideView {
  id: string;
  charges: number;
  cooldown: number;
  usable: boolean;
  revealed: boolean;
}
export interface AbilityView {
  faction: Record<Color, BuiltinFactionId | null>;
  own: AbilitySideView[];
  /** Opponent's abilities as this viewer is allowed to see them; null id = hidden. */
  enemy: { id: string | null; charges?: number; revealed: boolean }[];
  effects: ActiveEffect[];
}

export interface EngineSnapshot {
  kind?: 'chess';
  fen: string;
  ply: number;
  history: MoveRecord[];
  positions: [string, number][];
  war: { w: BuiltinFactionId; b: BuiltinFactionId } | null;
  abilities: Record<Color, SideAbility[]> | null;
  effects: ActiveEffect[];
  freeActionPly: Record<Color, number>;
  result: GameResult | null;
  effectSeq: number;
  streak?: Record<Color, number>;
}

export class ChessEngine {
  readonly kind = 'chess' as const;
  readonly chess: Chess;
  ply = 0;
  history: MoveRecord[] = [];
  result: GameResult | null = null;
  war: { w: BuiltinFactionId; b: BuiltinFactionId } | null;
  abilities: Record<Color, SideAbility[]> | null = null;
  effects: ActiveEffect[] = [];
  private positions = new Map<string, number>();
  private freeActionPly: Record<Color, number> = { w: -1, b: -1 };
  private effectSeq = 0;
  /** Consecutive captures without the enemy capturing (killstreaks). */
  streak: Record<Color, number> = { w: 0, b: 0 };

  constructor(opts: { fen?: string; war?: { w: BuiltinFactionId; b: BuiltinFactionId } | null } = {}) {
    this.chess = new Chess(opts.fen ?? START_FEN);
    this.war = opts.war ?? null;
    if (this.war) {
      this.abilities = {
        w: abilitiesFor(this.war.w).map((a) => ({ id: a.id, charges: a.charges, cooldownUntilPly: 0, revealed: false, uses: 0 })),
        b: abilitiesFor(this.war.b).map((a) => ({ id: a.id, charges: a.charges, cooldownUntilPly: 0, revealed: false, uses: 0 })),
      };
      // Every War Chess side can earn airstrikes (starts empty; filled by killstreaks).
      for (const c of ['w', 'b'] as Color[]) this.abilities[c].push({ id: AIRSTRIKE.id, charges: 0, cooldownUntilPly: 0, revealed: false, uses: 0 });
    }
    this.countPosition();
  }

  // ------------------------------------------------------------------ queries
  fen() { return this.chess.fen(); }
  turn(): Color { return this.chess.turn(); }
  inCheck() { return this.chess.inCheck(); }
  get(square: Square) { return this.chess.get(square); }
  board() { return this.chess.board(); }
  isOver() { return this.result !== null; }
  isCheckmate() { return this.chess.isCheckmate(); }

  kingSquare(color: Color): Square | undefined {
    return this.chess.findPiece({ type: 'k', color })[0] as Square | undefined;
  }

  /** Squares attacked by `by` (used for threat overlays). */
  attackedSquares(by: Color): Square[] {
    return ALL_SQUARES.filter((s) => this.chess.isAttacked(s, by));
  }

  /** Legal moves for the side to move, after War Chess restrictions. */
  legalMoves(square?: Square): Move[] {
    const all = (square ? this.chess.moves({ verbose: true, square }) : this.chess.moves({ verbose: true })) as Move[];
    if (!this.war || this.result) return this.result ? [] : all;
    const mover = this.turn();
    // Restrictions never apply to a side in check, and never remove every legal move.
    if (this.chess.inCheck()) return all;
    const filtered = all.filter((m) => this.allowedByRestrictions(m, mover));
    if (square) {
      const anyLeft = this.chess.moves({ verbose: true }).some((m) => this.allowedByRestrictions(m as Move, mover));
      return anyLeft ? filtered : all;
    }
    return filtered.length ? filtered : all;
  }

  private allowedByRestrictions(m: Move, mover: Color): boolean {
    const enemy = other(mover);
    for (const e of this.effects) {
      if (e.owner !== enemy) continue;
      if (e.kind === 'freeze' && e.squares.includes(m.from as Square)) return false;
      if (m.captured) {
        const capSq = (m.flags.includes('e') ? `${m.to[0]}${m.from[1]}` : m.to) as Square;
        if (e.kind === 'shield' && e.squares.includes(capSq)) return false;
        if (e.kind === 'no_capture' && (e.squares.includes(capSq) || e.squares.includes(m.to as Square))) return false;
      }
    }
    if (m.captured === 'p' && m.piece === 'p' && this.sideHas(enemy, 'mac_bulwark')) {
      const capSq = (m.flags.includes('e') ? `${m.to[0]}${m.from[1]}` : m.to) as Square;
      if (this.pawnChained(capSq, enemy)) return false;
    }
    return true;
  }

  private pawnChained(s: Square, color: Color): boolean {
    const f = fileOf(s), r = rankOf(s);
    for (const df of [-1, 1]) {
      if (!onBoard(f + df, r)) continue;
      const p = this.chess.get(sq(f + df, r));
      if (p && p.type === 'p' && p.color === color) return true;
    }
    return false;
  }

  private sideHas(color: Color, abilityId: string) {
    return !!this.abilities?.[color].some((a) => a.id === abilityId);
  }

  // ------------------------------------------------------------------ moves
  move(input: MoveInput, at = Date.now()): MoveOutcome | Failure {
    if (this.result) return { ok: false, error: 'game_over' };
    const legal = this.legalMoves(input.from).find((m) => m.to === input.to && (!m.promotion || m.promotion === (input.promotion ?? 'q')));
    if (!legal) return { ok: false, error: 'illegal_move' };
    const mover = this.turn();
    const preMoveBulwarkBlocks = this.bulwarkWouldBlockFor(mover);
    const mv = this.chess.move({ from: input.from, to: input.to, promotion: legal.promotion ? (input.promotion ?? 'q') : undefined });
    this.ply++;
    const events: AbilityEvent[] = [];
    const effectsApplied: BoardEffect[] = [];

    if (this.war) {
      if (preMoveBulwarkBlocks) this.reveal(other(mover), 'mac_bulwark', events);
      // Square-bound effects follow their piece.
      for (const e of this.effects) if (e.follows) e.squares = e.squares.map((s) => (s === mv.from ? (mv.to as Square) : s));
      if (mv.captured) { this.onCapture(mover, mv.to as Square, events); this.countStreak(mover, events); }
      this.checkMines(mover, mv.to as Square, mv.piece as PieceType, events, effectsApplied);
      this.onEnemyMove(mover, mv.to as Square);
      this.expireEffects();
    }

    const record: MoveRecord = {
      ply: this.ply, san: mv.san, from: mv.from as Square, to: mv.to as Square, color: mover,
      piece: mv.piece as PieceType, captured: mv.captured as PieceType | undefined, promotion: mv.promotion as PieceType | undefined,
      flags: mv.flags, fenAfter: this.chess.fen(), at, effects: effectsApplied.length ? effectsApplied : undefined,
    };
    this.history.push(record);
    this.countPosition();
    this.evaluateResult();
    return { ok: true, record, events };
  }

  private bulwarkWouldBlockFor(mover: Color): boolean {
    const enemy = other(mover);
    if (!this.sideHas(enemy, 'mac_bulwark') || this.chess.inCheck()) return false;
    return (this.chess.moves({ verbose: true }) as Move[]).some((m) => m.captured === 'p' && m.piece === 'p' && this.pawnChained(m.to as Square, enemy));
  }

  private onCapture(capturer: Color, at: Square, events: AbilityEvent[]) {
    const victim = other(capturer);
    // Victim passive: Dead Man's Intel.
    const intel = this.abilities?.[victim].find((a) => ABILITIES_BY_ID[a.id].effect.type === 'mark_attacker');
    if (intel) {
      const def = ABILITIES_BY_ID[intel.id];
      this.addEffect({ kind: 'mark', owner: victim, source: intel.id, squares: [at], expiresAtPly: this.ply + 2 * (def.effect.duration ?? 2), follows: true, hidden: true });
      intel.uses++;
      events.push({ type: 'ability_triggered', color: victim, abilityId: intel.id, square: at });
    }
    // Capturer passive: grant charges (Raider's Momentum).
    for (const a of this.abilities?.[capturer] ?? []) {
      const def = ABILITIES_BY_ID[a.id];
      if (def.trigger !== 'on_capture' || def.effect.type !== 'grant_charge' || !def.effect.grants) continue;
      const target = this.abilities![capturer].find((x) => x.id === def.effect.grants);
      const tdef = ABILITIES_BY_ID[def.effect.grants];
      if (target && target.charges < (tdef.maxCharges ?? tdef.charges)) {
        target.charges++;
        a.uses++;
        events.push({ type: 'ability_triggered', color: capturer, abilityId: a.id });
      }
    }
  }

  /** Killstreaks: KILLSTREAK captures in a row (no enemy capture in between) earn an airstrike. */
  private countStreak(capturer: Color, events: AbilityEvent[]) {
    this.streak[capturer]++;
    this.streak[other(capturer)] = 0;
    if (this.streak[capturer] < KILLSTREAK) return;
    this.streak[capturer] = 0;
    const a = this.abilities?.[capturer].find((x) => x.id === AIRSTRIKE.id);
    if (a && a.charges < (AIRSTRIKE.maxCharges ?? 1)) {
      a.charges++;
      events.push({ type: 'ability_triggered', color: capturer, abilityId: AIRSTRIKE.id });
    }
  }

  /**
   * Arm a pre-game sabotage card for `color` (War Chess). Active cards become
   * usable abilities; passive ones take effect immediately. `rnd` makes the
   * random picks deterministic for a given seed.
   */
  armSabotage(color: Color, id: string, rnd: () => number = Math.random): boolean {
    if (!this.war || !this.abilities || !SABOTAGE_IDS.includes(id) || this.ply > 0) return false;
    if (this.abilities[color].some((a) => SABOTAGE_IDS.includes(a.id))) return false;
    const def = ABILITIES_BY_ID[id];
    const enemy = other(color);
    this.abilities[color].push({ id, charges: def.charges, cooldownUntilPly: 0, revealed: false, uses: 0 });
    if (id === 'sab_saboteur') {
      const pool = this.piecesOf(enemy).filter((p) => p.type === 'n' || p.type === 'b' || p.type === 'r').map((p) => p.square);
      const picks: Square[] = [];
      while (picks.length < 2 && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
      if (picks.length) this.addEffect({ kind: 'freeze', owner: color, source: id, squares: picks, expiresAtPly: 6 + (enemy === 'b' ? 1 : 0), follows: true });
    } else if (id === 'sab_jammer') {
      for (const a of this.abilities[enemy]) if (ABILITIES_BY_ID[a.id].kind === 'active' && a.id !== AIRSTRIKE.id) a.cooldownUntilPly = Math.max(a.cooldownUntilPly, 8);
    }
    return true;
  }

  private onEnemyMove(mover: Color, to: Square) {
    const watcher = other(mover);
    const link = this.abilities?.[watcher].find((a) => ABILITIES_BY_ID[a.id].effect.type === 'neural_link');
    if (!link) return;
    this.effects = this.effects.filter((e) => !(e.kind === 'neural' && e.owner === watcher));
    this.addEffect({ kind: 'neural', owner: watcher, source: link.id, squares: [to], expiresAtPly: this.ply + 1, follows: true, hidden: true });
    link.uses++;
  }

  private checkMines(mover: Color, to: Square, piece: PieceType, events: AbilityEvent[], applied: BoardEffect[]) {
    if (piece === 'k') return;
    const landed = this.chess.get(to);
    if (!landed) return;
    const mine = this.effects.find((e) => e.kind === 'mine' && e.owner !== mover && e.squares.includes(to));
    if (!mine) return;
    if (!this.applyEdits([{ type: 'remove', square: to, cause: mine.source }], false)) return; // would create an illegal position: mine fizzles
    this.effects = this.effects.filter((e) => e !== mine);
    applied.push({ type: 'remove', square: to, cause: mine.source });
    events.push({ type: 'mine_detonated', color: mine.owner, square: to, victim: landed.type as PieceType });
    this.reveal(mine.owner, mine.source, events);
    this.reveal(mine.owner, 'wl_momentum', events);
  }

  private expireEffects() {
    this.effects = this.effects.filter((e) => e.expiresAtPly > this.ply);
  }

  private addEffect(e: Omit<ActiveEffect, 'id'>) {
    this.effects.push({ ...e, id: `fx${++this.effectSeq}` });
  }

  private reveal(color: Color, abilityId: string, events: AbilityEvent[]) {
    const a = this.abilities?.[color].find((x) => x.id === abilityId);
    if (a && !a.revealed) { a.revealed = true; events.push({ type: 'ability_revealed', color, abilityId }); }
  }

  // ------------------------------------------------------------------ abilities
  abilityDefs(color: Color): AbilityDef[] {
    return (this.abilities?.[color] ?? []).map((a) => ABILITIES_BY_ID[a.id]);
  }

  /** Why an ability cannot be used right now, or null if it can. */
  abilityBlocker(color: Color, abilityId: string): string | null {
    if (!this.war || !this.abilities) return 'abilities_disabled';
    if (this.result) return 'game_over';
    if (this.turn() !== color) return 'not_your_turn';
    const state = this.abilities[color].find((a) => a.id === abilityId);
    if (!state) return 'unknown_ability';
    const def = ABILITIES_BY_ID[abilityId];
    if (def.kind !== 'active') return 'passive';
    if (state.charges <= 0) return 'no_charges';
    if (this.ply < state.cooldownUntilPly) return 'cooldown';
    if (this.freeActionPly[color] === this.ply) return 'already_used_this_turn';
    if (def.pieceClass && !this.piecesOf(color).some((p) => PIECE_KEYS[p.type] === def.pieceClass)) return 'requires_piece';
    if (def.target.kind !== 'none' && this.abilityTargets(color, abilityId).length === 0) return 'no_targets';
    return null;
  }

  private piecesOf(color: Color) {
    const out: { square: Square; type: PieceType }[] = [];
    for (const row of this.chess.board()) for (const p of row) if (p && p.color === color) out.push({ square: p.square as Square, type: p.type as PieceType });
    return out;
  }

  /** Valid targets for an ability. For two-step targets pass the first pick to get the second step. */
  abilityTargets(color: Color, abilityId: string, first?: Square): Square[] {
    const def = ABILITIES_BY_ID[abilityId];
    if (!def) return [];
    const t = def.target;
    const enemy = other(color);
    const anchors = t.anchor ? this.piecesOf(color).filter((p) => PIECE_KEYS[p.type] === t.anchor).map((p) => p.square) : [];
    const inRange = (s: Square) => {
      if (!t.anchor || !t.range) return true;
      return anchors.some((a) => chebyshev(a, s) <= t.range!);
    };
    const classOk = (s: Square) => {
      const p = this.chess.get(s);
      if (!p) return true;
      const pc = PIECE_KEYS[p.type as PieceType];
      if (t.excludeClasses?.includes(pc)) return false;
      if (t.onlyClasses && !t.onlyClasses.includes(pc)) return false;
      return true;
    };
    const rankOk = (s: Square) => {
      if (!t.ranks) return true;
      const r = rankOf(s) + 1;
      return t.ranks.includes(r);
    };
    const los = t.lineOfSight ? this.lineOfSightSquares(anchors, t.lineOfSight, t.range ?? 8) : null;

    switch (t.kind) {
      case 'none': return [];
      case 'own_piece':
        return this.piecesOf(color).map((p) => p.square).filter((s) => classOk(s) && inRange(s));
      case 'enemy_piece':
        return this.piecesOf(enemy).map((p) => p.square).filter((s) => classOk(s) && (los ? los.has(s) : inRange(s)));
      case 'empty_square':
        return ALL_SQUARES.filter((s) => !this.chess.get(s) && rankOk(s) && inRange(s) && !this.effects.some((e) => e.kind === 'mine' && e.squares.includes(s)));
      case 'any_square':
        return ALL_SQUARES.filter((s) => (los ? los.has(s) : inRange(s)));
      case 'own_then_empty': {
        if (!first) return this.piecesOf(color).map((p) => p.square).filter((s) => classOk(s) && this.relocations(color, s, t.range ?? 2).length > 0);
        return this.relocations(color, first, t.range ?? 2);
      }
      case 'own_pair': {
        const own = this.piecesOf(color).filter((p) => p.type !== 'k').map((p) => p.square);
        if (!first) return own.filter(classOk);
        return own.filter((s) => s !== first && chebyshev(s, first) <= (t.range ?? 2) && this.swapValid(color, first, s));
      }
    }
  }

  private lineOfSightSquares(anchors: Square[], mode: 'orthogonal' | 'diagonal', range: number): Set<Square> {
    const dirs = mode === 'orthogonal' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const out = new Set<Square>();
    for (const a of anchors) for (const [df, dr] of dirs) {
      let f = fileOf(a) + df, r = rankOf(a) + dr, steps = 1;
      while (onBoard(f, r) && steps <= range) {
        const s = sq(f, r);
        out.add(s);
        if (this.chess.get(s)) break;
        f += df; r += dr; steps++;
      }
    }
    return out;
  }

  private relocations(color: Color, from: Square, range: number): Square[] {
    return ALL_SQUARES.filter((s) => !this.chess.get(s) && chebyshev(s, from) <= range && this.editIsLegal([{ type: 'relocate', from, to: s, cause: '' }], true, color));
  }

  private swapValid(color: Color, a: Square, b: Square) {
    const pa = this.chess.get(a), pb = this.chess.get(b);
    const backRank = (s: Square) => rankOf(s) === 0 || rankOf(s) === 7;
    if ((pa?.type === 'p' && backRank(b)) || (pb?.type === 'p' && backRank(a))) return false;
    return this.editIsLegal([{ type: 'swap', a, b, cause: '' }], true, color);
  }

  useAbility(color: Color, input: AbilityInput, at = Date.now()): { ok: true; events: AbilityEvent[]; record?: MoveRecord } | Failure {
    const blocker = this.abilityBlocker(color, input.abilityId);
    if (blocker) return { ok: false, error: blocker };
    const def = ABILITIES_BY_ID[input.abilityId];
    const state = this.abilities![color].find((a) => a.id === input.abilityId)!;
    const t = def.target;
    if (t.kind !== 'none') {
      if (!input.target || !this.abilityTargets(color, def.id).includes(input.target)) return { ok: false, error: 'invalid_target' };
      if ((t.kind === 'own_then_empty' || t.kind === 'own_pair') && (!input.target2 || !this.abilityTargets(color, def.id, input.target).includes(input.target2))) return { ok: false, error: 'invalid_target' };
    }
    const events: AbilityEvent[] = [{ type: 'ability_used', color, abilityId: def.id, target: input.target, target2: input.target2 }];
    const enemy = other(color);
    const dur = def.effect.duration ?? 1;
    const expires = this.ply + 2 * dur;
    const edits: BoardEffect[] = [];

    switch (def.effect.type) {
      case 'reveal_threats': {
        this.addEffect({ kind: 'threats', owner: color, source: def.id, squares: [], expiresAtPly: expires, hidden: true });
        const hidden = this.abilities![enemy].find((a) => !a.revealed);
        if (hidden) this.reveal(enemy, hidden.id, events);
        break;
      }
      case 'no_capture_zone':
        this.addEffect({ kind: 'no_capture', owner: color, source: def.id, squares: area(input.target!, def.effect.radius ?? 1), expiresAtPly: expires });
        break;
      case 'shield_piece':
        this.addEffect({ kind: 'shield', owner: color, source: def.id, squares: [input.target!], expiresAtPly: expires, follows: true });
        break;
      case 'freeze_piece':
        this.addEffect({ kind: 'freeze', owner: color, source: def.id, squares: [input.target!], expiresAtPly: expires });
        break;
      case 'freeze_area':
        this.addEffect({ kind: 'freeze', owner: color, source: def.id, squares: area(input.target!, def.effect.radius ?? 1).filter((s) => this.chess.get(s)?.color === enemy), expiresAtPly: expires });
        break;
      case 'mine':
        this.addEffect({ kind: 'mine', owner: color, source: def.id, squares: [input.target!], expiresAtPly: Number.MAX_SAFE_INTEGER, hidden: true });
        break;
      case 'destroy_enemy_pawn':
        edits.push({ type: 'remove', square: input.target!, cause: def.id });
        break;
      case 'teleport_own':
        edits.push({ type: 'relocate', from: input.target!, to: input.target2!, cause: def.id });
        break;
      case 'swap_own':
        edits.push({ type: 'swap', a: input.target!, b: input.target2!, cause: def.id });
        break;
      case 'airstrike':
        for (const s of area(input.target!, def.effect.radius ?? 1)) {
          const p = this.chess.get(s);
          if (p && p.color === enemy && p.type !== 'k') edits.push({ type: 'remove', square: s, cause: def.id });
        }
        break;
      default:
        return { ok: false, error: 'not_activatable' };
    }

    if (edits.length && !this.applyEdits(edits, def.consumesTurn)) return { ok: false, error: 'illegal_position' };
    if (def.consumesTurn && !edits.length) this.applyEdits([], true);

    state.charges--;
    state.uses++;
    state.cooldownUntilPly = this.ply + 2 * def.cooldown;
    // Mines are covert; everything else announces itself.
    if (!def.effect.hidden) this.reveal(color, def.id, events);

    let record: MoveRecord | undefined;
    if (def.consumesTurn) {
      this.ply++;
      for (const e of this.effects) if (e.follows && edits[0]?.type === 'relocate') e.squares = e.squares.map((s) => (s === (edits[0] as { from: Square }).from ? (edits[0] as { to: Square }).to : s));
      this.onEnemyMove(color, (input.target2 ?? input.target) as Square);
      this.expireEffects();
      const piece = this.chess.get((input.target2 ?? input.target) as Square);
      record = {
        ply: this.ply, san: `⚡${def.name}`, from: input.target as Square, to: (input.target2 ?? input.target) as Square, color,
        piece: (piece?.type ?? 'p') as PieceType, flags: 'A', fenAfter: this.chess.fen(), at, ability: def.id, effects: edits,
      };
      this.history.push(record);
      this.countPosition();
      this.evaluateResult();
    } else {
      this.freeActionPly[color] = this.ply;
    }
    return { ok: true, events, record };
  }

  // ------------------------------------------------------------------ board edits
  private editedFen(edits: BoardEffect[], flipTurn: boolean): string | null {
    const tmp = new Chess(this.chess.fen(), { skipValidation: true });
    for (const e of edits) {
      if (e.type === 'remove') { if (!tmp.remove(e.square)) return null; }
      else if (e.type === 'relocate') {
        const p = tmp.remove(e.from);
        if (!p || tmp.get(e.to)) return null;
        if (!tmp.put(p, e.to)) return null;
      } else if (e.type === 'swap') {
        const pa = tmp.remove(e.a), pb = tmp.remove(e.b);
        if (!pa || !pb) return null;
        tmp.put(pa, e.b); tmp.put(pb, e.a);
      }
    }
    const parts = tmp.fen().split(' ');
    if (flipTurn) {
      const wasBlack = parts[1] === 'b';
      parts[1] = wasBlack ? 'w' : 'b';
      if (wasBlack) parts[5] = String(Number(parts[5]) + 1);
    }
    parts[3] = '-';
    parts[4] = '0';
    return parts.join(' ');
  }

  /** A position is legal if it loads and the side NOT to move is not in check. */
  private fenIsLegal(fen: string): boolean {
    try {
      const c = new Chess(fen);
      if (c.findPiece({ type: 'k', color: 'w' }).length !== 1 || c.findPiece({ type: 'k', color: 'b' }).length !== 1) return false;
      const parts = fen.split(' ');
      parts[1] = parts[1] === 'w' ? 'b' : 'w';
      parts[3] = '-';
      const flipped = new Chess(parts.join(' '), { skipValidation: true });
      return !flipped.inCheck();
    } catch {
      return false;
    }
  }

  private editIsLegal(edits: BoardEffect[], flipTurn: boolean, _color: Color): boolean {
    const fen = this.editedFen(edits, flipTurn);
    return !!fen && this.fenIsLegal(fen);
  }

  private applyEdits(edits: BoardEffect[], flipTurn: boolean): boolean {
    const fen = this.editedFen(edits, flipTurn);
    if (!fen || !this.fenIsLegal(fen)) return false;
    this.chess.load(fen);
    // Mines under relocated/removed squares stay; follow-effects on removed pieces vanish.
    for (const e of edits) {
      if (e.type === 'remove') this.effects = this.effects.filter((x) => !(x.follows && x.squares.includes(e.square)));
    }
    return true;
  }

  // ------------------------------------------------------------------ results
  private positionKey() { return this.chess.fen().split(' ').slice(0, 4).join(' '); }
  private countPosition() {
    const k = this.positionKey();
    this.positions.set(k, (this.positions.get(k) ?? 0) + 1);
  }

  private evaluateResult() {
    if (this.chess.isCheckmate()) { this.result = { winner: other(this.turn()), reason: 'checkmate' }; return; }
    // In War Chess, stalemate is judged on the unrestricted move list (restrictions never stalemate you).
    if (this.chess.isStalemate()) { this.result = { winner: null, reason: 'stalemate' }; return; }
    if (this.chess.isInsufficientMaterial()) { this.result = { winner: null, reason: 'insufficient' }; return; }
    if ((this.positions.get(this.positionKey()) ?? 0) >= 3) { this.result = { winner: null, reason: 'threefold' }; return; }
    if (Number(this.chess.fen().split(' ')[4]) >= 100) { this.result = { winner: null, reason: 'fifty_move' }; return; }
  }

  /** End the game for a non-board reason (resign, timeout, abandon, agreement). */
  setResult(result: GameResult) { if (!this.result) this.result = result; }

  // ------------------------------------------------------------------ views
  abilityView(viewer: Color | 'spectator', visibility: AbilityVisibility): AbilityView | null {
    if (!this.war || !this.abilities) return null;
    const faction = { w: this.war.w, b: this.war.b };
    const mine = viewer === 'spectator' ? [] : this.abilities[viewer];
    const own = mine.map((a) => {
      const def = ABILITIES_BY_ID[a.id];
      return { id: a.id, charges: a.charges, cooldown: Math.max(0, Math.ceil((a.cooldownUntilPly - this.ply) / 2)), usable: def.kind === 'active' && this.abilityBlocker(viewer as Color, a.id) === null, revealed: a.revealed };
    });
    const enemyColor: Color[] = viewer === 'spectator' ? ['w', 'b'] : [other(viewer)];
    const enemy = enemyColor.flatMap((c) => this.abilities![c].map((a) => {
      const visible = visibility === 'visible' || a.revealed;
      return visible ? { id: a.id, charges: a.charges, revealed: a.revealed } : { id: null, revealed: false };
    }));
    const effects = this.effects.filter((e) => (viewer !== 'spectator' && e.owner === viewer) || !e.hidden);
    return { faction, own, enemy, effects };
  }

  // ------------------------------------------------------------------ persistence
  snapshot(): EngineSnapshot {
    return {
      kind: 'chess', fen: this.chess.fen(), ply: this.ply, history: this.history, positions: [...this.positions.entries()],
      war: this.war, abilities: this.abilities, effects: this.effects, freeActionPly: this.freeActionPly, result: this.result, effectSeq: this.effectSeq,
      streak: this.streak,
    };
  }

  static restore(s: EngineSnapshot): ChessEngine {
    const e = new ChessEngine({ fen: s.fen, war: s.war });
    e.ply = s.ply; e.history = s.history; e.positions = new Map(s.positions);
    e.abilities = s.abilities; e.effects = s.effects; e.freeActionPly = s.freeActionPly; e.result = s.result; e.effectSeq = s.effectSeq;
    if (s.streak) e.streak = s.streak;
    return e;
  }

  /** Rebuild a game from a move list (replays, reconnect fallback). */
  static fromHistory(records: MoveRecord[], war: { w: BuiltinFactionId; b: BuiltinFactionId } | null = null): ChessEngine {
    const e = new ChessEngine({ war: null });
    for (const r of records) {
      if (r.flags === 'A') { e.chess.load(r.fenAfter); e.ply++; e.history.push(r); continue; }
      const out = e.move({ from: r.from, to: r.to, promotion: r.promotion }, r.at);
      if (!out.ok) { e.chess.load(r.fenAfter); e.ply++; e.history.push(r); continue; }
      if (r.effects?.length) e.chess.load(r.fenAfter);
    }
    e.war = war;
    return e;
  }
}

export function describePiece(t: PieceType) { return PIECE_NAMES[t]; }
