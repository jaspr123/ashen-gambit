import type { AbilityVisibility, GameModeId, TimeControl } from '../types.js';

export interface GameModeDef {
  id: GameModeId;
  name: string;
  description: string;
  abilities: boolean;
  /** Winner stays at the table, next challenger from the arena queue steps in. */
  winnerStays: boolean;
  ranked: boolean;
  /** Rules engine: classic chess or Battle Checkers. */
  rules: 'chess' | 'checkers' | 'arcade';
}

export const GAME_MODES: Record<GameModeId, GameModeDef> = {
  standard: { id: 'standard', name: 'Standard Chess', description: 'Pure chess. Every capture is still a fight.', abilities: false, winnerStays: false, ranked: true, rules: 'chess' },
  war: { id: 'war', name: 'War Chess', description: 'Faction abilities enabled. Discover what the enemy can do before it costs you.', abilities: true, winnerStays: false, ranked: true, rules: 'chess' },
  kotb: { id: 'kotb', name: 'King of the Board', description: 'Winner holds the arena. Losers walk. The next challenger steps up.', abilities: false, winnerStays: true, ranked: true, rules: 'chess' },
  arcade: { id: 'arcade', name: 'Arcade Chess', description: 'Real-time chess — no turns. Move any piece the moment its cooldown is up. Fast fights, take the king to win; after 5 minutes material decides.', abilities: false, winnerStays: false, ranked: true, rules: 'arcade' },
  checkers: { id: 'checkers', name: 'Battle Checkers', description: 'Draughts on the dark squares. Every jump is a fight — chain jumps become running battles. Crowned men become Kings.', abilities: false, winnerStays: false, ranked: true, rules: 'checkers' },
};

export const TIME_MINUTES = [0, 30, 15, 10, 5, 3];
export const INCREMENTS = [0, 2, 5];
export const DEFAULT_TIME_CONTROL: TimeControl = { minutes: 10, incrementSec: 0 };
export const ABILITY_VISIBILITIES: AbilityVisibility[] = ['off', 'visible', 'secret'];

export function timeControlLabel(tc: TimeControl) {
  return tc.minutes === 0 ? 'Untimed' : `${tc.minutes}+${tc.incrementSec}`;
}

/** Server-side tuning. */
export const MATCH_RULES = {
  /** Extra time granted to the next player while a capture fight plays, so animations never cost clock time. */
  captureGraceMs: 2500,
  reconnectGraceMs: 60_000,
  kotbCountdownMs: 8_000,
  firstMoveTimeoutMs: 90_000,
  rematchWindowMs: 30_000,
  maxChatLength: 200,
};
