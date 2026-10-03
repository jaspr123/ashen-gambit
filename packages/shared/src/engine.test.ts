import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessEngine } from './chess/engine.js';
import { CombatRegistry } from './combat/resolver.js';
import { FINISHERS } from './game-data/finishers.js';
import { CombatSequenceSchema } from './combat/timeline.js';

test('standard: fool\'s mate is checkmate', () => {
  const e = new ChessEngine();
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']] as const) {
    assert.equal(e.move({ from, to }).ok, true);
  }
  assert.deepEqual(e.result, { winner: 'b', reason: 'checkmate' });
  assert.equal(e.move({ from: 'a2', to: 'a3' }).ok, false);
});

test('rejects illegal and duplicate moves', () => {
  const e = new ChessEngine();
  assert.equal(e.move({ from: 'e2', to: 'e5' }).ok, false);
  assert.equal(e.move({ from: 'e2', to: 'e4' }).ok, true);
  assert.equal(e.move({ from: 'e2', to: 'e4' }).ok, false);
});

test('threefold repetition is detected by our own tracker', () => {
  const e = new ChessEngine();
  const cycle = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']] as const;
  for (let i = 0; i < 2; i++) for (const [from, to] of cycle) e.move({ from, to });
  assert.equal(e.result?.reason, 'threefold');
});

test('promotion and en passant work', () => {
  const e = new ChessEngine({ fen: '8/P6k/8/8/8/8/8/K7 w - - 0 1' });
  assert.equal(e.move({ from: 'a7', to: 'a8', promotion: 'q' }).ok, true);
  assert.equal(e.get('a8')?.type, 'q');
  const ep = new ChessEngine({ fen: 'k7/8/8/3pP3/8/8/8/K7 w - d6 0 1' });
  const r = ep.move({ from: 'e5', to: 'd6' });
  assert.equal(r.ok && r.record.captured, 'p');
});

test('war: shield field blocks capture for one enemy turn', () => {
  const e = new ChessEngine({ fen: 'k7/8/8/3p4/4P3/8/8/K7 b - - 0 1', war: { w: 'remnants', b: 'machines' } });
  const used = e.useAbility('b', { abilityId: 'mac_shield', target: 'd5' });
  assert.equal(used.ok, true);
  assert.equal(e.move({ from: 'a8', to: 'b8' }).ok, true);
  assert.equal(e.legalMoves('e4').some((m) => m.to === 'd5'), false, 'shielded pawn cannot be captured');
  assert.equal(e.move({ from: 'e4', to: 'e5' }).ok, true);
  assert.equal(e.effects.some((x) => x.kind === 'shield'), false, 'shield expired');
});

test('war: restrictions never apply while in check', () => {
  const e = new ChessEngine({ fen: 'k7/8/8/8/8/8/1q6/K7 w - - 0 1', war: { w: 'vault', b: 'machines' } });
  assert.ok(e.legalMoves().some((m) => m.to === 'b2'));
});

test('war: scrap mine destroys the first enemy piece to stop on it', () => {
  const e = new ChessEngine({ fen: 'k7/8/8/8/8/8/4P3/K7 b - - 0 1', war: { w: 'remnants', b: 'wastelanders' } });
  assert.equal(e.useAbility('b', { abilityId: 'wl_mine', target: 'e4' }).ok, true);
  const view = e.abilityView('w', 'secret')!;
  assert.equal(view.effects.some((x) => x.kind === 'mine'), false, 'mine hidden from enemy');
  e.move({ from: 'a8', to: 'b8' });
  const r = e.move({ from: 'e2', to: 'e4' });
  assert.ok(r.ok && r.events.some((ev) => ev.type === 'mine_detonated'));
  assert.equal(e.get('e4'), undefined);
});

test('war: phase shift consumes the turn and cannot expose own king', () => {
  const e = new ChessEngine({ fen: 'k7/8/8/8/8/8/8/KN5r w - - 0 1', war: { w: 'vault', b: 'remnants' } });
  // Knight on b1 is pinned by the rook on h1: it may only phase to squares that keep the pin blocked.
  const dests = e.abilityTargets('w', 'vault_phase', 'b1');
  assert.ok(dests.length > 0 && dests.every((s) => s.endsWith('1')), dests.join(','));
  const e2 = new ChessEngine({ fen: 'k7/8/8/8/8/8/8/KN6 w - - 0 1', war: { w: 'vault', b: 'remnants' } });
  const r = e2.useAbility('w', { abilityId: 'vault_phase', target: 'b1', target2: 'd3' });
  assert.equal(r.ok, true);
  assert.equal(e2.turn(), 'b');
  assert.equal(e2.get('d3')?.type, 'n');
});

test('combat resolver fallback chain', () => {
  const reg = new CombatRegistry();
  const base = { attackerFaction: 'machines', defenderFaction: 'remnants', attackerRig: 'mechanical', defenderRig: 'humanoid', defenderDeaths: ['backward_collapse'], seed: 3 } as const;
  assert.equal(reg.resolve({ ...base, attackerClass: 'knight', defenderClass: 'pawn', finisherId: 'knight_f3' }).matchedKey, 'knight_vs_pawn:knight_f3');
  assert.equal(reg.resolve({ ...base, attackerClass: 'knight', defenderClass: 'queen', finisherId: 'knight_f3' }).matchedKey, 'knight:knight_f3');
  assert.equal(reg.resolve({ ...base, attackerClass: 'knight', defenderClass: 'queen', finisherId: 'nope' }).matchedKey, 'faction_machines_capture');
  assert.equal(reg.resolve({ ...base, attackerFaction: 'custom:x', attackerClass: 'knight', defenderClass: 'queen', finisherId: 'nope' }).matchedKey, 'base_capture');
  const r = reg.resolve({ ...base, attackerClass: 'rook', defenderClass: 'pawn', finisherId: 'rook_f2', seed: 9 });
  assert.equal(r.deathType, 'backward_collapse', 'auto death uses a supported type');
  const k = reg.resolve({ ...base, attackerClass: 'rook', defenderClass: 'pawn', finisherId: 'rook_f1', seed: 9 });
  assert.equal(k.deathType, 'knockback_death', 'explicit family-compatible death is honoured');
});

test('all built-in finisher sequences are schema-valid', () => {
  for (const f of FINISHERS) assert.equal(CombatSequenceSchema.safeParse(f.sequence).success, true, f.id);
});
