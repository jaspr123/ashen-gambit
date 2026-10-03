// Scrap Poker tables. A seat buys in with a whole robot — `parts` parts worth
// `partValue` chips each, paid from the player's credit bank — and every chip
// lost strips a part off their robot; chips won pile up as scrap. Leaving the
// table converts the stack back into bank credits (usable at the Derby).
// Bots keep tables lively whenever a human is seated.

import crypto from 'node:crypto';
import {
  DERBY_START_CREDITS, HoldemTable, POKER_TABLES, equity, partsFor,
  type PokerAction, type PokerTableDef, type PokerTableSummary, type PokerView,
} from '@ashen/shared';
import type { UserRecord } from '../db/repository.js';
import type { Hub } from './hub.js';
import type { ProfileManager } from './ProfileManager.js';

const ACT_MS = 25_000;
const NEXT_HAND_MS = 5_500;
const BOT_NAMES = ['Rusty', 'Servo', 'Clank', 'Gearhead', 'Sparks', 'Bolt', 'Rivet', 'Sprocket', 'Widget', 'Tinpot'];
const rnd = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

interface Room {
  def: PokerTableDef;
  t: HoldemTable;
  watchers: Set<string>;
  bots: Set<string>;
  deadline: number;
  actTimer: NodeJS.Timeout | null;
  nextTimer: NodeJS.Timeout | null;
}

export class PokerManager {
  private rooms = new Map<string, Room>();
  onChange: (() => void)[] = [];

  constructor(private hub: Hub, private profiles: ProfileManager) {
    for (const def of POKER_TABLES) {
      this.rooms.set(def.id, { def, t: new HoldemTable(def.seats, def.sb, def.bb, rnd), watchers: new Set(), bots: new Set(), deadline: 0, actTimer: null, nextTimer: null });
    }
  }

  // ------------------------------------------------------------------ views
  summaries(): PokerTableSummary[] {
    return [...this.rooms.values()].map((r) => ({
      id: r.def.id, name: r.def.name, sb: r.def.sb, bb: r.def.bb, buyIn: r.def.parts * r.def.partValue, seats: r.def.seats,
      players: r.t.seats.filter(Boolean).map((s) => s!.name), humans: r.t.seats.filter((s) => s && !r.bots.has(s.id)).length,
    }));
  }

  private room(id: string) { const r = this.rooms.get(id); if (!r) throw new Error('no_table'); return r; }
  private seatOf(r: Room, userId: string) { return r.t.seats.findIndex((s) => s?.id === userId); }
  seatedAt(userId: string) { for (const r of this.rooms.values()) if (this.seatOf(r, userId) >= 0) return r.def.id; return null; }

  view(r: Room, userId: string | null): PokerView {
    const t = r.t;
    const you = userId ? this.seatOf(r, userId) : -1;
    const buyIn = r.def.parts * r.def.partValue;
    const shown = t.lastResult?.shown ?? {};
    const u = userId ? this.profiles.cached(userId) : undefined;
    return {
      tableId: r.def.id, name: r.def.name, sb: r.def.sb, bb: r.def.bb, partValue: r.def.partValue, parts: r.def.parts, buyIn,
      seats: t.seats.map((s, i) => s && {
        seat: i, id: s.id, name: s.name, bot: r.bots.has(s.id) || undefined, stack: s.stack, bet: s.bet, folded: s.folded, allIn: s.allIn, lastAction: s.lastAction,
        cards: i === you || shown[i] ? s.cards : s.cards.length && !s.folded && t.street !== 'waiting' ? null : [],
        parts: partsFor(s.stack + s.bet, r.def.partValue, r.def.parts), scrap: Math.max(0, Math.floor((s.stack + s.bet - buyIn) / r.def.partValue)), you: i === you || undefined,
      }),
      board: t.board, pot: t.pot + t.seats.reduce((n, s) => n + (s?.bet ?? 0), 0), street: t.street, dealer: t.dealer, toAct: t.toAct,
      deadline: r.deadline, serverNow: Date.now(), handNo: t.handNo,
      options: you >= 0 ? t.options(you) : null, result: t.lastResult ? { winners: t.lastResult.winners } : null,
      log: t.log.slice(-12), you: you >= 0 ? you : null, credits: u ? u.credits ?? DERBY_START_CREDITS : 0,
    };
  }

