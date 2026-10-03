// Finishing moves. Each piece class has several selectable finishers; the
// selected finisher id feeds the CombatResolver lookup chain. Adding a new
// finisher is a data-only change: add an entry here (or register one at
// runtime for custom armies) and it becomes selectable and playable.

import type { PieceClass } from '../types.js';
import type { CombatSequence, TimelineEvent } from '../combat/timeline.js';

export interface FinisherDef {
  id: string;
  pieceClass: PieceClass;
  slot: number;
  name: string;
  description: string;
  /** Unlock requirement; 0 = available from the start. */
  unlock: { wins?: number; captures?: number; kingDefeats?: number };
  /** Rough spectacle tier 1-5, scales camera emphasis. */
  spectacle: number;
  sequence: CombatSequence;
}

const E = (events: TimelineEvent[]) => events;

// ---------------------------------------------------------------- PAWN
const pawn: FinisherDef[] = [
  {
    id: 'pawn_f1', pieceClass: 'pawn', slot: 1, name: 'Desperate Lunge', description: 'Charge in and strike first.', unlock: {}, spectacle: 1,
    sequence: { id: 'pawn:pawn_f1', name: 'Desperate Lunge', duration: 2.0, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.15 },
      { t: 0, type: 'face', actor: 'defender', toward: 'other', duration: 0.3 },
      { t: 0.05, type: 'move', actor: 'attacker', to: 'strike', duration: 0.45, ease: 'in', action: 'RUN' },
      { t: 0.3, type: 'anim', actor: 'defender', action: 'ATTACK_READY' },
      { t: 0.5, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY', speed: 1.3 },
      { t: 0.72, type: 'impact', strength: 'medium', fx: 'blood_dust', hit: 'HIT_LIGHT', knock: 0.15 },
      { t: 0.85, type: 'death', deathType: 'auto' },
      { t: 1.55, type: 'move', actor: 'attacker', to: 'target', duration: 0.4, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'pawn_f2', pieceClass: 'pawn', slot: 2, name: 'Scrap Brawl', description: 'A short, ugly exchange of blows.', unlock: { captures: 10 }, spectacle: 2,
    sequence: { id: 'pawn:pawn_f2', name: 'Scrap Brawl', duration: 2.6, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.15 },
      { t: 0, type: 'face', actor: 'defender', toward: 'other', duration: 0.2 },
      { t: 0.05, type: 'move', actor: 'attacker', to: 'strike', duration: 0.4, ease: 'out', action: 'RUN' },
      { t: 0.45, type: 'anim', actor: 'defender', action: 'ATTACK_PRIMARY', speed: 1.2 },
      { t: 0.65, type: 'impact', strength: 'light', fx: 'spark', sound: 'block' },
      { t: 0.7, type: 'move', actor: 'attacker', to: 'retreat', duration: 0.2, ease: 'out' },
      { t: 0.95, type: 'move', actor: 'attacker', to: 'strike', duration: 0.18, ease: 'in' },
      { t: 0.95, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.3 },
      { t: 1.25, type: 'impact', strength: 'heavy', fx: 'blood_dust', hit: 'HIT_HEAVY', knock: 0.3 },
      { t: 1.3, type: 'shake', strength: 0.3, duration: 0.25 },
      { t: 1.35, type: 'death', deathType: 'auto' },
      { t: 2.15, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'pawn_f3', pieceClass: 'pawn', slot: 3, name: 'Point Blank', description: 'Close the gap and fire at contact range.', unlock: { wins: 5 }, spectacle: 2,
    sequence: { id: 'pawn:pawn_f3', name: 'Point Blank', duration: 2.3, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.15 },
      { t: 0.05, type: 'move', actor: 'attacker', to: 'close', duration: 0.55, ease: 'inOut', action: 'RUN' },
      { t: 0.35, type: 'face', actor: 'defender', toward: 'other', duration: 0.2 },
      { t: 0.6, type: 'anim', actor: 'attacker', action: 'ATTACK_RANGED' },
      { t: 0.8, type: 'fx', fx: 'muzzle_flash', at: 'attacker' },
      { t: 0.8, type: 'impact', strength: 'heavy', fx: 'blood_dust', sound: 'gunshot', hit: 'HIT_HEAVY', knock: 0.45 },
      { t: 0.85, type: 'death', deathType: 'knockback_death' },
      { t: 1.85, type: 'move', actor: 'attacker', to: 'target', duration: 0.4, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
];

// ---------------------------------------------------------------- KNIGHT
const knight: FinisherDef[] = [
  {
    id: 'knight_f1', pieceClass: 'knight', slot: 1, name: 'Vaulting Strike', description: 'Leap the line and come down blade-first.', unlock: {}, spectacle: 2,
    sequence: { id: 'knight:knight_f1', name: 'Vaulting Strike', duration: 2.4, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.15 },
      { t: 0.1, type: 'anim', actor: 'attacker', action: 'JUMP' },
      { t: 0.15, type: 'move', actor: 'attacker', to: 'strike', duration: 0.7, ease: 'inOut', arc: 1.4 },
      { t: 0.4, type: 'face', actor: 'defender', toward: 'other', duration: 0.25 },
      { t: 0.75, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.4 },
      { t: 0.95, type: 'impact', strength: 'heavy', fx: 'slash_trail', hit: 'HIT_HEAVY', knock: 0.35 },
      { t: 0.95, type: 'fx', fx: 'dust_ring', at: 'attacker' },
      { t: 1.0, type: 'shake', strength: 0.35, duration: 0.25 },
      { t: 1.05, type: 'death', deathType: 'auto' },
      { t: 1.95, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'knight_f2', pieceClass: 'knight', slot: 2, name: 'Flanking Run', description: 'Circle to the side, then cut through.', unlock: { captures: 15 }, spectacle: 3,
    sequence: { id: 'knight:knight_f2', name: 'Flanking Run', duration: 2.9, events: E([
      { t: 0, type: 'camera', shot: 'side', strength: 0.6, duration: 1.4 },
      { t: 0.05, type: 'move', actor: 'attacker', to: 'flank_left', duration: 0.6, ease: 'inOut', action: 'RUN' },
      { t: 0.3, type: 'face', actor: 'defender', toward: 'other', duration: 0.4 },
      { t: 0.7, type: 'face', actor: 'attacker', toward: 'other', duration: 0.12 },
      { t: 0.8, type: 'anim', actor: 'attacker', action: 'ATTACK_STAB', speed: 1.3 },
      { t: 0.85, type: 'move', actor: 'attacker', to: 'close', duration: 0.2, ease: 'in' },
      { t: 1.05, type: 'impact', strength: 'medium', fx: 'slash_trail', hit: 'HIT_LIGHT', knock: 0.1 },
      { t: 1.3, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.3 },
      { t: 1.55, type: 'impact', strength: 'heavy', fx: 'blood_dust', hit: 'HIT_HEAVY', knock: 0.4 },
      { t: 1.6, type: 'death', deathType: 'auto' },
      { t: 2.45, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'knight_f3', pieceClass: 'knight', slot: 3, name: 'Ride Through', description: 'Full-speed pass that leaves nothing standing.', unlock: { wins: 10 }, spectacle: 3,
    sequence: { id: 'knight:knight_f3', name: 'Ride Through', duration: 2.6, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.1 },
      { t: 0, type: 'camera', shot: 'low', strength: 0.5, duration: 1.2 },
      { t: 0.05, type: 'move', actor: 'attacker', to: 'strike', duration: 0.35, ease: 'in', action: 'RUN' },
      { t: 0.38, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY', speed: 1.6 },
      { t: 0.4, type: 'move', actor: 'attacker', to: 'behind_target', duration: 0.3, ease: 'out' },
      { t: 0.5, type: 'impact', strength: 'massive', fx: 'slash_trail', hit: 'HIT_HEAVY', knock: 0.2 },
      { t: 0.5, type: 'slowmo', scale: 0.35, duration: 0.35 },
      { t: 0.55, type: 'shake', strength: 0.45, duration: 0.3 },
      { t: 0.8, type: 'face', actor: 'attacker', toward: 'other', duration: 0.3 },
      { t: 0.9, type: 'death', deathType: 'auto' },
      { t: 2.1, type: 'move', actor: 'attacker', to: 'target', duration: 0.45, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
];

// ---------------------------------------------------------------- BISHOP
const bishop: FinisherDef[] = [
  {
    id: 'bishop_f1', pieceClass: 'bishop', slot: 1, name: 'Calculated Shot', description: 'One precise strike from range.', unlock: {}, spectacle: 2,
    sequence: { id: 'bishop:bishop_f1', name: 'Calculated Shot', duration: 2.3, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.3 },
      { t: 0.3, type: 'anim', actor: 'attacker', action: 'ATTACK_RANGED' },
      { t: 0.35, type: 'face', actor: 'defender', toward: 'other', duration: 0.25 },
      { t: 0.65, type: 'fx', fx: 'muzzle_flash', at: 'attacker' },
      { t: 0.7, type: 'fx', fx: 'energy_burst', at: 'defender' },
      { t: 0.7, type: 'impact', strength: 'heavy', sound: 'energy_shot', hit: 'HIT_HEAVY', knock: 0.25 },
      { t: 0.8, type: 'death', deathType: 'auto' },
      { t: 1.55, type: 'move', actor: 'attacker', to: 'target', duration: 0.7, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'bishop_f2', pieceClass: 'bishop', slot: 2, name: 'Diagonal Feint', description: 'Step aside, let them overreach, then strike.', unlock: { captures: 15 }, spectacle: 3,
    sequence: { id: 'bishop:bishop_f2', name: 'Diagonal Feint', duration: 2.8, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.15 },
      { t: 0.05, type: 'move', actor: 'attacker', to: 'strike', duration: 0.6, ease: 'inOut', action: 'MOVE' },
      { t: 0.55, type: 'anim', actor: 'defender', action: 'ATTACK_PRIMARY', speed: 1.2 },
      { t: 0.65, type: 'move', actor: 'attacker', to: 'flank_right', duration: 0.25, ease: 'out' },
      { t: 0.9, type: 'face', actor: 'attacker', toward: 'other', duration: 0.12 },
      { t: 1.0, type: 'anim', actor: 'attacker', action: 'ATTACK_STAB', speed: 1.2 },
      { t: 1.25, type: 'impact', strength: 'heavy', fx: 'electric_arc', hit: 'HIT_HEAVY', knock: 0.25 },
      { t: 1.3, type: 'death', deathType: 'side_collapse' },
      { t: 2.35, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'bishop_f3', pieceClass: 'bishop', slot: 3, name: 'Judgement', description: 'A ritual strike charged with stolen power.', unlock: { wins: 12 }, spectacle: 4,
    sequence: { id: 'bishop:bishop_f3', name: 'Judgement', duration: 3.1, events: E([
      { t: 0, type: 'camera', shot: 'push', strength: 0.6, duration: 1.6 },
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.3 },
      { t: 0.2, type: 'anim', actor: 'attacker', action: 'TAUNT' },
      { t: 0.3, type: 'fx', fx: 'electric_arc', at: 'attacker', scale: 1.2 },
      { t: 0.5, type: 'face', actor: 'defender', toward: 'other', duration: 0.3 },
      { t: 0.9, type: 'move', actor: 'attacker', to: 'strike', duration: 0.4, ease: 'in' },
      { t: 1.2, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY' },
      { t: 1.45, type: 'impact', strength: 'massive', fx: 'shockwave', hit: 'HIT_HEAVY', knock: 0.6 },
      { t: 1.45, type: 'fx', fx: 'energy_burst', at: 'defender', scale: 1.4 },
      { t: 1.5, type: 'shake', strength: 0.6, duration: 0.35 },
      { t: 1.5, type: 'death', deathType: 'knockback_death' },
      { t: 2.65, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
];

// ---------------------------------------------------------------- ROOK
const rook: FinisherDef[] = [
  {
    id: 'rook_f1', pieceClass: 'rook', slot: 1, name: 'Battering Charge', description: 'Straight line, full weight, no subtlety.', unlock: {}, spectacle: 2,
    sequence: { id: 'rook:rook_f1', name: 'Battering Charge', duration: 2.3, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.25 },
      { t: 0.15, type: 'move', actor: 'attacker', to: 'strike', duration: 0.55, ease: 'in', action: 'RUN' },
      { t: 0.4, type: 'face', actor: 'defender', toward: 'other', duration: 0.2 },
      { t: 0.6, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY' },
      { t: 0.75, type: 'impact', strength: 'massive', fx: 'debris', hit: 'HIT_HEAVY', knock: 0.6 },
      { t: 0.75, type: 'fx', fx: 'dust_ring', at: 'defender', scale: 1.3 },
      { t: 0.78, type: 'shake', strength: 0.6, duration: 0.35 },
      { t: 0.8, type: 'death', deathType: 'knockback_death' },
      { t: 1.85, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'rook_f2', pieceClass: 'rook', slot: 2, name: 'Ground Breaker', description: 'Smash the floor and let the shockwave do the work.', unlock: { captures: 20 }, spectacle: 3,
    sequence: { id: 'rook:rook_f2', name: 'Ground Breaker', duration: 2.8, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.3 },
      { t: 0.1, type: 'move', actor: 'attacker', to: 'strike', duration: 0.7, ease: 'inOut', action: 'MOVE' },
      { t: 0.85, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 0.85 },
      { t: 0.5, type: 'face', actor: 'defender', toward: 'other', duration: 0.3 },
      { t: 1.25, type: 'fx', fx: 'shockwave', at: 'between', scale: 1.5 },
      { t: 1.25, type: 'impact', strength: 'massive', fx: 'debris', sound: 'ground_slam', hit: 'HIT_HEAVY', knock: 0.35 },
      { t: 1.27, type: 'shake', strength: 0.8, duration: 0.45 },
      { t: 1.35, type: 'death', deathType: 'auto' },
      { t: 2.35, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'rook_f3', pieceClass: 'rook', slot: 3, name: 'Suppressing Fire', description: 'Hose the square down, then walk in.', unlock: { wins: 15 }, spectacle: 3,
    sequence: { id: 'rook:rook_f3', name: 'Suppressing Fire', duration: 2.9, events: E([
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.3 },
      { t: 0.3, type: 'anim', actor: 'attacker', action: 'ATTACK_RANGED', loop: true },
      { t: 0.4, type: 'fx', fx: 'muzzle_flash', at: 'attacker' },
      { t: 0.45, type: 'impact', strength: 'light', fx: 'spark', sound: 'gunshot', hit: 'HIT_LIGHT' },
      { t: 0.6, type: 'fx', fx: 'muzzle_flash', at: 'attacker' },
      { t: 0.65, type: 'impact', strength: 'light', fx: 'spark', sound: 'gunshot', hit: 'HIT_LIGHT' },
      { t: 0.8, type: 'fx', fx: 'muzzle_flash', at: 'attacker' },
      { t: 0.85, type: 'impact', strength: 'heavy', fx: 'blood_dust', sound: 'gunshot', hit: 'HIT_HEAVY', knock: 0.35 },
      { t: 0.95, type: 'death', deathType: 'auto' },
      { t: 1.6, type: 'anim', actor: 'attacker', action: 'IDLE' },
      { t: 1.9, type: 'move', actor: 'attacker', to: 'target', duration: 0.9, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
];

// ---------------------------------------------------------------- QUEEN
const queen: FinisherDef[] = [
  {
    id: 'queen_f1', pieceClass: 'queen', slot: 1, name: 'Command Strike', description: 'Disarm, then end it.', unlock: {}, spectacle: 3,
    sequence: { id: 'queen:queen_f1', name: 'Command Strike', duration: 3.0, events: E([
      { t: 0, type: 'camera', shot: 'push', strength: 0.5, duration: 1.8 },
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.2 },
      { t: 0.1, type: 'move', actor: 'attacker', to: 'strike', duration: 0.5, ease: 'inOut', action: 'RUN' },
      { t: 0.35, type: 'face', actor: 'defender', toward: 'other', duration: 0.2 },
      { t: 0.55, type: 'anim', actor: 'defender', action: 'ATTACK_PRIMARY', speed: 1.1 },
      { t: 0.65, type: 'anim', actor: 'attacker', action: 'ATTACK_STAB', speed: 1.4 },
      { t: 0.8, type: 'impact', strength: 'light', fx: 'spark', sound: 'block', hit: 'HIT_LIGHT' },
      { t: 1.1, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.2 },
      { t: 1.4, type: 'impact', strength: 'heavy', fx: 'slash_trail', hit: 'HIT_HEAVY', knock: 0.2 },
      { t: 1.45, type: 'slowmo', scale: 0.4, duration: 0.3 },
      { t: 1.6, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY', speed: 1.3 },
      { t: 1.8, type: 'impact', strength: 'massive', fx: 'blood_dust', hit: 'HIT_HEAVY', knock: 0.5 },
      { t: 1.82, type: 'shake', strength: 0.5, duration: 0.3 },
      { t: 1.85, type: 'death', deathType: 'auto' },
      { t: 2.55, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'queen_f2', pieceClass: 'queen', slot: 2, name: 'Whirlwind', description: 'A spinning combination nobody walks away from.', unlock: { captures: 25 }, spectacle: 4,
    sequence: { id: 'queen:queen_f2', name: 'Whirlwind', duration: 3.2, events: E([
      { t: 0, type: 'camera', shot: 'orbit', strength: 0.6, duration: 2.2 },
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.2 },
      { t: 0.1, type: 'move', actor: 'attacker', to: 'strike', duration: 0.45, ease: 'in', action: 'RUN' },
      { t: 0.3, type: 'face', actor: 'defender', toward: 'other', duration: 0.2 },
      { t: 0.6, type: 'rotate', actor: 'attacker', yaw: 360, duration: 0.45 },
      { t: 0.6, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.5 },
      { t: 0.95, type: 'impact', strength: 'medium', fx: 'slash_trail', hit: 'HIT_LIGHT', knock: 0.1 },
      { t: 1.05, type: 'rotate', actor: 'attacker', yaw: -360, duration: 0.45 },
      { t: 1.05, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY', speed: 1.5 },
      { t: 1.4, type: 'impact', strength: 'heavy', fx: 'slash_trail', hit: 'HIT_HEAVY', knock: 0.2 },
      { t: 1.55, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.2 },
      { t: 1.85, type: 'impact', strength: 'massive', fx: 'shockwave', hit: 'HIT_HEAVY', knock: 0.6 },
      { t: 1.85, type: 'slowmo', scale: 0.3, duration: 0.35 },
      { t: 1.9, type: 'shake', strength: 0.6, duration: 0.3 },
      { t: 1.95, type: 'death', deathType: 'knockback_death' },
      { t: 2.75, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'queen_f3', pieceClass: 'queen', slot: 3, name: 'Execution Order', description: 'Force them to their knees. Deliver the verdict.', unlock: { wins: 20 }, spectacle: 5,
    sequence: { id: 'queen:queen_f3', name: 'Execution Order', duration: 3.6, events: E([
      { t: 0, type: 'camera', shot: 'low', strength: 0.7, duration: 2.6 },
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.3 },
      { t: 0.15, type: 'move', actor: 'attacker', to: 'strike', duration: 0.7, ease: 'inOut', action: 'MOVE' },
      { t: 0.4, type: 'face', actor: 'defender', toward: 'other', duration: 0.3 },
      { t: 0.9, type: 'anim', actor: 'attacker', action: 'ATTACK_STAB', speed: 1.2 },
      { t: 1.1, type: 'impact', strength: 'medium', fx: 'spark', hit: 'HIT_HEAVY', knock: 0.05 },
      { t: 1.3, type: 'move', actor: 'attacker', to: 'close', duration: 0.3, ease: 'out' },
      { t: 1.6, type: 'anim', actor: 'attacker', action: 'TAUNT' },
      { t: 2.1, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.1 },
      { t: 2.35, type: 'slowmo', scale: 0.25, duration: 0.4 },
      { t: 2.35, type: 'impact', strength: 'massive', fx: 'blood_dust', sound: 'execution', hit: 'HIT_HEAVY', knock: 0.25 },
      { t: 2.4, type: 'shake', strength: 0.5, duration: 0.3 },
      { t: 2.4, type: 'death', deathType: 'kneel_and_fall' },
      { t: 3.15, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
];

// ---------------------------------------------------------------- KING (captures + checkmate victory)
const king: FinisherDef[] = [
  {
    id: 'king_f1', pieceClass: 'king', slot: 1, name: 'Royal Decree', description: 'Slow, deliberate, final.', unlock: {}, spectacle: 4,
    sequence: { id: 'king:king_f1', name: 'Royal Decree', duration: 3.2, events: E([
      { t: 0, type: 'camera', shot: 'push', strength: 0.7, duration: 2.4 },
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.5 },
      { t: 0.3, type: 'face', actor: 'defender', toward: 'other', duration: 0.4 },
      { t: 0.4, type: 'move', actor: 'attacker', to: 'strike', duration: 0.9, ease: 'inOut', action: 'MOVE' },
      { t: 0.9, type: 'anim', actor: 'defender', action: 'HIT_LIGHT' },
      { t: 1.35, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 0.9 },
      { t: 1.7, type: 'slowmo', scale: 0.3, duration: 0.4 },
      { t: 1.7, type: 'impact', strength: 'massive', fx: 'shockwave', hit: 'HIT_HEAVY', knock: 0.5 },
      { t: 1.75, type: 'shake', strength: 0.7, duration: 0.4 },
      { t: 1.8, type: 'death', deathType: 'auto' },
      { t: 2.7, type: 'move', actor: 'attacker', to: 'target', duration: 0.45, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'king_f2', pieceClass: 'king', slot: 2, name: 'Last Word', description: 'He lets them strike first. It does not matter.', unlock: { kingDefeats: 3 }, spectacle: 5,
    sequence: { id: 'king:king_f2', name: 'Last Word', duration: 3.6, events: E([
      { t: 0, type: 'camera', shot: 'side', strength: 0.7, duration: 2.8 },
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.4 },
      { t: 0.2, type: 'face', actor: 'defender', toward: 'other', duration: 0.3 },
      { t: 0.3, type: 'move', actor: 'defender', to: 'pushed', duration: 0.01 },
      { t: 0.4, type: 'move', actor: 'attacker', to: 'strike', duration: 0.8, ease: 'inOut', action: 'MOVE' },
      { t: 1.0, type: 'anim', actor: 'defender', action: 'ATTACK_HEAVY' },
      { t: 1.3, type: 'impact', strength: 'medium', fx: 'spark', sound: 'block' },
      { t: 1.35, type: 'anim', actor: 'attacker', action: 'TAUNT' },
      { t: 1.95, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY', speed: 1.1 },
      { t: 2.2, type: 'slowmo', scale: 0.25, duration: 0.45 },
      { t: 2.2, type: 'impact', strength: 'massive', fx: 'shockwave', hit: 'HIT_HEAVY', knock: 0.7 },
      { t: 2.25, type: 'shake', strength: 0.8, duration: 0.4 },
      { t: 2.3, type: 'death', deathType: 'auto' },
      { t: 3.15, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
  {
    id: 'king_f3', pieceClass: 'king', slot: 3, name: 'End of the World', description: 'The prestige execution. Reserved for those who earn it.', unlock: { kingDefeats: 10 }, spectacle: 5,
    sequence: { id: 'king:king_f3', name: 'End of the World', duration: 4.0, events: E([
      { t: 0, type: 'camera', shot: 'orbit', strength: 0.8, duration: 3.2 },
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.5 },
      { t: 0.2, type: 'anim', actor: 'attacker', action: 'VICTORY' },
      { t: 0.5, type: 'face', actor: 'defender', toward: 'other', duration: 0.4 },
      { t: 0.9, type: 'fx', fx: 'fire_burst', at: 'attacker', scale: 1.1 },
      { t: 1.1, type: 'move', actor: 'attacker', to: 'strike', duration: 0.7, ease: 'in', action: 'RUN' },
      { t: 1.75, type: 'anim', actor: 'attacker', action: 'ATTACK_HEAVY' },
      { t: 2.0, type: 'impact', strength: 'heavy', fx: 'slash_trail', hit: 'HIT_HEAVY', knock: 0.1 },
      { t: 2.3, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY', speed: 1.2 },
      { t: 2.55, type: 'slowmo', scale: 0.2, duration: 0.5 },
      { t: 2.55, type: 'impact', strength: 'massive', fx: 'shockwave', sound: 'execution', hit: 'HIT_HEAVY', knock: 0.8 },
      { t: 2.55, type: 'fx', fx: 'fire_burst', at: 'defender', scale: 1.6 },
      { t: 2.6, type: 'shake', strength: 1.0, duration: 0.5 },
      { t: 2.65, type: 'death', deathType: 'auto' },
      { t: 3.55, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ]) },
  },
];

export const FINISHERS: FinisherDef[] = [...pawn, ...knight, ...bishop, ...rook, ...queen, ...king];

export const FINISHERS_BY_ID: Record<string, FinisherDef> = Object.fromEntries(FINISHERS.map((f) => [f.id, f]));

export function finishersFor(pc: PieceClass): FinisherDef[] {
  return FINISHERS.filter((f) => f.pieceClass === pc).sort((a, b) => a.slot - b.slot);
}

export const DEFAULT_FINISHERS = {
  pawn: 'pawn_f1', knight: 'knight_f1', bishop: 'bishop_f1', rook: 'rook_f1', queen: 'queen_f1', king: 'king_f1',
} as const;

export interface UnlockStats { wins: number; captures: number; kingDefeats: number }

export function isFinisherUnlocked(f: FinisherDef, s: UnlockStats): boolean {
  return (f.unlock.wins ?? 0) <= s.wins && (f.unlock.captures ?? 0) <= s.captures && (f.unlock.kingDefeats ?? 0) <= s.kingDefeats;
}
