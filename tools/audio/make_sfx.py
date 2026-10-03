"""
Ashen Gambit sound effects: physically-inspired synthesis rendered offline to
OGG (apps/client/public/assets/audio/<id>.ogg). Everything here is original
synthesis — no samples — so the output is free to ship and to commit.

Building blocks: shaped noise (FFT-domain filters), damped modal resonators
(metal, wood, bone), pitch-swept oscillators, soft saturation and a synthetic
room/outdoor reverb. Each weapon gets its own recipe: a gunshot is a crack +
muzzle boom + mechanical action + environment tail; a blade is an air swish
with a ringing edge; a pipe is a dull thud with a short metallic ring.

Usage: python tools/audio/make_sfx.py [out_dir]
"""
import os, subprocess, sys, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "apps", "client", "public", "assets", "audio")


# ---------------------------------------------------------------- primitives
def t(dur): return np.arange(int(SR * dur)) / SR

def noise(dur, color="white"):
    n = rng.standard_normal(int(SR * dur))
    if color == "pink": n = shape(n, lambda f: 1 / np.sqrt(np.maximum(f, 20)))
    if color == "brown": n = shape(n, lambda f: 1 / np.maximum(f, 20))
    return n / (np.abs(n).max() + 1e-9)

def shape(x, gain_of_f):
    """Apply an arbitrary magnitude response in the frequency domain."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * gain_of_f(f), len(x))

def bandpass(x, lo, hi, soft=1.5):
    return shape(x, lambda f: 1 / (1 + (lo / np.maximum(f, 1)) ** (2 * soft)) / (1 + (f / hi) ** (2 * soft)))

def lowpass(x, fc, order=2): return shape(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))
def highpass(x, fc, order=2): return shape(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1)) ** (2 * order)))

def env_exp(dur, decay, attack=0.001):
    tt = t(dur)
    a = np.clip(tt / max(attack, 1e-5), 0, 1)
    return a * np.exp(-tt / decay)

def env_ar(dur, attack, release):
    tt = t(dur)
    return np.clip(tt / attack, 0, 1) * np.clip((dur - tt) / release, 0, 1)

def modal(dur, freqs, decays, amps, jitter=0.0):
    """Sum of exponentially damped sinusoids — struck metal, wood, bone."""
    tt = t(dur)
    out = np.zeros_like(tt)
    for f, d, a in zip(freqs, decays, amps):
        f *= 1 + jitter * rng.uniform(-1, 1)
        out += a * np.sin(2 * np.pi * f * tt + rng.uniform(0, 6.28)) * np.exp(-tt / d)
    return out

def sweep(dur, f0, f1, wave="sine", curve=2.0):
    tt = t(dur)
    k = (tt / dur) ** curve
    f = f0 + (f1 - f0) * k
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) if wave == "sine" else np.sign(np.sin(ph)) * 0.6 + 0.4 * np.sin(ph * 2)

def sat(x, drive=2.0): return np.tanh(x * drive) / np.tanh(drive)

def mix(*parts, dur=None):
    n = max(len(p) + int(at * SR) for p, at in parts) if dur is None else int(SR * dur)
    out = np.zeros(n)
    for p, at in parts:
        i = int(at * SR)
        m = min(len(p), n - i)
        if m > 0: out[i:i + m] += p[:m]
    return out

def reverb(x, size=0.6, wet=0.25, damp=3000, predelay=0.012, echoes=0):
    """
    Outdoor/room acoustics: a few early reflections, an exponentially decaying
    filtered-noise tail (time constant ~ size/4) and optional discrete slapback
    echoes off distant walls. The wet level is set relative to the dry peak, so
    transients stay sharp and the tail sits well below them.
    """
    n = int(SR * (size * 1.2 + 0.05 + 0.5 * (echoes > 0)))
    ir = np.zeros(n)
    for _ in range(10):
        i = int(SR * (predelay + rng.uniform(0.002, 0.04) * size))
        ir[min(i, n - 1)] += rng.uniform(-0.5, 0.5)
    tail = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * size * 0.25))
    ir += lowpass(tail, damp) * 0.25
    for k in range(echoes):
        i = int(SR * (0.12 + 0.11 * k + rng.uniform(0, 0.05)))
        if i < n: ir[i:i + 400] += lowpass(rng.standard_normal(min(400, n - i)), 1500) * 0.5 * 0.6 ** k
    y = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n), len(x) + n)[: len(x) + n]
    dry = np.concatenate([x, np.zeros(n)])
    # Scale so the wet signal's loudest 50 ms window is `wet` of the dry peak window.
    w = 2205
    rms = lambda v: max(np.sqrt(np.mean(v[i:i + w] ** 2)) for i in range(0, max(1, len(v) - w), w))
    return dry + y * (wet * rms(dry) / (rms(y) + 1e-12))

def fade_out(x, sec=0.03):
    k = min(len(x), int(SR * sec))
    x = x.copy(); x[-k:] *= np.linspace(1, 0, k)
    return x

def norm(x, peak=0.89):
    x = x - np.mean(x[: min(len(x), 64)]) * 0
    m = np.abs(x).max()
    return x / m * peak if m > 0 else x

def trim(x, thresh=0.0008):
    idx = np.where(np.abs(x) > thresh * np.abs(x).max())[0]
    return x[: idx[-1] + 1] if len(idx) else x


# ---------------------------------------------------------------- weapons: firearms
def gunshot(caliber=1.0, crack=1.0, body_hz=90, tail=0.9, action=None, dist_lp=None):
    """Supersonic crack + muzzle blast (low boom) + action mechanics + outdoor slapback tail."""
    d = 0.9 + tail
    crk = highpass(noise(0.012), 2500) * env_exp(0.012, 0.0025) * crack
    blast = lowpass(noise(0.35, "pink"), 2200 * caliber ** -0.3) * env_exp(0.35, 0.045 * caliber, 0.0006)
    boom = sweep(0.25, body_hz * 1.9, body_hz * 0.7, curve=0.5) * env_exp(0.25, 0.06 * caliber) * 0.9
    snap = bandpass(noise(0.05), 800, 5000) * env_exp(0.05, 0.008) * 0.6
    x = mix((crk, 0), (sat(blast * 1.4, 2.5), 0.0005), (boom, 0.001), (snap, 0), dur=d)
    if action == "bolt":
        x = mix((x, 0), (mech_click(0.6), 0.42), (mech_click(0.45, 1800), 0.55), dur=d + 0.3)
    elif action == "pump":
        x = mix((x, 0), (pump(), 0.38), dur=d + 0.4)
    elif action == "revolver":
        x = mix((x, 0), (mech_click(0.25, 2600), 0.3), dur=d + 0.1)
    x = reverb(x, size=tail * 0.6, wet=0.22, damp=2600, echoes=3)
    if dist_lp: x = lowpass(x, dist_lp)
    return trim(norm(x))

def mech_click(level=0.5, hz=3200):
    c = bandpass(noise(0.03), hz * 0.6, hz * 2.2) * env_exp(0.03, 0.004)
    r = modal(0.08, [hz * 0.9, hz * 1.37, hz * 2.1], [0.01, 0.008, 0.005], [0.4, 0.3, 0.2])
    return mix((c, 0), (r, 0)) * level

def pump():
    back = bandpass(noise(0.09), 400, 3000) * env_ar(0.09, 0.01, 0.04) * 0.4
    return mix((back, 0), (mech_click(0.7, 1500), 0.08), (bandpass(noise(0.08), 300, 2500) * env_ar(0.08, 0.01, 0.03) * 0.4, 0.14), (mech_click(0.8, 2000), 0.22))

def smg_burst(n=4, gap=0.075):
    shot = gunshot(caliber=0.6, crack=0.7, body_hz=130, tail=0.35)
    shot = shot[: int(SR * 0.16)] * np.linspace(1, 0.3, int(SR * 0.16))
    parts = [(shot * (1 - 0.06 * i), i * gap) for i in range(n)]
    x = mix(*parts, dur=n * gap + 0.9)
    return trim(norm(reverb(x, 0.6, 0.25)))

def crossbow():
    """String release twang + limb thump + bolt whoosh."""
    twang = modal(0.5, [110, 220.5, 331, 445], [0.12, 0.08, 0.05, 0.03], [1, 0.5, 0.3, 0.15]) * 0.7
    thump = lowpass(noise(0.06), 600) * env_exp(0.06, 0.012) * 0.9
    whoosh = bandpass(noise(0.35), 600, 4000) * env_ar(0.35, 0.03, 0.3) * 0.35
    clack = mech_click(0.6, 1400)
    return trim(norm(reverb(mix((clack, 0), (thump, 0.003), (twang, 0.004), (whoosh, 0.02)), 0.4, 0.18)))

def flare_gun():
    """Hollow pop + sizzling magnesium hiss."""
    pop = lowpass(noise(0.12, "pink"), 1400) * env_exp(0.12, 0.02) * 1.2
    boom = sweep(0.18, 160, 60, curve=0.5) * env_exp(0.18, 0.05)
    hiss = highpass(noise(1.4), 3000) * env_ar(1.4, 0.05, 1.0) * 0.28 * (1 + 0.4 * np.sin(2 * np.pi * 13 * t(1.4)))
    return trim(norm(reverb(mix((pop, 0), (boom, 0), (hiss, 0.04)), 0.7, 0.25)))


# ---------------------------------------------------------------- melee
def swish(dur=0.32, lo=500, hi=3500, heavy=False):
    """Air displaced by a moving object: band-passed noise with a Doppler-ish rise and fall."""
    n = noise(dur)
    tt = t(dur)
    center = np.sin(np.pi * tt / dur) ** 2
    out = np.zeros_like(n)
    for k, (a, b) in enumerate([(lo, lo * 2), (lo * 2, hi * 0.7), (hi * 0.7, hi * 1.4)]):
        out += bandpass(n, a, b) * center ** (1 + k * 0.6)
    if heavy: out = out * 0.7 + lowpass(noise(dur, "brown"), 300) * center * 0.6
    return norm(out * env_ar(dur, dur * 0.35, dur * 0.4), 0.7)

def blade_slash():
    ring = modal(0.6, [2350, 3610, 5230, 7020], [0.25, 0.18, 0.1, 0.07], [0.35, 0.25, 0.15, 0.1], 0.02) * 0.45
    return trim(norm(reverb(mix((swish(0.28, 900, 6000), 0), (ring, 0.06)), 0.35, 0.15)))

def flesh_impact(weight=1.0, wet=0.4):
    """Body hit: low thump + wet slap + cloth."""
    thump = lowpass(noise(0.18, "brown"), 220 * weight ** -0.4) * env_exp(0.18, 0.04 * weight, 0.002) * 1.3
    tone = sweep(0.12, 120, 55, curve=0.6) * env_exp(0.12, 0.035) * 0.9
    slap = bandpass(noise(0.05), 900, 4500) * env_exp(0.05, 0.007) * wet
    cloth = bandpass(noise(0.12), 2000, 7000) * env_exp(0.12, 0.03) * 0.15
    return mix((sat(thump, 2), 0), (tone, 0), (slap, 0.001), (cloth, 0.004))

def blade_hit():
    cut = bandpass(noise(0.14), 1500, 8000) * env_exp(0.14, 0.025) * 0.7
    return trim(norm(reverb(mix((flesh_impact(0.8, 0.9), 0), (cut, 0)), 0.3, 0.12)))

def blunt_hit(metal_ring=0.5):
    """Pipe / bat: heavy thud, crunch, short ring of a hollow steel tube."""
    ring = modal(0.5, [612, 1688, 3301, 5442], [0.12, 0.08, 0.05, 0.03], [0.5, 0.35, 0.2, 0.1], 0.03) * metal_ring
    crunch = bandpass(noise(0.07), 300, 2500) * env_exp(0.07, 0.015) * 0.6
    return trim(norm(reverb(mix((flesh_impact(1.3, 0.3), 0), (crunch, 0), (ring, 0.002)), 0.3, 0.14)))

def axe_hit():
    chop = modal(0.25, [190, 410, 730], [0.05, 0.03, 0.02], [0.8, 0.5, 0.3]) * 0.6
    return trim(norm(reverb(mix((flesh_impact(1.2, 0.8), 0), (chop, 0), (bandpass(noise(0.1), 1200, 6000) * env_exp(0.1, 0.02) * 0.5, 0)), 0.3, 0.12)))

def chain_whip():
    """Rattling links accelerating, then a crack."""
    parts = []
    for i in range(14):
        at = 0.015 * i ** 1.15
        parts.append((modal(0.06, [2800 + rng.uniform(-400, 400), 4100, 6500], [0.02, 0.012, 0.008], [0.4, 0.3, 0.2]) * (0.3 + i / 20), at))
    crack = highpass(noise(0.02), 2000) * env_exp(0.02, 0.003) * 1.2
    parts += [(crack, 0.27), (swish(0.25, 700, 4000) * 0.5, 0.02)]
    return trim(norm(reverb(mix(*parts), 0.35, 0.15)))

def electric_zap(dur=0.45):
    """Arc: buzzing 120 Hz harmonic stack with random crackle bursts."""
    tt = t(dur)
    buzz = sum(np.sin(2 * np.pi * 120 * k * tt + rng.uniform(0, 6)) / k for k in range(1, 16))
    buzz *= (rng.random(len(tt)) < 0.4) * 0.6 + 0.4
    crackle = highpass(noise(dur), 2500) * (rng.random(len(tt)) < 0.08) * 1.5
    x = (sat(buzz * 0.5, 3) * 0.5 + crackle) * env_ar(dur, 0.005, 0.12)
    return trim(norm(reverb(x, 0.25, 0.1)))

def energy_shot():
    """Sci-fi but grounded: capacitor whine dump + plasma crack."""
    whine = sweep(0.35, 2400, 300, curve=0.4) * env_exp(0.35, 0.09) * 0.5
    crack = highpass(noise(0.05), 1800) * env_exp(0.05, 0.008)
    body = lowpass(noise(0.3, "pink"), 900) * env_exp(0.3, 0.05) * 0.6
    return trim(norm(reverb(mix((crack, 0), (whine, 0), (body, 0.002)), 0.6, 0.25)))

def metal_impact(size=1.0):
    """Armour / robot plating struck."""
    ring = modal(1.2, [310 / size, 870 / size, 1530 / size, 2410 / size, 3870 / size], [0.4, 0.3, 0.2, 0.12, 0.08], [0.6, 0.45, 0.3, 0.2, 0.1], 0.03)
    clank = bandpass(noise(0.05), 800, 6000) * env_exp(0.05, 0.008)
    return trim(norm(reverb(mix((clank, 0), (ring * 0.5, 0.001), (lowpass(noise(0.1, "brown"), 300) * env_exp(0.1, 0.03), 0)), 0.5, 0.2)))

def parry():
    ring = modal(0.9, [1870, 2950, 4630, 6210], [0.3, 0.2, 0.14, 0.08], [0.6, 0.4, 0.25, 0.15], 0.02)
    return trim(norm(reverb(mix((bandpass(noise(0.03), 2000, 9000) * env_exp(0.03, 0.004), 0), (ring * 0.6, 0.001)), 0.4, 0.2)))

def punch():
    return trim(norm(reverb(flesh_impact(0.9, 0.6), 0.25, 0.1)))


# ---------------------------------------------------------------- bodies, footsteps, world
def footstep_gravel():
    grains = sum(bandpass(noise(0.12), 1500, 7000) * (rng.random(int(SR * 0.12)) < 0.02) for _ in range(2))
    heel = lowpass(noise(0.08, "brown"), 400) * env_exp(0.08, 0.015)
    return trim(norm(mix((heel, 0), (grains * env_exp(0.12, 0.04) * 1.5, 0.005)) * 0.8, 0.6))

def footstep_metal():
    return trim(norm(mix((footstep_gravel() * 0.5, 0), (modal(0.25, [420, 1130, 2210], [0.06, 0.04, 0.03], [0.4, 0.3, 0.2]), 0)), 0.6))

def servo_step():
    whirr = sweep(0.22, 900, 1400, "square", 1) * env_ar(0.22, 0.02, 0.08) * 0.15
    return trim(norm(mix((footstep_metal(), 0.1), (bandpass(whirr, 500, 4000), 0)), 0.6))

def chains_step():
    return trim(norm(mix((footstep_gravel(), 0), (chain_whip()[: int(SR * 0.2)] * 0.4, 0.01)), 0.6))

def body_fall(weight=1.0):
    thud = lowpass(noise(0.35, "brown"), 180) * env_exp(0.35, 0.07 * weight)
    dirt = bandpass(noise(0.4), 800, 6000) * env_exp(0.4, 0.09) * 0.3
    gear = modal(0.3, [700, 1650], [0.05, 0.03], [0.2, 0.1])
    return trim(norm(reverb(mix((sat(thud * 1.5, 2), 0), (dirt, 0.01), (gear, 0.02), (lowpass(noise(0.2, "brown"), 200) * env_exp(0.2, 0.04) * 0.5, 0.18)), 0.4, 0.15)))

def explosion(size=1.0, debris=True):
    d = 2.5 * size
    blast = lowpass(noise(d, "brown"), 700) * env_exp(d, 0.35 * size, 0.004)
    crack = highpass(noise(0.05), 1500) * env_exp(0.05, 0.01)
    rumble = lowpass(noise(d, "brown"), 120) * env_exp(d, 0.8 * size) * 0.8
    parts = [(sat(blast * 2, 3), 0), (crack, 0), (rumble, 0.02)]
    if debris:
        for _ in range(int(25 * size)):
            parts.append((bandpass(noise(0.05), 1500, 6000) * env_exp(0.05, 0.01) * rng.uniform(0.05, 0.25), rng.uniform(0.2, 1.4) * size))
    return trim(norm(reverb(mix(*parts), 1.2, 0.3, 1800)))

def distant_boom():
    return trim(norm(lowpass(explosion(1.4, False), 400) * 0.6, 0.5))

def collapse_metal():
    parts = [(metal_impact(1.3) * 0.8, 0)]
    for i in range(8): parts.append((metal_impact(rng.uniform(0.6, 1.5)) * rng.uniform(0.2, 0.5), 0.08 + i * rng.uniform(0.05, 0.12)))
    parts.append((body_fall(1.6) * 0.8, 0.05))
    return trim(norm(mix(*parts)))

def power_down():
    hum = sweep(1.1, 220, 40, "square", 0.6) * env_ar(1.1, 0.01, 0.4) * 0.3
    return trim(norm(mix((bandpass(hum, 60, 3000), 0), (electric_zap(0.25) * 0.4, 0))))

def ground_slam():
    return trim(norm(mix((body_fall(2.0), 0), (explosion(0.5, True) * 0.6, 0))))

def wind_loop(dur=8.0):
    """Seamless gusty wind for ambience."""
    n = noise(dur + 1, "pink")
    gust = 0.55 + 0.45 * np.sin(2 * np.pi * (t(dur + 1) / dur) * 3 + 1) * np.sin(2 * np.pi * t(dur + 1) * 0.17)
    x = bandpass(n, 150, 1800) * gust + highpass(n, 2500) * 0.15 * gust ** 2
    x = x[: int(SR * dur)] * np.linspace(1, 1, int(SR * dur))
    k = int(SR * 0.5)
    x[:k] = x[:k] * np.linspace(0, 1, k) + x[-k:] * np.linspace(1, 0, k)  # crossfade loop
    return norm(x[: int(SR * dur) - k], 0.5)


# ---------------------------------------------------------------- derby
def hoof_beat():
    thud = lowpass(noise(0.08, "brown"), 300) * env_exp(0.08, 0.014) * 1.6
    dirt = bandpass(noise(0.1), 700, 4000) * env_exp(0.1, 0.02) * 0.4
    return mix((thud, 0), (dirt, 0.003))

def gallop_loop(bpm=110, dur=4.0, horses=2):
    """Several horses galloping on dirt: 4-beat gallop pattern per horse, de-phased."""
    beat = 60 / bpm
    parts = []
    for h in range(horses):
        off = rng.uniform(0, beat)
        k = 0
        while off + k * beat < dur:
            for s, a in zip([0, 0.09, 0.17, 0.24], [0.7, 0.9, 0.8, 1.0]):
                parts.append((hoof_beat() * a * rng.uniform(0.75, 1.0) / horses ** 0.5, off + k * beat + s * beat * 1.2))
            k += 1
    x = mix(*parts, dur=dur) + lowpass(noise(dur, "brown"), 120) * 0.05  # distant pack rumble
    return norm(reverb(x, 0.3, 0.1)[: int(SR * dur)], 0.7)

def crowd_roar(dur=3.5):
    """Grandstand cheer: many voices = band-limited noise with vowel formants and swells."""
    n = noise(dur, "pink")
    tt = t(dur)
    swell = np.clip(np.sin(np.pi * tt / dur) * 1.4, 0, 1) ** 0.7
    out = np.zeros_like(n)
    for f0, bw, a in [(500, 300, 1.0), (1100, 500, 0.7), (2400, 800, 0.35)]:
        out += bandpass(n, f0 - bw / 2, f0 + bw / 2, 3) * a
    whistles = sum(sweep(0.4, f, f * 1.3) * env_ar(0.4, 0.05, 0.2) * 0.05 for f in rng.uniform(1800, 3200, 4))
    x = mix((out * swell, 0), *[(whistles, rng.uniform(0.3, dur - 0.6)) for _ in range(3)])
    return norm(reverb(x, 1.0, 0.3), 0.75)

def horse_hit_fall():
    return trim(norm(mix((body_fall(2.2), 0), (hoof_beat() * 0.6, 0.0), (hoof_beat() * 0.5, 0.12), (bandpass(noise(0.9), 400, 3000) * env_exp(0.9, 0.25) * 0.4, 0.1))))


# ---------------------------------------------------------------- recipe table
SOUNDS = {
    # firearms
    "gun_pistol": lambda: gunshot(0.7, 0.8, 140, 0.7, None),
    "gun_revolver": lambda: gunshot(1.0, 0.9, 105, 0.9, "revolver"),
    "gun_rifle": lambda: gunshot(1.2, 1.2, 85, 1.0, None),
    "gun_sniper": lambda: gunshot(1.6, 1.4, 70, 1.3, "bolt"),
    "gun_shotgun": lambda: gunshot(1.7, 0.6, 65, 1.0, "pump"),
    "gun_smg": lambda: smg_burst(4),
    "gunshot": lambda: gunshot(1.2, 1.2, 85, 1.0, None),
    "crossbow_shot": crossbow,
    "flare_shot": flare_gun,
    "energy_shot": energy_shot,
    # melee
    "swing_light": lambda: swish(0.26, 700, 4500),
    "swing_heavy": lambda: swish(0.42, 300, 2600, heavy=True),
    "swing_blade": lambda: blade_slash(),
    "swing_hydraulic": lambda: trim(norm(mix((swish(0.4, 300, 2500, True), 0), (sweep(0.4, 300, 900, "square", 1) * env_ar(0.4, 0.05, 0.15) * 0.15, 0)))),
    "swing_energy": lambda: trim(norm(mix((swish(0.3, 800, 5000) * 0.6, 0), (electric_zap(0.3) * 0.5, 0.02)))),
    "hit_flesh": punch,
    "hit_blade": blade_hit,
    "hit_blunt": lambda: blunt_hit(0.5),
    "hit_axe": axe_hit,
    "hit_metal": lambda: metal_impact(1.0),
    "hit_energy": lambda: trim(norm(mix((electric_zap(0.35), 0), (flesh_impact(0.8) * 0.7, 0)))),
    "chain_whip": chain_whip,
    "electric_zap": lambda: electric_zap(0.5),
    "block": parry,
    # bodies / world
    "step_boots": footstep_gravel,
    "step_servo": servo_step,
    "step_chains": chains_step,
    "step_armor": footstep_metal,
    "fall_light": lambda: body_fall(0.7),
    "fall_body": lambda: body_fall(1.0),
    "fall_heavy": lambda: body_fall(1.6),
    "metal_collapse": collapse_metal,
    "servo_shutdown": power_down,
    "armor_fail": lambda: trim(norm(mix((metal_impact(0.8), 0), (power_down() * 0.6, 0.1)))),
    "debris": lambda: trim(norm(mix(*[(bandpass(noise(0.06), 900, 6000) * env_exp(0.06, 0.012) * rng.uniform(0.2, 1), rng.uniform(0, 0.8)) for _ in range(30)]))),
    "crash": lambda: trim(norm(mix((collapse_metal(), 0), (explosion(0.4, True) * 0.5, 0)))),
    "ground_slam": ground_slam,
    "execution": lambda: trim(norm(mix((gunshot(1.4, 1.2, 80, 1.1), 0), (body_fall(1.2) * 0.8, 0.35)))),
    "mine_blast": lambda: explosion(1.0),
    "amb_distant_explosion": distant_boom,
    "amb_wind": wind_loop,
    # derby
    "derby_gallop": gallop_loop,
    "derby_crowd": crowd_roar,
    "derby_fall": horse_hit_fall,
}


def write_ogg(name, x):
    os.makedirs(OUT, exist_ok=True)
    wav = os.path.join(OUT, f"_{name}.wav")
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    ogg = os.path.join(OUT, f"{name}.ogg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4", ogg], check=True)
    os.remove(wav)
    return os.path.getsize(ogg)


if __name__ == "__main__":
    only = set(sys.argv[2:])
    total = 0
    for name, fn in SOUNDS.items():
        if only and name not in only: continue
        x = fade_out(fn())
        size = write_ogg(name, x)
        total += size
        print(f"{name:24s} {len(x) / SR:5.2f}s {size / 1024:6.1f} KB", flush=True)
    print(f"total {total / 1024:.0f} KB -> {os.path.abspath(OUT)}")
