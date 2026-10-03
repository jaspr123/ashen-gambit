// ModelImportManager — turns user files (GLB, GLTF + bin + textures, FBX,
// OBJ + MTL, or a ZIP of any of those) into a normalised three.js model,
// measures it for validation, auto-fits it to the board, renders a thumbnail
// and re-exports a single self-contained GLB for upload.

import * as THREE from 'three';
import JSZip from 'jszip';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ModelStats, PieceClass } from '@ashen/shared';

export interface ImportedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  format: 'glb' | 'gltf' | 'fbx' | 'obj';
  fileName: string;
  fileBytes: number;
  missingTextures: string[];
  warnings: string[];
}

export interface PieceTransform { scale: number; rotation: [number, number, number]; offset: [number, number, number] }

const MODEL_EXT = /\.(glb|gltf|fbx|obj)$/i;
const TARGET_HEIGHT: Record<PieceClass, number> = { pawn: 0.75, knight: 0.95, bishop: 1.05, rook: 0.95, queen: 1.15, king: 1.3 };

/** Map of lower-cased file names (and basenames) -> blob URLs, used to resolve external references. */
function blobMap(files: Map<string, Blob>) {
  const urls = new Map<string, string>();
  for (const [name, blob] of files) {
    const url = URL.createObjectURL(blob);
    urls.set(name.toLowerCase(), url);
    urls.set(name.split('/').pop()!.toLowerCase(), url);
  }
  return urls;
}

export async function importModelFiles(fileList: File[]): Promise<ImportedModel> {
  const files = new Map<string, Blob>();
  for (const f of fileList) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      for (const entry of Object.values(zip.files)) if (!entry.dir) files.set(entry.name, await entry.async('blob'));
    } else files.set(f.name, f);
  }
  const main = [...files.keys()].filter((n) => MODEL_EXT.test(n)).sort((a, b) => rank(a) - rank(b))[0];
  if (!main) throw new Error('No GLB, GLTF, FBX or OBJ model found in the selection.');
  const urls = blobMap(files);
  const missing = new Set<string>();
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const clean = decodeURIComponent(url.split('?')[0]).replace(/\\/g, '/');
    const hit = urls.get(clean.toLowerCase()) ?? urls.get(clean.split('/').pop()!.toLowerCase());
    if (!hit) { missing.add(clean.split('/').pop()!); return 'data:,'; }
    return hit;
  });
  const blob = files.get(main)!;
  const ext = main.split('.').pop()!.toLowerCase() as ImportedModel['format'];
  const warnings: string[] = [];
  let scene: THREE.Object3D;
  let animations: THREE.AnimationClip[] = [];

  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const data = ext === 'glb' ? await blob.arrayBuffer() : await blob.text();
    const g = await loader.parseAsync(data, '');
    scene = g.scene;
    animations = g.animations;
  } else if (ext === 'fbx') {
    const fbx = new FBXLoader(manager).parse(await blob.arrayBuffer(), '');
    scene = fbx;
    animations = fbx.animations;
    warnings.push('FBX imported: check scale (FBX files are often in centimetres) and orientation.');
  } else {
    const mtlName = [...files.keys()].find((n) => /\.mtl$/i.test(n));
    const obj = new OBJLoader(manager);
    if (mtlName) {
      const mtl = new MTLLoader(manager).parse(await files.get(mtlName)!.text(), '');
      mtl.preload();
      obj.setMaterials(mtl);
    }
    scene = obj.parse(await blob.text());
    warnings.push('OBJ has no skeleton or animations: procedural fallbacks will be used.');
  }
  // Wait a tick for texture loads triggered by the managers.
  await new Promise((r) => setTimeout(r, 300));
  normaliseMaterials(scene);
  return { scene, animations, format: ext, fileName: main.split('/').pop()!, fileBytes: blob.size, missingTextures: [...missing], warnings };
}

function rank(name: string) { return /\.glb$/i.test(name) ? 0 : /\.gltf$/i.test(name) ? 1 : /\.fbx$/i.test(name) ? 2 : 3; }

/** Convert legacy materials (Phong/Lambert from FBX/OBJ) to PBR so lighting is consistent. */
function normaliseMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const conv = (mat: THREE.Material) => {
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mat;
      const src = mat as THREE.MeshPhongMaterial;
      const out = new THREE.MeshStandardMaterial({ name: src.name, color: src.color ?? new THREE.Color('#ccc'), map: src.map ?? null, normalMap: src.normalMap ?? null, transparent: src.transparent, opacity: src.opacity, roughness: 0.75, metalness: 0.1, side: src.side });
      if (src.emissive) { out.emissive.copy(src.emissive); out.emissiveMap = src.emissiveMap ?? null; }
      return out;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
}

