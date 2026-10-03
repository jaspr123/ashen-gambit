// Network protocol. Every client -> server payload has a zod schema that the
// server validates before touching game state. Server -> client payloads are
// plain typed objects.

import { z } from 'zod';
import type { AbilityView } from './chess/engine.js';
import type { CustomArmy } from './customArmy.js';
import type { AbilityVisibility, Color, FactionId, FinisherSelection, GameModeId, GameResult, MoveRecord, PublicPlayer, TimeControl } from './types.js';

const square = z.string().regex(/^[a-h][1-8]$/);
const id = z.string().min(1).max(64);
export const TimeControlSchema = z.object({ minutes: z.number().int().min(0).max(180), incrementSec: z.number().int().min(0).max(60) });
export const FactionIdSchema = z.union([z.enum(['remnants', 'machines', 'wastelanders', 'vault']), z.string().regex(/^custom:[\w-]{1,48}$/)]);
export const FinisherSelectionSchema = z.object({ pawn: id, knight: id, bishop: id, rook: id, queen: id, king: id });
export const GameModeSchema = z.enum(['standard', 'war', 'kotb', 'checkers', 'arcade']);
export const LoadoutSchema = z.object({
  faction: FactionIdSchema,
  mode: GameModeSchema,
  finishers: FinisherSelectionSchema,
  timeControl: TimeControlSchema,
  abilityVisibility: z.enum(['off', 'visible', 'secret']),
});

export const C2S = {
  auth: z.object({ token: z.string().max(128).optional(), name: z.string().min(2).max(20).regex(/^[\w\- .]+$/).optional() }),
  'profile:update': z.object({ name: z.string().min(2).max(20).regex(/^[\w\- .]+$/).optional(), avatar: z.string().max(32).optional() }),
  'loadout:set': LoadoutSchema,
  'queue:join': z.object({ kind: z.enum(['quick', 'kotb']), arenaId: z.string().max(32).optional(), mode: z.enum(['standard', 'war', 'checkers', 'arcade']).optional(), withUser: id.optional() }),
  'queue:leave': z.object({}),
  'challenge:send': z.object({ targetId: id }),
  'challenge:respond': z.object({ challengeId: id, accept: z.boolean() }),
  'private:create': z.object({}),
  'private:join': z.object({ code: z.string().min(4).max(8) }),
  'match:spectate': z.object({ matchId: id }),
  'match:unspectate': z.object({ matchId: id }),
  'match:move': z.object({ matchId: id, from: square, to: square, promotion: z.enum(['q', 'r', 'b', 'n']).optional(), ply: z.number().int().min(0).max(2000) }),
  'match:ability': z.object({ matchId: id, abilityId: id, target: square.optional(), target2: square.optional(), ply: z.number().int().min(0).max(2000) }),
  'match:pick': z.object({ matchId: id, faction: FactionIdSchema.optional(), sabotage: z.string().max(32).nullable().optional(), ready: z.boolean().optional() }),
  'match:resign': z.object({ matchId: id }),
  'match:draw': z.object({ matchId: id, action: z.enum(['offer', 'accept', 'decline']) }),
  'match:rematch': z.object({ matchId: id }),
  'match:chat': z.object({ matchId: id, text: z.string().min(1).max(200) }),
  'match:emote': z.object({ matchId: id, emote: z.enum(['gg', 'wow', 'taunt', 'salute', 'oops', 'thinking']) }),
  'match:sync': z.object({ matchId: id }),
  'history:list': z.object({ userId: id.optional(), limit: z.number().int().min(1).max(50).optional() }),
  'replay:get': z.object({ gameId: id }),
  'profile:get': z.object({ userId: id }),
  'leaderboard:get': z.object({}),
  'army:list': z.object({}),
  'army:save': z.object({ army: z.any() }),
  'army:delete': z.object({ armyId: id }),
  'account:password': z.object({ password: z.string().min(8).max(128), current: z.string().max(128).optional() }),
  'poker:watch': z.object({ tableId: id, on: z.boolean() }),
  'poker:join': z.object({ tableId: id, seat: z.number().int().min(0).max(9).optional() }),
  'poker:leave': z.object({ tableId: id }),
  'poker:act': z.object({ tableId: id, action: z.enum(['fold', 'check', 'call', 'raise', 'allin']), amount: z.number().int().min(0).max(10_000_000).optional() }),
  'music:list': z.object({}),
  'music:remove': z.object({ id }),
  'music:move': z.object({ id, delta: z.number().int().min(-50).max(50) }),
  'account:claim-admin': z.object({ code: z.string().min(8).max(128) }),
  'derby:watch': z.object({ on: z.boolean() }),
  'derby:chat': z.object({ text: z.string().min(1).max(200) }),
  'derby:bet': z.object({ raceId: id, runnerId: id, kind: z.enum(['win', 'place', 'show']), stake: z.number().int().min(1).max(100_000) }),
  'derby:cancel': z.object({ raceId: id, betId: id }),
  'derby:upgrade': z.object({ raceId: id, runnerId: id, upgradeId: z.enum(['nitro_oats', 'plated_barding', 'iron_lungs', 'spiked_shoes', 'scattergun', 'smoke_bombs', 'grapple_hook', 'field_medic', 'trick_rider']) }),
  ping: z.object({ t: z.number() }),
  'dev:bots': z.object({ action: z.enum(['add', 'clear', 'match']), count: z.number().int().min(1).max(20).optional() }),
} as const;

