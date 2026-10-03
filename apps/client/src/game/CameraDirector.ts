// CameraDirector — the tactical three-quarter view from the player's side of
// the board, with limited orbit/zoom/rotation, board flip, spectator free
// camera, and combat framing that pushes toward a fight while keeping the
// surrounding squares in view (never a hard cut away from the board).

import * as THREE from 'three';
import type { Color } from '@ashen/shared';

export type CameraMode = 'tactical' | 'free' | 'showcase' | 'lab';
type ShotKind = 'push' | 'low' | 'orbit' | 'side' | 'return' | 'focus';

interface Spherical { radius: number; elevation: number; azimuth: number; target: THREE.Vector3 }

const DEG = Math.PI / 180;

export class CameraDirector {
  mode: CameraMode = 'showcase';
  side: Color = 'w';
  /** Player-controlled tactical pose. */
  private user: Spherical = { radius: 11.2, elevation: 44 * DEG, azimuth: 0, target: new THREE.Vector3(0, 0, 0.35) };
  /** Pose actually rendered (smoothly follows user or a combat shot). */
  private cur: Spherical = { radius: 26, elevation: 30 * DEG, azimuth: 0.6, target: new THREE.Vector3() };
  private shot: { pose: Spherical; until: number; t: number; orbitSpeed: number } | null = null;
  private shake = { t: 0, dur: 0, strength: 0 };
  private dragging: 'orbit' | 'pan' | null = null;
  private last = { x: 0, y: 0 };
  sensitivity = 1;
  locked = false;
  private keys = new Set<string>();
  private time = 0;

  limits = { minRadius: 7, maxRadius: 17, minElev: 24 * DEG, maxElev: 78 * DEG, maxAzimuth: 40 * DEG };

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  private baseAzimuth() { return this.side === 'w' ? 0 : Math.PI; }

  setSide(c: Color, snap = false) {
    this.side = c;
    this.user.azimuth = 0;
    if (snap) this.snap();
  }

  flip() { this.setSide(this.side === 'w' ? 'b' : 'w'); }

  setMode(m: CameraMode) {
    this.mode = m;
    if (m === 'tactical') { this.user.radius = 11.2; this.user.elevation = 44 * DEG; this.user.azimuth = 0; this.user.target.set(0, 0, 0); }
    if (m === 'lab') { this.user.radius = 3.6; this.user.elevation = 24 * DEG; this.user.azimuth = 0.55; this.user.target.set(0, 0.3, 0); }
  }

  /** Point the orbit at a world position (lab/preview views). */
  setTarget(v: THREE.Vector3) { this.user.target.copy(v); this.cur.target.copy(v); }

  /** Default tactical pose: elevated ~44°, player's army closest to the camera. */
  resetView() { this.user.radius = 11.2; this.user.elevation = 44 * DEG; this.user.azimuth = 0; this.user.target.set(0, 0, 0); }

  snap() { this.cur = clone(this.user); this.cur.azimuth += this.baseAzimuth(); }

