// ProceduralPieceFactory — builds stylised miniature chess pieces for each
// faction out of named parts. These are the replaceable placeholder assets:
// every piece exposes the same part rig (pelvis/torso/head/arms/legs/mount/
// weapon) so the procedural animator and death system can drive it, and the
// AssetManager swaps in a GLB from the Blender pipeline whenever one exists.
//
// Readability rules shared by every faction (so a glance says "that's a rook"):
//   pawn    short, simple helmet          knight  always mounted (horizontal mass)
//   bishop  tall pointed mitre / mast     rook    broad, crenellated crown ring
//   queen   tall, spiked coronet + cape   king    tallest, cross crown + cape
// plus an engraved glyph on every base and a team-coloured base rim.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FACTIONS, type BuiltinFactionId, type Color, type PieceClass, type WeaponKind } from '@ashen/shared';
import { glyphTexture, grimeTexture } from '../textures';

export interface PieceRig {
  root: THREE.Group;
  base: THREE.Group;
  body: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  mount: THREE.Group | null;
  weapon: THREE.Object3D | null;
  /** Meshes that fly apart on a disassembly death. */
  breakables: THREE.Mesh[];
  emissive: THREE.MeshStandardMaterial[];
  height: number;
  kind: 'biped' | 'rider' | 'tracked';
  mechanical: boolean;
  armLength: number;
}

export const GLYPHS: Record<PieceClass, string> = { pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛', king: '♚' };
export const TEAM_RIM: Record<Color, string> = { w: '#ffd59a', b: '#ff3a2a' };

// ----------------------------------------------------------------------------- materials
interface Palette { primary: THREE.Color; secondary: THREE.Color; dark: THREE.Color; accent: THREE.Color; base: THREE.Color; metal: THREE.Color }

function teamPalette(f: BuiltinFactionId, side: Color): Palette {
  const p = FACTIONS[f].palette;
  const primary = new THREE.Color(p.primary), secondary = new THREE.Color(p.secondary), accent = new THREE.Color(p.accent);
  if (side === 'b') {
    primary.multiplyScalar(0.5).lerp(new THREE.Color('#1a0d0a'), 0.25);
    secondary.multiplyScalar(0.55);
    accent.lerp(new THREE.Color('#ff2a1a'), 0.55);
  } else {
    primary.lerp(new THREE.Color('#f3e9d8'), 0.22);
    secondary.lerp(new THREE.Color('#d8d0c0'), 0.12);
  }
  return { primary, secondary, accent, dark: new THREE.Color(p.dark), base: new THREE.Color(p.base), metal: new THREE.Color(side === 'w' ? '#8a8378' : '#4a4440') };
}

class Mats {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  readonly emissive: THREE.MeshStandardMaterial[] = [];
  constructor(private pal: Palette, private feel: { metalness: number; roughness: number }) {}
  get(kind: 'primary' | 'secondary' | 'dark' | 'metal' | 'base' | 'accent' | 'glow' | 'rubber' | 'cloth', extra?: Partial<THREE.MeshStandardMaterialParameters>) {
    const key = kind + JSON.stringify(extra ?? {});
    let m = this.cache.get(key);
    if (m) return m;
    const p = this.pal;
    const rough = grimeTexture(256, 3);
    switch (kind) {
      case 'primary': m = new THREE.MeshStandardMaterial({ color: p.primary, metalness: this.feel.metalness, roughness: this.feel.roughness, roughnessMap: rough }); break;
      case 'secondary': m = new THREE.MeshStandardMaterial({ color: p.secondary, metalness: this.feel.metalness * 0.6, roughness: Math.min(1, this.feel.roughness + 0.1), roughnessMap: rough }); break;
      case 'cloth': m = new THREE.MeshStandardMaterial({ color: p.secondary.clone().multiplyScalar(0.85), metalness: 0, roughness: 0.95 }); break;
      case 'dark': m = new THREE.MeshStandardMaterial({ color: p.dark, metalness: 0.3, roughness: 0.7 }); break;
      case 'metal': m = new THREE.MeshStandardMaterial({ color: p.metal, metalness: 0.85, roughness: 0.38, roughnessMap: rough }); break;
      case 'rubber': m = new THREE.MeshStandardMaterial({ color: '#141210', metalness: 0, roughness: 0.9 }); break;
      case 'base': m = new THREE.MeshStandardMaterial({ color: p.base, metalness: 0.6, roughness: 0.55, roughnessMap: rough }); break;
      case 'accent': m = new THREE.MeshStandardMaterial({ color: p.accent, metalness: 0.3, roughness: 0.4, emissive: p.accent, emissiveIntensity: 0.35 }); this.emissive.push(m); break;
      case 'glow': m = new THREE.MeshStandardMaterial({ color: p.accent, emissive: p.accent, emissiveIntensity: 2.2, roughness: 0.3, toneMapped: false }); this.emissive.push(m); break;
    }
    if (extra) m!.setValues(extra);
    m!.userData.baseEmissive = m!.emissiveIntensity;
    this.cache.set(key, m!);
    return m!;
  }
}

// ----------------------------------------------------------------------------- geometry helpers
const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

class Builder {
  breakables: THREE.Mesh[] = [];
  constructor(readonly m: Mats) {}
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], breakable = true) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (breakable) this.breakables.push(mesh);
    return mesh;
  }
  box(w: number, h: number, d: number, mat: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number], rot?: [number, number, number], r = 0.02) {
    const g = cachedGeo(`rb${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)));
    return this.mesh(g, mat, parent, pos, rot);
  }
  cyl(rt: number, rb: number, h: number, mat: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number], rot?: [number, number, number], seg = 14) {
    const g = cachedGeo(`cy${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
    return this.mesh(g, mat, parent, pos, rot);
  }
  sphere(r: number, mat: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number], scale?: [number, number, number], seg = 16) {
    const g = cachedGeo(`sp${r}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)));
    const m = this.mesh(g, mat, parent, pos);
    if (scale) m.scale.set(...scale);
    return m;
  }
  cone(r: number, h: number, mat: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number], rot?: [number, number, number], seg = 10) {
    const g = cachedGeo(`co${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));
    return this.mesh(g, mat, parent, pos, rot);
  }
  torus(r: number, tube: number, mat: THREE.Material, parent: THREE.Object3D, pos?: [number, number, number], rot?: [number, number, number]) {
    const g = cachedGeo(`to${r}:${tube}`, () => new THREE.TorusGeometry(r, tube, 8, 24));
    return this.mesh(g, mat, parent, pos, rot);
  }
  group(parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0], name = '') {
    const g = new THREE.Group();
    g.position.set(...pos);
    g.name = name;
    parent.add(g);
    return g;
  }
}

