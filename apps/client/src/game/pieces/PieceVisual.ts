// PieceVisual — the animation surface of a piece. Combat timelines request
// canonical GameActions; each visual decides how to perform them:
//   ProceduralVisual  part rig from ProceduralPieceFactory (humanoid/mechanical fallback)
//   TransformVisual   any static mesh: whole-object lunges, tilts and hops
//   SkinnedVisual     GLB clips via AnimationMixer (see SkinnedVisual.ts)

import * as THREE from 'three';
import { ACTION_FALLBACKS, type GameAction } from '@ashen/shared';
import type { PieceRig } from './ProceduralPieceFactory';

export type Locomotion = 'idle' | 'move' | 'run';

export interface PieceVisual {
  readonly object: THREE.Object3D;
  /** Everything that falls/breaks on death (excludes the pedestal). */
  readonly body: THREE.Object3D;
  readonly base: THREE.Object3D | null;
  readonly height: number;
  readonly mechanical: boolean;
  readonly breakables: THREE.Mesh[];
  readonly emissive: THREE.MeshStandardMaterial[];
  setLocomotion(state: Locomotion): void;
  /** Play an action; returns its duration in seconds. */
  play(action: GameAction, opts?: { speed?: number; loop?: boolean }): number;
  /** Duration this visual would take for an action (for editors/timelines). */
  durationOf(action: GameAction): number;
  /** Freeze/unfreeze animation (checkmate stillness, timeline pause_anim). */
  setPaused(p: boolean): void;
  update(dt: number): void;
  reset(): void;
  dispose(): void;
}

// ----------------------------------------------------------------------------- pose math
type PartName = 'pelvis' | 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'body';
interface PartDelta { rx?: number; ry?: number; rz?: number; px?: number; py?: number; pz?: number }
type Pose = Partial<Record<PartName, PartDelta>>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const outBack = (x: number) => { const c1 = 1.70158, c3 = c1 + 1, t = clamp01(x) - 1; return 1 + c3 * t * t * t + c1 * t * t; };
/** Piecewise keyframes: [[u, value], ...] smoothly interpolated. */
function keys(u: number, k: [number, number][]): number {
  if (u <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (u <= k[i][0]) {
      const a = k[i - 1], b = k[i];
      return a[1] + (b[1] - a[1]) * smooth((u - a[0]) / (b[0] - a[0]));
    }
  }
  return k[k.length - 1][1];
}

interface ProcAction { dur: number; pose(u: number, p: Pose, mech: boolean): void }

const add = (p: Pose, part: PartName, d: PartDelta) => {
  const cur = (p[part] ??= {});
  for (const k of Object.keys(d) as (keyof PartDelta)[]) cur[k] = (cur[k] ?? 0) + (d[k] ?? 0);
};

