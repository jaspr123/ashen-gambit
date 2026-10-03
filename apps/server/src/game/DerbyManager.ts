// Wasteland Derby: a continuous cycle of races that players watch and bet on.
// The server owns everything: the card, fixed odds (Monte-Carlo priced), each
// user's credit bank, bets, secret upgrades, the race simulation and payouts.
// Players never influence a race directly. The only edge is the upgrades they
// buy in secret, which the posted odds do not know about.

import crypto from 'node:crypto';
import {
  DERBY_BET_KINDS, DERBY_FIELD, DERBY_RACE_NAMES, DERBY_ROSTER, DERBY_STAKES, DERBY_START_CREDITS, DERBY_STIPEND, DERBY_TIMING, DERBY_UPGRADES,
  RACE_DISTANCE, racePricer, simulateRace,
  type DerbyBet, type DerbyBetKind, type DerbyPhase, type DerbyPurchase, type DerbyRunner, type DerbyState, type DerbyTimeline, type DerbyUpgradeId,
} from '@ashen/shared';
import type { UserRecord } from '../db/repository.js';
import type { Hub } from './hub.js';
import type { ProfileManager } from './ProfileManager.js';

interface Race {
  id: string;
  number: number;
  name: string;
  seed: number;
  runners: DerbyRunner[];
  phase: DerbyPhase;
  bettingClosesAt: number;
  startsAt: number;
  endsAt: number | null;
  bets: Map<string, DerbyBet[]>;
  purchases: Map<string, DerbyPurchase[]>;
  timeline: DerbyTimeline | null;
  results: { runnerId: string; place: number; time: number }[] | null;
  net: Map<string, number>;
}

export interface DerbyOptions {
  /** Phase lengths (tests shorten them). */
  timing?: Partial<Record<keyof typeof DERBY_TIMING, number>>;
  /** Monte-Carlo sims used to price a card. */
  pricingSims?: number;
}

const rid = (p: string) => `${p}${crypto.randomBytes(5).toString('hex')}`;

export class DerbyManager {
  private race: Race | null = null;
  private next: Promise<Race> | null = null;
  private watchers = new Set<string>();
  private timers: NodeJS.Timeout[] = [];
  private raceCount = 0;
  private form = new Map<string, number[]>();
  private history: DerbyState['history'] = [];
  private broadcastTimer: NodeJS.Timeout | null = null;
  private timing: Record<keyof typeof DERBY_TIMING, number>;
  private disposed = false;
  /** Notified when the lobby-visible summary changes (phase, watchers). */
  onChange: (() => void)[] = [];
  /** Simulated punters (lobby bots) that bet and buy upgrades too. */
  botSource: () => UserRecord[] = () => [];

  constructor(private hub: Hub, private profiles: ProfileManager, private opts: DerbyOptions = {}) {
    this.timing = { ...DERBY_TIMING, ...opts.timing };
    for (const h of DERBY_ROSTER) this.form.set(h.id, Array.from({ length: 3 }, () => 1 + Math.floor(Math.random() * 8)));
  }

  start() { void this.openNext(); }

  dispose() {
    this.disposed = true;
    this.timers.forEach(clearTimeout);
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
  }

  // ------------------------------------------------------------------ watchers / views
  watch(user: UserRecord, on: boolean) {
    const had = this.watchers.has(user.id);
    if (on) { this.watchers.add(user.id); this.hub.joinRoom(user.id, 'derby'); }
    else { this.watchers.delete(user.id); this.hub.leaveRoom(user.id, 'derby'); }
    if (had !== on) { this.broadcast(); this.onChange.forEach((f) => f()); }
    return on ? this.view(user) : null;
  }

  isWatching(userId: string) { return this.watchers.has(userId); }

  summary(): import('@ashen/shared').DerbySummary | null {
    const r = this.race;
    if (!r) return null;
    return { raceId: r.id, number: r.number, name: r.name, phase: r.phase, bettingClosesAt: r.bettingClosesAt, startsAt: r.startsAt, watchers: this.watchers.size,
      punters: [...this.watchers].map((id) => this.profiles.cached(id)?.name).filter(Boolean).slice(0, 12) as string[] };
  }

  chat(u: UserRecord, text: string) {
    if (!this.watchers.has(u.id)) throw new Error('not_trackside');
    this.hub.emitRoom('derby', 'derby:chat', { from: u.id, name: u.name, text: text.replace(/[<>]/g, ''), at: Date.now() });
  }

