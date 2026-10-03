import * as THREE from 'three';
import type { Color, Square } from '@ashen/shared';

/** One board square = 1 world unit. Board centred on the origin, top surface at y = 0. */
export const SQUARE = 1;
export const BOARD_HALF = 4;

export function squareToWorld(s: Square | string, out = new THREE.Vector3()): THREE.Vector3 {
  const f = s.charCodeAt(0) - 97;
  const r = Number(s[1]) - 1;
  return out.set((f - 3.5) * SQUARE, 0, (3.5 - r) * SQUARE);
}

export function worldToSquare(p: THREE.Vector3): Square | null {
  const f = Math.floor(p.x / SQUARE + 4);
  const r = Math.floor(4 - p.z / SQUARE);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return `${'abcdefgh'[f]}${r + 1}` as Square;
}

/** Facing yaw for a side's pieces: white looks toward black (-z), black toward +z. Models face +z. */
export function facingYaw(c: Color) { return c === 'w' ? Math.PI : 0; }

export function yawToward(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function shortestAngle(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}
