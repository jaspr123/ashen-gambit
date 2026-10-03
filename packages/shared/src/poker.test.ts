import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HoldemTable, evaluate, compareScore, equity } from './poker/holdem.js';
import { mulberry32 } from './derby/sim.js';

test('poker: hand evaluator ranks hands and breaks ties', () => {
  const sf = evaluate(['9h', 'Th', 'Jh', 'Qh', 'Kh', '2c', '3d']);
  assert.equal(sf.name, 'Straight flush');
  assert.equal(evaluate(['As', '2d', '3c', '4h', '5s', 'Kd', 'Kc']).name, 'Straight', 'wheel');
  assert.equal(evaluate(['As', 'Ad', 'Ac', 'Kh', 'Ks', '2d', '3c']).name, 'Full house');
  const a = evaluate(['As', 'Ad', 'Kc', 'Qh', 'Js', '2d', '3c']);
  const b = evaluate(['Ah', 'Ac', 'Kd', 'Qs', 'Ts', '2h', '3s']);
  assert.ok(compareScore(a, b) > 0, 'kicker decides');
  assert.ok(equity(['As', 'Ad'], [], 1, 200, mulberry32(4)) > 0.75);
});

test('poker: blinds, betting, folds and the pot reaching the winner', () => {
  const t = new HoldemTable(6, 10, 20, mulberry32(1));
  t.sit(0, 'a', 'A', 500); t.sit(2, 'b', 'B', 500); t.sit(4, 'c', 'C', 500);
  assert.ok(t.startHand());
  const total = () => t.seats.reduce((n, s) => n + (s ? s.stack + s.bet : 0), 0) + t.pot;
  assert.equal(total(), 1500, 'chips conserved');
  // Preflop: UTG (dealer is seat 0 -> SB 2, BB 4 -> UTG 0)
  assert.equal(t.toAct, 0);
  assert.ok(t.act(0, 'raise', 60).ok);
  assert.ok(t.act(2, 'fold').ok);
  assert.ok(t.act(4, 'call').ok);
  assert.equal(t.street, 'flop');
  assert.equal(t.board.length, 3);
  assert.equal(t.pot, 130);
  assert.ok(t.act(4, 'check').ok);
  assert.ok(t.act(0, 'raise', 100).ok);
  assert.ok(t.act(4, 'fold').ok);
  assert.equal(t.street, 'showdown');
  assert.equal(t.lastResult!.winners[0].seat, 0);
  assert.equal(t.seats[0]!.stack, 500 + 70);
  assert.equal(total(), 1500);
});

test('poker: all-in side pots pay the right players', () => {
  const t = new HoldemTable(3, 5, 10, mulberry32(9));
  t.sit(0, 'a', 'Short', 50); t.sit(1, 'b', 'Mid', 200); t.sit(2, 'c', 'Big', 500);
  assert.ok(t.startHand());
  // Force known cards: Short has the best hand, Mid second, Big worst.
  t.seats[0]!.cards = ['As', 'Ah']; t.seats[1]!.cards = ['Ks', 'Kh']; t.seats[2]!.cards = ['7c', '2d'];
  // pop() draws from the end: each board card is preceded by a burn card.
  const used = ['As', 'Ah', 'Ks', 'Kh', '7c', '2d', '3s', '8d', 'Jc', '4h', 'Qd', '9c', 'Td', '5c', '6h', '2s'];
  const rest = t.deck.filter((c) => !used.includes(c));
  t.deck = [...rest, 'Qd', '9c', '4h', 'Td', 'Jc', '5c', '8d', '6h', '3s', '2s'];
  let guard = 0;
  while (t.street !== 'showdown' && guard++ < 20) t.act(t.toAct, 'allin');
  assert.equal(t.street, 'showdown');
  const won = Object.fromEntries(t.lastResult!.winners.map((w) => [w.seat, w.amount]));
  assert.equal(won[0], 150, 'short stack wins the main pot (50 x 3)');
  assert.equal(won[1], 300, 'mid stack wins the side pot (150 x 2)');
  assert.equal(t.seats.reduce((n, s) => n + (s?.stack ?? 0), 0), 750);
});
