// AudioManager — buses (master/music/ambience/sfx/voice/ui), file-first
// playback with procedural fallbacks. Drop /assets/audio/<soundId>.ogg in
// public/ to replace any placeholder without touching code.

import { SOUNDS, SOUNDS_BY_ID, type AudioBus } from '@ashen/shared';
import { useSettings } from './settings';
import { withBase } from './base';

type Bus = AudioBus | 'master';

class AudioManagerImpl {
  ctx: AudioContext | null = null;
  private buses = new Map<Bus, GainNode>();
  private buffers = new Map<string, AudioBuffer | null>();
  private noise: AudioBuffer | null = null;
  private ambience: { stop(): void } | null = null;
  private music: { stop(): void } | null = null;
  private explosionTimer: number | null = null;
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.buses.set('master', master);
    // Fetch every recorded sound up front so the first shot is not the synth placeholder.
    for (const s of SOUNDS) if (s.bus !== 'music') void this.loadFile(s.id);
    for (const b of ['music', 'ambience', 'sfx', 'voice', 'ui'] as AudioBus[]) {
      const g = ctx.createGain();
      g.connect(master);
      this.buses.set(b, g);
    }
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    useSettings.subscribe(() => this.applyVolumes());
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = useSettings.getState().audio;
    const set = (b: Bus, v: number) => this.buses.get(b)?.gain.setTargetAtTime(v, this.ctx!.currentTime, 0.05);
    set('master', a.muted ? 0 : a.master);
    set('music', a.music); set('ambience', a.ambience); set('sfx', a.sfx); set('voice', a.voice); set('ui', a.ui);
  }

  /** Duck everything except the given bus (checkmate sequence). */
  duck(amount: number, seconds = 0.6) {
    if (!this.ctx) return;
    const a = useSettings.getState().audio;
    for (const b of ['ambience', 'music'] as AudioBus[]) this.buses.get(b)?.gain.setTargetAtTime(a[b] * amount, this.ctx.currentTime, seconds / 3);
  }
  unduck() { this.applyVolumes(); }

  private async loadFile(id: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(id)) return this.buffers.get(id)!;
    this.buffers.set(id, null);
    try {
      const res = await fetch(withBase(`/assets/audio/${id}.ogg`));
      if (!res.ok || !res.headers.get('content-type')?.includes('audio')) return null;
      const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(id, buf);
      return buf;
    } catch { return null; }
  }

  /** Play a sound by catalogue id. `pan` -1..1, `volume` multiplier, `rate` pitch. */
  play(id: string, opts: { pan?: number; volume?: number; rate?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    // Avoid machine-gun duplicates of the same sound in the same frame.
    const now = performance.now();
    if (now - (this.lastPlayed.get(id) ?? 0) < 30) return;
    this.lastPlayed.set(id, now);
    const def = SOUNDS_BY_ID[id];
    const bus = this.buses.get(def?.bus ?? 'sfx')!;
    const out = ctx.createGain();
    out.gain.value = (def?.volume ?? 0.6) * (opts.volume ?? 1);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    out.connect(panner).connect(bus);
    const cached = this.buffers.get(id);
    if (cached) {
      const src = ctx.createBufferSource();
      src.buffer = cached;
      src.playbackRate.value = (opts.rate ?? 1) * (0.94 + Math.random() * 0.12);
      src.connect(out);
      src.start();
      return;
    }
    if (!this.buffers.has(id)) void this.loadFile(id);
    this.synth(def?.synth ?? 'click', out, opts.rate ?? 1);
  }

  // ------------------------------------------------------------------ procedural placeholders
  private noiseSrc(filterType: BiquadFilterType, freq: number, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    src.connect(f);
    return { src, f };
  }

  private env(g: GainNode, attack: number, decay: number, peak = 1) {
    const t = this.ctx!.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private burst(out: AudioNode, type: BiquadFilterType, freq: number, attack: number, decay: number, peak = 1, sweepTo?: number, q = 1) {
    const ctx = this.ctx!;
    const { src, f } = this.noiseSrc(type, freq, q);
    const g = ctx.createGain();
    f.connect(g).connect(out);
    this.env(g, attack, decay, peak);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + attack + decay);
    src.start(ctx.currentTime, Math.random());
    src.stop(ctx.currentTime + attack + decay + 0.05);
  }

  private tone(out: AudioNode, type: OscillatorType, freq: number, attack: number, decay: number, peak = 0.5, glideTo?: number, delay = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  private synth(kind: string, out: AudioNode, rate: number) {
    const r = rate * (0.9 + Math.random() * 0.2);
    switch (kind) {
      case 'step': this.burst(out, 'lowpass', 500 * r, 0.004, 0.08, 0.6); break;
      case 'servo': this.tone(out, 'sawtooth', 180 * r, 0.02, 0.18, 0.12, 320 * r); this.burst(out, 'bandpass', 2400, 0.005, 0.05, 0.2); break;
      case 'chain': for (let i = 0; i < 3; i++) this.tone(out, 'square', 1800 + Math.random() * 900, 0.002, 0.04, 0.05, undefined, i * 0.03); break;
      case 'clank': this.tone(out, 'triangle', 320 * r, 0.002, 0.15, 0.25); this.burst(out, 'highpass', 3000, 0.002, 0.05, 0.2); break;
      case 'whoosh': this.burst(out, 'bandpass', 900 * r, 0.06, 0.18, 0.5, 2600 * r, 0.8); break;
      case 'whoosh_low': this.burst(out, 'bandpass', 400 * r, 0.08, 0.25, 0.7, 1300 * r, 0.7); break;
      case 'hydraulic': this.burst(out, 'lowpass', 1200, 0.03, 0.3, 0.5, 300); this.tone(out, 'sawtooth', 90, 0.05, 0.3, 0.12, 60); break;
      case 'zap': this.tone(out, 'sawtooth', 900 * r, 0.005, 0.2, 0.18, 2400 * r); break;
      case 'thud': this.tone(out, 'sine', 110 * r, 0.003, 0.18, 0.9, 50); this.burst(out, 'lowpass', 900, 0.002, 0.09, 0.6); break;
      case 'thud_soft': this.tone(out, 'sine', 80 * r, 0.004, 0.22, 0.7, 40); this.burst(out, 'lowpass', 500, 0.004, 0.15, 0.5); break;
      case 'thud_heavy': this.tone(out, 'sine', 60 * r, 0.004, 0.45, 1, 30); this.burst(out, 'lowpass', 400, 0.004, 0.35, 0.9); break;
      case 'clang': [1, 2.76, 5.4].forEach((m, i) => this.tone(out, 'sine', 420 * r * m, 0.001, 0.5 / (i + 1), 0.35 / (i + 1))); this.burst(out, 'highpass', 4000, 0.001, 0.04, 0.4); break;
      case 'zap_hit': this.tone(out, 'square', 1200 * r, 0.002, 0.12, 0.2, 200); this.burst(out, 'bandpass', 3000, 0.002, 0.15, 0.5); break;
      case 'gun': this.burst(out, 'lowpass', 3000, 0.001, 0.12, 1.2, 300); this.tone(out, 'sine', 140, 0.001, 0.12, 0.8, 50); break;
      case 'laser': this.tone(out, 'sawtooth', 2200 * r, 0.002, 0.25, 0.25, 180); break;
      case 'boom': this.tone(out, 'sine', 70 * r, 0.005, 0.9, 1.2, 25); this.burst(out, 'lowpass', 1200, 0.005, 1.0, 1.1, 120); break;
      case 'boom_far': this.burst(out, 'lowpass', 220, 0.08, 2.2, 0.6, 60); break;
      case 'crash': this.burst(out, 'bandpass', 1800, 0.002, 0.5, 1, 400, 0.5); this.tone(out, 'triangle', 240, 0.002, 0.3, 0.4, 90); break;
      case 'powerdown': this.tone(out, 'sawtooth', 600 * r, 0.01, 0.9, 0.2, 40); this.burst(out, 'bandpass', 1500, 0.02, 0.3, 0.2); break;
      case 'debris': for (let i = 0; i < 6; i++) setTimeout(() => this.ctx && this.burst(out, 'bandpass', 1500 + Math.random() * 2500, 0.002, 0.07, 0.4, undefined, 2), i * 45 + Math.random() * 40); break;
      case 'tick': this.tone(out, 'square', 2400, 0.001, 0.02, 0.06); break;
      case 'click': this.tone(out, 'square', 1200, 0.001, 0.04, 0.12, 600); break;
      case 'blip': this.tone(out, 'triangle', 660, 0.002, 0.08, 0.25); this.tone(out, 'triangle', 990, 0.002, 0.1, 0.2, undefined, 0.06); break;
      case 'buzz': this.tone(out, 'sawtooth', 110, 0.005, 0.18, 0.2); break;
      case 'alert': [523, 659, 784].forEach((f, i) => this.tone(out, 'triangle', f, 0.005, 0.25, 0.25, undefined, i * 0.09)); break;
      case 'alarm': this.tone(out, 'square', 880, 0.005, 0.12, 0.12); this.tone(out, 'square', 660, 0.005, 0.12, 0.12, undefined, 0.14); break;
      case 'ability': this.tone(out, 'sine', 300, 0.02, 0.5, 0.3, 1200); this.burst(out, 'bandpass', 2000, 0.05, 0.4, 0.3, 6000, 3); break;
      case 'victory': [392, 523, 659, 784].forEach((f, i) => this.tone(out, 'sawtooth', f, 0.02, 0.9, 0.12, undefined, i * 0.16)); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => this.tone(out, 'sawtooth', f, 0.02, 0.9, 0.12, undefined, i * 0.22)); break;
      default: this.tone(out, 'square', 900, 0.001, 0.04, 0.08);
    }
  }

  // ------------------------------------------------------------------ loops
  startAmbience() {
    if (!this.ctx || this.ambience) return;
    const ctx = this.ctx;
    const bus = this.buses.get('ambience')!;
    const { src, f } = this.noiseSrc('bandpass', 400, 0.6);
    const g = ctx.createGain(); g.gain.value = 0.25;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(f.frequency);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lfo2Gain = ctx.createGain(); lfo2Gain.gain.value = 0.12;
    lfo2.connect(lfo2Gain).connect(g.gain);
    f.connect(g).connect(bus);
    src.start(); lfo.start(); lfo2.start();
    const scheduleBoom = () => {
      this.explosionTimer = window.setTimeout(() => { this.play('amb_distant_explosion', { pan: Math.random() * 1.6 - 0.8, volume: 0.4 + Math.random() * 0.5 }); scheduleBoom(); }, 9000 + Math.random() * 20000);
    };
    scheduleBoom();
    this.ambience = { stop: () => { src.stop(); lfo.stop(); lfo2.stop(); if (this.explosionTimer) clearTimeout(this.explosionTimer); } };
  }

  startMusic() {
    if (!this.ctx || this.music) return;
    const ctx = this.ctx;
    const bus = this.buses.get('music')!;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const oscs = [55, 55.4, 82.4, 110.2].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 300;
    lfo.connect(lg).connect(lp.frequency); lfo.start();
    lp.connect(g).connect(bus);
    this.music = { stop: () => { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.8); setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); }, 3000); } };
  }
  stopMusic() { this.music?.stop(); this.music = null; }

  /** Route an <audio> element (player playlist) through the music bus once. */
  private media = new WeakSet<HTMLMediaElement>();
  connectMedia(el: HTMLMediaElement) {
    if (!this.ctx || this.media.has(el)) return;
    this.media.add(el);
    this.ctx.createMediaElementSource(el).connect(this.buses.get('music')!);
  }
  get unlocked() { return !!this.ctx; }
}

export const AudioManager = new AudioManagerImpl();
