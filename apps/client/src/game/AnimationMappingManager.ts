// AnimationMappingManager — maps imported clip names to canonical game actions
// (auto-suggest by keywords, e.g. "Armature|Action.004" stays manual while
// "Knight_Attack_Heavy" maps itself), detects known skeletons, and retargets
// library clips onto compatible rigs by bone-name matching.

import * as THREE from 'three';
import { GAME_ACTIONS, type GameAction } from '@ashen/shared';

const KEYWORDS: Partial<Record<GameAction, RegExp[]>> = {
  IDLE: [/idle/i, /breath/i, /stand/i],
  MOVE: [/walk/i, /move/i, /step/i],
  RUN: [/run/i, /sprint/i, /jog/i, /gallop(?!.*jump)/i, /charge/i],
  ATTACK_READY: [/ready/i, /guard/i, /combat.?idle/i, /stance/i],
  ATTACK_PRIMARY: [/attack(?!.*heavy)/i, /slash/i, /swing/i, /punch/i, /melee.?one/i, /hit_?1/i, /strike/i],
  ATTACK_HEAVY: [/heavy/i, /smash/i, /slam/i, /two.?hand/i, /power/i],
  ATTACK_STAB: [/stab/i, /thrust/i, /lunge/i, /poke/i],
  ATTACK_RANGED: [/shoot/i, /fire/i, /cast/i, /aim/i, /gun/i],
  ATTACK_THROW: [/throw/i, /grenade/i, /toss/i],
  HIT_LIGHT: [/hit(?!.*heavy)/i, /react/i, /flinch/i, /hurt/i, /damage/i],
  HIT_HEAVY: [/hit.*heavy/i, /stagger/i, /knock/i],
  DEATH_LIGHT: [/death(?!.*0?2)/i, /die/i, /dead(?!.*idle)/i],
  DEATH_HEAVY: [/death.*0?2/i, /collapse/i, /fall/i],
  DEATH_KNOCKBACK: [/knock.?back/i, /fly/i],
  DEATH_MECHANICAL: [/shut.?down/i, /power.?down/i, /break/i],
  DEFEATED_IDLE: [/dead.?idle/i, /lying/i, /down.?idle/i],
  VICTORY: [/victory/i, /win/i, /cheer/i, /salute/i, /celebrat/i],
  TAUNT: [/taunt/i, /cross.?arms/i, /provoke/i],
  JUMP: [/jump/i, /leap/i, /hop/i],
};

/** Suggest a clip for each action from clip names; never assigns the same clip twice to unrelated actions. */
export function suggestClipMap(clipNames: string[]): Partial<Record<GameAction, string>> {
  const out: Partial<Record<GameAction, string>> = {};
  for (const action of GAME_ACTIONS) {
    const pats = KEYWORDS[action];
    if (!pats) continue;
    const hit = clipNames.find((n) => pats.some((p) => p.test(n.split('|').pop() ?? n)));
    if (hit) out[action] = hit;
  }
  return out;
}

export type SkeletonKind = 'synty' | 'mixamo' | 'unreal' | 'unknown' | 'none';

export function detectSkeleton(root: THREE.Object3D): { kind: SkeletonKind; bones: string[] } {
  const bones: string[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o.name); });
  if (!bones.length) return { kind: 'none', bones };
  const has = (re: RegExp) => bones.some((b) => re.test(b));
  if (has(/_jnt$/) && has(/Hips_jnt/)) return { kind: 'synty', bones };
  if (has(/^mixamorig/i)) return { kind: 'mixamo', bones };
  if (has(/^pelvis$/i) && has(/spine_0?1/i)) return { kind: 'unreal', bones };
  return { kind: 'unknown', bones };
}

/** Canonical humanoid bone names → patterns for each common naming convention. */
const CANON: Record<string, RegExp> = {
  hips: /hips|pelvis/i, spine: /spine(_?0?1)?$|spine_jnt/i, chest: /spine.?0?2|chest/i, neck: /neck/i, head: /head(?!.*top|.*end)/i,
  lshoulder: /(left|l_|_l\b|\.l\b).*(shoulder|clavicle)|(shoulder|clavicle).*(left|_l\b|\.l\b)/i,
  larm: /(left|l_|\.l\b).*(upper.?arm|^arm)|(upper.?arm|arm)_left|leftarm/i, lforearm: /(left|l_).*fore.?arm|fore.?arm.*left|lowerarm_left/i, lhand: /(left|l_).*hand|hand.*left/i,
  rshoulder: /(right|r_|_r\b|\.r\b).*(shoulder|clavicle)|(shoulder|clavicle).*(right|_r\b|\.r\b)/i,
  rarm: /(right|r_|\.r\b).*(upper.?arm|^arm)|(upper.?arm|arm)_right|rightarm/i, rforearm: /(right|r_).*fore.?arm|fore.?arm.*right|lowerarm_right/i, rhand: /(right|r_).*hand|hand.*right/i,
  lthigh: /(left|l_).*(up.?leg|thigh)|(upperleg|thigh)_left/i, lshin: /(left|l_).*(leg$|shin|calf|lowerleg)|lowerleg_left/i, lfoot: /(left|l_).*foot|foot_left/i,
  rthigh: /(right|r_).*(up.?leg|thigh)|(upperleg|thigh)_right/i, rshin: /(right|r_).*(leg$|shin|calf|lowerleg)|lowerleg_right/i, rfoot: /(right|r_).*foot|foot_right/i,
};

function canonicalMap(bones: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const [canon, re] of Object.entries(CANON)) {
    const b = bones.find((x) => re.test(x));
    if (b) m.set(canon, b);
  }
  return m;
}

/**
 * Retarget library clips onto a target skeleton by matching canonical bones.
 * Returns the clips that could be retargeted (needs >= 12 matched bones).
 */
export function retargetClips(target: THREE.Object3D, sourceRoot: THREE.Object3D, clips: THREE.AnimationClip[]): { clips: THREE.AnimationClip[]; matched: number } {
  const tBones: string[] = [], sBones: string[] = [];
  target.traverse((o) => { if ((o as THREE.Bone).isBone) tBones.push(o.name); });
  sourceRoot.traverse((o) => { if ((o as THREE.Bone).isBone) sBones.push(o.name); });
  const tMap = canonicalMap(tBones), sMap = canonicalMap(sBones);
  const rename = new Map<string, string>();
  for (const [canon, sName] of sMap) { const tName = tMap.get(canon); if (tName) rename.set(sName, tName); }
  if (rename.size < 12) return { clips: [], matched: rename.size };
  const out = clips.map((clip) => {
    const tracks = clip.tracks
      .map((tr) => {
        const [bone, prop] = splitTrack(tr.name);
        const mapped = rename.get(bone);
        // Only rotations transfer cleanly between proportions; hips keep position for weight shifts.
        if (!mapped || (prop === 'position' && !/hips|pelvis/i.test(bone)) || prop === 'scale') return null;
        const t = tr.clone();
        t.name = `${mapped}.${prop}`;
        return t;
      })
      .filter(Boolean) as THREE.KeyframeTrack[];
    return new THREE.AnimationClip(`lib:${clip.name}`, clip.duration, tracks);
  });
  return { clips: out, matched: rename.size };
}

function splitTrack(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  return [name.slice(0, i), name.slice(i + 1)];
}
