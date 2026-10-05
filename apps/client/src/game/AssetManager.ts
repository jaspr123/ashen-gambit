// AssetManager — async GLB loading with caching, Draco + Meshopt decoding,
// and an asset manifest produced by the Blender export pipeline
// (tools/blender/export_*.py -> public/assets/manifest.json).
// Only the two armies in the current match are preloaded.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BuiltinFactionId, GameAction, PieceClass } from '@ashen/shared';
import { withBase } from '../core/base';

export interface ManifestPiece {
  /** GLB holding this piece (relative to /assets). */
  file: string;
  /** Root node name inside the GLB. */
  node: string;
  /** 'humanoid' = shared Synty clip library, 'self' = clips embedded in the piece GLB. */
  animations?: 'humanoid' | 'self';
  /** Clip map overrides (action -> clip name). */
  clips?: Partial<Record<GameAction, string>>;
  /** Uniform scale to apply on top of the export. */
  scale?: number;
  mechanical?: boolean;
}
export interface AssetManifest {
  version: number;
  factions: Partial<Record<BuiltinFactionId, { pieces: Partial<Record<PieceClass, ManifestPiece>> }>>;
  animations?: { humanoid: string; clips: string[] };
  environment?: { file: string; props: string[] };
  /** Extra Derby jockey/horse variants per faction (variant 'b'). */
  /** Derby runner models per faction, keyed by look ('b' = second jockey, 'j1'..'j5' = extra runners). */
  derby?: Partial<Record<BuiltinFactionId, Record<string, { file: string; node: string; clips?: Partial<Record<GameAction, string>> }>>>;
}

class AssetManagerImpl {
  private loader: GLTFLoader;
  private cache = new Map<string, Promise<GLTF>>();
  manifest: AssetManifest | null = null;
  private manifestPromise: Promise<AssetManifest | null> | null = null;

  constructor() {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  loadManifest(): Promise<AssetManifest | null> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(withBase('/assets/manifest.json'))
        .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
        .then((m) => (this.manifest = m))
        .catch(() => null);
    }
    return this.manifestPromise;
  }

  load(url: string): Promise<GLTF> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.loader.loadAsync(withBase(url));
      this.cache.set(url, p);
      p.then((g) => this.resolved.set(url, g)).catch(() => this.cache.delete(url));
    }
    return p;
  }

  /** Parse an in-memory GLB/GLTF (custom army creator). */
  parse(data: ArrayBuffer | string, path = ''): Promise<GLTF> {
    return this.loader.parseAsync(data, path);
  }

  has(url: string) { return this.cache.has(url); }

  /** Preload the two armies needed for a match. Resolves even if assets are missing. */
  async preloadFactions(ids: string[]) {
    const m = await this.loadManifest();
    const urls = new Set<string>();
    for (const id of ids) {
      const f = m?.factions[id as BuiltinFactionId];
      if (!f) continue;
      for (const p of Object.values(f.pieces)) {
        if (!p) continue;
        urls.add(`/assets/${p.file}`);
        if (p.animations !== 'self' && m?.animations) urls.add(`/assets/${m.animations.humanoid}`);
      }
    }
    await Promise.allSettled([...urls].map((u) => this.load(u)));
  }

  /** Derby runner models for one race card only (each is a full horse + rider, ~0.7 MB). */
  async preloadDerby(runners: { faction: BuiltinFactionId; look: string }[]) {
    const m = await this.loadManifest();
    const files = new Set(runners.map((r) => m?.derby?.[r.faction]?.[r.look]?.file).filter((f): f is string => !!f));
    await Promise.allSettled([...files].map((f) => this.load(`/assets/${f}`)));
  }

  /** Synchronous access to an already-loaded GLTF (null if not loaded yet). */
  private resolved = new Map<string, GLTF>();
  peek(url: string): GLTF | null {
    if (this.resolved.has(url)) return this.resolved.get(url)!;
    const p = this.cache.get(url);
    if (p) void p.then((g) => this.resolved.set(url, g)).catch(() => {});
    return null;
  }

  /** Clone a node out of a loaded GLB, with skeleton support. */
  cloneNode(gltf: GLTF, nodeName: string): THREE.Object3D | null {
    // Fall back to the whole scene: optimisers may flatten/rename the root of single-piece files.
    const src = gltf.scene.getObjectByName(nodeName) ?? (gltf.scene.children.length ? gltf.scene : null);
    if (!src) return null;
    // Keep the root's own transform: exporters put axis conversion (e.g. FBX's
    // 90° X), unit scale and grounding offsets there.
    return SkeletonUtils.clone(src);
  }
}

export const AssetManager = new AssetManagerImpl();
