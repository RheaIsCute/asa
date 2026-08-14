import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, useTexture } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import * as THREE from 'three';
import './App.css';

// ═══════════════════════════════════════════════════════════
// AUDIO ENGINE — Beat Detection + Smoothed Frequency Bands
// ═══════════════════════════════════════════════════════════

const audioState = {
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
  raw: new Uint8Array(128)
};

let audioCtx, analyser, source, audioRef;
let prevEnergy = 0;
const energyHistory = new Array(43).fill(0);
let historyIndex = 0;

const initAudio = () => {
  if (audioState.initialized) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.4; // Snappy response for beat detection
  audioState.raw = new Uint8Array(analyser.frequencyBinCount);

  audioRef = new Audio('/music_and_me.mp3');
  audioRef.crossOrigin = "anonymous";
  audioRef.loop = true;
  audioRef.volume = 0.45;

  source = audioCtx.createMediaElementSource(audioRef);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  audioState.initialized = true;
};

const playAudio = () => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  if (audioRef) {
    audioRef.play().catch(console.error);
    audioState.playing = true;
  }
};

const switchAudio = (src, playImmediately = false) => {
  if (!audioRef) return;
  const wasPlaying = audioState.playing;
  audioRef.pause();
  audioRef.src = src;
  audioRef.currentTime = 0;
  audioRef.load();
  if (wasPlaying || playImmediately) {
    audioRef.play().catch(console.error);
    audioState.playing = true;
  }
};

const toggleMute = () => {
  if (audioRef) {
    audioRef.muted = !audioRef.muted;
    return audioRef.muted;
  }
  return false;
};

const updateAudioData = () => {
  if (!audioState.playing || !analyser) return;

  analyser.getByteFrequencyData(audioState.raw);
  const bins = analyser.frequencyBinCount; // 128

  // Sub bass (deep rumble, bins 0-3)
  let subSum = 0;
  for (let i = 0; i < 4; i++) subSum += audioState.raw[i];
  audioState.sub = subSum / 4 / 255;

  // Bass (kicks + bass, bins 3-12)
  let bassSum = 0;
  for (let i = 3; i < 12; i++) bassSum += audioState.raw[i];
  audioState.bass = bassSum / 9 / 255;

  // Mid (vocals + instruments, bins 12-50)
  let midSum = 0;
  for (let i = 12; i < 50; i++) midSum += audioState.raw[i];
  audioState.mid = midSum / 38 / 255;

  // High (cymbals + air, bins 50-128)
  let highSum = 0;
  for (let i = 50; i < bins; i++) highSum += audioState.raw[i];
  audioState.high = highSum / (bins - 50) / 255;

  // ── Exponential Smoothing (fast attack, slow release) ──
  const attack = 0.35;
  const release = 0.92;

  const smooth = (current, target) =>
    target > current ? current * (1 - attack) + target * attack : current * release;

  audioState.smoothSub = smooth(audioState.smoothSub, audioState.sub);
  audioState.smoothBass = smooth(audioState.smoothBass, audioState.bass);
  audioState.smoothMid = smooth(audioState.smoothMid, audioState.mid);
  audioState.smoothHigh = smooth(audioState.smoothHigh, audioState.high);

  // ── Beat Detection via Spectral Flux ──
  const currentEnergy = audioState.bass + audioState.sub * 0.5;

  energyHistory[historyIndex % energyHistory.length] = currentEnergy;
  historyIndex++;
  const avgEnergy = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;

  const now = performance.now();
  const timeSinceLastBeat = now - audioState.lastBeatTime;

  audioState.beatDetected =
    currentEnergy > avgEnergy * 1.35 &&
    currentEnergy > 0.2 &&
    currentEnergy > prevEnergy &&
    timeSinceLastBeat > 120;

  if (audioState.beatDetected) {
    audioState.lastBeatTime = now;
    audioState.beatEnergy = currentEnergy;
    audioState.energyAccumulator = Math.min(audioState.energyAccumulator + currentEnergy * 0.3, 3.0);
  }

  audioState.energyAccumulator *= 0.995;
  prevEnergy = currentEnergy;

  // ── Pipe to CSS ──
  const root = document.documentElement.style;
  root.setProperty('--bass', audioState.smoothBass.toFixed(3));
  root.setProperty('--sub', audioState.smoothSub.toFixed(3));
  root.setProperty('--mid', audioState.smoothMid.toFixed(3));
  root.setProperty('--high', audioState.smoothHigh.toFixed(3));
};

// Drives audio analysis every single frame
const AudioDriver = () => {
  useFrame(() => { updateAudioData(); });
  return null;
};

// ═══════════════════════════════════════════════════════════
// 3D SCENE COMPONENTS
// ═══════════════════════════════════════════════════════════

const NORMAL_LYRICS = [
  // [Intro]
  { start: 0.50, end: 4.80, text: "(Ok is the hardest, I swear to God)" },
  { start: 4.90, end: 7.40, text: "(We gon' be okay)" },
  // [Chorus]
  { start: 9.10, end: 12.90, text: "I'm like, \"Where you at? Can't see you, I need you now\"" },
  { start: 13.00, end: 15.00, text: "You do it so right, dare to teach me how" },
  { start: 15.10, end: 18.30, text: "You talk about a feelin', I feel it now" },
  { start: 18.42, end: 20.80, text: "Look back if I could, but I'm not allowed" },
  { start: 20.98, end: 23.60, text: "I'm like, \"Where you at? Really need you now\"" },
  { start: 23.72, end: 26.20, text: "You do it so right, dare to teach me how" },
  { start: 26.34, end: 28.60, text: "You talk about a feelin', I feel it now" },
  { start: 28.74, end: 30.80, text: "Look back if I could, but I'm not allowed" },
  { start: 30.92, end: 33.70, text: "I'm crazy and I'm nervous and I'm sweatin' and I'm blushin'" },
  { start: 33.88, end: 36.50, text: "Think I'm doin' it for somethin', but I'm doin' it for nothin'" },
  { start: 36.62, end: 38.20, text: "The look on her face, tears runnin'" },
  { start: 38.36, end: 41.10, text: "Don't know what to say, but you still say somethin'" },
  { start: 41.28, end: 43.80, text: "Feel alive when you do what you're not allowed" },
  { start: 43.92, end: 46.80, text: "But you should know, this isn't what life 'bout" },
  { start: 46.92, end: 49.00, text: "I'ma die before I ever cry out" },
  { start: 49.18, end: 51.50, text: "And I'ma get struck down if I'm a liar" },
  { start: 51.62, end: 54.00, text: "Hot headed, leaf burnt, playin' with fire" },
  { start: 54.20, end: 56.20, text: "Would you ever trade your life for desire?" },
  { start: 56.36, end: 58.80, text: "Would you ever trade your life for desire?" },
  { start: 58.96, end: 59.50, text: "Would you ever—, uh" },
  { start: 59.66, end: 62.00, text: "Would you ever—, uh" },
  // [Verse 2]
  { start: 71.88, end: 75.00, text: "I'm like, \"Where you at? Can't see you, I need you now\"" },
  { start: 75.24, end: 77.70, text: "You do it so right, dare to teach me how" },
  { start: 77.84, end: 80.30, text: "You talk about a feelin', I feel it now" },
  { start: 80.46, end: 82.70, text: "Look back if I could, but I'm not allowed" },
  { start: 82.80, end: 85.40, text: "I'm like, \"Where you at? Really need you now\"" },
  { start: 85.58, end: 87.90, text: "You do it so right, dare to teach me how" },
  { start: 88.08, end: 90.40, text: "You talk about a feelin', I feel it now" },
  { start: 90.58, end: 93.10, text: "Look back if I could, but I'm not allowed" },
  { start: 93.28, end: 95.70, text: "I'm crazy and I'm nervous and I'm sweatin' and I'm blushin'" },
  { start: 95.88, end: 98.30, text: "Think I'm doin' it for somethin', but I'm doin' it for nothin'" },
  { start: 98.48, end: 100.00, text: "The look on her face, tears runnin'" },
  { start: 100.20, end: 103.00, text: "Don't know what to say, but you still say somethin'" },
  { start: 103.14, end: 105.60, text: "Feel alive when you do what you're not allowed" },
  { start: 105.74, end: 108.50, text: "But you should know, this isn't what life 'bout" },
  { start: 108.60, end: 111.00, text: "I'ma die before I ever cry out" },
  { start: 111.18, end: 113.30, text: "And I'ma get struck down if I'm a liar" },
  { start: 113.48, end: 116.20, text: "Hot headed, leaf burnt, playin' with fire" },
  { start: 116.32, end: 118.80, text: "Would you ever trade your life for desire?" },
  { start: 118.92, end: 122.50, text: "Would you ever trade your life for desire?" },
  { start: 122.60, end: 123.50, text: "Would you ever—, uh" },
  { start: 123.60, end: 127.00, text: "Would you ever—, uh" }
];