  private punters(r: Race) {
    const ids = new Set([...this.watchers, ...r.bets.keys()]);
    return [...ids].map((id) => {
      const u = this.profiles.cached(id);
      return u ? { id, name: u.name, avatar: u.avatar, bets: (r.bets.get(id) ?? []).length, bot: u.bot || undefined } : null;
    }).filter(Boolean) as import('@ashen/shared').DerbyPunter[];
  }

  view(u: UserRecord): DerbyState | null {
    const r = this.race;
    if (!r) return null;
    const backers: Record<string, number> = {};
    const bookings: DerbyState['bookings'] = {};
    for (const [uid, bets] of r.bets) {
      const name = this.profiles.cached(uid)?.name ?? 'someone';
      for (const b of bets) (bookings[b.runnerId] ??= []).push({ name, kind: b.kind, stake: b.stake, you: uid === u.id || undefined });
    }
    for (const list of Object.values(bookings)) list.sort((a, b) => b.stake - a.stake);
    for (const bets of r.bets.values()) for (const runner of new Set(bets.map((b) => b.runnerId))) backers[runner] = (backers[runner] ?? 0) + 1;
    let secret = 0;
    for (const p of r.purchases.values()) secret += p.length;
    const revealed = r.phase === 'results'
      ? [...r.purchases.entries()].flatMap(([uid, ps]) => ps.map((p) => ({ ...p, buyer: this.profiles.cached(uid)?.name ?? 'someone' })))
      : null;
    return {
      raceId: r.id, number: r.number, name: r.name, phase: r.phase, serverNow: Date.now(),
      bettingClosesAt: r.bettingClosesAt, startsAt: r.startsAt, endsAt: r.endsAt, distance: RACE_DISTANCE,
      runners: r.runners, credits: this.credits(u),
      myBets: r.bets.get(u.id) ?? [], myUpgrades: r.purchases.get(u.id) ?? [],
      secretUpgrades: secret, backers, bookings, watchers: this.watchers.size, punters: this.punters(r),
      timeline: r.phase === 'betting' ? null : r.timeline,
      results: r.results, revealed, myNet: r.phase === 'results' ? (r.net.get(u.id) ?? null) : null,
      history: this.history,
    };
  }

  /** Coalesce state pushes (bets arrive in bursts). */
  private broadcast(now = false) {
    if (this.broadcastTimer) { if (!now) return; clearTimeout(this.broadcastTimer); this.broadcastTimer = null; }
    const send = () => {
      this.broadcastTimer = null;
      for (const id of this.watchers) {
        const u = this.profiles.cached(id);
        const v = u && this.view(u);
        if (v) this.hub.emitUser(id, 'derby:state', v);
      }
    };
    if (now) { send(); this.onChange.forEach((f) => f()); }
    else this.broadcastTimer = setTimeout(send, 400);
  }

  credits(u: UserRecord) { return u.credits ?? DERBY_START_CREDITS; }

  // ------------------------------------------------------------------ player actions
  async bet(u: UserRecord, p: { raceId: string; runnerId: string; kind: DerbyBetKind; stake: number }) {
    const r = this.requireBetting(p.raceId);
    const runner = r.runners.find((x) => x.id === p.runnerId);
    if (!runner) throw new Error('no_runner');
    if (p.stake < DERBY_STAKES.min || p.stake > DERBY_STAKES.max) throw new Error('bad_stake');
    const bank = this.credits(u);
    if (p.stake > bank) throw new Error('insufficient_credits');
    const mine = r.bets.get(u.id) ?? [];
    if (mine.length >= 12) throw new Error('too_many_bets');
    const bet: DerbyBet = { id: rid('b_'), runnerId: runner.id, kind: p.kind, stake: p.stake, odds: runner.odds[p.kind] };
    u.credits = bank - p.stake;
    r.bets.set(u.id, [...mine, bet]);
    await this.profiles.save(u);
    this.pushSelf(u);
    this.broadcast();
    return bet;
  }