export type C2SEvent = keyof typeof C2S;
export type C2SPayload<E extends C2SEvent> = z.infer<(typeof C2S)[E]>;

// ------------------------------------------------------------------ server -> client

export interface MatchPlayer {
  id: string;
  name: string;
  avatar: string;
  rating: number;
  faction: FactionId;
  finishers: FinisherSelection;
  connected: boolean;
  bot?: boolean;
  /** Full custom army definition when faction is custom, so every viewer can load it. */
  army?: CustomArmy;
}

export interface ClockState {
  w: number;
  b: number;
  /** Which clock is running, null when paused/untimed. */
  running: Color | null;
  /** Server timestamp when `running` started counting (for client-side interpolation). */
  since: number;
  /** Grace period before the running clock actually ticks (capture animations). */
  graceUntil: number;
}

export type MatchStatus = 'picking' | 'countdown' | 'playing' | 'ended';

export interface MatchState {
  id: string;
  arenaId: string;
  mode: GameModeId;
  ranked: boolean;
  timeControl: TimeControl;
  abilityVisibility: AbilityVisibility;
  players: Record<Color, MatchPlayer>;
  fen: string;
  history: MoveRecord[];
  clocks: ClockState;
  status: MatchStatus;
  startsAt: number;
  result: GameResult | null;
  youAre: Color | 'spectator';
  spectators: number;
  abilityView: AbilityView | null;
  drawOffer: Color | null;
  rematchOffers: Color[];
  serverNow: number;
  /** Arcade: when the match timer runs out (server ms). */
  arcadeEndsAt?: number;
  /** Pre-match draft (status 'picking'): your picks, whether the opponent has locked in, when it ends. */
  pick?: { endsAt: number; mine: { faction: FactionId; sabotage: string | null; ready: boolean } | null; opponentReady: boolean; sabotage: boolean; allowed: FactionId[] };
}

export interface MatchUpdate {
  matchId: string;
  ply: number;
  move?: MoveRecord;
  abilityEvents?: AbilityEventDTO[];
  fen: string;
  clocks: ClockState;
  status: MatchStatus;
  result: GameResult | null;
  abilityView: AbilityView | null;
  drawOffer: Color | null;
  rematchOffers: Color[];
  players: Record<Color, MatchPlayer>;
  spectators: number;
  arcadeEndsAt?: number;
  serverNow: number;
}

export type AbilityEventDTO =
  | { type: 'ability_used'; color: Color; abilityId: string; target?: string; target2?: string }
  | { type: 'ability_triggered'; color: Color; abilityId: string; square?: string }
  | { type: 'mine_detonated'; color: Color; square: string; victim: string }
  | { type: 'ability_revealed'; color: Color; abilityId: string };

export interface MatchSummary {
  id: string;
  arenaId: string;
  mode: GameModeId;
  white: { id: string; name: string; faction: FactionId; rating: number };
  black: { id: string; name: string; faction: FactionId; rating: number };
  ply: number;
  spectators: number;
  status: MatchStatus;
  timeControl: TimeControl;
  private: boolean;
}

export interface ArenaSnapshot {
  id: string;
  name: string;
  kotb: boolean;
  matchId: string | null;
  champion: { id: string; name: string; defenses: number } | null;
  queue: { id: string; name: string }[];
  countdownUntil: number | null;
}