// ----------------------------------------------------------------------------- weapons
function buildWeapon(b: Builder, kind: WeaponKind, hand: THREE.Object3D, len: number): THREE.Object3D {
  const w = b.group(hand, [0, 0, 0], 'weapon');
  const metal = b.m.get('metal'), dark = b.m.get('dark'), glow = b.m.get('glow'), prim = b.m.get('primary');
  // Weapons point along +z (forward) from the hand.
  switch (kind) {
    case 'rifle':
      b.box(0.04, 0.05, len * 1.1, dark, w, [0, 0, len * 0.35]);
      b.box(0.03, 0.08, 0.04, dark, w, [0, -0.05, len * 0.25]);
      b.cyl(0.012, 0.012, len * 0.5, metal, w, [0, 0.01, len * 0.95], [Math.PI / 2, 0, 0], 6);
      break;
    case 'pistol': case 'knife':
      b.box(0.03, 0.05, len * 0.45, kind === 'knife' ? metal : dark, w, [0, 0, len * 0.22]);
      break;
    case 'shotgun':
      b.box(0.05, 0.05, len * 0.9, dark, w, [0, 0, len * 0.3]);
      b.cyl(0.02, 0.02, len * 0.6, metal, w, [0.012, 0.02, len * 0.7], [Math.PI / 2, 0, 0], 8);
      b.cyl(0.02, 0.02, len * 0.6, metal, w, [-0.012, 0.02, len * 0.7], [Math.PI / 2, 0, 0], 8);
      break;
    case 'pipe':
      b.cyl(0.018, 0.018, len * 1.0, metal, w, [0, 0, len * 0.42], [Math.PI / 2, 0, 0], 8);
      b.cyl(0.03, 0.03, 0.06, metal, w, [0, 0, len * 0.9], [Math.PI / 2, 0, 0], 8);
      break;
    case 'baton':
      b.cyl(0.016, 0.016, len * 0.8, dark, w, [0, 0, len * 0.35], [Math.PI / 2, 0, 0], 8);
      b.cyl(0.02, 0.02, 0.07, glow, w, [0, 0, len * 0.76], [Math.PI / 2, 0, 0], 8);
      break;
    case 'chainblade':
      b.box(0.02, 0.07, len * 1.0, metal, w, [0, 0, len * 0.5]);
      for (let i = 0; i < 6; i++) b.box(0.025, 0.025, 0.03, dark, w, [0, 0.045, len * (0.15 + i * 0.15)], [0, 0, Math.PI / 4], 0.005);
      break;
    case 'hammer':
      b.cyl(0.018, 0.018, len * 1.2, dark, w, [0, 0, len * 0.5], [Math.PI / 2, 0, 0], 8);
      b.box(0.14, 0.1, 0.1, metal, w, [0, 0, len * 1.08]);
      break;
    case 'lance':
      b.cyl(0.015, 0.015, len * 1.6, prim, w, [0, 0, len * 0.6], [Math.PI / 2, 0, 0], 8);
      b.cone(0.035, 0.16, glow, w, [0, 0, len * 1.45], [Math.PI / 2, 0, 0], 8);
      break;
    case 'claw':
      b.box(0.07, 0.05, 0.12, metal, w, [0, 0, 0.05]);
      b.box(0.02, 0.03, 0.12, metal, w, [0.03, 0, 0.14], [0, -0.3, 0]);
      b.box(0.02, 0.03, 0.12, metal, w, [-0.03, 0, 0.14], [0, 0.3, 0]);
      break;
    case 'saw':
      b.box(0.04, 0.04, 0.12, dark, w, [0, 0, 0.06]);
      b.cyl(0.09, 0.09, 0.012, metal, w, [0, 0, 0.16], [0, 0, Math.PI / 2], 16);
      break;
    case 'cannon':
      b.cyl(0.035, 0.04, len * 0.9, dark, w, [0, 0, len * 0.4], [Math.PI / 2, 0, 0], 10);
      break;
    case 'energy':
      b.box(0.05, 0.05, 0.14, dark, w, [0, 0, 0.06]);
      b.cyl(0.025, 0.035, 0.06, metal, w, [0, 0, 0.16], [Math.PI / 2, 0, 0], 10);
      b.sphere(0.022, glow, w, [0, 0, 0.2]);
      break;
    case 'staff':
      b.cyl(0.014, 0.014, len * 1.9, dark, w, [0, len * 0.35, 0.02], [0.15, 0, 0], 6);
      {
        const sign = b.cyl(0.08, 0.08, 0.012, b.m.get('accent'), w, [0, len * 1.25, 0.12], [Math.PI / 2 + 0.15, 0, 0], 8);
        sign.rotation.z = Math.PI / 8;
      }
      break;
  }
  return w;
}

