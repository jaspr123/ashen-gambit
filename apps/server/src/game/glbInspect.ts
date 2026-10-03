// Minimal GLB parser: verifies the container and extracts the facts the
// validator needs (triangles, bones, clips, materials, textures) so the server
// never has to trust stats reported by the client.

export interface GlbFacts {
  ok: boolean;
  error?: string;
  triangles: number;
  bones: number;
  materials: number;
  textures: number;
  clips: { name: string; duration: number }[];
  missingTextures: string[];
}

export function inspectGlb(buf: Buffer): GlbFacts {
  const fail = (error: string): GlbFacts => ({ ok: false, error, triangles: 0, bones: 0, materials: 0, textures: 0, clips: [], missingTextures: [] });
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return fail('not_glb'); // 'glTF'
  if (buf.readUInt32LE(4) !== 2) return fail('unsupported_version');
  if (buf.readUInt32LE(8) !== buf.length) return fail('length_mismatch');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) return fail('no_json_chunk'); // 'JSON'
  let json: any;
  try { json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')); } catch { return fail('bad_json'); }
  const accessors: any[] = json.accessors ?? [];
  let triangles = 0;
  for (const mesh of json.meshes ?? []) for (const prim of mesh.primitives ?? []) {
    const mode = prim.mode ?? 4;
    if (mode !== 4) continue;
    const count = prim.indices !== undefined ? accessors[prim.indices]?.count : accessors[prim.attributes?.POSITION]?.count;
    triangles += Math.floor((count ?? 0) / 3);
  }
  const bones = (json.skins ?? []).reduce((n: number, s: any) => Math.max(n, (s.joints ?? []).length), 0);
  const clips = (json.animations ?? []).map((a: any, i: number) => {
    let duration = 0;
    for (const s of a.samplers ?? []) duration = Math.max(duration, Number(accessors[s.input]?.max?.[0] ?? 0));
    return { name: String(a.name ?? `clip_${i}`), duration };
  });
  // External URIs are not allowed in an uploaded GLB: everything must be embedded.
  const missingTextures = (json.images ?? []).filter((im: any) => im.uri && !String(im.uri).startsWith('data:')).map((im: any) => String(im.uri));
  return { ok: true, triangles, bones, materials: (json.materials ?? []).length, textures: (json.textures ?? []).length, clips, missingTextures };
}