export interface LobbySnapshot {
  players: PublicPlayer[];
  arenas: ArenaSnapshot[];
  matches: MatchSummary[];
  quickQueue: { id: string; name: string; waitingSince: number; mode: GameModeId; timeControl: TimeControl }[];
  /** The Wasteland Derby, if running: who is track-side and where the race cycle is. */
  derby: import('./derby/data.js').DerbySummary | null;
  /** Scrap Poker tables. */
  poker: PokerTableSummary[];
  serverNow: number;
}

export interface SelfProfile {
  id: string;
  name: string;
  avatar: string;
  rating: number;
  stats: PlayerStats;
  loadout: import('./types.js').Loadout;
  achievements: string[];
  isAdmin: boolean;
  credits: number;
  /** True once the account is protected by a password (can log in elsewhere). */
  hasPassword: boolean;
}

export interface PlayerStats {
  wins: number; losses: number; draws: number; gamesPlayed: number;
  currentStreak: number; longestStreak: number;
  captures: number; kingDefeats: number; finishersUsed: number; customArmies: number; kotbDefenses: number;
  factionGames: Record<string, number>;
  pieceCaptures: Record<string, number>;
}

export interface GameHistoryEntry {
  id: string;
  white: { id: string; name: string; faction: FactionId };
  black: { id: string; name: string; faction: FactionId };
  mode: GameModeId;
  result: GameResult;
  plies: number;
  endedAt: number;
}

export interface ReplayData extends GameHistoryEntry {
  moves: MoveRecord[];
  finishers: Record<Color, FinisherSelection>;
  startFen: string;
  armies?: Partial<Record<Color, CustomArmy>>;
}

export interface PokerSeatView {
  seat: number; id: string; name: string; bot?: boolean; stack: number; bet: number; folded: boolean; allIn: boolean; lastAction: string | null;
  /** Your cards / shown at showdown; null = hidden face-down; [] = no cards. */
  cards: string[] | null;
  /** Robot parts still attached (stack / part value) and scrap won beyond the buy-in. */
  parts: number; scrap: number; you?: boolean;
}
export interface PokerView {
  tableId: string; name: string; sb: number; bb: number; partValue: number; parts: number; buyIn: number;
  seats: (PokerSeatView | null)[]; board: string[]; pot: number;
  street: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  dealer: number; toAct: number; deadline: number; serverNow: number; handNo: number;
  options: { canCheck: boolean; toCall: number; minRaiseTo: number; maxRaiseTo: number } | null;
  result: { winners: { seat: number; amount: number; hand: string | null }[] } | null;
  log: string[]; you: number | null; credits: number;
}
export interface PokerTableSummary { id: string; name: string; sb: number; bb: number; buyIn: number; seats: number; players: string[]; humans: number }

export interface MusicTrack { id: string; title: string; artist: string; url: string; addedBy: string; addedAt: number }

export interface S2CEvents {
  'lobby:snapshot': (s: LobbySnapshot) => void;
  'match:state': (s: MatchState) => void;
  'match:update': (u: MatchUpdate) => void;
  'match:chat': (m: { matchId: string; from: string; name: string; text: string; at: number }) => void;
  'match:emote': (m: { matchId: string; from: string; color: Color | 'spectator'; emote: string }) => void;
  'queue:status': (s: { state: 'idle' | 'searching' | 'found' | 'kotb'; kind?: 'quick' | 'kotb'; position?: number; since?: number; arenaId?: string }) => void;
  'challenge:incoming': (c: { challengeId: string; from: { id: string; name: string; rating: number }; mode: GameModeId; timeControl: TimeControl }) => void;
  'challenge:closed': (c: { challengeId: string; reason: string }) => void;
  'private:code': (c: { code: string }) => void;
  'profile:self': (p: SelfProfile) => void;
  notify: (n: { kind: 'info' | 'warn' | 'error' | 'success'; text: string }) => void;
  pong: (p: { t: number; serverNow: number }) => void;
  'derby:state': (s: import('./derby/data.js').DerbyState) => void;
  'derby:chat': (m: { from: string; name: string; text: string; at: number }) => void;
  'music:playlist': (tracks: MusicTrack[]) => void;
  'poker:state': (v: PokerView) => void;
}

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;
