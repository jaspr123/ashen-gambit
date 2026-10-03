// Scrap Poker — Texas Hold'em engine (no-limit), shared so it can be tested
// and so clients can name hands. The server owns the deck and drives one
// HoldemTable per table; clients only receive filtered views.
//
// Chips double as robot parts: a seat's robot shows ceil(stack / partValue)
// of its parts (losing chips strips the robot; won chips pile up as scrap).

export type Suit = 's' | 'h' | 'd' | 'c';
export type Card = string; // rank + suit, e.g. "As", "Td", "9h"
export const RANKS = '23456789TJQKA';
const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

export function freshDeck(): Card[] { return SUITS.flatMap((s) => [...RANKS].map((r) => r + s)); }

/** Fisher–Yates with an injected random source (crypto on the server, seeded in tests). */
export function shuffle(deck: Card[], rnd: () => number): Card[] {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

// ------------------------------------------------------------------ hand evaluation
export const HAND_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
export interface HandValue { rank: number; name: string; score: number[]; best: Card[] }

function eval5(cards: Card[]): { rank: number; score: number[] } {
  const v = cards.map((c) => RANKS.indexOf(c[0])).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(v)];
  let straightHigh = -1;
  if (uniq.length === 5 && v[0] - v[4] === 4) straightHigh = v[0];
  if (uniq.length === 5 && v[0] === 12 && v[1] === 3 && v[4] === 0) straightHigh = 3; // wheel A-2-3-4-5
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  if (straightHigh >= 0 && flush) return { rank: 8, score: [straightHigh] };
  if (groups[0][1] === 4) return { rank: 7, score: byGroup };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { rank: 6, score: byGroup };
  if (flush) return { rank: 5, score: v };
  if (straightHigh >= 0) return { rank: 4, score: [straightHigh] };
  if (groups[0][1] === 3) return { rank: 3, score: byGroup };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { rank: 2, score: byGroup };
  if (groups[0][1] === 2) return { rank: 1, score: byGroup };
  return { rank: 0, score: v };
}

