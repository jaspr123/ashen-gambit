// War Chess abilities — pure data. Behaviour lives in effect handlers inside
// AbilitySystem (shared/chess/abilitySystem.ts). New abilities that reuse an
// existing effect type are a data-only change; a new effect type needs one
// new handler and nothing else in the engine.

import type { BuiltinFactionId, PieceClass } from '../types.js';

export type AbilityEffectType =
  | 'reveal_threats'          // owner sees every square the enemy attacks
  | 'mark_attacker'           // passive: piece that captured you is tracked
  | 'no_capture_zone'         // enemy cannot capture inside an area
  | 'shield_piece'            // own piece cannot be captured
  | 'freeze_piece'            // enemy piece cannot move
  | 'freeze_area'             // enemy pieces inside an area cannot move
  | 'pawn_bulwark'            // passive rule: chained pawns immune to pawn captures
  | 'mine'                    // hidden mine destroys first enemy piece to stop on it
  | 'grant_charge'            // passive: gain a charge of another ability
  | 'destroy_enemy_pawn'      // remove an enemy pawn in range of a friendly pawn
  | 'teleport_own'            // relocate own piece to an empty square in range
  | 'swap_own'                // swap two of your own pieces
  | 'neural_link'             // passive: see legal moves of the enemy's last-moved piece
  | 'airstrike'               // destroy an enemy piece and every enemy (non-king) piece around it
  | 'sabotage_marker';        // pre-game sabotage card already applied at the start

export type AbilityTrigger = 'on_captured' | 'on_capture' | 'on_enemy_move' | 'always';

export interface AbilityTarget {
  kind: 'none' | 'own_piece' | 'enemy_piece' | 'empty_square' | 'any_square' | 'own_then_empty' | 'own_pair';
  /** Target must be within this Chebyshev distance of a friendly `anchor` piece. */
  range?: number;
  anchor?: PieceClass;
  /** Line-of-sight from the anchor along rank/file (rook) or diagonal (bishop). */
  lineOfSight?: 'orthogonal' | 'diagonal';
  /** Disallowed piece classes for the selected piece. */
  excludeClasses?: PieceClass[];
  /** Restrict placement to these ranks (1-8, from white's view). */
  ranks?: number[];
  /** Restrict to target pieces of these classes. */
  onlyClasses?: PieceClass[];
}

export interface AbilityDef {
  id: string;
  /** 'any' = not tied to a faction (sabotage cards, killstreak rewards). */
  faction: BuiltinFactionId | 'any';
  name: string;
  kind: 'passive' | 'active';
  /** Piece-specific abilities require a living piece of this class. */
  pieceClass?: PieceClass;
  description: string;
  flavor: string;
  icon: string;
  charges: number;
  maxCharges?: number;
  /** Own turns before it can be used again. */
  cooldown: number;
  /** Using it replaces your move (otherwise it is a free action before moving). */
  consumesTurn: boolean;
  trigger?: AbilityTrigger;
  target: AbilityTarget;
  effect: { type: AbilityEffectType; radius?: number; duration?: number; grants?: string; hidden?: boolean };
}

