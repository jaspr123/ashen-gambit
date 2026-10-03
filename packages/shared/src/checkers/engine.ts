// CheckersEngine — Battle Checkers rules (English/American draughts on the
// 8x8 board, played on the dark squares). Exposes the same surface as
// ChessEngine (RulesEngine) so the server, the client, the combat system and
// replays treat both games identically.
//
//   * men move one square diagonally forward; kings one square in any diagonal
//   * captures are mandatory; jumps chain — the SAME player keeps the turn and
//     must continue with the same piece while further jumps exist
//   * a man reaching the far rank is crowned and the turn ends
//   * you lose with no pieces or no legal move; draw by threefold repetition or
//     80 plies without a capture or a man move (the 40-move rule)
//
// FEN: chess-style board using P/K (white) and p/k (black), then
// `<turn> - - <quiet plies> <fullmove> <continue-square|->`.

import type { Color, GameResult, MoveRecord, PieceType, Square } from '../types.js';
import { ALL_SQUARES, fileOf, onBoard, other, rankOf, sq } from '../chess/squares.js';
/** Strongly-typed checkers move (assignable to the shared RulesMove shape). */
export interface CheckersMove {
  color: Color; from: Square; to: Square; piece: PieceType; captured?: PieceType; promotion?: PieceType;
  flags: string; san: string; captureSquare?: Square;
}

type Cell = { type: 'p' | 'k'; color: Color } | null;

