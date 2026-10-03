// DeathAnimationManager — one pipeline for every death. Skinned models with a
// mapped death clip play it; everything else runs the procedural recipe of
// its DeathTypeDef (fall direction, kneel, knockback pop, slide, twitch,
// sparks/smoke, power-down, disassembly). Then the corpse lingers and fades.

import * as THREE from 'three';
import { DEATH_TYPES, type DeathTypeId } from '@ashen/shared';
import type { AudioPlayer } from './audioBridge';
import type { FxSystem } from './FxSystem';
import type { PieceActor } from './PieceActor';

interface Shard { mesh: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3 }

interface DeathRun {
  actor: PieceActor;
  def: (typeof DEATH_TYPES)[DeathTypeId];
  t: number;
  dir: THREE.Vector3;
  pivot: THREE.Group | null;
  axis: THREE.Vector3;
  start: THREE.Vector3;
  popV: number;
  popY: number;
  shards: Shard[];
  fading: boolean;
  fadeT: number;
  materials: THREE.Material[];
  usedClip: boolean;
  nextFx: number;
  resolve: () => void;
  seed: number;
}

export class DeathAnimationManager {
  private runs: DeathRun[] = [];
  constructor(private fx: FxSystem, private audio: AudioPlayer) {}

  /**
   * Kill an actor. `fromDir` points from the attacker to the defender.
   * Resolves when the body has fully faded (the actor can then be disposed).
   */
  kill(actor: PieceActor, deathType: DeathTypeId, fromDir: THREE.Vector3, seed = 1): Promise<void> {
    const def = DEATH_TYPES[deathType] ?? DEATH_TYPES.light_death;
    actor.busy = true;
    actor.alive = false;
    actor.visual.setLocomotion('idle');
    return new Promise((resolve) => {
      const dir = fromDir.clone().setY(0).normalize();
      if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
      // Convert world fall direction into the actor's local frame.
      const local = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -actor.root.rotation.y);
      let fallLocal = local.clone();
      let skinned = false;
      actor.visual.body.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
      // Skinned meshes cannot be split into flying parts: disassembly becomes a collapse + debris burst.
      const p = skinned && def.procedural.breakApart ? { ...def.procedural, breakApart: false, fall: 'side' as const, twitch: 0.3 } : def.procedural;
      if (skinned && def.procedural.breakApart) this.fx.emit('debris', actor.chest(), { dir, scale: 1.1, seed });
      if (p.fall === 'forward') fallLocal.negate();
      else if (p.fall === 'side') fallLocal = new THREE.Vector3(local.z, 0, -local.x).multiplyScalar(seed % 2 ? 1 : -1);
      const usedClip = actor.visual.play(def.action) > 0 && (actor.visual as { lastPlayWasClip?: boolean }).lastPlayWasClip === true;

      let pivot: THREE.Group | null = null;
      const body = actor.visual.body;
      if (!usedClip && p.fall !== 'none' && !p.breakApart) {
        // Re-parent the body under a pivot at the ground edge so it topples over its feet.
        pivot = new THREE.Group();
        const edge = fallLocal.clone().multiplyScalar(p.fall === 'down' ? 0.02 : 0.16);
        pivot.position.set(edge.x, 0.05, edge.z);
        body.parent!.add(pivot);
        pivot.attach(body);
      }
      const axis = new THREE.Vector3(fallLocal.z, 0, -fallLocal.x).normalize();
      const run: DeathRun = {
        actor, def: { ...def, procedural: p }, t: 0, dir, pivot, axis, start: actor.root.position.clone(), popV: p.pop ? 2.6 * p.pop : 0, popY: 0, shards: [],
        fading: false, fadeT: 0, materials: [], usedClip, nextFx: 0, resolve, seed,
      };
      if (p.breakApart) this.breakApart(run);
      if (p.sparks) this.fx.emit('spark', actor.chest(), { dir, scale: 0.8, seed });
      this.audio.play(def.sound, actor.root.position);
      this.runs.push(run);
    });
  }

  private breakApart(run: DeathRun) {
    const body = run.actor.visual.body;
    const center = new THREE.Vector3();
    body.getWorldPosition(center);
    const scene = run.actor.root.parent;
    if (!scene) return; // actor already removed from the board (e.g. preview reset) — nothing to scatter
    const rnd = mulberry(run.seed);
    const meshes: THREE.Mesh[] = [];
    body.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      scene.attach(m);
      const out = m.getWorldPosition(new THREE.Vector3()).sub(center).setY(0).normalize();
      run.shards.push({
        mesh: m,
        v: new THREE.Vector3(out.x * (0.6 + rnd()) + run.dir.x * 1.2, 1.2 + rnd() * 2.2, out.z * (0.6 + rnd()) + run.dir.z * 1.2),
        w: new THREE.Vector3((rnd() - 0.5) * 12, (rnd() - 0.5) * 12, (rnd() - 0.5) * 12),
      });
    }
  }

  update(dt: number) {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i];
      r.t += dt;
      const p = r.def.procedural;
      const D = r.def.duration;
      const u = Math.min(1, r.t / D);
      const body = r.actor.visual.body;

      if (!r.usedClip && r.pivot) {
        // Kneel phase, then a gravity-like topple with a small settle bounce.
        const kneelEnd = p.kneel ?? 0;
        let ang = 0;
        if (u < kneelEnd) {
          const k = u / kneelEnd;
          body.position.y = -0.08 * easeOut(k);
          ang = 0.25 * easeOut(k);
        } else {
          const k = (u - kneelEnd) / (1 - kneelEnd);
          const fall = Math.min(1, k * k * 1.35);
          const settle = k > 0.74 ? Math.sin((k - 0.74) / 0.26 * Math.PI) * 0.06 : 0;
          ang = (p.kneel ? 0.25 : 0) + (p.fall === 'down' ? 0.5 : 1.42 - (p.kneel ? 0.25 : 0)) * fall - settle;
          if (p.fall === 'down') body.scale.y = Math.max(0.35, 1 - 0.55 * fall) * (body.userData.sy ??= body.scale.y);
        }
        if (p.twitch && u < p.twitch) {
          r.pivot.rotation.z = (Math.random() - 0.5) * 0.12;
          r.pivot.rotation.x = (Math.random() - 0.5) * 0.12;
        } else r.pivot.quaternion.setFromAxisAngle(r.axis, ang);
      }
      // Knockback pop and slide along the hit direction.
      if (p.pop && r.t < D) {
        r.popV -= 9.8 * dt;
        r.popY = Math.max(0, r.popY + r.popV * dt);
        r.actor.root.position.y = r.start.y + r.popY;
      }
      if (p.slide) {
        const s = easeOut(u) * p.slide;
        r.actor.root.position.x = r.start.x + r.dir.x * s;
        r.actor.root.position.z = r.start.z + r.dir.z * s;
      }
      for (const sh of r.shards) {
        sh.v.y -= 9.8 * dt;
        sh.mesh.position.addScaledVector(sh.v, dt);
        if (sh.mesh.position.y < 0.03) { sh.mesh.position.y = 0.03; sh.v.y *= -0.3; sh.v.x *= 0.55; sh.v.z *= 0.55; sh.w.multiplyScalar(0.6); }
        sh.mesh.rotation.x += sh.w.x * dt; sh.mesh.rotation.y += sh.w.y * dt; sh.mesh.rotation.z += sh.w.z * dt;
      }
      if (p.powerDown) {
        const flicker = u < 0.6 ? (Math.random() < 0.3 ? 0.2 : 1) : 1;
        for (const m of r.actor.visual.emissive) m.emissiveIntensity = (m.userData.baseEmissive ?? 1) * Math.max(0, 1 - u * 1.4) * flicker;
      }
      if ((p.sparks || p.smoke) && r.t >= r.nextFx && r.t < D + r.def.linger * 0.6) {
        r.nextFx = r.t + 0.35;
        const at = r.actor.chest().setY(0.25);
        if (p.sparks && Math.random() < 0.7) this.fx.emit('spark', at, { scale: 0.35 });
        if (p.smoke) this.fx.emit('smoke_puff', at, { scale: 0.5 });
      }

      // Linger, then fade out (materials are cloned so shared GLB materials are untouched).
      if (!r.fading && r.t >= D + r.def.linger) {
        r.fading = true;
        const targets: THREE.Object3D[] = [r.actor.root, ...r.shards.map((s) => s.mesh)];
        for (const t of targets) t.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.material || m === r.actor.hitbox) return;
          const cloned = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => { const c = x.clone(); c.transparent = true; return c; });
          m.material = Array.isArray(m.material) ? cloned : cloned[0];
          r.materials.push(...cloned);
        });
      }
      if (r.fading) {
        r.fadeT += dt;
        const a = Math.max(0, 1 - r.fadeT / 0.6);
        for (const m of r.materials) (m as THREE.MeshStandardMaterial).opacity = a;
        r.actor.root.position.y = r.start.y - (1 - a) * 0.15;
        if (a <= 0) {
          for (const s of r.shards) s.mesh.removeFromParent();
          for (const m of r.materials) m.dispose();
          r.actor.root.visible = false;
          this.runs.splice(i, 1);
          r.resolve();
        }
      }
    }
  }

  /** Instantly complete all running deaths (skip, scrub reset). */
  finishAll() {
    for (const r of this.runs) {
      for (const s of r.shards) s.mesh.removeFromParent();
      for (const m of r.materials) m.dispose();
      r.actor.root.visible = false;
      r.resolve();
    }
    this.runs.length = 0;
  }

  get active() { return this.runs.length; }
}

function easeOut(t: number) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3); }
function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
