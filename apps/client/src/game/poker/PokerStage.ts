// PokerStage — the Scrap Poker room: an oval table under a hanging lamp and a
// robot in every occupied seat. Each robot is built from ten detachable parts;
// when its stack shrinks, parts break off and clatter to the floor, and scrap
// won from others piles up beside it. Seat screen positions are published so
// the DOM layer (cards, stacks, actions) can sit on top of each robot.

import * as THREE from 'three';
import { ROBOT_PARTS, type PokerView } from '@ashen/shared';
import { create } from 'zustand';
import { AudioManager } from '../../core/AudioManager';

export const usePokerLayout = create<{ seats: ({ x: number; y: number } | null)[]; center: { x: number; y: number } }>(() => ({ seats: [], center: { x: 0, y: 0 } }));

const PALETTE = ['#c9862e', '#5b8fd1', '#b8423a', '#6fa86a', '#9a6ad0', '#d0c050'];
const SEATS = 6;
const RX = 2.9, RZ = 1.75;

interface RobotView { group: THREE.Group; parts: THREE.Object3D[]; count: number; pile: THREE.Group; scrap: number; color: string; id: string }
interface Falling { obj: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; life: number }

export class PokerStage {
  readonly root = new THREE.Group();
  active = false;
  private robots: (RobotView | null)[] = new Array(SEATS).fill(null);
  private falling: Falling[] = [];
  private rotation = 0; // seat index shown at the bottom (you)
  private dealerChip: THREE.Mesh;
  private turnRing: THREE.Mesh;
  private potPile = new THREE.Group();
  private saved: { fog: THREE.Fog | THREE.FogExp2 | null; bg: THREE.Color | THREE.Texture | null } | null = null;
  private time = 0;
  private lastLayout = 0;
  private view: PokerView | null = null;