// ----------------------------------------------------------------------------- heads + body parts by faction
type HeadStyle = 'gasmask' | 'helmet_mask' | 'raider' | 'bubble' | 'robot_eye' | 'robot_sensor' | 'hood';

function buildHead(b: Builder, head: THREE.Group, style: HeadStyle, s: number) {
  const prim = b.m.get('primary'), sec = b.m.get('secondary'), dark = b.m.get('dark'), glow = b.m.get('glow'), metal = b.m.get('metal');
  switch (style) {
    case 'gasmask':
      b.sphere(0.075 * s, dark, head, [0, 0.07 * s, 0], [1, 1.1, 1]);
      b.sphere(0.085 * s, prim, head, [0, 0.1 * s, -0.005], [1, 0.75, 1.05]); // helmet dome
      b.torus(0.083 * s, 0.01 * s, prim, head, [0, 0.085 * s, 0], [Math.PI / 2, 0, 0]);
      b.cyl(0.03 * s, 0.035 * s, 0.05 * s, dark, head, [0, 0.04 * s, 0.075 * s], [Math.PI / 2, 0, 0], 10);
      b.cyl(0.03 * s, 0.03 * s, 0.035 * s, sec, head, [0, 0.03 * s, 0.11 * s], [Math.PI / 2.3, 0, 0], 10);
      b.sphere(0.018 * s, glow, head, [0.032 * s, 0.085 * s, 0.065 * s]);
      b.sphere(0.018 * s, glow, head, [-0.032 * s, 0.085 * s, 0.065 * s]);
      break;
    case 'helmet_mask':
      b.box(0.15 * s, 0.15 * s, 0.15 * s, prim, head, [0, 0.08 * s, 0], undefined, 0.05 * s);
      b.box(0.12 * s, 0.03 * s, 0.02 * s, glow, head, [0, 0.09 * s, 0.075 * s], undefined, 0.01);
      break;
    case 'raider':
      b.sphere(0.075 * s, dark, head, [0, 0.07 * s, 0], [1, 1.1, 1]);
      b.box(0.13 * s, 0.05 * s, 0.03 * s, metal, head, [0, 0.04 * s, 0.07 * s], undefined, 0.01); // jaw plate
      b.box(0.11 * s, 0.025 * s, 0.03 * s, glow, head, [0, 0.095 * s, 0.07 * s], undefined, 0.008); // goggles
      for (let i = -2; i <= 2; i++) b.cone(0.014 * s, 0.08 * s, prim, head, [0, 0.15 * s, i * 0.025 * s], [0, 0, 0], 5); // mohawk spikes
      break;
    case 'bubble':
      b.sphere(0.07 * s, sec, head, [0, 0.07 * s, 0]);
      b.sphere(0.092 * s, prim, head, [0, 0.085 * s, -0.012 * s], [1, 1, 1]);
      b.box(0.13 * s, 0.045 * s, 0.05 * s, glow, head, [0, 0.085 * s, 0.065 * s], undefined, 0.02 * s);
      b.cyl(0.006 * s, 0.006 * s, 0.08 * s, metal, head, [0.06 * s, 0.17 * s, -0.02 * s], undefined, 4);
      break;
    case 'robot_eye':
      b.box(0.16 * s, 0.11 * s, 0.13 * s, prim, head, [0, 0.06 * s, 0], undefined, 0.02);
      b.cyl(0.035 * s, 0.035 * s, 0.03 * s, dark, head, [0, 0.065 * s, 0.07 * s], [Math.PI / 2, 0, 0], 12);
      b.sphere(0.025 * s, glow, head, [0, 0.065 * s, 0.085 * s]);
      b.box(0.17 * s, 0.02 * s, 0.1 * s, metal, head, [0, 0.125 * s, -0.01 * s], undefined, 0.006);
      break;
    case 'robot_sensor':
      b.cyl(0.06 * s, 0.075 * s, 0.1 * s, prim, head, [0, 0.06 * s, 0], undefined, 8);
      b.box(0.1 * s, 0.025 * s, 0.03 * s, glow, head, [0, 0.07 * s, 0.065 * s], undefined, 0.008);
      break;
    case 'hood':
      b.sphere(0.07 * s, dark, head, [0, 0.07 * s, 0]);
      b.cone(0.1 * s, 0.22 * s, b.m.get('cloth'), head, [0, 0.13 * s, -0.01 * s], [-0.12, 0, 0], 10);
      b.sphere(0.016 * s, glow, head, [0.028 * s, 0.075 * s, 0.062 * s]);
      b.sphere(0.016 * s, glow, head, [-0.028 * s, 0.075 * s, 0.062 * s]);
      break;
  }
}

interface FactionKit {
  head: Record<PieceClass, HeadStyle>;
  mechanical: boolean;
  /** Torso extras: pouches, plates, spikes, tanks. */
  torsoDetail(b: Builder, torso: THREE.Group, s: number, pc: PieceClass): void;
  shoulders(b: Builder, torso: THREE.Group, s: number, pc: PieceClass): void;
  mount: 'bike' | 'chopper' | 'walker' | 'hover';
}

