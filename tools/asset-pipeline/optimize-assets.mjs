// Optimise every GLB under apps/client/public/assets for web delivery:
// dedupe, prune, weld, Meshopt geometry compression, WebP textures (<=1024px).
// Run after the Blender builders: `npm run assets:optimize`. Pass name fragments to limit it to
// freshly built files (e.g. `npm run assets:optimize -- jockey_j`) — re-optimising re-encodes textures.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', 'apps', 'client', 'public', 'assets');
const cli = path.resolve(import.meta.dirname, '..', '..', 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.glb') ? [path.join(dir, d.name)] : []));
}

const only = process.argv.slice(2);
let before = 0, after = 0;
for (const file of walk(root)) {
  if (only.length && !only.some((o) => file.includes(o))) continue;
  const size = fs.statSync(file).size;
  if (size === 0) continue;
  const tmp = `${file}.opt.glb`;
  try {
    // Keep animation keyframes intact (no resample of the baked clips beyond lossless), compress geometry + textures.
    execFileSync(process.execPath, [cli, 'optimize', file, tmp, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false', '--flatten', 'false', '--join', 'false', '--instance', 'false'], { stdio: 'pipe' });
    const out = fs.statSync(tmp).size;
    fs.renameSync(tmp, file);
    before += size; after += out;
    console.log(`${path.relative(root, file).padEnd(36)} ${(size / 1024).toFixed(0).padStart(6)} KB -> ${(out / 1024).toFixed(0).padStart(6)} KB`);
  } catch (e) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
    console.error('failed', file, String(e.stderr ?? e).slice(0, 300));
  }
}
console.log(`total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
