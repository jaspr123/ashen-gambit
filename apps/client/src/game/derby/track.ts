// Wasteland Derby track: geometry helpers (lap position + lateral offset ->
// world pose) and the procedural racecourse — dirt oval, rails, grandstand,
// start stalls, finish gantry, floodlights and Synty set dressing.

import * as THREE from 'three';
import { TRACK, TRACK_LAP } from '@ashen/shared';
import { AssetManager } from '../AssetManager';
import { concreteTexture, hazardTexture, skyTexture, steelPlateTexture } from '../textures';

const { straight: L, radius: R } = TRACK;
const BEND = Math.PI * R;
/** Lateral extent of the racing surface (inner rail at 0). */
export const TRACK_WIDTH = TRACK.laneWidth * TRACK.lanes + 1.2;

export interface Pose { x: number; z: number; /** Unit direction of travel. */ dx: number; dz: number; /** Unit outward normal (away from the infield). */ nx: number; nz: number }

/** World pose at lap position `q` (along the rail line) and lateral offset `lat` (outward from the rail). */
export function trackPose(q: number, lat: number, out: Pose = { x: 0, z: 0, dx: 1, dz: 0, nx: 0, nz: 1 }): Pose {
  let p = ((q % TRACK_LAP) + TRACK_LAP) % TRACK_LAP;
  const r = R + lat;
  if (p < L) { // home straight, in front of the stands (+z), running +x
    out.x = -L / 2 + p; out.z = r; out.dx = 1; out.dz = 0; out.nx = 0; out.nz = 1; return out;
  }
  p -= L;
  if (p < BEND) { // bend 1 around (+L/2, 0)
    const th = Math.PI / 2 - p / R;
    out.x = L / 2 + r * Math.cos(th); out.z = r * Math.sin(th);
    out.nx = Math.cos(th); out.nz = Math.sin(th); out.dx = Math.sin(th); out.dz = -Math.cos(th); return out;
  }
  p -= BEND;
  if (p < L) { // back straight, running -x
    out.x = L / 2 - p; out.z = -r; out.dx = -1; out.dz = 0; out.nx = 0; out.nz = -1; return out;
  }
  p -= L;
  const th = -Math.PI / 2 - p / R; // bend 2 around (-L/2, 0)
  out.x = -L / 2 + r * Math.cos(th); out.z = r * Math.sin(th);
  out.nx = Math.cos(th); out.nz = Math.sin(th); out.dx = Math.sin(th); out.dz = -Math.cos(th); return out;
}

