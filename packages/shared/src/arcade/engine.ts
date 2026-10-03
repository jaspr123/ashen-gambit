// Arcade Chess — real-time chess. There are no turns: either player may move
// any of their pieces whose cooldown has expired. Pieces move like chess
// pieces (no check rules, no castling/en passant; pawns promote to queens),
// and taking the enemy king wins. If neither king falls before the match
// timer runs out, material decides.

import type { Color, GameResult, MoveRecord, PieceType, Square } from '../types.js';
import type { RulesMove } from '../rules.js';
import { fileOf, onBoard, other, rankOf, sq } from '../chess/squares.js';

export const ARCADE_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
/** Cooldown after a piece moves (ms). */
export const ARCADE_COOLDOWN: Record<PieceType, number> = { p: 2000, n: 2500, b: 2500, r: 3000, q: 3500, k: 2000 };
/** Minimum gap between two moves by the same player (anti-spam). */
export const ARCADE_MIN_GAP = 300;
/** Match length before material decides. */
export const ARCADE_DURATION = 5 * 60_000;
const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

interface Piece { type: PieceType; color: Color }

export interface ArcadeSnapshot {
  kind: 'arcade';
  fen: string;
  ply: number;
  history: MoveRecord[];
  cooldown: [Square, number][];
  lastMove: Record<Color, number>;
  result: GameResult | null;
}

export class ArcadeEngine {
  readonly kind = 'arcade' as const;
  readonly war = null;
  ply = 0;
  history: MoveRecord[] = [];
  result: GameResult | null = null;
  /** Square -> time (ms) until the piece standing there may move again. */
  cooldown = new Map<Square, number>();
  lastMove: Record<Color, number> = { w: 0, b: 0 };
  private cells: (Piece | null)[] = new Array(64).fill(null);

  constructor(opts: { fen?: string } = {}) { this.load(opts.fen ?? ARCADE_START_FEN); }