const KITS: Record<BuiltinFactionId, FactionKit> = {
  remnants: {
    head: { pawn: 'gasmask', knight: 'gasmask', bishop: 'gasmask', rook: 'gasmask', queen: 'gasmask', king: 'gasmask' },
    mechanical: false, mount: 'bike',
    torsoDetail: (b, t, s) => {
      const sec = b.m.get('secondary'), cloth = b.m.get('cloth');
      for (const x of [-0.05, 0, 0.05]) b.box(0.04 * s, 0.05 * s, 0.03 * s, sec, t, [x * s, 0.08 * s, 0.075 * s], undefined, 0.008);
      b.box(0.15 * s, 0.17 * s, 0.07 * s, cloth, t, [0, 0.13 * s, -0.1 * s], undefined, 0.02); // backpack radio
      b.cyl(0.004 * s, 0.004 * s, 0.25 * s, b.m.get('metal'), t, [0.05 * s, 0.32 * s, -0.11 * s], undefined, 4);
      b.box(0.2 * s, 0.025 * s, 0.17 * s, sec, t, [0, 0.0, 0], undefined, 0.01); // belt
    },
    shoulders: (b, t, s) => {
      const p = b.m.get('primary');
      b.sphere(0.045 * s, p, t, [0.12 * s, 0.2 * s, 0], [1, 0.7, 1]);
      b.sphere(0.045 * s, p, t, [-0.12 * s, 0.2 * s, 0], [1, 0.7, 1]);
    },
  },
  wastelanders: {
    head: { pawn: 'raider', knight: 'raider', bishop: 'hood', rook: 'raider', queen: 'raider', king: 'raider' },
    mechanical: false, mount: 'chopper',
    torsoDetail: (b, t, s) => {
      const metal = b.m.get('metal'), prim = b.m.get('primary');
      b.box(0.17 * s, 0.12 * s, 0.025 * s, metal, t, [0.01 * s, 0.13 * s, 0.075 * s], [0, 0, 0.12], 0.006); // welded chest plate
      b.box(0.06 * s, 0.06 * s, 0.026 * s, prim, t, [-0.05 * s, 0.07 * s, 0.085 * s], [0, 0, -0.3], 0.004);
      b.torus(0.12 * s, 0.008 * s, metal, t, [0, 0.06 * s, 0], [Math.PI / 2.4, 0.3, 0]); // chain
      b.box(0.2 * s, 0.03 * s, 0.17 * s, b.m.get('dark'), t, [0, 0, 0], undefined, 0.01);
    },
    shoulders: (b, t, s, pc) => {
      const metal = b.m.get('metal'), prim = b.m.get('primary');
      const big = pc === 'rook' || pc === 'king' ? 1.4 : 1;
      b.sphere(0.055 * s * big, prim, t, [0.13 * s, 0.2 * s, 0], [1, 0.6, 1]);
      b.cone(0.018 * s, 0.09 * s * big, metal, t, [0.15 * s, 0.26 * s, 0], [0, 0, -0.4], 5);
      b.cone(0.018 * s, 0.07 * s * big, metal, t, [0.13 * s, 0.25 * s, 0.03 * s], [0.3, 0, -0.3], 5);
      b.box(0.08 * s, 0.03 * s, 0.09 * s, b.m.get('rubber'), t, [-0.13 * s, 0.2 * s, 0], [0, 0, 0.3], 0.01); // tyre-rubber pad
    },
  },
  vault: {
    head: { pawn: 'bubble', knight: 'bubble', bishop: 'bubble', rook: 'helmet_mask', queen: 'bubble', king: 'bubble' },
    mechanical: false, mount: 'hover',
    torsoDetail: (b, t, s) => {
      const sec = b.m.get('secondary'), glow = b.m.get('accent');
      b.box(0.16 * s, 0.035 * s, 0.03 * s, sec, t, [0, 0.14 * s, 0.072 * s], undefined, 0.01);
      b.cyl(0.022 * s, 0.022 * s, 0.006 * s, glow, t, [0, 0.09 * s, 0.08 * s], [Math.PI / 2, 0, 0], 12);
      b.cyl(0.035 * s, 0.035 * s, 0.16 * s, sec, t, [0.045 * s, 0.14 * s, -0.1 * s], undefined, 10); // air tanks
      b.cyl(0.035 * s, 0.035 * s, 0.16 * s, sec, t, [-0.045 * s, 0.14 * s, -0.1 * s], undefined, 10);
      b.box(0.2 * s, 0.03 * s, 0.17 * s, sec, t, [0, 0, 0], undefined, 0.012);
    },
    shoulders: (b, t, s, pc) => {
      const p = b.m.get('primary');
      const big = pc === 'rook' ? 1.5 : 1;
      b.box(0.08 * s * big, 0.06 * s * big, 0.11 * s * big, p, t, [0.13 * s, 0.2 * s, 0], [0, 0, -0.25], 0.025);
      b.box(0.08 * s * big, 0.06 * s * big, 0.11 * s * big, p, t, [-0.13 * s, 0.2 * s, 0], [0, 0, 0.25], 0.025);
    },
  },
  machines: {
    head: { pawn: 'robot_eye', knight: 'robot_eye', bishop: 'robot_sensor', rook: 'robot_eye', queen: 'robot_sensor', king: 'robot_eye' },
    mechanical: true, mount: 'walker',
    torsoDetail: (b, t, s) => {
      const dark = b.m.get('dark'), glow = b.m.get('accent'), metal = b.m.get('metal');
      b.box(0.1 * s, 0.07 * s, 0.03 * s, dark, t, [0, 0.12 * s, 0.075 * s], undefined, 0.006); // vent grille
      for (let i = 0; i < 3; i++) b.box(0.08 * s, 0.008 * s, 0.032 * s, metal, t, [0, (0.1 + i * 0.02) * s, 0.078 * s], undefined, 0.002);
      b.cyl(0.015 * s, 0.015 * s, 0.01 * s, glow, t, [0.06 * s, 0.17 * s, 0.075 * s], [Math.PI / 2, 0, 0], 8);
      b.box(0.13 * s, 0.13 * s, 0.06 * s, dark, t, [0, 0.12 * s, -0.09 * s], undefined, 0.01); // power pack
      b.cyl(0.012 * s, 0.012 * s, 0.1 * s, metal, t, [0.04 * s, 0.24 * s, -0.1 * s], undefined, 6); // exhaust
    },
    shoulders: (b, t, s) => {
      const metal = b.m.get('metal');
      b.cyl(0.04 * s, 0.04 * s, 0.07 * s, metal, t, [0.12 * s, 0.19 * s, 0], [0, 0, Math.PI / 2], 10);
      b.cyl(0.04 * s, 0.04 * s, 0.07 * s, metal, t, [-0.12 * s, 0.19 * s, 0], [0, 0, Math.PI / 2], 10);
    },
  },
};