  // ------------------------------------------------------------------ input
  attach(el: HTMLElement) {
    const onDown = (e: PointerEvent) => {
      if (e.button === 2 || (e.button === 0 && e.altKey)) this.dragging = 'orbit';
      else if (e.button === 1 || (e.button === 0 && e.shiftKey)) this.dragging = 'pan';
      else return;
      this.last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!this.dragging || this.locked) return;
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      if (this.dragging === 'orbit') {
        this.user.azimuth -= dx * 0.005 * this.sensitivity;
        this.user.elevation += dy * 0.004 * this.sensitivity;
      } else {
        const right = new THREE.Vector3(Math.cos(this.cur.azimuth), 0, -Math.sin(this.cur.azimuth));
        const fwd = new THREE.Vector3(Math.sin(this.cur.azimuth), 0, Math.cos(this.cur.azimuth));
        this.user.target.addScaledVector(right, -dx * 0.012).addScaledVector(fwd, -dy * 0.012);
      }
      this.clampUser();
    };
    const onUp = (e: PointerEvent) => { this.dragging = null; if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); };
    const onWheel = (e: WheelEvent) => { if (this.locked) return; e.preventDefault(); this.user.radius *= 1 + Math.sign(e.deltaY) * 0.08; this.clampUser(); };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; if (e.type === 'keydown') this.keys.add(e.key.toLowerCase()); else this.keys.delete(e.key.toLowerCase()); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel); el.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
    };
  }

  private clampUser() {
    const l = this.limits;
    this.user.radius = THREE.MathUtils.clamp(this.user.radius, this.mode === 'lab' ? 1.6 : l.minRadius, this.mode === 'free' ? 40 : l.maxRadius);
    this.user.elevation = THREE.MathUtils.clamp(this.user.elevation, this.mode === 'free' ? 8 * DEG : l.minElev, l.maxElev);
    if (this.mode === 'tactical') this.user.azimuth = THREE.MathUtils.clamp(this.user.azimuth, -l.maxAzimuth, l.maxAzimuth);
    const lim = this.mode === 'free' ? 12 : 2.5;
    this.user.target.x = THREE.MathUtils.clamp(this.user.target.x, -lim, lim);
    this.user.target.z = THREE.MathUtils.clamp(this.user.target.z, -lim, lim);
    if (this.mode !== 'lab') this.user.target.y = 0;
  }

  // ------------------------------------------------------------------ combat framing
  /**
   * Frame a fight between two board points. Pushes in and drifts the angle,
   * but keeps radius large enough that neighbouring squares stay visible.
   */
  combatShot(kind: ShotKind, a: THREE.Vector3, b: THREE.Vector3, strength = 0.6, duration = 1.5) {
    if (kind === 'return') { this.shot = null; return; }
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const base = clone(this.user);
    base.azimuth += this.baseAzimuth();
    const pose: Spherical = { ...base, target: mid.clone().setY(0.35) };
    const k = THREE.MathUtils.clamp(strength, 0, 1.5);
    pose.radius = THREE.MathUtils.lerp(base.radius, 5.2, 0.55 * k);
    let orbitSpeed = 0;
    switch (kind) {
      case 'push': pose.elevation = THREE.MathUtils.lerp(base.elevation, 34 * DEG, 0.5 * k); break;
      case 'low': pose.elevation = THREE.MathUtils.lerp(base.elevation, 22 * DEG, 0.7 * k); pose.radius *= 0.92; break;
      case 'side': {
        const along = Math.atan2(b.x - a.x, b.z - a.z);
        pose.azimuth = nearestAngle(base.azimuth, along + Math.PI / 2, base.azimuth);
        pose.azimuth = THREE.MathUtils.lerp(base.azimuth, pose.azimuth, 0.45 * k);
        pose.elevation = 32 * DEG;
        break;
      }
      case 'orbit': pose.elevation = 30 * DEG; orbitSpeed = 0.35 * k; break;
      case 'focus': pose.radius = THREE.MathUtils.lerp(base.radius, 6.5, 0.4 * k); break;
    }
    this.shot = { pose, until: duration, t: 0, orbitSpeed };
  }

  /** Light auto-framing for every capture, even if the timeline has no camera events. */
  autoFrame(a: THREE.Vector3, b: THREE.Vector3, duration: number) {
    if (this.shot) return;
    this.combatShot('focus', a, b, 0.45, duration);
  }

  releaseShot() { this.shot = null; }

  addShake(strength: number, duration: number) {
    if (strength > this.shake.strength * (1 - this.shake.t / Math.max(0.01, this.shake.dur))) this.shake = { t: 0, dur: duration, strength };
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number, realDt: number) {
    this.time += realDt;
    if (this.mode === 'showcase') {
      // Lobby: slow cinematic drift around the arena.
      const az = this.time * 0.05;
      const target: Spherical = { radius: 15 + Math.sin(this.time * 0.07) * 2, elevation: (26 + Math.sin(this.time * 0.11) * 6) * DEG, azimuth: az, target: new THREE.Vector3(0, 0.5, 0) };
      this.blend(target, realDt, 1.2);
    } else {
      if (!this.locked) {
        const k = realDt * 1.6 * this.sensitivity;
        if (this.keys.has('q')) this.user.azimuth += k;
        if (this.keys.has('e')) this.user.azimuth -= k;
        if (this.keys.has('r')) this.user.elevation += k * 0.6;
        if (this.keys.has('f')) this.user.elevation -= k * 0.6;
        if (this.keys.has('=') || this.keys.has('+')) this.user.radius -= k * 4;
        if (this.keys.has('-')) this.user.radius += k * 4;
        this.clampUser();
      }
      let target: Spherical;
      if (this.shot) {
        this.shot.t += dt;
        this.shot.pose.azimuth += this.shot.orbitSpeed * dt;
        target = this.shot.pose;
        if (this.shot.t > this.shot.until) this.shot = null;
      } else {
        target = clone(this.user);
        target.azimuth += this.baseAzimuth();
      }
      this.blend(target, realDt, this.shot ? 2.4 : 3.2);
    }
    this.apply();
  }

  private blend(target: Spherical, dt: number, speed: number) {
    const k = 1 - Math.exp(-dt * speed);
    this.cur.radius += (target.radius - this.cur.radius) * k;
    this.cur.elevation += (target.elevation - this.cur.elevation) * k;
    const az = nearestAngle(this.cur.azimuth, target.azimuth, this.cur.azimuth);
    this.cur.azimuth += (az - this.cur.azimuth) * k;
    this.cur.target.lerp(target.target, k);
  }

  private apply() {
    const c = this.cur;
    const pos = new THREE.Vector3(
      c.target.x + c.radius * Math.cos(c.elevation) * Math.sin(c.azimuth),
      c.target.y + c.radius * Math.sin(c.elevation),
      c.target.z + c.radius * Math.cos(c.elevation) * Math.cos(c.azimuth),
    );
    if (this.shake.t < this.shake.dur) {
      this.shake.t += 1 / 60;
      const s = this.shake.strength * 0.08 * (1 - this.shake.t / this.shake.dur);
      pos.x += (Math.random() - 0.5) * s; pos.y += (Math.random() - 0.5) * s; pos.z += (Math.random() - 0.5) * s;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(c.target);
  }
}

function clone(s: Spherical): Spherical { return { radius: s.radius, elevation: s.elevation, azimuth: s.azimuth, target: s.target.clone() }; }
function nearestAngle(_from: number, to: number, ref: number) {
  let d = (to - ref) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return ref + d;
}