const FAV_SONG_LYRICS = [
  { start: 12.32, end: 13.90, text: "Make me an addict" },
  { start: 13.90, end: 15.44, text: "Make me an addict" },
  { start: 15.44, end: 18.50, text: "I'm going dumber every time I answer you" },
  { start: 18.50, end: 19.80, text: "Ooh ooh ooh ooh ooh" },
  { start: 19.80, end: 21.46, text: "Can't say no to you" },
  { start: 21.46, end: 22.80, text: "Ooh ooh ooh ooh ooh" },
  { start: 22.80, end: 24.42, text: "Can't say no to you" },
  { start: 24.42, end: 25.84, text: "Make me an addict" },
  { start: 25.84, end: 27.36, text: "Make me an addict" },
  { start: 27.36, end: 30.76, text: "I'm falling harder every time I cum for you" },
  { start: 30.76, end: 31.80, text: "Ooh ooh ooh ooh ooh" },
  { start: 31.80, end: 33.38, text: "Can't say no to you" },
  { start: 33.38, end: 34.82, text: "Ooh ooh ooh ooh ooh" },
  { start: 34.82, end: 36.32, text: "Can't say no to you" },
  { start: 36.32, end: 39.32, text: "Fall in deeper, falling into you" },
  { start: 39.32, end: 42.32, text: "Falling deeper, like you want me to" },
  { start: 42.32, end: 45.30, text: "Fall in deeper, falling into you" },
  { start: 45.30, end: 48.68, text: "Falling deeper, like you need me to" },
  { start: 48.68, end: 51.70, text: "Plug me in and baby I could be your quick fix" },
  { start: 51.70, end: 53.06, text: "Loving this addiction" },
  { start: 53.06, end: 54.70, text: "Entertainment sickness" },
  { start: 54.70, end: 57.08, text: "Getting off to all your desperation" },
  { start: 57.08, end: 60.68, text: "I love it, you love giving into temptation" },
  { start: 60.68, end: 63.08, text: "Love it when you call my name" },
  { start: 63.08, end: 64.84, text: "I don't wanna use my brain" },
  { start: 64.84, end: 67.80, text: "I just wanna be your secret and your plaything" },
  { start: 67.80, end: 68.38, text: "Ah ah ah ah" },
  { start: 68.38, end: 70.20, text: "Love it when you make me" },
  { start: 70.20, end: 70.66, text: "Ah ah ah ah" },
  { start: 70.66, end: 72.68, text: "Now come and ruin me baby" },
  { start: 72.68, end: 74.88, text: "And we never gave a fuck about each other" },
  { start: 74.88, end: 77.10, text: "And we never gave a fuck about each other" },
  { start: 77.10, end: 79.10, text: "Play with me until you go and find another" },
  { start: 79.10, end: 84.90, text: "Never really gave a fuck, now fuck me up" },
  { start: 84.90, end: 86.20, text: "Make me an addict" },
  { start: 86.20, end: 87.30, text: "Make me an addict" },
  { start: 87.30, end: 90.50, text: "I'm going dumber every time I answer you" },
  { start: 90.50, end: 91.80, text: "Ooh ooh ooh ooh ooh" },
  { start: 91.80, end: 93.46, text: "Can't say no to you" },
  { start: 93.46, end: 94.82, text: "Ooh ooh ooh ooh ooh" },
  { start: 94.82, end: 96.46, text: "Can't say no to you" },
  { start: 96.46, end: 97.84, text: "Make me an addict" },
  { start: 97.84, end: 99.30, text: "Make me an addict" },
  { start: 99.30, end: 102.50, text: "I'm falling harder every time I cum for you" },
  { start: 102.50, end: 103.80, text: "Ooh ooh ooh ooh ooh" },
  { start: 103.80, end: 105.54, text: "Can't say no to you" },
  { start: 105.54, end: 106.86, text: "Ooh ooh ooh ooh ooh" },
  { start: 106.86, end: 108.34, text: "Can't say no to you" },
  { start: 108.34, end: 111.56, text: "Fall in deeper, falling into you" },
  { start: 111.56, end: 114.32, text: "Falling deeper, like you want me to" },
  { start: 114.32, end: 117.34, text: "Fall in deeper, falling into you" },
  { start: 117.34, end: 120.22, text: "Falling deeper, like you need me to" },
  { start: 120.22, end: 126.48, text: "I'm going dumber every time I answer you" },
  { start: 126.48, end: 135.00, text: "And I'm falling harder every time I come for you" },
  { start: 135.00, end: 139.00, text: "I wanna be your fiend" },
  { start: 139.00, end: 143.90, text: "I wanna see you pleased" },
  { start: 143.90, end: 149.58, text: "I wanna prove I can match your freak" },
  { start: 149.58, end: 155.00, text: "Begging down on my knees for you to tease me" },
  { start: 155.00, end: 158.24, text: "And if I'm good, will I get a treat?" },
  { start: 158.24, end: 163.60, text: "So come and whisper all the dirty little things that you wanna do to me" },
  { start: 163.60, end: 168.44, text: "I'm a junkie, you're the drug that keeps me coming back for more" },
  { start: 168.44, end: 169.88, text: "Make me an addict" },
  { start: 169.88, end: 171.30, text: "Make me an addict" },
  { start: 171.30, end: 174.48, text: "I'm going dumber every time I answer you" },
  { start: 174.48, end: 175.80, text: "Ooh ooh ooh ooh ooh" },
  { start: 175.80, end: 177.50, text: "Can't say no to you" },
  { start: 177.50, end: 178.82, text: "Ooh ooh ooh ooh ooh" },
  { start: 178.82, end: 180.44, text: "Can't say no to you" },
  { start: 180.44, end: 181.84, text: "Make me an addict" },
  { start: 181.84, end: 183.34, text: "Make me an addict" },
  { start: 183.34, end: 186.50, text: "I'm falling harder every time I cum for you" },
  { start: 186.50, end: 187.80, text: "Ooh ooh ooh ooh ooh" },
  { start: 187.80, end: 189.72, text: "Can't say no to you" },
  { start: 189.72, end: 190.86, text: "Ooh ooh ooh ooh ooh" },
  { start: 190.86, end: 192.32, text: "Can't say no to you" },
  { start: 192.32, end: 195.32, text: "Fall in deeper, falling into you" },
  { start: 195.32, end: 198.32, text: "Falling deeper, like you want me to" },
  { start: 198.32, end: 201.32, text: "Fall in deeper, falling into you" },
  { start: 201.32, end: 204.24, text: "Falling deeper, like you need me to" },
  { start: 204.24, end: 207.24, text: "I need you so bad" },
];