  // ------------------------------------------------------------------ board
  private idx(s: Square) { return rankOf(s) * 8 + fileOf(s); }
  load(fen: string) {
    this.cells.fill(null);
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, ri) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
        this.cells[(7 - ri) * 8 + f] = { type: ch.toLowerCase() as PieceType, color };
        f++;
      }
    });
  }
  fen(): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.cells[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
      rows.push(row + (empty ? String(empty) : ''));
    }
    return `${rows.join('/')} w - - 0 ${1 + Math.floor(this.ply / 2)}`;
  }
  get(s: Square) { const p = this.cells[this.idx(s)]; return p ? { ...p, square: s } : undefined; }
  board() {
    const out: ({ square: Square; type: PieceType; color: Color } | null)[][] = [];
    for (let r = 7; r >= 0; r--) {
      const row = [];
      for (let f = 0; f < 8; f++) { const p = this.cells[r * 8 + f]; row.push(p ? { square: sq(f, r), ...p } : null); }
      out.push(row);
    }
    return out;
  }
  /** Not used for gating in real time; kept for the shared engine surface. */
  turn(): Color { return 'w'; }
  inCheck() { return false; }
  isCheckmate() { return false; }
  isOver() { return this.result !== null; }
  kingSquare(c: Color): Square | undefined {
    for (let i = 0; i < 64; i++) { const p = this.cells[i]; if (p && p.type === 'k' && p.color === c) return sq(i % 8, Math.floor(i / 8)); }
    return undefined;
  }
  attackedSquares(_by?: Color): Square[] { return []; }
  cooldownLeft(s: Square, at = Date.now()) { return Math.max(0, (this.cooldown.get(s) ?? 0) - at); }

  // ------------------------------------------------------------------ moves
  private targets(from: Square): Square[] {
    const p = this.get(from);
    if (!p) return [];
    const f0 = fileOf(from), r0 = rankOf(from);
    const out: Square[] = [];
    const add = (f: number, r: number, mode: 'any' | 'move' | 'capture' = 'any') => {
      if (!onBoard(f, r)) return false;
      const t = this.cells[r * 8 + f];
      if (t && t.color === p.color) return false;
      if (mode === 'move' && t) return false;
      if (mode === 'capture' && !t) return false;
      out.push(sq(f, r));
      return !t;
    };
    const slide = (dirs: number[][]) => { for (const [df, dr] of dirs) { let f = f0 + df, r = r0 + dr; while (add(f, r)) { f += df; r += dr; } } };
    switch (p.type) {
      case 'p': {
        const dir = p.color === 'w' ? 1 : -1;
        if (add(f0, r0 + dir, 'move') && r0 === (p.color === 'w' ? 1 : 6)) add(f0, r0 + 2 * dir, 'move');
        add(f0 - 1, r0 + dir, 'capture'); add(f0 + 1, r0 + dir, 'capture');
        break;
      }
      case 'n': for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(f0 + df, r0 + dr); break;
      case 'b': slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]); break;
      case 'r': slide([[1, 0], [-1, 0], [0, 1], [0, -1]]); break;
      case 'q': slide([[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]); break;
      case 'k': for (const [df, dr] of [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]]) add(f0 + df, r0 + dr); break;
    }
    return out;
  }

  /** Moves available right now (pieces off cooldown). Optionally only one square / one colour. */
  legalMoves(square?: Square, at = Date.now(), color?: Color): RulesMove[] {
    if (this.result) return [];
    const froms: Square[] = square ? [square] : this.board().flat().filter(Boolean).map((p) => p!.square);
    const out: RulesMove[] = [];
    for (const from of froms) {
      const p = this.get(from);
      if (!p || (color && p.color !== color) || this.cooldownLeft(from, at) > 0) continue;
      for (const to of this.targets(from)) {
        const cap = this.get(to);
        const promo = p.type === 'p' && (rankOf(to) === 7 || rankOf(to) === 0);
        out.push({ color: p.color, from, to, piece: p.type, captured: cap?.type, promotion: promo ? 'q' : undefined, flags: cap ? 'c' : 'n', san: `${from}${cap ? 'x' : '-'}${to}` });
      }
    }
    return out;
  }

  move(input: { from: Square; to: Square; promotion?: PieceType; color?: Color }, at = Date.now()):
    { ok: true; record: MoveRecord; events: never[] } | { ok: false; error: string } {
    if (this.result) return { ok: false, error: 'game_over' };
    const p = this.get(input.from);
    if (!p) return { ok: false, error: 'illegal_move' };
    if (input.color && p.color !== input.color) return { ok: false, error: 'not_your_piece' };
    if (this.cooldownLeft(input.from, at) > 0) return { ok: false, error: 'cooldown' };
    if (at - this.lastMove[p.color] < ARCADE_MIN_GAP) return { ok: false, error: 'too_fast' };
    if (!this.targets(input.from).includes(input.to)) return { ok: false, error: 'illegal_move' };
    const cap = this.get(input.to);
    const promo = p.type === 'p' && (rankOf(input.to) === 7 || rankOf(input.to) === 0);
    this.cells[this.idx(input.to)] = { type: promo ? 'q' : p.type, color: p.color };
    this.cells[this.idx(input.from)] = null;
    this.cooldown.delete(input.from);
    this.cooldown.set(input.to, at + ARCADE_COOLDOWN[p.type]);
    this.lastMove[p.color] = at;
    this.ply++;
    const record: MoveRecord = {
      ply: this.ply, san: `${p.type === 'p' ? '' : p.type.toUpperCase()}${input.from}${cap ? 'x' : '-'}${input.to}${promo ? '=Q' : ''}${cap?.type === 'k' ? '#' : ''}`,
      from: input.from, to: input.to, color: p.color, piece: p.type, captured: cap?.type, promotion: promo ? 'q' : undefined,
      flags: cap ? 'c' : 'n', fenAfter: this.fen(), at,
    };
    this.history.push(record);
    if (cap?.type === 'k') this.result = { winner: p.color, reason: 'checkmate' };
    return { ok: true, record, events: [] };
  }

  /** Apply a server-confirmed move without re-validating against this client's clock. */
  applyRemote(rec: MoveRecord, localAt: number) {
    this.load(rec.fenAfter);
    this.cooldown.delete(rec.from);
    this.cooldown.set(rec.to, localAt + ARCADE_COOLDOWN[rec.piece]);
    this.lastMove[rec.color] = localAt;
    this.ply = rec.ply;
    this.history.push(rec);
    if (rec.captured === 'k') this.result = { winner: rec.color, reason: 'checkmate' };
  }

  /** Timer expired: higher material wins (kings excluded), else a draw. */
  decideOnTime(): GameResult {
    const m = { w: 0, b: 0 };
    for (const p of this.cells) if (p && p.type !== 'k') m[p.color] += VALUE[p.type];
    const r: GameResult = m.w === m.b ? { winner: null, reason: 'timeout' } : { winner: m.w > m.b ? 'w' : 'b', reason: 'timeout' };
    this.setResult(r);
    return r;
  }

  setResult(r: GameResult) { if (!this.result) this.result = r; }

  /**
   * Simple real-time AI: take the king if possible, else the most valuable
   * capture that is not obviously recaptured, else develop / advance.
   */
  aiMove(color: Color, at = Date.now(), blunder = 0.1): RulesMove | null {
    const moves = this.legalMoves(undefined, at, color);
    if (!moves.length) return null;
    const enemyHits = new Set(this.legalMoves(undefined, Number.MAX_SAFE_INTEGER, other(color)).map((m) => m.to));
    const score = (m: RulesMove) => {
      let s = Math.random() * 0.6;
      if (m.captured) s += VALUE[m.captured as PieceType] * 10;
      if (m.captured === 'k') s += 10_000;
      if (enemyHits.has(m.to as Square)) s -= VALUE[m.piece as PieceType] * 6;
      if (enemyHits.has(m.from as Square)) s += VALUE[m.piece as PieceType] * 4; // escape a threat
      const adv = color === 'w' ? rankOf(m.to as Square) : 7 - rankOf(m.to as Square);
      if (m.piece === 'p') s += adv * 0.5;
      if (m.piece === 'n' || m.piece === 'b') s += 1;
      if (m.piece === 'k') s -= 2;
      return s;
    };
    if (Math.random() < blunder) return moves[Math.floor(Math.random() * moves.length)];
    return moves.reduce((a, b) => (score(b) > score(a) ? b : a));
  }

  // ------------------------------------------------------------------ shared-surface stubs (no War Chess abilities here)
  abilityView(_viewer?: unknown, _visibility?: unknown) { return null; }
  abilityTargets(_color?: unknown, _id?: unknown, _first?: unknown): Square[] { return []; }
  abilityBlocker(_color?: unknown, _id?: unknown): string | null { return 'abilities_disabled'; }
  useAbility(_color?: unknown, _input?: unknown, _at?: unknown): { ok: false; error: string } { return { ok: false, error: 'abilities_disabled' }; }

  snapshot(): ArcadeSnapshot {
    return { kind: 'arcade', fen: this.fen(), ply: this.ply, history: this.history, cooldown: [...this.cooldown.entries()], lastMove: this.lastMove, result: this.result };
  }
  static restore(s: ArcadeSnapshot): ArcadeEngine {
    const e = new ArcadeEngine({ fen: s.fen });
    e.ply = s.ply; e.history = s.history; e.cooldown = new Map(s.cooldown); e.lastMove = s.lastMove; e.result = s.result;
    return e;
  }
}