  constructor() {
    this.root.name = 'poker';
    this.root.visible = false;
    this.build();
    this.dealerChip = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 24), new THREE.MeshStandardMaterial({ color: '#f2ead8', roughness: 0.4 }));
    this.dealerChip.position.y = 0.82;
    this.root.add(this.dealerChip);
    this.turnRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 40), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.turnRing.rotation.x = -Math.PI / 2;
    this.turnRing.position.y = 0.01;
    this.root.add(this.turnRing, this.potPile);
  }

  private build() {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: '#2a221c', roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.root.add(floor);
    // Table: oval felt + padded rim + pedestal.
    const oval = (rx: number, rz: number) => { const s = new THREE.Shape(); s.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false, 0); return s; };
    const felt = new THREE.Mesh(new THREE.ShapeGeometry(oval(2.25, 1.25), 64), new THREE.MeshStandardMaterial({ color: '#2f4a33', roughness: 0.9 }));
    felt.rotation.x = -Math.PI / 2; felt.position.y = 0.8; felt.receiveShadow = true;
    const rimShape = oval(2.55, 1.5); rimShape.holes.push(new THREE.Path().absellipse(0, 0, 2.25, 1.25, 0, Math.PI * 2, true, 0) as THREE.Path);
    const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(rimShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3, curveSegments: 48 }), new THREE.MeshStandardMaterial({ color: '#3a2416', roughness: 0.6 }));
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.76; rim.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 0.78, 20), new THREE.MeshStandardMaterial({ color: '#2b1b10', roughness: 0.7 }));
    base.position.y = 0.39; base.castShadow = true;
    this.root.add(felt, rim, base);
    // Hanging lamp.
    const lamp = new THREE.SpotLight('#ffd8a0', 60, 12, 0.75, 0.5, 1.4);
    lamp.position.set(0, 4.2, 0); lamp.target.position.set(0, 0.8, 0);
    lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.45, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#2a3a2a', side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }));
    shade.position.set(0, 4.25, 0);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffd890', emissiveIntensity: 3 }));
    bulb.position.set(0, 4.05, 0);
    this.root.add(lamp, lamp.target, shade, bulb, new THREE.HemisphereLight('#a08870', '#1a120c', 1.1));
    const fill = new THREE.DirectionalLight('#8fa8c8', 0.9);
    fill.position.set(-4, 5, 6);
    this.root.add(fill);
    // Back wall clutter: shelves of junk parts.
    const wallMat = new THREE.MeshStandardMaterial({ color: '#3a3028', roughness: 1 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 0.3), wallMat);
    wall.position.set(0, 3, -6); wall.receiveShadow = true;
    this.root.add(wall);
    for (let i = 0; i < 26; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random() * 0.5, 0.2 + Math.random() * 0.4, 0.3), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.2, 0.15 + Math.random() * 0.2), metalness: 0.6, roughness: 0.5 }));
      b.position.set(-6 + Math.random() * 12, 1.2 + Math.floor(Math.random() * 3) * 1.1, -5.7);
      this.root.add(b);
    }
  }

  setActive(on: boolean, scene: THREE.Scene) {
    if (on === this.active) return;
    this.active = on;
    this.root.visible = on;
    if (on) {
      this.saved = { fog: scene.fog as THREE.FogExp2 | null, bg: scene.background as THREE.Color | null };
      scene.fog = new THREE.FogExp2('#120d0a', 0.06);
      scene.background = new THREE.Color('#0d0a08');
    } else if (this.saved) { scene.fog = this.saved.fog; scene.background = this.saved.bg; }
  }

  private seatPos(seat: number, out = new THREE.Vector3()) {
    // Rotate so that seat `this.rotation` is at the bottom (towards the camera, +z).
    const k = ((seat - this.rotation + SEATS) % SEATS);
    const a = Math.PI / 2 + (k / SEATS) * Math.PI * 2;
    return out.set(Math.cos(a) * RX, 0, Math.sin(a) * RZ + 0);
  }

  // ------------------------------------------------------------------ robots
  private makeRobot(color: string): RobotView {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a2a2e', metalness: 0.7, roughness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({ color: '#7fd8ff', emissive: '#4fc8ff', emissiveIntensity: 2.5 });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; return o;
    };
    const g = (...objs: THREE.Object3D[]) => { const x = new THREE.Group(); x.add(...objs); return x; };
    // Sitting robot facing +z (toward the table centre after rotation).
    const parts: Record<string, THREE.Object3D> = {
      'core': g(box(0.5, 0.42, 0.32, dark, 0, 0.95, 0), box(0.18, 0.12, 0.05, glow, 0, 1.0, 0.17)),
      'chest plate': box(0.46, 0.3, 0.06, metal, 0, 1.2, 0.18),
      'backpack': g(box(0.38, 0.4, 0.16, metal, 0, 1.1, -0.24), box(0.06, 0.25, 0.06, dark, 0.12, 1.4, -0.26)),
      'shoulder plates': g(box(0.2, 0.08, 0.26, metal, -0.34, 1.33, 0), box(0.2, 0.08, 0.26, metal, 0.34, 1.33, 0)),
      'left arm': g(box(0.13, 0.36, 0.13, dark, 0.34, 1.12, 0.05), box(0.12, 0.12, 0.34, metal, 0.34, 0.92, 0.2)),
      'right arm': g(box(0.13, 0.36, 0.13, dark, -0.34, 1.12, 0.05), box(0.12, 0.12, 0.34, metal, -0.34, 0.92, 0.2)),
      'head': g(box(0.32, 0.26, 0.28, metal, 0, 1.55, 0), box(0.24, 0.07, 0.03, glow, 0, 1.57, 0.15)),
      'antenna': g(box(0.03, 0.22, 0.03, dark, 0.08, 1.79, 0), new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), glow).translateX(0.08).translateY(1.91)),
      'left leg': g(box(0.15, 0.15, 0.42, dark, 0.13, 0.72, 0.18), box(0.14, 0.45, 0.14, metal, 0.13, 0.45, 0.38)),
      'right leg': g(box(0.15, 0.15, 0.42, dark, -0.13, 0.72, 0.18), box(0.14, 0.45, 0.14, metal, -0.13, 0.45, 0.38)),
    };
    const ordered = ROBOT_PARTS.map((n) => parts[n]);
    // A crate to sit on.
    group.add(box(0.6, 0.55, 0.5, new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.9 }), 0, 0.275, -0.05));
    for (const p of ordered) group.add(p);
    const pile = new THREE.Group();
    group.add(pile);
    return { group, parts: ordered, count: ordered.length, pile, scrap: 0, color, id: '' };
  }

  /** Detach a part: it flies off and tumbles to the floor. */
  private dropPart(r: RobotView, part: THREE.Object3D) {
    const world = new THREE.Vector3();
    part.getWorldPosition(world);
    const clone = part.clone(true);
    clone.position.set(0, 0, 0);
    clone.applyMatrix4(part.matrixWorld);
    this.root.add(clone);
    part.visible = false;
    const out = new THREE.Vector3().copy(r.group.position).setY(0).normalize();
    this.falling.push({ obj: clone, v: new THREE.Vector3(out.x * 1.6 + (Math.random() - 0.5), 2.2 + Math.random(), out.z * 1.6 + (Math.random() - 0.5)), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), life: 3.2 });
  }

  private setScrap(r: RobotView, n: number) {
    const want = Math.min(24, n);
    while (r.pile.children.length < want) {
      const k = r.pile.children.length;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12 + Math.random() * 0.1, 0.08 + Math.random() * 0.08, 0.12), new THREE.MeshStandardMaterial({ color: PALETTE[Math.floor(Math.random() * PALETTE.length)], metalness: 0.6, roughness: 0.45 }));
      m.position.set(0.55 + (k % 4) * 0.13 + (Math.random() - 0.5) * 0.05, 0.05 + Math.floor(k / 8) * 0.09, -0.15 + (Math.floor(k / 4) % 2) * 0.14);
      m.rotation.y = Math.random() * 3;
      m.castShadow = true;
      r.pile.add(m);
    }
    while (r.pile.children.length > want) r.pile.remove(r.pile.children[r.pile.children.length - 1]);
    r.scrap = n;
  }

  // ------------------------------------------------------------------ sync
  sync(v: PokerView | null) {
    this.view = v;
    if (!v) return;
    this.rotation = v.you ?? 0;
    for (let i = 0; i < SEATS; i++) {
      const s = v.seats[i];
      let r = this.robots[i];
      if (!s) { if (r) { this.root.remove(r.group); this.robots[i] = null; } continue; }
      if (!r || r.id !== s.id) {
        if (r) this.root.remove(r.group);
        r = this.makeRobot(PALETTE[i % PALETTE.length]);
        r.id = s.id;
        this.robots[i] = r;
        this.root.add(r.group);
        r.count = r.parts.length;
      }
      const p = this.seatPos(i);
      r.group.position.copy(p).multiplyScalar(1.12);
      r.group.lookAt(0, 0, 0);
      r.group.rotateY(0); // face the table
      // Strip or rebuild parts to match the stack.
      const target = Math.max(0, Math.min(r.parts.length, s.parts));
      if (target < r.count) {
        for (let k = r.parts.length - r.count; k < r.parts.length - target; k++) this.dropPart(r, r.parts[k]);
        AudioManager.play('metal_collapse', { volume: 0.5 });
      } else if (target > r.count) {
        for (let k = r.parts.length - target; k < r.parts.length - r.count; k++) r.parts[k].visible = true;
        AudioManager.play('hit_metal', { volume: 0.35 });
      }
      for (let k = 0; k < r.parts.length; k++) r.parts[k].visible = k >= r.parts.length - target;
      r.count = target;
      this.setScrap(r, s.scrap);
      r.group.visible = true;
      (r.group.children[0] as THREE.Mesh).visible = true;
    }
    // Dealer button + turn ring.
    if (v.dealer >= 0 && v.seats[v.dealer]) {
      const p = this.seatPos(v.dealer).multiplyScalar(0.72);
      this.dealerChip.position.set(p.x + 0.25, 0.83, p.z);
      this.dealerChip.visible = true;
    } else this.dealerChip.visible = false;
    if (v.toAct >= 0 && v.seats[v.toAct]) { this.turnRing.position.copy(this.seatPos(v.toAct).multiplyScalar(1.12)).setY(0.01); this.turnRing.visible = true; }
    else this.turnRing.visible = false;
    // Pot chips.
    const chips = Math.min(40, Math.ceil(v.pot / Math.max(1, v.bb)));
    while (this.potPile.children.length < chips) {
      const k = this.potPile.children.length;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), new THREE.MeshStandardMaterial({ color: ['#c8302a', '#2a58c8', '#e8e0d0', '#2a2a2a'][k % 4], roughness: 0.4 }));
      c.position.set((k % 5) * 0.13 - 0.26, 0.82 + Math.floor(k / 10) * 0.021, (Math.floor(k / 5) % 2) * 0.13 - 0.06);
      this.potPile.add(c);
    }
    while (this.potPile.children.length > chips) this.potPile.remove(this.potPile.children[this.potPile.children.length - 1]);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, size: { width: number; height: number }) {
    if (!this.active) return;
    this.time += dt;
    // Camera: behind your seat, looking across the table.
    // Steep view over your robot's shoulder so the whole table and every robot read clearly.
    camera.position.set(0, 6.4, 5.4);
    camera.lookAt(0, 0.35, -0.55);
    // Falling parts.
    this.falling = this.falling.filter((f) => {
      f.life -= dt;
      f.v.y -= 9.8 * dt;
      f.obj.position.addScaledVector(f.v, dt);
      if (f.obj.position.y < 0.05) { f.obj.position.y = 0.05; f.v.multiplyScalar(0.4); f.v.y = Math.abs(f.v.y) * 0.3; f.spin.multiplyScalar(0.5); }
      f.obj.rotation.x += f.spin.x * dt; f.obj.rotation.y += f.spin.y * dt; f.obj.rotation.z += f.spin.z * dt;
      if (f.life <= 0) { this.root.remove(f.obj); return false; }
      return true;
    });
    // Idle life: heads bob, the one to act leans in.
    for (let i = 0; i < SEATS; i++) {
      const r = this.robots[i];
      if (!r) continue;
      const head = r.parts[1];
      head.rotation.y = Math.sin(this.time * 0.7 + i) * 0.25;
      r.group.position.y = this.view?.toAct === i ? Math.abs(Math.sin(this.time * 3)) * 0.03 : 0;
    }
    // Publish seat screen positions for the DOM layer (10 Hz).
    if (this.time - this.lastLayout > 0.1) {
      this.lastLayout = this.time;
      camera.updateMatrixWorld();
      const proj = (p: THREE.Vector3) => { const v = p.clone().project(camera); return { x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height }; };
      const seats = Array.from({ length: SEATS }, (_, i) => (this.view?.seats[i] ? proj(this.seatPos(i).multiplyScalar(1.12).setY(2.15)) : null));
      usePokerLayout.setState({ seats, center: proj(new THREE.Vector3(0, 0.85, 0)) });
    }
  }
}