// ----------------------------------------------------------------------------- class signatures
function crenellatedCrown(b: Builder, parent: THREE.Object3D, r: number, y: number, h: number, mat: THREE.Material) {
  b.cyl(r, r * 0.95, h * 0.5, mat, parent, [0, y, 0], undefined, 16);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(r * 0.42, h, r * 0.3, mat, parent, [Math.sin(a) * r * 0.85, y + h * 0.55, Math.cos(a) * r * 0.85], [0, a, 0], 0.006);
  }
}

function spikedCoronet(b: Builder, parent: THREE.Object3D, r: number, y: number, mat: THREE.Material, glow: THREE.Material) {
  b.torus(r, r * 0.12, mat, parent, [0, y, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const h = i % 2 === 0 ? r * 1.2 : r * 0.8;
    b.cone(r * 0.16, h, mat, parent, [Math.sin(a) * r, y + h / 2, Math.cos(a) * r], [Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25], 5);
  }
  b.sphere(r * 0.22, glow, parent, [0, y + r * 0.1, r * 0.95]);
}

function crossCrown(b: Builder, parent: THREE.Object3D, r: number, y: number, mat: THREE.Material, glow: THREE.Material) {
  b.cyl(r, r * 0.9, r * 0.6, mat, parent, [0, y, 0], undefined, 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.box(r * 0.25, r * 0.7, r * 0.12, mat, parent, [Math.sin(a) * r * 0.85, y + r * 0.55, Math.cos(a) * r * 0.85], [0, a, 0], 0.004);
  }
  b.box(r * 0.22, r * 1.6, r * 0.22, mat, parent, [0, y + r * 1.2, 0], undefined, 0.005);
  b.box(r * 0.9, r * 0.22, r * 0.22, mat, parent, [0, y + r * 1.45, 0], undefined, 0.005);
  b.sphere(r * 0.18, glow, parent, [0, y + r * 1.45, r * 0.14]);
}

function mitre(b: Builder, parent: THREE.Object3D, r: number, y: number, mat: THREE.Material, glow: THREE.Material, mechanical: boolean) {
  if (mechanical) {
    b.cyl(r * 0.15, r * 0.4, r * 2.6, mat, parent, [0, y + r * 1.3, 0], undefined, 6); // sensor mast
    b.cyl(r * 0.5, r * 0.5, r * 0.08, mat, parent, [0, y + r * 1.9, 0], undefined, 10);
    b.sphere(r * 0.2, glow, parent, [0, y + r * 2.7, 0]);
    return;
  }
  const g = b.cone(r, r * 2.4, mat, parent, [0, y + r * 1.15, 0], undefined, 4);
  g.rotation.y = Math.PI / 4;
  g.scale.set(1, 1, 0.55);
  b.box(r * 0.1, r * 1.6, r * 0.04, glow, parent, [0, y + r * 1.0, r * 0.32], undefined, 0.002); // slit
}

function cape(b: Builder, torso: THREE.Group, s: number, len: number) {
  const cloth = b.m.get('cloth');
  const c = b.box(0.22 * s, len, 0.02 * s, cloth, torso, [0, 0.22 * s - len / 2, -0.095 * s], [0.12, 0, 0], 0.008);
  c.scale.x = 1;
  return c;
}

// ----------------------------------------------------------------------------- mounts (knights)
function buildMount(b: Builder, root: THREE.Group, kind: FactionKit['mount'], s: number) {
  const mount = b.group(root, [0, 0, 0], 'mount');
  const prim = b.m.get('primary'), dark = b.m.get('dark'), metal = b.m.get('metal'), rub = b.m.get('rubber'), glow = b.m.get('glow');
  if (kind === 'bike' || kind === 'chopper') {
    const chop = kind === 'chopper';
    const wheelR = 0.075 * s;
    for (const z of [-0.17, 0.19]) {
      const wz = (chop && z > 0 ? z + 0.05 : z) * s;
      const w = b.torus(wheelR * 0.8, wheelR * 0.32, rub, mount, [0, wheelR, wz], [0, Math.PI / 2, 0]);
      w.name = 'wheel';
      b.cyl(wheelR * 0.4, wheelR * 0.4, 0.03 * s, metal, mount, [0, wheelR, wz], [0, 0, Math.PI / 2], 8);
    }
    b.box(0.07 * s, 0.07 * s, 0.3 * s, prim, mount, [0, 0.15 * s, 0.0], [0.08, 0, 0], 0.02); // frame/tank
    b.box(0.08 * s, 0.05 * s, 0.12 * s, dark, mount, [0, 0.17 * s, -0.12 * s], undefined, 0.015); // seat
    b.box(0.09 * s, 0.09 * s, 0.07 * s, prim, mount, [0, 0.2 * s, 0.2 * s], [-0.4, 0, 0], 0.02); // fairing ("horse head")
    b.sphere(0.022 * s, glow, mount, [0, 0.21 * s, 0.24 * s]);
    b.cyl(0.008 * s, 0.008 * s, 0.2 * s, metal, mount, [0, 0.27 * s, 0.17 * s], [0, 0, Math.PI / 2], 6); // bars
    if (chop) {
      for (const x of [-1, 1]) b.cone(0.015 * s, 0.1 * s, metal, mount, [x * 0.05 * s, 0.22 * s, 0.24 * s], [Math.PI / 2.5, 0, 0], 5);
      b.sphere(0.035 * s, b.m.get('secondary'), mount, [0, 0.27 * s, 0.24 * s]); // skull ornament
      b.cyl(0.014 * s, 0.014 * s, 0.2 * s, metal, mount, [0.05 * s, 0.1 * s, -0.18 * s], [Math.PI / 2.2, 0, 0], 6); // exhaust
    }
  } else if (kind === 'walker') {
    // Raptor-style walker: horse-like neck + head reads unmistakably as a knight.
    b.box(0.13 * s, 0.1 * s, 0.26 * s, prim, mount, [0, 0.2 * s, 0], undefined, 0.025);
    for (const [x, z] of [[0.06, 0.08], [-0.06, 0.08], [0.06, -0.09], [-0.06, -0.09]]) {
      const leg = b.group(mount, [x * s, 0.18 * s, z * s], 'leg');
      b.box(0.03 * s, 0.11 * s, 0.03 * s, metal, leg, [0, -0.05 * s, 0], [0.3, 0, 0], 0.006);
      b.box(0.025 * s, 0.1 * s, 0.025 * s, dark, leg, [0, -0.13 * s, 0.02 * s], [-0.3, 0, 0], 0.006);
    }
    const neck = b.group(mount, [0, 0.24 * s, 0.12 * s], 'neck');
    b.box(0.06 * s, 0.18 * s, 0.06 * s, prim, neck, [0, 0.07 * s, 0.03 * s], [0.5, 0, 0], 0.015);
    b.box(0.07 * s, 0.07 * s, 0.15 * s, prim, neck, [0, 0.16 * s, 0.1 * s], [0.25, 0, 0], 0.02);
    b.sphere(0.018 * s, glow, neck, [0.03 * s, 0.17 * s, 0.15 * s]);
    b.sphere(0.018 * s, glow, neck, [-0.03 * s, 0.17 * s, 0.15 * s]);
    b.box(0.015 * s, 0.06 * s, 0.1 * s, metal, neck, [0, 0.22 * s, 0.05 * s], [0.3, 0, 0], 0.004); // crest
  } else {
    // Hover sled with fins.
    b.box(0.16 * s, 0.06 * s, 0.34 * s, prim, mount, [0, 0.14 * s, 0], undefined, 0.03);
    b.box(0.12 * s, 0.02 * s, 0.3 * s, glow, mount, [0, 0.1 * s, 0], undefined, 0.008);
    b.box(0.12 * s, 0.1 * s, 0.08 * s, prim, mount, [0, 0.2 * s, 0.17 * s], [-0.5, 0, 0], 0.02);
    for (const x of [-1, 1]) b.box(0.01 * s, 0.08 * s, 0.1 * s, b.m.get('secondary'), mount, [x * 0.085 * s, 0.17 * s, -0.14 * s], [0.4, 0, 0], 0.004);
  }
  return mount;
}

// ----------------------------------------------------------------------------- shared pedestal
/** Pedestal used under every piece (procedural or GLB): base disc, team rim, engraved class glyph. */
export function buildPedestal(pc: PieceClass, side: Color, baseColor: THREE.ColorRepresentation): { group: THREE.Group; emissive: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  group.name = 'base';
  const baseMat = new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.6, roughness: 0.55, roughnessMap: grimeTexture(256, 3) });
  const disc = new THREE.Mesh(cachedGeo('pedestal', () => new THREE.CylinderGeometry(0.36, 0.385, 0.05, 28)), baseMat);
  disc.position.y = 0.025; disc.castShadow = true; disc.receiveShadow = true;
  group.add(disc);
  const rimMat = new THREE.MeshStandardMaterial({ color: TEAM_RIM[side], emissive: TEAM_RIM[side], emissiveIntensity: side === 'w' ? 0.55 : 0.9, roughness: 0.4, metalness: 0.5 });
  rimMat.userData.baseEmissive = rimMat.emissiveIntensity;
  const rim = new THREE.Mesh(cachedGeo('rim', () => new THREE.TorusGeometry(0.37, 0.012, 8, 40)), rimMat);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.05;
  group.add(rim);
  const glyph = new THREE.Mesh(cachedGeo('glyphdisc', () => new THREE.CircleGeometry(0.12, 24)), new THREE.MeshBasicMaterial({ map: glyphTexture(GLYPHS[pc], side === 'w' ? '#f6e7c8' : '#ffb3a8'), transparent: true, depthWrite: false }));
  glyph.rotation.set(-Math.PI / 2, 0, Math.PI);
  glyph.position.set(0, 0.052, -0.245);
  group.add(glyph);
  return { group, emissive: [rimMat] };
}

