import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Cloud, Clouds } from '@react-three/drei';

import { EffectComposer, Noise, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

// ─── GLOBAL STATE (avoids React re-renders killing pointer events) ───
const hoverState = { current: null };
const tvHitboxes = [];
const cameraReady = { current: false }; // Camera won't move until this is true
const introTimer = { current: 0 }; // Shared timer for intro effects
const impactOverlayRef = { current: null };
const sparkCooldown = { current: 0 };
const abyssBlackout = { current: false };

// ─── AUDIO ENGINE ───────────────────────────────────────────────
let audioCtxInstance = null;

function getAudioCtx() {
  if (!audioCtxInstance) {
    audioCtxInstance = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtxInstance.state === 'suspended') audioCtxInstance.resume();
  return audioCtxInstance;
}

// Background ambient — only starts after loading screen click
let ambientStarted = false;
function startAmbient() {
  if (ambientStarted) return;
  ambientStarted = true;
  const el = document.createElement('audio');
  el.src = '/ambient.mp3';
  el.loop = true;
  el.volume = 0.455; // Increased by 30%
  el.play().catch(() => { });

  // Continuous glitchy 60Hz background hum
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 60;

  // Randomly modulate the gain to make it sputter
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 8;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.5;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  lfo.start();

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 300;

  const masterGain = ctx.createGain();
  // Lowered volume by another 25% (0.0048)
  masterGain.gain.setValueAtTime(0, ctx.currentTime);
  masterGain.gain.setValueAtTime(0, ctx.currentTime + 1.15);
  masterGain.gain.linearRampToValueAtTime(0.0048, ctx.currentTime + 1.3);

  osc.connect(gain);
  gain.connect(filter);
  filter.connect(masterGain);
  masterGain.connect(ctx.destination);

  osc.start();
}

// Short one-shot static burst (plays once per hover)
function playStaticBurst() {
  const ctx = getAudioCtx();
  const len = ctx.sampleRate * 0.1; // 100ms
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    d[i] = (Math.random() * 2 - 1) * (1 - t); // Decaying static
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.04; // Quiet
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 5000;
  filter.Q.value = 0.8;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

// Deep, distant heavy rumble / air rush for the initial enter click
function playEnterSound() {
  const ctx = getAudioCtx();

  // Distant impact / heavy heartbeat
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(60, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 1.5);

  gain.gain.setValueAtTime(1.0, ctx.currentTime); // Loud punch
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 1.5);

  // Subtle, low-passed noise rumble to make it sound like rushing air
  const len = ctx.sampleRate * 1.5;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.0);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 150; // Extremely low frequency air rush

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, ctx.currentTime);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);

  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start();
}

// Crisp, high-pitched static snap for TV clicks
function playTypeSound() {
  if (!audioCtxInstance) return;
  const ctx = audioCtxInstance;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(180, ctx.currentTime); // Slightly higher for typing
  osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.05);
  gain.gain.setValueAtTime(0.02, ctx.currentTime); // Lowered 50%
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.05);
}

function playDeleteSound() {
  if (!audioCtxInstance) return;
  const ctx = audioCtxInstance;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(110, ctx.currentTime); // Lower for deletion
  osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.06);
  gain.gain.setValueAtTime(0.05, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.06);
}

function playTvClickSound() {
  const ctx = getAudioCtx();
  const len = ctx.sampleRate * 0.08;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2500; // Crisp static

  const gain = ctx.createGain();
  gain.gain.value = 0.15;

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

// 60Hz Electrical transformer hum and heavy zap for TVs turning on
function playTurnOnSound() {
  const ctx = getAudioCtx();

  // 60Hz Electrical Hum
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 60;

  // Tremolo effect to make it buzz
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 120;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.5;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  lfo.start();

  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.05); // Lowered 40%
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(300, ctx.currentTime);
  filter.frequency.linearRampToValueAtTime(2000, ctx.currentTime + 0.2);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.4);
  lfo.stop(ctx.currentTime + 0.4);

  // Add a harsh static crack
  const len = ctx.sampleRate * 0.1;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.09; // Lowered 40%
  noise.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start();
}

// Electrical spark snap from exposed cable wires
function playSparkSound() {
  const ctx = getAudioCtx();
  const len = ctx.sampleRate * 0.06;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 5) * (Math.sin(t * 8000) > 0 ? 1 : -1);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 3500;
  const gain = ctx.createGain();
  gain.gain.value = 0.07;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

// Deep power-down thud for the abyss blackout event
function playBlackoutSound() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(15, ctx.currentTime + 0.6);
  gain.gain.setValueAtTime(0.5, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.6);

  const len2 = ctx.sampleRate * 0.2;
  const buf = ctx.createBuffer(1, len2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len2; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.04));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.1;
  noise.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start();
}

const INSTA_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="inline-block mr-3 align-text-bottom opacity-80">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
  </svg>
);

const DISCORD_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="inline-block mr-3 align-text-bottom opacity-80">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.069.069 0 0 0-.032.027C.533 9.048-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

// ─── CONFIGURATION ──────────────────────────────────────────────
const TV_DATA = [
  {
    id: 1, text: 'ASA', size: 1.8,
    position: [0, 46.5, -5.0],
    wireLength: 38.5,
    wires: 4, rotY: 0.0,
    tilt: [0.02, 0, -0.04],
    flickerSpeed: 60, flickerAmp: 0.45,
    content: `> IDENTITY: ASA\n> BIRTHDAY: JUNE 23RD\n> AGE: 19\n\n> LANGUAGES:\n  ENGLISH [80%]\n  SPANISH [80%]\n  JAPANESE [15%]`,
    glitchContent: `watching you from the static...`
  },
  {
    id: 2, text: 'Socials', size: 1.8,
    position: [3.2, 47.6, -9.0],
    wireLength: 37.4,
    wires: 3, rotY: -0.3,
    tilt: [0.05, 0, 0.15],
    flickerSpeed: 75, flickerAmp: 0.5,
    content: `[LINK:https://www.instagram.com/hataeruu/] [INSTA] hataeruu\n[LINK:https://discord.com/users/1408523273548988456] [DISCO] asari_atari`,
    glitchContent: `don't bother me.`
  },
  {
    id: 3, text: 'MUSIC', size: 1.6,
    position: [-2.8, 45.8, -7.5],
    wireLength: 39.2,
    wires: 3, rotY: 0.25,
    tilt: [-0.03, 0, 0.08],
    flickerSpeed: 55, flickerAmp: 0.4,
    content: `FAVORITE ARTIST:\n> Ado\n\nFAVORITE SONG:\n> [LINK:https://www.youtube.com/watch?v=CaSpEnBpTPg] 2:00 by enveel`,
    glitchContent: `...now playing in the void.`
  },
  {
    id: 4, text: 'ARCHIVE', size: 1.4,
    position: [2.6, 46.2, -6.0],
    wireLength: 38.8,
    wires: 3, rotY: 0.15,
    tilt: [-0.08, 0, -0.18],
    flickerSpeed: 80, flickerAmp: 0.5,
    typeSpeed: 2,
    content: `ARCHIVE:\n\n[LINK:internal:hardware] > HARDWARE\n[LINK:internal:games] > VIDEOGAMES\n[LINK:internal:media] > SERIES / MOVIES`,
    subViews: {
      hardware: `HARDWARE / SETUP:\n\n- RTX 5060 TI\n- AMD RYZEN 9 7900X\n- 32GB DDR5 RAM\n\nPERIPHERALS:\n- RAZER OROCHI V2\n- AULA WIN60 HE\n\nAUDIO:\n- HYPERX QUADCAST S\n- HYPERX CLOUD EARBUDS II`,
      games: `VIDEOGAMES:\n\n- ARC RAIDERS\n- DARK SOULS\n- RESIDENT EVIL\n- THE LAST OF US (TLOU)`,
      media: `SERIES / MOVIES:\n\n- CHAINSAWMAN, FATE SERIES\n- DEATH NOTE, BREAKING BAD\n- KILL LA KILL, AOT, ARCANE\n- SCISSOR SEVEN, YOUR NAME\n- CYBERPUNK 2077`
    },
    glitchContent: `I like the dark.\n\nEverything decays eventually.\n\nWhy are you still here?`
  },
  {
    id: 5, text: 'STATUS', size: 1.8,
    position: [-1.4, 48.4, -11.5],
    wireLength: 36.6,
    wires: 2, rotY: -0.2,
    tilt: [0.1, 0, 0.22],
    flickerSpeed: 65, flickerAmp: 0.45,
    content: `ONLINE`,
    glitchContent: `> SYSTEM: CORRUPTED\n> CONNECTION: LOST\n> SIGNAL: WEAK`
  }
];

// ─── MESSY CABLE WITH EXPOSED INNER WIRES ───────────────────────
const WIRE_COLORS = ['#cc2222', '#22aa22', '#2255cc', '#ccaa22', '#cc6622'];