// ── Lyrics Overlay (HTML — EXACT chromatic glitch effect matching ASA title) ──
const LyricsOverlay = ({ started, themeMode }) => {
  const [currentLyric, setCurrentLyric] = useState("");
  const textRef = useRef();
  const themeModeRef = useRef(themeMode);

  useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (!started) return;
    let raf;
    const tick = () => {
      if (audioRef && audioState.playing) {
        const t = audioRef.currentTime;
        const isFav = (themeModeRef.current === 'favSong') || (audioRef.src && audioRef.src.toLowerCase().includes('addict'));
        const activeArray = isFav ? FAV_SONG_LYRICS : NORMAL_LYRICS;
        const active = activeArray.find(l => t >= l.start && t <= l.end);
        setCurrentLyric(active ? active.text : "");

        // Drive exact same effect as SceneController
        if (textRef.current) {
          const bass = audioState.bass;
          const smoothBass = audioState.smoothBass;
          const beat = audioState.beatDetected;

          const floatY = Math.sin(performance.now() / 1000 * 2) * 15;
          const floatX = Math.cos(performance.now() / 1000 * 1.5) * 8;
          const bassScale = 1 + smoothBass * 0.35;
          const skewX = beat ? (Math.random() - 0.5) * bass * 30 : 0;

          textRef.current.style.transform = `translate(${floatX}px, ${floatY}px) scale(${bassScale}) skewX(${skewX}deg)`;

          const redLayer = textRef.current.querySelector('.asa-layer-r');
          const cyanLayer = textRef.current.querySelector('.asa-layer-c');
          const mainLayer = textRef.current.querySelector('.asa-layer-main');

          if (redLayer && cyanLayer && mainLayer) {
            if (beat) {
              const split = bass * 40;
              redLayer.style.transform = `translate(${split}px, ${-split * 0.5}px)`;
              redLayer.style.opacity = String(0.4 + bass * 0.6);
              cyanLayer.style.transform = `translate(${-split}px, ${split * 0.5}px)`;
              cyanLayer.style.opacity = String(0.4 + bass * 0.6);

              const y1 = Math.random() * 80;
              const h = 5 + Math.random() * 40;
              redLayer.style.clipPath = `inset(${y1}% 0 ${Math.max(0, 100 - y1 - h)}% 0)`;
              cyanLayer.style.clipPath = `inset(${100 - y1 - h}% 0 ${y1}% 0)`;
            } else {
              const drift = smoothBass * 8;
              redLayer.style.transform = `translate(${drift}px, 0)`;
              redLayer.style.opacity = String(0.1 + smoothBass * 0.3);
              cyanLayer.style.transform = `translate(${-drift}px, 0)`;
              cyanLayer.style.opacity = String(0.1 + smoothBass * 0.3);
              redLayer.style.clipPath = 'none';
              cyanLayer.style.clipPath = 'none';
            }

            // Use constant blur radii to avoid expensive GPU shadow recalculations every frame
            const coreAlpha = 0.4 + bass * 0.5;
            const outerAlpha = 0.1 + bass * 0.3;
            const rgbColor = isFav ? '255, 105, 180' : '160, 32, 240';
            mainLayer.style.textShadow = `0 0 30px rgba(${rgbColor}, ${coreAlpha}), 0 0 80px rgba(${rgbColor}, ${outerAlpha})`;
            mainLayer.style.color = `rgba(255, 255, 255, ${0.05 + bass * 0.2})`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started]);

  if (!currentLyric) return null;

  return (
    <div className="asa-title-wrapper" style={{ padding: '0 5%' }}>
      <div ref={textRef} className="asa-title-container" style={{ fontSize: 'clamp(1rem, 3.5vw, 3rem)', textTransform: 'uppercase' }}>
        <span className="asa-layer asa-layer-r">{currentLyric}</span>
        <span className="asa-layer asa-layer-c">{currentLyric}</span>
        <span className="asa-layer asa-layer-main" data-text={currentLyric}>{currentLyric}</span>
      </div>
    </div>
  );
};

// ── Intro Particles (3D — no Text component, just particles) ──
const IntroParticles = ({ playing, themeMode }) => {
  const groupRef = useRef();
  const meshRef = useRef();
  const particlesCount = 100;

  const particlesData = useMemo(() => {
    const data = [];
    for (let i = 0; i < particlesCount; i++) {
      data.push({
        pos: [(Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 15],
        speed: Math.random() * 1.5 + 0.3,
        targetPos: [(Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80]
      });
    }
    return data;
  }, [particlesCount]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    if (!playing || !groupRef.current || !meshRef.current) return;
    const elapsed = (performance.now() - (window.introTime || performance.now())) / 1000;

    if (elapsed < window.INTRO_DELAY_SEC) {
      const progress = Math.min(elapsed / window.INTRO_DELAY_SEC, 1);
      particlesData.forEach((p, i) => {
        dummy.position.set(
          THREE.MathUtils.lerp(p.pos[0], p.targetPos[0], progress * p.speed),
          THREE.MathUtils.lerp(p.pos[1], p.targetPos[1], progress * p.speed),
          THREE.MathUtils.lerp(p.pos[2], p.targetPos[2], progress * p.speed)
        );
        const s = 1 - progress * 0.5;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      });
      meshRef.current.instanceMatrix.needsUpdate = true;
    } else {
      groupRef.current.visible = false;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      <instancedMesh ref={meshRef} args={[null, null, particlesCount]}>
        <sphereGeometry args={[0.25, 6, 6]} />
        <meshBasicMaterial color={themeMode === 'favSong' ? "#ff69b4" : "#a020f0"} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
      </instancedMesh>
    </group>
  );
};

const HeartShapes = ({ themeMode }) => {
  const group = useRef();
  const count = 8;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const heartShape = useMemo(() => {
    const shape = new THREE.Shape();
    const x = -2.5, y = -5;
    shape.moveTo(x + 2.5, y + 2.5);
    shape.bezierCurveTo(x + 2.5, y + 2.5, x + 2.0, y, x, y);
    shape.bezierCurveTo(x - 3.0, y, x - 3.0, y + 3.5, x - 3.0, y + 3.5);
    shape.bezierCurveTo(x - 3.0, y + 5.5, x - 1.0, y + 7.7, x + 2.5, y + 9.5);
    shape.bezierCurveTo(x + 6.0, y + 7.7, x + 8.0, y + 5.5, x + 8.0, y + 3.5);
    shape.bezierCurveTo(x + 8.0, y + 3.5, x + 8.0, y, x + 5.0, y);
    shape.bezierCurveTo(x + 3.5, y, x + 2.5, y + 2.5, x + 2.5, y + 2.5);
    return shape;
  }, []);

  const shapesData = useMemo(() => {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push({
        pos: [(Math.random() - 0.5) * 150, (Math.random() - 0.5) * 100 + 40, (Math.random() - 0.5) * 150],
        rot: [Math.PI, Math.random() * Math.PI * 2, 0],
        speed: (Math.random() - 0.5) * 0.5,
        scale: Math.random() * 0.2 + 0.1,
      });
    }
    return data;
  }, [count]);

  useFrame((state, delta) => {
    if (group.current) {
      shapesData.forEach((shape, i) => {
        shape.pos[1] += Math.sin(state.clock.elapsedTime + i) * 0.05;
        shape.rot[1] += shape.speed * delta;
        dummy.position.set(...shape.pos);
        dummy.rotation.set(shape.rot[0], shape.rot[1], shape.rot[2]);
        const s = shape.scale * (1 + audioState.smoothBass * 0.5);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        group.current.setMatrixAt(i, dummy.matrix);
      });
      group.current.instanceMatrix.needsUpdate = true;
    }
  });

  const color = themeMode === 'favSong' ? '#ff1493' : '#a020f0';

  return (
    <instancedMesh ref={group} args={[null, null, count]}>
      <extrudeGeometry args={[heartShape, { depth: 0.5, bevelEnabled: false }]} />
      <meshBasicMaterial color={color} transparent opacity={0.3} wireframe />
    </instancedMesh>
  );
};

const FloatingHearts = ({ themeMode }) => {
  const group = useRef();
  const count = 25;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const heartShape = useMemo(() => {
    const shape = new THREE.Shape();
    const x = -2.5, y = -5;
    shape.moveTo(x + 2.5, y + 2.5);
    shape.bezierCurveTo(x + 2.5, y + 2.5, x + 2.0, y, x, y);
    shape.bezierCurveTo(x - 3.0, y, x - 3.0, y + 3.5, x - 3.0, y + 3.5);
    shape.bezierCurveTo(x - 3.0, y + 5.5, x - 1.0, y + 7.7, x + 2.5, y + 9.5);
    shape.bezierCurveTo(x + 6.0, y + 7.7, x + 8.0, y + 5.5, x + 8.0, y + 3.5);
    shape.bezierCurveTo(x + 8.0, y + 3.5, x + 8.0, y, x + 5.0, y);
    shape.bezierCurveTo(x + 3.5, y, x + 2.5, y + 2.5, x + 2.5, y + 2.5);
    return shape;
  }, []);

  const shapesData = useMemo(() => {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push({
        pos: [(Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 120],
        rot: [Math.PI, 0, 0],
        speedY: Math.random() * 0.8 + 0.3,
        scale: Math.random() * 0.08 + 0.03,
      });
    }
    return data;
  }, [count]);

  useFrame((state, delta) => {
    if (group.current && themeMode === 'favSong') {
      shapesData.forEach((shape, i) => {
        shape.pos[1] += shape.speedY * delta * 15;
        if (shape.pos[1] > 100) shape.pos[1] = -40;
        shape.rot[1] = Math.sin(state.clock.elapsedTime * 2 + i) * 0.3;
        dummy.position.set(...shape.pos);
        dummy.rotation.set(shape.rot[0], shape.rot[1], shape.rot[2]);
        const s = shape.scale * (1 + audioState.smoothBass * 0.3);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        group.current.setMatrixAt(i, dummy.matrix);
      });
      group.current.instanceMatrix.needsUpdate = true;
    }
  });

  if (themeMode !== 'favSong') return null;

  return (
    <instancedMesh ref={group} args={[null, null, count]}>
      <extrudeGeometry args={[heartShape, { depth: 0.2, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.1, bevelThickness: 0.1 }]} />
      <meshBasicMaterial color="#ff69b4" transparent opacity={0.5} blending={THREE.AdditiveBlending} />
    </instancedMesh>
  );
};

const HorizonTrees = () => {
  const texture = useTexture('/trees.png');
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(12, 1);

  const matRef = useRef();

  useFrame((state, delta) => {
    if (matRef.current) {
      matRef.current.map.offset.x += delta * 0.01;
      const b = audioState.smoothBass;
      matRef.current.color.setRGB(1 - b * 0.4, 1 - b * 0.9, 1 - b * 0.1);
      matRef.current.opacity = 0.5 + b * 0.3;
    }
  });

  return (
    <mesh position={[0, -25, 0]} rotation={[0, 0, 0]}>
      <cylinderGeometry args={[90, 90, 50, 32, 1, true]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        transparent
        opacity={0.6}
        color="white"
        side={THREE.BackSide}
      />
    </mesh>
  );
};

const VoidShapes = ({ themeMode }) => {
  const group = useRef();
  const count = 15;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const shapesData = useMemo(() => {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push({
        pos: [(Math.random() - 0.5) * 200, (Math.random() - 0.5) * 100 + 30, (Math.random() - 0.5) * 200],
        rot: [Math.random() * Math.PI, Math.random() * Math.PI, 0],
        speed: (Math.random() - 0.5) * 0.3,
        scale: Math.random() * 3 + 1,
        phaseOffset: Math.random() * Math.PI * 2
      });
    }
    return data;
  }, []);

  useFrame((state, delta) => {
    if (group.current) {
      const bassScale = 1 + audioState.smoothBass * 1.2;
      const beat = audioState.beatDetected;

      shapesData.forEach((shape, i) => {
        shape.rot[0] += (shape.speed + audioState.smoothMid * 0.5) * delta;
        shape.rot[1] += (shape.speed + audioState.smoothHigh * 0.3) * delta;

        // Pulse position outward on beat
        const beatPush = beat ? audioState.beatEnergy * 3 : 0;
        const dist = Math.sqrt(shape.pos[0] ** 2 + shape.pos[2] ** 2);
        const pushX = dist > 0 ? (shape.pos[0] / dist) * beatPush : 0;
        const pushZ = dist > 0 ? (shape.pos[2] / dist) * beatPush : 0;

        dummy.position.set(shape.pos[0] + pushX, shape.pos[1], shape.pos[2] + pushZ);
        dummy.rotation.set(...shape.rot);
        const s = shape.scale * bassScale;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        group.current.setMatrixAt(i, dummy.matrix);
      });
      group.current.instanceMatrix.needsUpdate = true;
    }
  });

  const color = themeMode === 'favSong' ? '#ff69b4' : '#a020f0';

  return (
    <instancedMesh ref={group} args={[null, null, count]}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.15} />
    </instancedMesh>
  );
};

const AmbientParticles = ({ themeMode }) => {
  const count = 150;
  const mesh = useRef();
  const matRef = useRef();

  const particles = useMemo(() => {
    const temp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      temp[i * 3] = (Math.random() - 0.5) * 250;
      temp[i * 3 + 1] = (Math.random() - 0.5) * 100 + 20;
      temp[i * 3 + 2] = (Math.random() - 0.5) * 250;
    }
    return temp;
  }, [count]);

  useFrame((state, delta) => {
    if (mesh.current && matRef.current) {
      mesh.current.rotation.y += delta * 0.05;
      mesh.current.position.y = Math.sin(state.clock.elapsedTime * 0.2) * 5;

      if (audioState.smoothBass > 0) {
        mesh.current.rotation.y += delta * audioState.smoothBass * 1.2;
        matRef.current.size = 0.4 + audioState.smoothBass * 2.0;
        matRef.current.opacity = 0.3 + audioState.smoothBass * 0.7;

        // Color shift on heavy bass
        const b = audioState.smoothBass;
        if (themeMode === 'favSong') {
          matRef.current.color.setRGB(1.0, 0.4 + b * 0.6, 0.7 + b * 0.3);
        } else {
          matRef.current.color.setRGB(0.63 + b * 0.37, 0.12 * (1 - b), 0.94);
        }
      }
    }
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={particles} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial ref={matRef} size={0.4} color="#a020f0" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
};

// ── Bass Shockwave Rings ──
const BassShockwaves = ({ themeMode }) => {
  const MAX_RINGS = 6;
  const ringsRef = useRef([]);
  const ringState = useRef(Array.from({ length: MAX_RINGS }, () => ({
    active: false,
    startTime: 0
  })));
  const nextRing = useRef(0);

  useFrame((state) => {
    // Spawn ring on beat
    if (audioState.beatDetected) {
      const idx = nextRing.current % MAX_RINGS;
      ringState.current[idx].active = true;
      ringState.current[idx].startTime = state.clock.elapsedTime;
      nextRing.current++;
    }

    // Update active rings
    ringState.current.forEach((ring, i) => {
      const mesh = ringsRef.current[i];
      if (!mesh) return;

      if (ring.active) {
        const elapsed = state.clock.elapsedTime - ring.startTime;
        const life = 2.0;
        const progress = elapsed / life;

        if (progress >= 1) {
          ring.active = false;
          mesh.visible = false;
        } else {
          mesh.visible = true;
          const scale = 1 + progress * 80;
          mesh.scale.set(scale, scale, 1);
          mesh.material.opacity = (1 - progress * progress) * 0.35;

          // White flash on spawn, fade to purple
          if (progress < 0.08) {
            mesh.material.color.setRGB(1, 1, 1);
          } else {
            mesh.material.color.setHex(themeMode === 'favSong' ? 0xff69b4 : 0xa020f0);
          }
        }
      } else {
        mesh.visible = false;
      }
    });
  });

  return (
    <group position={[0, -19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {Array.from({ length: MAX_RINGS }, (_, i) => (
        <mesh key={i} ref={el => ringsRef.current[i] = el} visible={false}>
          <ringGeometry args={[0.85, 1, 64]} />
          <meshBasicMaterial color={themeMode === 'favSong' ? "#ff69b4" : "#a020f0"} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
};

const RomanticSparkles = ({ themeMode }) => {
  const count = 300;
  const mesh = useRef();

  const particles = useMemo(() => {
    const temp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      temp[i * 3] = (Math.random() - 0.5) * 150;
      temp[i * 3 + 1] = (Math.random() - 0.5) * 100 + 20;
      temp[i * 3 + 2] = (Math.random() - 0.5) * 150;
    }
    return temp;
  }, [count]);

  useFrame((state, delta) => {
    if (mesh.current && themeMode === 'favSong') {
      mesh.current.rotation.y += delta * 0.15;
      mesh.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 2;
    }
  });

  if (themeMode !== 'favSong') return null;

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={particles} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.6} color="#fff" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
};

// ── Audio Visualizer Ring ──
const AudioVisualizerRing = ({ themeMode }) => {
  const meshRef = useRef();
  const barCount = 64;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const radius = 38;

  useFrame(() => {
    if (!meshRef.current || !audioState.playing) return;

    for (let i = 0; i < barCount; i++) {
      const angle = (i / barCount) * Math.PI * 2;
      const freqIndex = Math.floor((i / barCount) * 128);
      const value = audioState.raw[freqIndex] / 255;

      const barHeight = 0.3 + value * 14;

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      dummy.position.set(x, -19 + barHeight * 0.5, z);
      dummy.scale.set(0.35, barHeight, 0.35);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, barCount]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={themeMode === 'favSong' ? "#ff69b4" : "#a020f0"} transparent opacity={0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
};

// ── Reactive Floor Grid ──
const ReactiveFloor = ({ themeMode }) => {
  const meshRef = useRef();

  useFrame(() => {
    if (meshRef.current) {
      const b = audioState.smoothBass;
      meshRef.current.material.opacity = 0.1 + b * 0.35;
      if (themeMode === 'favSong') {
        meshRef.current.material.color.setRGB(b * 0.9 + 0.1, 0.05 + b * 0.2, 0.3 + b * 0.4);
      } else {
        meshRef.current.material.color.setRGB(0.02 + b * 0.4, 0, b * 0.6);
      }
    }
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -20, 0]}>
      <planeGeometry args={[300, 300, 32, 32]} />
      <meshBasicMaterial color="#050000" wireframe transparent opacity={0.15} />
    </mesh>
  );
};

// ── Reactive Fog ──
const ReactiveFog = () => {
  useFrame((state) => {
    if (state.scene.fog) {
      const breathing = Math.sin(state.clock.elapsedTime * 0.3) * 0.003;
      state.scene.fog.density = 0.012 + audioState.smoothBass * 0.01 + breathing;
    }
  });
  return null;
};

// ═══════════════════════════════════════════════════════════
// DATA — Section Content
// ═══════════════════════════════════════════════════════════

const R = 30;
window.isHoveringCard = false;

const ICONS = {
  identity: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
  socials: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
  status: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>'
};

const SECTIONS_DATA = [
  {
    id: 'identity',
    title: 'ABOUT ME',
    icon: ICONS.identity,
    width: '580px',
    camOffset: [-6, 3, 22],
    lookOffset: [0, 0, 0],
    content: `
      <div style="display: flex; gap: 25px; height: 100%;">
        <div style="flex: 0 0 220px; display: flex;">
          <img src="/profile.png" style="width: 100%; height: 100%; min-height: 250px; object-fit: cover; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);" />
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
          <div class="hud-grid" style="margin: 0; gap: 15px;">
            <div class="hud-block full"><div class="hud-label">BIRTHDAY</div><div class="hud-value mono">JUN 23</div></div>
            <div class="hud-block full"><div class="hud-label">AGE</div><div class="hud-value mono">18</div></div>
            <div class="hud-block full"><div class="hud-label">STATUS</div>
              <div class="hud-value small">Student</div>
              <div class="hud-value small" style="margin-top:6px; color:rgba(255,255,255,0.7)">Aspiring AI Engineer</div>
              <div class="hud-value small" style="margin-top:6px; color:rgba(255,255,255,0.7)">Technology & Programming</div>
            </div>
          </div>
        </div>
      </div>
    `
  },
  {
    id: 'socials',
    title: 'SOCIALS',
    icon: ICONS.socials,
    camOffset: [6, -2, 24],
    lookOffset: [0, 0, 0],
    content: `
      <div style="display: flex; flex-direction: column; height: 100%; border-radius: 12px; overflow: hidden; border: 1px solid rgba(160, 32, 240, 0.15);">
        <a href="https://www.instagram.com/hataeruu/" target="_blank" class="hud-block social-link" style="flex: 1; border: none; border-radius: 0; border-bottom: 1px solid rgba(160, 32, 240, 0.15); flex-direction:column; justify-content:center; align-items:center; gap: 8px; text-decoration: none;">
           <div style="width: 64px; height: 64px; fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: 0.9; pointer-events: none;">
             <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
           </div>
           <div class="hud-label" style="pointer-events: none;">Click to redirect</div>
        </a>
        <a href="https://discord.com/users/1408523273548988456" target="_blank" class="hud-block social-link" style="flex: 1; border: none; border-radius: 0; flex-direction:column; justify-content:center; align-items:center; gap: 8px; text-decoration: none;">
           <div style="width: 64px; height: 64px; fill: var(--accent); pointer-events: none;">
              <svg viewBox="0 0 24 24" style="stroke: none;"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
           </div>
           <div class="hud-label" style="pointer-events: none;">Click to redirect</div>
        </a>
      </div>
    `
  },
  {
    id: 'music',
    title: 'MUSIC',
    icon: ICONS.music,
    camOffset: [0, -5, 20],
    lookOffset: [0, 0, 0],
    content: ``
  },
  {
    id: 'archive',
    title: 'INTERESTS',
    icon: ICONS.archive,
    camOffset: [-5, -4, 25],
    lookOffset: [0, 0, 0],
    content: `
      <div class="hud-grid" style="gap: 12px;">
        <div class="hud-block full"><div class="hud-label">INTERESTS</div><div class="hud-value small">Programming / AI / Technology</div></div>
        <div class="hud-block full"><div class="hud-label">HOBBIES</div><div class="hud-value small">Gaming / Anime / Music / Japanese</div></div>
        <div class="hud-block full"><div class="hud-label">VIBE</div><div class="hud-value small">Cyber Y2K Ambient</div></div>
      </div>
    `
  },
  {
    id: 'status',
    title: 'CURRENTLY',
    icon: ICONS.status,
    camOffset: [4, 5, 23],
    lookOffset: [0, 0, 0],
    content: `
      <div class="hud-grid" style="gap: 15px;">
        <div class="hud-block full" style="flex-direction:row; justify-content:flex-start; gap:20px; padding: 20px;">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
          <div class="hud-data"><div class="hud-label">DOING</div><div class="hud-value">Learning & Building</div></div>
        </div>
        <div class="hud-block full" style="flex-direction:row; justify-content:flex-start; gap:20px; padding: 20px;">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg></div>
          <div class="hud-data"><div class="hud-label">FOCUS</div><div class="hud-value">AI / Programming</div></div>
        </div>
      </div>
    `
  }
];

const FAV_SONG_CARDS_DATA = [
  {
    id: 'fav-1', title: 'LOVE NOTE', icon: ICONS.identity, width: '400px',
    isFavCard: true,
    content: `<div class="hud-block full" style="padding: 20px;"><div style="font-size: 1.1rem; color: #ffb6c1; line-height: 1.6;">You make my heart skip a beat every time I see you. I just wanted to leave this here to remind you how much you mean to me. Every second with you feels like a dream I never want to wake up from.</div></div>`
  },
  {
    id: 'fav-2', title: 'MEMORIES', icon: ICONS.archive, width: '400px',
    isFavCard: true,
    content: `<div class="hud-block full" style="padding: 20px;"><div style="color: #fff; font-size: 1rem; line-height: 1.8;">&#x2022; Late night calls<br/>&#x2022; Playing games until 4AM<br/>&#x2022; Your beautiful laugh<br/>&#x2022; When we first met...</div></div>`
  },
  {
    id: 'fav-3', title: 'THINGS I LOVE ABOUT YOU', icon: ICONS.socials, width: '400px',
    isFavCard: true,
    content: `<div class="hud-block full" style="padding: 20px;"><div style="color: #ff69b4; font-size: 1rem; line-height: 1.8;">Everything. Your smile, your eyes, the way you say my name, how safe you make me feel. I'm addicted to you.</div></div>`
  },
  {
    id: 'fav-4', title: 'ABOUT ME', icon: ICONS.identity, width: '400px',
    isFavCard: true,
    content: `<div class="hud-block full" style="padding: 20px; text-align: center;"><div class="hud-label">STATUS</div><div class="hud-value" style="color: #ff69b4; font-size: 1.5rem; margin-top: 10px;">Completely Yours</div></div>`
  },
  {
    id: 'fav-5', title: 'IF YOU EVER READ THIS', icon: ICONS.status, width: '400px',
    isFavCard: true,
    content: `<div class="hud-block full" style="padding: 20px;"><div style="font-size: 1.1rem; color: #fff;">I love you. More than anything in this world. Never forget that. 💕</div></div>`
  }
];

// ═══════════════════════════════════════════════════════════
// CARD SYSTEM
// ═══════════════════════════════════════════════════════════

const CardParticles = ({ materialized, playing, dataIndex }) => {
  const count = 600;
  const meshRef = useRef();
  const matRef = useRef();

  const { targetPositions, currentPositions, colors } = useMemo(() => {
    const tPos = new Float32Array(count * 3);
    const cPos = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      tPos[i * 3] = (Math.random() - 0.5) * 22;
      tPos[i * 3 + 1] = (Math.random() - 0.5) * 32;
      tPos[i * 3 + 2] = (Math.random() - 0.5) * 2;

      cPos[i * 3] = tPos[i * 3] + (Math.random() - 0.5) * 40;
      cPos[i * 3 + 1] = tPos[i * 3 + 1] + 30 + Math.random() * 40;
      cPos[i * 3 + 2] = tPos[i * 3 + 2] + (Math.random() - 0.5) * 30;

      const r = Math.random();
      if (r > 0.6) {
        cols[i * 3] = 0; cols[i * 3 + 1] = 0; cols[i * 3 + 2] = 0;
      } else if (r > 0.3) {
        cols[i * 3] = 0.62; cols[i * 3 + 1] = 0.12; cols[i * 3 + 2] = 0.94;
      } else {
        cols[i * 3] = 0.8; cols[i * 3 + 1] = 0.5; cols[i * 3 + 2] = 1.0;
      }
    }
    return { targetPositions: tPos, currentPositions: cPos, colors: cols };
  }, [count]);

  useFrame((state, delta) => {
    if (!meshRef.current || !matRef.current || materialized) return;

    if (playing && window.introTime) {
      const timeSinceIntro = performance.now() - window.introTime;
      const startTime = window.INTRO_DELAY_SEC * 1000 + 2500 + dataIndex * 150;

      if (timeSinceIntro > startTime) {
        const positions = meshRef.current.geometry.attributes.position.array;
        const progress = Math.min((timeSinceIntro - startTime) / 800, 1);
        const scanY = 20 - progress * 40;

        for (let i = 0; i < count; i++) {
          const targetY = targetPositions[i * 3 + 1];
          if (targetY > scanY) {
            positions[i * 3] = THREE.MathUtils.lerp(positions[i * 3], targetPositions[i * 3], 15 * delta);
            positions[i * 3 + 1] = THREE.MathUtils.lerp(positions[i * 3 + 1], targetPositions[i * 3 + 1], 15 * delta);
            positions[i * 3 + 2] = THREE.MathUtils.lerp(positions[i * 3 + 2], targetPositions[i * 3 + 2], 15 * delta);
          } else {
            positions[i * 3 + 1] -= delta * 5;
          }
        }
        meshRef.current.geometry.attributes.position.needsUpdate = true;

        if (progress > 0.8) {
          matRef.current.opacity = (1 - progress) * 5 * 0.9;
        } else {
          matRef.current.opacity = 0.9;
        }
      } else {
        matRef.current.opacity = 0;
      }
    }
  });

  if (materialized) return null;

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={currentPositions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial ref={matRef} size={0.3} vertexColors transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
};

const FloatingPanel = ({ data, activeId, onClick, playing, carouselRef, themeMode, favSongStage, onPlayFavSong, onRevert, onFavCardClick }) => {
  const outerGroupRef = useRef();
  const innerGroupRef = useRef();
  const [materialized, setMaterialized] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  const getHeartTarget = (index) => {
    const map = [
      { x: 0, y: -22, z: 15 },
      { x: -12, y: -10, z: 12 },
      { x: -22, y: 2, z: 9 },
      { x: -25, y: 16, z: 6 },
      { x: -12, y: 25, z: 5 },
      { x: 0, y: 14, z: 8 },
      { x: 12, y: 25, z: 5 },
      { x: 25, y: 16, z: 6 },
      { x: 22, y: 2, z: 9 },
      { x: 12, y: -10, z: 12 },
    ];
    return map[index % 10];
  };

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.1);
    if (outerGroupRef.current && innerGroupRef.current) {
      if (favSongStage === 'playing') {
        const tPos = getHeartTarget(data.index);
        outerGroupRef.current.position.lerp(new THREE.Vector3(tPos.x, tPos.y + Math.sin(state.clock.elapsedTime + data.index) * 2, tPos.z), d * 3);

        const worldRotY = carouselRef.current ? carouselRef.current.rotation.y : 0;
        innerGroupRef.current.rotation.y = THREE.MathUtils.lerp(innerGroupRef.current.rotation.y, -worldRotY - data.angle, d * 3);
        innerGroupRef.current.rotation.x = THREE.MathUtils.lerp(innerGroupRef.current.rotation.x, 0, d * 3);
        innerGroupRef.current.position.z = THREE.MathUtils.lerp(innerGroupRef.current.position.z, 0, d * 3);
        innerGroupRef.current.scale.lerp(new THREE.Vector3(0.8, 0.8, 0.8), d * 3);
      } else {
        const baseFloat = Math.sin(state.clock.elapsedTime * 1.5 + data.index) * 0.5;
        const bassFloat = Math.sin(state.clock.elapsedTime * 3 + data.index * 0.7) * audioState.smoothBass * 1.5;
        outerGroupRef.current.position.lerp(new THREE.Vector3(data.x, baseFloat + bassFloat, data.z), d * 5);

        const targetScale = isHovered && !activeId ? 1.03 : 1.0;
        const targetZ = isHovered && !activeId ? 2.0 : 0;
        let targetRotX = isHovered && !activeId ? hoverPos.y * 0.2 : 0;
        let targetRotY = isHovered && !activeId ? -hoverPos.x * 0.2 : 0;

        if (isHovered && !activeId && carouselRef?.current) {
          const worldRotY = carouselRef.current.rotation.y + data.angle;
          let diff = -worldRotY;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          targetRotY += diff;
        }

        innerGroupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), d * 10);
        innerGroupRef.current.position.z = THREE.MathUtils.lerp(innerGroupRef.current.position.z, targetZ, d * 10);
        innerGroupRef.current.rotation.x = THREE.MathUtils.lerp(innerGroupRef.current.rotation.x, targetRotX, d * 10);
        innerGroupRef.current.rotation.y = THREE.MathUtils.lerp(innerGroupRef.current.rotation.y, targetRotY, d * 10);
      }

      if (playing && !materialized && window.introTime) {
        if (performance.now() - window.introTime > window.INTRO_DELAY_SEC * 1000 + 3300 + data.index * 150) {
          setMaterialized(true);
        }
      }
    }
  });

  const isActive = activeId === data.id;
  const isDimmed = activeId && !isActive && favSongStage !== 'playing';

  const handleClick = () => {
    if (data.isFavCard) {
      if (favSongStage === 'playing') {
        setIsGlitching(true);
        setTimeout(() => setIsGlitching(false), 300);
        if (onFavCardClick) onFavCardClick(data);
      }
      return;
    }

    if (!isActive && favSongStage !== 'playing') {
      setIsGlitching(true);
      setTimeout(() => setIsGlitching(false), 300);
      onClick(data.id);
    }
  };

  const handleMouseMove = (e) => {
    if (!isActive) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      setHoverPos({ x, y });
    }
  };

  return (
    <group ref={outerGroupRef} rotation={[0, data.angle, 0]}>
      <CardParticles materialized={materialized} playing={playing} dataIndex={data.index} themeMode={themeMode} />
      <group ref={innerGroupRef}>
        <Html transform distanceFactor={15} center zIndexRange={[100, 0]}>
          <div
            className={`html-panel ${isActive ? 'active' : ''} ${isDimmed ? 'dimmed' : ''} ${materialized ? 'materialized' : ''} ${isGlitching ? 'glitch-effect' : ''}`}
            style={data.width ? { width: data.width } : {}}
            onClick={handleClick}
            onMouseEnter={() => { window.isHoveringCard = true; setIsHovered(true); }}
            onMouseLeave={() => { window.isHoveringCard = false; setIsHovered(false); setHoverPos({ x: 0, y: 0 }); }}
            onMouseMove={handleMouseMove}
          >
            <h2 className="panel-title">
              <div dangerouslySetInnerHTML={{ __html: data.icon }} style={{ display: 'flex' }} />
              {data.title}
            </h2>
            <div className="panel-content-wrapper">
              {data.id !== 'music' && (
                <div className="panel-content" dangerouslySetInnerHTML={{ __html: data.content }} />
              )}

              {data.id === 'music' && (
                <div className="panel-content">
                  <div className="hud-grid">
                    <div className="hud-block full" style={{ padding: '24px' }}>
                      <div className="hud-label">NOW PLAYING</div>
                      <div className="hud-value" style={{ fontSize: '1.4rem', marginTop: '8px' }}>
                        {themeMode === 'favSong' && favSongStage === 'playing' ? 'Addict' : 'Music and me'}
                      </div>
                      <div className="hud-value small" style={{ marginTop: '8px', color: 'rgba(255,255,255,0.6)' }}>
                        {themeMode === 'favSong' && favSongStage === 'playing' ? 'by PiNKII x DAEGHO' : 'by Fakemink'}
                      </div>
                      <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '24px', position: 'relative', overflow: 'hidden' }}>
                        <div id="music-progress-bar" style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '0%', background: 'var(--accent)', borderRadius: '2px', boxShadow: '0 0 10px var(--accent)' }}></div>
                      </div>

                      <div style={{ marginTop: '24px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                        {themeMode === 'normal' ? (
                          <div className="hud-block hoverable" style={{ cursor: 'pointer', flex: 1, textAlign: 'center', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '12px' }} onClick={(e) => { e.stopPropagation(); onPlayFavSong(); }}>
                            <div className="hud-label" style={{ margin: 'auto' }}>FAV SONG MODE</div>
                          </div>
                        ) : (
                          <>
                            {favSongStage === 'idle' && (
                              <div className="hud-block hoverable" style={{ cursor: 'pointer', flex: 1, textAlign: 'center', background: 'rgba(255,20,147,0.2)', borderColor: '#ff69b4', color: '#fff', padding: '12px' }} onClick={(e) => { e.stopPropagation(); onPlayFavSong(true); }}>
                                <div className="hud-label" style={{ margin: 'auto' }}>PLAY SONG</div>
                              </div>
                            )}
                            <div className="hud-block hoverable" style={{ cursor: 'pointer', flex: 1, textAlign: 'center', color: '#fff', padding: '12px' }} onClick={(e) => { e.stopPropagation(); onRevert(); }}>
                              <div className="hud-label" style={{ margin: 'auto' }}>REVERT</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </Html>
      </group>
    </group>
  );
};

// ═══════════════════════════════════════════════════════════
// SCENE CONTROLLER — Camera + DOM Effects
// ═══════════════════════════════════════════════════════════

const SceneController = ({ activeSection, setActiveSection, playing, carouselRef, favSongStage, sections }) => {
  const domRefs = useRef({});
  const lookAtPos = useRef(new THREE.Vector3(0, 0, 0));
  const introFinished = useRef(false);
  const introSpinFinished = useRef(false);
  const pointerTracker = useRef({ current: 0, target: 0, velocity: 0 });
  const targetRot = useRef(0);
  const startTime = useRef(0);
  const randomIntroSpin = useRef(Math.PI * 2);
  const mousePos = useRef({ x: 0, y: 0 });
  const currentMousePos = useRef({ x: 0, y: 0 });
  const swapGlitch = useRef(0);
  const prevSection = useRef(activeSection);

  const bassFovPunch = useRef(0);

  useEffect(() => {
    if (playing && startTime.current === 0) {
      startTime.current = performance.now();
      window.introTime = performance.now();
    }
  }, [playing]);

  useEffect(() => {
    if (activeSection !== prevSection.current) {
      if (activeSection !== null || prevSection.current !== null) {
        swapGlitch.current = 1.0;
      }
      prevSection.current = activeSection;
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection && carouselRef.current) {
      const targetData = sections.find(s => s.id === activeSection);
      let current = carouselRef.current.rotation.y;
      let target = targetData.angle;

      let diff = (-target - current) % (Math.PI * 2);
      if (diff < -Math.PI) diff += Math.PI * 2;
      if (diff > Math.PI) diff -= Math.PI * 2;

      targetRot.current = current + diff;
      pointerTracker.current.target = targetRot.current;
      pointerTracker.current.current = targetRot.current;
    }
  }, [activeSection, carouselRef]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (introSpinFinished.current) {
          if (activeSection && setActiveSection) {
            const currentIndex = sections.findIndex(s => s.id === activeSection);
            const nextIndex = (currentIndex + 1) % sections.length;
            setActiveSection(sections[nextIndex].id);
          } else {
            const cardSpacing = (Math.PI * 2) / sections.length;
            pointerTracker.current.target -= cardSpacing;
          }
        }
      }
    };

    const handleMouseMove = (e) => {
      mousePos.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mousePos.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };

    const handleWheel = (e) => {
      if (introSpinFinished.current && !activeSection) {
        pointerTracker.current.target += e.deltaY * 0.0015;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [activeSection, setActiveSection]);

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.1); // Clamp delta to prevent lerp explosions on frame drops
    const time = state.clock.elapsedTime;
    const bass = audioState.bass;
    const smoothBass = audioState.smoothBass;
    const beat = audioState.beatDetected;

    // Smoothly track mouse
    currentMousePos.current.x = THREE.MathUtils.lerp(currentMousePos.current.x, mousePos.current.x, d * 3);
    currentMousePos.current.y = THREE.MathUtils.lerp(currentMousePos.current.y, mousePos.current.y, d * 3);

    const parallaxX = currentMousePos.current.x * 3.5;
    const parallaxY = currentMousePos.current.y * 2.5;

    // ── CAMERA SHAKE (only after intro finishes) ──
    if (introSpinFinished.current) {
      const shakeBase = smoothBass > 0.25 ? (smoothBass - 0.25) * 1.0 : 0;
      const shakeIntensity = shakeBase * (activeSection ? 0.1 : (window.isHoveringCard ? 0.05 : 0.3));

      if (shakeIntensity > 0) {
        const st = time * 35;
        state.camera.position.x += Math.sin(st * 1.1) * shakeIntensity * 0.2;
        state.camera.position.y += Math.cos(st * 1.3) * shakeIntensity * 0.15;

        if (beat) {
          state.camera.position.x += (Math.random() - 0.5) * audioState.beatEnergy * 0.5;
          state.camera.position.y += (Math.random() - 0.5) * audioState.beatEnergy * 0.3;
        }
      }
    }

    // ── ASA TITLE — MULTI-LAYER CHROMATIC GLITCH ──
    if (!domRefs.current.textEl) {
      domRefs.current.textEl = document.getElementById('asa-bg-text');
      if (domRefs.current.textEl) {
        domRefs.current.redLayer = domRefs.current.textEl.querySelector('.asa-layer-r');
        domRefs.current.cyanLayer = domRefs.current.textEl.querySelector('.asa-layer-c');
        domRefs.current.mainLayer = domRefs.current.textEl.querySelector('.asa-layer-main');
      }
    }
    const textEl = domRefs.current.textEl;
    if (textEl) {
      // Container: float + parallax + bass scale + beat skew
      const floatY = Math.sin(time * 2) * 15;
      const floatX = Math.cos(time * 1.5) * 8;
      const bassScale = 1 + smoothBass * 0.35;
      const skewX = beat ? (Math.random() - 0.5) * bass * 30 : 0;

      textEl.style.transform = `translate(${floatX}px, ${floatY}px) scale(${bassScale}) skewX(${skewX}deg)`;

      // Multi-layer chromatic split
      const redLayer = domRefs.current.redLayer;
      const cyanLayer = domRefs.current.cyanLayer;
      const mainLayer = domRefs.current.mainLayer;

      if (redLayer && cyanLayer && mainLayer) {
        if (beat) {
          const split = bass * 40;
          redLayer.style.transform = `translate(${split}px, ${-split * 0.4}px)`;
          redLayer.style.opacity = String(0.5 + bass * 0.5);
          cyanLayer.style.transform = `translate(${-split}px, ${split * 0.4}px)`;
          cyanLayer.style.opacity = String(0.5 + bass * 0.5);

          // Random clip-path glitch slices
          const y1 = Math.random() * 70;
          const h = 8 + Math.random() * 30;
          redLayer.style.clipPath = `inset(${y1}% 0 ${Math.max(0, 100 - y1 - h)}% 0)`;
          cyanLayer.style.clipPath = `inset(${100 - y1 - h}% 0 ${y1}% 0)`;
        } else {
          const drift = smoothBass * 6;
          redLayer.style.transform = `translate(${drift}px, 0)`;
          redLayer.style.opacity = String(0.08 + smoothBass * 0.25);
          cyanLayer.style.transform = `translate(${-drift}px, 0)`;
          cyanLayer.style.opacity = String(0.08 + smoothBass * 0.25);
          redLayer.style.clipPath = 'none';
          cyanLayer.style.clipPath = 'none';
        }

        // Main layer: massive neon glow + strobe flash (static radii for performance)
        const coreAlpha = 0.4 + bass * 0.6;
        const outerAlpha = 0.15 + bass * 0.4;
        const megaAlpha = bass * 0.3;
        mainLayer.style.textShadow = `0 0 30px rgba(160, 32, 240, ${coreAlpha}), 0 0 100px rgba(160, 32, 240, ${outerAlpha}), 0 0 250px rgba(120, 0, 220, ${megaAlpha})`;
        mainLayer.style.color = `rgba(255, 255, 255, ${0.03 + bass * 0.3})`;
      }
    }

    // ── SCREEN FLASH ON HEAVY BEATS ──
    if (!domRefs.current.flashEl) domRefs.current.flashEl = document.getElementById('screen-flash');
    const flashEl = domRefs.current.flashEl;
    if (flashEl) {
      if (beat && bass > 0.4) {
        flashEl.style.transition = 'none';
        flashEl.style.opacity = String(Math.min((bass - 0.2) * 0.6, 0.45));
        void flashEl.offsetWidth;
        flashEl.style.transition = 'opacity 0.12s ease-out';
        flashEl.style.opacity = '0';
      }
    }

    // ── SCANLINE INTENSITY ──
    if (!domRefs.current.scanEl) domRefs.current.scanEl = document.querySelector('.screen-scanlines');
    const scanEl = domRefs.current.scanEl;
    if (scanEl) {
      scanEl.style.opacity = String(0.1 + smoothBass * 0.3);
    }

    // ── EDGE GLOW INTENSITY ──
    if (!domRefs.current.edgeEl) domRefs.current.edgeEl = document.querySelector('.screen-edge-glow');
    const edgeEl = domRefs.current.edgeEl;
    if (edgeEl) {
      const glowSize = 40 + smoothBass * 200;
      const glowAlpha = 0.08 + smoothBass * 0.5;
      edgeEl.style.boxShadow = `inset 0 0 ${glowSize}px rgba(160, 32, 240, ${glowAlpha})`;
    }

    // ── REACTIVE MUSIC BAR ──
    if (!domRefs.current.musicBar) domRefs.current.musicBar = document.getElementById('music-progress-bar');
    if (domRefs.current.musicBar) {
      domRefs.current.musicBar.style.width = `${Math.min(100, 5 + smoothBass * 60 + audioState.energyAccumulator * 15)}%`;
    }

    // ══════════════════════════════════════
    // CAMERA NAVIGATION (preserved logic)
    // ══════════════════════════════════════

    if (playing && !introFinished.current) {
      const elapsed = (performance.now() - startTime.current) / 1000;

      if (elapsed < window.INTRO_DELAY_SEC) {
        const hoverY = 150 + Math.sin(time * 0.5) * 10;
        state.camera.position.lerp(new THREE.Vector3(0, hoverY, 100), 2 * d);
        lookAtPos.current.lerp(new THREE.Vector3(0, -20, 0), 2 * d);
      } else if (elapsed < window.INTRO_DELAY_SEC + 2.5) {
        const progress = Math.min((elapsed - window.INTRO_DELAY_SEC) / 2.5, 1);
        const easeOut = 1 - Math.pow(1 - progress, 5);

        const startPos = new THREE.Vector3(0, 150, 100);
        const targetPos = new THREE.Vector3(0, 0, 65);

        state.camera.position.lerpVectors(startPos, targetPos, easeOut);

        state.camera.position.x += Math.sin(progress * Math.PI * 2) * 25 * (1 - easeOut);
        state.camera.position.z += Math.cos(progress * Math.PI * 2) * 25 * (1 - easeOut);

        lookAtPos.current.lerp(new THREE.Vector3(0, -20 * (1 - easeOut), 0), 5 * d);
      } else {
        introFinished.current = true;
      }
    } else if (introFinished.current && !introSpinFinished.current && playing) {
      const elapsedSinceSpinStart = (performance.now() - window.introTime - (window.INTRO_DELAY_SEC * 1000 + 4000)) / 1000;
      if (elapsedSinceSpinStart > 0) {
        if (elapsedSinceSpinStart < 2.0) {
          const spinProgress = elapsedSinceSpinStart / 2.0;
          const spinEase = 1 - Math.pow(1 - spinProgress, 4);
          pointerTracker.current.target = randomIntroSpin.current * spinEase;
        } else {
          introSpinFinished.current = true;
          pointerTracker.current.target = randomIntroSpin.current;
        }
      }

      pointerTracker.current.current = THREE.MathUtils.lerp(pointerTracker.current.current, pointerTracker.current.target, 8 * d);
      targetRot.current = pointerTracker.current.current;
      if (carouselRef.current) {
        carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 10 * d);
      }

      const targetCamPos = new THREE.Vector3(0, 0, 65);
      state.camera.position.lerp(targetCamPos, 6 * d);
      lookAtPos.current.lerp(new THREE.Vector3(0, 0, 0), 6 * d);

    } else if (introFinished.current && introSpinFinished.current) {

      // Lerp speed — slow on massive impacts for "freeze frame" feel
      let lerpSpeed = 6;
      if (beat && audioState.beatEnergy > 0.8 && !activeSection) {
        lerpSpeed = 2;
      }

      if (activeSection) {
        // ZOOMED IN
        if (carouselRef.current) {
          carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 8 * d);
        }

        const activeData = SECTIONS_DATA.find(s => s.id === activeSection);
        const cx = activeData?.camOffset?.[0] || 0;
        const cy = activeData?.camOffset?.[1] || -2;
        const cz = activeData?.camOffset?.[2] || 25;

        const lx = activeData?.lookOffset?.[0] || 0;
        const ly = activeData?.lookOffset?.[1] || 0;
        const lz = activeData?.lookOffset?.[2] || 0;

        const targetCamPos = new THREE.Vector3(cx, cy, R + cz);
        state.camera.position.lerp(targetCamPos, lerpSpeed * d);
        lookAtPos.current.lerp(new THREE.Vector3(lx, ly, R + lz), lerpSpeed * d);

      } else {
        // OVERVIEW — micro-orbit

        pointerTracker.current.current = THREE.MathUtils.lerp(pointerTracker.current.current, pointerTracker.current.target, 8 * d);
        targetRot.current = pointerTracker.current.current;
        if (carouselRef.current) {
          carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 10 * d);
        }

        // Micro-orbit: slow XY movement + bass modulation + mouse parallax
        const orbitAngle = time * 0.15;
        const orbitRadius = 2 + smoothBass * 4;
        const targetCamPos = new THREE.Vector3(
          Math.sin(orbitAngle) * orbitRadius + parallaxX,
          Math.cos(orbitAngle * 0.7) * (1 + smoothBass * 2) + parallaxY,
          65
        );
        state.camera.position.lerp(targetCamPos, lerpSpeed * d);
        lookAtPos.current.lerp(new THREE.Vector3(parallaxX * 0.5, parallaxY * 0.5, 0), lerpSpeed * d);
      }
    }

    state.camera.lookAt(lookAtPos.current);

    // ── POST-LOOKAT EFFECTS (applied after lookAt so they're not overridden) ──
    if (audioState.playing && introSpinFinished.current) {
      // FOV breathing — expands on bass, contracts between
      bassFovPunch.current = THREE.MathUtils.lerp(bassFovPunch.current, smoothBass, 8 * d);
      state.camera.fov = 60 + bassFovPunch.current * 14;

      // Swap glitch warp
      if (swapGlitch.current > 0) {
        swapGlitch.current = Math.max(0, swapGlitch.current - d * 4.0);
        const intensity = swapGlitch.current;
        state.camera.fov += intensity * 35; // Dramatic FOV pull
        state.camera.rotateZ((Math.random() - 0.5) * intensity * 0.15); // Slight camera shake/roll
      }

      state.camera.updateProjectionMatrix();

      // Bass punch: push camera forward on beat
      if (beat && !activeSection && swapGlitch.current === 0) {
        state.camera.position.z -= audioState.beatEnergy * 3;
      }

      state.camera.updateProjectionMatrix();

      // Camera roll sway — subtle drunken float
      state.camera.rotation.z += Math.sin(time * 0.6) * smoothBass * 0.035;
    }
  });

  return null;
};