export const ABILITIES: AbilityDef[] = [
  // ------------------------------------------------ REMNANTS — information
  {
    id: 'rem_intel', faction: 'remnants', name: "Dead Man's Intel", kind: 'passive', icon: 'eye',
    description: 'When one of your pieces is captured, the capturing piece is tracked: you see every move it can make for 2 turns.',
    flavor: 'Every soldier carries a transmitter. Even the dead ones report in.',
    charges: 0, cooldown: 0, consumesTurn: false, trigger: 'on_captured',
    target: { kind: 'none' }, effect: { type: 'mark_attacker', duration: 2 },
  },
  {
    id: 'rem_recon', faction: 'remnants', name: 'Recon Drone', kind: 'active', icon: 'drone',
    description: 'Reveal every square the enemy currently threatens for 2 turns, and expose one hidden enemy ability.',
    flavor: 'Battery at 12%. Make it count.',
    charges: 2, cooldown: 3, consumesTurn: false,
    target: { kind: 'none' }, effect: { type: 'reveal_threats', duration: 2 },
  },
  {
    id: 'rem_smoke', faction: 'remnants', name: 'Smoke Screen', kind: 'active', pieceClass: 'knight', icon: 'smoke',
    description: 'An Outrider throws smoke within 2 squares of itself. For the enemy\'s next turn, no captures can be made inside the 3x3 cloud.',
    flavor: 'You cannot shoot what you cannot see.',
    charges: 2, cooldown: 4, consumesTurn: false,
    target: { kind: 'any_square', range: 2, anchor: 'knight' }, effect: { type: 'no_capture_zone', radius: 1, duration: 1 },
  },
  // ------------------------------------------------ MACHINES — defense
  {
    id: 'mac_bulwark', faction: 'machines', name: 'Interlocked Chassis', kind: 'passive', icon: 'chain',
    description: 'Your pawns with a friendly pawn directly beside them (same rank) cannot be captured by enemy pawns.',
    flavor: 'Locked shoulder to shoulder. Load-bearing.',
    charges: 0, cooldown: 0, consumesTurn: false, trigger: 'always',
    target: { kind: 'none' }, effect: { type: 'pawn_bulwark' },
  },
  {
    id: 'mac_shield', faction: 'machines', name: 'Shield Field', kind: 'active', icon: 'shield',
    description: 'Project a field around one of your non-king pieces. It cannot be captured during the enemy\'s next turn.',
    flavor: 'Rated for artillery. Mostly.',
    charges: 2, cooldown: 3, consumesTurn: false,
    target: { kind: 'own_piece', excludeClasses: ['king'] }, effect: { type: 'shield_piece', duration: 1 },
  },
  {
    id: 'mac_lockdown', faction: 'machines', name: 'Magnetic Lockdown', kind: 'active', pieceClass: 'rook', icon: 'magnet',
    description: 'An Excavator clamps an enemy piece in its unobstructed rank or file. That piece cannot move on the enemy\'s next turn.',
    flavor: 'Industrial electromagnet. Built for cars. Works on anything.',
    charges: 2, cooldown: 4, consumesTurn: false,
    target: { kind: 'enemy_piece', anchor: 'rook', lineOfSight: 'orthogonal', excludeClasses: ['king'] }, effect: { type: 'freeze_piece', duration: 1 },
  },
  // ------------------------------------------------ WASTELANDERS — aggression
  {
    id: 'wl_momentum', faction: 'wastelanders', name: "Raider's Momentum", kind: 'passive', icon: 'flame',
    description: 'Every capture you make salvages enough scrap for another Scrap Mine (max 2 stored).',
    flavor: 'Their loss is literally our gain.',
    charges: 0, cooldown: 0, consumesTurn: false, trigger: 'on_capture',
    target: { kind: 'none' }, effect: { type: 'grant_charge', grants: 'wl_mine' },
  },
  {
    id: 'wl_mine', faction: 'wastelanders', name: 'Scrap Mine', kind: 'active', icon: 'mine',
    description: 'Bury a hidden mine on an empty square in ranks 3-6. The first enemy piece (not the king) to end its move there is destroyed.',
    flavor: 'Pressure plate, pipe, nails, prayer.',
    charges: 1, maxCharges: 2, cooldown: 2, consumesTurn: false,
    target: { kind: 'empty_square', ranks: [3, 4, 5, 6] }, effect: { type: 'mine', hidden: true },
  },
  {
    id: 'wl_molotov', faction: 'wastelanders', name: 'Molotov', kind: 'active', pieceClass: 'pawn', icon: 'molotov',
    description: 'A Scavenger hurls a firebomb: destroy an enemy pawn within 2 squares of one of your pawns. Uses your turn.',
    flavor: 'Fuel is rare. This is a good use of it.',
    charges: 1, cooldown: 0, consumesTurn: true,
    target: { kind: 'enemy_piece', range: 2, anchor: 'pawn', onlyClasses: ['pawn'] }, effect: { type: 'destroy_enemy_pawn' },
  },
  // ------------------------------------------------ VAULT — technology / manipulation
  {
    id: 'vault_link', faction: 'vault', name: 'Neural Link', kind: 'passive', icon: 'brain',
    description: 'After every enemy move, you see every move that piece can make next.',
    flavor: 'Predictive models trained on four decades of tactical data.',
    charges: 0, cooldown: 0, consumesTurn: false, trigger: 'on_enemy_move',
    target: { kind: 'none' }, effect: { type: 'neural_link', duration: 1 },
  },
  {
    id: 'vault_phase', faction: 'vault', name: 'Phase Shift', kind: 'active', icon: 'phase',
    description: 'Teleport one of your pieces (not King or Pawn) to an empty square within 2. Uses your turn.',
    flavor: 'Experimental. Side effects include nausea and existential dread.',
    charges: 1, cooldown: 0, consumesTurn: true,
    target: { kind: 'own_then_empty', range: 2, excludeClasses: ['king', 'pawn'] }, effect: { type: 'teleport_own' },
  },
  {
    id: 'vault_emp', faction: 'vault', name: 'EMP Pulse', kind: 'active', pieceClass: 'bishop', icon: 'emp',
    description: 'An Overseer Tech detonates an EMP on its diagonal (within 3). Enemy pieces in the 3x3 blast cannot move next turn.',
    flavor: 'Hardened circuits are a pre-war luxury. They do not have them.',
    charges: 1, cooldown: 0, consumesTurn: false,
    target: { kind: 'any_square', range: 3, anchor: 'bishop', lineOfSight: 'diagonal' }, effect: { type: 'freeze_area', radius: 1, duration: 1 },
  },
];

