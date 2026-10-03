import type { Color, Square } from '../types.js';

export const FILES = 'abcdefgh';

export function sq(file: number, rank: number): Square {
  return `${FILES[file]}${rank + 1}` as Square;
}
export function fileOf(s: Square): number { return s.charCodeAt(0) - 97; }
export function rankOf(s: Square): number { return Number(s[1]) - 1; }
export function onBoard(f: number, r: number) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
export function chebyshev(a: Square, b: Square) {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}
export function area(center: Square, radius: number): Square[] {
  const out: Square[] = [];
  const f0 = fileOf(center), r0 = rankOf(center);
  for (let df = -radius; df <= radius; df++) for (let dr = -radius; dr <= radius; dr++) {
    if (onBoard(f0 + df, r0 + dr)) out.push(sq(f0 + df, r0 + dr));
  }
  return out;
}
export const ALL_SQUARES: Square[] = (() => {
  const out: Square[] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) out.push(sq(f, r));
  return out;
})();
export function other(c: Color): Color { return c === 'w' ? 'b' : 'w'; }
export function isSquare(s: string): s is Square { return /^[a-h][1-8]$/.test(s); }