export function compareScore(a: { rank: number; score: number[] }, b: { rank: number; score: number[] }) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
    const d = (a.score[i] ?? -1) - (b.score[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** Best five-card hand out of 5–7 cards. */
export function evaluate(cards: Card[]): HandValue {
  let best: { rank: number; score: number[] } | null = null;
  let bestCards: Card[] = [];
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
    const hand = [cards[a], cards[b], cards[c], cards[d], cards[e]];
    const s = eval5(hand);
    if (!best || compareScore(s, best) > 0) { best = s; bestCards = hand; }
  }
  return { rank: best!.rank, name: HAND_NAMES[best!.rank], score: best!.score, best: bestCards };
}

// ------------------------------------------------------------------ table state machine
export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type PokerAction = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface SeatState {
  id: string;
  name: string;
  stack: number;
  /** Chips put in during the current betting round. */
  bet: number;
  /** Chips put in this hand (side pots). */
  total: number;
  cards: Card[];
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last bet/raise this round. */
  acted: boolean;
  sittingOut: boolean;
  lastAction: string | null;
}

export interface HandResult {
  winners: { seat: number; amount: number; hand: string | null }[];
  shown: Record<number, Card[]>;
}

export class HoldemTable {
  seats: (SeatState | null)[];
  board: Card[] = [];
  deck: Card[] = [];
  pot = 0;
  street: Street = 'waiting';
  dealer = -1;
  toAct = -1;
  currentBet = 0;
  minRaise = 0;
  handNo = 0;
  lastResult: HandResult | null = null;
  log: string[] = [];

  constructor(readonly size: number, readonly sb: number, readonly bb: number, private rnd: () => number = Math.random) {
    this.seats = new Array(size).fill(null);
  }

  sit(seat: number, id: string, name: string, stack: number) {
    if (this.seats[seat]) throw new Error('seat_taken');
    this.seats[seat] = { id, name, stack, bet: 0, total: 0, cards: [], folded: true, allIn: false, acted: false, sittingOut: false, lastAction: null };
  }

  /** Remove a player; mid-hand they fold first. Returns their remaining stack. */
  stand(seat: number): number {
    const s = this.seats[seat];
    if (!s) return 0;
    if (this.inHand(seat)) { if (this.toAct === seat) this.act(seat, 'fold'); else { s.folded = true; this.checkHandOver(); } }
    const chips = s.stack;
    this.seats[seat] = null;
    return chips;
  }

  private inHand(i: number) { const s = this.seats[i]; return !!s && this.street !== 'waiting' && this.street !== 'showdown' && !s.folded; }
  private next(from: number, pred: (s: SeatState, i: number) => boolean): number {
    for (let k = 1; k <= this.size; k++) {
      const i = (from + k) % this.size;
      const s = this.seats[i];
      if (s && pred(s, i)) return i;
    }
    return -1;
  }
  activeSeats() { return this.seats.map((s, i) => (s && !s.sittingOut && s.stack > 0 ? i : -1)).filter((i) => i >= 0); }
  canStart() { return this.street === 'waiting' || this.street === 'showdown' ? this.activeSeats().length >= 2 : false; }

  startHand(): boolean {
    if (!this.canStart()) return false;
    this.handNo++;
    this.lastResult = null;
    this.board = [];
    this.pot = 0;
    this.deck = shuffle(freshDeck(), this.rnd);
    for (const s of this.seats) if (s) Object.assign(s, { bet: 0, total: 0, cards: [], folded: true, allIn: false, acted: false, lastAction: null });
    const players = this.activeSeats();
    for (const i of players) this.seats[i]!.folded = false;
    this.dealer = this.next(this.dealer, (s) => !s.folded);
    const headsUp = players.length === 2;
    const sbSeat = headsUp ? this.dealer : this.next(this.dealer, (s) => !s.folded);
    const bbSeat = this.next(sbSeat, (s) => !s.folded);
    this.post(sbSeat, this.sb, 'small blind');
    this.post(bbSeat, this.bb, 'big blind');
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    for (let r = 0; r < 2; r++) for (const i of this.order(this.next(this.dealer, (s) => !s.folded))) this.seats[i]!.cards.push(this.deck.pop()!);
    this.street = 'preflop';
    this.toAct = this.next(bbSeat, (s) => !s.folded && !s.allIn);
    this.log = [`Hand #${this.handNo}`];
    if (this.toAct < 0 || this.everyoneAllIn()) this.runOut();
    return true;
  }

  /** Seats in dealing order starting at `first`. */
  private order(first: number) { const out: number[] = []; let i = first; for (let k = 0; k < this.size; k++) { if (this.seats[i] && !this.seats[i]!.folded) out.push(i); i = (i + 1) % this.size; } return out; }

  private post(i: number, amount: number, what: string) {
    const s = this.seats[i]!;
    const a = Math.min(amount, s.stack);
    s.stack -= a; s.bet += a; s.total += a;
    if (s.stack === 0) s.allIn = true;
    s.lastAction = `${what} ${a}`;
  }

  /** Legal options for the seat to act. */
  options(seat: number): { canCheck: boolean; toCall: number; minRaiseTo: number; maxRaiseTo: number } | null {
    if (seat !== this.toAct) return null;
    const s = this.seats[seat]!;
    const toCall = Math.min(this.currentBet - s.bet, s.stack);
    return { canCheck: toCall === 0, toCall, minRaiseTo: Math.min(this.currentBet + this.minRaise, s.bet + s.stack), maxRaiseTo: s.bet + s.stack };
  }

  act(seat: number, action: PokerAction, raiseTo = 0): { ok: true } | { ok: false; error: string } {
    if (this.street === 'waiting' || this.street === 'showdown') return { ok: false, error: 'no_hand' };
    if (seat !== this.toAct) return { ok: false, error: 'not_your_turn' };
    const s = this.seats[seat]!;
    const o = this.options(seat)!;
    switch (action) {
      case 'fold': s.folded = true; s.lastAction = 'fold'; break;
      case 'check':
        if (!o.canCheck) return { ok: false, error: 'cannot_check' };
        s.lastAction = 'check'; break;
      case 'call':
        if (o.toCall === 0) { s.lastAction = 'check'; break; }
        this.put(s, o.toCall); s.lastAction = s.allIn ? `all-in ${s.bet}` : `call ${o.toCall}`; break;
      case 'allin': raiseTo = s.bet + s.stack; // falls through to a raise (or a short call)
      // eslint-disable-next-line no-fallthrough
      case 'raise': {
        raiseTo = Math.floor(raiseTo);
        if (raiseTo <= this.currentBet) { // all-in for less than a call is a call
          if (raiseTo === s.bet + s.stack) { this.put(s, s.stack); s.lastAction = `all-in ${s.bet}`; break; }
          return { ok: false, error: 'raise_too_small' };
        }
        if (raiseTo > o.maxRaiseTo) return { ok: false, error: 'not_enough_chips' };
        const full = raiseTo - this.currentBet >= this.minRaise;
        if (!full && raiseTo !== o.maxRaiseTo) return { ok: false, error: 'raise_too_small' };
        this.put(s, raiseTo - s.bet);
        if (full) { this.minRaise = raiseTo - this.currentBet; for (const x of this.seats) if (x && x !== s) x.acted = false; }
        this.currentBet = raiseTo;
        s.lastAction = s.allIn ? `all-in ${raiseTo}` : `raise to ${raiseTo}`;
        break;
      }
    }
    s.acted = true;
    this.log.push(`${s.name}: ${s.lastAction}`);
    this.advance(seat);
    return { ok: true };
  }

  private put(s: SeatState, n: number) {
    const a = Math.min(n, s.stack);
    s.stack -= a; s.bet += a; s.total += a;
    if (s.stack === 0) s.allIn = true;
  }

  private live() { return this.seats.map((s, i) => (s && !s.folded ? i : -1)).filter((i) => i >= 0); }
  private everyoneAllIn() { return this.live().filter((i) => !this.seats[i]!.allIn).length <= 1 && this.live().every((i) => this.seats[i]!.allIn || this.seats[i]!.bet >= this.currentBet); }

  private checkHandOver(): boolean {
    if (this.live().length === 1) { this.collect(); this.award([[this.live()[0]]], {}); return true; }
    return false;
  }

  private advance(from: number) {
    if (this.checkHandOver()) return;
    const pending = this.live().filter((i) => { const s = this.seats[i]!; return !s.allIn && (!s.acted || s.bet < this.currentBet); });
    if (pending.length) { this.toAct = this.next(from, (s, i) => pending.includes(i)); return; }
    this.collect();
    if (this.everyoneAllIn()) { this.runOut(); return; }
    this.nextStreet();
  }

  private collect() {
    for (const s of this.seats) if (s) { this.pot += s.bet; s.bet = 0; s.acted = false; }
    this.currentBet = 0;
    this.minRaise = this.bb;
  }

  private nextStreet() {
    if (this.street === 'river') { this.showdown(); return; }
    this.deck.pop(); // burn
    if (this.street === 'preflop') { this.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!); this.street = 'flop'; }
    else if (this.street === 'flop') { this.board.push(this.deck.pop()!); this.street = 'turn'; }
    else { this.board.push(this.deck.pop()!); this.street = 'river'; }
    this.log.push(`${this.street}: ${this.board.join(' ')}`);
    this.toAct = this.next(this.dealer, (s) => !s.folded && !s.allIn);
    if (this.toAct < 0 || this.live().filter((i) => !this.seats[i]!.allIn).length <= 1) this.runOut();
  }

  /** No more betting possible: deal the rest of the board and show down. */
  private runOut() {
    this.collect();
    while (this.board.length < 5) { this.deck.pop(); this.board.push(...this.deck.splice(-1, 1)); }
    this.showdown();
  }

  private showdown() {
    this.street = 'showdown';
    const live = this.live();
    const values = new Map(live.map((i) => [i, evaluate([...this.seats[i]!.cards, ...this.board])]));
    // Side pots: layer contributions by each live player's total.
    const contrib = this.seats.map((s) => s?.total ?? 0);
    const levels = [...new Set(live.map((i) => contrib[i]))].sort((a, b) => a - b);
    let prev = 0;
    const pots: { amount: number; eligible: number[] }[] = [];
    for (const lvl of levels) {
      let amount = 0;
      for (let i = 0; i < this.size; i++) amount += Math.max(0, Math.min(contrib[i], lvl) - prev);
      pots.push({ amount, eligible: live.filter((i) => contrib[i] >= lvl) });
      prev = lvl;
    }
    const remainder = this.pot - pots.reduce((a, p) => a + p.amount, 0);
    if (pots.length && remainder > 0) pots[pots.length - 1].amount += remainder; // dead money from folders above the top level
    const shown: Record<number, Card[]> = {};
    for (const i of live) shown[i] = this.seats[i]!.cards;
    const winners: HandResult['winners'] = [];
    for (const pot of pots) {
      let best: number[] = [];
      for (const i of pot.eligible) {
        if (!best.length) { best = [i]; continue; }
        const c = compareScore(values.get(i)!, values.get(best[0])!);
        if (c > 0) best = [i]; else if (c === 0) best.push(i);
      }
      this.split(pot.amount, best, winners, (i) => values.get(i)!.name);
    }
    this.pot = 0;
    this.lastResult = { winners: merge(winners), shown };
    for (const w of this.lastResult.winners) this.log.push(`${this.seats[w.seat]!.name} wins ${w.amount}${w.hand ? ` with ${w.hand}` : ''}`);
    this.toAct = -1;
  }

  private award(groups: number[][], shown: Record<number, Card[]>) {
    const winners: HandResult['winners'] = [];
    this.split(this.pot, groups[0], winners, () => null);
    this.pot = 0;
    this.street = 'showdown';
    this.toAct = -1;
    this.lastResult = { winners: merge(winners), shown };
    for (const w of this.lastResult.winners) this.log.push(`${this.seats[w.seat]!.name} wins ${w.amount}`);
  }

  private split(amount: number, seats: number[], out: HandResult['winners'], hand: (i: number) => string | null) {
    if (!seats.length || amount <= 0) return;
    const each = Math.floor(amount / seats.length);
    let odd = amount - each * seats.length;
    // Odd chips go to the first winners left of the dealer.
    const ordered = [...seats].sort((a, b) => ((a - this.dealer + this.size) % this.size) - ((b - this.dealer + this.size) % this.size));
    for (const i of ordered) {
      const won = each + (odd-- > 0 ? 1 : 0);
      this.seats[i]!.stack += won;
      out.push({ seat: i, amount: won, hand: hand(i) });
    }
  }
}

