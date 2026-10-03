// FxSystem — pooled, GPU-cheap particle effects for combat and the arena.
// Uses a seeded RNG per emission so the Combat Laboratory can scrub a fight
// frame-by-frame and see identical effects every time.

import * as THREE from 'three';
import type { FxId } from '@ashen/shared';
import { smokeTexture, softDotTexture } from './textures';

export type FxKind = FxId | 'mine_blast' | 'promotion' | 'ability_pulse' | 'step_dust' | 'ember' | 'flame' | 'smoke_column' | 'dust_drift' | 'power_down';

interface Particle {
  alive: boolean;
  additive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  r0: number; g0: number; b0: number;
  r1: number; g1: number; b1: number;
  a0: number; a1: number;
  gravity: number; drag: number;
}

const MAX = 2400;

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const vert = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.003) discard;
  }`;

class PointPool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  readonly items: Particle[] = [];
  constructor(additive: boolean, map: THREE.Texture) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 300 } }, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }
  setScale(px: number) { (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px; }
  spawn(p: Particle) {
    if (this.items.length < MAX) { this.items.push(p); return; }
    const i = this.items.findIndex((x) => !x.alive);
    if (i >= 0) this.items[i] = p;
  }
  update(dt: number) {
    let n = 0;
    for (const p of this.items) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) { p.alive = false; continue; }
      const k = Math.pow(1 - p.drag, dt * 60);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.01 && p.gravity > 0) { p.y = 0.01; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const u = p.life / p.max;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r0 + (p.r1 - p.r0) * u; this.col[n * 4 + 1] = p.g0 + (p.g1 - p.g0) * u; this.col[n * 4 + 2] = p.b0 + (p.b1 - p.b0) * u;
      this.col[n * 4 + 3] = (p.a0 + (p.a1 - p.a0) * u) * Math.min(1, (1 - u) * 4);
      this.size[n] = p.s0 + (p.s1 - p.s0) * u;
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    if (this.items.length > 512 && n < this.items.length / 4) this.items.splice(0, this.items.length, ...this.items.filter((x) => x.alive));
  }
  clear() { this.items.length = 0; this.points.geometry.setDrawRange(0, 0); }
}

interface Debris { mesh: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; life: number; max: number }
interface Ring { mesh: THREE.Mesh; life: number; max: number; scale: number }
interface Flash { light: THREE.PointLight; life: number; max: number; intensity: number }
interface Emitter { kind: FxKind; pos: THREE.Vector3; rate: number; acc: number; scale: number }

export class FxSystem {
  readonly group = new THREE.Group();
  private add = new PointPool(true, softDotTexture());
  private alpha = new PointPool(false, smokeTexture());
  private debris: Debris[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private emitters: Emitter[] = [];
  private debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  private debrisMat = new THREE.MeshStandardMaterial({ color: '#5a524a', roughness: 0.9 });
  private ringGeo = new THREE.RingGeometry(0.8, 1, 48);
  private seq = 1;
  /** Global particle multiplier from graphics settings. */
  density = 1;

  constructor() {
    this.group.name = 'fx';
    this.group.add(this.add.points, this.alpha.points);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffaa55', 0, 4, 2);
      this.group.add(l);
      this.flashes.push({ light: l, life: 1, max: 1, intensity: 0 });
    }
  }

  setViewportHeight(h: number) { const px = h * 0.9; this.add.setScale(px); this.alpha.setScale(px); }

  private particle(r: () => number, o: Partial<Particle> & { x: number; y: number; z: number }, additive: boolean) {
    const p: Particle = {
      alive: true, additive, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 0.1, s1: 0.05, r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1, a0: 1, a1: 0, gravity: 0, drag: 0.02, ...o,
    };
    (additive ? this.add : this.alpha).spawn(p);
    void r;
  }

  private burst(r: () => number, at: THREE.Vector3, count: number, f: (i: number) => Partial<Particle>, additive: boolean) {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) this.particle(r, { x: at.x, y: at.y, z: at.z, ...f(i) }, additive);
  }

  /** Spawn a one-shot effect. `dir` is the attack direction (for sprays). */
  emit(kind: FxKind, at: THREE.Vector3, opts: { dir?: THREE.Vector3; scale?: number; color?: THREE.ColorRepresentation; seed?: number } = {}) {
    const r = rng(opts.seed ?? this.seq++);
    const s = opts.scale ?? 1;
    const dir = opts.dir ?? new THREE.Vector3(0, 0, 1);
    const tint = new THREE.Color(opts.color ?? '#ffb060');
    const sph = (sp: number, up = 0.5) => {
      const a = r() * Math.PI * 2, e = (r() - 0.2) * Math.PI * up;
      return { vx: Math.cos(a) * Math.cos(e) * sp + dir.x * sp * 0.6, vy: Math.sin(e) * sp + sp * 0.3, vz: Math.sin(a) * Math.cos(e) * sp + dir.z * sp * 0.6 };
    };
    switch (kind) {
      case 'spark':
      case 'metal_hit':
        this.burst(r, at, 26 * s, () => ({ ...sph(2.5 + r() * 3), max: 0.25 + r() * 0.35, s0: 0.05 * s, s1: 0.01, r0: 1, g0: 0.85, b0: 0.5, r1: 1, g1: 0.35, b1: 0.05, gravity: 7, drag: 0.03 }), true);
        this.flash(at, '#ffbb66', 3 * s, 0.12);
        if (kind === 'metal_hit') this.burst(r, at, 8 * s, () => ({ ...sph(0.6), max: 0.6, s0: 0.15 * s, s1: 0.35 * s, r0: 0.5, g0: 0.48, b0: 0.45, r1: 0.3, g1: 0.3, b1: 0.3, a0: 0.5, gravity: -0.3 }), false);
        break;
      case 'blood_dust':
        // Deliberately non-gory: grit, dust and dark fragments.
        this.burst(r, at, 22 * s, () => ({ ...sph(1.6 + r() * 2), max: 0.5 + r() * 0.4, s0: 0.12 * s, s1: 0.3 * s, r0: 0.45, g0: 0.36, b0: 0.28, r1: 0.3, g1: 0.26, b1: 0.22, a0: 0.75, gravity: 2.5, drag: 0.06 }), false);
        this.burst(r, at, 10 * s, () => ({ ...sph(2.5), max: 0.25, s0: 0.04, s1: 0.02, r0: 1, g0: 0.6, b0: 0.3, r1: 0.8, g1: 0.2, b1: 0.05, gravity: 6 }), true);
        break;
      case 'energy_burst':
        this.burst(r, at, 30 * s, () => ({ ...sph(2 + r() * 2.5), max: 0.35 + r() * 0.3, s0: 0.09 * s, s1: 0.02, r0: 0.6, g0: 0.95, b0: 1, r1: 0.1, g1: 0.5, b1: 1, drag: 0.08 }), true);
        this.ring(at, '#6fe0ff', 0.9 * s, 0.35);
        this.flash(at, '#66ddff', 5 * s, 0.18);
        break;
      case 'electric_arc':
        for (let i = 0; i < Math.round(14 * this.density); i++) {
          const a = r() * Math.PI * 2, rr = 0.15 + r() * 0.25;
          this.particle(r, { x: at.x + Math.cos(a) * rr, y: at.y + (r() - 0.3) * 0.4, z: at.z + Math.sin(a) * rr, max: 0.12 + r() * 0.2, s0: 0.12 * s, s1: 0.02, r0: 0.8, g0: 0.9, b0: 1, r1: 0.3, g1: 0.5, b1: 1 }, true);
        }
        this.flash(at, '#88aaff', 2.5 * s, 0.25);
        break;
      case 'muzzle_flash':
        this.burst(r, at, 10 * s, () => ({ vx: dir.x * (3 + r() * 2) + (r() - 0.5), vy: (r() - 0.5) * 0.6, vz: dir.z * (3 + r() * 2) + (r() - 0.5), max: 0.08 + r() * 0.06, s0: 0.25 * s, s1: 0.05, r0: 1, g0: 0.9, b0: 0.55, r1: 1, g1: 0.4, b1: 0.05 }), true);
        this.flash(at, '#ffcc77', 6 * s, 0.07);
        break;
      case 'debris':
        this.spawnDebris(r, at, Math.round(10 * s * this.density), dir, s);
        this.burst(r, at, 14 * s, () => ({ ...sph(1.2), max: 0.9 + r() * 0.6, s0: 0.25 * s, s1: 0.7 * s, r0: 0.42, g0: 0.38, b0: 0.33, r1: 0.3, g1: 0.28, b1: 0.25, a0: 0.55, gravity: -0.2, drag: 0.05 }), false);
        break;
      case 'shockwave':
        this.ring(at.clone().setY(0.04), '#ffd29a', 1.6 * s, 0.45);
        this.burst(r, at.clone().setY(0.05), 28 * s, (i) => { const a = (i / 28) * Math.PI * 2; return { vx: Math.cos(a) * 3.2, vy: 0.2, vz: Math.sin(a) * 3.2, max: 0.6, s0: 0.25 * s, s1: 0.5 * s, r0: 0.5, g0: 0.45, b0: 0.38, r1: 0.35, g1: 0.32, b1: 0.3, a0: 0.5, drag: 0.08 }; }, false);
        break;
      case 'smoke_puff':
        this.burst(r, at, 10 * s, () => ({ ...sph(0.4), max: 1.2 + r(), s0: 0.3 * s, s1: 0.9 * s, r0: 0.25, g0: 0.24, b0: 0.23, r1: 0.18, g1: 0.18, b1: 0.18, a0: 0.5, gravity: -0.5, drag: 0.04 }), false);
        break;
      case 'fire_burst':
        this.burst(r, at, 34 * s, () => ({ ...sph(1.2 + r() * 1.5), max: 0.5 + r() * 0.5, s0: 0.25 * s, s1: 0.05, r0: 1, g0: 0.75, b0: 0.3, r1: 0.8, g1: 0.15, b1: 0.02, gravity: -2.2, drag: 0.05 }), true);
        this.flash(at, '#ff7a2a', 6 * s, 0.4);
        this.emit('smoke_puff', at, { seed: (opts.seed ?? 0) + 1, scale: s });
        break;
      case 'dust_ring':
        this.burst(r, at.clone().setY(0.03), 18 * s, (i) => { const a = (i / 18) * Math.PI * 2; return { vx: Math.cos(a) * 1.4, vy: 0.15, vz: Math.sin(a) * 1.4, max: 0.7, s0: 0.2 * s, s1: 0.45 * s, r0: 0.5, g0: 0.45, b0: 0.38, r1: 0.4, g1: 0.36, b1: 0.32, a0: 0.45, drag: 0.07 }; }, false);
        break;
      case 'slash_trail':
        this.slash(at, dir, s);
        this.emit('spark', at, { dir, scale: 0.5 * s, seed: (opts.seed ?? 0) + 7 });
        break;
      case 'mine_blast':
        this.emit('fire_burst', at, { scale: 1.6, seed: opts.seed });
        this.emit('debris', at, { scale: 1.3, seed: (opts.seed ?? 0) + 3 });
        this.emit('shockwave', at, { scale: 1.2, seed: (opts.seed ?? 0) + 5 });
        break;
      case 'promotion':
        this.burst(r, at, 40 * s, (i) => { const a = (i / 40) * Math.PI * 2; return { x: at.x + Math.cos(a) * 0.35, z: at.z + Math.sin(a) * 0.35, y: 0.05, vy: 1.5 + r(), max: 0.9, s0: 0.08, s1: 0.02, r0: tint.r, g0: tint.g, b0: tint.b, r1: 1, g1: 1, b1: 1 }; }, true);
        this.flash(at.clone().setY(0.5), tint, 5, 0.5);
        break;
      case 'ability_pulse':
        this.ring(at.clone().setY(0.06), tint, 0.7 * s, 0.5);
        this.burst(r, at, 18 * s, () => ({ ...sph(0.8), vy: 1 + r(), max: 0.7, s0: 0.07, s1: 0.01, r0: tint.r, g0: tint.g, b0: tint.b, r1: tint.r, g1: tint.g, b1: tint.b }), true);
        break;
      case 'step_dust':
        this.burst(r, at.clone().setY(0.03), 4 * s, () => ({ ...sph(0.3), vy: 0.1, max: 0.6, s0: 0.12, s1: 0.25, r0: 0.45, g0: 0.41, b0: 0.36, r1: 0.4, g1: 0.37, b1: 0.33, a0: 0.3, drag: 0.08 }), false);
        break;
      case 'power_down':
        this.burst(r, at, 8 * s, () => ({ ...sph(0.5), vy: 0.6, max: 1.4, s0: 0.15, s1: 0.5, r0: 0.2, g0: 0.2, b0: 0.2, r1: 0.12, g1: 0.12, b1: 0.12, a0: 0.45, gravity: -0.4 }), false);
        this.emit('spark', at, { scale: 0.4, seed: (opts.seed ?? 0) + 11 });
        break;
      default:
        break;
    }
  }

  private flash(at: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, dur: number) {
    const f = this.flashes.reduce((a, b) => (a.life / a.max > b.life / b.max ? a : b));
    f.light.position.copy(at);
    f.light.color.set(color);
    f.intensity = intensity * 2;
    f.life = 0; f.max = dur;
  }

  private ring(at: THREE.Vector3, color: THREE.ColorRepresentation, scale: number, dur: number) {
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    this.group.add(mesh);
    this.rings.push({ mesh, life: 0, max: dur, scale });
  }

  private slash(at: THREE.Vector3, dir: THREE.Vector3, s: number) {
    const geo = new THREE.RingGeometry(0.35 * s, 0.42 * s, 24, 1, -0.9, 1.8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#fff1d0', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.copy(at);
    mesh.lookAt(at.clone().add(new THREE.Vector3(-dir.z, 0.4, dir.x)));
    this.group.add(mesh);
    this.rings.push({ mesh, life: 0, max: 0.22, scale: -1 });
  }

  private spawnDebris(r: () => number, at: THREE.Vector3, n: number, dir: THREE.Vector3, s: number) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.debrisGeo, this.debrisMat);
      const k = (0.03 + r() * 0.05) * s;
      mesh.scale.set(k, k * (0.5 + r()), k);
      mesh.position.copy(at);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.debris.push({ mesh, v: new THREE.Vector3((r() - 0.5) * 3 + dir.x * 1.5, 1.5 + r() * 2.5, (r() - 0.5) * 3 + dir.z * 1.5), w: new THREE.Vector3(r() * 10, r() * 10, r() * 10), life: 0, max: 2 + r() });
    }
  }

  /** Continuous emitters for ambient effects (fires, smoke columns, drifting dust). */
  addEmitter(kind: FxKind, pos: THREE.Vector3, rate: number, scale = 1) { const e = { kind, pos: pos.clone(), rate, acc: Math.random(), scale }; this.emitters.push(e); return e; }
  clearEmitters() { this.emitters.length = 0; }

  private emitAmbient(e: Emitter) {
    const r = rng(this.seq++);
    const s = e.scale;
    const p = e.pos;
    if (e.kind === 'flame') {
      this.particle(r, { x: p.x + (r() - 0.5) * 0.5 * s, y: p.y, z: p.z + (r() - 0.5) * 0.5 * s, vx: (r() - 0.5) * 0.3, vy: 1 + r() * 1.2, vz: (r() - 0.5) * 0.3, max: 0.6 + r() * 0.5, s0: 0.5 * s, s1: 0.1 * s, r0: 1, g0: 0.6, b0: 0.2, r1: 0.7, g1: 0.12, b1: 0.02, drag: 0.02 }, true);
    } else if (e.kind === 'smoke_column') {
      this.particle(r, { x: p.x + (r() - 0.5) * s, y: p.y, z: p.z + (r() - 0.5) * s, vx: 0.4 + r() * 0.3, vy: 1.6 + r(), vz: (r() - 0.5) * 0.3, max: 9 + r() * 5, s0: 2 * s, s1: 9 * s, r0: 0.16, g0: 0.14, b0: 0.13, r1: 0.22, g1: 0.2, b1: 0.19, a0: 0.42, a1: 0, drag: 0.004 }, false);
    } else if (e.kind === 'ember') {
      this.particle(r, { x: p.x + (r() - 0.5) * 2 * s, y: p.y + r() * 2, z: p.z + (r() - 0.5) * 2 * s, vx: 0.3 + r() * 0.4, vy: 0.5 + r() * 0.6, vz: (r() - 0.5) * 0.4, max: 2.5 + r() * 2, s0: 0.05, s1: 0.02, r0: 1, g0: 0.55, b0: 0.15, r1: 1, g1: 0.25, b1: 0.05, drag: 0.01 }, true);
    } else if (e.kind === 'dust_drift') {
      this.particle(r, { x: p.x + (r() - 0.5) * 24 * s, y: 0.1 + r() * 1.5, z: p.z + (r() - 0.5) * 24 * s, vx: 0.6 + r() * 0.5, vy: (r() - 0.4) * 0.1, vz: 0.15 + (r() - 0.5) * 0.3, max: 6 + r() * 4, s0: 0.5, s1: 1.4, r0: 0.55, g0: 0.48, b0: 0.4, r1: 0.5, g1: 0.45, b1: 0.4, a0: 0.12, a1: 0, drag: 0 }, false);
    }
  }

  update(dt: number) {
    for (const e of this.emitters) {
      e.acc += dt * e.rate * this.density;
      while (e.acc >= 1) { e.acc -= 1; this.emitAmbient(e); }
    }
    this.add.update(dt);
    this.alpha.update(dt);
    for (const f of this.flashes) {
      if (f.life >= f.max) { f.light.intensity = 0; continue; }
      f.life += dt;
      f.light.intensity = f.intensity * Math.max(0, 1 - f.life / f.max);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.life += dt;
      const u = rg.life / rg.max;
      const mat = rg.mesh.material as THREE.MeshBasicMaterial;
      if (rg.scale > 0) rg.mesh.scale.setScalar(0.1 + u * rg.scale);
      mat.opacity = Math.max(0, 0.85 * (1 - u));
      if (u >= 1) { this.group.remove(rg.mesh); mat.dispose(); if (rg.scale < 0) rg.mesh.geometry.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      d.v.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      if (d.mesh.position.y < d.mesh.scale.y / 2) { d.mesh.position.y = d.mesh.scale.y / 2; d.v.y *= -0.25; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); }
      d.mesh.rotation.x += d.w.x * dt; d.mesh.rotation.y += d.w.y * dt; d.mesh.rotation.z += d.w.z * dt;
      if (d.life > d.max) { d.mesh.scale.multiplyScalar(0.9); if (d.mesh.scale.x < 0.003) { this.group.remove(d.mesh); this.debris.splice(i, 1); } }
    }
  }

  /** Remove all combat effects (used when scrubbing timelines). Ambient emitters keep running. */
  clearTransient() {
    this.add.clear(); this.alpha.clear();
    for (const d of this.debris) this.group.remove(d.mesh);
    for (const r of this.rings) this.group.remove(r.mesh);
    this.debris.length = 0; this.rings.length = 0;
    for (const f of this.flashes) { f.life = f.max; f.light.intensity = 0; }
  }

  resetSeed(seed: number) { this.seq = seed; }
}
