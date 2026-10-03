// Presence + lobby snapshot. Status is derived from authoritative manager
// state (never reported by the client), then broadcast at a throttled rate.

import type { LobbySnapshot, PlayerStatus, PublicPlayer } from '@ashen/shared';
import type { ArenaManager } from './ArenaManager.js';
import type { Hub } from './hub.js';
import type { MatchManager } from './MatchManager.js';
import type { MatchmakingManager } from './MatchmakingManager.js';
import type { ProfileManager } from './ProfileManager.js';

export class LobbyManager {
  readonly online = new Set<string>();
  private away = new Set<string>();
  private pending: NodeJS.Timeout | null = null;

  constructor(private hub: Hub, private profiles: ProfileManager, private matches: MatchManager, private mm: MatchmakingManager, private arenas: ArenaManager) {
    const ping = () => this.changed();
    matches.onMatchChanged.push(ping);
    matches.onMatchEnded.push(ping);
    matches.onMatchCreated.push(ping);
    mm.onChange.push(ping);
    arenas.onChange.push(ping);
  }

  enter(userId: string) { this.online.add(userId); this.away.delete(userId); this.changed(); }
  exit(userId: string) { this.online.delete(userId); this.changed(); }
  setAway(userId: string, away: boolean) { if (away) this.away.add(userId); else this.away.delete(userId); this.changed(); }

  statusOf(userId: string): { status: PlayerStatus; matchId?: string } {
    const m = this.matches.activeMatchOf(userId);
    if (m) return { status: 'playing', matchId: m.id };
    if (this.mm.isQueued(userId) || this.arenas.isQueued(userId)) return { status: 'queued' };
    const s = this.matches.spectating(userId);
    if (s) return { status: 'spectating', matchId: s.id };
    if (this.away.has(userId)) return { status: 'away' };
    return { status: 'idle' };
  }

  /** Supplied by the DerbyManager. */
  derbySummary: () => LobbySnapshot['derby'] = () => null;
  pokerSummary: () => LobbySnapshot['poker'] = () => [];

  snapshot(): LobbySnapshot {
    const players: PublicPlayer[] = [];
    for (const id of this.online) {
      const u = this.profiles.cached(id);
      if (!u) continue;
      const st = this.statusOf(id);
      players.push({ id, name: u.name, avatar: u.avatar, rating: u.rating, status: st.status, matchId: st.matchId, faction: u.loadout.faction, bot: u.bot || undefined });
    }
    players.sort((a, b) => a.name.localeCompare(b.name));
    return {
      players,
      arenas: this.arenas.snapshot(),
      matches: this.matches.summaries(),
      quickQueue: this.mm.quick.map((e) => ({ id: e.userId, name: this.profiles.cached(e.userId)?.name ?? '?', waitingSince: e.since, mode: e.mode, timeControl: e.tc })),
      derby: this.derbySummary(),
      poker: this.pokerSummary(),
      serverNow: Date.now(),
    };
  }

  /** Throttled broadcast so a busy lobby does not flood clients. */
  changed() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.hub.emitAll('lobby:snapshot', this.snapshot());
    }, 250);
  }
}