/**
 * World-space bounds that are correct for skinned meshes: clone with the
 * skeleton (plain .clone() shares bones with the original), update bone
 * matrices, then measure the skinned vertices.
 */
export function boundsOf(obj: THREE.Object3D): THREE.Box3 {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) { sk.skeleton.update(); sk.computeBoundingBox(); box.union(sk.boundingBox!.clone().applyMatrix4(sk.matrixWorld)); }
    else if ((o as THREE.Mesh).isMesh) box.expandByObject(o, false);
  });
  return box.isEmpty() ? new THREE.Box3().setFromObject(obj) : box;
}

/** Suggest a transform that stands the model on the board at the class's height. */
export function autoFit(model: THREE.Object3D, pc: PieceClass, base: Partial<PieceTransform> = {}): PieceTransform {
  const rotation = base.rotation ?? [0, 0, 0];
  const probe = new THREE.Group();
  const clone = SkeletonUtils.clone(model);
  clone.position.set(0, 0, 0);
  clone.scale.setScalar(1);
  clone.rotation.set(...(rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]));
  probe.add(clone);
  const box = boundsOf(probe);
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, 1e-4);
  let scale = TARGET_HEIGHT[pc] / h;
  // Never let the footprint exceed the square.
  const foot = Math.max(size.x, size.z) * scale;
  if (foot > 0.95) scale *= 0.95 / foot;
  const center = box.getCenter(new THREE.Vector3());
  return { scale: round(scale, 5), rotation, offset: [round(-center.x * scale), round(-box.min.y * scale), round(-center.z * scale)] };
}

function round(v: number, d = 4) { const k = 10 ** d; return Math.round(v * k) / k; }

/** Build the transformed object exactly as the game will (holder -> model with scale/rot/offset). */
export function applyTransform(model: THREE.Object3D, t: PieceTransform): THREE.Group {
  const holder = new THREE.Group();
  model.scale.setScalar(t.scale);
  model.rotation.set(...(t.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]));
  model.position.set(...t.offset);
  holder.add(model);
  return holder;
}

/** Measure everything the validator needs. */
export function measure(imp: ImportedModel, t: PieceTransform): ModelStats {
  let triangles = 0, bones = 0, skeletonOk = true;
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  imp.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry as THREE.BufferGeometry;
      triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        materials.add(mat);
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
      }
    }
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) {
      bones = Math.max(bones, sk.skeleton.bones.length);
      if (sk.skeleton.bones.some((b) => !b)) skeletonOk = false;
      if (!sk.geometry.attributes.skinIndex || !sk.geometry.attributes.skinWeight) skeletonOk = false;
    }
  });
  const probe = new THREE.Group();
  probe.add(applyTransform(SkeletonUtils.clone(imp.scene), t));
  const box = boundsOf(probe);
  const size = box.getSize(new THREE.Vector3());
  return {
    loadOk: true, triangles: Math.round(triangles), materials: materials.size, textures: textures.size, missingTextures: imp.missingTextures,
    bones, skeletonOk, clips: imp.animations.map((a) => ({ name: a.name, duration: Math.round(a.duration * 100) / 100 })),
    size: [round(size.x, 3), round(size.y, 3), round(size.z, 3)], minY: round(box.min.y, 3), fileBytes: imp.fileBytes,
  };
}

/** Self-contained binary GLB (textures embedded, animations included) for upload. */
export async function exportGlb(imp: ImportedModel): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const out = await exporter.parseAsync(imp.scene, { binary: true, animations: imp.animations, onlyVisible: true, maxTextureSize: 2048 });
  return out as ArrayBuffer;
}

/** Small JPEG thumbnail rendered with a throwaway renderer. */
export function renderThumbnail(obj: THREE.Object3D, size = 160): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1612');
  scene.add(new THREE.HemisphereLight('#c8b090', '#20160f', 1.6));
  const sun = new THREE.DirectionalLight('#ffe0b0', 2.5);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const clone = SkeletonUtils.clone(obj);
  scene.add(clone);
  const box = boundsOf(clone);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() * 0.62 || 1;
  const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  cam.position.set(c.x + r * 0.9, c.y + r * 0.55, c.z + r * 1.6);
  cam.lookAt(c);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.82);
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