  async cancel(u: UserRecord, p: { raceId: string; betId: string }) {
    const r = this.requireBetting(p.raceId);
    const mine = r.bets.get(u.id) ?? [];
    const bet = mine.find((b) => b.id === p.betId);
    if (!bet) throw new Error('no_bet');
    const left = mine.filter((b) => b !== bet);
    // Upgrades are only allowed on horses you back; dropping the last bet on one forfeits nothing but blocks new buys.
    u.credits = this.credits(u) + bet.stake;
    if (left.length) r.bets.set(u.id, left); else r.bets.delete(u.id);
    await this.profiles.save(u);
    this.pushSelf(u);
    this.broadcast();
  }

  async upgrade(u: UserRecord, p: { raceId: string; runnerId: string; upgradeId: DerbyUpgradeId }) {
    const r = this.requireBetting(p.raceId);
    if (!r.runners.some((x) => x.id === p.runnerId)) throw new Error('no_runner');
    if (!(r.bets.get(u.id) ?? []).some((b) => b.runnerId === p.runnerId)) throw new Error('back_the_horse_first');
    const def = DERBY_UPGRADES[p.upgradeId];
    const mine = r.purchases.get(u.id) ?? [];
    if (mine.some((x) => x.runnerId === p.runnerId && x.upgradeId === p.upgradeId)) throw new Error('already_bought');
    if (mine.length >= 4) throw new Error('upgrade_limit');
    const bank = this.credits(u);
    if (def.cost > bank) throw new Error('insufficient_credits');
    u.credits = bank - def.cost;
    r.purchases.set(u.id, [...mine, { runnerId: p.runnerId, upgradeId: p.upgradeId }]);
    await this.profiles.save(u);
    this.pushSelf(u);
    this.broadcast();
  }

  private requireBetting(raceId: string) {
    const r = this.race;
    if (!r || r.id !== raceId) throw new Error('race_closed');
    if (r.phase !== 'betting' || Date.now() >= r.bettingClosesAt) throw new Error('betting_closed');
    return r;
  }

  private pushSelf(u: UserRecord) {
    if (!u.bot) this.hub.emitUser(u.id, 'profile:self', this.profiles.self(u));
  }