  private broadcast(r: Room) {
    const ids = new Set([...r.watchers, ...r.t.seats.filter((s) => s && !r.bots.has(s.id)).map((s) => s!.id)]);
    for (const id of ids) this.hub.emitUser(id, 'poker:state', this.view(r, id));
    this.onChange.forEach((f) => f());
  }

  // ------------------------------------------------------------------ player intents
  watch(u: UserRecord, tableId: string, on: boolean) {
    const r = this.room(tableId);
    if (on) { for (const o of this.rooms.values()) o.watchers.delete(u.id); r.watchers.add(u.id); }
    else r.watchers.delete(u.id);
    return on ? this.view(r, u.id) : null;
  }

  async join(u: UserRecord, tableId: string, seat?: number) {
    const r = this.room(tableId);
    if (this.seatedAt(u.id)) throw new Error('already_seated');
    const buyIn = r.def.parts * r.def.partValue;
    const bank = u.credits ?? DERBY_START_CREDITS;
    if (bank < buyIn) throw new Error('insufficient_credits');
    let s = seat ?? -1;
    if (s < 0 || s >= r.def.seats || r.t.seats[s]) {
      // A bot gives up its seat for a human if the table is full.
      s = r.t.seats.findIndex((x) => !x);
      if (s < 0) { const b = r.t.seats.findIndex((x) => x && r.bots.has(x.id) && (r.t.street === 'waiting' || r.t.street === 'showdown' || x.folded)); if (b >= 0) { this.removeBot(r, b); s = b; } }
    }
    if (s < 0) throw new Error('table_full');
    u.credits = bank - buyIn;
    r.t.sit(s, u.id, u.name, buyIn);
    r.watchers.add(u.id);
    await this.profiles.save(u);
    this.hub.emitUser(u.id, 'profile:self', this.profiles.self(u));
    this.fillBots(r);
    this.maybeStart(r);
    this.broadcast(r);
    return this.view(r, u.id);
  }

  async leave(u: UserRecord, tableId: string) {
    const r = this.room(tableId);
    const s = this.seatOf(r, u.id);
    if (s < 0) return;
    await this.cashOut(r, s, u);
    this.afterChange(r);
  }

  private async cashOut(r: Room, seat: number, u?: UserRecord) {
    const s = r.t.seats[seat];
    if (!s) return;
    const user = u ?? (await this.profiles.get(s.id));
    const chips = r.t.stand(seat);
    if (!user) return;
    const buyIn = r.def.parts * r.def.partValue;
    user.credits = (user.credits ?? DERBY_START_CREDITS) + chips;
    await this.profiles.save(user);
    this.hub.emitUser(user.id, 'profile:self', this.profiles.self(user));
    const net = chips - buyIn;
    this.hub.emitUser(user.id, 'notify', { kind: net >= 0 ? 'success' : 'info', text: `Cashed out ${chips} credits from ${r.def.name} (${net >= 0 ? '+' : ''}${net}).` });
  }

  act(u: UserRecord, tableId: string, action: PokerAction, amount?: number) {
    const r = this.room(tableId);
    const s = this.seatOf(r, u.id);
    if (s < 0) throw new Error('not_seated');
    const out = r.t.act(s, action, amount ?? 0);
    if (!out.ok) throw new Error(out.error);
    this.afterChange(r);
  }

  /** Disconnects: leave every table (cashing out). */
  async dropUser(userId: string) {
    for (const r of this.rooms.values()) {
      r.watchers.delete(userId);
      const s = this.seatOf(r, userId);
      if (s >= 0) { await this.cashOut(r, s); this.afterChange(r); }
    }
  }

  /** Server shutdown: return every human's chips to their bank. */
  async cashOutAll() {
    for (const r of this.rooms.values()) {
      for (let i = 0; i < r.t.seats.length; i++) { const s = r.t.seats[i]; if (s && !r.bots.has(s.id)) await this.cashOut(r, i); }
      if (r.actTimer) clearTimeout(r.actTimer);
      if (r.nextTimer) clearTimeout(r.nextTimer);
    }
  }

  // ------------------------------------------------------------------ flow
  private humans(r: Room) { return r.t.seats.filter((s) => s && !r.bots.has(s.id)).length; }