/**
 * Sabotage cards: each War Chess player secretly picks one before the match.
 * Two arm abilities, two are applied the instant the match begins.
 */
export const SABOTAGE: AbilityDef[] = [
  {
    id: 'sab_minefield', faction: 'any', name: 'Minefield', kind: 'active', icon: 'mine',
    description: 'Two extra hidden mines you can bury anywhere in the middle four ranks (free action).',
    flavor: 'Somebody dug up the no-man\'s-land last night.',
    charges: 2, cooldown: 0, consumesTurn: false, target: { kind: 'empty_square', ranks: [3, 4, 5, 6] }, effect: { type: 'mine', hidden: true },
  },
  {
    id: 'sab_sleeper', faction: 'any', name: 'Sleeper Charge', kind: 'active', icon: 'bomb',
    description: 'Once per match, detonate a charge planted under any enemy pawn, knight or bishop (uses your turn).',
    flavor: 'It was in the boots the whole time.',
    charges: 1, cooldown: 0, consumesTurn: true, target: { kind: 'enemy_piece', onlyClasses: ['pawn', 'knight', 'bishop'] }, effect: { type: 'destroy_enemy_pawn' },
  },
  {
    id: 'sab_saboteur', faction: 'any', name: 'Saboteur', kind: 'passive', icon: 'wrench',
    description: 'Two random enemy knights/bishops/rooks start the match jammed and cannot move for their first 3 turns.',
    flavor: 'Sugar in the fuel tanks.',
    charges: 0, cooldown: 0, consumesTurn: false, target: { kind: 'none' }, effect: { type: 'sabotage_marker' },
  },
  {
    id: 'sab_jammer', faction: 'any', name: 'Signal Jammer', kind: 'passive', icon: 'jam',
    description: "The enemy's active abilities all start on a 4-turn cooldown.",
    flavor: 'Static on every channel.',
    charges: 0, cooldown: 0, consumesTurn: false, target: { kind: 'none' }, effect: { type: 'sabotage_marker' },
  },
];
export const SABOTAGE_IDS = SABOTAGE.map((s) => s.id);

/** Killstreak reward: capture KILLSTREAK pieces in a row before the enemy takes one. */
export const KILLSTREAK = 2;
export const AIRSTRIKE: AbilityDef = {
  id: 'ks_airstrike', faction: 'any', name: 'Airstrike', kind: 'active', icon: 'airstrike',
  description: `Earned by capturing ${KILLSTREAK} pieces in a row. Bomb an enemy piece: it and every enemy piece around it (not the king) is destroyed. Uses your turn.`,
  flavor: 'Danger close.',
  charges: 0, maxCharges: 2, cooldown: 0, consumesTurn: true, target: { kind: 'enemy_piece', excludeClasses: ['king'] }, effect: { type: 'airstrike', radius: 1 },
};

export const ABILITIES_BY_ID: Record<string, AbilityDef> = Object.fromEntries([...ABILITIES, ...SABOTAGE, AIRSTRIKE].map((a) => [a.id, a]));

export function abilitiesFor(faction: string): AbilityDef[] {
  return ABILITIES.filter((a) => a.faction === faction);
}
