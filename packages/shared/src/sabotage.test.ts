import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessEngine } from './chess/engine.js';

const war = { w: 'remnants', b: 'wastelanders' } as const;

test('killstreak: two captures in a row earn an airstrike; an enemy capture resets the streak', () => {
  // White can capture twice in a row: Bxf7+... use a simple position with hanging black pieces.
  const e = new ChessEngine({ fen: 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', war });
  const air = () => e.abilities!.w.find((a) => a.id === 'ks_airstrike')!;
  assert.equal(air().charges, 0);
  assert.ok(e.move({ from: 'e4', to: 'd5' }).ok);           // capture 1
  assert.ok(e.move({ from: 'd8', to: 'd5' }).ok);           // black recaptures -> white streak reset
  assert.equal(e.streak.w, 0);
  assert.ok(e.move({ from: 'b1', to: 'c3' }).ok);
  assert.ok(e.move({ from: 'd5', to: 'd4' }).ok);
  assert.ok(e.move({ from: 'c3', to: 'b5' }).ok);
  assert.ok(e.move({ from: 'd4', to: 'd3' }).ok);
  assert.ok(e.move({ from: 'c2', to: 'd3' }).ok);           // white capture 1 (queen)
  assert.ok(e.move({ from: 'a7', to: 'a6' }).ok);
  assert.ok(e.move({ from: 'b5', to: 'c7' }).ok);           // white capture 2 -> airstrike
  assert.equal(air().charges, 1, 'airstrike earned');
});

test('airstrike destroys the target and adjacent enemy pieces, never the king', () => {
  const e = new ChessEngine({ fen: '4k3/8/8/2ppp3/3n4/8/8/4K3 w - - 0 1', war });
  e.abilities!.w.find((a) => a.id === 'ks_airstrike')!.charges = 1;
  const out = e.useAbility('w', { abilityId: 'ks_airstrike', target: 'd4' });
  assert.ok(out.ok, JSON.stringify(out));
  for (const s of ['d4', 'c5', 'd5', 'e5'] as const) assert.equal(e.get(s), undefined, `${s} cleared`);
  assert.equal(e.get('e8')?.type, 'k');
  assert.equal(e.turn(), 'b', 'airstrike uses the turn');
});

test('sabotage: saboteur jams two enemy pieces, jammer delays enemy abilities, minefield arms mines', () => {
  const e = new ChessEngine({ war });
  assert.ok(e.armSabotage('w', 'sab_saboteur', () => 0));
  const frozen = e.effects.find((x) => x.source === 'sab_saboteur')!;
  assert.equal(frozen.squares.length, 2);
  assert.ok(e.armSabotage('b', 'sab_jammer'));
  assert.ok(e.abilities!.w.filter((a) => a.id !== 'ks_airstrike' && a.id !== 'sab_saboteur').every((a) => a.id === 'rem_intel' || a.cooldownUntilPly >= 8), 'white actives on cooldown');
  assert.equal(e.armSabotage('b', 'sab_minefield'), false, 'one sabotage per side');
  const e2 = new ChessEngine({ war });
  assert.ok(e2.armSabotage('w', 'sab_minefield'));
  assert.ok(e2.useAbility('w', { abilityId: 'sab_minefield', target: 'e5' }).ok);
  assert.ok(e2.effects.some((x) => x.kind === 'mine' && x.squares.includes('e5')));
});
