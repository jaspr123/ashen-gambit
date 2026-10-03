// Quick-match queue, direct challenges and private matches.
// The queue is server-side state only: clients can join/leave themselves but
// never reorder or inspect other entries beyond the public lobby view.

import { GAME_MODES, timeControlLabel, type AbilityVisibility, type GameModeId, type TimeControl } from '@ashen/shared';
import type { Repository } from '../db/index.js';
import type { UserRecord } from '../db/repository.js';
import type { Hub } from './hub.js';
import type { MatchManager } from './MatchManager.js';
import { newId, type ProfileManager } from './ProfileManager.js';

interface QuickEntry { userId: string; mode: GameModeId; tc: TimeControl; visibility: AbilityVisibility; rating: number; since: number; /** Joined a specific waiting player from the lobby. */ with?: string }
interface Challenge { id: string; from: string; to: string; mode: GameModeId; tc: TimeControl; visibility: AbilityVisibility; at: number }

export class MatchmakingManager {
  readonly quick: QuickEntry[] = [];
  private challenges = new Map<string, Challenge>();
  private privateCodes = new Map<string, { userId: string; at: number }>();
  onChange: (() => void)[] = [];
  /** Validates that a user may enter public matchmaking (e.g. custom army must be valid). */
  publicEligibility: (u: UserRecord) => Promise<string | null> = async () => null;

  constructor(private hub: Hub, private repo: Repository, private profiles: ProfileManager, private matches: MatchManager) {
    setInterval(() => void this.tick(), 1000);
    setInterval(() => this.expire(), 5000);
  }

  isQueued(userId: string) { return this.quick.some((e) => e.userId === userId); }

  /**
   * Queue for a quick match. `mode` overrides the loadout's mode (lobby mode buttons);
   * `withUser` joins a specific waiting player, adopting their mode and clock.
   */
  async join(u: UserRecord, opts: { mode?: GameModeId; withUser?: string } = {}): Promise<void> {
    if (this.matches.isPlaying(u.id)) throw new Error('already_playing');
    if (opts.withUser === u.id) throw new Error('cannot_join_self');
    if (this.isQueued(u.id)) this.leave(u.id);
    const reason = await this.publicEligibility(u);
    if (reason) throw new Error(reason);
    const target = opts.withUser ? this.quick.find((e) => e.userId === opts.withUser) : undefined;
    if (opts.withUser && !target) throw new Error('no_longer_waiting');
    const wanted = opts.mode ?? u.loadout.mode;
    const mode = target?.mode ?? (wanted === 'kotb' ? 'standard' : wanted);
    this.quick.push({ userId: u.id, mode, tc: target?.tc ?? u.loadout.timeControl, visibility: target?.visibility ?? u.loadout.abilityVisibility, rating: u.rating, since: Date.now(), with: target?.userId });
    void this.tick();
    this.status(u.id);
    void this.save();
    this.onChange.forEach((f) => f());
  }

  leave(userId: string) {
    const i = this.quick.findIndex((e) => e.userId === userId);
    if (i < 0) return;
    this.quick.splice(i, 1);
    this.hub.emitUser(userId, 'queue:status', { state: 'idle' });
    void this.save();
    this.onChange.forEach((f) => f());
  }

  private status(userId: string) {
    const i = this.quick.findIndex((e) => e.userId === userId);
    if (i >= 0) this.hub.emitUser(userId, 'queue:status', { state: 'searching', kind: 'quick', position: i + 1, since: this.quick[i].since });
  }

  private compatible(a: QuickEntry, b: QuickEntry, now: number) {
    if (a.mode !== b.mode) return false;
    if (a.with === b.userId || b.with === a.userId) return true;
    if (a.with || b.with) return false;
    const waited = Math.min(now - a.since, now - b.since) / 1000;
    const sameTc = a.tc.minutes === b.tc.minutes && a.tc.incrementSec === b.tc.incrementSec;
    if (!sameTc && waited < 20) return false;
    return Math.abs(a.rating - b.rating) <= 200 + waited * 25;
  }