export const CHECKERS_START_FEN = (() => {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const dark = (f + r) % 2 === 0;
      const piece = dark && r <= 2 ? 'P' : dark && r >= 5 ? 'p' : '';
      if (piece) { if (empty) row += empty; empty = 0; row += piece; } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} w - - 0 1 -`;
})();

export interface CheckersSnapshot { kind: 'checkers'; fen: string; ply: number; history: MoveRecord[]; positions: [string, number][]; result: GameResult | null }

export class CheckersEngine {
  readonly kind = 'checkers' as const;
  readonly war = null;
  ply = 0;
  history: MoveRecord[] = [];
  result: GameResult | null = null;
  private cells: Cell[] = new Array(64).fill(null);
  private side: Color = 'w';
  private quiet = 0;
  private fullmove = 1;
  /** Square of the piece that must keep jumping (multi-jump in progress). */
  private chain: Square | null = null;
  private positions = new Map<string, number>();

  constructor(opts: { fen?: string } = {}) {
    this.load(opts.fen ?? CHECKERS_START_FEN);
    this.count();
  }

  // ------------------------------------------------------------------ state
  private idx(s: Square) { return rankOf(s) * 8 + fileOf(s); }
  private at(f: number, r: number): Cell { return onBoard(f, r) ? this.cells[r * 8 + f] : null; }

  load(fen: string) {
    const [board, turn, , , quiet, full, chain] = fen.trim().split(/\s+/);
    this.cells.fill(null);
    board.split('/').forEach((row, ri) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        const lower = ch.toLowerCase();
        if (lower === 'p' || lower === 'k') this.cells[(7 - ri) * 8 + f] = { type: lower, color: ch === lower ? 'b' : 'w' };
        f++;
      }
    });
    this.side = turn === 'b' ? 'b' : 'w';
    this.quiet = Number(quiet ?? 0) || 0;
    this.fullmove = Number(full ?? 1) || 1;
    this.chain = chain && chain !== '-' ? (chain as Square) : null;
  }

  fen(): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = '', empty = 0;
      for (let f = 0; f < 8; f++) {
        const c = this.cells[r * 8 + f];
        if (!c) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += c.color === 'w' ? c.type.toUpperCase() : c.type;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} ${this.side} - - ${this.quiet} ${this.fullmove} ${this.chain ?? '-'}`;
  }

  turn(): Color { return this.side; }
  get(s: Square) { const c = this.cells[this.idx(s)]; return c ? { type: c.type as PieceType, color: c.color } : undefined; }
  board() {
    const out: ({ square: Square; type: PieceType; color: Color } | null)[][] = [];
    for (let r = 7; r >= 0; r--) {
      const row: ({ square: Square; type: PieceType; color: Color } | null)[] = [];
      for (let f = 0; f < 8; f++) { const c = this.cells[r * 8 + f]; row.push(c ? { square: sq(f, r), type: c.type, color: c.color } : null); }
      out.push(row);
    }
    return out;
  }
  inCheck() { return false; }
  isCheckmate() { return false; }
  isOver() { return this.result !== null; }
  kingSquare(_c: Color): Square | undefined { return undefined; }
  /** Pending multi-jump square (the only piece allowed to move), if any. */
  get continuing(): Square | null { return this.chain; }

  /** Squares `by` could capture on next turn (threat overlay parity with chess). */
  attackedSquares(by: Color): Square[] {
    const out = new Set<Square>();
    for (const s of ALL_SQUARES) {
      const c = this.get(s);
      if (!c || c.color !== by) continue;
      for (const m of this.jumpsFrom(s, by)) out.add(m.captureSquare);
    }
    return [...out];
  }

  // ------------------------------------------------------------------ move generation
  private dirs(c: { type: 'p' | 'k' | PieceType; color: Color }): [number, number][] {
    const fwd = c.color === 'w' ? 1 : -1;
    return c.type === 'k' ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : [[1, fwd], [-1, fwd]];
  }

  private jumpsFrom(s: Square, color: Color) {
    const piece = this.get(s);
    const out: { from: Square; to: Square; captureSquare: Square }[] = [];
    if (!piece || piece.color !== color) return out;
    const f = fileOf(s), r = rankOf(s);
    for (const [df, dr] of this.dirs(piece as { type: 'p' | 'k'; color: Color })) {
      const mid = this.at(f + df, r + dr), land = onBoard(f + 2 * df, r + 2 * dr);
      if (mid && mid.color !== color && land && !this.at(f + 2 * df, r + 2 * dr)) out.push({ from: s, to: sq(f + 2 * df, r + 2 * dr), captureSquare: sq(f + df, r + dr) });
    }
    return out;
  }

  private stepsFrom(s: Square) {
    const piece = this.get(s);
    const out: { from: Square; to: Square }[] = [];
    if (!piece) return out;
    const f = fileOf(s), r = rankOf(s);
    for (const [df, dr] of this.dirs(piece as { type: 'p' | 'k'; color: Color })) {
      if (onBoard(f + df, r + dr) && !this.at(f + df, r + dr)) out.push({ from: s, to: sq(f + df, r + dr) });
    }
    return out;
  }

  private toMove(m: { from: Square; to: Square; captureSquare?: Square }): CheckersMove {
    const p = this.get(m.from)!;
    const cap = m.captureSquare ? this.get(m.captureSquare) : undefined;
    const crown = p.type === 'p' && rankOf(m.to) === (p.color === 'w' ? 7 : 0);
    return {
      color: p.color, from: m.from, to: m.to, piece: p.type, captured: cap?.type, promotion: crown ? ('k' as PieceType) : undefined,
      flags: (m.captureSquare ? 'c' : 'n') + (crown ? 'p' : ''), san: `${m.from}${m.captureSquare ? 'x' : '-'}${m.to}${crown ? '=K' : ''}`,
      captureSquare: m.captureSquare,
    };
  }

  legalMoves(square?: Square): CheckersMove[] {
    if (this.result) return [];
    const color = this.side;
    const origins = this.chain ? [this.chain] : ALL_SQUARES.filter((s) => this.get(s)?.color === color);
    const jumps = origins.flatMap((s) => this.jumpsFrom(s, color));
    const list = jumps.length ? jumps : this.chain ? [] : origins.flatMap((s) => this.stepsFrom(s));
    return list.filter((m) => !square || m.from === square).map((m) => this.toMove(m));
  }

  // ------------------------------------------------------------------ moves
  move(input: { from: Square; to: Square; promotion?: PieceType }, at = Date.now()):
    { ok: true; record: MoveRecord; events: never[] } | { ok: false; error: string } {
    if (this.result) return { ok: false, error: 'game_over' };
    const mv = this.legalMoves(input.from).find((m) => m.to === input.to);
    if (!mv) return { ok: false, error: 'illegal_move' };
    const mover = this.side;
    const piece = this.get(mv.from)!;
    this.cells[this.idx(mv.to)] = { type: mv.promotion ? 'k' : (piece.type as 'p' | 'k'), color: mover };
    this.cells[this.idx(mv.from)] = null;
    if (mv.captureSquare) this.cells[this.idx(mv.captureSquare)] = null;
    this.ply++;
    this.quiet = mv.captureSquare || piece.type === 'p' ? 0 : this.quiet + 1;
    // Chain continues if this was a jump, no crowning happened, and another jump exists from the landing square.
    const keepJumping = !!mv.captureSquare && !mv.promotion && this.jumpsFrom(mv.to, mover).length > 0;
    if (keepJumping) {
      this.chain = mv.to;
    } else {
      this.chain = null;
      if (mover === 'b') this.fullmove++;
      this.side = other(mover);
    }
    const record: MoveRecord = {
      ply: this.ply, san: mv.san, from: mv.from, to: mv.to, color: mover, piece: piece.type, captured: mv.captured,
      promotion: mv.promotion, flags: mv.flags, fenAfter: this.fen(), at, captureSquare: mv.captureSquare,
    };
    this.history.push(record);
    if (!keepJumping) this.count();
    this.evaluate();
    return { ok: true, record, events: [] };
  }

  private key() { const p = this.fen().split(' '); return `${p[0]} ${p[1]}`; }
  private count() { const k = this.key(); this.positions.set(k, (this.positions.get(k) ?? 0) + 1); }

  private evaluate() {
    if (this.chain) return;
    const mine = ALL_SQUARES.filter((s) => this.get(s)?.color === this.side);
    if (!mine.length || !this.legalMoves().length) { this.result = { winner: other(this.side), reason: 'checkmate' }; return; }
    if ((this.positions.get(this.key()) ?? 0) >= 3) { this.result = { winner: null, reason: 'threefold' }; return; }
    if (this.quiet >= 80) { this.result = { winner: null, reason: 'fifty_move' }; }
  }

  setResult(r: GameResult) { if (!this.result) this.result = r; }

  // ------------------------------------------------------------------ War Chess surface (not used in checkers)
  abilityView(_viewer?: unknown, _visibility?: unknown) { return null; }
  abilityTargets(_color?: Color, _id?: string, _first?: Square): Square[] { return []; }
  abilityBlocker(_color?: Color, _id?: string) { return 'abilities_disabled'; }
  useAbility(_color?: Color, _input?: unknown, _at?: number): { ok: false; error: string } { return { ok: false, error: 'abilities_disabled' }; }

  // ------------------------------------------------------------------ AI
  private evalFor(color: Color): number {
    let s = 0;
    for (const sqr of ALL_SQUARES) {
      const c = this.get(sqr);
      if (!c) continue;
      const adv = c.color === 'w' ? rankOf(sqr) : 7 - rankOf(sqr);
      const centre = 3.5 - Math.abs(3.5 - fileOf(sqr));
      const v = (c.type === 'k' ? 165 : 100 + adv * 6) + centre * 3;
      s += c.color === color ? v : -v;
    }
    return s;
  }

  private search(depth: number, alpha: number, beta: number, deadline: number): number {
    if (this.result) return this.result.winner === null ? 0 : this.result.winner === this.side ? 100000 : -100000 - depth;
    if (depth <= 0 || Date.now() > deadline) return this.evalFor(this.side);
    const snap = this.fen(), hist = this.history.length, ply = this.ply, res = this.result;
    for (const m of this.legalMoves().sort((a, b) => Number(!!b.captured) - Number(!!a.captured))) {
      const me = this.side;
      this.move({ from: m.from, to: m.to });
      const same = this.side === me && !this.result;
      const v = same ? this.search(depth, alpha, beta, deadline) : -this.search(depth - 1, -beta, -alpha, deadline);
      this.load(snap); this.history.length = hist; this.ply = ply; this.result = res;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  /** Alpha-beta move choice for bots/practice. `blunder` = chance of a random legal move. */
  aiMove(depth = 5, timeMs = 600, blunder = 0): { from: Square; to: Square } | null {
    const moves = this.legalMoves();
    if (!moves.length) return null;
    if (Math.random() < blunder) { const m = moves[Math.floor(Math.random() * moves.length)]; return { from: m.from, to: m.to }; }
    const deadline = Date.now() + timeMs;
    const snap = this.fen(), hist = this.history.length, ply = this.ply, res = this.result, positions = new Map(this.positions);
    let best = moves[0], bestV = -Infinity;
    for (const m of moves) {
      const me = this.side;
      this.move({ from: m.from, to: m.to });
      const v = (this.side === me && !this.result ? this.search(depth, -Infinity, Infinity, deadline) : -this.search(depth - 1, -Infinity, Infinity, deadline)) + Math.random() * 4;
      this.load(snap); this.history.length = hist; this.ply = ply; this.result = res;
      if (v > bestV) { bestV = v; best = m; }
    }
    this.positions = positions;
    return { from: best.from, to: best.to };
  }

  // ------------------------------------------------------------------ persistence
  snapshot(): CheckersSnapshot {
    return { kind: 'checkers', fen: this.fen(), ply: this.ply, history: this.history, positions: [...this.positions.entries()], result: this.result };
  }
  static restore(s: CheckersSnapshot): CheckersEngine {
    const e = new CheckersEngine({ fen: s.fen });
    e.ply = s.ply; e.history = s.history; e.positions = new Map(s.positions); e.result = s.result;
    return e;
  }
}