/** Procedural action library for part rigs. u = 0..1 normalised time. */
const PROC_ACTIONS: Partial<Record<GameAction, ProcAction>> = {
  ATTACK_READY: { dur: 0.5, pose: (u, p) => {
    const w = smooth(u / 0.4);
    add(p, 'pelvis', { py: -0.03 * w, rx: 0.15 * w });
    add(p, 'armR', { rx: -0.9 * w });
    add(p, 'armL', { rx: -0.6 * w, rz: 0.2 * w });
    add(p, 'legL', { rx: -0.35 * w }); add(p, 'legR', { rx: 0.25 * w });
  } },
  ATTACK_PRIMARY: { dur: 0.6, pose: (u, p) => {
    add(p, 'armR', { rx: keys(u, [[0, 0], [0.4, -2.5], [0.62, 0.55], [1, 0]]), rz: keys(u, [[0, 0], [0.4, 0.3], [0.62, -0.25], [1, 0]]) });
    add(p, 'torso', { ry: keys(u, [[0, 0], [0.4, 0.45], [0.62, -0.45], [1, 0]]), rx: keys(u, [[0, 0], [0.62, 0.3], [1, 0]]) });
    add(p, 'pelvis', { pz: keys(u, [[0, 0], [0.62, 0.08], [1, 0]]) });
    add(p, 'legL', { rx: keys(u, [[0, 0], [0.62, -0.5], [1, 0]]) });
  } },
  ATTACK_HEAVY: { dur: 0.85, pose: (u, p) => {
    const arm = keys(u, [[0, 0], [0.45, -2.9], [0.66, 0.6], [1, 0]]);
    add(p, 'armR', { rx: arm }); add(p, 'armL', { rx: arm * 0.9, rz: keys(u, [[0, 0], [0.45, -0.5], [0.66, -0.5], [1, 0]]) });
    add(p, 'torso', { rx: keys(u, [[0, 0], [0.45, -0.35], [0.66, 0.55], [1, 0]]) });
    add(p, 'pelvis', { py: keys(u, [[0, 0], [0.45, 0.02], [0.66, -0.06], [1, 0]]), pz: keys(u, [[0, 0], [0.66, 0.1], [1, 0]]) });
    add(p, 'legL', { rx: keys(u, [[0, 0], [0.66, -0.7], [1, 0]]) }); add(p, 'legR', { rx: keys(u, [[0, 0], [0.66, 0.4], [1, 0]]) });
  } },
  ATTACK_STAB: { dur: 0.5, pose: (u, p) => {
    add(p, 'armR', { rx: keys(u, [[0, 0], [0.3, -0.7], [0.5, -1.65], [1, 0]]) });
    add(p, 'pelvis', { pz: keys(u, [[0, 0], [0.3, -0.04], [0.5, 0.16], [1, 0]]), py: keys(u, [[0, 0], [0.5, -0.03], [1, 0]]) });
    add(p, 'torso', { rx: keys(u, [[0, 0], [0.5, 0.35], [1, 0]]), ry: keys(u, [[0, 0], [0.3, 0.3], [0.5, -0.2], [1, 0]]) });
    add(p, 'legL', { rx: keys(u, [[0, 0], [0.5, -0.8], [1, 0]]) });
  } },
  ATTACK_RANGED: { dur: 0.65, pose: (u, p) => {
    const aim = keys(u, [[0, 0], [0.3, -1.5], [0.85, -1.5], [1, 0]]);
    const kick = u > 0.45 && u < 0.6 ? Math.sin(((u - 0.45) / 0.15) * Math.PI) * 0.35 : 0;
    add(p, 'armR', { rx: aim - kick }); add(p, 'armL', { rx: aim * 0.85, rz: -0.35 * smooth(u / 0.3) });
    add(p, 'torso', { rx: -kick * 0.4 }); add(p, 'pelvis', { pz: -kick * 0.08 });
  } },
  ATTACK_THROW: { dur: 0.75, pose: (u, p) => {
    add(p, 'armR', { rx: keys(u, [[0, 0], [0.45, -3.0], [0.7, -0.6], [1, 0]]) });
    add(p, 'torso', { ry: keys(u, [[0, 0], [0.45, 0.6], [0.7, -0.4], [1, 0]]) });
  } },
  HIT_LIGHT: { dur: 0.4, pose: (u, p) => {
    const k = keys(u, [[0, 0], [0.18, 1], [1, 0]]);
    add(p, 'torso', { rx: -0.4 * k, rz: 0.12 * k }); add(p, 'head', { rx: -0.35 * k });
    add(p, 'pelvis', { pz: -0.05 * k }); add(p, 'armR', { rx: 0.3 * k }); add(p, 'armL', { rx: 0.4 * k });
  } },
  HIT_HEAVY: { dur: 0.6, pose: (u, p) => {
    const k = keys(u, [[0, 0], [0.15, 1], [0.5, 0.7], [1, 0]]);
    add(p, 'torso', { rx: -0.7 * k, rz: -0.2 * k }); add(p, 'head', { rx: -0.5 * k });
    add(p, 'pelvis', { pz: -0.1 * k, py: -0.03 * k }); add(p, 'armR', { rx: 0.6 * k, rz: 0.4 * k }); add(p, 'armL', { rx: 0.7 * k, rz: -0.5 * k });
    add(p, 'legL', { rx: 0.4 * k });
  } },
  JUMP: { dur: 0.7, pose: (u, p) => {
    add(p, 'pelvis', { py: keys(u, [[0, 0], [0.2, -0.06], [0.4, 0.02], [0.85, 0], [0.92, -0.05], [1, 0]]) });
    add(p, 'legL', { rx: keys(u, [[0, 0], [0.2, -0.6], [0.45, 0.3], [0.85, -0.3], [1, 0]]) }); add(p, 'legR', { rx: keys(u, [[0, 0], [0.2, -0.6], [0.45, -0.4], [0.85, -0.3], [1, 0]]) });
    add(p, 'armL', { rx: keys(u, [[0, 0], [0.2, 0.6], [0.45, -1.4], [1, 0]]) }); add(p, 'armR', { rx: keys(u, [[0, 0], [0.2, 0.6], [0.45, -1.2], [1, 0]]) });
  } },
  TAUNT: { dur: 1.0, pose: (u, p) => {
    const k = keys(u, [[0, 0], [0.25, 1], [0.75, 1], [1, 0]]);
    add(p, 'armR', { rx: -1.2 * k, rz: 0.6 * k }); add(p, 'armL', { rx: -0.3 * k, rz: -0.8 * k });
    add(p, 'torso', { rx: -0.15 * k }); add(p, 'head', { rx: -0.2 * k + Math.sin(u * 20) * 0.03 * k });
  } },
  VICTORY: { dur: 1.2, pose: (u, p) => {
    const k = keys(u, [[0, 0], [0.2, 1], [0.85, 1], [1, 0]]);
    add(p, 'armR', { rx: -2.9 * k }); add(p, 'torso', { rx: -0.2 * k }); add(p, 'head', { rx: -0.3 * k });
    add(p, 'pelvis', { py: Math.abs(Math.sin(u * Math.PI * 3)) * 0.02 * k });
  } },
  DEFEATED_IDLE: { dur: 1, pose: (_u, p) => { add(p, 'torso', { rx: 0.4 }); add(p, 'head', { rx: 0.5 }); add(p, 'armR', { rx: 0.2 }); } },
};