  /** Pair waiting players into new, simultaneous matches — nobody waits for a public table. */
  private ticking = false;
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try { await this.pairUp(); } finally { this.ticking = false; }
  }

  private async pairUp() {
    const now = Date.now();
    let paired = false;
    for (let i = 0; i < this.quick.length; i++) {
      for (let j = i + 1; j < this.quick.length; j++) {
        const a = this.quick[i], b = this.quick[j];
        if (!this.compatible(a, b, now)) continue;
        const ua = await this.profiles.get(a.userId), ub = await this.profiles.get(b.userId);
        if (!ua || !ub || !this.hub.isOnline(ua.id) && !ua.bot || !this.hub.isOnline(ub.id) && !ub.bot) continue;
        this.quick.splice(j, 1); this.quick.splice(i, 1);
        const [white, black] = Math.random() < 0.5 ? [ua, ub] : [ub, ua];
        const visibility = a.mode === 'war' ? (a.visibility === 'off' ? 'visible' : a.visibility) : 'off';
        try {
          await this.matches.create({ mode: a.mode, timeControl: a.tc, abilityVisibility: visibility, white, black });
          for (const u of [ua, ub]) if (!u.bot) { this.hub.emitUser(u.id, 'queue:status', { state: 'found' }); }
        } catch (e) {
          console.warn('[mm] create failed', e);
        }
        paired = true;
        i = -1;
        break;
      }
    }
    this.quick.forEach((e) => this.status(e.userId));
    if (paired) { void this.save(); this.onChange.forEach((f) => f()); }
  }

  private save() {
    return this.repo.saveQueue(this.quick.map((e) => ({ userId: e.userId, kind: 'quick', mode: e.mode, since: e.since }))).catch(() => {});
  }

  // ------------------------------------------------------------- challenges
  async challenge(from: UserRecord, toId: string): Promise<string> {
    if (from.id === toId) throw new Error('self_challenge');
    const to = await this.profiles.get(toId);
    if (!to) throw new Error('no_player');
    if (this.matches.isPlaying(to.id)) throw new Error('target_busy');
    if (this.matches.isPlaying(from.id)) throw new Error('already_playing');
    const c: Challenge = {
      id: newId('c_'), from: from.id, to: to.id, mode: from.loadout.mode === 'kotb' ? 'standard' : from.loadout.mode, tc: from.loadout.timeControl,
      visibility: from.loadout.mode === 'war' ? (from.loadout.abilityVisibility === 'off' ? 'visible' : from.loadout.abilityVisibility) : 'off', at: Date.now(),
    };
    this.challenges.set(c.id, c);
    if (to.bot) setTimeout(() => void this.respond(to, c.id, true).catch(() => {}), 1200);
    else this.hub.emitUser(to.id, 'challenge:incoming', { challengeId: c.id, from: { id: from.id, name: from.name, rating: from.rating }, mode: c.mode, timeControl: c.tc });
    this.hub.emitUser(from.id, 'notify', { kind: 'info', text: `Challenge sent to ${to.name} (${GAME_MODES[c.mode].name}, ${timeControlLabel(c.tc)})` });
    return c.id;
  }

  async respond(u: UserRecord, challengeId: string, accept: boolean) {
    const c = this.challenges.get(challengeId);
    if (!c || c.to !== u.id) throw new Error('no_challenge');
    this.challenges.delete(challengeId);
    this.hub.emitUser(c.from, 'challenge:closed', { challengeId, reason: accept ? 'accepted' : 'declined' });
    if (!accept) return;
    const from = await this.profiles.get(c.from);
    if (!from) throw new Error('challenger_gone');
    this.leave(from.id); this.leave(u.id);
    const [white, black] = Math.random() < 0.5 ? [from, u] : [u, from];
    await this.matches.create({ mode: c.mode, timeControl: c.tc, abilityVisibility: c.visibility, white, black });
  }

  // ------------------------------------------------------------- private matches
  createPrivate(u: UserRecord): string {
    for (const [code, v] of this.privateCodes) if (v.userId === u.id) this.privateCodes.delete(code);
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.privateCodes.set(code, { userId: u.id, at: Date.now() });
    return code;
  }

  async joinPrivate(u: UserRecord, code: string) {
    const entry = this.privateCodes.get(code.toUpperCase());
    if (!entry) throw new Error('bad_code');
    if (entry.userId === u.id) throw new Error('own_code');
    const host = await this.profiles.get(entry.userId);
    if (!host) throw new Error('host_gone');
    this.privateCodes.delete(code.toUpperCase());
    const mode = host.loadout.mode === 'kotb' ? 'standard' : host.loadout.mode;
    await this.matches.create({
      mode, timeControl: host.loadout.timeControl, abilityVisibility: mode === 'war' ? host.loadout.abilityVisibility : 'off',
      white: host, black: u, isPrivate: true,
    });
  }

  private expire() {
    const now = Date.now();
    for (const [id, c] of this.challenges) if (now - c.at > 60_000) { this.challenges.delete(id); this.hub.emitUser(c.from, 'challenge:closed', { challengeId: id, reason: 'expired' }); }
    for (const [code, v] of this.privateCodes) if (now - v.at > 30 * 60_000) this.privateCodes.delete(code);
  }

  removeUser(userId: string) { this.leave(userId); }
}
