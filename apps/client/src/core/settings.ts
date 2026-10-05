import { create } from 'zustand';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  shadows: 0 | 1024 | 2048 | 4096;
  dpr: number;
  particles: number;
  postprocessing: 0 | 1 | 2;
  environmentDetail: number;
  textureSize: 256 | 512 | 1024 | 2048;
  reflections: boolean;
  animationQuality: 'low' | 'high';
}

export const GRAPHICS_PRESETS: Record<GraphicsPreset, Omit<GraphicsSettings, 'preset'>> = {
  low: { shadows: 0, dpr: 1, particles: 0.35, postprocessing: 0, environmentDetail: 0.35, textureSize: 256, reflections: false, animationQuality: 'low' },
  medium: { shadows: 1024, dpr: 1.25, particles: 0.65, postprocessing: 1, environmentDetail: 0.65, textureSize: 512, reflections: false, animationQuality: 'high' },
  high: { shadows: 2048, dpr: 1.5, particles: 1, postprocessing: 2, environmentDetail: 1, textureSize: 1024, reflections: true, animationQuality: 'high' },
  ultra: { shadows: 4096, dpr: 2, particles: 1.4, postprocessing: 2, environmentDetail: 1.35, textureSize: 2048, reflections: true, animationQuality: 'high' },
};

export interface AudioSettings { master: number; music: number; ambience: number; sfx: number; voice: number; ui: number; muted: boolean }

export interface Settings {
  graphics: GraphicsSettings;
  audio: AudioSettings;
  /** Combat playback: 1 = normal, 1.5/2 faster, 0 = skip fights (instant capture). */
  combatSpeed: number;
  cameraSensitivity: number;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  autoQueen: boolean;
  reduceMotion: boolean;
  showFps: boolean;
}

const KEY = 'ashen.settings.v1';
const AUDIO_REV = 2;

function defaults(): Settings {
  return {
    graphics: { preset: 'high', ...GRAPHICS_PRESETS.high },
    audio: { master: 0.8, music: 0.22, ambience: 0.3, sfx: 0.85, voice: 0.8, ui: 0.6, muted: false },
    combatSpeed: 1, cameraSensitivity: 1, showCoordinates: true, showLegalMoves: true, autoQueen: false, reduceMotion: false, showFps: false,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = defaults();
      const s = JSON.parse(raw) as Partial<Settings> & { audioRev?: number };
      const audio = { ...d.audio, ...s.audio };
      // Rev 2 halved the music/ambience defaults; bring older saved levels down with them.
      if ((s.audioRev ?? 1) < AUDIO_REV) {
        audio.music /= 2; audio.ambience /= 2;
        localStorage.setItem(KEY, JSON.stringify({ ...s, audio, audioRev: AUDIO_REV }));
      }
      return { ...d, ...s, graphics: { ...d.graphics, ...s.graphics }, audio };
    }
  } catch { /* storage unavailable */ }
  return defaults();
}

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void;
  setPreset(p: GraphicsPreset): void;
  setGraphics(patch: Partial<GraphicsSettings>): void;
  setAudio(patch: Partial<AudioSettings>): void;
}

export const useSettings = create<SettingsStore>((set, get) => {
  const persist = () => {
    const { set: _a, setPreset: _b, setGraphics: _c, setAudio: _d, ...rest } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ ...rest, audioRev: AUDIO_REV })); } catch { /* ignore */ }
  };
  return {
    ...load(),
    set: (patch) => { set(patch); persist(); },
    setPreset: (p) => { set({ graphics: { preset: p, ...GRAPHICS_PRESETS[p] } }); persist(); },
    setGraphics: (patch) => { set({ graphics: { ...get().graphics, ...patch } }); persist(); },
    setAudio: (patch) => { set({ audio: { ...get().audio, ...patch } }); persist(); },
  };
});