// ─── CABLE SPARK PARTICLES ──────────────────────────────────────
function CableSpark({ curve }) {
  const groupRef = useRef();
  const lightRef = useRef();
  const particleRefs = useRef([]);
  const sparks = useRef([]);
  const active = useRef(false);
  const sparkTimer = useRef(Math.random() * 8);

  useFrame((state, delta) => {
    if (!curve) return;
    const now = state.clock.getElapsedTime();

    // Try to spark when global cooldown has expired
    if (!active.current && now > sparkCooldown.current) {
      sparkTimer.current -= delta;
      if (sparkTimer.current <= 0) {
        if (Math.random() < 0.25) {
          active.current = true;
          sparkCooldown.current = now + 4 + Math.random() * 4;

          const point = curve.getPointAt(0.3 + Math.random() * 0.4);
          if (groupRef.current) {
            groupRef.current.position.copy(point);
            groupRef.current.visible = true;
          }

          sparks.current = Array.from({ length: 5 }, () => ({
            pos: new THREE.Vector3(0, 0, 0),
            vel: new THREE.Vector3(
              (Math.random() - 0.5) * 4,
              Math.random() * 3 + 1,
              (Math.random() - 0.5) * 4
            ),
            life: 0.08 + Math.random() * 0.12
          }));
          playSparkSound();
        }
        sparkTimer.current = 1 + Math.random() * 3;
      }
    }

    // Animate active sparks
    if (active.current) {
      let anyAlive = false;
      sparks.current.forEach((s, i) => {
        s.life -= delta;
        s.vel.y -= delta * 12;
        s.pos.addScaledVector(s.vel, delta);
        const ref = particleRefs.current[i];
        if (ref) {
          ref.position.copy(s.pos);
          ref.visible = s.life > 0;
          if (ref.material) {
            ref.material.emissiveIntensity = Math.max(0, (s.life / 0.15)) * 10;
          }
        }
        if (s.life > 0) anyAlive = true;
      });

      if (lightRef.current) {
        const maxLife = Math.max(0, ...sparks.current.map(s => s.life));
        lightRef.current.intensity = maxLife > 0 ? (maxLife / 0.15) * 4 : 0;
      }

      if (!anyAlive) {
        active.current = false;
        if (groupRef.current) groupRef.current.visible = false;
      }
    }
  });

  if (!curve) return null;

  return (
    <group ref={groupRef} visible={false}>
      <pointLight ref={lightRef} intensity={0} distance={5} color="#ffaa44" decay={2} />
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh key={i} ref={el => { particleRefs.current[i] = el; }} visible={false}>
          <sphereGeometry args={[0.012, 4, 4]} />
          <meshStandardMaterial color="#ffdd88" emissive="#ffaa22" emissiveIntensity={10} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function MessyCable({ wireLength, tvWidth }) {
  const matRef = useRef();
  const innerMatRef = useRef();

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const intensity = window.__isAnyTVHovered ? 0.05 : 1.0;
    if (matRef.current?.userData?.shader) {
      matRef.current.userData.shader.uniforms.time.value = t;
      matRef.current.userData.shader.uniforms.wiggleIntensity.value = intensity;
    }
    if (innerMatRef.current?.userData?.shader) {
      innerMatRef.current.userData.shader.uniforms.time.value = t;
      innerMatRef.current.userData.shader.uniforms.wiggleIntensity.value = intensity;
    }
  });

  const onBeforeCompile = useCallback((shader) => {
    shader.uniforms.time = { value: 0 };
    shader.uniforms.wiggleIntensity = { value: 1.0 };
    shader.vertexShader = `
      uniform float time;
      uniform float wiggleIntensity;
      ${shader.vertexShader}
    `.replace(
      `#include <begin_vertex>`,
      `
      #include <begin_vertex>
      // Complex writhing with layered frequencies
      float ny = clamp(position.y / -${wireLength.toFixed(1)}, 0.0, 1.0);
      float wobbleMask = sin(ny * 3.14159);
      
      float t = time * 0.8;
      float phase = position.y * 0.15;
      
      float wiggleX = (sin(t + phase) * 0.5 * wobbleMask
                    + sin(t * 2.3 + phase * 1.5) * 0.15 * wobbleMask
                    + cos(t * 0.5) * 0.2 * ny) * wiggleIntensity;
                    
      float wiggleZ = (cos(t * 1.2 + phase * 0.8) * 0.4 * wobbleMask
                    + sin(t * 3.7 + phase * 2.1) * 0.1 * wobbleMask) * wiggleIntensity;
      
      transformed.x += wiggleX;
      transformed.z += wiggleZ;
      `
    );
  }, [wireLength]);

  const curve = useMemo(() => {
    const pts = [];
    const numPoints = 8;
    const startAngle = Math.random() * Math.PI * 2;
    const spiralRadius = 0.5 + Math.random() * 2.5; // Width of the loops
    const loops = 0.5 + Math.random(); // 0.5 to 1.5 full loops (snaking)

    // Anchor at ceiling
    const startX = Math.cos(startAngle) * spiralRadius * 1.5;
    const startZ = Math.sin(startAngle) * spiralRadius - 1.0;
    pts.push(new THREE.Vector3(startX, 0, startZ));

    // Generate snaking intermediate points
    for (let i = 1; i < numPoints; i++) {
      const t = i / numPoints;
      const y = -wireLength * t;
      const currentAngle = startAngle + (t * Math.PI * 2 * loops);
      const currentRadius = spiralRadius * (1 - t * 0.4);

      let x = Math.cos(currentAngle) * currentRadius + (Math.random() - 0.5) * 0.5;
      let z = Math.sin(currentAngle) * currentRadius - 0.5 + (Math.random() - 0.5) * 0.5;

      // Smoothly push the cable backwards as it descends to avoid hitting the TV
      // A gradual push prevents the CatmullRom curve from overshooting into the screen
      if (t > 0.3) {
        z -= Math.pow(t, 2) * 2.5;
      }

      pts.push(new THREE.Vector3(x, y, z));
    }

    // Attach to the top back of the TV to prevent clipping through the screen
    const endX = (Math.random() - 0.5) * (tvWidth * 0.6);
    const endZ = -0.5 - Math.random() * 0.5; // Securely in the negative Z space
    pts.push(new THREE.Vector3(endX, -wireLength, endZ));

    return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  }, [wireLength, tvWidth]);

  const outerRadius = 0.025 + Math.random() * 0.02;
  const showInner = Math.random() > 0.4; // 60% chance of exposed wires
  const innerColor = useMemo(() => WIRE_COLORS[Math.floor(Math.random() * WIRE_COLORS.length)], []);

  // Peeled section — a thinner exposed portion near the top
  const peelCurve = useMemo(() => {
    if (!showInner) return null;
    const pts = curve.getPoints(50);
    const start = Math.floor(Math.random() * 8) + 2;
    const end = start + Math.floor(Math.random() * 6) + 4;
    return new THREE.CatmullRomCurve3(pts.slice(start, end), false, 'catmullrom', 0.5);
  }, [curve, showInner]);

  return (
    <group>
      <mesh>
        <tubeGeometry args={[curve, 40, outerRadius, 6, false]} />
        <meshStandardMaterial
          ref={matRef}
          color="#080808"
          roughness={0.95}
          fog={false}
          onBeforeCompile={(shader) => {
            matRef.current.userData.shader = shader;
            onBeforeCompile(shader);
          }}
        />
      </mesh>
      {peelCurve && (
        <mesh>
          <tubeGeometry args={[peelCurve, 16, outerRadius * 0.5, 5, false]} />
          <meshStandardMaterial
            ref={innerMatRef}
            color={innerColor}
            roughness={0.6}
            metalness={0.3}
            fog={false}
            onBeforeCompile={(shader) => {
              innerMatRef.current.userData.shader = shader;
              onBeforeCompile(shader);
            }}
          />
        </mesh>
      )}
      {peelCurve && <CableSpark curve={peelCurve} />}
    </group>
  );
}

