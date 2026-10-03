// Canonical game actions. Every model — built-in or uploaded — maps its clips
// onto these names. Combat timelines only ever reference actions, never raw
// clip names, which is what lets any model play any finisher.

export const GAME_ACTIONS = [
  'IDLE', 'MOVE', 'RUN', 'ATTACK_READY', 'ATTACK_PRIMARY', 'ATTACK_HEAVY', 'ATTACK_STAB', 'ATTACK_RANGED', 'ATTACK_THROW',
  'HIT_LIGHT', 'HIT_HEAVY', 'DEATH_LIGHT', 'DEATH_HEAVY', 'DEATH_KNOCKBACK', 'DEATH_MECHANICAL',
  'DEFEATED_IDLE', 'VICTORY', 'TAUNT', 'JUMP',
] as const;
export type GameAction = (typeof GAME_ACTIONS)[number];

/** Minimum set a custom piece must provide (or accept fallbacks for) to be valid online. */
export const REQUIRED_ACTIONS: GameAction[] = ['IDLE', 'MOVE', 'ATTACK_PRIMARY', 'HIT_LIGHT', 'DEATH_LIGHT'];

/** When an action is missing, try these in order before using the procedural fallback. */
export const ACTION_FALLBACKS: Partial<Record<GameAction, GameAction[]>> = {
  RUN: ['MOVE'],
  ATTACK_READY: ['IDLE'],
  ATTACK_HEAVY: ['ATTACK_PRIMARY'],
  ATTACK_STAB: ['ATTACK_PRIMARY'],
  ATTACK_RANGED: ['ATTACK_PRIMARY'],
  ATTACK_THROW: ['ATTACK_RANGED', 'ATTACK_PRIMARY'],
  HIT_HEAVY: ['HIT_LIGHT'],
  DEATH_HEAVY: ['DEATH_LIGHT'],
  DEATH_KNOCKBACK: ['DEATH_LIGHT'],
  DEATH_MECHANICAL: ['DEATH_HEAVY', 'DEATH_LIGHT'],
  DEFEATED_IDLE: ['IDLE'],
  VICTORY: ['TAUNT', 'IDLE'],
  TAUNT: ['IDLE'],
  JUMP: ['MOVE'],
};

/** Procedural animation families used when a model has no clip for an action. */
export type FallbackRig = 'humanoid' | 'mechanical' | 'transform';

/**
 * Clip map for the shared Synty "Simple" skeleton (Simple Apocalypse / Simple Military).
 * Values are clip names produced by tools/blender/export_synty.py.
 */
export const SYNTY_CLIP_MAP: Partial<Record<GameAction, string>> = {
  IDLE: 'Idle',
  MOVE: 'Walk',
  RUN: 'Run',
  ATTACK_READY: 'Crouch_Idle',
  ATTACK_PRIMARY: 'Melee_OneHanded',
  ATTACK_HEAVY: 'Melee_TwoHanded',
  ATTACK_STAB: 'Melee_Stab',
  ATTACK_RANGED: 'Shoot_Rifle',
  ATTACK_THROW: 'GrenadeThrow',
  DEATH_LIGHT: 'Death_01',
  DEATH_HEAVY: 'Death_02',
  DEATH_KNOCKBACK: 'Death_01',
  DEFEATED_IDLE: 'Dead_02',
  VICTORY: 'Salute',
  TAUNT: 'CrossArms',
  JUMP: 'Standing_Jump',
};

/** Hard limits enforced by the custom-army validator. */
export const ANIMATION_LIMITS = {
  maxClipSeconds: { attack: 3.0, hit: 1.5, death: 3.0, move: 3.0, idle: 12 },
  maxSequenceSeconds: 4.5,
  maxKingSequenceSeconds: 8,
};
