// Positional wrapper around the AudioManager: converts a world position into
// stereo pan relative to the active camera.
import * as THREE from 'three';
import { AudioManager } from '../core/AudioManager';

export interface AudioPlayer { play(id: string, at?: THREE.Vector3, opts?: { volume?: number; rate?: number }): void }

export class StageAudio implements AudioPlayer {
  camera: THREE.Camera | null = null;
  private v = new THREE.Vector3();
  muted = false;
  play(id: string, at?: THREE.Vector3, opts: { volume?: number; rate?: number } = {}) {
    if (this.muted) return;
    let pan = 0, vol = 1;
    if (at && this.camera) {
      this.v.copy(at).project(this.camera);
      pan = Math.max(-0.8, Math.min(0.8, this.v.x * 0.8));
      vol = 1 / (1 + Math.max(0, this.camera.position.distanceTo(at) - 8) * 0.06);
    }
    AudioManager.play(id, { pan, volume: (opts.volume ?? 1) * vol, rate: opts.rate });
  }
}
