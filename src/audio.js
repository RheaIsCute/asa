// ═══════════════════════════════════════════════════════════
// AUDIO ENGINE — Beat Detection + Smoothed Frequency Bands
//
// A single shared AudioContext powers both the music analyser and
// the UI sound effects. Creating a context per SFX call leaks them
// (browsers cap concurrent contexts at ~6), so everything routes
// through `getContext()` below.
// ═══════════════════════════════════════════════════════════

export const audioState = {
  initialized: false,
  playing: false,
  sub: 0,
  bass: 0,
  mid: 0,
  high: 0,
  smoothSub: 0,
  smoothBass: 0,
  smoothMid: 0,
  smoothHigh: 0,
  beatDetected: false,
  beatEnergy: 0,
  lastBeatTime: 0,
  energyAccumulator: 0,
  /** Normalised 0..1 progress through the current track. */
  progress: 0,
  duration: 0,
  currentTime: 0,
  raw: new Uint8Array(128)
};

const FFT_SIZE = 256;
const BIN_COUNT = FFT_SIZE / 2;

let audioCtx = null;
let analyser = null;
let sourceNode = null;
let musicGain = null;
let sfxGain = null;
let element = null;

/** Lazily create (and resume) the one shared AudioContext. */
const getContext = () => {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
};

export const getAudioElement = () => element;

export const initAudio = (src = '/music_and_me.mp3') => {
  if (audioState.initialized) return;

  const ctx = getContext();
  if (!ctx) return;

  analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  // Low smoothing keeps transients intact so beat detection stays snappy;
  // perceptual smoothing is applied in software below instead.
  analyser.smoothingTimeConstant = 0.4;
  audioState.raw = new Uint8Array(analyser.frequencyBinCount);

  element = new Audio(src);
  element.crossOrigin = 'anonymous';
  element.loop = true;
  element.preload = 'auto';
  element.volume = 1;

  musicGain = ctx.createGain();
  musicGain.gain.value = 0.45;

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 1;
  sfxGain.connect(ctx.destination);

  sourceNode = ctx.createMediaElementSource(element);
  sourceNode.connect(analyser);
  analyser.connect(musicGain);
  musicGain.connect(ctx.destination);

  audioState.initialized = true;
};

export const playAudio = () => {
  getContext();
  if (!element) return Promise.resolve();
  return element
    .play()
    .then(() => {
      audioState.playing = true;
    })
    .catch(() => {
      // Autoplay rejection — the splash screen gesture normally prevents this.
      audioState.playing = false;
    });
};

export const pauseAudio = () => {
  if (!element) return;
  element.pause();
  audioState.playing = false;
};

export const setVolume = (value) => {
  const v = Math.min(Math.max(value, 0), 1);
  if (musicGain && audioCtx) {
    // Ramp rather than snap, so dragging the slider doesn't click.
    musicGain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
  }
  return v;
};

export const setMuted = (muted) => {
  if (element) element.muted = muted;
  if (sfxGain && audioCtx) {
    sfxGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.02);
  }
  return muted;
};

export const disposeAudio = () => {
  if (element) {
    element.pause();
    element.src = '';
    element.load();
  }
  audioState.playing = false;
};

// ── Rolling energy history for beat detection ──
// Sized in seconds rather than frames so detection behaves identically
// on 60Hz and 144Hz displays.
const HISTORY_SECONDS = 0.75;
const energyHistory = [];
let energySum = 0;
let prevEnergy = 0;

const pushEnergy = (value, now) => {
  energyHistory.push({ value, time: now });
  energySum += value;
  while (energyHistory.length && now - energyHistory[0].time > HISTORY_SECONDS * 1000) {
    energySum -= energyHistory.shift().value;
  }
  return energyHistory.length ? energySum / energyHistory.length : value;
};

/**
 * Sample the analyser and refresh `audioState`.
 * @param {number} delta Seconds since the previous call.
 */
