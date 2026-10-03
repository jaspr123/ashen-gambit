// The physical chessboard: a reinforced concrete-and-steel platform. Squares
// alternate pale poured concrete and dark tread plate (high contrast so the
// game stays readable); a hazard-striped steel frame with engraved file/rank
// labels and lamp pylons surrounds it; a chipped slab and pylons hold it up.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { concreteTexture, grimeTexture, hazardTexture, labelTexture, steelPlateTexture } from './textures';

export interface BoardBuild {
  group: THREE.Group;
  pickPlane: THREE.Mesh;
  lamps: THREE.PointLight[];
  labels: THREE.Mesh[];
}

export function buildBoard(texSize: number, detail: number): BoardBuild {
  const group = new THREE.Group();
  group.name = 'board';

  // ---------------------------------------------------------------- squares
  const sqGeo = new RoundedBoxGeometry(0.985, 0.08, 0.985, 2, 0.012);
  const lightMats = [1, 2, 3, 4].map((seed) => new THREE.MeshStandardMaterial({ map: concreteTexture(texSize, seed, '#b0a594'), roughness: 0.92, metalness: 0.02, roughnessMap: grimeTexture(256, seed + 10) }));
  const darkMats = [5, 6, 7, 8].map((seed) => new THREE.MeshStandardMaterial({ map: steelPlateTexture(texSize, seed, '#3a3530'), roughness: 0.55, metalness: 0.7, roughnessMap: grimeTexture(256, seed + 20) }));
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const light = (f + r) % 2 === 1;
    const mats = light ? lightMats : darkMats;
    const m = new THREE.Mesh(sqGeo, mats[(f * 7 + r * 3) % 4]);
    m.position.set(f - 3.5, -0.04 + (light ? 0 : -0.004), 3.5 - r);
    m.rotation.y = ((f * 3 + r) % 4) * (Math.PI / 2);
    m.receiveShadow = true;
    group.add(m);
  }
  // Grout bed under the squares.
  const grout = new THREE.Mesh(new THREE.BoxGeometry(8.04, 0.06, 8.04), new THREE.MeshStandardMaterial({ color: '#16130f', roughness: 1 }));
  grout.position.y = -0.07;
  grout.receiveShadow = true;
  group.add(grout);

  // ---------------------------------------------------------------- frame
  const frameMat = new THREE.MeshStandardMaterial({ map: steelPlateTexture(512, 31, '#2c2925'), metalness: 0.75, roughness: 0.5 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(256), roughness: 0.7, metalness: 0.3 });
  const W = 8.04, B = 0.7;
  for (const [x, z, w, d] of [[0, W / 2 + B / 2, W + B * 2, B], [0, -W / 2 - B / 2, W + B * 2, B], [W / 2 + B / 2, 0, B, W], [-W / 2 - B / 2, 0, B, W]] as const) {
    const beam = new THREE.Mesh(new RoundedBoxGeometry(w, 0.22, d, 2, 0.03), frameMat);
    beam.position.set(x, -0.05, z);
    beam.castShadow = true; beam.receiveShadow = true;
    group.add(beam);
  }
  // Hazard band along the inner edge.
  for (const [x, z, w, d, rot] of [[0, W / 2 + 0.07, W + 0.28, 0.12, 0], [0, -W / 2 - 0.07, W + 0.28, 0.12, 0], [W / 2 + 0.07, 0, W, 0.12, Math.PI / 2], [-W / 2 - 0.07, 0, W, 0.12, Math.PI / 2]] as const) {
    const t = hazardTexture(256).clone();
    t.repeat.set(w * 2, 0.5);
    t.needsUpdate = true;
    const band = new THREE.Mesh(new THREE.PlaneGeometry(rot ? d : w, rot ? w : d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    if (rot) { t.rotation = Math.PI / 2; }
    band.rotation.x = -Math.PI / 2;
    band.position.set(x, 0.062, z);
    band.receiveShadow = true;
    group.add(band);
  }
  void hazardMat;

  // Rivets along the frame.
  const rivetGeo = new THREE.SphereGeometry(0.025, 8, 6);
  const rivetMat = new THREE.MeshStandardMaterial({ color: '#7a7268', metalness: 0.9, roughness: 0.35 });
  const rivets = new THREE.InstancedMesh(rivetGeo, rivetMat, 4 * 18);
  let ri = 0;
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 18; i++) {
    const p = -4.4 + i * (8.8 / 17);
    for (const [x, z] of [[p, 4.62], [p, -4.62], [4.62, p], [-4.62, p]]) { mtx.makeTranslation(x, 0.065, z); rivets.setMatrixAt(ri++, mtx); }
  }
  group.add(rivets);

  // Engraved coordinates on the frame (both sides so either player reads them upright).
  const labels: THREE.Mesh[] = [];
  const labelGeo = new THREE.PlaneGeometry(0.34, 0.34);
  for (let i = 0; i < 8; i++) {
    for (const side of [1, -1]) {
      const fl = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: labelTexture('abcdefgh'[i]), transparent: true, depthWrite: false }));
      fl.rotation.x = -Math.PI / 2;
      if (side < 0) fl.rotation.z = Math.PI;
      fl.position.set(i - 3.5, 0.064, side * 4.42);
      group.add(fl); labels.push(fl);
      const rl = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: labelTexture(String(i + 1)), transparent: true, depthWrite: false }));
      rl.rotation.x = -Math.PI / 2;
      if (side < 0) rl.rotation.z = Math.PI;
      rl.position.set(-side * 4.42, 0.064, 3.5 - i);
      group.add(rl); labels.push(rl);
    }
  }

  // ---------------------------------------------------------------- platform + supports
  const slabMat = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 40, '#77706a'), roughness: 0.95 });
  (slabMat.map as THREE.Texture).repeat.set(3, 1);
  const slab = new THREE.Mesh(new RoundedBoxGeometry(10.6, 0.9, 10.6, 3, 0.08), slabMat);
  slab.position.y = -0.62;
  slab.receiveShadow = true; slab.castShadow = true;
  group.add(slab);
  // Chipped corners / broken edge chunks.
  const chunkMat = slabMat;
  const rand = mulberry(7);
  for (let i = 0; i < Math.round(26 * detail); i++) {
    const side = Math.floor(rand() * 4), along = (rand() - 0.5) * 10;
    const pos = side === 0 ? [along, 5.3] : side === 1 ? [along, -5.3] : side === 2 ? [5.3, along] : [-5.3, along];
    const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + rand() * 0.3, 0), chunkMat);
    c.position.set(pos[0], -1.05 + rand() * 0.3, pos[1]);
    c.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    c.castShadow = true; c.receiveShadow = true;
    group.add(c);
  }
  const pylonMat = new THREE.MeshStandardMaterial({ map: steelPlateTexture(256, 50, '#3d362f'), metalness: 0.7, roughness: 0.6 });
  for (const [x, z] of [[-4.6, -4.6], [4.6, -4.6], [-4.6, 4.6], [4.6, 4.6]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3, 0.7), pylonMat);
    leg.position.set(x, -2.4, z);
    leg.castShadow = true;
    group.add(leg);
  }

  // ---------------------------------------------------------------- lamp pylons at the corners
  const lamps: THREE.PointLight[] = [];
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2622', metalness: 0.8, roughness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: '#ffcf8a', emissive: '#ffb050', emissiveIntensity: 3, toneMapped: false });
  for (const [x, z] of [[-4.75, -4.75], [4.75, -4.75], [-4.75, 4.75], [4.75, 4.75]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.4, 8), poleMat);
    pole.position.set(x, 1.1, z);
    pole.castShadow = true;
    group.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), poleMat);
    arm.position.set(x - Math.sign(x) * 0.22, 2.25, z);
    group.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.18), lampMat);
    head.position.set(x - Math.sign(x) * 0.42, 2.2, z);
    group.add(head);
    const light = new THREE.PointLight('#ffb767', 5, 9, 1.6);
    light.position.set(x - Math.sign(x) * 0.6, 2.0, z - Math.sign(z) * 0.2);
    group.add(light);
    lamps.push(light);
  }

  // Invisible picking plane at board height.
  const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  pickPlane.rotation.x = -Math.PI / 2;
  pickPlane.position.y = 0.001;
  group.add(pickPlane);

  return { group, pickPlane, lamps, labels };
}

function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
