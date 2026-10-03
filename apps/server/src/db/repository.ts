import type { ArcadeSnapshot, CheckersSnapshot, CustomArmy, EngineSnapshot, FactionId, FinisherSelection, GameModeId, GameResult, Loadout, MoveRecord, PlayerStats, TimeControl, AbilityVisibility } from '@ashen/shared';

export interface UserRecord {
  id: string;
  name: string;
  avatar: string;
  tokenHash: string;
  createdAt: number;
  lastSeen: number;
  isAdmin: boolean;
  bot: boolean;
  rating: number;
  ratingGames: number;
  stats: PlayerStats;
  loadout: Loadout;
  achievements: string[];
  settings: Record<string, unknown>;
  /** Wasteland Derby bank balance (absent on records created before the Derby existed). */
  credits?: number;
  /** scrypt$<salt>$<hash> once the player sets a password (guest accounts have none). */
  passwordHash?: string;
  /** Extra session token hashes (one per logged-in device), newest last. */
  sessions?: string[];
}

export interface GamePlayerRecord {
  id: string;
  name: string;
  faction: FactionId;
  finishers: FinisherSelection;
  ratingBefore: number;
  ratingAfter: number;
  bot?: boolean;
}

export interface GameRecord {
  id: string;
  arenaId: string;
  mode: GameModeId;
  ranked: boolean;
  timeControl: TimeControl;
  abilityVisibility: AbilityVisibility;
  white: GamePlayerRecord;
  black: GamePlayerRecord;
  startFen: string;
  moves: MoveRecord[];
  result: GameResult;
  startedAt: number;
  endedAt: number;
  armies?: { w?: CustomArmy; b?: CustomArmy };
}

export interface ActiveGameRecord {
  id: string;
  updatedAt: number;
  /** Everything needed to resume after a server restart. */
  data: { engine: EngineSnapshot | CheckersSnapshot | ArcadeSnapshot; meta: Record<string, unknown> };
}

export interface QueueRecord { userId: string; kind: 'quick' | 'kotb'; arenaId?: string; mode: GameModeId; since: number }

/**
 * Persistence boundary. Two implementations: PostgreSQL (production) and a
 * JSON file store (zero-setup development). Managers only see this interface.
 */
export interface Repository {
  readonly kind: 'postgres' | 'json';
  init(): Promise<void>;
  close(): Promise<void>;

  getUser(id: string): Promise<UserRecord | undefined>;
  getUserByTokenHash(hash: string): Promise<UserRecord | undefined>;
  getUserByName(name: string): Promise<UserRecord | undefined>;
  saveUser(u: UserRecord): Promise<void>;
  topUsers(limit: number): Promise<UserRecord[]>;

  saveGame(g: GameRecord): Promise<void>;
  getGame(id: string): Promise<GameRecord | undefined>;
  gamesForUser(userId: string, limit: number): Promise<GameRecord[]>;
  recentGames(limit: number): Promise<GameRecord[]>;

  saveActiveGame(g: ActiveGameRecord): Promise<void>;
  deleteActiveGame(id: string): Promise<void>;
  listActiveGames(): Promise<ActiveGameRecord[]>;

  saveArmy(a: CustomArmy & { ownerId: string; valid: boolean }): Promise<void>;
  getArmy(id: string): Promise<(CustomArmy & { ownerId: string; valid: boolean }) | undefined>;
  armiesFor(ownerId: string): Promise<(CustomArmy & { ownerId: string; valid: boolean })[]>;
  deleteArmy(id: string): Promise<void>;

  saveQueue(entries: QueueRecord[]): Promise<void>;
  loadQueue(): Promise<QueueRecord[]>;
}