// ─── DETAILED CRT TV ────────────────────────────────────────────
function HangingTV({ data, setActiveModal }) {
  const screenRef = useRef();
  const screenLightRef = useRef();
  const ledRef = useRef();
  const textRef = useRef();
  const hitboxRef = useRef();
  const groupRef = useRef();
  const tvBodyRef = useRef();
  const reflectionRef = useRef();
  const scaleRef = useRef(1);
  const pullRef = useRef(0);

  // Register this TV's hitbox mesh for manual raycasting in CameraRig
  React.useEffect(() => {
    if (hitboxRef.current) {
      tvHitboxes.push({ mesh: hitboxRef.current, id: data.id });
    }
    return () => {
      const idx = tvHitboxes.findIndex(h => h.id === data.id);
      if (idx !== -1) tvHitboxes.splice(idx, 1);
    };
  }, [data.id]);

  const [glitch, setGlitch] = useState(0);
  const lastHovered = useRef(false);
  const currentTilt = useRef(0);

  useFrame((state) => {
    if (!screenRef.current) return;
    const t = state.clock.getElapsedTime();
    const mat = screenRef.current.material;
    const isAutoZoomTarget = data.id === 1 && (introTimer.current > 3.8 && introTimer.current < 4.25);
    const hovered = hoverState.current === data.id || isAutoZoomTarget;

    if (groupRef.current) {
      // Use the shared global pendulum value
      const pendulum = window.__sharedPendulum || 0;
      groupRef.current.rotation.z = pendulum;

      const roomIsCalm = window.__isAnyTVHovered;

      if (screenRef.current?.parent) {
        if (roomIsCalm) {
          // Centering the hovered TV slightly so it's readable but not perfectly vertical
          const resetSpeed = hovered ? 0.012 : 0.05;
          currentTilt.current = THREE.MathUtils.lerp(currentTilt.current, 0, resetSpeed);
          screenRef.current.parent.rotation.z = currentTilt.current;
        } else {
          // Differentiated physics per TV
          const flavor = (data.id * 1.618) % 1.0;
          const tiltScale = 1.8 + flavor * 1.5;
          const tiltDelay = flavor * 0.8;

          const t = state.clock.getElapsedTime();
          const tiltBase = Math.sin((window.__pendulumPhase || 0) - tiltDelay) * 0.05;

          // Even softer mechanical grit
          const mechanicalGrit = (Math.sin(t * (3.0 + flavor)) * 0.003 + Math.cos(t * (6.0 + flavor)) * 0.002);

          const targetTilt = tiltBase * tiltScale + mechanicalGrit;
          // Even slower lerp (0.05) for maximum "fluidity"
          currentTilt.current = THREE.MathUtils.lerp(currentTilt.current, targetTilt, 0.05);
          screenRef.current.parent.rotation.z = currentTilt.current;
        }
      }
    }

    // ── Magnetic pull & scale ──
    const anyHovered = !!hoverState.current;
    const targetScale = hovered ? 1.02 : (anyHovered ? 0.97 : 1.0);
    const targetPull = hovered ? 0.35 : 0;
    scaleRef.current = THREE.MathUtils.lerp(scaleRef.current, targetScale, 0.08);
    pullRef.current = THREE.MathUtils.lerp(pullRef.current, targetPull, 0.06);
    if (tvBodyRef.current) {
      tvBodyRef.current.scale.setScalar(scaleRef.current);
      tvBodyRef.current.position.z = pullRef.current;
    }

    // Impact Frame Overrides
    const impactType = window.__impactType || 0;
    if (impactType !== 0) {
      // 1 = Normal (Legacy), 2 = Dark BG/White TVs, 3 = TOTAL BLACKOUT
      const color = impactType === 1 || impactType === 3 ? '#000000' : '#ffffff';
      mat.color.set(color);
      mat.emissive.set(color);
      if (ledRef.current) ledRef.current.material.emissive.set(color);
      if (textRef.current) textRef.current.material.opacity = 0;
    }

    // Always check for SFX, regardless of impact state
    const introTime = introTimer.current;
    const isSparking = introTime >= 1.8 && introTime < 2.0;
    if (isSparking && !screenRef.current._hasSparked) {
      screenRef.current._hasSparked = true;
      playTurnOnSound();
    }

    if (impactType === 0) {
      // Trigger glitch on hover change
      if (hovered && !lastHovered.current) {
        setGlitch(1);
        scaleRef.current = 1.06; // Scale punch!
      }
      lastHovered.current = hovered;
      // Decay the glitch extremely fast so it doesn't drag out the zoom-in transition
      if (glitch > 0) setGlitch(prev => Math.max(0, prev - 0.12));

      const flicker =
        Math.sin(t * data.flickerSpeed) * data.flickerAmp * 0.5 +
        Math.sin(t * data.flickerSpeed * 1.73) * data.flickerAmp * 0.3 +
        Math.sin(t * data.flickerSpeed * 0.41) * data.flickerAmp * 0.2;

      // Intro Turn-on Spark Logic (adjusted for the slower 3.8s pan)
      const isOff = introTime < 1.8;

      // If glitching, randomize between white and black
      const isGlitching = glitch > 0 && Math.random() > (1 - glitch);
      const showHover = hovered && !isGlitching;

      let baseIntensity;
      let targetC;

      if (isOff) {
        baseIntensity = 0;
        targetC = new THREE.Color('#000000');
      } else if (isSparking) {
        baseIntensity = 8.0 + Math.random() * 5.0; // Huge bright flash
        targetC = new THREE.Color('#ffffff');
      } else {
        baseIntensity = showHover ? 0.0 : 3.2 + flicker * 1.5;
        const idleColor = new THREE.Color('#ffffff');
        const hoverColor = new THREE.Color('#030303');
        targetC = showHover ? hoverColor : idleColor;
      }

      // Fast lerp so it snaps to the dark terminal screen almost instantly
      mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, baseIntensity, 0.45);
      mat.color.lerp(targetC, 0.45);
      mat.emissive.lerp(targetC, 0.45);

      if (screenLightRef.current) {
        if (isOff) screenLightRef.current.intensity = 0;
        else if (isSparking) screenLightRef.current.intensity = 5;
        else screenLightRef.current.intensity = showHover ? 0 : (1.4 + flicker * 1.2);
      }
      if (ledRef.current) {
        if (isOff || isSparking) {
          ledRef.current.material.emissiveIntensity = 0;
        } else {
          ledRef.current.material.emissiveIntensity = showHover
            ? 0.5
            : (Math.sin(t * 1.5) > 0 ? 1.5 : 0.3);
        }
      }
      if (textRef.current) {
        // Don't show text while off or glitching heavily
        const targetOpacity = (!isOff && showHover && glitch < 0.3) ? 1 : 0;
        textRef.current.material.opacity = THREE.MathUtils.lerp(
          textRef.current.material.opacity, targetOpacity, 0.15
        );
      }

      // ── Neighbor dimming (other TVs dim when one is focused) ──
      if (hoverState.current && !hovered && !isOff && introTimer.current > 4.5) {
        if (screenLightRef.current) screenLightRef.current.intensity *= 0.4;
        mat.emissiveIntensity *= 0.4;
      }

      // ── Fake reflection from neighboring TV glow ──
      if (reflectionRef.current) {
        let reflectOpacity = 0;
        if (!isOff && !isSparking) {
          TV_DATA.forEach(otherTv => {
            if (otherTv.id === data.id) return;
            const dx = otherTv.position[0] - data.position[0];
            const dy = otherTv.position[1] - data.position[1];
            const dz = otherTv.position[2] - data.position[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < 15) {
              const otherHovered = hoverState.current === otherTv.id;
              reflectOpacity += (1 - dist / 15) * (otherHovered ? 0.02 : 0.06);
            }
          });
        }
        reflectionRef.current.opacity = THREE.MathUtils.lerp(
          reflectionRef.current.opacity, reflectOpacity, 0.1
        );
      }
    }

    // ── Abyss blackout override ──
    if (abyssBlackout.current && introTimer.current > 3.8) {
      mat.color.set('#000000');
      mat.emissive.set('#000000');
      mat.emissiveIntensity = 0;
      if (screenLightRef.current) screenLightRef.current.intensity = 0;
      if (ledRef.current) ledRef.current.material.emissiveIntensity = 0;
      if (textRef.current) textRef.current.material.opacity = 0;
    }
  });

  const click = useCallback((e) => {
    // Prevent interaction until the intro sequence is fully complete
    if (window.__isIntroActive) return;

    e.stopPropagation();
    playTvClickSound();
    setActiveModal(data);
  }, [data, setActiveModal]);

  const w = 1.6 * data.size;
  const h = 1.2 * data.size;
  const d = 1.0 * data.size;
  const bz = 0.1 * data.size;
  const s = data.size;

  const textTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    // Dark translucent background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 512, 256);
    // Scanline effect
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = 0; y < 256; y += 4) {
      ctx.fillRect(0, y, 512, 2);
    }
    // Glowing text
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText(data.text, 256, 120);
    // Subtitle
    if (data.id === 1) {
      ctx.shadowBlur = 8;
      ctx.font = '18px monospace';
      ctx.fillStyle = '#888888';
      ctx.fillText('[ CLICK TO OPEN ]', 256, 170);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [data.text]);



  return (
    <group position={data.position} ref={groupRef}>
      {Array.from({ length: data.wires }).map((_, i) => (
        <MessyCable key={i} wireLength={data.wireLength} tvWidth={w} />
      ))}

      <group position={[0, -data.wireLength, 0]} rotation={data.tilt} ref={tvBodyRef}>
        <pointLight
          ref={screenLightRef}
          position={[0, 0, d * 0.8]}
          intensity={0.6}
          distance={6 * s}
          color="#e8eaf0"
          decay={2}
        />

        <group onClick={click}>
          {/* Hitbox — invisible but raycasted */}
          <mesh ref={hitboxRef} visible={false}>
            <boxGeometry args={[w, h, d * 1.2]} />
            <meshBasicMaterial />
          </mesh>

          {/* ─── MAIN CRT BODY ─── */}
          {/* Outer shell — slightly rounded for realism */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color="#1a1c1f" roughness={0.88} metalness={0.15} />
          </mesh>

          {/* Back bulge — CRTs have a rounded back */}
          <mesh position={[0, 0, -d / 2 - 0.06 * s]} castShadow>
            <boxGeometry args={[w * 0.85, h * 0.85, 0.25 * s]} />
            <meshStandardMaterial color="#141618" roughness={0.92} metalness={0.1} />
          </mesh>
          <mesh position={[0, 0, -d / 2 - 0.14 * s]} castShadow>
            <boxGeometry args={[w * 0.6, h * 0.6, 0.15 * s]} />
            <meshStandardMaterial color="#111315" roughness={0.95} metalness={0.08} />
          </mesh>

          {/* Front bezel frame — thicker border around screen */}
          <mesh position={[0, 0, d / 2 + 0.01]}>
            <boxGeometry args={[w * 1.02, h * 1.02, 0.04]} />
            <meshStandardMaterial color="#222428" roughness={0.85} metalness={0.2} />
          </mesh>

          {/* Screen recess / inset */}
          <mesh position={[0, 0, d / 2 + 0.022]}>
            <boxGeometry args={[w - bz, h - bz, 0.044]} />
            <meshStandardMaterial color="#050505" roughness={0.95} />
          </mesh>

          {/* Curved glass layer over the screen */}
          <mesh position={[0, 0, d / 2 + 0.05]} castShadow={false}>
            <boxGeometry args={[w - bz * 1.4, h - bz * 1.4, 0.01]} />
            <meshPhysicalMaterial
              color="#ffffff"
              transparent
              opacity={0.1}
              roughness={0.1}
              metalness={0.1}
              clearcoat={1}
              clearcoatRoughness={0.1}
              depthWrite={false}
              fog={false}
            />
          </mesh>

          {/* Fake reflection from neighboring TV glow */}
          <mesh position={[0, 0, d / 2 + 0.051]} castShadow={false}>
            <planeGeometry args={[w - bz * 1.6, h - bz * 1.6]} />
            <meshBasicMaterial
              ref={reflectionRef}
              color="#c8d0e8"
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>

          {/* Bottom panel strip */}
          <mesh position={[0, -h / 2 + 0.04 * s, d / 2 + 0.015]}>
            <boxGeometry args={[w, 0.1 * s, 0.03]} />
            <meshStandardMaterial color="#1e2024" roughness={0.85} metalness={0.25} />
          </mesh>

          {/* ─── CONTROLS (bottom-right of front face) ─── */}
          {/* Channel/volume dial */}
          <mesh position={[w / 2 - 0.12 * s, -h / 2 + 0.06 * s, d / 2 + 0.03]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.04 * s, 0.04 * s, 0.025, 16]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.7} metalness={0.4} />
          </mesh>
          <mesh position={[w / 2 - 0.25 * s, -h / 2 + 0.06 * s, d / 2 + 0.03]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.03 * s, 0.03 * s, 0.025, 16]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.7} metalness={0.4} />
          </mesh>

          {/* Power button */}
          <mesh position={[-w / 2 + 0.1 * s, -h / 2 + 0.06 * s, d / 2 + 0.028]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022 * s, 0.022 * s, 0.02, 8]} />
            <meshStandardMaterial color="#1e1e1e" roughness={0.8} metalness={0.3} />
          </mesh>

          {/* LED indicator */}
          <mesh ref={ledRef} position={[-w / 2 + 0.18 * s, -h / 2 + 0.06 * s, d / 2 + 0.03]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.012 * s, 0.012 * s, 0.015, 8]} />
            <meshStandardMaterial color="#22cc44" emissive="#22cc44" emissiveIntensity={1.5} toneMapped={false} />
          </mesh>

          {/* Brand plate (center bottom) */}
          <mesh position={[0, -h / 2 + 0.06 * s, d / 2 + 0.035]}>
            <boxGeometry args={[0.15 * s, 0.04 * s, 0.01]} />
            <meshStandardMaterial color="#d0d0d0" roughness={0.4} metalness={0.8} />
          </mesh>

          {/* ─── VENTILATION (back & top) ─── */}
          {/* Back Vents */}
          {Array.from({ length: 8 }).map((_, i) => (
            <mesh key={`bv-${i}`} position={[(i - 3.5) * 0.08 * s, h * 0.15, -d / 2 - 0.01]}>
              <boxGeometry args={[0.03 * s, 0.28 * s, 0.01]} />
              <meshStandardMaterial color="#0e1012" roughness={0.95} />
            </mesh>
          ))}
          {/* Top Vents */}
          {Array.from({ length: 12 }).map((_, i) => (
            <mesh key={`tv-${i}`} position={[(i - 5.5) * 0.06 * s, h / 2 + 0.005, -0.05 * s]}>
              <boxGeometry args={[0.02 * s, 0.015, 0.15 * s]} />
              <meshStandardMaterial color="#0e1012" roughness={0.95} />
            </mesh>
          ))}

          {/* ─── SIDE DETAILS ─── */}
          {/* Left side ridges */}
          {[0.12, 0.0, -0.12].map((y, i) => (
            <mesh key={`ls-${i}`} position={[-w / 2 - 0.005, y * s, -d * 0.15]}>
              <boxGeometry args={[0.015, 0.04 * s, d * 0.5]} />
              <meshStandardMaterial color="#16181b" roughness={0.9} />
            </mesh>
          ))}
          {/* Right side speaker grille */}
          {[0.15, 0.08, 0.01, -0.06, -0.13].map((y, i) => (
            <mesh key={`spk-${i}`} position={[w / 2 + 0.01, y * s, d * 0.05]}>
              <boxGeometry args={[0.02, 0.02 * s, 0.05 * s]} />
              <meshStandardMaterial color="#0d0d0d" roughness={0.95} />
            </mesh>
          ))}

          {/* ─── TOP: antenna mounts ─── */}
          {/* Left Mount */}
          <mesh position={[-w * 0.2, h / 2 + 0.02 * s, 0]}>
            <cylinderGeometry args={[0.015 * s, 0.02 * s, 0.05 * s, 8]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.7} metalness={0.5} />
          </mesh>

          {/* Right Mount */}
          <mesh position={[w * 0.2, h / 2 + 0.02 * s, 0]}>
            <cylinderGeometry args={[0.015 * s, 0.02 * s, 0.05 * s, 8]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.7} metalness={0.5} />
          </mesh>

          {/* ─── BOTTOM: feet ─── */}
          {[-0.3, 0.3].map((x, i) => (
            <mesh key={`ft-${i}`} position={[x * w, -h / 2 - 0.02 * s, d * 0.1]}>
              <boxGeometry args={[0.08 * s, 0.04 * s, 0.1 * s]} />
              <meshStandardMaterial color="#111315" roughness={0.9} metalness={0.2} />
            </mesh>
          ))}

          {/* ─── SCREWS (front face corners) ─── */}
          {[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy], i) => (
            <mesh key={`scr-${i}`} position={[sx * (w / 2 - 0.05 * s), sy * (h / 2 - 0.05 * s), d / 2 + 0.025]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.01 * s, 0.01 * s, 0.01, 6]} />
              <meshStandardMaterial color="#3a3a3e" roughness={0.6} metalness={0.6} />
            </mesh>
          ))}

          {/* ─── SCREEN (unchanged) ─── */}
          <mesh ref={screenRef} position={[0, 0, d / 2 + 0.048]}>
            <planeGeometry args={[w - bz * 1.5, h - bz * 1.5]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.8} toneMapped={false} />
          </mesh>


          {/* Text overlay */}
          <mesh ref={textRef} position={[0, 0, d / 2 + 0.055]}>
            <planeGeometry args={[w - bz * 1.5, h - bz * 1.5]} />
            <meshBasicMaterial map={textTexture} transparent opacity={0} />
          </mesh>
        </group>

        {/* ── HITBOX (Invisible, precisely matches physical model shape) ── */}
        <mesh ref={hitboxRef} visible={false}>
          <boxGeometry args={[w, h, d]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </group>
    </group>
  );
}

