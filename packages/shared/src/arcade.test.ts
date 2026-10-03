import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArcadeEngine, ARCADE_COOLDOWN, ARCADE_MIN_GAP } from './arcade/engine.js';
import { createEngine, restoreEngine } from './rules.js';

test('arcade: both colours move without turns; cooldowns and anti-spam gate pieces', () => {
  const e = new ArcadeEngine();
  let t = 1_000_000;
  assert.ok(e.move({ from: 'e2', to: 'e4', color: 'w' }, t).ok);
  assert.ok(e.move({ from: 'd7', to: 'd5', color: 'b' }, t + 10).ok, 'black moves at once — no turns');
  assert.equal(e.move({ from: 'd2', to: 'd4', color: 'w' }, t + 50).ok, false, 'anti-spam gap');
  t += ARCADE_MIN_GAP + 10;
  assert.ok(e.move({ from: 'd2', to: 'd4', color: 'w' }, t).ok, 'other pieces are free');
  const r = e.move({ from: 'e4', to: 'd5', color: 'w' }, t + ARCADE_MIN_GAP + 5);
  assert.equal(r.ok, false, 'e4 pawn still cooling');
  const later = 1_000_000 + ARCADE_COOLDOWN.p + 50;
  const cap = e.move({ from: 'e4', to: 'd5', color: 'w' }, later);
  assert.ok(cap.ok && cap.record.captured === 'p');
  assert.equal(e.move({ from: 'g8', to: 'f6', color: 'w' }, later + 1000).ok, false, 'cannot move enemy pieces');
});

test('arcade: taking the king wins; timer falls back to material', () => {
  const e = new ArcadeEngine({ fen: '4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1' });
  assert.ok(e.move({ from: 'e2', to: 'e8', color: 'w' }, 5000).ok);
  assert.deepEqual(e.result, { winner: 'w', reason: 'checkmate' });
  const t = new ArcadeEngine({ fen: '4k3/pppp4/8/8/8/8/PP6/4K3 w - - 0 1' });
  assert.deepEqual(t.decideOnTime(), { winner: 'b', reason: 'timeout' });
  const f = createEngine('arcade');
  assert.equal(f.kind, 'arcade');
  assert.equal(restoreEngine(f.snapshot()).kind, 'arcade');
  assert.ok(new ArcadeEngine().aiMove('b', 0));
});
