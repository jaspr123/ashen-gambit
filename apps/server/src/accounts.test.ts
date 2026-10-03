// Accounts: create with password, log in on another "device", wrong passwords, guest securing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io } from 'socket.io-client';
import type { SelfProfile } from '@ashen/shared';

const PORT = 3920 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const post = async (p: string, body: unknown, token?: string) => {
  const r = await fetch(`${URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return r.json() as Promise<{ ok: boolean; data?: any; error?: string }>;
};
const authOver = (token: string) => new Promise<SelfProfile>((res, rej) => {
  const s = io(URL, { transports: ['websocket'] });
  s.emit('auth', { token }, (r: { ok: boolean; data?: { profile: SelfProfile }; error?: string }) => { s.disconnect(); r.ok ? res(r.data!.profile) : rej(new Error(r.error)); });
});

test('accounts: register, log in elsewhere, reject bad passwords, secure a guest', { timeout: 60_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-acct-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal((await post('/api/register', { name: 'Ironside', password: 'short' })).error, 'weak_password');
    const reg = await post('/api/register', { name: 'Ironside', password: 'test-pass-1234' });
    assert.ok(reg.ok && reg.data.token);
    assert.equal((await post('/api/register', { name: 'ironside', password: 'test-pass-1234' })).error, 'name_taken');
    const me = await authOver(reg.data.token);
    assert.equal(me.name, 'Ironside');
    assert.equal(me.hasPassword, true);

    assert.equal((await post('/api/login', { name: 'Ironside', password: 'wrong-password' })).error, 'bad_credentials');
    const second = await post('/api/login', { name: 'IRONSIDE', password: 'test-pass-1234' });
    assert.ok(second.ok && second.data.token !== reg.data.token, 'new per-device session');
    assert.equal((await authOver(second.data.token)).id, me.id, 'same account on the second device');
    assert.equal((await authOver(reg.data.token)).id, me.id, 'first device still signed in');

    await post('/api/logout', {}, second.data.token);
    const after = await authOver(second.data.token);
    assert.notEqual(after.id, me.id, 'logged-out token no longer reaches the account');

    // Guest -> secured account.
    const g = io(URL, { transports: ['websocket'] });
    const guest = await new Promise<{ token: string; profile: SelfProfile }>((res) => g.emit('auth', { name: 'Drifter' }, (r: any) => res(r.data)));
    assert.equal(guest.profile.hasPassword, false);
    const secured = await new Promise<any>((res) => g.emit('account:password', { password: 'guest-pass-5678' }, res));
    assert.ok(secured.ok && secured.data.hasPassword);
    g.disconnect();
    const login = await post('/api/login', { name: 'Drifter', password: 'guest-pass-5678' });
    assert.equal((await authOver(login.data.token)).id, guest.profile.id);
  } finally {
    proc.kill();
  }
});