// ─── CAMERA RIG: manual raycaster + intro fly-in ──────────
function CameraRig({ isModalOpen }) {
  const { camera, pointer } = useThree();
  const basePos = useMemo(() => new THREE.Vector3(0.3, 8.5, 9.5), []);
  const targetCamPos = useRef(new THREE.Vector3(-20, 5, 25));
  const targetLookAt = useRef(new THREE.Vector3(0.3, 9.0, -4));

  // Base lerp tracking state so we can apply the exact pendulum on top instantaneously
  const lerpedCamPos = useRef(new THREE.Vector3(-20, 5, 25));
  const lerpedLookAt = useRef(new THREE.Vector3(0.3, 9.0, -4));
  const smoothLookAt = useRef(new THREE.Vector3(0.3, 9.0, -4));
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const flyInTimer = useRef(0);
  const pendulumPhase = useRef(0);
  const currentFreq = useRef(0); // Starts at 0
  const lastHovId = useRef(null);
  const swingInfluence = useRef(0);
  const lastSwingX = useRef(0);
  const swayTriggered = useRef(false);

  const potentialHoverId = useRef(null);
  const hoverLockTimer = useRef(0);
  const hasTriggeredAutoZoomHover = useRef(false);

  // Start camera very far away
  React.useEffect(() => {
    camera.position.set(-20, 5, 25);
    camera.lookAt(0.3, 9.0, -4);
  }, [camera]);

  const tvWorldPos = useMemo(() =>
    TV_DATA.map(tv => new THREE.Vector3(
      tv.position[0],
      tv.position[1] - tv.wireLength,
      tv.position[2]
    )), []);

  useFrame((state, delta) => {
    // Don't move camera until loading screen is fading out enough
    // Added a small delay to prevent the initial "glitch/stutter" on reveal
    if (!cameraReady.current || flyInTimer.current < 0.1) {
      if (cameraReady.current) flyInTimer.current += delta;
      return;
    }

    flyInTimer.current += delta;
    introTimer.current = flyInTimer.current;

    // First pan is now 3.8s (was 2.2s) for a more majestic entry
    const introComplete = flyInTimer.current > 3.8;

    // Initial auto-zoom phase starts later (at 3.8s) and lasts 0.45s
    const autoZoomPhase = flyInTimer.current > 3.8 && flyInTimer.current < 4.25;

    const autoZoomFinished =
      !hasTriggeredAutoZoomHover.current && flyInTimer.current >= 4.25;

    if (autoZoomFinished) {
      hasTriggeredAutoZoomHover.current = true;
      hoverState.current = 1;
      playStaticBurst();
    }

    // Global status for the cursor (no longer locked, just used for initialization)
    window.__isIntroActive = !introComplete || autoZoomPhase;

    // ── MANUAL HOVER DETECTION (only after fly-in and auto-zoom) ──
    if (autoZoomPhase) {
      // lock camera target to TV #1
      // but DO NOT trigger hover yet
    } else if (introComplete) {
      raycaster.setFromCamera(pointer, camera);
      const meshes = tvHitboxes.map(h => h.mesh).filter(Boolean);
      const hits = raycaster.intersectObjects(meshes, false);

      if (hits.length > 0) {
        const entry = tvHitboxes.find(h => h.mesh === hits[0].object);
        if (entry) {
          if (hoverState.current !== entry.id) {
            playStaticBurst();
            hoverState.current = entry.id;
          }
        }
      } else {
        // Sticky Hover: Only release if the mouse moves significantly away
        const distToCenter = Math.sqrt(pointer.x * pointer.x + pointer.y * pointer.y);
        if (distToCenter > 0.6) {
          if (hoverState.current !== null) {
            hoverState.current = null;
          }
        }
      }
    }

    // ── CAMERA ZOOM + PAN ──
    const hovId = autoZoomPhase ? null : hoverState.current;

    // We compute a "base" target ignoring the pendulum
    if (autoZoomPhase) {
      const p = tvWorldPos[0];

      targetCamPos.current.set(
        p.x + pointer.x * 0.8,
        p.y + pointer.y * 0.8,
        p.z + 5.5
      );

      targetLookAt.current.set(p.x, p.y, p.z);

    } else if (hovId) {
      lastHovId.current = hovId;
      const idx = TV_DATA.findIndex(tv => tv.id === hovId);
      if (idx !== -1) {
        const p = tvWorldPos[idx];
        // Retain slight mouse parallax
        targetCamPos.current.set(p.x + pointer.x * 0.8, p.y + pointer.y * 0.8, p.z + 5.5);
        targetLookAt.current.set(p.x, p.y, p.z);
      }
    } else {
      // Direct return to center (no longer 2-stage)
      targetCamPos.current.set(
        basePos.x + pointer.x * 1.5,
        basePos.y + pointer.y * 1.0,
        basePos.z
      );
      targetLookAt.current.set(0.3, 9.0, -4);
    }

    // Moderate snappy return
    const baseSpeed = hovId ? 5.5 : 3.5;
    const speed = autoZoomPhase ? 4.5 * delta : (introComplete ? baseSpeed * delta : 1.4 * delta);

    // Lerp the base positions
    lerpedCamPos.current.lerp(targetCamPos.current, speed);
    lerpedLookAt.current.lerp(targetLookAt.current, speed);

    // ── SHARED PENDULUM CALCULATION ──
    // Sway only starts once the user has finished the first auto-zoom (hover off)
    if (!hovId && introComplete && !swayTriggered.current && !autoZoomPhase) {
      swayTriggered.current = true;
    }

    // Sway is slower (0.38), and continues if a modal is open even if hovered
    const targetFreq = (hovId || (!swayTriggered.current && !isModalOpen)) ? 0 : 0.38;
    currentFreq.current = THREE.MathUtils.lerp(currentFreq.current, targetFreq, 0.05);
    pendulumPhase.current += delta * currentFreq.current;
    window.__pendulumPhase = pendulumPhase.current;

    const globalPendulum = Math.sin(pendulumPhase.current) * 0.06;
    window.__sharedPendulum = globalPendulum;
    window.__isAnyTVHovered = !!hovId;

    // Impact Flicker Calculation (1.8s - 2.1s)
    const it = introTimer.current;
    let impactType = 0;
    if (it > 1.8 && it < 2.13) {
      const elapsed = it - 1.8;
      // Ultra Fast: 0.033s per state (2 frames at 60fps). 
      // 10 stages total. 
      const stage = Math.floor(elapsed / 0.033);
      if (stage >= 8) impactType = 3; // Total Blackout for last 2 stages
      else if (stage % 2 === 1) impactType = 2; // Black bg, White TVs
      else impactType = 0; // Normal state
    }
    window.__impactType = impactType;
    if (impactOverlayRef.current) {
      impactOverlayRef.current.style.opacity = (impactType === 3 || abyssBlackout.current) ? 1 : 0;
    }

    const targetInfluence = hovId ? 1 : 0;
    swingInfluence.current = THREE.MathUtils.lerp(swingInfluence.current, targetInfluence, 0.08);

    // Track the swing of the ACTIVE TV, but keep the value during un-hover to prevent snapping
    let activeSwingX = 0;
    if (hovId) {
      const tv = TV_DATA.find(t => t.id === hovId);
      if (tv) {
        activeSwingX = tv.wireLength * Math.sin(globalPendulum);
        lastSwingX.current = activeSwingX;
      }
    } else {
      activeSwingX = lastSwingX.current;
    }

    camera.position.copy(lerpedCamPos.current);
    camera.position.x += activeSwingX * swingInfluence.current;

    smoothLookAt.current.copy(lerpedLookAt.current);
    smoothLookAt.current.x += activeSwingX * swingInfluence.current;

    camera.lookAt(smoothLookAt.current);
  });

  return null;
}



