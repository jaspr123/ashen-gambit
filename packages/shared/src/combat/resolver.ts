// CombatResolver: picks the combat sequence and death for a capture using a
// lookup/fallback chain, so we never need N x N x factions hand-made fights.
//
//   1. <faction>:<atk>_vs_<def>:<finisher>     faction-specific matchup
//   1b. <faction>:<atk>:any                    custom army's authored sequence
//   2. <atk>_vs_<def>:<finisher>               matchup for this finisher
//   3. <atk>:<finisher>                        the finisher's generic version
//   4. rig:<attackerRig>:capture               e.g. vehicles that cannot swing
//   5. faction_<faction>_capture               faction generic
//   6. base_capture                            always exists
//
// Death type: explicit type in the timeline wins, otherwise chosen from the
// defender's compatible deaths, weighted by attacker class and rig, with a
// deterministic seed so every client (players, spectators, replays) agrees.

import type { FactionId, PieceClass, RigType } from '../types.js';
import { FINISHERS } from '../game-data/finishers.js';
import { DEATH_TYPES, type DeathTypeId } from '../game-data/deaths.js';
import { normalizeSequence, type CombatSequence } from './timeline.js';

export interface CombatContext {
  attackerClass: PieceClass;
  defenderClass: PieceClass;
  attackerFaction: FactionId;
  defenderFaction: FactionId;
  finisherId: string;
  attackerRig: RigType;
  defenderRig: RigType;
  /** Deaths the defender model supports (first = default). */
  defenderDeaths: readonly DeathTypeId[];
  /** Deterministic seed, e.g. ply number. */
  seed: number;
}

export interface ResolvedCombat {
  sequence: CombatSequence;
  /** Which key in the chain matched (for debugging / Combat Laboratory). */
  matchedKey: string;
  chain: string[];
  deathType: DeathTypeId;
}

