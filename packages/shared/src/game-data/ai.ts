export type AiLevelId = 'recruit' | 'soldier' | 'veteran' | 'commander' | 'warlord';

export interface AiLevel {
  id: AiLevelId;
  name: string;
  /** Stockfish "Skill Level" 0-20. */
  skill: number;
  depth: number;
  moveTimeMs: number;
  /** Chance per move of picking a random legal move instead (keeps low levels beatable). */
  blunderChance: number;
  elo: number;
}

export const AI_LEVELS: AiLevel[] = [
  { id: 'recruit', name: 'Recruit', skill: 0, depth: 1, moveTimeMs: 150, blunderChance: 0.35, elo: 600 },
  { id: 'soldier', name: 'Soldier', skill: 4, depth: 3, moveTimeMs: 300, blunderChance: 0.15, elo: 1000 },
  { id: 'veteran', name: 'Veteran', skill: 9, depth: 6, moveTimeMs: 500, blunderChance: 0.05, elo: 1400 },
  { id: 'commander', name: 'Commander', skill: 15, depth: 10, moveTimeMs: 800, blunderChance: 0, elo: 1900 },
  { id: 'warlord', name: 'Warlord', skill: 20, depth: 16, moveTimeMs: 1500, blunderChance: 0, elo: 2600 },
];
