// DerbyStage — renders the Wasteland Derby: the racecourse, eight horse-and-
// jockey runners, and a replay of the server's race timeline synced to the
// server clock. The viewer never controls a runner. An auto-director cuts
// between broadcast, follow, finish-line and incident shots.

import * as THREE from 'three';
import {
  DERBY_WEAPON_AUDIO, DERBY_WEAPONS, FACTION_IDS, START_S, TRACK,
  type DerbyEvent, type DerbyRunner, type DerbyState, type DerbyTimeline,
} from '@ashen/shared';
import { AudioManager } from '../../core/AudioManager';
import { useDerby } from '../../core/derbyStore';
import { AssetManager } from '../AssetManager';
import { FactionManager } from '../FactionManager';
import { FxSystem } from '../FxSystem';
import type { PieceVisual } from '../pieces/PieceVisual';
import { buildTrack, textSprite, trackPose, TRACK_WIDTH, type BuiltTrack, type Pose } from './track';

interface RunnerView {
  def: DerbyRunner;
  holder: THREE.Group;
  visual: PieceVisual;
  label: THREE.Sprite;
  /** Compact number tag shown instead of the full label while racing. */
  tag: THREE.Sprite;
  ring: THREE.Mesh;
  s: number; lat: number; v: number; hp: number; flags: number;
  down: boolean; jolt: number; fxAcc: number;
  pose: Pose;
}

interface Tracer { line: THREE.Line; life: number; max: number }

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

export class DerbyStage {
  readonly root = new THREE.Group();
  readonly fx = new FxSystem();
  active = false;
  private track: BuiltTrack;
  private runners = new Map<string, RunnerView>();
  private cardKey = '';
  private assetsReady = false;
  private hemi = new THREE.HemisphereLight('#ffd8b0', '#3a2818', 1.0);
  private sun = new THREE.DirectionalLight('#ffc890', 2.4);
  private camPos = new THREE.Vector3(0, 30, 60);
  private camLook = new THREE.Vector3();
  private cutPending = true;
  private evIdx = 0;
  private evRace = '';
  private focus: { id: string; until: number } | null = null;
  private tracers: Tracer[] = [];
  private gateOpen = 0;
  private gallopAt = 0;
  private cheeredOff = '';
  private time = 0;
  private saved: { fog: THREE.Fog | THREE.FogExp2 | null; bg: THREE.Color | THREE.Texture | null } | null = null;
  private fog = new THREE.FogExp2('#4a3020', 0.0048);

  constructor() {
    this.root.name = 'derby';
    this.root.visible = false;
    this.track = buildTrack();
    this.root.add(this.track.group, this.fx.group, this.hemi, new THREE.AmbientLight('#ffffff', 0.15));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.root.add(this.sun, this.sun.target);
    void Promise.all([FactionManager.preload([...FACTION_IDS]), AssetManager.preloadDerby()]).then(() => { this.assetsReady = true; this.cardKey = ''; });
  }

  setActive(on: boolean, scene: THREE.Scene) {
    if (on === this.active) return;
    this.active = on;
    this.root.visible = on;
    if (on) {
      this.saved = { fog: scene.fog as THREE.FogExp2 | null, bg: scene.background as THREE.Color | null };
      scene.fog = this.fog;
      scene.background = this.track.sky;
      this.cutPending = true;
    } else if (this.saved) {
      scene.fog = this.saved.fog;
      scene.background = this.saved.bg;
      this.fx.clearTransient();
    }
  }

  setViewportHeight(h: number) { this.fx.setViewportHeight(h); }

