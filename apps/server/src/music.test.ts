// Music: admin claim code, upload validation, playlist broadcast, reorder, delete; non-admins refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import type { MusicTrack, SelfProfile } from '@ashen/shared';

const PORT = 3980 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const CODE = 'test-admin-code-123';
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const upload = async (token: string, body: Buffer, title: string) => {
  const r = await fetch(`${URL}/api/music`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Title': encodeURIComponent(title), 'X-Artist': 'Tester' }, body });
  return r.json() as Promise<{ ok: boolean; data?: MusicTrack; error?: string }>;
};

test('music: admin uploads, everyone sees the playlist, non-admins are refused', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-music-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '0', DERBY: '0', PICK_MS: '0', ADMIN_CODE: CODE }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] });
    const ra = await call<{ token: string; profile: SelfProfile }>(a, 'auth', { name: 'Deejay' });
    const rb = await call<{ token: string; profile: SelfProfile }>(b, 'auth', { name: 'Listener' });
    const ogg = fs.readFileSync(path.join('..', 'client', 'public', 'assets', 'audio', 'gun_rifle.ogg'));
    assert.equal((await upload(ra.token, ogg, 'Nope')).error, 'forbidden', 'not admin yet');
    await assert.rejects(call(a, 'account:claim-admin', { code: 'wrong-code-xxxx' }), /bad_admin_code/);
    const me = await call<SelfProfile>(a, 'account:claim-admin', { code: CODE });
    assert.equal(me.isAdmin, true);
    assert.equal((await upload(ra.token, Buffer.from('definitely not audio data'), 'Junk')).error, 'not_audio');
    const pushed = new Promise<MusicTrack[]>((res) => b.once('music:playlist', res));
    const up = await upload(ra.token, ogg, 'Rifle Song');
    assert.ok(up.ok && up.data!.url.startsWith('/uploads/music/'));
    assert.equal((await pushed)[0].title, 'Rifle Song', 'playlist broadcast to everyone');
    const file = await fetch(`${URL}${up.data!.url}`);
    assert.equal(file.status, 200);
    await upload(ra.token, ogg, 'Second');
    await call(a, 'music:move', { id: up.data!.id, delta: 1 });
    const list = await call<MusicTrack[]>(b, 'music:list');
    assert.deepEqual(list.map((t) => t.title), ['Second', 'Rifle Song']);
    await assert.rejects(call(b, 'music:remove', { id: up.data!.id }), /forbidden/);
    await call(a, 'music:remove', { id: up.data!.id });
    assert.equal((await call<MusicTrack[]>(b, 'music:list')).length, 1);
    assert.equal(rb.profile.isAdmin, false);
    a.disconnect(); b.disconnect();
  } finally {
    proc.kill();
  }
});
