// Player-controlled music: everyone hears the shared playlist the admins
// curate, but each player chooses what plays — pick a track, skip, shuffle,
// hide tracks they don't like, or switch back to the game's ambient score.
// Playback goes through the AudioManager's music bus (volume, mute, ducking).

import { create } from 'zustand';
import type { MusicTrack } from '@ashen/shared';
import { AudioManager } from './AudioManager';
import { withBase } from './base';

const PREFS = 'ashen.music';
interface Prefs { source: 'playlist' | 'ambient'; shuffle: boolean; hidden: string[]; last: string | null }
const loadPrefs = (): Prefs => {
  try { return { source: 'playlist', shuffle: false, hidden: [], last: null, ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') }; }
  catch { return { source: 'playlist', shuffle: false, hidden: [], last: null }; }
};

interface MusicStore extends Prefs {
  tracks: MusicTrack[];
  current: string | null;
  playing: boolean;
  setTracks(t: MusicTrack[]): void;
  play(id?: string): void;
  pause(): void;
  toggle(): void;
  next(dir?: 1 | -1): void;
  setSource(s: 'playlist' | 'ambient'): void;
  setShuffle(on: boolean): void;
  toggleHidden(id: string): void;
}

let audio: HTMLAudioElement | null = null;
const el = () => {
  if (!audio) {
    audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.addEventListener('ended', () => useMusic.getState().next(1));
    audio.addEventListener('error', () => { if (useMusic.getState().playing) window.setTimeout(() => useMusic.getState().next(1), 800); });
  }
  return audio;
};

const save = (s: Prefs) => { try { localStorage.setItem(PREFS, JSON.stringify({ source: s.source, shuffle: s.shuffle, hidden: s.hidden, last: s.last })); } catch { /* private mode */ } };

export const useMusic = create<MusicStore>((set, get) => ({
  ...loadPrefs(),
  tracks: [],
  current: null,
  playing: false,
  setTracks: (tracks) => {
    const first = get().tracks.length === 0;
    set({ tracks });
    const s = get();
    // Start the playlist on its own once there is music and the player hasn't chosen the game score.
    if (first && tracks.length && s.source === 'playlist' && !s.playing && AudioManager.unlocked) get().play();
    if (s.current && !tracks.some((t) => t.id === s.current)) { el().pause(); set({ current: null, playing: false }); }
  },
  play: (id) => {
    const s = get();
    const pool = s.tracks.filter((t) => !s.hidden.includes(t.id));
    const track = s.tracks.find((t) => t.id === id) ?? s.tracks.find((t) => t.id === s.current) ?? s.tracks.find((t) => t.id === s.last && !s.hidden.includes(t.id)) ?? pool[0];
    if (!track) return;
    AudioManager.unlock();
    AudioManager.connectMedia(el());
    AudioManager.stopMusic();
    const a = el();
    const src = withBase(track.url);
    if (!a.src.endsWith(src)) a.src = src;
    void a.play().catch(() => set({ playing: false }));
    set({ current: track.id, playing: true, source: 'playlist', last: track.id });
    save(get());
  },
  pause: () => { el().pause(); set({ playing: false }); },
  toggle: () => (get().playing ? get().pause() : get().play()),
  next: (dir = 1) => {
    const s = get();
    const pool = s.tracks.filter((t) => !s.hidden.includes(t.id));
    if (!pool.length) return;
    const i = pool.findIndex((t) => t.id === s.current);
    const n = s.shuffle && pool.length > 1 ? pool.filter((t) => t.id !== s.current)[Math.floor(Math.random() * (pool.length - 1))] : pool[(i + dir + pool.length) % pool.length];
    get().play(n.id);
  },
  setSource: (source) => {
    set({ source });
    save(get());
    if (source === 'ambient') { el().pause(); set({ playing: false }); AudioManager.startMusic(); }
    else get().play();
  },
  setShuffle: (shuffle) => { set({ shuffle }); save(get()); },
  toggleHidden: (id) => {
    const hidden = get().hidden.includes(id) ? get().hidden.filter((x) => x !== id) : [...get().hidden, id];
    set({ hidden });
    save(get());
    if (hidden.includes(id) && get().current === id) get().next(1);
  },
}));