  // ------------------------------------------------------------------ runners
  private syncCard(st: DerbyState) {
    const key = `${st.raceId}:${this.assetsReady}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    for (const r of this.runners.values()) { this.root.remove(r.holder); r.visual.dispose(); }
    this.runners.clear();
    for (const def of st.runners) {
      const visual = FactionManager.createDerbyVisual(def.faction, def.tint);
      // Saddle-cloth in the runner's racing silks.
      visual.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const next = mats.map((mt) => { if (!mt.name.startsWith('MAT_silks')) return mt; const c = (mt as THREE.MeshStandardMaterial).clone(); c.color.set(def.silks); return c; });
        m.material = Array.isArray(m.material) ? next : next[0];
      });
      if (visual.base) visual.base.visible = false;
      visual.body.position.y = 0;
      const holder = new THREE.Group();
      holder.add(visual.object);
      const label = textSprite(`${def.number}  ${def.horse.toUpperCase()}`, { size: 1, bg: hexA(def.silks, 0.85), color: '#101010' });
      const mat = label.material as THREE.SpriteMaterial;
      mat.sizeAttenuation = false;
      const aspect = label.scale.x / label.scale.y;
      label.scale.set(0.032 * aspect, 0.032, 1);
      label.position.y = Math.max(1.5, visual.height + 0.35);
      holder.add(label);
      const tag = textSprite(String(def.number), { size: 1, bg: hexA(def.silks, 0.9), color: '#101010' });
      (tag.material as THREE.SpriteMaterial).sizeAttenuation = false;
      tag.scale.set(0.022 * (tag.scale.x / tag.scale.y), 0.022, 1);
      tag.position.y = label.position.y;
      tag.visible = false;
      holder.add(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
      holder.add(ring);
      this.root.add(holder);
      const view: RunnerView = { def, holder, visual, label, tag, ring, s: 0, lat: 0.5 + def.lane * TRACK.laneWidth, v: 0, hp: 100, flags: 0, down: false, jolt: 0, fxAcc: 0, pose: trackPose(0, 0) };
      this.runners.set(def.id, view);
      this.place(view, -0.9, view.lat, 0);
      visual.setLocomotion('idle');
    }
    this.evIdx = 0;
    this.evRace = st.raceId;
    this.focus = null;
    this.gateOpen = 0;
    this.cutPending = true;
    this.tracers.forEach((t) => this.root.remove(t.line));
    this.tracers = [];
  }

  /** Parade line-up: side by side across the home straight, facing the grandstand. */
  private lineUpX(i: number) { return trackPose(TRACK.startAt + 7, 0).x + i * 1.55; }
  private static readonly LINE_LAT = 4.2;
  private lineUp(r: RunnerView) {
    const p = trackPose(TRACK.startAt + 7 + r.def.lane * 1.55, DerbyStage.LINE_LAT, r.pose);
    r.holder.position.set(p.x, 0, p.z);
    r.holder.rotation.y = 0; // +Z: facing the stands
  }

  private place(r: RunnerView, s: number, lat: number, latVel: number) {
    trackPose(START_S + s, lat, r.pose);
    const p = r.pose;
    r.holder.position.set(p.x, 0, p.z);
    const v = Math.max(0.5, r.v);
    r.holder.rotation.y = Math.atan2(p.dx + (p.nx * latVel) / v, p.dz + (p.nz * latVel) / v);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (!this.active) return;
    this.time += dt;
    const store = useDerby.getState();
    const st = store.state;
    this.fx.update(dt);
    this.updateTracers(dt);
    if (!st) { this.idleCamera(dt, camera); return; }
    this.syncCard(st);
    const now = store.now();
    const tl = st.timeline;
    const tau = (now - st.startsAt) / 1000;
    const racing = !!tl && st.phase !== 'betting' && tau >= 0;

    // Start stall doors swing up at the off.
    this.gateOpen = racing ? Math.min(1, this.gateOpen + dt * 4) : 0;
    for (const g of this.track.gates) g.rotation.z = this.gateOpen * 1.45;
    // Once the field is away the stalls are towed off the course (the run-in passes this spot).
    const towed = racing ? Math.min(1, Math.max(0, (tau - 3) / 4)) : st.phase === 'results' ? 1 : 0;
    this.track.stalls.position.z = TRACK.radius + towed * towed * (TRACK_WIDTH + 5);

    if (racing && tl) {
      this.playback(tl, Math.min(tau, tl.duration), dt);
      // Track-side atmosphere: thundering hooves while the field runs, the stands erupting at the off.
      const running = tau < (tl.finishTimes[tl.finishOrder[tl.finishOrder.length - 1]] ?? tl.duration);
      if (running && this.time - this.gallopAt > 3.7) { this.gallopAt = this.time; AudioManager.play('derby_gallop', { volume: 0.7 }); }
      if (this.cheeredOff !== tl.raceId && tau < 2) { this.cheeredOff = tl.raceId; AudioManager.play('derby_crowd', { volume: 0.8 }); }
    }
    else {
      // Betting: a line-up in front of the stands for inspection. Gates: loaded in the stalls.
      for (const r of this.runners.values()) {
        if (st.phase === 'betting') this.lineUp(r);
        else if (st.phase !== 'results') { r.v = 0; this.place(r, -0.9, 0.5 + r.def.lane * TRACK.laneWidth, 0); }
        r.down = false;
        r.visual.object.rotation.z = 0;
        r.visual.setLocomotion('idle');
        r.visual.update(dt);
      }
    }

    // Selection / my-horse rings.
    const mine = new Set(st.myBets.map((b) => b.runnerId));
    for (const r of this.runners.values()) {
      const full = !racing || mine.has(r.def.id) || store.selected === r.def.id;
      r.label.visible = full; r.tag.visible = !full;
      r.ring.visible = mine.has(r.def.id) || store.selected === r.def.id;
      (r.ring.material as THREE.MeshBasicMaterial).color.set(store.selected === r.def.id ? '#6fe0ff' : '#ffb347');
    }
    this.animateCrowd(racing ? 1 : 0.25);
    this.direct(dt, camera, st, tl, tau, racing);
  }

  private playback(tl: DerbyTimeline, tau: number, dt: number) {
    const n = tl.runners.length;
    const fi = Math.max(0, Math.min(tl.frames.length - 1, tau / tl.step));
    const i0 = Math.floor(fi), i1 = Math.min(tl.frames.length - 1, i0 + 1), a = fi - i0;
    const f0 = tl.frames[i0], f1 = tl.frames[i1];
    for (let k = 0; k < n; k++) {
      const r = this.runners.get(tl.runners[k]);
      if (!r) continue;
      const s = f0[k * 4] + (f1[k * 4] - f0[k * 4]) * a;
      const lat = f0[k * 4 + 1] + (f1[k * 4 + 1] - f0[k * 4 + 1]) * a;
      const v = i1 > i0 ? (f1[k * 4] - f0[k * 4]) / tl.step : 0;
      const latVel = i1 > i0 ? (f1[k * 4 + 1] - f0[k * 4 + 1]) / tl.step : 0;
      r.v += (v - r.v) * Math.min(1, dt * 6);
      r.s = s; r.lat = lat; r.hp = f0[k * 4 + 2]; r.flags = f0[k * 4 + 3];
      this.place(r, s, lat, latVel);
      const down = (r.flags & 8) !== 0;
      if (down && !r.down) { r.down = true; r.visual.play('DEATH_LIGHT'); }
      else if (!down && r.down) { r.down = false; r.visual.play('RUN'); }
      if (!r.down) {
        r.visual.setLocomotion(r.v > 0.35 ? 'run' : 'idle');
        const sv = r.visual as PieceVisual & { setRate?: (x: number) => void };
        if (r.v > 0.35) sv.setRate?.(Math.max(0.45, Math.min(1.7, r.v / 5.6)));
      }
      // Hit jolt + stagger wobble.
      r.jolt = Math.max(0, r.jolt - dt * 2.5);
      const wobble = (r.flags & 1 ? 0.12 : 0) + r.jolt * 0.3;
      r.visual.object.rotation.z = Math.sin(this.time * 28) * wobble;
      r.visual.update(dt);
      // Trails: nitro flames, smoke screen.
      r.fxAcc += dt;
      if (r.fxAcc > 0.09) {
        r.fxAcc = 0;
        const back = tmpA.set(r.holder.position.x - r.pose.dx * 0.7, 0.55, r.holder.position.z - r.pose.dz * 0.7);
        if (r.flags & 2) this.fx.emit('fire_burst', back, { scale: 0.35, dir: tmpB.set(-r.pose.dx, 0.2, -r.pose.dz) });
        if (r.flags & 4) this.fx.emit('smoke_puff', back.setY(0.9), { scale: 0.8 });
        if (r.v > 3 && Math.random() < 0.35) this.fx.emit('step_dust', back.setY(0.05), { scale: 0.5 });
      }
    }
    // Events up to now (skip anything long past, e.g. when joining mid-race).
    if (this.evRace !== tl.raceId) { this.evRace = tl.raceId; this.evIdx = 0; }
    while (this.evIdx < tl.events.length && tl.events[this.evIdx].t <= tau) {
      const e = tl.events[this.evIdx++];
      if (tau - e.t < 0.6) this.onEvent(e, tl);
    }
  }

  private headOf(id: string | undefined, out: THREE.Vector3) {
    const r = id ? this.runners.get(id) : undefined;
    if (!r) return out.set(0, 1, 0);
    return out.copy(r.holder.position).setY(1.05);
  }

  private onEvent(e: DerbyEvent, tl: DerbyTimeline) {
    const a = this.headOf(e.runner, new THREE.Vector3());
    const b = this.headOf(e.target, new THREE.Vector3());
    const vol = this.volumeAt(a);
    const target = e.target ? this.runners.get(e.target) : undefined;
    switch (e.kind) {
      case 'attack': {
        const w = DERBY_WEAPONS[e.weapon!];
        const dir = tmpC.copy(b).sub(a).normalize();
        const sfx = DERBY_WEAPON_AUDIO[w.id];
        if (w.ranged) {
          this.fx.emit('muzzle_flash', tmpA.copy(a).addScaledVector(dir, 0.35), { dir, scale: 0.7 });
          this.tracer(a, b, w.id === 'flare_gun' ? '#ff6a2a' : w.id === 'crossbow' ? '#d0c0a0' : '#ffe0a0', w.id === 'crossbow' ? 0.25 : 0.1);
        } else if (w.id === 'cattle_prod') {
          this.fx.emit('electric_arc', tmpA.copy(a).lerp(b, 0.5), { scale: 0.6 });
        } else {
          this.fx.emit('slash_trail', tmpA.copy(a).lerp(b, 0.5), { dir, scale: 0.7 });
        }
        AudioManager.play(sfx?.attack ?? 'swing_heavy', { volume: vol });
        break;
      }
      case 'hit': {
        const metal = target?.def.faction === 'machines';
        this.fx.emit(metal ? 'metal_hit' : 'blood_dust', b, { scale: 0.7 });
        if (e.weapon === 'flare_gun') this.fx.emit('fire_burst', b, { scale: 0.5 });
        AudioManager.play(e.weapon ? DERBY_WEAPON_AUDIO[e.weapon]?.hit ?? 'hit_flesh' : metal ? 'hit_metal' : 'hit_flesh', { volume: this.volumeAt(b) });
        if (target) target.jolt = 1;
        break;
      }
      case 'miss': this.fx.emit('dust_ring', b.clone().setY(0.05), { scale: 0.4 }); break;
      case 'dodge': this.fx.emit('smoke_puff', a, { scale: 0.5 }); break;
      case 'counter': this.fx.emit('spark', b, { scale: 0.6 }); AudioManager.play('block', { volume: vol }); break;
      case 'boost': this.fx.emit('fire_burst', a.clone().setY(0.6), { scale: 0.9 }); AudioManager.play('ability', { volume: vol }); break;
      case 'smoke': this.fx.emit('smoke_puff', a, { scale: 2.2 }); AudioManager.play('swing_light', { volume: vol }); break;
      case 'grapple': this.tracer(a, b, '#8a6a40', 0.8); AudioManager.play('swing_hydraulic', { volume: vol }); break;
      case 'heal': this.fx.emit('energy_burst', a, { scale: 0.6, color: '#6aff8a' }); break;
      case 'stumble': this.fx.emit('dust_ring', a.clone().setY(0.05), { scale: 0.7 }); break;
      case 'wipeout':
        this.fx.emit('debris', a.clone().setY(0.4), { scale: 0.8 });
        this.fx.emit('dust_ring', a.clone().setY(0.05), { scale: 1.4 });
        AudioManager.play('derby_fall', { volume: vol });
        this.focus = { id: e.runner, until: e.t + 3.2 };
        this.cutPending = true;
        break;
      case 'finish':
        if (e.place === 1) {
          const fp = trackPose(TRACK.finishAt, TRACK_WIDTH / 2);
          this.fx.emit('energy_burst', tmpA.set(fp.x, 4.4, fp.z), { scale: 1.5, color: '#ffd27a' });
          AudioManager.play('derby_crowd', { volume: 1 });
        }
        break;
      default: break;
    }
    void tl;
  }

  private volumeAt(p: THREE.Vector3) {
    const d = p.distanceTo(this.camPos);
    return Math.max(0.12, Math.min(1, 14 / (d + 4)));
  }

  private tracer(a: THREE.Vector3, b: THREE.Vector3, color: string, life: number) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.root.add(line);
    this.tracers.push({ line, life, max: life });
  }

  private updateTracers(dt: number) {
    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / t.max);
      if (t.life > 0) return true;
      this.root.remove(t.line); t.line.geometry.dispose(); (t.line.material as THREE.Material).dispose();
      return false;
    });
  }

  private animateCrowd(excite: number) {
    const c = this.track.crowd;
    const base = c.userData.base as THREE.Vector3[];
    const m = new THREE.Matrix4();
    for (let i = 0; i < c.count; i++) {
      const b = base[i];
      m.makeTranslation(b.x, b.y + Math.abs(Math.sin(this.time * (6 + (i % 5)) + i)) * 0.09 * excite, b.z);
      c.setMatrixAt(i, m);
    }
    c.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ camera director
  private idleCamera(dt: number, camera: THREE.PerspectiveCamera) {
    const a = this.time * 0.05;
    this.moveCamera(camera, tmpA.set(Math.cos(a) * 70, 28, Math.sin(a) * 55), tmpB.set(0, 0, 0), dt, 1);
  }

  private direct(dt: number, camera: THREE.PerspectiveCamera, st: DerbyState, tl: DerbyTimeline | null, tau: number, racing: boolean) {
    const { cam, selected } = useDerby.getState();
    const runners = [...this.runners.values()];
    if (!runners.length) return this.idleCamera(dt, camera);
    const mine = st.myBets[0]?.runnerId;
    const byPos = [...runners].sort((x, y) => y.s - x.s);
    const leader = byPos[0];
    const pos = tmpA, look = tmpB;
    let rate = 2.2;

    if (!racing) {
      const sel = selected ? this.runners.get(selected) : undefined;
      if (st.phase === 'betting') {
        // Inspect the line-up from the rail in front of the stands; close on the selected horse.
        const z = trackPose(0, DerbyStage.LINE_LAT).z;
        if (sel) {
          const p = sel.holder.position;
          const a = Math.sin(this.time * 0.4);
          pos.set(p.x + a * 1.1, 1.35, p.z + 3.3);
          look.set(p.x, 0.85, p.z);
        } else {
          const mid = (this.lineUpX(0) + this.lineUpX(7)) / 2;
          const sway = Math.sin(this.time * 0.15);
          pos.set(mid + sway * 4, 2.6, z + 10.5);
          look.set(mid + sway * 1.5, 0.7, z);
        }
      } else {
        // At the gates: from behind the stalls' outer end, looking along the line of doors.
        const g = trackPose(TRACK.startAt, TRACK.laneWidth * 3.5);
        const sway = Math.sin(this.time * 0.18);
        pos.set(g.x + 6.5, 3.4 + sway * 0.4, g.z + 10);
        look.set(g.x, 0.7, g.z);
      }
      if (st.phase === 'results') {
        const w = st.results ? this.runners.get(st.results[0].runnerId) : leader;
        const p = (w ?? leader).holder.position;
        pos.set(p.x + 3.5, 2.2, p.z + 5);
        look.set(p.x, 0.9, p.z);
      }
      return this.moveCamera(camera, pos, look, dt, rate);
    }

    const finished = tl ? tau > tl.finishTimes[tl.finishOrder[0]] + 2.5 : false;
    if (st.phase === 'results' || finished) {
      const w = tl ? this.runners.get(tl.finishOrder[0]) : leader;
      const p = (w ?? leader).holder.position;
      const d = (w ?? leader).pose;
      pos.set(p.x + d.dx * 5 + d.nx * 3, 2.4, p.z + d.dz * 5 + d.nz * 3);
      look.set(p.x, 0.9, p.z);
      return this.moveCamera(camera, pos, look, dt, 1.6);
    }

    const followTarget = (id: string | undefined) => (id ? this.runners.get(id) : undefined) ?? leader;
    if (cam === 'aerial') {
      pos.set(leader.holder.position.x * 0.3, 62, leader.holder.position.z * 0.3 + 58);
      look.set(leader.holder.position.x * 0.5, 0, leader.holder.position.z * 0.5);
    } else if (cam === 'follow') {
      const r = followTarget(selected ?? mine);
      const p = r.holder.position, d = r.pose;
      pos.set(p.x - d.dx * 6.5 - d.nx * 1.5, 3.1, p.z - d.dz * 6.5 - d.nz * 1.5);
      look.set(p.x + d.dx * 4, 0.9, p.z + d.dz * 4);
      rate = 4;
    } else {
      const focus = this.focus && tau < this.focus.until ? this.runners.get(this.focus.id) : undefined;
      const toFinish = tl ? st.distance - leader.s : Infinity;
      if (focus) {
        // Incident cam: low and tight on the runner in trouble.
        const p = focus.holder.position, d = focus.pose;
        pos.set(p.x + d.dx * 3.5 - d.nx * 3.2, 1.6, p.z + d.dz * 3.5 - d.nz * 3.2);
        look.set(p.x, 0.8, p.z);
        rate = 5;
      } else if (toFinish < 26 && toFinish > -4) {
        // Finish-line camera: from beyond the post, looking back down the home straight.
        const fp = trackPose(TRACK.finishAt + 11, -8.5);
        pos.set(fp.x, 4.2, fp.z);
        look.set(leader.holder.position.x, 0.8, leader.holder.position.z + 2);
        if (this.lastShot !== 'finish') this.cutPending = true;
        this.lastShot = 'finish';
        rate = 6;
      } else {
        // Broadcast: from the infield side, framing the leading group.
        this.lastShot = 'broadcast';
        const pack = tmpC.set(0, 0, 0);
        let wsum = 0;
        byPos.slice(0, 4).forEach((r, i) => { const w = 1 / (i + 1); pack.addScaledVector(r.holder.position, w); wsum += w; });
        pack.multiplyScalar(1 / wsum);
        const d = leader.pose;
        pos.set(pack.x - d.nx * 9.5 - d.dx * 2.5, 4.2, pack.z - d.nz * 9.5 - d.dz * 2.5);
        look.set(pack.x + d.dx * 2, 0.7, pack.z + d.dz * 2);
      }
    }
    this.moveCamera(camera, pos, look, dt, rate);
  }

  private lastShot = '';

  private moveCamera(camera: THREE.PerspectiveCamera, pos: THREE.Vector3, look: THREE.Vector3, dt: number, rate: number) {
    if (this.cutPending) { this.camPos.copy(pos); this.camLook.copy(look); this.cutPending = false; }
    else {
      const k = 1 - Math.exp(-dt * rate);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, Math.min(1, k * 1.6));
    }
    camera.position.copy(this.camPos);
    camera.up.copy(UP);
    camera.lookAt(this.camLook);
    // Shadows follow what the camera is looking at.
    this.sun.position.set(this.camLook.x + 18, 34, this.camLook.z + 12);
    this.sun.target.position.copy(this.camLook);
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
