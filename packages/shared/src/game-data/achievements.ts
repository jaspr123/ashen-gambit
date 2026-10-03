export type StatKey = 'wins' | 'captures' | 'kingDefeats' | 'gamesPlayed' | 'longestStreak' | 'finishersUsed' | 'customArmies' | 'kotbDefenses';

export interface AchievementDef { id: string; name: string; description: string; icon: string; stat: StatKey; threshold: number }

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', name: 'First Blood', description: 'Make your first capture.', icon: '🗡', stat: 'captures', threshold: 1 },
  { id: 'butcher', name: 'Butcher of the Board', description: 'Make 100 captures.', icon: '☠', stat: 'captures', threshold: 100 },
  { id: 'first_win', name: 'Still Standing', description: 'Win your first match.', icon: '⚑', stat: 'wins', threshold: 1 },
  { id: 'warlord', name: 'Warlord', description: 'Win 25 matches.', icon: '♛', stat: 'wins', threshold: 25 },
  { id: 'regicide', name: 'Regicide', description: 'Defeat 5 kings.', icon: '♚', stat: 'kingDefeats', threshold: 5 },
  { id: 'streak5', name: 'Unbroken', description: 'Win 5 in a row.', icon: '🔥', stat: 'longestStreak', threshold: 5 },
  { id: 'veteran', name: 'Veteran', description: 'Play 50 matches.', icon: '✪', stat: 'gamesPlayed', threshold: 50 },
  { id: 'showman', name: 'Showman', description: 'Use 50 finishing moves.', icon: '★', stat: 'finishersUsed', threshold: 50 },
  { id: 'maker', name: 'Armourer', description: 'Create a custom army.', icon: '⚒', stat: 'customArmies', threshold: 1 },
  { id: 'king_of_board', name: 'King of the Board', description: 'Defend a King-of-the-Board table 3 times.', icon: '♔', stat: 'kotbDefenses', threshold: 3 },
];
