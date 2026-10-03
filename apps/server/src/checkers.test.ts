// War Chess over the network: hidden information never leaves the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_FINISHERS, type MatchState, type MatchUpdate } from '@ashen/shared';

const PORT = 3950 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const once = <T,>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 15000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x); } };
    s.on(ev, h);
  });

test('battle checkers: networked match, mandatory jump, capture square recorded', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-chk-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] });
    await call(a, 'auth', { name: 'Jumper' }); await call(b, 'auth', { name: 'Crowner' });
    const lo = (faction: string) => ({ faction, mode: 'checkers', finishers: DEFAULT_FINISHERS, timeControl: { minutes: 10, incrementSec: 0 }, abilityVisibility: 'off' });
    await call(a, 'loadout:set', lo('machines'));
    await call(b, 'loadout:set', lo('vault'));
    const sa = once<MatchState>(a, 'match:state'), sb = once<MatchState>(b, 'match:state');
    await call(a, 'queue:join', { kind: 'quick' }); await call(b, 'queue:join', { kind: 'quick' });
    const [ma] = await Promise.all([sa, sb]);
    assert.equal(ma.mode, 'checkers');
    assert.equal(ma.fen.split(' ')[0], '1p1p1p1p/p1p1p1p1/1p1p1p1p/8/8/P1P1P1P1/1P1P1P1P/P1P1P1P1');
    const white = ma.youAre === 'w' ? a : b, black = ma.youAre === 'w' ? b : a;
    await once<MatchUpdate>(white, 'match:update', (u) => u.status === 'playing');
    await call(white, 'match:move', { matchId: ma.id, from: 'c3', to: 'd4', ply: 0 });
    await call(black, 'match:move', { matchId: ma.id, from: 'f6', to: 'e5', ply: 1 });
    // A quiet move is refused while a jump is available.
    await assert.rejects(call(white, 'match:move', { matchId: ma.id, from: 'a3', to: 'b4', ply: 2 }));
    const upd = once<MatchUpdate>(black, 'match:update', (u) => u.move?.from === 'd4');
    await call(white, 'match:move', { matchId: ma.id, from: 'd4', to: 'f6', ply: 2 });
    const u = await upd;
    assert.equal(u.move!.captured, 'p');
    assert.equal(u.move!.captureSquare, 'e5');
    assert.equal(u.fen.split(' ')[1], 'b', 'no further jump: turn passes');
    a.disconnect(); b.disconnect();
  } finally {
    proc.kill();
  }
});
