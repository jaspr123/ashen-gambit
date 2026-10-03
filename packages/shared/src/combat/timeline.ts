// Serializable combat timeline format. Timelines describe a capture as a list
// of timed events against two actors on the real board. They never reference
// raw clips or scene objects, so the same data drives built-in factions,
// uploaded armies, replays, the Combat Laboratory and the Kill Sequence Editor.

import { z } from 'zod';
import { GAME_ACTIONS } from '../game-data/animations.js';
import { DEATH_TYPE_IDS } from '../game-data/deaths.js';

export const ACTORS = ['attacker', 'defender'] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * Board-relative anchor points, resolved at runtime from the two squares.
 *  origin        attacker's starting square
 *  target        the captured square (attacker's final square)
 *  strike        just in front of the defender, along the attack line
 *  close         very close to the defender (grapples, executions)
 *  behind_target one step past the defender (dash-through finishers)
 *  retreat       a short step back from the strike point
 *  flank_left / flank_right  beside the defender
 *  pushed        defender knocked back along the attack line
 *  home          the actor's own square at the start of the sequence
 */
export const ANCHORS = ['origin', 'target', 'strike', 'close', 'behind_target', 'retreat', 'flank_left', 'flank_right', 'pushed', 'home'] as const;
export type Anchor = (typeof ANCHORS)[number];

export const FX_IDS = ['spark', 'metal_hit', 'blood_dust', 'energy_burst', 'muzzle_flash', 'debris', 'shockwave', 'smoke_puff', 'electric_arc', 'fire_burst', 'dust_ring', 'slash_trail'] as const;
export type FxId = (typeof FX_IDS)[number];

export const EASES = ['linear', 'in', 'out', 'inOut', 'back', 'snap'] as const;
export type Ease = (typeof EASES)[number];

const t = z.number().min(0).max(12);
const actor = z.enum(ACTORS);

export const TimelineEventSchema = z.discriminatedUnion('type', [
  z.object({ t, type: z.literal('anim'), actor, action: z.enum(GAME_ACTIONS), speed: z.number().min(0.1).max(4).optional(), loop: z.boolean().optional(), fade: z.number().min(0).max(1).optional() }),
  z.object({ t, type: z.literal('pause_anim'), actor, duration: z.number().min(0).max(3) }),
  z.object({ t, type: z.literal('move'), actor, to: z.enum(ANCHORS), duration: z.number().min(0.01).max(4), ease: z.enum(EASES).optional(), arc: z.number().min(0).max(3).optional(), action: z.enum(GAME_ACTIONS).optional() }),
  z.object({ t, type: z.literal('face'), actor, toward: z.enum(['other', 'forward', 'origin']), duration: z.number().min(0).max(2).optional() }),
  z.object({ t, type: z.literal('rotate'), actor, yaw: z.number().min(-1080).max(1080), duration: z.number().min(0).max(3) }),
  z.object({ t, type: z.literal('impact'), strength: z.enum(['light', 'medium', 'heavy', 'massive']), fx: z.enum(FX_IDS).optional(), sound: z.string().optional(), hit: z.enum(['HIT_LIGHT', 'HIT_HEAVY']).optional(), knock: z.number().min(0).max(1.5).optional() }),
  z.object({ t, type: z.literal('fx'), fx: z.enum(FX_IDS), at: z.enum(['attacker', 'defender', 'between', 'target']), scale: z.number().min(0.1).max(5).optional() }),
  z.object({ t, type: z.literal('sound'), sound: z.string(), at: z.enum(['attacker', 'defender', 'target']).optional(), volume: z.number().min(0).max(2).optional() }),
  z.object({ t, type: z.literal('shake'), strength: z.number().min(0).max(2), duration: z.number().min(0).max(2) }),
  z.object({ t, type: z.literal('death'), deathType: z.union([z.enum(DEATH_TYPE_IDS), z.literal('auto')]).optional() }),
  z.object({ t, type: z.literal('hide'), actor }),
  z.object({ t, type: z.literal('camera'), shot: z.enum(['push', 'low', 'orbit', 'side', 'return', 'focus']), strength: z.number().min(0).max(2).optional(), duration: z.number().min(0).max(4).optional() }),
  z.object({ t, type: z.literal('slowmo'), scale: z.number().min(0.05).max(1), duration: z.number().min(0).max(2) }),
]);
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type TimelineEventType = TimelineEvent['type'];

export const CombatSequenceSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().max(80),
  /** Seconds. The attacker must be on the target square by this time. */
  duration: z.number().min(0.3).max(12),
  events: z.array(TimelineEventSchema).max(200),
});
export type CombatSequence = z.infer<typeof CombatSequenceSchema>;

/** Sorted copy with the guaranteed tail events (arrive on target, defender removed). */
export function normalizeSequence(seq: CombatSequence): CombatSequence {
  const events = [...seq.events].sort((a, b) => a.t - b.t);
  const hasDeath = events.some((e) => e.type === 'death');
  const lastMove = [...events].reverse().find((e) => e.type === 'move' && e.actor === 'attacker');
  const endsOnTarget = lastMove && lastMove.type === 'move' && lastMove.to === 'target';
  const out = [...events];
  if (!hasDeath) out.push({ t: Math.max(0, seq.duration * 0.5), type: 'death', deathType: 'auto' });
  if (!endsOnTarget) out.push({ t: Math.max(0, seq.duration - 0.35), type: 'move', actor: 'attacker', to: 'target', duration: 0.35, ease: 'inOut', action: 'MOVE' });
  return { ...seq, events: out.sort((a, b) => a.t - b.t) };
}

/** Time of the first impact — used for replay scrubbing and for pacing. */
export function firstImpactTime(seq: CombatSequence): number {
  const ev = seq.events.find((e) => e.type === 'impact');
  return ev ? ev.t : seq.duration * 0.5;
}
