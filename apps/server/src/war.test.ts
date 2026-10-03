// War Chess over the network: hidden information never leaves the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_FINISHERS, type MatchState, type MatchUpdate } from '@ashen/shared';

const PORT = 3970 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const once = <T,>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 15000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x); } };
    s.on(ev, h);
  });

test('war chess: hidden mine is invisible to opponent and spectators, abilities validated server-side', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-war-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] }), spec = io(URL, { transports: ['websocket'] });
    await call(a, 'auth', { name: 'Raider' }); await call(b, 'auth', { name: 'Soldier' }); await call(spec, 'auth', { name: 'Eyes' });
    const lo = (faction: string) => ({ faction, mode: 'war', finishers: DEFAULT_FINISHERS, timeControl: { minutes: 10, incrementSec: 0 }, abilityVisibility: 'secret' });
    await call(a, 'loadout:set', lo('wastelanders'));
    await call(b, 'loadout:set', lo('remnants'));
    // A locked finisher is rejected server-side.
    await assert.rejects(call(a, 'loadout:set', { ...lo('wastelanders'), finishers: { ...DEFAULT_FINISHERS, king: 'king_f3' } }), /finisher_locked/);

    const sa = once<MatchState>(a, 'match:state'), sb = once<MatchState>(b, 'match:state');
    await call(a, 'queue:join', { kind: 'quick' }); await call(b, 'queue:join', { kind: 'quick' });
    const [ma, mb] = await Promise.all([sa, sb]);
    assert.equal(ma.mode, 'war');
    assert.ok(ma.abilityView && mb.abilityView);
    // SECRET: the opponent's abilities are hidden ids.
    assert.ok(mb.abilityView!.enemy.every((e) => e.id === null));
    // Socket a is always the Wastelanders raider; colours are assigned randomly.
    const raider = a, soldier = b;
    const raiderColor = ma.youAre;
    await call(spec, 'match:spectate', { matchId: ma.id });
    await once<MatchUpdate>(raider, 'match:update', (u) => u.status === 'playing');

    let ply = 0;
    if (raiderColor === 'b') { await call(soldier, 'match:move', { matchId: ma.id, from: 'e2', to: 'e4', ply: ply++ }); }
    // Invalid target is refused by the server, whatever the client claims.
    await assert.rejects(call(raider, 'match:ability', { matchId: ma.id, abilityId: 'wl_mine', target: 'e1', ply }), /invalid_target/);
    const square = raiderColor === 'w' ? 'h4' : 'h5';
    const soldierUpdate = once<MatchUpdate>(soldier, 'match:update');
    const specUpdate = once<MatchUpdate>(spec, 'match:update');
    const ownUpdate = once<MatchUpdate>(raider, 'match:update');
    await call(raider, 'match:ability', { matchId: ma.id, abilityId: 'wl_mine', target: square, ply });
    const [su, sp, own] = await Promise.all([soldierUpdate, specUpdate, ownUpdate]);
    assert.ok(own.abilityView!.effects.some((e) => e.kind === 'mine' && e.squares.includes(square as never)), 'owner sees the mine');
    for (const u of [su, sp]) {
      assert.equal(u.abilityView!.effects.some((e) => e.kind === 'mine'), false, 'mine effect leaked');
      assert.equal((u.abilityEvents ?? []).some((e) => e.type === 'ability_used'), false, 'mine placement event leaked');
      assert.equal(JSON.stringify(u).includes(`"${square}"`), false, 'mine square leaked anywhere in the payload');
    }
    // Using a second free action in the same turn is refused.
    await assert.rejects(call(raider, 'match:ability', { matchId: ma.id, abilityId: 'wl_mine', target: raiderColor === 'w' ? 'a4' : 'a5', ply }), /no_charges|already_used_this_turn/);
    [a, b, spec].forEach((s) => s.disconnect());
  } finally {
    proc.kill();
  }
});
