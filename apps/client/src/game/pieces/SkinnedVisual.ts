// SkinnedVisual — GLB/GLTF models (built-in Blender exports or user uploads)
// driven by an AnimationMixer. Canonical actions map to clip names through a
// clip map; anything unmapped falls back to whole-object procedural motion.

import * as THREE from 'three';
import { ACTION_FALLBACKS, type GameAction } from '@ashen/shared';
import type { Locomotion, PieceVisual } from './PieceVisual';
import { TransformVisual } from './PieceVisual';

const LOOPING: GameAction[] = ['IDLE', 'MOVE', 'RUN', 'DEFEATED_IDLE'];
const ONCE_HOLD: GameAction[] = ['DEATH_LIGHT', 'DEATH_HEAVY', 'DEATH_KNOCKBACK', 'DEATH_MECHANICAL'];

export interface SkinnedVisualOptions {
  model: THREE.Object3D;
  clips: THREE.AnimationClip[];
  clipMap: Partial<Record<GameAction, string>>;
  base: THREE.Object3D | null;
  baseEmissive: THREE.MeshStandardMaterial[];
  mechanical?: boolean;
}

export class SkinnedVisual implements PieceVisual {
  readonly object = new THREE.Group();
  readonly body = new THREE.Group();
  readonly base: THREE.Object3D | null;
  readonly height: number;
  readonly mechanical: boolean;
  readonly breakables: THREE.Mesh[] = [];
  readonly emissive: THREE.MeshStandardMaterial[] = [];
  readonly skinned = true;
  lastPlayWasClip = false;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private loco: Locomotion = 'idle';
  private fallback: TransformVisual;
  private paused = false;
  private clipMap: Partial<Record<GameAction, string>>;
  private pendingReturn: number | null = null;

  constructor(opts: SkinnedVisualOptions) {
    this.base = opts.base;
    this.mechanical = !!opts.mechanical;
    this.clipMap = opts.clipMap;
    if (opts.base) this.object.add(opts.base);
    this.body.position.y = opts.base ? 0.05 : 0;
    this.object.add(this.body);
    this.body.add(opts.model);
    this.emissive.push(...opts.baseEmissive);
    opts.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds are unreliable while animating
      this.breakables.push(m);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (sm.emissive && sm.emissive.getHex() !== 0) { sm.userData.baseEmissive = sm.emissiveIntensity; this.emissive.push(sm); }
      }
    });
    this.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(opts.model);
    this.height = box.max.y;
    this.mixer = new THREE.AnimationMixer(opts.model);
    for (const c of opts.clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.fallback = new TransformVisual(this.object, this.body, null, this.height, this.mechanical);
    this.play('IDLE');
  }

  private clipFor(action: GameAction): THREE.AnimationAction | null {
    const tried = new Set<GameAction>();
    let queue: GameAction[] = [action];
    while (queue.length) {
      const a = queue.shift()!;
      if (tried.has(a)) continue;
      tried.add(a);
      const name = this.clipMap[a];
      if (name && this.actions.has(name)) return this.actions.get(name)!;
      queue = [...queue, ...(ACTION_FALLBACKS[a] ?? [])];
    }
    return null;
  }

  hasClip(action: GameAction) { return !!this.clipFor(action); }

  durationOf(action: GameAction) {
    const a = this.clipFor(action);
    return a ? a.getClip().duration : this.fallback.durationOf(action);
  }

  setLocomotion(state: Locomotion) {
    if (state === this.loco) return;
    this.loco = state;
    if (!this.current || LOOPING.includes(this.currentAction ?? 'IDLE')) this.play(state === 'idle' ? 'IDLE' : state === 'run' ? 'RUN' : 'MOVE');
  }

  private currentAction: GameAction | null = null;

  play(action: GameAction, opts: { speed?: number; loop?: boolean } = {}) {
    const next = this.clipFor(action);
    this.lastPlayWasClip = !!next;
    if (!next) {
      if (action === 'MOVE' || action === 'RUN') this.loco = action === 'RUN' ? 'run' : 'move';
      if (action === 'IDLE') this.loco = 'idle';
      return this.fallback.play(action, opts);
    }
    if (action === 'MOVE' || action === 'RUN') this.loco = action === 'RUN' ? 'run' : 'move';
    if (action === 'IDLE') this.loco = 'idle';
    const loop = opts.loop || LOOPING.includes(action);
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = true;
    next.timeScale = opts.speed ?? 1;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, 0.15, false);
    next.play();
    this.current = next;
    this.currentAction = action;
    const dur = next.getClip().duration / (opts.speed ?? 1);
    if (this.pendingReturn !== null) { clearTimeout(this.pendingReturn); this.pendingReturn = null; }
    if (!loop && !ONCE_HOLD.includes(action)) this.returnAfter = dur - 0.15;
    else this.returnAfter = -1;
    return dur;
  }

  private returnAfter = -1;

  /** Play a clip by file name (bypasses the action map; used by the taunt cam). False if missing. */
  playClip(name: string, loop = false): boolean {
    const a = this.actions.get(name);
    if (!a) return false;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = true;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, 0.2, false);
    a.play();
    this.current = a;
    this.currentAction = null;
    this.returnAfter = loop ? -1 : a.getClip().duration - 0.2;
    return true;
  }

  /** Playback rate of the current looping clip (e.g. gallop cadence following speed). */
  setRate(rate: number) { if (this.current && this.returnAfter < 0) this.current.timeScale = rate; }

  setPaused(p: boolean) { this.paused = p; this.fallback.setPaused(p); }

  update(dt: number) {
    if (this.paused) return;
    this.mixer.update(dt);
    this.fallback.update(dt);
    if (this.returnAfter > 0) {
      this.returnAfter -= dt;
      if (this.returnAfter <= 0) { this.returnAfter = -1; this.play(this.loco === 'idle' ? 'IDLE' : this.loco === 'run' ? 'RUN' : 'MOVE'); }
    }
  }

  reset() {
    this.mixer.stopAllAction();
    this.current = null;
    this.fallback.reset();
    this.paused = false;
    this.play('IDLE');
    this.mixer.update(0); // apply the idle pose now, even if the visual gets frozen before the next frame
  }

  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
}
