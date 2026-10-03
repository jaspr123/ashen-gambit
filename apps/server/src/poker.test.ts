// Scrap Poker over the network: buy-in from the bank, bots, hidden cards, acting, cash-out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { DERBY_START_CREDITS, POKER_TABLES, type PokerView, type SelfProfile } from '@ashen/shared';

const PORT = 3910 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const until = <T,>(s: Socket, ev: string, pred: (x: T) => boolean, ms = 30000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x); } };
    s.on(ev, h);
  });

test('poker: buy in with credits, play against bots with hidden cards, cash out', { timeout: 90_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-poker-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY: '0', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const a = io(URL, { transports: ['websocket'] });
    await call(a, 'auth', { name: 'Shark' });
    const def = POKER_TABLES[0];
    const buyIn = def.parts * def.partValue;
    const self = until<SelfProfile>(a, 'profile:self', (p) => p.credits === DERBY_START_CREDITS - buyIn);
    const v = await call<PokerView>(a, 'poker:join', { tableId: def.id });
    await self;
    assert.ok(v.you !== null);
    assert.ok(v.seats.filter(Boolean).length >= 3, 'bots fill the table');
    await assert.rejects(call(a, 'poker:join', { tableId: def.id }), /already_seated/);
    // Wait for a dealt hand and check hidden information.
    const dealt = await until<PokerView>(a, 'poker:state', (s) => s.street === 'preflop');
    const mine = dealt.seats[dealt.you!]!;
    assert.equal(mine.cards?.length, 2, 'I see my own cards');
    assert.equal(mine.parts, def.parts, 'full robot to start');
    assert.ok(dealt.seats.filter((s) => s && !s.you && !s.folded).every((s) => s!.cards === null), "others' cards stay face down");
    // Act whenever it's my turn, until a hand finishes.
    const done = until<PokerView>(a, 'poker:state', (s) => s.street === 'showdown', 60000);
    const onTurn = (s: PokerView) => { if (s.options && s.toAct === s.you) void call(a, 'poker:act', { tableId: def.id, action: s.options.canCheck ? 'check' : 'call' }).catch(() => {}); };
    a.on('poker:state', onTurn);
    onTurn(dealt);
    const end = await done;
    assert.ok(end.result && end.result.winners.length >= 1);
    a.off('poker:state', onTurn);
    const after = until<SelfProfile>(a, 'profile:self', () => true);
    await call(a, 'poker:leave', { tableId: def.id });
    const p = await after;
    assert.ok(p.credits >= 0 && p.credits !== DERBY_START_CREDITS - buyIn, 'stack returned to the bank');
    a.disconnect();
  } finally {
    proc.kill();
  }
});