/** A closed ribbon following the track between two lateral offsets. */
function ribbon(lat0: number, lat1: number, y: number, segs = 360, vRepeat = 1): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const a = { x: 0, z: 0, dx: 0, dz: 0, nx: 0, nz: 0 }, b = { ...a };
  for (let i = 0; i <= segs; i++) {
    const q = (i / segs) * TRACK_LAP;
    trackPose(q, lat0, a); trackPose(q, lat1, b);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    const v = (q / TRACK_LAP) * vRepeat;
    uv.push(0, v, 1, v);
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function dirtTexture(seed = 7): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6e5038'; g.fillRect(0, 0, 256, 1024);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = 70 + rnd() * 60;
    g.fillStyle = `rgba(${v + 30},${v + 5},${v - 20},${0.15 + rnd() * 0.2})`;
    g.fillRect(rnd() * 256, rnd() * 1024, 1 + rnd() * 3, 1 + rnd() * 5);
  }
  // Hoof-churned racing lines.
  for (let l = 0; l < 8; l++) {
    const x = 18 + l * 29;
    g.strokeStyle = 'rgba(40,26,16,0.25)'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 32) g.lineTo(x + Math.sin(y * 0.02 + l) * 3, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#f2ead8' : '#151210'; g.fillRect(i * 16, j * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function textSprite(text: string, opts: { color?: string; bg?: string; size?: number; font?: string } = {}): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = opts.font ?? `700 44px Oswald, Arial Narrow, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = 64;
  g.font = font;
  g.fillStyle = opts.bg ?? 'rgba(12,10,8,0.82)';
  g.beginPath(); g.roundRect(0, 0, w, 64, 12); g.fill();
  g.fillStyle = opts.color ?? '#f2e6cc';
  g.textBaseline = 'middle';
  g.fillText(text, 18, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const h = opts.size ?? 0.42;
  sp.scale.set((h * w) / 64, h, 1);
  sp.renderOrder = 10;
  return sp;
}

export interface BuiltTrack {
  group: THREE.Group;
  /** Start stall doors; rotate open at the off. */
  gates: THREE.Object3D[];
  /** The whole stall unit (towed off the course after the start). */
  stalls: THREE.Group;
  crowd: THREE.InstancedMesh;
  floodlights: THREE.SpotLight[];
  sky: THREE.Texture;
}

export function buildTrack(): BuiltTrack {
  const group = new THREE.Group();
  group.name = 'derby-track';
  const shadow = (m: THREE.Mesh, cast = true) => { m.castShadow = cast; m.receiveShadow = true; return m; };

  // ---- wasteland ground
  const groundTex = concreteTexture(512, 11, '#5a4a38');
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(40, 40);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(320, 64), new THREE.MeshStandardMaterial({ map: groundTex, color: '#8a7058', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- racing surface + verges
  const dirt = new THREE.Mesh(ribbon(-0.4, TRACK_WIDTH, 0, 400, 14), new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 0.95 }));
  group.add(shadow(dirt, false));
  const verge = new THREE.MeshStandardMaterial({ color: '#4a4430', roughness: 1 });
  group.add(shadow(new THREE.Mesh(ribbon(TRACK_WIDTH, TRACK_WIDTH + 2.2, -0.005), verge), false));
  // Infield: a stadium-shaped patch of dead grass with a drainage pond.
  const infield = new THREE.Shape();
  const ir = R - 0.45;
  infield.moveTo(-L / 2, -ir); infield.lineTo(L / 2, -ir);
  infield.absarc(L / 2, 0, ir, -Math.PI / 2, Math.PI / 2, false);
  infield.lineTo(-L / 2, ir);
  infield.absarc(-L / 2, 0, ir, Math.PI / 2, Math.PI * 1.5, false);
  const inf = new THREE.Mesh(new THREE.ShapeGeometry(infield, 48), new THREE.MeshStandardMaterial({ color: '#4c4a2c', roughness: 1 }));
  inf.rotation.x = -Math.PI / 2; inf.position.y = -0.01;
  group.add(shadow(inf, false));
  const pond = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshStandardMaterial({ color: '#2a3a2a', roughness: 0.15, metalness: 0.3, emissive: '#183018', emissiveIntensity: 0.5 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(-10, 0.005, -3); pond.scale.set(1.6, 1, 1);
  group.add(pond);

  // ---- rails (white-painted scrap posts + rail)
  const railMat = new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.6, metalness: 0.2 });
  const postGeo = new THREE.BoxGeometry(0.08, 0.7, 0.08);
  for (const lat of [-0.35, TRACK_WIDTH + 0.05]) {
    const pts: THREE.Vector3[] = [];
    const p = { x: 0, z: 0, dx: 0, dz: 0, nx: 0, nz: 0 };
    for (let i = 0; i < 240; i++) { trackPose((i / 240) * TRACK_LAP, lat, p); pts.push(new THREE.Vector3(p.x, 0.68, p.z)); }
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 480, 0.05, 6, true), railMat);
    group.add(shadow(rail));
    const posts = new THREE.InstancedMesh(postGeo, railMat, Math.floor(TRACK_LAP / 2.2));
    const m = new THREE.Matrix4();
    for (let i = 0; i < posts.count; i++) { trackPose(i * 2.2, lat, p); m.makeTranslation(p.x, 0.35, p.z); posts.setMatrixAt(i, m); }
    posts.castShadow = true;
    group.add(posts);
  }

  // ---- finish gantry (checkered beam across the track)
  const fp = trackPose(TRACK.finishAt, 0);
  const steel = new THREE.MeshStandardMaterial({ map: steelPlateTexture(256, 4), color: '#77706a', roughness: 0.5, metalness: 0.6 });
  const gantry = new THREE.Group();
  gantry.position.set(fp.x, 0, R);
  for (const lat of [-0.9, TRACK_WIDTH + 0.6]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 0.3), steel);
    pole.position.set(0, 2.3, lat); // gantry space: +z is outward on the home straight
    gantry.add(shadow(pole));
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, TRACK_WIDTH + 2.2), [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 })]);
  beam.position.set(0, 4.4, TRACK_WIDTH / 2 - 0.15);
  gantry.add(shadow(beam));
  const finishSprite = textSprite('FINISH', { color: '#ffd27a', size: 0.9 });
  finishSprite.position.set(0, 5.4, TRACK_WIDTH / 2);
  gantry.add(finishSprite);
  group.add(gantry);
  // Painted finish line.
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.25, TRACK_WIDTH + 0.4), new THREE.MeshBasicMaterial({ color: '#f2ead8' }));
  line.rotation.x = -Math.PI / 2; line.position.set(fp.x, 0.012, R + TRACK_WIDTH / 2 - 0.2);
  group.add(line);

  // ---- start stalls across the track at the start position
  const sp = trackPose(TRACK.startAt, 0);
  const stalls = new THREE.Group();
  stalls.position.set(sp.x, 0, R);
  const stallMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.3 });
  const gates: THREE.Object3D[] = [];
  for (let i = 0; i <= TRACK.lanes; i++) {
    const z = 0.5 - TRACK.laneWidth / 2 + i * TRACK.laneWidth;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 0.08), steel);
    wall.position.set(-0.2, 0.75, z);
    stalls.add(shadow(wall));
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, TRACK.lanes * TRACK.laneWidth + 0.2), stallMat);
  top.position.set(-0.2, 1.6, 0.5 + (TRACK.lanes - 1) * TRACK.laneWidth / 2);
  stalls.add(shadow(top));
  for (let i = 0; i < TRACK.lanes; i++) {
    const hinge = new THREE.Group();
    hinge.position.set(0.5, 1.45, 0.5 - TRACK.laneWidth / 2 + i * TRACK.laneWidth + 0.04);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, TRACK.laneWidth - 0.1), stallMat);
    door.position.set(0, -0.65, TRACK.laneWidth / 2 - 0.05);
    hinge.add(shadow(door));
    stalls.add(hinge);
    gates.push(hinge);
    const num = textSprite(String(i + 1), { size: 0.36, color: '#ffd27a' });
    num.position.set(0.55, 1.85, 0.5 + i * TRACK.laneWidth);
    stalls.add(num);
  }
  group.add(stalls);

  // ---- grandstand along the home straight
  const standZ = R + TRACK_WIDTH + 4.5;
  const stand = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(256, 5, '#8a8276'), roughness: 0.9 });
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(L + 6, 0.45 + t * 0.6, 1.1), concrete);
    step.position.set(0, (0.45 + t * 0.6) / 2, standZ + t * 1.1);
    stand.add(shadow(step));
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(L + 6, 7.5, 0.4), concrete);
  back.position.set(0, 3.75, standZ + tiers * 1.1 + 0.2);
  stand.add(shadow(back));
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 7, 0.25, tiers * 1.1 + 2.5), steel);
  roof.position.set(0, 7.6, standZ + tiers * 1.1 / 2 - 0.4);
  roof.rotation.x = -0.06;
  stand.add(shadow(roof));
  for (let i = 0; i <= 6; i++) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7.6, 0.3), steel);
    col.position.set(-L / 2 - 2 + i * ((L + 4) / 6), 3.8, standZ - 0.6);
    stand.add(shadow(col));
  }
  // Crowd: instanced punters with random rags.
  const crowdCount = 520;
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.62, 0.26), new THREE.MeshStandardMaterial({ roughness: 0.9 }), crowdCount);
  const cm = new THREE.Matrix4(), col = new THREE.Color();
  const palette = ['#6a5040', '#8a7a60', '#40505a', '#7a3a2a', '#5a5a40', '#a08050', '#303030', '#8a8a80'];
  for (let i = 0; i < crowdCount; i++) {
    const t = i % tiers;
    const x = -L / 2 - 2 + Math.random() * (L + 4);
    cm.makeTranslation(x, 0.45 + t * 0.6 + 0.31, standZ + t * 1.1 + (Math.random() - 0.5) * 0.3);
    crowd.setMatrixAt(i, cm);
    crowd.setColorAt(i, col.set(palette[Math.floor(Math.random() * palette.length)]));
  }
  crowd.castShadow = true;
  crowd.userData.base = Array.from({ length: crowdCount }, (_, i) => { crowd.getMatrixAt(i, cm); return new THREE.Vector3().setFromMatrixPosition(cm); });
  stand.add(crowd);
  const banner = textSprite('WASTELAND DERBY', { color: '#ffb347', size: 1.6, bg: 'rgba(20,14,10,0.9)' });
  banner.position.set(0, 9.2, standZ + 2);
  (banner.material as THREE.SpriteMaterial).depthTest = true;
  stand.add(banner);
  group.add(stand);

  // ---- infield tote board facing the stands
  const tote = new THREE.Mesh(new THREE.BoxGeometry(14, 4.2, 0.4), new THREE.MeshStandardMaterial({ color: '#1a1814', emissive: '#ff9a40', emissiveIntensity: 0.12, roughness: 0.5 }));
  tote.position.set(8, 3.4, 6);
  group.add(shadow(tote));
  for (const x of [2, 14]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.3), steel); leg.position.set(x, 0.7, 6); group.add(shadow(leg)); }

  // ---- floodlight towers
  const floodlights: THREE.SpotLight[] = [];
  for (const [x, z] of [[-L / 2 - R - 8, R + 10], [L / 2 + R + 8, R + 10], [-L / 2 - R - 8, -R - 10], [L / 2 + R + 8, -R - 10]]) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.5, 16, 0.5), steel);
    mast.position.set(x, 8, z);
    group.add(shadow(mast));
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.6), new THREE.MeshStandardMaterial({ color: '#2a2622', emissive: '#ffe2b0', emissiveIntensity: 2.2 }));
    head.position.set(x, 16.4, z);
    head.lookAt(0, 0, 0);
    group.add(head);
    const spot = new THREE.SpotLight('#ffe2c0', 260, 120, 0.75, 0.6, 1.6);
    spot.position.set(x, 16, z);
    spot.target.position.set(x * 0.3, 0, z * 0.2);
    group.add(spot, spot.target);
    floodlights.push(spot);
  }

  const sky = skyTexture('#1c1410', '#7a4a28', '#ffb060');
  void decorate(group);
  return { group, gates, stalls, crowd, floodlights, sky };
}