function merge(w: HandResult['winners']): HandResult['winners'] {
  const m = new Map<number, { seat: number; amount: number; hand: string | null }>();
  for (const x of w) { const y = m.get(x.seat); if (y) y.amount += x.amount; else m.set(x.seat, { ...x }); }
  return [...m.values()];
}

// ------------------------------------------------------------------ bot brain
/** Rough equity of `hole` vs `opponents` random hands given the board (Monte Carlo). */
export function equity(hole: Card[], board: Card[], opponents: number, sims = 160, rnd: () => number = Math.random): number {
  const known = new Set([...hole, ...board]);
  const rest = freshDeck().filter((c) => !known.has(c));
  let wins = 0;
  for (let k = 0; k < sims; k++) {
    const d = shuffle(rest, rnd);
    const full = [...board, ...d.slice(0, 5 - board.length)];
    let off = 5 - board.length;
    const mine = evaluate([...hole, ...full]);
    let best = 1, tie = 0;
    for (let o = 0; o < opponents; o++) {
      const theirs = evaluate([d[off], d[off + 1], ...full]); off += 2;
      const c = compareScore(mine, theirs);
      if (c < 0) { best = 0; break; }
      if (c === 0) tie++;
    }
    wins += best ? 1 / (1 + tie) : 0;
  }
  return wins / sims;
}

export interface PokerTableDef { id: string; name: string; seats: number; sb: number; bb: number; partValue: number; parts: number }
/** Buy-in = a full robot: `parts` parts worth `partValue` chips each. */
export const POKER_TABLES: PokerTableDef[] = [
  { id: 'scrapyard', name: 'The Scrapyard', seats: 6, sb: 10, bb: 20, partValue: 50, parts: 10 },
  { id: 'voltage', name: 'High Voltage', seats: 6, sb: 50, bb: 100, partValue: 250, parts: 10 },
];
export const ROBOT_PARTS = ['antenna', 'head', 'left arm', 'right arm', 'shoulder plates', 'chest plate', 'backpack', 'left leg', 'right leg', 'core'];
export function partsFor(stack: number, partValue: number, parts = 10) { return Math.max(0, Math.min(parts, Math.ceil(stack / partValue))); }
