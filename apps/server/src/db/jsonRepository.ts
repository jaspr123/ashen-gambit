// Zero-setup development store: everything in memory, flushed to a JSON file.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CustomArmy } from '@ashen/shared';
import type { ActiveGameRecord, GameRecord, QueueRecord, Repository, UserRecord } from './repository.js';

type StoredArmy = CustomArmy & { ownerId: string; valid: boolean };
interface Store { users: UserRecord[]; games: GameRecord[]; active: ActiveGameRecord[]; armies: StoredArmy[]; queue: QueueRecord[] }

export class JsonRepository implements Repository {
  readonly kind = 'json' as const;
  private users = new Map<string, UserRecord>();
  private games = new Map<string, GameRecord>();
  private active = new Map<string, ActiveGameRecord>();
  private armies = new Map<string, StoredArmy>();
  private queue: QueueRecord[] = [];
  private file: string;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dir: string) { this.file = path.join(dir, 'db.json'); }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const s = JSON.parse(await fs.readFile(this.file, 'utf8')) as Store;
      s.users.forEach((u) => this.users.set(u.id, u));
      s.games.forEach((g) => this.games.set(g.id, g));
      s.active.forEach((g) => this.active.set(g.id, g));
      s.armies.forEach((a) => this.armies.set(a.id, a));
      this.queue = s.queue ?? [];
    } catch { /* fresh store */ }
  }

  private dirty() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, 750);
  }

  async flush() {
    const store: Store = { users: [...this.users.values()].filter((u) => !u.bot), games: [...this.games.values()], active: [...this.active.values()], armies: [...this.armies.values()], queue: this.queue };
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store));
    await fs.rename(tmp, this.file);
  }

  async close() { if (this.flushTimer) clearTimeout(this.flushTimer); await this.flush(); }

  async getUser(id: string) { return this.users.get(id); }
  async getUserByTokenHash(hash: string) { return [...this.users.values()].find((u) => u.tokenHash === hash || (u.sessions ?? []).includes(hash)); }
  async getUserByName(name: string) { const n = name.toLowerCase(); return [...this.users.values()].find((u) => u.name.toLowerCase() === n); }
  async saveUser(u: UserRecord) { this.users.set(u.id, u); this.dirty(); }
  async topUsers(limit: number) { return [...this.users.values()].filter((u) => !u.bot && u.ratingGames > 0).sort((a, b) => b.rating - a.rating).slice(0, limit); }

  async saveGame(g: GameRecord) { this.games.set(g.id, g); this.dirty(); }
  async getGame(id: string) { return this.games.get(id); }
  async gamesForUser(userId: string, limit: number) {
    return [...this.games.values()].filter((g) => g.white.id === userId || g.black.id === userId).sort((a, b) => b.endedAt - a.endedAt).slice(0, limit);
  }
  async recentGames(limit: number) { return [...this.games.values()].sort((a, b) => b.endedAt - a.endedAt).slice(0, limit); }

  async saveActiveGame(g: ActiveGameRecord) { this.active.set(g.id, g); this.dirty(); }
  async deleteActiveGame(id: string) { this.active.delete(id); this.dirty(); }
  async listActiveGames() { return [...this.active.values()]; }

  async saveArmy(a: StoredArmy) { this.armies.set(a.id, a); this.dirty(); }
  async getArmy(id: string) { return this.armies.get(id); }
  async armiesFor(ownerId: string) { return [...this.armies.values()].filter((a) => a.ownerId === ownerId); }
  async deleteArmy(id: string) { this.armies.delete(id); this.dirty(); }

  async saveQueue(entries: QueueRecord[]) { this.queue = entries; this.dirty(); }
  async loadQueue() { return this.queue; }
}