function locomotionPose(state: Locomotion, t: number, p: Pose, rider: boolean, mech: boolean, quality: number) {
  if (state === 'idle') {
    const b = Math.sin(t * 2.1);
    add(p, 'torso', { rx: b * 0.025 }); add(p, 'head', { ry: Math.sin(t * 0.45) * 0.25 * quality, rx: Math.sin(t * 0.8) * 0.04 });
    add(p, 'armL', { rx: b * 0.04 }); add(p, 'armR', { rx: -b * 0.03 });
    add(p, 'pelvis', { py: b * 0.004 });
    if (mech) add(p, 'head', { ry: Math.round(Math.sin(t * 0.35) * 3) * 0.12 }); // servo-stepped scanning
    return;
  }
  const speed = state === 'run' ? 11 : 7.5;
  const ph = t * speed;
  const amp = state === 'run' ? 0.85 : 0.55;
  if (rider) { add(p, 'pelvis', { py: Math.abs(Math.sin(ph)) * 0.012 }); add(p, 'torso', { rx: 0.25 }); return; }
  add(p, 'legL', { rx: Math.sin(ph) * amp }); add(p, 'legR', { rx: -Math.sin(ph) * amp });
  add(p, 'armL', { rx: -Math.sin(ph) * amp * 0.7 }); add(p, 'armR', { rx: Math.sin(ph) * amp * 0.5 });
  add(p, 'pelvis', { py: Math.abs(Math.cos(ph)) * (state === 'run' ? 0.03 : 0.018) });
  add(p, 'torso', { rx: state === 'run' ? 0.25 : 0.08, ry: Math.sin(ph) * 0.08 });
  if (mech) add(p, 'torso', { rz: Math.sin(ph) * 0.05 });
}

// ----------------------------------------------------------------------------- ProceduralVisual
interface ActiveAction { action: GameAction; def: ProcAction; t: number; speed: number; loop: boolean }

export class ProceduralVisual implements PieceVisual {
  readonly object: THREE.Object3D;
  readonly body: THREE.Object3D;
  readonly base: THREE.Object3D | null;
  readonly height: number;
  readonly mechanical: boolean;
  readonly breakables: THREE.Mesh[];
  readonly emissive: THREE.MeshStandardMaterial[];
  private loco: Locomotion = 'idle';
  private time = Math.random() * 10;
  private current: ActiveAction | null = null;
  private weight = 0;
  private paused = false;
  /** Animated parts. The body root is left alone so deaths can drive it. */
  private parts: Partial<Record<PartName, THREE.Object3D>>;
  private wheels: THREE.Object3D[] = [];

  constructor(private rig: PieceRig, private quality = 1) {
    this.object = rig.root;
    this.body = rig.body;
    this.base = rig.base;
    this.height = rig.height;
    this.mechanical = rig.mechanical;
    this.breakables = rig.breakables;
    this.emissive = rig.emissive;
    this.parts = { pelvis: rig.pelvis, torso: rig.torso, head: rig.head, armL: rig.armL, armR: rig.armR, legL: rig.legL, legR: rig.legR };
    rig.root.traverse((o) => { if (o.name === 'wheel') this.wheels.push(o); });
  }

  setLocomotion(state: Locomotion) { this.loco = state; }

  private resolve(action: GameAction): ProcAction | null {
    let a: GameAction | undefined = action;
    const seen = new Set<GameAction>();
    while (a && !seen.has(a)) {
      if (PROC_ACTIONS[a]) return PROC_ACTIONS[a]!;
      seen.add(a);
      a = ACTION_FALLBACKS[a]?.[0];
    }
    return null;
  }

