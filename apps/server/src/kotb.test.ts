// King-of-the-Board rotation: winner stays, loser walks, next challenger steps up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import type { LobbySnapshot, MatchState, MatchUpdate } from '@ashen/shared';

const PORT = 3990 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const once = <T,>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 20000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x); } };
    s.on(ev, h);
  });

test('king of the board: winner holds the table, next challenger steps in', { timeout: 90_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-kotb-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const [a, b, c] = [io(URL, { transports: ['websocket'] }), io(URL, { transports: ['websocket'] }), io(URL, { transports: ['websocket'] })];
    await call(a, 'auth', { name: 'Alpha' }); await call(b, 'auth', { name: 'Bravo' }); const rc = await call(c, 'auth', { name: 'Charlie' });

    const firstA = once<MatchState>(a, 'match:state'), firstB = once<MatchState>(b, 'match:state');
    await call(a, 'queue:join', { kind: 'kotb', arenaId: 'kotb-1' });
    await call(b, 'queue:join', { kind: 'kotb', arenaId: 'kotb-1' });
    const [ma] = await Promise.all([firstA, firstB]);
    assert.equal(ma.arenaId, 'kotb-1');
    assert.equal(ma.mode, 'kotb');
    // Charlie lines up behind them.
    await call(c, 'queue:join', { kind: 'kotb', arenaId: 'kotb-1' });
    const lobby = await once<LobbySnapshot>(c, 'lobby:snapshot', (s) => s.arenas.some((x) => x.id === 'kotb-1' && x.queue.some((q) => q.id === rc.profile.id)));
    assert.ok(lobby.arenas.find((x) => x.id === 'kotb-1')!.matchId);

    // Play two plies, then white resigns -> black wins and holds the table.
    const white = ma.youAre === 'w' ? a : b, black = ma.youAre === 'w' ? b : a;
    const blackName = ma.youAre === 'w' ? 'Bravo' : 'Alpha';
    await once<MatchUpdate>(white, 'match:update', (u) => u.status === 'playing');
    await call(white, 'match:move', { matchId: ma.id, from: 'e2', to: 'e4', ply: 0 });
    await call(black, 'match:move', { matchId: ma.id, from: 'e7', to: 'e5', ply: 1 });
    const nextForCharlie = once<MatchState>(c, 'match:state', () => true, 30000);
    await call(white, 'match:resign', { matchId: ma.id });

    const m2 = await nextForCharlie;
    assert.equal(m2.arenaId, 'kotb-1');
    const names = [m2.players.w.name, m2.players.b.name];
    assert.ok(names.includes('Charlie') && names.includes(blackName), `champion ${blackName} should face Charlie, got ${names}`);
    assert.equal(m2.players.w.name, 'Charlie', 'challenger takes white');
    const snap = await once<LobbySnapshot>(c, 'lobby:snapshot', (s) => s.arenas.find((x) => x.id === 'kotb-1')?.matchId === m2.id);
    assert.equal(snap.arenas.find((x) => x.id === 'kotb-1')!.champion?.name, blackName);
    [a, b, c].forEach((s) => s.disconnect());
  } finally {
    proc.kill();
  }
});