// ═══════════════════════════════════════════════════════════
// POST-PROCESSING — Dynamic Audio-Reactive Effects
// ═══════════════════════════════════════════════════════════

const Effects = () => {
  return (
    <EffectComposer>
      <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
      <Vignette eskil={false} offset={0.1} darkness={1.2} />
    </EffectComposer>
  );
};

// ═══════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════

window.INTRO_DELAY_SEC = 3.2; // Wait 3.2 seconds for the intro drop

function App() {
  const [started, setStarted] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [introTextVisible, setIntroTextVisible] = useState(false);
  const [introFading, setIntroFading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.45);
  const [themeMode, setThemeMode] = useState('normal');
  const [favSongStage, setFavSongStage] = useState('idle');
  const [favModalData, setFavModalData] = useState(null);

  const activeSections = useMemo(() => {
    const dataArray = themeMode === 'favSong' ? [...SECTIONS_DATA, ...FAV_SONG_CARDS_DATA] : SECTIONS_DATA;
    return dataArray.map((s, i) => {
      const angle = (i / dataArray.length) * Math.PI * 2;
      return {
        ...s,
        index: i,
        angle: angle,
        x: Math.sin(angle) * R,
        z: Math.cos(angle) * R
      };
    });
  }, [themeMode]);

  useEffect(() => {
    if (themeMode === 'favSong') {
      document.body.classList.add('theme-favsong');
      document.body.style.cursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="%23ff69b4" opacity="0.8" /><circle cx="12" cy="12" r="1.5" fill="white" /></svg>') 12 12, auto`;
    } else {
      document.body.classList.remove('theme-favsong');
      document.body.style.cursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="%23a020f0" opacity="0.8" /><circle cx="12" cy="12" r="1.5" fill="white" /></svg>') 12 12, auto`;
    }
  }, [themeMode]);

  const carouselRef = useRef();

  const handlePlayFavSong = (playImmediately = false) => {
    switchAudio('/PiNKII_x_DAEGHO_-_Addict_KLICKAUD.mp3', playImmediately);
  };

  const handleRevert = () => {
    switchAudio('/music_and_me.mp3', true);
  };

  const handleStart = () => {
    initAudio();
    playAudio();
    setStarted(true);

    // Show ASA title shortly after start
    setTimeout(() => {
      setIntroTextVisible(true);
    }, 300);

    // Start fading ASA title before cards materialize
    setTimeout(() => {
      setIntroFading(true);
    }, window.INTRO_DELAY_SEC * 1000 + 2000);

    // Fully remove ASA title after fade completes
    setTimeout(() => {
      setIntroTextVisible(false);
      setIntroFading(false);
    }, window.INTRO_DELAY_SEC * 1000 + 2800);
  };

  const handleMute = (e) => {
    e.stopPropagation();
    setIsMuted(toggleMute());
  };

  const handleVolumeChange = (e) => {
    e.stopPropagation();
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (audioRef) {
      audioRef.volume = newVol;
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>

      <div className={`splash-screen ${started ? 'hidden' : ''}`} onClick={handleStart}>
        <img src="/icon.png" alt="ASA" className="splash-avatar" />
        <div className="enter-text">INITIALIZE EXPERIENCE</div>
        <p style={{ color: '#888', marginTop: '20px', fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: 'bold' }}>
          (Click anywhere. Warning: Loud audio and screen shake)
        </p>
      </div>

      {/* ── ASA TITLE: Multi-Layer Chromatic Glitch ── */}
      {started && introTextVisible && (
        <div className={`asa-title-wrapper ${introFading ? 'fading' : ''}`}>
          <div id="asa-bg-text" className="asa-title-container">
            <span className="asa-layer asa-layer-r">ASA</span>
            <span className="asa-layer asa-layer-c">ASA</span>
            <span className="asa-layer asa-layer-main" data-text="ASA">ASA</span>
          </div>
        </div>
      )}

      {/* ── Screen Flash Overlay ── */}
      {started && <div id="screen-flash" className="screen-flash"></div>}

      {/* ── Scanline Overlay ── */}
      {started && <div className="screen-scanlines"></div>}

      {/* ── Edge Glow ── */}
      {started && <div className="screen-edge-glow"></div>}

      {/* ── Audio-reactive radial blur overlay ── */}
      {started && <div className="audio-blur-overlay"></div>}

      {/* ── Lyrics as HTML overlay (no 3D text = no Suspense risk) ── */}
      <LyricsOverlay started={started} themeMode={themeMode} />

      {/* ── Fav Song Modal Overlay ── */}
      {favModalData && (
        <div className="fav-modal-overlay" onClick={() => setFavModalData(null)}>
          <div className="fav-modal-content" onClick={e => e.stopPropagation()}>
            <button className="fav-modal-close" onClick={() => setFavModalData(null)}>×</button>
            <h2 className="fav-modal-title" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              <div dangerouslySetInnerHTML={{ __html: favModalData.icon }} style={{ display: 'flex', width: '32px', height: '32px' }} />
              {favModalData.title}
            </h2>
            <div dangerouslySetInnerHTML={{ __html: favModalData.content }} />
          </div>
        </div>
      )}

      {started && (
        <div className="ui-layer">
          {activeSection && (
            <button className="back-btn" onClick={() => setActiveSection(null)}>
              [ BACK TO OVERVIEW ]
            </button>
          )}
          <button className="mute-btn" onClick={handleMute}>
            {isMuted ? '[ UNMUTE ]' : '[ MUTE ]'}
          </button>
          <input
            type="range"
            className="volume-slider"
            min="0" max="1" step="0.01"
            value={volume}
            onChange={handleVolumeChange}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <div className="space-notifier">
            [ PRESS SPACE TO ROTATE / CYCLE ]
          </div>
        </div>
      )}

      <Canvas
        camera={{ position: [0, 150, 100], fov: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        dpr={1}
      >
        <color attach="background" args={['#020202']} />
        <fogExp2 attach="fog" args={['#020202', 0.015]} />

        <ambientLight intensity={0.2} />
        <directionalLight position={[0, 10, 5]} intensity={2} color="#ffffff" />
        <directionalLight position={[0, -10, -5]} intensity={1} color={themeMode === 'favSong' ? "#ff69b4" : "#a020f0"} />

        <AudioDriver />
        <ReactiveFog />

        <IntroParticles playing={started} themeMode={themeMode} />

        <Suspense fallback={null}>
          <AmbientParticles themeMode={themeMode} />
          <VoidShapes themeMode={themeMode} />
          <HeartShapes themeMode={themeMode} />
          <FloatingHearts themeMode={themeMode} />
          <RomanticSparkles themeMode={themeMode} />
          <HorizonTrees themeMode={themeMode} />
          <BassShockwaves themeMode={themeMode} />
          <AudioVisualizerRing themeMode={themeMode} />
          <ReactiveFloor themeMode={themeMode} />

          <group ref={carouselRef}>
            {activeSections.map(s => (
              <FloatingPanel
                key={s.id}
                data={s}
                activeId={activeSection}
                onClick={setActiveSection}
                playing={started}
                carouselRef={carouselRef}
                themeMode={themeMode}
                favSongStage={favSongStage}
                onPlayFavSong={(play = false) => {
                  setThemeMode('favSong');
                  if (play) {
                    setFavSongStage('playing');
                    handlePlayFavSong(true);
                  }
                }}
                onRevert={() => {
                  setThemeMode('normal');
                  setFavSongStage('idle');
                  setFavModalData(null);
                  handleRevert();
                }}
                onFavCardClick={setFavModalData}
              />
            ))}
          </group>

          <SceneController
            activeSection={activeSection}
            setActiveSection={setActiveSection}
            playing={started}
            carouselRef={carouselRef}
            favSongStage={favSongStage}
            sections={activeSections}
          />
          <Effects />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default App;