  durationOf(action: GameAction) { return this.resolve(action)?.dur ?? 0.4; }

  play(action: GameAction, opts: { speed?: number; loop?: boolean } = {}) {
    if (action === 'IDLE') { this.current = null; this.loco = 'idle'; return 0; }
    if (action === 'MOVE' || action === 'RUN') { this.current = null; this.loco = action === 'RUN' ? 'run' : 'move'; return 0.5; }
    const def = this.resolve(action);
    if (!def) return 0;
    this.current = { action, def, t: 0, speed: opts.speed ?? 1, loop: !!opts.loop };
    return def.dur / (opts.speed ?? 1);
  }

  setPaused(p: boolean) { this.paused = p; }

  update(dt: number) {
    if (this.paused) return;
    this.time += dt;
    const pose: Pose = {};
    locomotionPose(this.loco, this.time, pose, this.rig.kind === 'rider', this.mechanical, this.quality);
    if (this.current) {
      const c = this.current;
      c.t += dt * c.speed;
      let u = c.t / c.def.dur;
      if (u >= 1) {
        if (c.loop) { c.t = 0; u = 0; } else { this.current = null; }
      }
      this.weight = Math.min(1, this.weight + dt * 14);
      if (this.current) {
        const ap: Pose = {};
        c.def.pose(Math.min(u, 1), ap, this.mechanical);
        for (const k of Object.keys(ap) as PartName[]) {
          const d = ap[k]!;
          for (const f of Object.keys(d) as (keyof PartDelta)[]) add(pose, k, { [f]: d[f]! * this.weight });
        }
      }
    } else this.weight = 0;
    if (this.mechanical) {
      // A touch of servo jitter so machines never look perfectly smooth.
      add(pose, 'head', { rz: (Math.random() - 0.5) * 0.004 });
    }
    this.apply(pose);
    if (this.loco !== 'idle') for (const w of this.wheels) w.rotation.x += dt * 14;
  }

  private apply(p: Pose) {
    for (const k of Object.keys(this.parts) as PartName[]) {
      const o = this.parts[k]!;
      const rest = o.userData.rest as { p: THREE.Vector3; r: THREE.Euler } | undefined;
      if (!rest) continue;
      const d = p[k] ?? {};
      o.position.set(rest.p.x + (d.px ?? 0), rest.p.y + (d.py ?? 0), rest.p.z + (d.pz ?? 0));
      o.rotation.set(rest.r.x + (d.rx ?? 0), rest.r.y + (d.ry ?? 0), rest.r.z + (d.rz ?? 0));
    }
  }

  reset() {
    this.current = null;
    this.loco = 'idle';
    this.paused = false;
    this.apply({});
  }

  dispose() {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.geometry as THREE.BufferGeometry & { _shared?: boolean })._shared) {
        // Geometries are cached/shared between pieces; materials are per piece.
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((x) => x.dispose());
      }
    });
  }
}

// ----------------------------------------------------------------------------- TransformVisual (static meshes)
const TRANSFORM_ACTIONS: Partial<Record<GameAction, { dur: number; f(u: number): PartDelta }>> = {
  ATTACK_READY: { dur: 0.4, f: (u) => ({ rx: 0.12 * smooth(u / 0.5), py: -0.02 * smooth(u / 0.5) }) },
  ATTACK_PRIMARY: { dur: 0.55, f: (u) => ({ rx: keys(u, [[0, 0], [0.4, -0.3], [0.6, 0.35], [1, 0]]), pz: keys(u, [[0, 0], [0.4, -0.05], [0.6, 0.18], [1, 0]]) }) },
  ATTACK_HEAVY: { dur: 0.8, f: (u) => ({ rx: keys(u, [[0, 0], [0.45, -0.4], [0.66, 0.45], [1, 0]]), py: keys(u, [[0, 0], [0.45, 0.12], [0.66, -0.03], [1, 0]]), pz: keys(u, [[0, 0], [0.66, 0.2], [1, 0]]) }) },
  ATTACK_STAB: { dur: 0.45, f: (u) => ({ pz: keys(u, [[0, 0], [0.3, -0.05], [0.5, 0.25], [1, 0]]), rx: keys(u, [[0, 0], [0.5, 0.2], [1, 0]]) }) },
  ATTACK_RANGED: { dur: 0.6, f: (u) => ({ rx: u > 0.45 && u < 0.6 ? -Math.sin(((u - 0.45) / 0.15) * Math.PI) * 0.2 : 0, pz: u > 0.45 && u < 0.6 ? -0.05 : 0 }) },
  HIT_LIGHT: { dur: 0.35, f: (u) => { const k = keys(u, [[0, 0], [0.2, 1], [1, 0]]); return { rx: -0.25 * k, rz: Math.sin(u * 40) * 0.05 * k }; } },
  HIT_HEAVY: { dur: 0.55, f: (u) => { const k = keys(u, [[0, 0], [0.15, 1], [1, 0]]); return { rx: -0.45 * k, pz: -0.08 * k, rz: Math.sin(u * 50) * 0.08 * k }; } },
  JUMP: { dur: 0.6, f: (u) => ({ py: Math.sin(Math.PI * clamp01(u)) * 0.15 }) },
  TAUNT: { dur: 0.9, f: (u) => ({ ry: Math.sin(u * Math.PI * 4) * 0.25 * (1 - u) }) },
  VICTORY: { dur: 1.0, f: (u) => ({ py: Math.abs(Math.sin(u * Math.PI * 3)) * 0.1 * (1 - u) }) },
};

