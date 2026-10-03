import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DERBY_ROSTER, RACE_DISTANCE } from './derby/data.js';
import { priceRace, simulateRace } from './derby/sim.js';

const field = DERBY_ROSTER.slice(0, 8).map((def, lane) => ({ id: def.id, lane, def }));

test('derby: race is deterministic, everyone finishes, timeline is replayable', () => {
  const a = simulateRace('r1', 1234, field, { record: true });
  const b = simulateRace('r1', 1234, field, { record: true });
  assert.deepEqual(a.finishOrder, b.finishOrder);
  assert.equal(a.events.length, b.events.length);
  assert.equal(a.finishOrder.length, 8);
  const winT = a.finishTimes[a.finishOrder[0]];
  assert.ok(winT > 25 && winT < 70, `winning time ${winT}s`);
  assert.ok(a.frames.length > winT / a.step, 'frames cover the race');
  assert.equal(a.frames[0].length, 8 * 4);
  const last = a.frames[a.frames.length - 1];
  for (let i = 0; i < 8; i++) assert.ok(last[i * 4] >= RACE_DISTANCE, 'all past the post at the end');
  const kinds = new Set(a.events.map((e) => e.kind));
  assert.ok(kinds.has('attack') && kinds.has('finish'), `jockeys fight: ${[...kinds]}`);
});

test('derby: secret upgrades change the race; odds favour the stronger horses', () => {
  const odds = priceRace(99, field, 160);
  for (const id of Object.keys(odds)) {
    assert.ok(odds[id].win >= odds[id].place && odds[id].place >= odds[id].show, `${id} win>=place>=show`);
    assert.ok(odds[id].show >= 1.05);
  }
  // Load one runner with every upgrade: it should win far more often than its odds imply.
  const target = field[4].id;
  let wins = 0, base = 0;
  for (let s = 0; s < 60; s++) {
    if (simulateRace('x', s, field).finishOrder[0] === target) base++;
    const boosted = field.map((e) => (e.id === target ? { ...e, upgrades: ['nitro_oats', 'iron_lungs', 'plated_barding', 'grapple_hook', 'trick_rider'] as never } : e));
    if (simulateRace('x', s, boosted).finishOrder[0] === target) wins++;
  }
  assert.ok(wins > base, `upgraded wins ${wins} vs plain ${base}`);
});
