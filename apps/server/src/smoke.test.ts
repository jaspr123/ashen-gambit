// End-to-end smoke test: boots the real server on a temp data dir and plays
// a full game over Socket.IO with two clients and a spectator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import type { LobbySnapshot, MatchState, MatchUpdate } from '@ashen/shared';

const PORT = 3900 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;

function call<T = any>(s: Socket, ev: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => s.emit(ev, payload, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? resolve(r.data as T) : reject(new Error(r.error)))));
}
function once<T>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); resolve(x); } };
    s.on(ev, h);
  });
}

test('two players queue, match, play to checkmate, spectator watches', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    assert.ok(log.includes('server on'), log);

    const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] }), spec = io(URL, { transports: ['websocket'] });
    const ra = await call(a, 'auth', { name: 'Alpha' });
    const rb = await call(b, 'auth', { name: 'Bravo' });
    await call(spec, 'auth', { name: 'Watcher' });
    assert.ok(ra.token && rb.token, 'tokens issued');

    const stateA = once<MatchState>(a, 'match:state');
    const stateB = once<MatchState>(b, 'match:state');
    await call(a, 'queue:join', { kind: 'quick' });
    await call(b, 'queue:join', { kind: 'quick' });
    const [sa, sb] = await Promise.all([stateA, stateB]);
    assert.equal(sa.id, sb.id);
    const white = sa.youAre === 'w' ? a : b, black = sa.youAre === 'w' ? b : a;

    // Spectator finds the match in the lobby and joins.
    const snap = await once<LobbySnapshot>(spec, 'lobby:snapshot', (x) => x.matches.some((m) => m.id === sa.id));
    assert.ok(snap.players.some((p) => p.name === 'Alpha' && p.status === 'playing'));
    const specState = once<MatchState>(spec, 'match:state');
    await call(spec, 'match:spectate', { matchId: sa.id });
    assert.equal((await specState).youAre, 'spectator');

    await once<MatchUpdate>(white, 'match:update', (u) => u.status === 'playing', 10_000);
    // Illegal move and wrong-turn move are rejected by the server.
    await assert.rejects(call(white, 'match:move', { matchId: sa.id, from: 'e2', to: 'e5', ply: 0 }), /illegal_move/);
    await assert.rejects(call(black, 'match:move', { matchId: sa.id, from: 'e7', to: 'e5', ply: 0 }), /not_your_turn/);
    const moves: [Socket, string, string][] = [[white, 'f2', 'f3'], [black, 'e7', 'e5'], [white, 'g2', 'g4'], [black, 'd8', 'h4']];
    const specEnd = once<MatchUpdate>(spec, 'match:update', (u) => u.status === 'ended');
    for (let i = 0; i < moves.length; i++) {
      const [s, from, to] = moves[i];
      await call(s, 'match:move', { matchId: sa.id, from, to, ply: i });
    }
    // Duplicate submission of an old ply is rejected.
    await assert.rejects(call(white, 'match:move', { matchId: sa.id, from: 'a2', to: 'a3', ply: 3 }), /stale_ply|game_over/);
    const end = await specEnd;
    assert.deepEqual(end.result, { winner: 'b', reason: 'checkmate' });

    const hist = await call<any[]>(white, 'history:list', {});
    for (let i = 0; i < 20 && !hist.length; i++) { await new Promise((r) => setTimeout(r, 200)); hist.push(...(await call<any[]>(white, 'history:list', {}))); }
    assert.equal(hist[0].id, sa.id);
    const replay = await call(white, 'replay:get', { gameId: sa.id });
    assert.equal(replay.moves.length, 4);

    // Reconnect with the stored token resumes the same identity.
    a.disconnect();
    const a2 = io(URL, { transports: ['websocket'] });
    const again = await call(a2, 'auth', { token: ra.token });
    assert.equal(again.profile.id, ra.profile.id);
    assert.equal(again.profile.stats.gamesPlayed, 1);
    [a2, b, spec].forEach((s) => s.disconnect());
  } finally {
    proc.kill();
  }
});
