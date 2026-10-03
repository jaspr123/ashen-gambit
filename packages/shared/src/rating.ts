// Elo rating — computed only on the server. Clients never submit ratings.
export const DEFAULT_RATING = 1200;

export function expectedScore(ra: number, rb: number) {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

/** score: 1 win, 0.5 draw, 0 loss for player A. Returns the new [ra, rb]. */
export function eloUpdate(ra: number, rb: number, score: number, gamesA = 30, gamesB = 30): [number, number] {
  const k = (r: number, g: number) => (g < 20 ? 40 : r > 2400 ? 10 : 20);
  const ea = expectedScore(ra, rb);
  return [Math.round(ra + k(ra, gamesA) * (score - ea)), Math.round(rb + k(rb, gamesB) * ((1 - score) - (1 - ea)))];
}