const BASE_CAPTURE: CombatSequence = {
  id: 'base_capture', name: 'Generic Capture', duration: 2.0,
  events: [
    { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.2 },
    { t: 0.05, type: 'move', actor: 'attacker', to: 'strike', duration: 0.5, ease: 'inOut', action: 'RUN' },
    { t: 0.3, type: 'face', actor: 'defender', toward: 'other', duration: 0.25 },
    { t: 0.55, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY' },
    { t: 0.8, type: 'impact', strength: 'medium', fx: 'spark', hit: 'HIT_LIGHT', knock: 0.2 },
    { t: 0.9, type: 'death', deathType: 'auto' },
    { t: 1.55, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
  ],
};

function factionCapture(faction: string, flavor: { fx: 'spark' | 'metal_hit' | 'energy_burst' | 'blood_dust'; sound: string }): CombatSequence {
  return {
    id: `faction_${faction}_capture`, name: `${faction} capture`, duration: 2.1,
    events: [
      { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.2 },
      { t: 0.05, type: 'move', actor: 'attacker', to: 'strike', duration: 0.5, ease: 'inOut', action: 'RUN' },
      { t: 0.3, type: 'face', actor: 'defender', toward: 'other', duration: 0.25 },
      { t: 0.55, type: 'anim', actor: 'attacker', action: 'ATTACK_PRIMARY' },
      { t: 0.8, type: 'impact', strength: 'medium', fx: flavor.fx, sound: flavor.sound, hit: 'HIT_HEAVY', knock: 0.25 },
      { t: 0.9, type: 'death', deathType: 'auto' },
      { t: 1.65, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut', action: 'MOVE' },
    ],
  };
}

const VEHICLE_CAPTURE: CombatSequence = {
  id: 'rig:vehicle:capture', name: 'Vehicle Ram', duration: 2.0,
  events: [
    { t: 0, type: 'face', actor: 'attacker', toward: 'other', duration: 0.35 },
    { t: 0.3, type: 'move', actor: 'attacker', to: 'close', duration: 0.45, ease: 'in' },
    { t: 0.72, type: 'impact', strength: 'massive', fx: 'debris', sound: 'crash', hit: 'HIT_HEAVY', knock: 0.8 },
    { t: 0.75, type: 'shake', strength: 0.6, duration: 0.3 },
    { t: 0.78, type: 'death', deathType: 'knockback_death' },
    { t: 1.55, type: 'move', actor: 'attacker', to: 'target', duration: 0.42, ease: 'inOut' },
  ],
};

/** A registry of named combat sequences. Custom armies register their own at runtime. */
export class CombatRegistry {
  private seqs = new Map<string, CombatSequence>();

  constructor(withBuiltins = true) {
    if (!withBuiltins) return;
    this.register(BASE_CAPTURE);
    this.register(VEHICLE_CAPTURE);
    this.register(factionCapture('remnants', { fx: 'blood_dust', sound: 'hit_flesh' }));
    this.register(factionCapture('machines', { fx: 'metal_hit', sound: 'hit_metal' }));
    this.register(factionCapture('wastelanders', { fx: 'spark', sound: 'hit_metal' }));
    this.register(factionCapture('vault', { fx: 'energy_burst', sound: 'hit_energy' }));
    for (const f of FINISHERS) this.register(f.sequence);
    // Example of a matchup-specific override, as described in the design:
    // Knight vs Pawn with finisher 3 gets a dedicated, shorter ride-through.
    this.register({
      ...FINISHERS.find((f) => f.id === 'knight_f3')!.sequence,
      id: 'knight_vs_pawn:knight_f3', name: 'Ride Through (vs Pawn)', duration: 2.2,
    });
  }

  register(seq: CombatSequence) { this.seqs.set(seq.id, seq); }
  unregister(id: string) { this.seqs.delete(id); }
  get(id: string) { return this.seqs.get(id); }
  has(id: string) { return this.seqs.has(id); }
  list(): CombatSequence[] { return [...this.seqs.values()]; }

  chainFor(ctx: CombatContext): string[] {
    const a = ctx.attackerClass, d = ctx.defenderClass, f = ctx.finisherId;
    return [
      `${ctx.attackerFaction}:${a}_vs_${d}:${f}`,
      // Custom armies bind one authored kill sequence per attacking class.
      `${ctx.attackerFaction}:${a}:any`,
      `${a}_vs_${d}:${f}`,
      `${a}:${f}`,
      `rig:${ctx.attackerRig}:capture`,
      `faction_${ctx.attackerFaction}_capture`,
      'base_capture',
    ];
  }

  resolve(ctx: CombatContext): ResolvedCombat {
    const chain = this.chainFor(ctx);
    // Vehicle/static rigs skip melee finishers that assume limbs unless a vehicle-specific one exists.
    const limbless = ctx.attackerRig === 'vehicle' || ctx.attackerRig === 'static';
    let matchedKey = 'base_capture';
    for (const key of chain) {
      if (limbless && (key.endsWith(`:${ctx.finisherId}`))) continue;
      if (this.seqs.has(key)) { matchedKey = key; break; }
    }
    const sequence = normalizeSequence(this.seqs.get(matchedKey)!);
    const explicit = sequence.events.find((e) => e.type === 'death');
    const wanted: DeathTypeId | undefined = explicit && explicit.type === 'death' && explicit.deathType && explicit.deathType !== 'auto' ? explicit.deathType : undefined;
    const deathType = pickDeath(ctx, wanted);
    return { sequence, matchedKey, chain, deathType };
  }
}

function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickDeath(ctx: CombatContext, wanted?: DeathTypeId): DeathTypeId {
  const supported = ctx.defenderDeaths.length ? ctx.defenderDeaths : (['light_death'] as DeathTypeId[]);
  // A timeline may ask for a specific death; honour it only if the model can do it,
  // or if it is family-compatible (an organic death on a robot looks wrong).
  if (wanted) {
    if (supported.includes(wanted)) return wanted;
    const fam = DEATH_TYPES[wanted].family;
    const mech = ctx.defenderRig === 'mechanical' || ctx.defenderRig === 'vehicle';
    if (fam === 'any' || (fam === 'mechanical') === mech) return wanted;
  }
  const heavyHitter = ctx.attackerClass === 'rook' || ctx.attackerClass === 'king' || ctx.attackerClass === 'queen';
  const weights = supported.map((d, i) => {
    let w = i === 0 ? 3 : 2;
    if (heavyHitter && (d === 'heavy_death' || d === 'knockback_death' || d === 'disassembly' || d === 'mechanical_collapse')) w += 3;
    if (!heavyHitter && (d === 'light_death' || d === 'side_collapse' || d === 'backward_collapse' || d === 'mechanical_shutdown')) w += 1;
    return w;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = mulberry(ctx.seed * 9973 + ctx.attackerClass.length * 31 + ctx.defenderClass.length)() * total;
  for (let i = 0; i < supported.length; i++) { r -= weights[i]; if (r <= 0) return supported[i]; }
  return supported[0];
}

export const defaultCombatRegistry = new CombatRegistry();