// ----------------------------------------------------------------------------- the build
interface ClassShape { scale: number; torsoW: number; torsoH: number; legH: number; bulk: number }
const SHAPES: Record<PieceClass, ClassShape> = {
  pawn: { scale: 0.86, torsoW: 1, torsoH: 1, legH: 1, bulk: 1 },
  knight: { scale: 1, torsoW: 1, torsoH: 1, legH: 0.7, bulk: 1 },
  bishop: { scale: 1.02, torsoW: 0.92, torsoH: 1.15, legH: 1.1, bulk: 0.9 },
  rook: { scale: 1.02, torsoW: 1.35, torsoH: 1.0, legH: 0.85, bulk: 1.45 },
  queen: { scale: 1.1, torsoW: 0.95, torsoH: 1.1, legH: 1.15, bulk: 1 },
  king: { scale: 1.2, torsoW: 1.15, torsoH: 1.1, legH: 1.05, bulk: 1.2 },
};

export function buildProceduralPiece(faction: BuiltinFactionId, pc: PieceClass, side: Color): PieceRig {
  const fdef = FACTIONS[faction];
  const kit = KITS[faction];
  const mats = new Mats(teamPalette(faction, side), fdef.material);
  const b = new Builder(mats);
  const shape = SHAPES[pc];
  const s = shape.scale;
  const prim = mats.get('primary'), sec = mats.get('secondary'), dark = mats.get('dark'), metal = mats.get('metal'), glow = mats.get('glow');

  const root = new THREE.Group();
  root.name = `${faction}_${pc}_${side}`;

  // ---------------------------------------------------------------- base pedestal (stays upright on death)
  const base = b.group(root, [0, 0, 0], 'base');
  const baseMat = mats.get('base');
  b.breakables = [];
  b.cyl(0.36, 0.385, 0.05, baseMat, base, [0, 0.025, 0], undefined, 28);
  const rimMat = new THREE.MeshStandardMaterial({ color: TEAM_RIM[side], emissive: TEAM_RIM[side], emissiveIntensity: side === 'w' ? 0.55 : 0.9, roughness: 0.4, metalness: 0.5 });
  rimMat.userData.baseEmissive = rimMat.emissiveIntensity;
  mats.emissive.push(rimMat);
  b.torus(0.37, 0.012, rimMat, base, [0, 0.05, 0], [Math.PI / 2, 0, 0]);
  const glyph = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ map: glyphTexture(GLYPHS[pc], side === 'w' ? '#f6e7c8' : '#ffb3a8'), transparent: true, depthWrite: false }));
  glyph.rotation.set(-Math.PI / 2, 0, Math.PI);
  glyph.position.set(0, 0.052, -0.245);
  base.add(glyph);
  const baseBreakables: THREE.Mesh[] = [];

  // ---------------------------------------------------------------- body
  const body = b.group(root, [0, 0.05, 0], 'body');
  b.breakables = [];
  const isRider = pc === 'knight';
  const isTank = kit.mechanical && pc === 'rook';
  let mount: THREE.Group | null = null;
  const legLen = 0.17 * s * shape.legH;
  const hipY = isRider ? 0.2 * s : isTank ? 0.16 * s : legLen + 0.02 * s;

  if (isRider) mount = buildMount(b, body, kit.mount, s);

  const pelvis = b.group(body, [0, hipY, isRider ? -0.06 * s : 0], 'pelvis');
  const legL = b.group(pelvis, [0.05 * s * shape.torsoW, 0, 0], 'legL');
  const legR = b.group(pelvis, [-0.05 * s * shape.torsoW, 0, 0], 'legR');

  if (isTank) {
    // Excavator chassis: treads + hull. Crenellated turret crown on top keeps it a rook.
    for (const x of [-1, 1]) {
      const tr = b.box(0.09 * s, 0.11 * s, 0.42 * s, mats.get('rubber'), body, [x * 0.15 * s, 0.06 * s, 0], undefined, 0.04);
      tr.name = 'tread';
      for (let i = 0; i < 4; i++) b.cyl(0.035 * s, 0.035 * s, 0.095 * s, metal, body, [x * 0.15 * s, 0.06 * s, (-0.15 + i * 0.1) * s], [0, 0, Math.PI / 2], 10);
    }
    b.box(0.26 * s, 0.08 * s, 0.38 * s, prim, body, [0, 0.13 * s, 0], undefined, 0.03);
  } else {
    for (const [leg, x] of [[legL, 1], [legR, -1]] as const) {
      const thigh = kit.mechanical ? metal : dark;
      b.box(0.055 * s * shape.bulk, legLen * 0.55, 0.06 * s * shape.bulk, thigh, leg, [0, -legLen * 0.27, 0], undefined, 0.015);
      b.box(0.05 * s * shape.bulk, legLen * 0.5, 0.055 * s * shape.bulk, kit.mechanical ? prim : sec, leg, [0, -legLen * 0.7, 0], undefined, 0.015);
      b.box(0.06 * s * shape.bulk, 0.035 * s, 0.09 * s, dark, leg, [0, -legLen + 0.015 * s, 0.015 * s], undefined, 0.012); // boot
      if (kit.mechanical) b.cyl(0.02 * s, 0.02 * s, 0.065 * s, dark, leg, [0, -legLen * 0.5, 0], [0, 0, Math.PI / 2], 8); // knee joint
      void x;
    }
    if (isRider) { legL.rotation.x = -1.2; legR.rotation.x = -1.2; }
  }

  const torso = b.group(pelvis, [0, 0.02 * s, 0], 'torso');
  const tw = 0.2 * s * shape.torsoW, th = 0.22 * s * shape.torsoH;
  if (isTank) {
    // Turret
    b.cyl(0.13 * s, 0.15 * s, 0.12 * s, prim, torso, [0, 0.08 * s, 0], undefined, 12);
  } else if (pc === 'bishop' && !kit.mechanical) {
    // Robes flare out — narrow, tall silhouette.
    b.cyl(0.07 * s, 0.13 * s, th * 1.25, mats.get('cloth'), torso, [0, th * 0.35, 0], undefined, 12);
    b.box(tw * 0.85, th * 0.5, 0.13 * s, prim, torso, [0, th * 0.75, 0], undefined, 0.03);
  } else {
    b.box(tw, th * 0.6, 0.14 * s * shape.bulk, prim, torso, [0, th * 0.62, 0], undefined, 0.035);
    b.box(tw * 0.8, th * 0.45, 0.12 * s * shape.bulk, kit.mechanical ? dark : sec, torso, [0, th * 0.2, 0], undefined, 0.03);
  }
  kit.torsoDetail(b, torso, s * (isTank ? 1.2 : 1), pc);
  if (!isTank) kit.shoulders(b, torso, s * shape.torsoW, pc);
  if ((pc === 'queen' || pc === 'king') && !kit.mechanical) cape(b, torso, s, (pc === 'king' ? 0.36 : 0.3) * s);

  const neckY = isTank ? 0.16 * s : th * 0.95;
  const head = b.group(torso, [0, neckY, isTank ? 0.03 * s : 0], 'head');
  buildHead(b, head, kit.head[pc], s * (pc === 'pawn' ? 1 : 1.05));
  if (isTank) {
    // Pile-driver arm doubles as weapon mount.
    b.box(0.06 * s, 0.06 * s, 0.24 * s, metal, torso, [0, 0.1 * s, 0.17 * s], undefined, 0.01);
  }

  // Arms (pivot at shoulder, hang along -y).
  const armLen = 0.2 * s * (pc === 'rook' ? 1.1 : 1);
  const shoulderY = isTank ? 0.11 * s : th * 0.82;
  const shoulderX = isTank ? 0.15 * s : tw * 0.62;
  const armL = b.group(torso, [shoulderX, shoulderY, 0], 'armL');
  const armR = b.group(torso, [-shoulderX, shoulderY, 0], 'armR');
  for (const arm of [armL, armR]) {
    const upper = kit.mechanical ? metal : prim;
    b.box(0.05 * s * shape.bulk, armLen * 0.55, 0.05 * s * shape.bulk, upper, arm, [0, -armLen * 0.27, 0], undefined, 0.014);
    b.box(0.045 * s * shape.bulk, armLen * 0.5, 0.045 * s * shape.bulk, kit.mechanical ? prim : sec, arm, [0, -armLen * 0.72, 0], undefined, 0.012);
    b.sphere(0.028 * s * shape.bulk, kit.mechanical ? metal : dark, arm, [0, -armLen, 0]);
  }
  const handR = b.group(armR, [0, -armLen, 0.01 * s], 'handR');
  const weapon = buildWeapon(b, fdef.pieces[pc].weapon, handR, 0.22 * s);
  // Rest pose: arms slightly forward, weapon arm carrying.
  armR.rotation.x = -0.35;
  armL.rotation.x = -0.15;
  if (pc === 'rook' && faction === 'wastelanders') {
    // Road-sign shield: octagonal STOP sign — iconic and reads at distance.
    const handL = b.group(armL, [0.02 * s, -armLen * 0.7, 0.04 * s]);
    const sign = b.cyl(0.11 * s, 0.11 * s, 0.015 * s, new THREE.MeshStandardMaterial({ color: '#8e1a14', roughness: 0.6, metalness: 0.4 }), handL, [0, 0, 0.03 * s], [Math.PI / 2, 0, Math.PI / 8], 8);
    sign.name = 'shield';
  }

  // ---------------------------------------------------------------- class signatures (silhouette)
  const headTop = isTank ? 0.2 * s : 0.19 * s;
  if (pc === 'rook') {
    if (isTank) crenellatedCrown(b, torso, 0.13 * s, 0.16 * s, 0.06 * s, prim);
    else crenellatedCrown(b, torso, 0.12 * s * shape.torsoW, th * 1.02, 0.05 * s, prim); // armoured gorget ring around the head
  } else if (pc === 'bishop') {
    mitre(b, head, 0.06 * s, headTop * 0.55, kit.mechanical ? metal : prim, glow, kit.mechanical);
  } else if (pc === 'queen') {
    spikedCoronet(b, head, 0.07 * s, headTop * 0.8, kit.mechanical ? metal : mats.get('accent'), glow);
  } else if (pc === 'king') {
    crossCrown(b, head, 0.065 * s, headTop * 0.8, kit.mechanical ? metal : mats.get('accent'), glow);
  }

  // Normalise to the faction's height budget and measure.
  const scale = fdef.pieces[pc].scale / s;
  body.scale.setScalar(scale * 1.9);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const rig: PieceRig = {
    root, base, body, pelvis, torso, head, armL, armR, legL, legR, mount, weapon,
    breakables: [...b.breakables, ...baseBreakables], emissive: mats.emissive, height: box.max.y,
    kind: isRider ? 'rider' : isTank ? 'tracked' : 'biped', mechanical: kit.mechanical, armLength: armLen,
  };
  // Remember rest pose for every animated part.
  for (const part of [pelvis, torso, head, armL, armR, legL, legR, body]) {
    part.userData.rest = { p: part.position.clone(), r: part.rotation.clone() };
  }
  return rig;
}
