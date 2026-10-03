// Arcade Chess over the network: no turns, both players move at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_FINISHERS, type MatchState, type MatchUpdate } from '@ashen/shared';

const PORT = 3960 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const once = <T,>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 15000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x); } };
    s.on(ev, h);
  });

test('arcade: both players move simultaneously; the server orders and broadcasts them', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-arcade-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] });
    await call(a, 'auth', { name: 'Fasty' }); await call(b, 'auth', { name: 'Quicky' });
    const sa = once<MatchState>(a, 'match:state'), sb = once<MatchState>(b, 'match:state');
    await call(a, 'queue:join', { kind: 'quick', mode: 'arcade' }); await call(b, 'queue:join', { kind: 'quick', mode: 'arcade' });
    const [ma] = await Promise.all([sa, sb]);
    assert.equal(ma.mode, 'arcade');
    const white = ma.youAre === 'w' ? a : b, black = ma.youAre === 'w' ? b : a;
    await once<MatchUpdate>(white, 'match:update', (u) => u.status === 'playing');
    const both = once<MatchUpdate>(white, 'match:update', (u) => u.ply === 2);
    await Promise.all([
      call(white, 'match:move', { matchId: ma.id, from: 'e2', to: 'e4', ply: 0 }),
      call(black, 'match:move', { matchId: ma.id, from: 'e7', to: 'e5', ply: 0 }),
    ]);
    const u = await both;
    assert.ok(u.fen.startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR'), u.fen);
    await assert.rejects(call(white, 'match:move', { matchId: ma.id, from: 'e4', to: 'e5', ply: 2 }), /cooldown|illegal_move|too_fast/);
    await assert.rejects(call(black, 'match:move', { matchId: ma.id, from: 'd2', to: 'd4', ply: 2 }), /not_your_piece/);
    a.disconnect(); b.disconnect();
  } finally {
    proc.kill();
  }
});