export class TransformVisual implements PieceVisual {
  readonly body: THREE.Object3D;
  readonly breakables: THREE.Mesh[] = [];
  readonly emissive: THREE.MeshStandardMaterial[] = [];
  private loco: Locomotion = 'idle';
  private time = Math.random() * 10;
  private current: { def: { dur: number; f(u: number): PartDelta }; t: number; speed: number; loop: boolean } | null = null;
  private paused = false;
  private rest: { p: THREE.Vector3; r: THREE.Euler };

  constructor(readonly object: THREE.Object3D, body: THREE.Object3D, readonly base: THREE.Object3D | null, readonly height: number, readonly mechanical = false) {
    this.body = body;
    this.rest = { p: body.position.clone(), r: body.rotation.clone() };
    body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        this.breakables.push(m);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (sm.emissive && sm.emissiveIntensity > 0 && sm.emissive.getHex() !== 0) { sm.userData.baseEmissive = sm.emissiveIntensity; this.emissive.push(sm); }
        }
      }
    });
  }
  setLocomotion(s: Locomotion) { this.loco = s; }
  durationOf(a: GameAction) { return TRANSFORM_ACTIONS[a]?.dur ?? 0.4; }
  play(action: GameAction, opts: { speed?: number; loop?: boolean } = {}) {
    if (action === 'IDLE') { this.current = null; this.loco = 'idle'; return 0; }
    if (action === 'MOVE' || action === 'RUN') { this.current = null; this.loco = action === 'RUN' ? 'run' : 'move'; return 0.5; }
    let def = TRANSFORM_ACTIONS[action];
    if (!def) for (const f of ACTION_FALLBACKS[action] ?? []) if (TRANSFORM_ACTIONS[f]) { def = TRANSFORM_ACTIONS[f]; break; }
    if (!def) return 0;
    this.current = { def, t: 0, speed: opts.speed ?? 1, loop: !!opts.loop };
    return def.dur / (opts.speed ?? 1);
  }
  setPaused(p: boolean) { this.paused = p; }
  update(dt: number) {
    if (this.paused) return;
    this.time += dt;
    let d: PartDelta = {};
    if (this.loco !== 'idle') {
      const ph = this.time * (this.loco === 'run' ? 12 : 8);
      d = { py: Math.abs(Math.sin(ph)) * 0.04, rz: Math.sin(ph) * 0.06 };
    } else d = { py: Math.sin(this.time * 2) * 0.004 };
    if (this.current) {
      const c = this.current;
      c.t += dt * c.speed;
      const u = c.t / c.def.dur;
      if (u >= 1) { if (c.loop) c.t = 0; else this.current = null; }
      if (this.current) { const a = c.def.f(Math.min(1, u)); for (const k of Object.keys(a) as (keyof PartDelta)[]) d[k] = (d[k] ?? 0) + a[k]!; }
    }
    this.body.position.set(this.rest.p.x + (d.px ?? 0), this.rest.p.y + (d.py ?? 0), this.rest.p.z + (d.pz ?? 0));
    this.body.rotation.set(this.rest.r.x + (d.rx ?? 0), this.rest.r.y + (d.ry ?? 0), this.rest.r.z + (d.rz ?? 0));
  }
  reset() { this.current = null; this.loco = 'idle'; this.paused = false; this.body.position.copy(this.rest.p); this.body.rotation.copy(this.rest.r); }
  dispose() { /* shared GLB resources are owned by the AssetManager */ }
}

export { outBack, smooth, keys };
