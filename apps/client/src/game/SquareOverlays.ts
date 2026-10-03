// Per-square indicators: selection, legal moves, captures, last move, check,
// hover, ability targets, threat maps and War Chess effect markers.

import * as THREE from 'three';
import { ALL_SQUARES, type EffectKind, type Square } from '@ashen/shared';
import { squareToWorld } from './coords';

export type OverlayState = {
  selected?: Square | null;
  moves?: Square[];
  captures?: Square[];
  lastMove?: [Square, Square] | null;
  check?: Square | null;
  hover?: Square | null;
  targets?: Square[];
  threats?: Square[];
  intel?: Square[];
  effects?: { kind: EffectKind; squares: Square[]; mine: boolean }[];
  premove?: Square[];
};

const COLORS = {
  last: new THREE.Color('#e3a23b'), selected: new THREE.Color('#ffd27a'), check: new THREE.Color('#ff2a1c'), hover: new THREE.Color('#ffffff'),
  target: new THREE.Color('#35d4ff'), threat: new THREE.Color('#ff4a2a'), intel: new THREE.Color('#b56bff'),
};

const EFFECT_STYLE: Record<EffectKind, { color: string; glyph: string }> = {
  shield: { color: '#39d0ff', glyph: '⛨' }, freeze: { color: '#9fe8ff', glyph: '❄' }, no_capture: { color: '#b8b0a4', glyph: '☁' },
  mine: { color: '#ff3b1f', glyph: '✹' }, mark: { color: '#c48bff', glyph: '◉' }, threats: { color: '#ff4a2a', glyph: '' }, neural: { color: '#39d0ff', glyph: '◈' },
};

function glyphSprite(glyph: string, color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = '700 46px "Segoe UI Symbol", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(glyph, 32, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.setScalar(0.32);
  return s;
}

interface Cell { tint: THREE.Mesh; dot: THREE.Mesh; ring: THREE.Mesh; markers: THREE.Group; markerKey: string }

export class SquareOverlays {
  readonly group = new THREE.Group();
  private cells = new Map<Square, Cell>();
  private time = 0;
  private spriteCache = new Map<string, THREE.Sprite>();

  constructor() {
    this.group.name = 'overlays';
    const tintGeo = new THREE.PlaneGeometry(0.97, 0.97);
    const dotGeo = new THREE.CircleGeometry(0.11, 24);
    const ringGeo = new THREE.RingGeometry(0.36, 0.46, 32);
    for (const s of ALL_SQUARES) {
      const p = squareToWorld(s);
      const tint = new THREE.Mesh(tintGeo, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      tint.rotation.x = -Math.PI / 2; tint.position.set(p.x, 0.004, p.z); tint.renderOrder = 2;
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
      dot.rotation.x = -Math.PI / 2; dot.position.set(p.x, 0.006, p.z); dot.visible = false; dot.renderOrder = 3;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.007, p.z); ring.visible = false; ring.renderOrder = 3;
      const markers = new THREE.Group();
      markers.position.set(p.x, 0, p.z);
      this.group.add(tint, dot, ring, markers);
      this.cells.set(s, { tint, dot, ring, markers, markerKey: '' });
    }
  }

  private sprite(glyph: string, color: string) {
    const key = glyph + color;
    let s = this.spriteCache.get(key);
    if (!s) { s = glyphSprite(glyph, color); this.spriteCache.set(key, s); }
    return s.clone();
  }

  set(state: OverlayState) {
    const moves = new Set(state.moves ?? []), caps = new Set(state.captures ?? []), targets = new Set(state.targets ?? []), threats = new Set(state.threats ?? []), intel = new Set(state.intel ?? []);
    const effectMap = new Map<Square, { kind: EffectKind; mine: boolean }[]>();
    for (const e of state.effects ?? []) for (const s of e.squares) { const l = effectMap.get(s) ?? []; l.push({ kind: e.kind, mine: e.mine }); effectMap.set(s, l); }
    for (const [s, c] of this.cells) {
      const mat = c.tint.material as THREE.MeshBasicMaterial;
      let color: THREE.Color | null = null, opacity = 0;
      if (state.lastMove && (state.lastMove[0] === s || state.lastMove[1] === s)) { color = COLORS.last; opacity = 0.22; }
      if (threats.has(s)) { color = COLORS.threat; opacity = 0.16; }
      if (intel.has(s)) { color = COLORS.intel; opacity = 0.3; }
      if (state.hover === s) { color = COLORS.hover; opacity = 0.12; }
      if (state.selected === s) { color = COLORS.selected; opacity = 0.42; }
      if (targets.has(s)) { color = COLORS.target; opacity = 0.38; }
      if (state.check === s) { color = COLORS.check; opacity = 0.55; }
      if (color) mat.color.copy(color);
      mat.opacity = opacity;
      c.tint.userData.pulse = state.check === s || targets.has(s);
      c.tint.userData.baseOpacity = opacity;
      c.dot.visible = moves.has(s) && !caps.has(s);
      c.ring.visible = caps.has(s);
      const fx = effectMap.get(s) ?? [];
      const key = fx.map((f) => f.kind + f.mine).join(',');
      if (key !== c.markerKey) {
        c.markers.clear();
        fx.forEach((f, i) => {
          const st = EFFECT_STYLE[f.kind];
          if (!st.glyph) return;
          const sp = this.sprite(st.glyph, st.color);
          sp.position.set((i - (fx.length - 1) / 2) * 0.25, 0.18, 0.28);
          c.markers.add(sp);
          if (f.kind === 'shield' || f.kind === 'freeze' || f.kind === 'no_capture' || f.kind === 'mine') {
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.48, 32), new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: f.kind === 'mine' ? 0.5 : 0.75, depthWrite: false, toneMapped: false }));
            ring.rotation.x = -Math.PI / 2; ring.position.y = 0.009;
            c.markers.add(ring);
          }
        });
        c.markerKey = key;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    const pulse = 0.65 + Math.sin(this.time * 5) * 0.35;
    for (const c of this.cells.values()) {
      if (c.tint.userData.pulse) (c.tint.material as THREE.MeshBasicMaterial).opacity = c.tint.userData.baseOpacity * pulse;
      if (c.ring.visible) c.ring.scale.setScalar(0.95 + Math.sin(this.time * 6) * 0.05);
      for (const m of c.markers.children) if ((m as THREE.Sprite).isSprite) m.position.y = 0.2 + Math.sin(this.time * 2 + c.tint.position.x) * 0.03;
    }
  }
}
