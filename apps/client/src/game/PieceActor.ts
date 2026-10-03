// PieceActor — one chess piece living on the board: placement, facing,
// selection glow, picking hitbox, and the PieceVisual that animates it.
import * as THREE from 'three';
import { PIECE_KEYS, type Color, type FactionId, type PieceClass, type PieceType, type Square } from '@ashen/shared';
import { facingYaw, squareToWorld } from './coords';
import type { PieceVisual } from './pieces/PieceVisual';

let nextId = 1;

export class PieceActor {
  readonly id = nextId++;
  readonly root = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  visual: PieceVisual;
  type: PieceType;
  color: Color;
  faction: FactionId;
  square: Square;
  alive = true;
  /** Set while the actor is part of a running combat/death so idle updates do not fight it. */
  busy = false;
  private selectRing: THREE.Mesh;
  private selected = false;
  private pulse = 0;

  constructor(visual: PieceVisual, type: PieceType, color: Color, faction: FactionId, square: Square) {
    this.visual = visual;
    this.type = type;
    this.color = color;
    this.faction = faction;
    this.square = square;
    this.root.name = `actor_${color}${type}_${square}`;
    this.root.add(visual.object);
    this.hitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, Math.max(0.6, visual.height), 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = Math.max(0.6, visual.height) / 2;
    this.hitbox.userData.actor = this;
    this.root.add(this.hitbox);
    this.selectRing = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.46, 40), new THREE.MeshBasicMaterial({ color: '#ffc861', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.y = 0.012;
    this.root.add(this.selectRing);
    this.placeAt(square);
  }

  get pieceClass(): PieceClass { return PIECE_KEYS[this.type]; }

  placeAt(s: Square) {
    this.square = s;
    squareToWorld(s, this.root.position);
    this.root.rotation.set(0, facingYaw(this.color), 0);
  }

  get position() { return this.root.position; }
  get yaw() { return this.root.rotation.y; }
  set yaw(v: number) { this.root.rotation.y = v; }

  /** Point near the chest — where hits land and effects spawn. */
  chest(out = new THREE.Vector3()) {
    return out.copy(this.root.position).setY(Math.max(0.25, this.visual.height * 0.6));
  }

  setSelected(on: boolean) { this.selected = on; }

  swapVisual(v: PieceVisual) {
    this.root.remove(this.visual.object);
    this.visual.dispose();
    this.visual = v;
    this.root.add(v.object);
    const h = Math.max(0.6, v.height);
    this.hitbox.geometry.dispose();
    this.hitbox.geometry = new THREE.CylinderGeometry(0.34, 0.36, h, 8);
    this.hitbox.position.y = h / 2;
  }

  update(dt: number) {
    this.visual.update(dt);
    this.pulse += dt;
    const mat = this.selectRing.material as THREE.MeshBasicMaterial;
    const target = this.selected ? 0.75 + Math.sin(this.pulse * 6) * 0.2 : 0;
    mat.opacity += (target - mat.opacity) * Math.min(1, dt * 12);
    this.selectRing.visible = mat.opacity > 0.01;
  }

  dispose() {
    this.visual.dispose();
    this.hitbox.geometry.dispose();
    this.selectRing.geometry.dispose();
    (this.selectRing.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}
