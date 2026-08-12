import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, useTexture } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import './App.css';

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// AUDIO ENGINE ΓÇö Beat Detection + Smoothed Frequency Bands
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

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
  
  // ΓöÇΓöÇ Exponential Smoothing (fast attack, slow release) ΓöÇΓöÇ
  const attack = 0.35;
  const release = 0.92;
  
  const smooth = (current, target) => 
    target > current ? current * (1 - attack) + target * attack : current * release;
  
  audioState.smoothSub = smooth(audioState.smoothSub, audioState.sub);
  audioState.smoothBass = smooth(audioState.smoothBass, audioState.bass);
  audioState.smoothMid = smooth(audioState.smoothMid, audioState.mid);
  audioState.smoothHigh = smooth(audioState.smoothHigh, audioState.high);
  
  // ΓöÇΓöÇ Beat Detection via Spectral Flux ΓöÇΓöÇ
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
  
  // ΓöÇΓöÇ Pipe to CSS ΓöÇΓöÇ
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

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// 3D SCENE COMPONENTS
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

const HeartShapes = () => {
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

  return (
    <instancedMesh ref={group} args={[null, null, count]}>
      <extrudeGeometry args={[heartShape, { depth: 0.5, bevelEnabled: false }]} />
      <meshBasicMaterial color="#a020f0" transparent opacity={0.3} wireframe />
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

const VoidShapes = () => {
  const group = useRef();
  const count = 30;
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

  return (
    <instancedMesh ref={group} args={[null, null, count]}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#a020f0" wireframe transparent opacity={0.15} />
    </instancedMesh>
  );
};

const AmbientParticles = () => {
  const count = 600;
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
      
      if (audioState.smoothBass > 0) {
        mesh.current.rotation.y += delta * audioState.smoothBass * 1.2;
        matRef.current.size = 0.4 + audioState.smoothBass * 2.0;
        matRef.current.opacity = 0.3 + audioState.smoothBass * 0.7;
        
        // Color shift on heavy bass
        const b = audioState.smoothBass;
        matRef.current.color.setRGB(0.63 + b * 0.37, 0.12 * (1 - b), 0.94);
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

// ΓöÇΓöÇ Bass Shockwave Rings ΓöÇΓöÇ
const BassShockwaves = () => {
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
            mesh.material.color.setHex(0xa020f0);
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
          <meshBasicMaterial color="#a020f0" transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
};

// ΓöÇΓöÇ Audio Visualizer Ring ΓöÇΓöÇ
const AudioVisualizerRing = () => {
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
      <meshBasicMaterial color="#a020f0" transparent opacity={0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
};

// ΓöÇΓöÇ Reactive Floor Grid ΓöÇΓöÇ
const ReactiveFloor = () => {
  const meshRef = useRef();
  
  useFrame(() => {
    if (meshRef.current) {
      const b = audioState.smoothBass;
      meshRef.current.material.opacity = 0.1 + b * 0.35;
      meshRef.current.material.color.setRGB(0.02 + b * 0.4, 0, b * 0.6);
    }
  });
  
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -20, 0]}>
      <planeGeometry args={[300, 300, 32, 32]} />
      <meshBasicMaterial color="#050000" wireframe transparent opacity={0.15} />
    </mesh>
  );
};

// ΓöÇΓöÇ Reactive Fog ΓöÇΓöÇ
const ReactiveFog = () => {
  useFrame((state) => {
    if (state.scene.fog) {
      state.scene.fog.density = 0.012 + audioState.smoothBass * 0.01;
    }
  });
  return null;
};

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// DATA ΓÇö Section Content
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

const R = 30;
window.isHoveringCard = false;

const ICONS = {
  identity: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
  socials: '<svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
  status: '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>'
};

const SECTIONS_DATA = [
  {
    id: 'identity',
    title: 'IDENTITY',
    icon: ICONS.identity,
    content: `
      <div class="hud-grid">
        <div class="hud-block"><div class="hud-label">BIRTHDAY</div><div class="hud-value">JUN 23</div></div>
        <div class="hud-block"><div class="hud-label">AGE</div><div class="hud-value">19</div></div>
        <div class="hud-block full"><div class="hud-label">AFFILIATIONS</div>
          <div class="hud-value small">FREELANCE DEVELOPER</div>
          <div class="hud-value small" style="margin-top:5px">UI/UX DESIGNER</div>
          <div class="hud-value small" style="margin-top:5px">DIGITAL ARTIST</div>
        </div>
      </div>
    `
  },
  {
    id: 'socials',
    title: 'SOCIALS',
    icon: ICONS.socials,
    content: `
      <div class="hud-grid">
        <a href="https://www.instagram.com/hataeruu/" target="_blank" class="hud-block full social-link" style="text-decoration: none; flex-direction:row; justify-content:flex-start; gap:15px">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg></div>
          <div class="hud-data"><div class="hud-label">INSTAGRAM</div><div class="hud-value" style="color:var(--text-main)">hataeruu</div></div>
        </a>
        <a href="https://discord.com/users/1408523273548988456" target="_blank" class="hud-block full social-link" style="text-decoration: none; flex-direction:row; justify-content:flex-start; gap:15px">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>
          <div class="hud-data"><div class="hud-label">DISCORD</div><div class="hud-value" style="color:var(--text-main)">asari_atari</div></div>
        </a>
      </div>
    `
  },
  {
    id: 'music',
    title: 'MUSIC',
    icon: ICONS.music,
    content: `
      <div class="hud-grid">
        <div class="hud-block"><div class="hud-label">FAV ARTIST</div><div class="hud-value">fakemink</div></div>
        <div class="hud-block"><div class="hud-label">FAV SONG</div><div class="hud-value small">music and me</div></div>
        <div class="hud-block full"><div class="hud-label">NOW PLAYING</div><div class="hud-value" style="color:var(--accent)">FAKEMINK - MUSIC AND ME</div></div>
        <div class="hud-status-bar"><div class="hud-status-fill"></div></div>
      </div>
    `
  },
  {
    id: 'archive',
    title: 'ARCHIVE',
    icon: ICONS.archive,
    content: `
      <div class="hud-grid">
        <div class="hud-block full"><div class="hud-label">CURRENT FOCUS</div><div class="hud-value small">BUILDING DIGITAL EXPERIENCES</div></div>
        <div class="hud-block full"><div class="hud-label">PAST PROJECTS</div><div class="hud-value small">VARIOUS WEB INTERFACES & CREATIVE CODE</div></div>
        <div class="hud-block full"><div class="hud-label">AESTHETIC</div><div class="hud-value small">Y2K / NEON / CYBER / AMBIENT</div></div>
      </div>
    `
  },
  {
    id: 'status',
    title: 'STATUS',
    icon: ICONS.status,
    content: `
      <div class="hud-grid">
        <div class="hud-block full" style="flex-direction:row; justify-content:flex-start; gap:15px">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
          <div class="hud-data"><div class="hud-label">SYSTEM</div><div class="hud-value">ONLINE</div></div>
        </div>
        <div class="hud-block full" style="flex-direction:row; justify-content:flex-start; gap:15px">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg></div>
          <div class="hud-data"><div class="hud-label">CONNECTION</div><div class="hud-value">STABLE</div></div>
        </div>
        <div class="hud-status-bar"><div class="hud-status-fill" style="width: 100%; animation: none;"></div></div>
      </div>
    `
  }
];

const SECTIONS = SECTIONS_DATA.map((s, i) => {
  const angle = (i / SECTIONS_DATA.length) * Math.PI * 2;
  const randOffX = (Math.random() - 0.5) * 12;
  const randOffY = (Math.random() - 0.5) * 8;

  return {
    ...s,
    index: i,
    angle: angle,
    x: Math.sin(angle) * R,
    z: Math.cos(angle) * R,
    camOffset: [randOffX, -2 + randOffY, 25],
    lookOffset: [randOffX * 0.15, randOffY * 0.15, 0]
  };
});

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// CARD SYSTEM
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

const CardParticles = ({ materialized, playing, dataIndex }) => {
  const count = 100;
  const meshRef = useRef();
  const matRef = useRef();
  
  const { targetPositions, currentPositions, colors } = useMemo(() => {
    const tPos = new Float32Array(count * 3);
    const cPos = new Float32Array(count * 3);
    const cols = new Float32Array(count * 3);
    
    for(let i = 0; i < count; i++) {
      tPos[i*3] = (Math.random() - 0.5) * 22;
      tPos[i*3+1] = (Math.random() - 0.5) * 32;
      tPos[i*3+2] = (Math.random() - 0.5) * 2;
      
      cPos[i*3] = tPos[i*3] + (Math.random() - 0.5) * 40;
      cPos[i*3+1] = tPos[i*3+1] + 30 + Math.random() * 40;
      cPos[i*3+2] = tPos[i*3+2] + (Math.random() - 0.5) * 30;
      
      const r = Math.random();
      if(r > 0.6) {
        cols[i*3] = 0; cols[i*3+1] = 0; cols[i*3+2] = 0;
      } else if (r > 0.3) {
        cols[i*3] = 0.62; cols[i*3+1] = 0.12; cols[i*3+2] = 0.94;
      } else {
        cols[i*3] = 0.8; cols[i*3+1] = 0.5; cols[i*3+2] = 1.0;
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
        
        for(let i = 0; i < count; i++) {
           const targetY = targetPositions[i*3+1];
           if (targetY > scanY) {
             positions[i*3] = THREE.MathUtils.lerp(positions[i*3], targetPositions[i*3], 15 * delta);
             positions[i*3+1] = THREE.MathUtils.lerp(positions[i*3+1], targetPositions[i*3+1], 15 * delta);
             positions[i*3+2] = THREE.MathUtils.lerp(positions[i*3+2], targetPositions[i*3+2], 15 * delta);
           } else {
             positions[i*3+1] -= delta * 5;
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
      <pointsMaterial ref={matRef} size={0.3} vertexColors transparent opacity={0.9} />
    </points>
  );
};

const FloatingPanel = ({ data, activeId, onClick, playing }) => {
  const groupRef = useRef();
  const [materialized, setMaterialized] = useState(false);
  
  useFrame((state, delta) => {
    if (groupRef.current) {
      const baseFloat = Math.sin(state.clock.elapsedTime * 1.5 + data.index) * 0.5;
      const bassFloat = Math.sin(state.clock.elapsedTime * 3 + data.index * 0.7) * audioState.smoothBass * 1.5;
      groupRef.current.position.y = baseFloat + bassFloat;
      
      if (playing && !materialized && window.introTime) {
        if (performance.now() - window.introTime > window.INTRO_DELAY_SEC * 1000 + 3300 + data.index * 150) {
          setMaterialized(true);
        }
      }
    }
  });

  const isActive = activeId === data.id;

  return (
    <group ref={groupRef} position={[data.x, 0, data.z]} rotation={[0, data.angle, 0]}>
      <CardParticles materialized={materialized} playing={playing} dataIndex={data.index} />
      <Html transform distanceFactor={15} center zIndexRange={[100, 0]}>
        <div 
          className={`html-panel ${isActive ? 'active' : ''} ${materialized ? 'materialized' : ''}`}
          onClick={() => { if (!isActive) onClick(data.id) }}
          onMouseEnter={() => { window.isHoveringCard = true; }}
          onMouseLeave={() => { window.isHoveringCard = false; }}
        >
          <h2 className="panel-title">
            <div dangerouslySetInnerHTML={{ __html: data.icon }} style={{ display: 'flex' }} />
            {data.title}
          </h2>
          <div className="panel-content-wrapper">
            <div className="panel-content" dangerouslySetInnerHTML={{ __html: data.content }} />
          </div>
        </div>
      </Html>
    </group>
  );
};

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// SCENE CONTROLLER ΓÇö Camera + DOM Effects
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

const SceneController = ({ activeSection, setActiveSection, playing, carouselRef }) => {
  const domRefs = useRef({});
  const lookAtPos = useRef(new THREE.Vector3(0, 0, 0));
  const introFinished = useRef(false);
  const introSpinFinished = useRef(false);
  const pointerTracker = useRef({ current: 0, target: 0, velocity: 0 });
  const targetRot = useRef(0);
  const startTime = useRef(0);
  const randomIntroSpin = useRef(Math.PI * 2 * 1 + (Math.PI * 2 / SECTIONS_DATA.length) * Math.floor(Math.random() * SECTIONS_DATA.length));
  
  const bassFovPunch = useRef(0);
  
  useEffect(() => {
    if (playing && startTime.current === 0) {
      startTime.current = performance.now();
      window.introTime = performance.now();
    }
  }, [playing]);

  useEffect(() => {
    if (activeSection && carouselRef.current) {
      const targetData = SECTIONS.find(s => s.id === activeSection);
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
            const currentIndex = SECTIONS.findIndex(s => s.id === activeSection);
            const nextIndex = (currentIndex + 1) % SECTIONS.length;
            setActiveSection(SECTIONS[nextIndex].id);
          } else {
            const cardSpacing = (Math.PI * 2) / SECTIONS.length;
            pointerTracker.current.target -= cardSpacing;
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, setActiveSection]);

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime;
    const bass = audioState.bass;
    const smoothBass = audioState.smoothBass;
    const beat = audioState.beatDetected;
    
    // ΓöÇΓöÇ CAMERA SHAKE (enhanced ΓÇö sine-based + beat impulse) ΓöÇΓöÇ
    const shakeBase = smoothBass > 0.25 ? (smoothBass - 0.25) * 3.0 : 0;
    const shakeIntensity = shakeBase * (activeSection ? 0.3 : (window.isHoveringCard ? 0.2 : 1.0));
    
    if (shakeIntensity > 0) {
      const st = time * 35;
      state.camera.position.x += Math.sin(st * 1.1) * shakeIntensity * 0.6;
      state.camera.position.y += Math.cos(st * 1.3) * shakeIntensity * 0.5;
      
      if (beat) {
        state.camera.position.x += (Math.random() - 0.5) * audioState.beatEnergy * 3.5;
        state.camera.position.y += (Math.random() - 0.5) * audioState.beatEnergy * 2.5;
      }
    }
    
    // ΓöÇΓöÇ ASA TITLE ΓÇö MULTI-LAYER CHROMATIC GLITCH ΓöÇΓöÇ
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
        
        // Main layer: massive neon glow + strobe flash
        const coreGlow = `0 0 ${20 + bass * 200}px rgba(160, 32, 240, ${0.4 + bass * 0.6})`;
        const outerGlow = `0 0 ${60 + bass * 500}px rgba(160, 32, 240, ${0.15 + bass * 0.4})`;
        const megaGlow = `0 0 ${120 + bass * 800}px rgba(120, 0, 220, ${bass * 0.25})`;
        mainLayer.style.textShadow = `${coreGlow}, ${outerGlow}, ${megaGlow}`;
        mainLayer.style.color = `rgba(255, 255, 255, ${0.03 + bass * 0.3})`;
      }
    }
    
    // ΓöÇΓöÇ SCREEN FLASH ON HEAVY BEATS ΓöÇΓöÇ
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
    
    // ΓöÇΓöÇ SCANLINE INTENSITY ΓöÇΓöÇ
    if (!domRefs.current.scanEl) domRefs.current.scanEl = document.querySelector('.screen-scanlines');
    const scanEl = domRefs.current.scanEl;
    if (scanEl) {
      scanEl.style.opacity = String(0.1 + smoothBass * 0.3);
    }

    // ΓöÇΓöÇ EDGE GLOW INTENSITY ΓöÇΓöÇ
    if (!domRefs.current.edgeEl) domRefs.current.edgeEl = document.querySelector('.screen-edge-glow');
    const edgeEl = domRefs.current.edgeEl;
    if (edgeEl) {
      const glowSize = 40 + smoothBass * 200;
      const glowAlpha = 0.08 + smoothBass * 0.5;
      edgeEl.style.boxShadow = `inset 0 0 ${glowSize}px rgba(160, 32, 240, ${glowAlpha})`;
    }
    
    // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
    // CAMERA NAVIGATION (preserved logic)
    // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
    
    if (playing && !introFinished.current) {
      const elapsed = (performance.now() - startTime.current) / 1000;
      
      if (elapsed < window.INTRO_DELAY_SEC) {
        const hoverY = 150 + Math.sin(time * 0.5) * 10;
        state.camera.position.lerp(new THREE.Vector3(0, hoverY, 100), 2 * delta);
        lookAtPos.current.lerp(new THREE.Vector3(0, -20, 0), 2 * delta);
      } else if (elapsed < window.INTRO_DELAY_SEC + 2.5) {
        const progress = Math.min((elapsed - window.INTRO_DELAY_SEC) / 2.5, 1);
        const easeOut = 1 - Math.pow(1 - progress, 5);
        
        const startPos = new THREE.Vector3(0, 150, 100);
        const targetPos = new THREE.Vector3(0, 0, 65);
        
        state.camera.position.lerpVectors(startPos, targetPos, easeOut);
        
        state.camera.position.x += Math.sin(progress * Math.PI * 4) * 80 * (1 - easeOut);
        state.camera.position.z += Math.cos(progress * Math.PI * 4) * 80 * (1 - easeOut);
        
        lookAtPos.current.lerp(new THREE.Vector3(0, -20 * (1-easeOut), 0), 5 * delta);
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
      
      pointerTracker.current.current = THREE.MathUtils.lerp(pointerTracker.current.current, pointerTracker.current.target, 8 * delta);
      targetRot.current = pointerTracker.current.current;
      carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 10 * delta);
      
      const targetCamPos = new THREE.Vector3(0, 0, 65);
      state.camera.position.lerp(targetCamPos, 6 * delta);
      lookAtPos.current.lerp(new THREE.Vector3(0, 0, 0), 6 * delta);

    } else if (introFinished.current && introSpinFinished.current) {
      
      // Lerp speed ΓÇö slow on massive impacts for "freeze frame" feel
      let lerpSpeed = 6;
      if (beat && audioState.beatEnergy > 0.8 && !activeSection) {
        lerpSpeed = 2;
      }
      
      if (activeSection) {
        // ZOOMED IN
        carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 8 * delta);
        
        const activeData = SECTIONS_DATA.find(s => s.id === activeSection);
        const cx = activeData?.camOffset?.[0] || 0;
        const cy = activeData?.camOffset?.[1] || -2;
        const cz = activeData?.camOffset?.[2] || 25;
        
        const lx = activeData?.lookOffset?.[0] || 0;
        const ly = activeData?.lookOffset?.[1] || 0;
        const lz = activeData?.lookOffset?.[2] || 0;
        
        const targetCamPos = new THREE.Vector3(cx, cy, R + cz);
        state.camera.position.lerp(targetCamPos, lerpSpeed * delta);
        lookAtPos.current.lerp(new THREE.Vector3(lx, ly, R + lz), lerpSpeed * delta);
        
      } else {
        // OVERVIEW ΓÇö micro-orbit
        
        pointerTracker.current.current = THREE.MathUtils.lerp(pointerTracker.current.current, pointerTracker.current.target, 8 * delta);
        targetRot.current = pointerTracker.current.current;
        carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 10 * delta);
        
        // Micro-orbit: slow XY movement + bass modulation
        const orbitAngle = time * 0.15;
        const orbitRadius = 2 + smoothBass * 4;
        const targetCamPos = new THREE.Vector3(
          Math.sin(orbitAngle) * orbitRadius,
          Math.cos(orbitAngle * 0.7) * (1 + smoothBass * 2),
          65
        );
        state.camera.position.lerp(targetCamPos, lerpSpeed * delta);
        lookAtPos.current.lerp(new THREE.Vector3(0, 0, 0), lerpSpeed * delta);
      }
    }
    
    state.camera.lookAt(lookAtPos.current);
    
    // ΓöÇΓöÇ POST-LOOKAT EFFECTS (applied after lookAt so they're not overridden) ΓöÇΓöÇ
    if (audioState.playing && introSpinFinished.current) {
      // FOV breathing ΓÇö expands on bass, contracts between
      bassFovPunch.current = THREE.MathUtils.lerp(bassFovPunch.current, smoothBass, 8 * delta);
      state.camera.fov = 60 + bassFovPunch.current * 14;
      
      // Bass punch: push camera forward on beat
      if (beat && !activeSection) {
        state.camera.position.z -= audioState.beatEnergy * 3;
      }
      
      state.camera.updateProjectionMatrix();
      
      // Camera roll sway ΓÇö subtle drunken float
      state.camera.rotation.z += Math.sin(time * 0.6) * smoothBass * 0.035;
    }
  });

  return null;
};

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// POST-PROCESSING ΓÇö Dynamic Audio-Reactive Effects
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

const Effects = () => {
  return (
    <EffectComposer>
      <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
      <Vignette eskil={false} offset={0.1} darkness={1.2} />
    </EffectComposer>
  );
};

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// APP
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ

window.INTRO_DELAY_SEC = 7.6; // Wait 7.6 seconds for the intro drop

function App() {
  const [started, setStarted] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [introTextVisible, setIntroTextVisible] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  const carouselRef = useRef();

  const handleStart = () => {
    initAudio();
    playAudio();
    setStarted(true);
    
    setTimeout(() => {
      setIntroTextVisible(true);
    }, 500);
  };

  const handleMute = (e) => {
    e.stopPropagation();
    setIsMuted(toggleMute());
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      
      <div className={`splash-screen ${started ? 'hidden' : ''}`} onClick={handleStart}>
        <img src="/icon.png" alt="ASA" className="splash-avatar" />
        <div className="enter-text">ENTER THE VOID</div>
        <p style={{ color: '#666', marginTop: '20px', fontFamily: 'Inter, sans-serif' }}>
          (Click anywhere. Warning: flashing lights &amp; loud audio)
        </p>
      </div>

      {/* ΓöÇΓöÇ ASA TITLE: Multi-Layer Chromatic Glitch ΓöÇΓöÇ */}
      {started && introTextVisible && (
        <div className="asa-title-wrapper">
          <div id="asa-bg-text" className="asa-title-container">
            <span className="asa-layer asa-layer-r">ASA</span>
            <span className="asa-layer asa-layer-c">ASA</span>
            <span className="asa-layer asa-layer-main">ASA</span>
          </div>
        </div>
      )}

      {/* ΓöÇΓöÇ Screen Flash Overlay ΓöÇΓöÇ */}
      {started && <div id="screen-flash" className="screen-flash"></div>}
      
      {/* ΓöÇΓöÇ Scanline Overlay ΓöÇΓöÇ */}
      {started && <div className="screen-scanlines"></div>}
      
      {/* ΓöÇΓöÇ Edge Glow ΓöÇΓöÇ */}
      {started && <div className="screen-edge-glow"></div>}

      {/* ΓöÇΓöÇ Audio-reactive radial blur overlay ΓöÇΓöÇ */}
      {started && <div className="audio-blur-overlay"></div>}

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
        <directionalLight position={[0, -10, -5]} intensity={1} color="#a020f0" />
        
        <AudioDriver />
        <ReactiveFog />
        
        <Suspense fallback={null}>
          <AmbientParticles />
          <VoidShapes />
          <HeartShapes />
          <HorizonTrees />
          <BassShockwaves />
          <AudioVisualizerRing />
          <ReactiveFloor />

          <group ref={carouselRef}>
            {SECTIONS.map(s => (
              <FloatingPanel 
                key={s.id} 
                data={s} 
                activeId={activeSection} 
                onClick={setActiveSection} 
                playing={started}
              />
            ))}
          </group>

          <SceneController 
            activeSection={activeSection} 
            setActiveSection={setActiveSection}
            playing={started} 
            carouselRef={carouselRef} 
          />
          <Effects />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default App;
