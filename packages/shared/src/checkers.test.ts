import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckersEngine, CHECKERS_START_FEN } from './checkers/engine.js';
import { createEngine, restoreEngine } from './rules.js';

test('checkers: start position has 12 men a side on dark squares, 7 opening moves', () => {
  const e = new CheckersEngine();
  let w = 0, b = 0;
  for (const row of e.board()) for (const c of row) if (c) { c.color === 'w' ? w++ : b++; assert.equal((c.square.charCodeAt(0) - 97 + Number(c.square[1]) - 1) % 2, 0); }
  assert.equal(w, 12); assert.equal(b, 12);
  assert.equal(e.legalMoves().length, 7);
  assert.equal(e.fen(), CHECKERS_START_FEN);
});

test('checkers: captures are mandatory and men only move forward', () => {
  const e = new CheckersEngine({ fen: '8/8/8/8/8/2p5/1P6/8 w - - 0 1 -' });
  const moves = e.legalMoves();
  assert.deepEqual(moves.map((m) => `${m.from}${m.to}`), ['b2d4']);
  assert.equal(moves[0].captureSquare, 'c3');
  assert.equal(e.move({ from: 'b2', to: 'a3' }).ok, false, 'quiet move refused while a capture exists');
});

test('checkers: multi-jump keeps the turn on the same piece, then passes', () => {
  // White man a1 can jump b2 -> c3, then d4 -> e5.
  const e = new CheckersEngine({ fen: '8/8/8/8/3p4/8/1p6/P7 w - - 0 1 -' });
  const r1 = e.move({ from: 'a1', to: 'c3' });
  assert.ok(r1.ok);
  assert.equal(e.turn(), 'w', 'still white: chain must continue');
  assert.equal(e.continuing, 'c3');
  assert.deepEqual(e.legalMoves().map((m) => m.to), ['e5']);
  const r2 = e.move({ from: 'c3', to: 'e5' });
  assert.ok(r2.ok);
  assert.deepEqual(e.result, { winner: 'w', reason: 'checkmate' }, 'black has no pieces left');
});

test('checkers: reaching the far rank crowns and ends the turn; kings move backwards', () => {
  const e = new CheckersEngine({ fen: '8/1P6/8/6p1/8/8/8/8 w - - 0 1 -' });
  const r = e.move({ from: 'b7', to: 'a8' });
  assert.ok(r.ok && r.record.promotion === 'k');
  assert.equal(e.get('a8')?.type, 'k');
  assert.equal(e.turn(), 'b');
  assert.ok(e.move({ from: 'g5', to: 'h4' }).ok);
  assert.ok(e.legalMoves().some((m) => m.from === 'a8' && m.to === 'b7'), 'king moves back down the board');
});

test('checkers: engine factory, snapshot/restore and AI', () => {
  const e = createEngine('checkers');
  assert.equal(e.kind, 'checkers');
  const m = (e as CheckersEngine).aiMove(3, 200);
  assert.ok(m);
  e.move(m!);
  const r = restoreEngine(e.snapshot());
  assert.equal(r.fen(), e.fen());
  assert.equal(r.kind, 'checkers');
  assert.equal(createEngine('standard').kind, 'chess');
});
