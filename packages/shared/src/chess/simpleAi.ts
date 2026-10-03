// Lightweight alpha-beta search used by server-side lobby bots and as the
// client fallback when Stockfish (WASM) is unavailable. Stockfish is the
// primary engine for practice games; this one only needs to be plausible.

import { Chess, type Move } from 'chess.js';

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Simple piece-square bonuses (white perspective, a8..h1 order) for pawns and knights.
const PAWN_PST = [
  0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
];
const KNIGHT_PST = [
  -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
];

function evaluate(c: Chess): number {
  // Score from the side-to-move's perspective.
  let score = 0;
  const board = c.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (!p) continue;
    const idx = p.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
    let v = VALUE[p.type];
    if (p.type === 'p') v += PAWN_PST[idx];
    else if (p.type === 'n' || p.type === 'b') v += KNIGHT_PST[idx] * 0.6;
    else if (p.type !== 'k') v += (3.5 - Math.abs(3.5 - f)) * 2;
    score += p.color === 'w' ? v : -v;
  }
  return c.turn() === 'w' ? score : -score;
}

function ordered(moves: Move[]): Move[] {
  return moves.sort((a, b) => (b.captured ? VALUE[b.captured] - VALUE[b.piece] / 10 : 0) - (a.captured ? VALUE[a.captured] - VALUE[a.piece] / 10 : 0));
}

function search(c: Chess, depth: number, alpha: number, beta: number, deadline: number): number {
  if (c.isCheckmate()) return -100000 - depth;
  if (c.isDraw()) return 0;
  if (depth === 0 || Date.now() > deadline) return evaluate(c);
  for (const m of ordered(c.moves({ verbose: true }) as Move[])) {
    c.move(m.san);
    const s = -search(c, depth - 1, -beta, -alpha, deadline);
    c.undo();
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

export interface SimpleAiOptions { depth?: number; timeMs?: number; blunderChance?: number; legal?: Move[] }

/** Returns the chosen move as {from,to,promotion}. `legal` restricts the choice (War Chess filters). */
export function chooseMove(fen: string, opts: SimpleAiOptions = {}): { from: string; to: string; promotion?: string } | null {
  const c = new Chess(fen);
  const legal = (opts.legal ?? (c.moves({ verbose: true }) as Move[]));
  if (!legal.length) return null;
  if (opts.blunderChance && Math.random() < opts.blunderChance) {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return { from: m.from, to: m.to, promotion: m.promotion };
  }
  const deadline = Date.now() + (opts.timeMs ?? 400);
  const depth = opts.depth ?? 2;
  let best = legal[0], bestScore = -Infinity;
  for (const m of ordered([...legal])) {
    c.move({ from: m.from, to: m.to, promotion: m.promotion });
    const s = -search(c, depth - 1, -Infinity, Infinity, deadline) + Math.random() * 8;
    c.undo();
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return { from: best.from, to: best.to, promotion: best.promotion };
}