/** Synty wrecks and ruins around the course (when the environment pack is built). */
async function decorate(group: THREE.Group) {
  try {
    const manifest = await AssetManager.loadManifest();
    const env = manifest?.environment;
    if (!env) return;
    const gltf = await AssetManager.load(`/assets/${env.file}`);
    const byCat = (c: string) => env.props.filter((p) => p.startsWith(c + ':')).map((p) => p.split(':')[1]);
    let s = 1234;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const place = (names: string[], count: number, spot: () => [number, number] | null, scale: [number, number], faceCentre = false) => {
      if (!names.length) return;
      for (let i = 0, guard = 0; i < count && guard < count * 8; guard++) {
        const at = spot();
        if (!at) continue;
        const node = gltf.scene.getObjectByName(names[Math.floor(rnd() * names.length)]);
        if (!node) continue;
        const c = node.clone(true);
        c.position.set(at[0], 0, at[1]);
        c.rotation.y = faceCentre ? Math.atan2(-at[0], -at[1]) + (rnd() - 0.5) * 0.5 : rnd() * Math.PI * 2;
        c.scale.multiplyScalar(scale[0] + rnd() * (scale[1] - scale[0]));
        c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        group.add(c);
        i++;
      }
    };
    // Skyline of ruins well outside the course; keep the grandstand side open behind the stand only.
    place(byCat('building'), 30, () => { const a = rnd() * Math.PI * 2, d = 82 + rnd() * 60; const x = Math.cos(a) * d * 1.25, z = Math.sin(a) * d; return [x, z]; }, [1.2, 1.9], true);
    // Wrecks parked in the infield and beyond the back straight.
    place(byCat('vehicle'), 7, () => { const x = (rnd() - 0.5) * (L + 6), z = (rnd() - 0.5) * (2 * R - 12); return Math.hypot(x + 10, z + 3) < 9 || Math.hypot(x - 8, z - 6) < 9 ? null : [x, z]; }, [1.0, 1.2]);
    place(byCat('vehicle'), 9, () => [(rnd() - 0.5) * (L + 2 * R + 30), -(R + TRACK_WIDTH + 6 + rnd() * 14)], [1.0, 1.3]);
    place(byCat('prop'), 40, () => { const a = rnd() * Math.PI * 2; const d = R + TRACK_WIDTH + 3 + rnd() * 10; const x = Math.cos(a) * (d + L / 2), z = Math.sin(a) * d; return z > R + TRACK_WIDTH && Math.abs(x) < L / 2 + 4 ? null : [x, z]; }, [1.0, 1.6]);
  } catch (e) {
    console.warn('[derby] environment pack unavailable', e);
  }
}
