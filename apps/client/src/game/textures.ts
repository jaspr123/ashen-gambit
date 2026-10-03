// Procedural canvas textures: weathered concrete, rusted steel, hazard
// stripes, engraved piece glyphs, lit windows. Generated once and cached, so
// the arena looks material-rich without shipping texture files. Any of these
// can be swapped for authored textures from the Blender pipeline later.

import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!] as const;
}

function finish(key: string, c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, r: () => number, count: number, alpha: number, light: boolean) {
  for (let i = 0; i < count; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    const s = r() * 2.2 + 0.4;
    ctx.fillRect(r() * size, r() * size, s, s);
  }
}

function stains(ctx: CanvasRenderingContext2D, size: number, r: () => number, color: string, count: number, maxR: number) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = r() * maxR + maxR * 0.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function cracks(ctx: CanvasRenderingContext2D, size: number, r: () => number, count: number, color = 'rgba(20,16,12,0.55)') {
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    let x = r() * size, y = r() * size;
    ctx.lineWidth = r() * 1.6 + 0.5;
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = 6 + Math.floor(r() * 10);
    let a = r() * Math.PI * 2;
    for (let s = 0; s < steps; s++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * size * 0.03; y += Math.sin(a) * size * 0.03; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

/** Light board square: pale poured concrete with aggregate, stains and hairline cracks. */
export function concreteTexture(size = 512, seed = 1, tint = '#a39a8c'): THREE.Texture {
  const key = `concrete:${size}:${seed}:${tint}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  ctx.fillStyle = tint; ctx.fillRect(0, 0, size, size);
  stains(ctx, size, r, 'rgba(60,48,36,0.25)', 14, size * 0.3);
  stains(ctx, size, r, 'rgba(255,245,225,0.10)', 8, size * 0.25);
  speckle(ctx, size, r, size * 30, 0.18, false);
  speckle(ctx, size, r, size * 12, 0.15, true);
  cracks(ctx, size, r, 5);
  // Rust drip streaks.
  for (let i = 0; i < 4; i++) {
    const x = r() * size, w = 2 + r() * 6;
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, 'rgba(120,60,20,0.25)'); g.addColorStop(1, 'rgba(120,60,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, size * (0.3 + r() * 0.5));
  }
  return finish(key, c);
}

/** Dark board square: blackened steel deck plate with diamond tread, rivets, rust. */
export function steelPlateTexture(size = 512, seed = 2, tint = '#3b3732'): THREE.Texture {
  const key = `steel:${size}:${seed}:${tint}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  ctx.fillStyle = tint; ctx.fillRect(0, 0, size, size);
  // Diamond tread pattern.
  const step = size / 16;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < size; y += step) for (let x = 0; x < size; x += step) {
    const ox = ((y / step) % 2) * step * 0.5;
    ctx.save(); ctx.translate(x + ox + step / 2, y + step / 2); ctx.rotate(((y / step) % 2 ? 1 : -1) * 0.7);
    ctx.fillRect(-step * 0.28, -step * 0.06, step * 0.56, step * 0.12); ctx.restore();
  }
  stains(ctx, size, r, 'rgba(130,62,22,0.35)', 18, size * 0.18);
  stains(ctx, size, r, 'rgba(10,8,6,0.35)', 10, size * 0.25);
  speckle(ctx, size, r, size * 20, 0.2, false);
  // Edge bevel and rivets.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = size * 0.02; ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = size * 0.006; ctx.strokeRect(size * 0.015, size * 0.015, size * 0.97, size * 0.97);
  for (const [x, y] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94]]) {
    const g = ctx.createRadialGradient(x * size - 2, y * size - 2, 0, x * size, y * size, size * 0.02);
    g.addColorStop(0, '#9a9288'); g.addColorStop(1, '#25221f');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x * size, y * size, size * 0.018, 0, Math.PI * 2); ctx.fill();
  }
  return finish(key, c);
}

