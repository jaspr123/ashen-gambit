// Music library: admins upload tracks into a shared playlist; every player
// picks what they listen to client-side. Files and the playlist index live on
// the uploads volume (uploadDir/music) so they survive redeploys.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MusicTrack } from '@ashen/shared';
import { config } from '../config.js';
import type { Hub } from './hub.js';

const MAX_BYTES = 30 * 1024 * 1024;

/** Sniff the container from magic bytes; never trust the client's filename or MIME type. */
export function sniffAudio(buf: Buffer): 'mp3' | 'ogg' | 'wav' | 'm4a' | 'flac' | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (buf.subarray(0, 4).toString('latin1') === 'fLaC') return 'flac';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'm4a';
  return null;
}

export class MusicManager {
  private tracks: MusicTrack[] = [];
  private dir = path.join(config.uploadDir, 'music');
  private index = path.join(this.dir, 'playlist.json');

  constructor(private hub: Hub) {}

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    try { this.tracks = JSON.parse(await fs.readFile(this.index, 'utf8')); } catch { this.tracks = []; }
  }

  list() { return this.tracks; }

  private async save() {
    await fs.writeFile(this.index, JSON.stringify(this.tracks, null, 2));
    this.hub.emitAll('music:playlist', this.tracks);
  }

  async add(buf: Buffer, meta: { title: string; artist: string; addedBy: string }): Promise<MusicTrack> {
    if (buf.length > MAX_BYTES) throw new Error('file_too_large');
    const kind = sniffAudio(buf);
    if (!kind) throw new Error('not_audio');
    const id = crypto.randomBytes(8).toString('hex');
    const file = `${id}.${kind}`;
    await fs.writeFile(path.join(this.dir, file), buf);
    const clean = (s: string, d: string) => (s || d).replace(/[\u0000-\u001f<>]/g, '').slice(0, 80).trim() || d;
    const track: MusicTrack = { id, title: clean(meta.title, 'Untitled'), artist: clean(meta.artist, 'Unknown'), url: `/uploads/music/${file}`, addedBy: meta.addedBy, addedAt: Date.now() };
    this.tracks.push(track);
    await this.save();
    return track;
  }

  async remove(id: string) {
    const t = this.tracks.find((x) => x.id === id);
    if (!t) throw new Error('no_track');
    this.tracks = this.tracks.filter((x) => x !== t);
    await fs.rm(path.join(this.dir, path.basename(t.url)), { force: true });
    await this.save();
  }

  async move(id: string, delta: number) {
    const i = this.tracks.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('no_track');
    const j = Math.max(0, Math.min(this.tracks.length - 1, i + delta));
    const [t] = this.tracks.splice(i, 1);
    this.tracks.splice(j, 0, t);
    await this.save();
  }
}