  private afterChange(r: Room) {
    if (r.actTimer) { clearTimeout(r.actTimer); r.actTimer = null; }
    if (this.humans(r) === 0) {
      // Nobody real left: stop the table and send the bots home.
      for (let i = 0; i < r.t.seats.length; i++) if (r.t.seats[i] && r.bots.has(r.t.seats[i]!.id)) this.removeBot(r, i);
      if (r.nextTimer) { clearTimeout(r.nextTimer); r.nextTimer = null; }
      r.t.street = 'waiting';
      this.broadcast(r);
      return;
    }
    if (r.t.street === 'showdown') this.scheduleNext(r);
    else if (r.t.street !== 'waiting') this.armTurn(r);
    else this.maybeStart(r);
    this.broadcast(r);
  }

  private scheduleNext(r: Room) {
    if (r.nextTimer) return;
    r.nextTimer = setTimeout(() => {
      r.nextTimer = null;
      // Fully stripped robots leave the table; busted bots are replaced.
      void (async () => {
        for (let i = 0; i < r.t.seats.length; i++) {
          const s = r.t.seats[i];
          if (!s || s.stack > 0) continue;
          if (r.bots.has(s.id)) this.removeBot(r, i);
          else {
            this.hub.emitUser(s.id, 'notify', { kind: 'warn', text: `Your robot was stripped for parts at ${r.def.name}. Buy back in to keep playing.` });
            await this.cashOut(r, i);
          }
        }
        this.fillBots(r);
        this.maybeStart(r);
        this.broadcast(r);
      })();
    }, NEXT_HAND_MS);
  }

  private maybeStart(r: Room) {
    if (r.nextTimer || this.humans(r) === 0) return;
    if (r.t.street !== 'waiting' && r.t.street !== 'showdown') return;
    if (r.t.startHand()) {
      if (r.t.street === 'showdown') this.scheduleNext(r);
      else this.armTurn(r);
    }
  }

  private armTurn(r: Room) {
    const seat = r.t.toAct;
    if (seat < 0) return;
    const s = r.t.seats[seat]!;
    const bot = r.bots.has(s.id);
    const delay = bot ? 900 + Math.random() * 1600 : ACT_MS;
    r.deadline = Date.now() + delay;
    r.actTimer = setTimeout(() => {
      r.actTimer = null;
      if (r.t.toAct !== seat || r.t.seats[seat]?.id !== s.id) return;
      if (bot) this.botAct(r, seat);
      else {
        const o = r.t.options(seat);
        r.t.act(seat, o?.canCheck ? 'check' : 'fold');
      }
      this.afterChange(r);
    }, delay);
  }

  // ------------------------------------------------------------------ bots
  private fillBots(r: Room) {
    if (this.humans(r) === 0) return;
    const want = Math.max(0, 4 - r.t.seats.filter(Boolean).length);
    for (let k = 0; k < want; k++) {
      const seat = r.t.seats.findIndex((x) => !x);
      if (seat < 0) return;
      const used = new Set(r.t.seats.filter(Boolean).map((s) => s!.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot${seat}`;
      const id = `pbot_${crypto.randomBytes(4).toString('hex')}`;
      r.bots.add(id);
      r.t.sit(seat, id, name, r.def.parts * r.def.partValue);
    }
  }

  private removeBot(r: Room, seat: number) {
    const s = r.t.seats[seat];
    if (!s) return;
    r.bots.delete(s.id);
    r.t.stand(seat);
  }

  private botAct(r: Room, seat: number) {
    const t = r.t;
    const s = t.seats[seat]!;
    const o = t.options(seat)!;
    const opponents = t.seats.filter((x, i) => x && !x.folded && i !== seat).length || 1;
    const eq = equity(s.cards, t.board, Math.min(opponents, 3), 120);
    const pot = t.pot + t.seats.reduce((n, x) => n + (x?.bet ?? 0), 0);
    const potOdds = o.toCall / Math.max(1, pot + o.toCall);
    const bluff = Math.random() < 0.07;
    const strong = eq > 0.62 + opponents * 0.04;
    if ((strong || bluff) && o.maxRaiseTo > t.currentBet) {
      const size = Math.round(Math.max(o.minRaiseTo, t.currentBet + pot * (0.5 + Math.random() * 0.5)));
      const to = Math.min(o.maxRaiseTo, size);
      if (t.act(seat, eq > 0.85 && Math.random() < 0.3 ? 'allin' : 'raise', to).ok) return;
    }
    if (o.canCheck) { t.act(seat, 'check'); return; }
    if (eq > potOdds + 0.06 || o.toCall <= t.bb && eq > 0.25) { t.act(seat, 'call'); return; }
    t.act(seat, 'fold');
  }
}