/** Generic grime/roughness variation map (linear). */
export function grimeTexture(size = 256, seed = 3): THREE.Texture {
  const key = `grime:${size}:${seed}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  ctx.fillStyle = '#b8b8b8'; ctx.fillRect(0, 0, size, size);
  stains(ctx, size, r, 'rgba(255,255,255,0.35)', 20, size * 0.25);
  stains(ctx, size, r, 'rgba(0,0,0,0.35)', 20, size * 0.25);
  speckle(ctx, size, r, size * 10, 0.3, false);
  return finish(key, c, 1, false);
}

export function hazardTexture(size = 256): THREE.Texture {
  const key = `hazard:${size}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(size);
  const r = rng(9);
  ctx.fillStyle = '#d19a1e'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#16130f';
  for (let i = -size; i < size * 2; i += size / 4) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size / 8, 0); ctx.lineTo(i + size / 8 - size, size); ctx.lineTo(i - size, size); ctx.fill();
  }
  speckle(ctx, size, r, size * 25, 0.4, false);
  stains(ctx, size, r, 'rgba(40,25,10,0.45)', 10, size * 0.3);
  return finish(key, c);
}

/** Engraved chess glyph decal for piece bases (white glyph on transparent). */
export function glyphTexture(glyph: string, color = '#f2e6cc'): THREE.Texture {
  const key = `glyph:${glyph}:${color}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '700 92px "Segoe UI Symbol", "DejaVu Sans", serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(glyph, 64, 70);
  const t = finish(key, c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Board edge labels a-h / 1-8. */
export function labelTexture(text: string): THREE.Texture {
  const key = `label:${text}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(64);
  ctx.font = '600 44px Oswald, Impact, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(232,200,140,0.85)';
  ctx.fillText(text, 32, 34);
  const t = finish(key, c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Ruined tower facade: rows of mostly-dark windows, a few lit, many blown out. */
export function facadeTexture(seed: number, size = 256): THREE.Texture {
  const key = `facade:${seed}:${size}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  const base = 30 + Math.floor(r() * 25);
  ctx.fillStyle = `rgb(${base + 8},${base + 4},${base})`; ctx.fillRect(0, 0, size, size);
  const cols = 6 + Math.floor(r() * 4), rows = 12;
  const cw = size / cols, rh = size / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const v = r();
    ctx.fillStyle = v < 0.04 ? `rgba(255,${150 + r() * 60},70,0.9)` : v < 0.5 ? 'rgba(8,8,10,0.95)' : 'rgba(20,20,22,0.8)';
    ctx.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.55);
  }
  stains(ctx, size, r, 'rgba(0,0,0,0.6)', 8, size * 0.3);
  return finish(key, c);
}

/** Emissive mask for the facade's lit windows. */
export function facadeEmissive(seed: number, size = 256): THREE.Texture {
  const key = `facadeE:${seed}:${size}`;
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  r(); // keep sequence aligned with facadeTexture's first call
  const cols = 6 + Math.floor(r() * 4), rows = 12;
  const cw = size / cols, rh = size / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const v = r();
    if (v < 0.04) { ctx.fillStyle = `rgb(255,${150 + r() * 60},70)`; ctx.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.55); }
  }
  return finish(key, c);
}

/** Soft round sprite for particles. */
export function softDotTexture(): THREE.Texture {
  const key = 'softdot';
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return finish(key, c);
}

/** Wispy smoke puff sprite. */
export function smokeTexture(): THREE.Texture {
  const key = 'smoke';
  if (cache.has(key)) return cache.get(key)!;
  const [c, ctx] = canvas(128);
  const r = rng(77);
  for (let i = 0; i < 40; i++) {
    const x = 64 + (r() - 0.5) * 60, y = 64 + (r() - 0.5) * 60, rad = 12 + r() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  return finish(key, c);
}

/** Vertical sky gradient with a hazy sun glow. */
export function skyTexture(top: string, horizon: string, sun: string): THREE.Texture {
  const key = `sky:${top}:${horizon}:${sun}`;
  if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, top); g.addColorStop(0.62, horizon); g.addColorStop(0.7, horizon); g.addColorStop(1, '#0b0907');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  const sg = ctx.createRadialGradient(700, 330, 0, 700, 330, 260);
  sg.addColorStop(0, sun); sg.addColorStop(0.2, `${sun}66`); sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, 1024, 512);
  const r = rng(5);
  for (let i = 0; i < 30; i++) {
    const y = 200 + r() * 140, x = r() * 1024, w = 200 + r() * 400;
    const cg = ctx.createLinearGradient(x, y, x + w, y);
    cg.addColorStop(0, 'rgba(0,0,0,0)'); cg.addColorStop(0.5, `rgba(20,14,10,${0.15 + r() * 0.2})`); cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg; ctx.fillRect(x, y, w, 6 + r() * 18);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  cache.set(key, t);
  return t;
}