export const updateAudioData = (delta = 1 / 60) => {
  if (!analyser) return;

  if (element) {
    audioState.currentTime = element.currentTime;
    audioState.duration = element.duration || 0;
    audioState.progress = audioState.duration
      ? Math.min(audioState.currentTime / audioState.duration, 1)
      : 0;
  }

  if (!audioState.playing) {
    // Decay toward silence so visuals settle instead of freezing mid-pulse.
    const decay = Math.pow(0.02, delta);
    audioState.smoothSub *= decay;
    audioState.smoothBass *= decay;
    audioState.smoothMid *= decay;
    audioState.smoothHigh *= decay;
    audioState.beatDetected = false;
    return;
  }

  analyser.getByteFrequencyData(audioState.raw);
  const raw = audioState.raw;

  let subSum = 0;
  for (let i = 0; i < 4; i++) subSum += raw[i];
  audioState.sub = subSum / 4 / 255;

  let bassSum = 0;
  for (let i = 4; i < 12; i++) bassSum += raw[i];
  audioState.bass = bassSum / 8 / 255;

  let midSum = 0;
  for (let i = 12; i < 50; i++) midSum += raw[i];
  audioState.mid = midSum / 38 / 255;

  let highSum = 0;
  for (let i = 50; i < BIN_COUNT; i++) highSum += raw[i];
  audioState.high = highSum / (BIN_COUNT - 50) / 255;

  // ── Frame-rate independent smoothing (fast attack, slow release) ──
  const attack = 1 - Math.pow(0.001, delta);
  const release = Math.pow(0.08, delta);

  const smooth = (current, target) =>
    target > current ? current + (target - current) * attack : current * release;

  audioState.smoothSub = smooth(audioState.smoothSub, audioState.sub);
  audioState.smoothBass = smooth(audioState.smoothBass, audioState.bass);
  audioState.smoothMid = smooth(audioState.smoothMid, audioState.mid);
  audioState.smoothHigh = smooth(audioState.smoothHigh, audioState.high);

  // ── Beat detection via spectral flux against a rolling average ──
  const now = performance.now();
  const currentEnergy = audioState.bass + audioState.sub * 0.5;
  const avgEnergy = pushEnergy(currentEnergy, now);
  const timeSinceLastBeat = now - audioState.lastBeatTime;

  audioState.beatDetected =
    currentEnergy > avgEnergy * 1.35 &&
    currentEnergy > 0.2 &&
    currentEnergy > prevEnergy &&
    timeSinceLastBeat > 120;

  if (audioState.beatDetected) {
    audioState.lastBeatTime = now;
    // Normalise against the local average so quiet passages still register
    // a usable punch instead of always maxing out in loud sections.
    audioState.beatEnergy = Math.min(currentEnergy / Math.max(avgEnergy, 0.05) - 1, 2);
  }

  audioState.energyAccumulator = Math.min(
    audioState.energyAccumulator * Math.pow(0.6, delta) +
      (audioState.beatDetected ? currentEnergy * 0.3 : 0),
    3
  );
  prevEnergy = currentEnergy;
};

// ═══════════════════════════════════════════════════════════
// UI SOUND EFFECTS — synthesised on the shared context
// ═══════════════════════════════════════════════════════════

const SFX = {
  download: (ctx, t, out) => {
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    sub.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.18);
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    sub.connect(gain);
    gain.connect(out);
    osc.start(t);
    sub.start(t);
    osc.stop(t + 0.24);
    sub.stop(t + 0.24);
  },
  copy: (ctx, t, out) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(2800, t + 0.05);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.07);
  },
  virustotal: (ctx, t, out) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(950, t);
    osc.frequency.exponentialRampToValueAtTime(1900, t + 0.1);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.14);
  },
  step: (ctx, t, out) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    gain.gain.setValueAtTime(0.03, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.07);
  },
  hover: (ctx, t, out) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, t);
    gain.gain.setValueAtTime(0.012, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.05);
  },
  select: (ctx, t, out) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.07);
    gain.gain.setValueAtTime(0.028, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.11);
  },
  back: (ctx, t, out) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(680, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.09);
    gain.gain.setValueAtTime(0.028, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.13);
  },
  complete: (ctx, t, out) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      const at = t + idx * 0.05;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.04, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain);
      gain.connect(out);
      osc.start(at);
      osc.stop(at + 0.23);
    });
  }
};

/**
 * Play a short synthesised UI cue on the shared context.
 * Nodes are garbage collected once they finish, so nothing accumulates.
 */
export const playSFX = (type = 'select') => {
  const build = SFX[type];
  if (!build) return;
  const ctx = getContext();
  if (!ctx) return;
  try {
    // Route through sfxGain when it exists so mute applies; otherwise go direct
    // (SFX can fire on the standalone page before the music engine is set up).
    build(ctx, ctx.currentTime, sfxGain || ctx.destination);
  } catch {
    // A failed cue must never break the interaction that triggered it.
  }
};
