// ArenaEnvironment — the destroyed city around the board. Procedural so it
// always exists, then decorated with Synty GLB props from the Blender
// pipeline when /assets/environment.glb is present. Detail scales with the
// graphics preset; nothing here ever overlaps the 8x8 play area.

import * as THREE from 'three';
import type { ArenaDef } from '@ashen/shared';
import { AssetManager } from './AssetManager';
import type { FxSystem } from './FxSystem';
import { concreteTexture, facadeEmissive, facadeTexture, skyTexture, steelPlateTexture } from './textures';

const GROUND_Y = -2.2;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class ArenaEnvironment {
  readonly group = new THREE.Group();
  private fires: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private time = 0;
  private propsRoot = new THREE.Group();
  /** Procedural stand-ins that the Synty set-dressing pack replaces when it is available. */
  private standIns = { towers: new THREE.Group(), wrecks: new THREE.Group(), clutter: new THREE.Group() };

  constructor(private def: ArenaDef, private detail: number, private fx: FxSystem) {
    this.group.name = 'environment';
    this.build();
  }

  private build() {
    const r = rng(this.def.id.length * 131 + 7);
    const d = this.detail;
    const g = this.group;

    // ---------------------------------------------------------------- sky + ground
    const sky = new THREE.Mesh(new THREE.SphereGeometry(260, 48, 24), new THREE.MeshBasicMaterial({ map: skyTexture(this.def.sky[0], this.def.sky[1], this.def.sunColor), side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.rotation.y = Math.PI * 0.6;
    g.add(sky);
    const groundTex = concreteTexture(512, 90, '#4a423a').clone();
    groundTex.repeat.set(40, 40);
    groundTex.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(240, 64), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, color: '#9a8f82' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    ground.receiveShadow = true;
    g.add(ground);

    // ---------------------------------------------------------------- rubble field around the platform
    const rubbleMat = new THREE.MeshStandardMaterial({ map: concreteTexture(256, 91, '#6d655c'), roughness: 0.95 });
    const rubbleGeo = new THREE.DodecahedronGeometry(1, 0);
    const n = Math.round(260 * d);
    const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, rad = 7 + Math.pow(r(), 0.6) * 30;
      const k = 0.15 + r() * (rad < 12 ? 0.6 : 1.4);
      p.set(Math.cos(a) * rad, GROUND_Y + k * 0.3, Math.sin(a) * rad);
      q.setFromEuler(e.set(r() * 3, r() * 3, r() * 3));
      s.set(k * (0.8 + r()), k * (0.4 + r() * 0.6), k * (0.8 + r()));
      rubble.setMatrixAt(i, m.compose(p, q, s));
    }
    rubble.castShadow = true; rubble.receiveShadow = true;
    g.add(rubble);

    // Twisted rebar sticking out of slabs.
    const rebarMat = new THREE.MeshStandardMaterial({ color: '#5a3a22', metalness: 0.8, roughness: 0.7 });
    for (let i = 0; i < Math.round(30 * d); i++) {
      const a = r() * Math.PI * 2, rad = 7.5 + r() * 14;
      const curve = new THREE.CatmullRomCurve3([0, 1, 2].map((k) => new THREE.Vector3(Math.cos(a) * rad + (r() - 0.5) * 0.4 * k, GROUND_Y + k * (0.5 + r() * 0.6), Math.sin(a) * rad + (r() - 0.5) * 0.4 * k)));
      const bar = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.03, 5), rebarMat);
      bar.castShadow = true;
      g.add(bar);
    }

    // ---------------------------------------------------------------- ruined skyline
    const facades = [11, 23, 37, 41].map((seed) => {
      const map = facadeTexture(seed, 256).clone(); map.repeat.set(1, 3); map.needsUpdate = true;
      const em = facadeEmissive(seed, 256).clone(); em.repeat.set(1, 3); em.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: '#ffb066', emissiveIntensity: 0.9, roughness: 0.9 });
    });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const towers = Math.round(70 * Math.min(1.3, d + 0.2));
    const perMat = facades.map((mat) => new THREE.InstancedMesh(boxGeo, mat, towers * 2));
    const counts = facades.map(() => 0);
    for (let i = 0; i < towers; i++) {
      const a = (i / towers) * Math.PI * 2 + r() * 0.08;
      const rad = 45 + r() * 70;
      const w = 5 + r() * 9, h = 14 + r() * 55, dd = 5 + r() * 9;
      const mi = Math.floor(r() * facades.length);
      const lean = (r() - 0.5) * (r() < 0.25 ? 0.25 : 0.04);
      p.set(Math.cos(a) * rad, GROUND_Y + h / 2 - 1, Math.sin(a) * rad);
      q.setFromEuler(e.set(0, -a + r() * 0.3, lean));
      perMat[mi].setMatrixAt(counts[mi]++, m.compose(p, q, s.set(w, h, dd)));
      // Broken, stepped top.
      if (r() < 0.7) {
        const h2 = 3 + r() * 10;
        p.set(p.x + (r() - 0.5) * w * 0.4, GROUND_Y + h - 1 + h2 / 2, p.z + (r() - 0.5) * dd * 0.4);
        perMat[mi].setMatrixAt(counts[mi]++, m.compose(p, q, s.set(w * (0.3 + r() * 0.4), h2, dd * (0.3 + r() * 0.4))));
      }
    }
    perMat.forEach((im, i) => { im.count = counts[i]; this.standIns.towers.add(im); });
    g.add(this.standIns.towers, this.standIns.wrecks, this.standIns.clutter);

    // ---------------------------------------------------------------- collapsed highway overpass
    const deckMat = new THREE.MeshStandardMaterial({ map: concreteTexture(512, 92, '#7d756b'), roughness: 0.92 });
    (deckMat.map as THREE.Texture).repeat.set(6, 1);
    const pillarMat = new THREE.MeshStandardMaterial({ map: concreteTexture(256, 93, '#6e675f'), roughness: 0.95 });
    const roadZ = -26 + (this.def.environment === 'highway_overpass' ? 10 : 0);
    const deckY = 7;
    const segs = [[-60, -22], [-14, 16], [24, 60]] as const;
    for (const [x0, x1] of segs) {
      const len = x1 - x0;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 9), deckMat);
      deck.position.set((x0 + x1) / 2, deckY, roadZ);
      deck.castShadow = true; deck.receiveShadow = true;
      g.add(deck);
      for (let x = x0 + 4; x < x1 - 2; x += 12) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(1.6, deckY - GROUND_Y, 2.2), pillarMat);
        pil.position.set(x, (deckY + GROUND_Y) / 2, roadZ);
        pil.castShadow = true;
        g.add(pil);
      }
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.25), pillarMat);
        rail.position.set((x0 + x1) / 2, deckY + 0.7, roadZ + side * 4.4);
        g.add(rail);
      }
    }
    // Collapsed spans hanging to the ground.
    for (const [xa, xb, tilt] of [[-22, -14, 1], [16, 24, -1]] as const) {
      const span = new THREE.Mesh(new THREE.BoxGeometry(11, 0.9, 9), deckMat);
      span.position.set((xa + xb) / 2 + tilt * 0.5, (deckY + GROUND_Y) / 2 + 0.5, roadZ + 1);
      span.rotation.z = tilt * 0.75;
      span.rotation.y = tilt * 0.08;
      span.castShadow = true; span.receiveShadow = true;
      g.add(span);
    }

    // ---------------------------------------------------------------- wrecked vehicles
    const carPaint = ['#5a2e1e', '#2e3a42', '#4a4a3a', '#6a5a3a', '#3a2a2a'];
    for (let i = 0; i < Math.round(9 * d + 3); i++) {
      const a = r() * Math.PI * 2, rad = 9 + r() * 12;
      const car = this.wreck(carPaint[i % carPaint.length], r);
      car.position.set(Math.cos(a) * rad, GROUND_Y, Math.sin(a) * rad);
      car.rotation.y = r() * Math.PI * 2;
      if (r() < 0.35) { car.rotation.z = Math.PI * (0.5 + r() * 0.5); car.position.y += 0.6; }
      this.standIns.wrecks.add(car);
      if (r() < 0.4) this.addFire(car.position.clone().setY(GROUND_Y + 0.6), 0.6 + r() * 0.5);
    }
    // Cars stranded on the overpass.
    for (let i = 0; i < 5; i++) {
      const car = this.wreck(carPaint[(i + 2) % carPaint.length], r);
      car.position.set(-50 + r() * 100, deckY + 0.45, roadZ + (r() - 0.5) * 6);
      if (car.position.x > -22 && car.position.x < -14) continue;
      if (car.position.x > 16 && car.position.x < 24) continue;
      car.rotation.y = (r() - 0.5) * 0.6 + (r() < 0.5 ? Math.PI : 0);
      g.add(car);
    }

    // ---------------------------------------------------------------- power poles with sagging wires
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a2c20', roughness: 0.9 });
    const wireMat = new THREE.LineBasicMaterial({ color: '#141210' });
    const poles: THREE.Vector3[] = [];
    for (let i = 0; i < 7; i++) {
      const x = -30 + i * 10, z = 14 + Math.sin(i) * 2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 9, 6), poleMat);
      pole.position.set(x, GROUND_Y + 4.5, z);
      pole.rotation.z = (r() - 0.5) * (i === 3 ? 0.6 : 0.12);
      pole.castShadow = true;
      g.add(pole);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 0.15), poleMat);
      cross.position.set(x, GROUND_Y + 8.5, z);
      cross.rotation.z = pole.rotation.z;
      g.add(cross);
      poles.push(new THREE.Vector3(x, GROUND_Y + 8.5, z));
    }
    for (let i = 0; i < poles.length - 1; i++) for (const off of [-0.8, 0.8]) {
      const a = poles[i].clone().add(new THREE.Vector3(off, 0, 0)), b = poles[i + 1].clone().add(new THREE.Vector3(off, 0, 0));
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 12; k++) { const u = k / 12; pts.push(a.clone().lerp(b, u).add(new THREE.Vector3(0, -Math.sin(Math.PI * u) * (i === 2 ? 3.5 : 1.2), 0))); }
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
    }

    // ---------------------------------------------------------------- barricades + barrels near the platform
    const barrelMat = new THREE.MeshStandardMaterial({ map: steelPlateTexture(256, 60, '#6a3a1a'), metalness: 0.6, roughness: 0.7 });
    for (let i = 0; i < Math.round(14 * d + 4); i++) {
      const a = r() * Math.PI * 2, rad = 6.5 + r() * 4;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12), barrelMat);
      b.position.set(Math.cos(a) * rad, GROUND_Y + 0.45, Math.sin(a) * rad);
      if (r() < 0.3) { b.rotation.z = Math.PI / 2; b.position.y = GROUND_Y + 0.32; }
      b.castShadow = true;
      this.standIns.clutter.add(b);
      if (r() < 0.25) this.addFire(b.position.clone().setY(GROUND_Y + 0.95), 0.35);
    }
    // Sandbag walls.
    const bagMat = new THREE.MeshStandardMaterial({ color: '#7a6a4e', roughness: 1 });
    for (let i = 0; i < Math.round(6 * d + 2); i++) {
      const a = r() * Math.PI * 2, rad = 7 + r() * 3;
      const wall = new THREE.Group();
      for (let row = 0; row < 3; row++) for (let k = 0; k < 5 - row; k++) {
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), bagMat);
        bag.rotation.z = Math.PI / 2;
        bag.position.set((k - (4 - row) / 2) * 0.72, row * 0.34 + 0.2, 0);
        bag.scale.y = 1; bag.scale.z = 0.7;
        bag.castShadow = true;
        wall.add(bag);
      }
      wall.position.set(Math.cos(a) * rad, GROUND_Y, Math.sin(a) * rad);
      wall.rotation.y = -a + Math.PI / 2;
      this.standIns.clutter.add(wall);
    }

    // ---------------------------------------------------------------- foundry flavour
    if (this.def.environment === 'foundry') {
      const stackMat = new THREE.MeshStandardMaterial({ map: steelPlateTexture(256, 61, '#3a2a20'), metalness: 0.5, roughness: 0.8 });
      for (let i = 0; i < 5; i++) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 30, 12), stackMat);
        stack.position.set(-40 + i * 18, GROUND_Y + 15, -48 - (i % 2) * 8);
        g.add(stack);
        this.fx.addEmitter('smoke_column', stack.position.clone().setY(GROUND_Y + 30), 1.2, 1.2);
      }
      const glow = new THREE.PointLight('#ff6a20', 60, 60, 1.5);
      glow.position.set(0, GROUND_Y + 4, -30);
      g.add(glow);
    }

    // ---------------------------------------------------------------- distant fires + smoke columns
    for (let i = 0; i < 4; i++) {
      const a = r() * Math.PI * 2, rad = 30 + r() * 30;
      const pos = new THREE.Vector3(Math.cos(a) * rad, GROUND_Y + 0.5, Math.sin(a) * rad);
      this.addFire(pos, 1.6 + r() * 1.5);
      this.fx.addEmitter('smoke_column', pos.clone().setY(GROUND_Y + 2), 1.4 * d, 1.4);
    }
    this.fx.addEmitter('dust_drift', new THREE.Vector3(0, 0, 0), 6 * d, 1);
    this.fx.addEmitter('ember', new THREE.Vector3(0, 0.5, 0), 3 * d, 4);

    g.add(this.propsRoot);
    void this.decorateWithAssets(r);
  }

  /** Low-poly wrecked car (burnt shell, missing wheels). */
  private wreck(color: string, r: () => number) {
    const car = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.75, map: steelPlateTexture(256, 70 + Math.floor(r() * 5), '#5a5048') });
    const burnt = new THREE.MeshStandardMaterial({ color: '#1c1714', roughness: 1 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 1.9), paint);
    body.position.y = 0.75;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 1.7), r() < 0.5 ? burnt : paint);
    cabin.position.set(-0.2, 1.5, 0);
    cabin.rotation.z = (r() - 0.5) * 0.1;
    car.add(body, cabin);
    for (const [x, z] of [[1.4, 0.95], [-1.4, 0.95], [1.4, -0.95], [-1.4, -0.95]]) {
      if (r() < 0.3) continue;
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), burnt);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.42, z);
      car.add(w);
    }
    car.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return car;
  }

  private addFire(pos: THREE.Vector3, scale: number) {
    this.fx.addEmitter('flame', pos, 14 * scale, scale);
    this.fx.addEmitter('ember', pos, 2 * scale, scale * 0.4);
    if (this.fires.length < Math.round(6 * this.detail + 2)) {
      const light = new THREE.PointLight('#ff7a2a', 6 * scale, 10 * scale, 1.8);
      light.position.copy(pos).setY(pos.y + 0.8);
      this.group.add(light);
      this.fires.push({ light, base: 6 * scale, phase: Math.random() * 10 });
    }
  }

  /** Replace procedural set dressing with the Synty pack (tools/blender/build_environment.py) when present. */
  private async decorateWithAssets(r: () => number) {
    const manifest = await AssetManager.loadManifest();
    const env = manifest?.environment;
    if (!env) return;
    try {
      const gltf = await AssetManager.load(`/assets/${env.file}`);
      const d = this.detail;
      const byCat = (c: string) => env.props.filter((p) => p.startsWith(c + ':')).map((p) => p.split(':')[1]);
      const place = (names: string[], count: number, ring: [number, number], opts: { faceCentre?: boolean; scale?: [number, number]; avoid?: (x: number, z: number) => boolean } = {}) => {
        if (!names.length) return;
        let placed = 0, guard = 0;
        while (placed < count && guard++ < count * 6) {
          const node = gltf.scene.getObjectByName(names[Math.floor(r() * names.length)]);
          if (!node) continue;
          const a = r() * Math.PI * 2, rad = ring[0] + r() * (ring[1] - ring[0]);
          const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
          if (opts.avoid?.(x, z)) continue;
          const c = node.clone(true);
          c.position.set(x, GROUND_Y, z);
          c.rotation.set(0, opts.faceCentre ? -a - Math.PI / 2 + (r() - 0.5) * 0.6 : r() * Math.PI * 2, 0);
          if (opts.scale) c.scale.setScalar(opts.scale[0] + r() * (opts.scale[1] - opts.scale[0]));
          c.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = rad < 30; o.receiveShadow = true; } });
          this.propsRoot.add(c);
          placed++;
        }
      };
      // Keep the camera's sightline over the board clear: nothing tall right behind either player.
      const behindPlayers = (x: number, z: number) => Math.abs(x) < 9 && Math.abs(z) < 26;
      place(byCat('building'), Math.round(26 * Math.min(1.3, d + 0.2)), [38, 80], { faceCentre: true, scale: [0.85, 1.35] });
      place(byCat('vehicle'), Math.round(12 * d + 4), [17, 30], { avoid: behindPlayers });
      place(byCat('prop'), Math.round(40 * d + 8), [6.4, 11.5]);
      this.standIns.towers.visible = false;
      this.standIns.wrecks.visible = false;
      this.standIns.clutter.visible = false;
    } catch (e) {
      console.warn('[environment] asset pack unavailable', e);
    }
  }

  update(dt: number) {
    this.time += dt;
    for (const f of this.fires) {
      f.light.intensity = f.base * (0.75 + Math.sin(this.time * 9 + f.phase) * 0.12 + Math.sin(this.time * 23 + f.phase * 2) * 0.08 + Math.random() * 0.1);
    }
  }

  dispose() {
    this.fx.clearEmitters();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.group.clear();
  }
}