// ─── ANIMATED CLOUDS ────────────────────────────────────────────
function AnimatedClouds() {
  const groupRef = useRef();
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.03) * 5;
      groupRef.current.position.z = Math.cos(state.clock.elapsedTime * 0.02) * 3;
    }
  });
  return (
    <group ref={groupRef}>
      <Clouds material={THREE.MeshBasicMaterial}>
        <Cloud segments={35} bounds={[22, 6, 10]} volume={26} color="#151515" position={[0, 18, -30]} speed={0.3} />
        <Cloud segments={22} bounds={[15, 4, 5]} volume={20} color="#101010" position={[-12, 12, -22]} speed={0.2} />
        <Cloud segments={22} bounds={[15, 4, 5]} volume={20} color="#101010" position={[12, 14, -25]} speed={0.25} />
        <Cloud segments={18} bounds={[20, 3, 8]} volume={18} color="#0d0d0d" position={[5, 20, -35]} speed={0.15} />
      </Clouds>
    </group>
  );
}

// ─── SHADOW TENDRILS (dark shapes drifting in the void) ─────────
function ShadowTendril({ index }) {
  const meshRef = useRef();
  const speed = useMemo(() => 0.04 + index * 0.015, [index]);
  const baseX = useMemo(() => (index - 1.5) * 8, [index]);
  const baseY = useMemo(() => 7 + index * 1.5, [index]);
  const baseZ = useMemo(() => -15 - index * 3, [index]);

  const uniforms = useMemo(() => ({
    time: { value: 0 }
  }), []);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    uniforms.time.value = t;
    if (meshRef.current) {
      meshRef.current.position.x = baseX + Math.sin(t * speed) * 12;
      meshRef.current.position.y = baseY + Math.sin(t * speed * 0.6 + index) * 4;
      meshRef.current.position.z = baseZ + Math.cos(t * speed * 0.4) * 3;
      meshRef.current.rotation.z = Math.sin(t * speed * 0.3) * 0.6;
      meshRef.current.rotation.y = Math.cos(t * speed * 0.5 + index * 2) * 0.4;
    }
  });

  return (
    <mesh ref={meshRef} position={[baseX, baseY, baseZ]}>
      <planeGeometry args={[18, 12]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        uniforms={uniforms}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float time;
          varying vec2 vUv;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
              f.y
            );
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 4; i++) {
              v += noise(p) * a;
              p *= 2.0;
              a *= 0.5;
            }
            return v;
          }
          void main() {
            vec2 uv = vUv;
            float n = fbm(uv * 3.0 + time * 0.08);
            float edge = smoothstep(0.0, 0.3, uv.x) * smoothstep(1.0, 0.7, uv.x)
                       * smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.7, uv.y);
            float alpha = n * edge * 0.2;
            gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
          }
        `}
      />
    </mesh>
  );
}

// ─── ABYSS BREATHING (fog oscillation + rare blackout) ──────────
function AbyssBreathing() {
  const { scene } = useThree();
  const ambientRef = useRef(null);
  const nextBlackout = useRef(50 + Math.random() * 25);
  const blackoutEnd = useRef(0);
  const blackoutCount = useRef(0);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (introTimer.current < 3.8) return;

    // Cache ambient light reference
    if (!ambientRef.current) {
      scene.traverse((child) => {
        if (child.isAmbientLight) ambientRef.current = child;
      });
    }

    // Breathing fog (12s cycle)
    const breathPhase = Math.sin(t * (Math.PI * 2 / 12));
    if (scene.fog) {
      scene.fog.density = 0.025 + breathPhase * 0.007;
    }

    // Ambient light breathing — dimmer when fog thickens
    if (ambientRef.current) {
      ambientRef.current.intensity = 0.2 - breathPhase * 0.04;
    }

    // Rare blackout event (max 2 per session)
    if (t > nextBlackout.current && !abyssBlackout.current && blackoutCount.current < 2) {
      abyssBlackout.current = true;
      blackoutEnd.current = t + 0.3;
      blackoutCount.current++;
      nextBlackout.current = t + 55 + Math.random() * 30;
      playBlackoutSound();
    }
    if (abyssBlackout.current && t > blackoutEnd.current) {
      abyssBlackout.current = false;
      playTurnOnSound();
    }
  });

  return null;
}

// ─── SCENE ──────────────────────────────────────────────────────
function Scene({ setActiveModal, isModalOpen, impactOverlayRef }) {
  const { scene } = useThree();
  const groundMatRef = useRef();

  useFrame(() => {
    const it = window.__impactType || 0;
    const time = introTimer.current;

    // Base color is very dark before turn-on, then the current light gray after
    const baseColor = time < 1.8 ? '#050505' : '#222222';

    // Type 2 = Black bg, Type 3 = TOTAL BLACKOUT
    const targetColor = (it === 2 || it === 3 || abyssBlackout.current) ? '#000000' : baseColor;

    if (scene.background) scene.background.set(targetColor);
    if (scene.fog) scene.fog.color.set(targetColor);
    if (groundMatRef.current) groundMatRef.current.color.set(targetColor);
  });

  return (
    <>
      <color attach="background" args={['#222222']} />
      <fogExp2 attach="fog" args={['#222222', 0.025]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[5, 20, 5]} intensity={0.5} castShadow />

      <CameraRig isModalOpen={isModalOpen} impactOverlayRef={impactOverlayRef} />

      <AnimatedClouds />

      {/* Shadow tendrils drifting in the darkness */}
      {[0, 1, 2, 3].map(i => <ShadowTendril key={i} index={i} />)}

      {/* Abyss breathing — fog oscillation + rare blackout */}
      <AbyssBreathing />

      {/* Ground plane — vast, matches fog for seamless horizon */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -12, -20]} receiveShadow>
        <planeGeometry args={[1000, 1000]} />
        <meshStandardMaterial ref={groundMatRef} color="#050505" roughness={1} />
      </mesh>



      {TV_DATA.map((tv) => (
        <HangingTV key={tv.id} data={tv} setActiveModal={setActiveModal} />
      ))}

      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={1.8} luminanceSmoothing={0.6} intensity={0.8} />
        <Noise opacity={0.15} />
        <Vignette eskil={false} offset={0.1} darkness={0.55} />
      </EffectComposer>
    </>
  );
}

// ─── CUSTOM CURSOR ───────────────────────────────────────────────
function CustomCursor({ phase }) {
  const [bootState, setBootState] = useState('idle');
  const cursorRef = useRef();
  const dormantRef = useRef();

  const state = useRef({
    isBooted: false,
    dormantVisible: true,
    showActual: false,
    hasMoved: false
  });

  // Safe center fallback
  const getCenter = () => ({
    x:
      typeof window !== 'undefined'
        ? window.innerWidth / 2
        : 800,
    y:
      typeof window !== 'undefined'
        ? window.innerHeight / 2
        : 600
  });

  const center = getCenter();

  const mousePos = useRef({ ...center });
  const currentPos = useRef({ ...center });
  const dormantPos = useRef({
    x: center.x - 70,
    y: center.y + 105
  });
  const dormantSize = useRef(12);

  React.useEffect(() => {
    const setCursorPosition = (el, x, y) => {
      if (!el) return;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };

    // Immediately place both cursors on mount
    setCursorPosition(cursorRef.current, center.x, center.y);
    setCursorPosition(
      dormantRef.current,
      dormantPos.current.x,
      dormantPos.current.y
    );

    const updatePos = (e) => {
      const x = e.clientX;
      const y = e.clientY;

      // Ignore invalid initial events
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        (x === 0 && y === 0)
      ) {
        return;
      }

      mousePos.current = { x, y };

      // Snap immediately on first valid movement
      if (!state.current.hasMoved) {
        currentPos.current = { x, y };
        setCursorPosition(cursorRef.current, x, y);
      }

      state.current.hasMoved = true;
    };

    window.addEventListener('mousemove', updatePos, { passive: true });
    window.addEventListener('pointermove', updatePos, { passive: true });
    window.addEventListener('mouseenter', updatePos, { passive: true });

    let raf;
    const lerp = (a, b, t) => a + (b - a) * t;

    const animate = () => {
      if (cursorRef.current) {
        currentPos.current.x = lerp(
          currentPos.current.x,
          mousePos.current.x,
          0.2
        );
        currentPos.current.y = lerp(
          currentPos.current.y,
          mousePos.current.y,
          0.2
        );

        setCursorPosition(
          cursorRef.current,
          currentPos.current.x,
          currentPos.current.y
        );

        if (state.current.showActual) {
          // Only trigger this once
          if (cursorRef.current.style.opacity !== '1') {
            cursorRef.current.style.opacity = '1';
            cursorRef.current.classList.add('cursor-power-flicker', 'cursor-periodic');
          }
        }
      }

      if (dormantRef.current && state.current.dormantVisible) {
        if (state.current.isBooted) {
          dormantPos.current.x = lerp(
            dormantPos.current.x,
            currentPos.current.x,
            0.1
          );
          dormantPos.current.y = lerp(
            dormantPos.current.y,
            currentPos.current.y,
            0.1
          );

          // Shrink size during travel
          dormantSize.current = lerp(dormantSize.current, 5, 0.05);
          dormantRef.current.style.width = `${dormantSize.current}px`;
          dormantRef.current.style.height = `${dormantSize.current}px`;

          const dist = Math.hypot(
            dormantPos.current.x - currentPos.current.x,
            dormantPos.current.y - currentPos.current.y
          );

          if (dist < 4 && state.current.hasMoved) {
            state.current.dormantVisible = false;
            state.current.showActual = true;
            dormantRef.current.style.display = 'none';
          }
        }

        setCursorPosition(
          dormantRef.current,
          dormantPos.current.x,
          dormantPos.current.y
        );
      }

      raf = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('mousemove', updatePos);
      window.removeEventListener('pointermove', updatePos);
      window.removeEventListener('mouseenter', updatePos);
      cancelAnimationFrame(raf);
    };
  }, []);

  React.useEffect(() => {
    if (phase === 'loading') {
      const startupTimer = setTimeout(() => {
        setBootState('booting');
      }, 500);

      const moveTimer = setTimeout(() => {
        state.current.isBooted = true;
      }, 1200);

      return () => {
        clearTimeout(startupTimer);
        clearTimeout(moveTimer);
      };
    } else if (phase === 'blackout' || phase === 'reveal' || phase === 'done') {
      // If the user clicks ENTER early, force the cursor to start its journey immediately
      state.current.isBooted = true;
    }
  }, [phase]);

  const isVisible = phase !== 'init';

  return (
    <>
      <div
        ref={dormantRef}
        className={`fixed pointer-events-none rounded-full cursor-blink ${bootState === 'booting' ? 'dormant-startup' : ''}`}
        style={{
          width: '12px',
          height: '12px',
          transform: 'translate(-50%, -50%)',
          opacity: isVisible ? 1 : 0,
          zIndex: 105,
          transition: 'opacity 0.5s ease-out'
        }}
      />

      <div
        ref={cursorRef}
        className="fixed pointer-events-none rounded-full z-[99999]"
        style={{
          width: '5px',
          height: '5px',
          transform: 'translate(-50%, -50%)',
          opacity: 0,
          backgroundColor: '#ffffff',
          boxShadow:
            '0 0 6px 1px rgba(255,255,255,0.8), 0 0 12px 3px rgba(255,255,255,0.4)'
        }}
      />
    </>
  );
}

// ─── APP ─────────────────────────────────────────────────────────
export default function App() {
  const [activeModal, setActiveModal] = useState(null);
  const [modalView, setModalView] = useState('root');
  const [typewriterContent, setTypewriterContent] = useState('');
  const [phase, setPhase] = useState('init'); // Start in init phase (pure black)
  const [hasTurnedOn, setHasTurnedOn] = useState(false);
  const [canLoadScene, setCanLoadScene] = useState(false);
  const [identityName, setIdentityName] = useState('ASA');
  const staticCanvasRef = useRef(null);

  // Periodic "Delete and Type" Identity Glitch
  React.useEffect(() => {
    if (activeModal?.id !== 1) {
      setIdentityName('ASA');
      return;
    }

    const runGlitch = async () => {
      // 1. Delete "ASA"
      const d1 = ['AS', 'A', ''];
      for (const s of d1) {
        setIdentityName(s);
        playDeleteSound();
        await new Promise(r => setTimeout(r, 65));
      }

      // 2. Type "ZURY"
      const t1 = ['Z', 'ZU', 'ZUR', 'ZURY'];
      for (let idx = 0; idx < t1.length; idx++) {
        setIdentityName(t1[idx]);
        if (idx % 3 === 0) playTypeSound();
        await new Promise(r => setTimeout(r, 65));
      }

      await new Promise(r => setTimeout(r, 1200)); // Stay as ZURY

      // 3. Delete "ZURY"
      const d2 = ['ZUR', 'ZU', 'Z', ''];
      for (const s of d2) {
        setIdentityName(s);
        playDeleteSound();
        await new Promise(r => setTimeout(r, 65));
      }

      // 4. Type "ASA"
      const t2 = ['A', 'AS', 'ASA'];
      for (let idx = 0; idx < t2.length; idx++) {
        setIdentityName(t2[idx]);
        if (idx % 3 === 0) playTypeSound();
        await new Promise(r => setTimeout(r, 65));
      }
    };

    const interval = setInterval(() => {
      runGlitch();
    }, 7000); // Trigger every 7s

    return () => clearInterval(interval);
  }, [activeModal]);

  // Initial sequence: Init (black) -> Loading (ASA)
  React.useEffect(() => {
    // 1. Start loading the heavy 3D scene immediately behind the black veil
    setCanLoadScene(true);

    // 2. Wait 0.5s for the initial initialization stutter to pass, then reveal ASA
    const timer = setTimeout(() => {
      setPhase('loading');
    }, 500); // was 800

    return () => clearTimeout(timer);
  }, []);

  // Typewriter effect and delayed glitch for modal
  React.useEffect(() => {
    if (!activeModal) {
      setTypewriterContent('');
      setModalView('root'); // Reset on close
      return;
    }

    const targetContent = modalView === 'root' ? activeModal.content : (activeModal.subViews?.[modalView] || activeModal.content);

    let currentInterval = null;
    let glitchTimeout = null;
    let revertTimeout = null;

    const typeOut = (text, speed, onComplete) => {
      if (currentInterval) clearInterval(currentInterval);
      setTypewriterContent('');
      let i = 0;
      currentInterval = setInterval(() => {
        // Only jump past hidden system tags. Do NOT jump past content tags like [80%]
        const isSystemTag = text.startsWith('[LINK:', i) || text.startsWith('[INSTA]', i) || text.startsWith('[DISCO]', i);

        if (isSystemTag) {
          const endTag = text.indexOf(']', i);
          if (endTag !== -1) {
            i = endTag;
          }
        }

        setTypewriterContent(text.slice(0, i + 1));
        if (i % 3 === 0) playTypeSound();
        i++;
        if (i >= text.length) {
          clearInterval(currentInterval);
          if (onComplete) onComplete();
        }
      }, speed);
    };

    // Always start with normal text (Faster typewriter speed)
    typeOut(targetContent, activeModal.typeSpeed || 5); // was 9

    // Random delay glitch effect
    if (activeModal.glitchContent && modalView === 'root') {
      // Wait between 6 and 8 seconds after opening
      const delay = 6000 + Math.random() * 2000;
      glitchTimeout = setTimeout(() => {
        // 15% chance to trigger the glitch
        if (Math.random() < 0.15) {
          playStaticBurst();
          typeOut(activeModal.glitchContent, 25, () => {
            // After typing glitch text, wait 2 seconds, then revert
            revertTimeout = setTimeout(() => {
              playStaticBurst();
              typeOut(activeModal.content, 18);
            }, 2000);
          });
        }
      }, delay);
    }

    return () => {
      if (currentInterval) clearInterval(currentInterval);
      clearTimeout(glitchTimeout);
      clearTimeout(revertTimeout);
    };
  }, [activeModal, modalView]);

  // Animated moving static on canvas
  React.useEffect(() => {
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;
    const draw = () => {
      canvas.width = window.innerWidth / 3;
      canvas.height = window.innerHeight / 3;
      const w = canvas.width;
      const h = canvas.height;
      const imgData = ctx.createImageData(w, h);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [phase]); // 'loading' | 'blackout' | 'reveal' | 'done'

  const handleEnter = () => {
    getAudioCtx();
    playEnterSound();
    // Phase 1: Fade IN to solid black (text vanishes, background stays)
    setPhase('blackout');

    // Phase 2: Start the reveal (fade OUT to transparent) after 0.15s (was 0.3s)
    setTimeout(() => {
      cameraReady.current = true;
      setPhase('reveal');
      // Trigger the static layer and AMBIENT SOUND when the TVs spark on
      setTimeout(() => {
        setHasTurnedOn(true);
        startAmbient();
      }, 850); // was 1050
    }, 150); // was 300

    // Phase 3: Remove overlay entirely (longer to account for slower pan)
    setTimeout(() => setPhase('done'), 4150);
  };

  return (
    <div className="w-full h-screen bg-[#0a0a0a] overflow-hidden">
      {/* Canvas always renders, but scene content is delayed to stop glitching */}
      <Canvas shadows camera={{ position: [-20, 5, 25], fov: 45 }} gl={{ toneMappingExposure: 1.1 }}>
        {canLoadScene && <Scene setActiveModal={setActiveModal} isModalOpen={!!activeModal} />}
      </Canvas>

      {/* Persistent Static Layer at z-110 (Above dormant cursor, below text) */}
      {phase !== 'done' && (
        <canvas ref={staticCanvasRef}
          className="fixed inset-0 w-full h-full pointer-events-none z-[110]"
          style={{
            mixBlendMode: 'screen',
            opacity: phase !== 'done' ? 0.12 : 0,
            transition: 'opacity 1.5s ease-in-out'
          }} />
      )}

      {/* Loading / Blackout / Reveal overlay */}
      {phase !== 'done' && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center select-none"
          onClick={phase === 'loading' ? handleEnter : undefined}
          style={{
            background: '#000000',
            // It's solid black during 'init', 'blackout' and partially during 'loading' fade
            opacity: phase === 'reveal' ? 0 : 1,
            transition: 'opacity 0.8s ease-in-out',
            cursor: phase === 'loading' ? 'pointer' : 'default',
            pointerEvents: phase === 'loading' ? 'auto' : 'none'
          }}
        >
          {/* Impact Frames (Legacy removed as we now use 3D overrides) */}

          {/* Only show content during loading; it fades with the overlay background during blackout */}
          <div style={{
            opacity: phase === 'loading' ? 1 : 0,
            transition: 'opacity 0.05s ease-in-out',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            position: 'relative',
            zIndex: 120 // Highest layer: ASA text
          }}>

            {/* Moving scan bar */}
            <div className="absolute inset-0 pointer-events-none scan-bar" />
            {/* Scanlines */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom,transparent 50%,rgba(255,255,255,0.015) 50%)', backgroundSize: '100% 3px' }} />
            {/* Vignette */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 100%)' }} />
            {/* ASA text — TV-style flicker */}
            <h1 className={`asa-text relative text-[14vw] font-black tracking-[0.5em] text-white transition-all duration-700 ${phase === 'blackout' ? 'asa-death-glitch' : ''}`}
              style={{
                fontFamily: 'monospace',
                textShadow: phase === 'loading' ? '0 0 30px rgba(255,255,255,0.5)' : '0 0 100px rgba(255,255,255,1), 0 0 200px rgba(255,255,255,0.5)'
              }}
            >ASA</h1>
            <p className="mt-6 text-xs tracking-[0.8em] uppercase text-white/15 font-mono asa-flicker">
              click anywhere to enter
            </p>
          </div>
        </div>
      )}

      <style>{`
        * {
          cursor: none !important;
        }
        @keyframes staticNoise {
          0%   { background-position: 0 0 }
          10%  { background-position: -5% -10% }
          20%  { background-position: -15% 5% }
          30%  { background-position: 7% -25% }
          40%  { background-position: 20% 25% }
          50%  { background-position: -25% 10% }
          60%  { background-position: 15% 5% }
          70%  { background-position: 0 15% }
          80%  { background-position: 25% 35% }
          90%  { background-position: -10% 10% }
          100% { background-position: 0 0 }
        }
        .tv-static {
          position: absolute; inset: 0;
          background-image: repeating-radial-gradient(circle at 17% 32%, #fff, #000 0.00085px);
          animation: staticNoise 0.15s steps(1) infinite;
        }
        .loading-static {
          background-image: repeating-radial-gradient(circle at 17% 32%, #fff, #000 0.0008px);
          animation: staticNoise 0.06s steps(1) infinite;
        }
        @keyframes scanMove {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        .scan-bar {
          background: linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%);
          height: 25%;
          animation: scanMove 3.5s linear infinite;
        }
        @keyframes tvFlicker {
          0%, 100% { text-shadow: 0 0 30px rgba(255,255,255,0.5), 0 0 80px rgba(255,255,255,0.15); opacity: 1; }
          3% { text-shadow: 0 0 40px rgba(255,255,255,0.7), 0 0 100px rgba(255,255,255,0.2); opacity: 1; }
          4% { text-shadow: 0 0 5px rgba(255,255,255,0.2), 0 0 20px rgba(255,255,255,0.05); opacity: 0.7; }
          5% { text-shadow: 0 0 50px rgba(255,255,255,0.8), 0 0 120px rgba(255,255,255,0.3); opacity: 1; }
          20% { text-shadow: 0 0 35px rgba(255,255,255,0.55), 0 0 90px rgba(255,255,255,0.18); opacity: 1; }
          50% { text-shadow: 0 0 25px rgba(255,255,255,0.45), 0 0 70px rgba(255,255,255,0.12); opacity: 1; }
          51% { opacity: 0.6; }
          52% { opacity: 1; }
          80% { text-shadow: 0 0 30px rgba(255,255,255,0.5), 0 0 80px rgba(255,255,255,0.15); opacity: 1; }
          92% { opacity: 1; }
          93% { opacity: 0.4; }
          94% { opacity: 1; }
        }
        .asa-text {
          animation: tvFlicker 3s ease-in-out infinite;
        }
        @keyframes subFlicker {
          0%, 90%, 100% { opacity: 0.15; }
          91% { opacity: 0; }
          93% { opacity: 0.15; }
          95% { opacity: 0.04; }
          97% { opacity: 0.15; }
        }
        .asa-flicker {
          animation: subFlicker 2.5s infinite;
        }
        .modal-glow {
          text-shadow: 0 0 10px rgba(255,255,255,0.8), 0 0 20px rgba(255,255,255,0.4);
        }
        @keyframes cursorBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .cursor-blink {
          animation: cursorBlink 1s infinite;
        }
        @keyframes cursorPowerFlicker {
          0% { background-color: #111; box-shadow: none; opacity: 0.5; }
          15% { background-color: #666; box-shadow: 0 0 4px rgba(255,255,255,0.2); opacity: 1; }
          25% { background-color: #111; box-shadow: none; opacity: 0.4; }
          35% { background-color: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.9); opacity: 1; }
          45% { background-color: #222; box-shadow: none; }
          60% { background-color: #fff; box-shadow: 0 0 8px 2px rgba(255,255,255,0.7); opacity: 1; }
          75% { opacity: 0.6; }
          85% { opacity: 1; }
          100% { background-color: #fff; box-shadow: 0 0 6px 1px rgba(255, 255, 255, 0.8), 0 0 12px 3px rgba(255, 255, 255, 0.4); opacity: 1; }
        }
        @keyframes cursorPeriodicFlicker {
          0%, 100% { opacity: 1; filter: brightness(1); }
          5% { opacity: 0.8; filter: brightness(1.2); transform: scale(1.1); }
          7% { opacity: 1; }
          45% { opacity: 1; }
          46% { opacity: 0.6; filter: brightness(0.8); }
          47% { opacity: 1; }
          92% { opacity: 1; filter: brightness(1); }
          93% { opacity: 0.5; filter: brightness(0.6); transform: scale(0.9); }
          94% { opacity: 1; filter: brightness(1.3); transform: scale(1.1); }
          95% { opacity: 0.7; }
          96% { opacity: 1; }
        }
        .cursor-power-flicker {
          animation: cursorPowerFlicker 0.9s forwards;
        }
        .cursor-periodic {
          animation: cursorPeriodicFlicker 4s infinite;
        }
        @keyframes dormantStartup {
          0% { background-color: #1a1a1a; box-shadow: none; }
          15% { background-color: #444; box-shadow: 0 0 10px rgba(255,255,255,0.2); }
          30% { background-color: #1a1a1a; box-shadow: none; }
          45% { background-color: #fff; box-shadow: 0 0 20px rgba(255,255,255,0.6); }
          60% { background-color: #444; box-shadow: 0 0 10px rgba(255,255,255,0.2); }
          100% { background-color: #fff; box-shadow: 0 0 30px 10px rgba(255,255,255,0.8); }
        }
        .dormant-startup {
          animation: dormantStartup 1s ease-out forwards;
        }
      `}</style>

      {/* Custom Cursor */}
      <CustomCursor phase={phase} />

      {/* Modal */}
      {activeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="relative w-full max-w-2xl bg-[#0e0e0e] border border-zinc-700 shadow-[0_0_60px_rgba(255,255,255,0.04),20px_20px_0_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-10 z-0"
              style={{ background: 'linear-gradient(to bottom,transparent 50%,rgba(0,0,0,1) 50%)', backgroundSize: '100% 4px' }} />
            <div className="relative z-10 p-8 sm:p-12 text-zinc-300">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-5 mb-7">
                <h3 className="text-2xl sm:text-4xl font-black tracking-widest uppercase text-white">{activeModal.text}</h3>
                <button
                  onClick={() => {
                    if (modalView !== 'root') setModalView('root');
                    else setActiveModal(null);
                  }}
                  className="px-4 py-2 border border-zinc-600 bg-transparent hover:bg-white hover:text-black transition-all duration-200 uppercase text-xs font-bold tracking-widest cursor-pointer"
                >
                  {modalView === 'root' ? '[ X ] CLOSE' : '[ << ] BACK'}
                </button>
              </div>
              <div className="whitespace-pre-wrap leading-relaxed font-mono text-sm sm:text-base text-white modal-glow min-h-[160px]">
                {(() => {
                  const targetContent = modalView === 'root' ? activeModal.content : (activeModal.subViews?.[modalView] || activeModal.content);
                  const content = typewriterContent;
                  const isDone = content.length === targetContent.length;

                  // 1. If still typing, or NOT the Identity terminal, keep cursor at the end
                  if (!isDone || activeModal.id !== 1) {
                    const lines = content.split('\n');
                    return (
                      <>
                        {lines.map((line, idx) => {
                          const isLastLine = idx === lines.length - 1;
                          const linkMatch = line.match(/\[LINK:(.*?)\] (.*)/);
                          const instaMatch = line.includes('[INSTA]');
                          const discoMatch = line.includes('[DISCO]');
                          const sanitizedLine = line.replace(/\[LINK:.*?\]/g, '').replace(/\[INSTA\]/g, '').replace(/\[DISCO\]/g, '');

                          return (
                            <div key={idx} className="flex items-center mb-1">
                              {linkMatch ? (
                                <>
                                  <span className="opacity-60 mr-2">{'>'}</span>
                                  <a
                                    href={linkMatch[1].startsWith('internal:') ? '#' : linkMatch[1]}
                                    onClick={(e) => {
                                      if (linkMatch[1].startsWith('internal:')) {
                                        e.preventDefault();
                                        setModalView(linkMatch[1].split(':')[1]);
                                      }
                                    }}
                                    target={linkMatch[1].startsWith('internal:') ? undefined : "_blank"}
                                    rel={linkMatch[1].startsWith('internal:') ? undefined : "noopener noreferrer"}
                                    className={`text-white transition-all px-1 ${linkMatch[1].startsWith('internal:') ? 'hover:bg-white hover:text-black cursor-pointer' : 'underline underline-offset-4 hover:bg-white hover:text-black'}`}
                                  >
                                    {(() => {
                                      const linkText = linkMatch[2];
                                      if (linkText.includes('[INSTA]')) return <>{INSTA_ICON}{linkText.replace('[INSTA]', '')}</>;
                                      if (linkText.includes('[DISCO]')) return <>{DISCORD_ICON}{linkText.replace('[DISCO]', '')}</>;
                                      return linkText;
                                    })()}
                                  </a>
                                </>
                              ) : instaMatch ? (
                                <>{INSTA_ICON}{line.replace('[INSTA]', '')}</>
                              ) : discoMatch ? (
                                <>{DISCORD_ICON}{line.replace('[DISCO]', '')}</>
                              ) : (
                                sanitizedLine
                              )}
                              {isLastLine && (
                                <span className="cursor-blink inline-block w-2.5 h-4 bg-white ml-1 align-middle" />
                              )}
                            </div>
                          );
                        })}
                      </>
                    );
                  }

                  // 2. Identity Terminal is done: Move cursor back to the Identity name line
                  const parts = content.split('ASA');
                  return (
                    <>
                      {parts[0]}
                      {identityName}
                      <span className="cursor-blink inline-block w-2.5 h-4 bg-white ml-1 align-middle" />
                      {parts[1]}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={impactOverlayRef} className="fixed inset-0 bg-black pointer-events-none z-[99999]" style={{ opacity: 0 }} />
    </div>
  );
}
