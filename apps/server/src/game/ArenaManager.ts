// King-of-the-Board tables. Each arena keeps a champion and a challenger
// queue: winner stays, loser walks, next challenger steps up after a short
// countdown, board resets, new game begins.

import { ARENAS, MATCH_RULES, type ArenaSnapshot, type TimeControl } from '@ashen/shared';
import type { UserRecord } from '../db/repository.js';
import type { Hub } from './hub.js';
import type { Match } from './Match.js';
import type { MatchManager } from './MatchManager.js';
import type { ProfileManager } from './ProfileManager.js';

interface KotbArena {
  id: string;
  name: string;
  envId: string;
  timeControl: TimeControl;
  matchId: string | null;
  champion: { id: string; defenses: number } | null;
  queue: string[];
  countdownUntil: number | null;
  timer: NodeJS.Timeout | null;
}

export class ArenaManager {
  readonly arenas: KotbArena[] = [];
  onChange: (() => void)[] = [];
  publicEligibility: (u: UserRecord) => Promise<string | null> = async () => null;

  constructor(count: number, private hub: Hub, private profiles: ProfileManager, private matches: MatchManager) {
    for (let i = 0; i < count; i++) {
      const env = ARENAS[i % ARENAS.length];
      this.arenas.push({ id: `kotb-${i + 1}`, name: `Arena ${i + 1} — ${env.name}`, envId: env.id, timeControl: i === 0 ? { minutes: 5, incrementSec: 2 } : { minutes: 3, incrementSec: 2 }, matchId: null, champion: null, queue: [], countdownUntil: null, timer: null });
    }
    matches.onMatchEnded.push((m) => this.handleEnd(m));
  }

  arenaOf(userId: string) { return this.arenas.find((a) => a.queue.includes(userId) || a.champion?.id === userId); }
  isQueued(userId: string) { return this.arenas.some((a) => a.queue.includes(userId)); }

  async join(u: UserRecord, arenaId?: string) {
    if (this.matches.isPlaying(u.id)) throw new Error('already_playing');
    const reason = await this.publicEligibility(u);
    if (reason) throw new Error(reason);
    this.leave(u.id, true);
    const arena = arenaId ? this.arenas.find((a) => a.id === arenaId) : [...this.arenas].sort((a, b) => a.queue.length - b.queue.length)[0];
    if (!arena) throw new Error('no_arena');
    arena.queue.push(u.id);
    this.notifyQueue(arena);
    this.tryStart(arena);
    this.onChange.forEach((f) => f());
  }

  leave(userId: string, silent = false) {
    for (const a of this.arenas) {
      const i = a.queue.indexOf(userId);
      if (i >= 0) { a.queue.splice(i, 1); this.notifyQueue(a); }
      if (a.champion?.id === userId && !a.matchId) { a.champion = null; this.cancelCountdown(a); this.tryStart(a); }
    }
    if (!silent) { this.hub.emitUser(userId, 'queue:status', { state: 'idle' }); this.onChange.forEach((f) => f()); }
  }

  private notifyQueue(a: KotbArena) {
    a.queue.forEach((id, i) => this.hub.emitUser(id, 'queue:status', { state: 'kotb', kind: 'kotb', position: i + 1, arenaId: a.id }));
  }

  private cancelCountdown(a: KotbArena) {
    if (a.timer) clearTimeout(a.timer);
    a.timer = null; a.countdownUntil = null;
  }

  private available(id: string) {
    const u = this.profiles.cached(id);
    return !!u && (u.bot || this.hub.isOnline(id)) && !this.matches.isPlaying(id);
  }

  private tryStart(a: KotbArena) {
    if (a.matchId || a.timer) return;
    a.queue = a.queue.filter((id) => this.available(id));
    if (a.champion && !this.available(a.champion.id)) a.champion = null;
    const seats = (a.champion ? 1 : 0) + a.queue.length;
    if (seats < 2) { this.onChange.forEach((f) => f()); return; }
    a.countdownUntil = Date.now() + MATCH_RULES.kotbCountdownMs;
    a.timer = setTimeout(() => void this.startMatch(a), MATCH_RULES.kotbCountdownMs);
    this.onChange.forEach((f) => f());
  }

  private async startMatch(a: KotbArena) {
    a.timer = null; a.countdownUntil = null;
    a.queue = a.queue.filter((id) => this.available(id));
    if (a.champion && !this.available(a.champion.id)) a.champion = null;
    const champId = a.champion?.id ?? a.queue.shift();
    const challengerId = a.queue.shift();
    if (!champId || !challengerId) { if (champId && !a.champion) a.queue.unshift(champId); this.tryStart(a); return; }
    if (!a.champion) a.champion = { id: champId, defenses: 0 };
    const champ = this.profiles.cached(champId)!, challenger = this.profiles.cached(challengerId)!;
    // Challenger takes white: the defender has to hold the table.
    const m = await this.matches.create({ arenaId: a.id, mode: 'kotb', timeControl: a.timeControl, abilityVisibility: 'off', white: challenger, black: champ, startDelayMs: 3000 });
    a.matchId = m.id;
    this.notifyQueue(a);
    this.onChange.forEach((f) => f());
  }

  private handleEnd(m: Match) {
    const a = this.arenas.find((x) => x.matchId === m.id);
    if (!a) return;
    a.matchId = null;
    const r = m.engine.result!;
    const champId = a.champion?.id;
    if (r.winner) {
      const winnerId = m.players[r.winner].id;
      if (winnerId === champId) {
        a.champion!.defenses++;
        const u = this.profiles.cached(winnerId);
        if (u) { u.stats.kotbDefenses++; void this.profiles.save(u); }
      } else a.champion = { id: winnerId, defenses: 0 };
    } else if (!champId) {
      a.champion = null;
    }
    // Losers walk; spectators stay to watch the next challenger.
    const next = this.matches;
    setTimeout(() => {
      for (const s of m.spectators) if (a.matchId) next.spectate(s, a.matchId);
    }, MATCH_RULES.kotbCountdownMs + 4000);
    this.tryStart(a);
    this.onChange.forEach((f) => f());
  }

  snapshot(): ArenaSnapshot[] {
    return this.arenas.map((a) => ({
      id: a.id, name: a.name, kotb: true, matchId: a.matchId,
      champion: a.champion ? { id: a.champion.id, name: this.profiles.cached(a.champion.id)?.name ?? '?', defenses: a.champion.defenses } : null,
      queue: a.queue.map((id) => ({ id, name: this.profiles.cached(id)?.name ?? '?' })),
      countdownUntil: a.countdownUntil,
    }));
  }
}
