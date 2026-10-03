// Pre-match draft: armies and sabotage are picked before the board locks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_FINISHERS, type MatchState, type MatchUpdate } from '@ashen/shared';

const PORT = 3940 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const once = <T,>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 15000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x); } };
    s.on(ev, h);
  });

test('draft: players pick armies + sabotage, lock in, and the match starts with the drafted armies', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-draft-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '15000' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] });
    await call(a, 'auth', { name: 'Drafter' }); await call(b, 'auth', { name: 'Picker' });
    const lo = (faction: string) => ({ faction, mode: 'war', finishers: DEFAULT_FINISHERS, timeControl: { minutes: 10, incrementSec: 0 }, abilityVisibility: 'secret' });
    await call(a, 'loadout:set', lo('remnants')); await call(b, 'loadout:set', lo('remnants'));
    const sa = once<MatchState>(a, 'match:state'), sb = once<MatchState>(b, 'match:state');
    await call(a, 'queue:join', { kind: 'quick' }); await call(b, 'queue:join', { kind: 'quick' });
    const [ma] = await Promise.all([sa, sb]);
    assert.equal(ma.status, 'picking');
    assert.ok(ma.pick && ma.pick.sabotage && ma.pick.allowed.length >= 4);
    await assert.rejects(call(a, 'match:move', { matchId: ma.id, from: 'e2', to: 'e4', ply: 0 }), /not_started/);
    await assert.rejects(call(a, 'match:pick', { matchId: ma.id, faction: 'custom:nope' }), /army_not_allowed/);
    const seenP = once<MatchState>(b, 'match:state', (s) => s.pick?.opponentReady === true);
    await call(a, 'match:pick', { matchId: ma.id, faction: 'vault', sabotage: 'sab_saboteur', ready: true });
    const seen = await seenP;
    assert.equal(seen.players[ma.youAre as 'w' | 'b'].faction, 'remnants', 'opponent army stays hidden until the draft locks');
    const locked = once<MatchState>(a, 'match:state', (s) => s.status === 'countdown');
    await call(b, 'match:pick', { matchId: ma.id, faction: 'machines', ready: true });
    const st = await locked;
    const meA = ma.youAre as 'w' | 'b', meB = meA === 'w' ? 'b' : 'w';
    assert.equal(st.players[meA].faction, 'vault');
    assert.equal(st.players[meB].faction, 'machines');
    assert.equal(st.abilityView?.faction[meA], 'vault', 'engine rebuilt with the drafted doctrine');
    assert.ok(st.abilityView!.own.some((x) => x.id === 'sab_saboteur'), 'sabotage armed');
    assert.ok(st.abilityView!.effects.some((e) => e.source === 'sab_saboteur'), 'saboteur jammed two enemy pieces');
    a.disconnect(); b.disconnect();
  } finally {
    proc.kill();
  }
});
