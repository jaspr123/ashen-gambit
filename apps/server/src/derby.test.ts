// Wasteland Derby over the network: betting, secret upgrades, hidden information, payouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { DERBY_START_CREDITS as START, DERBY_STIPEND, DERBY_UPGRADES, type DerbyState, type SelfProfile } from '@ashen/shared';

const PORT = 3930 + Math.floor(Math.random() * 9);
const URL = `http://localhost:${PORT}`;
const call = <T = any>(s: Socket, ev: string, p: unknown = {}): Promise<T> =>
  new Promise((res, rej) => s.emit(ev, p, (r: { ok: boolean; data?: T; error?: string }) => (r.ok ? res(r.data as T) : rej(new Error(r.error)))));
const once = <T,>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 15000): Promise<T> =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x); } };
    s.on(ev, h);
  });

test('wasteland derby: bets, secret upgrades, hidden info, settlement', { timeout: 90_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashen-derby-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'up'), DEV_TOOLS: '1', DERBY_FAST: '1', PICK_MS: '0' }, stdio: 'pipe' });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('server on'); i++) await new Promise((r) => setTimeout(r, 250));
    const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] });
    const ra = await call<{ profile: SelfProfile }>(a, 'auth', { name: 'Punter' }); await call(b, 'auth', { name: 'Tout' });
    assert.equal(ra.profile.credits, START);
    // Wait for a card that is open for betting with time to spare.
    let sa = await call<DerbyState | null>(a, 'derby:watch', { on: true });
    while (!sa || sa.phase !== 'betting' || sa.bettingClosesAt - sa.serverNow < 3000) sa = await once<DerbyState>(a, 'derby:state');
    await call(b, 'derby:watch', { on: true });
    assert.equal(sa.runners.length, 8);
    const fav = [...sa.runners].sort((x, y) => x.odds.win - y.odds.win)[0];
    assert.ok(sa.runners.every((r) => r.odds.win >= r.odds.place && r.odds.place >= r.odds.show), 'odds ladder');

    await assert.rejects(call(a, 'derby:bet', { raceId: sa.raceId, runnerId: fav.id, kind: 'win', stake: 50_000 }), /bad_stake|insufficient/);
    await assert.rejects(call(a, 'derby:upgrade', { raceId: sa.raceId, runnerId: fav.id, upgradeId: 'nitro_oats' }), /back_the_horse_first/);
    const bet = await call<{ id: string; odds: number }>(a, 'derby:bet', { raceId: sa.raceId, runnerId: fav.id, kind: 'show', stake: 100 });
    assert.equal(bet.odds, fav.odds.show, 'fixed odds locked at placement');
    await call(a, 'derby:upgrade', { raceId: sa.raceId, runnerId: fav.id, upgradeId: 'iron_lungs' });
    await assert.rejects(call(a, 'derby:upgrade', { raceId: sa.raceId, runnerId: fav.id, upgradeId: 'iron_lungs' }), /already_bought/);

    // The other punter sees that a secret upgrade exists, never which or on whom.
    const sb = await once<DerbyState>(b, 'derby:state', (s) => s.secretUpgrades >= 1);
    assert.equal(sb.myUpgrades.length, 0);
    assert.equal(sb.revealed, null);
    assert.ok(!JSON.stringify(sb).includes('iron_lungs'), 'upgrade id never leaks before the race');
    assert.equal(sb.timeline, null, 'no race timeline while betting is open');

    const mine = await once<DerbyState>(a, 'derby:state', (s) => s.myBets.length === 1);
    assert.equal(mine.credits, START - 100 - DERBY_UPGRADES.iron_lungs.cost);
    assert.ok(mine.bookings[fav.id]?.some((b) => b.name === 'Punter' && b.stake === 100 && b.you), 'own bet listed publicly');

    // Betting closes -> the race is simulated once and shipped to everyone.
    const gates = await once<DerbyState>(a, 'derby:state', (s) => s.raceId === sa!.raceId && s.phase !== 'betting', 30_000);
    assert.ok(gates.timeline && gates.timeline.finishOrder.length === 8);
    await assert.rejects(call(b, 'derby:bet', { raceId: sa.raceId, runnerId: fav.id, kind: 'win', stake: 10 }), /betting_closed|race_closed/);

    const res = await once<DerbyState>(a, 'derby:state', (s) => s.raceId === sa!.raceId && s.phase === 'results', 80_000);
    const place = res.results!.find((r) => r.runnerId === fav.id)!.place;
    const payout = place <= 3 ? Math.round(100 * fav.odds.show) : 0;
    assert.equal(res.credits, Math.max(DERBY_STIPEND, START - 100 - DERBY_UPGRADES.iron_lungs.cost + payout));
    assert.equal(res.myNet, payout - 100 - DERBY_UPGRADES.iron_lungs.cost);
    assert.ok(res.revealed!.some((x) => x.upgradeId === 'iron_lungs' && x.runnerId === fav.id && x.buyer === 'Punter'), 'purchases revealed after the race');
    assert.equal(res.history[0].winner, res.results![0].runnerId);
    a.disconnect(); b.disconnect();
  } finally {
    proc.kill();
  }
});