  // ------------------------------------------------------------------ race cycle
  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.timers = this.timers.filter((x) => x !== t); if (!this.disposed) fn(); }, Math.max(0, ms));
    this.timers.push(t);
  }

  /** Draw a field and price it, spreading the Monte-Carlo over event-loop turns. */
  private async prepareCard(): Promise<Race> {
    const number = ++this.raceCount;
    const pool = [...DERBY_ROSTER].sort(() => Math.random() - 0.5).slice(0, DERBY_FIELD);
    const lanes = pool.map((_, i) => i).sort(() => Math.random() - 0.5);
    const seed = crypto.randomInt(1, 2 ** 31);
    const entries = pool.map((def, i) => ({ id: def.id, lane: lanes[i], def }));
    const pricer = racePricer(seed ^ 0x5bd1e995, entries);
    const total = this.opts.pricingSims ?? 160;
    while (pricer.done < total && !this.disposed) {
      pricer.run(Math.min(4, total - pricer.done));
      await new Promise((res) => setImmediate(res));
    }
    const book = pricer.book();
    const runners: DerbyRunner[] = entries
      .map((e) => ({ ...e.def, number: e.lane + 1, lane: e.lane, form: (this.form.get(e.id) ?? []).slice(-3).join('-'), odds: book[e.id] }))
      .sort((a, b) => a.number - b.number);
    return {
      id: rid('race_'), number, name: DERBY_RACE_NAMES[(number - 1) % DERBY_RACE_NAMES.length], seed, runners,
      phase: 'betting', bettingClosesAt: 0, startsAt: 0, endsAt: null,
      bets: new Map(), purchases: new Map(), timeline: null, results: null, net: new Map(),
    };
  }

  private async openNext() {
    const r = await (this.next ?? this.prepareCard());
    this.next = null;
    if (this.disposed) return;
    r.phase = 'betting';
    r.bettingClosesAt = Date.now() + this.timing.betting;
    r.startsAt = r.bettingClosesAt + this.timing.gates;
    this.race = r;
    this.broadcast(true);
    this.scheduleBots(r);
    this.later(this.timing.betting, () => this.closeBetting(r));
  }

  private closeBetting(r: Race) {
    if (this.race !== r) return;
    // Every purchase, from everyone, goes into the one deterministic simulation.
    const ups = new Map<string, Set<DerbyUpgradeId>>();
    for (const ps of r.purchases.values()) for (const p of ps) { if (!ups.has(p.runnerId)) ups.set(p.runnerId, new Set()); ups.get(p.runnerId)!.add(p.upgradeId); }
    r.timeline = simulateRace(r.id, r.seed, r.runners.map((x) => ({ id: x.id, lane: x.lane, def: x, upgrades: [...(ups.get(x.id) ?? [])] })), { record: true });
    r.phase = 'gates';
    r.startsAt = Date.now() + this.timing.gates;
    r.endsAt = r.startsAt + Math.ceil(r.timeline.duration * 1000);
    this.broadcast(true);
    this.later(this.timing.gates, () => { r.phase = 'racing'; this.broadcast(true); });
    this.later(r.endsAt - Date.now(), () => void this.settle(r));
    // Price the next card while this one runs.
    this.next = this.prepareCard();
  }

  private async settle(r: Race) {
    if (this.race !== r || !r.timeline) return;
    const order = r.timeline.finishOrder;
    r.results = order.map((id, i) => ({ runnerId: id, place: i + 1, time: r.timeline!.finishTimes[id] }));
    const placeOf = new Map(order.map((id, i) => [id, i + 1]));
    const users = new Set([...r.bets.keys(), ...r.purchases.keys()]);
    for (const uid of users) {
      const u = await this.profiles.get(uid);
      if (!u) continue;
      let net = 0;
      for (const b of r.bets.get(uid) ?? []) {
        const places = DERBY_BET_KINDS.find((k) => k.id === b.kind)!.places;
        b.payout = (placeOf.get(b.runnerId) ?? 99) <= places ? Math.round(b.stake * b.odds) : 0;
        net += b.payout - b.stake;
      }
      for (const p of r.purchases.get(uid) ?? []) net -= DERBY_UPGRADES[p.upgradeId].cost;
      const won = (r.bets.get(uid) ?? []).reduce((a, b) => a + (b.payout ?? 0), 0);
      u.credits = this.credits(u) + won;
      if (u.credits < DERBY_STIPEND) {
        u.credits = DERBY_STIPEND;
        if (!u.bot) this.hub.emitUser(uid, 'notify', { kind: 'info', text: `Track stipend: your bank was topped up to ${DERBY_STIPEND} credits.` });
      }
      r.net.set(uid, net);
      await this.profiles.save(u);
      this.pushSelf(u);
    }
    for (const [id, place] of placeOf) { const f = this.form.get(id) ?? []; f.push(place); this.form.set(id, f.slice(-6)); }
    const w = r.runners.find((x) => x.id === order[0])!;
    this.history = [{ number: r.number, name: r.name, winner: w.id, winnerName: w.horse, odds: w.odds.win }, ...this.history].slice(0, 8);
    r.phase = 'results';
    this.broadcast(true);
    this.later(this.timing.results, () => void this.openNext());
  }

  // ------------------------------------------------------------------ bots
  private scheduleBots(r: Race) {
    const bots = this.botSource();
    for (const b of bots) {
      if (Math.random() < 0.35) continue;
      this.later(1500 + Math.random() * (this.timing.betting - 4000), () => void this.botPlay(b, r).catch(() => {}));
    }
  }

  private async botPlay(b: UserRecord, r: Race) {
    if (this.race !== r || r.phase !== 'betting') return;
    // Bots like favourites but chase the occasional long shot.
    const weights = r.runners.map((x) => 1 / x.odds.win + (Math.random() < 0.15 ? 0.2 : 0));
    let pick = Math.random() * weights.reduce((a, c) => a + c, 0);
    const runner = r.runners.find((_, i) => (pick -= weights[i]) <= 0) ?? r.runners[0];
    const kind: DerbyBetKind = Math.random() < 0.55 ? 'win' : Math.random() < 0.5 ? 'place' : 'show';
    const stake = Math.max(DERBY_STAKES.min, Math.min(this.credits(b), Math.round((20 + Math.random() * 180) / 10) * 10));
    if (stake > this.credits(b)) return;
    await this.bet(b, { raceId: r.id, runnerId: runner.id, kind, stake });
    if (Math.random() < 0.3) {
      const ids = Object.keys(DERBY_UPGRADES) as DerbyUpgradeId[];
      const up = ids[Math.floor(Math.random() * ids.length)];
      if (DERBY_UPGRADES[up].cost <= this.credits(b)) await this.upgrade(b, { raceId: r.id, runnerId: runner.id, upgradeId: up }).catch(() => {});
    }
  }
}
