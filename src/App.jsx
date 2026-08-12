import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, useTexture, Text } from '@react-three/drei';
import { EffectComposer, Bloom, Glitch, Scanline, Vignette } from '@react-three/postprocessing';
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
  analyser.smoothingTimeConstant = 0.4;
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

const setVolume = (val) => {
  if (audioRef) audioRef.volume = val;
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
  const bins = analyser.frequencyBinCount;
  
  let subSum = 0;
  for (let i = 0; i < 4; i++) subSum += audioState.raw[i];
  audioState.sub = subSum / 4 / 255;
  
  let bassSum = 0;
  for (let i = 3; i < 12; i++) bassSum += audioState.raw[i];
  audioState.bass = bassSum / 9 / 255;
  
  let midSum = 0;
  for (let i = 12; i < 50; i++) midSum += audioState.raw[i];
  audioState.mid = midSum / 38 / 255;
  
  let highSum = 0;
  for (let i = 50; i < bins; i++) highSum += audioState.raw[i];
  audioState.high = highSum / (bins - 50) / 255;
  
  const attack = 0.35;
  const release = 0.92;
  
  const smooth = (current, target) => 
    target > current ? current * (1 - attack) + target * attack : current * release;
  
  audioState.smoothSub = smooth(audioState.smoothSub, audioState.sub);
  audioState.smoothBass = smooth(audioState.smoothBass, audioState.bass);
  audioState.smoothMid = smooth(audioState.smoothMid, audioState.mid);
  audioState.smoothHigh = smooth(audioState.smoothHigh, audioState.high);
  
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
  
  const root = document.documentElement.style;
  root.setProperty('--bass', audioState.smoothBass.toFixed(3));
  root.setProperty('--sub', audioState.smoothSub.toFixed(3));
  root.setProperty('--mid', audioState.smoothMid.toFixed(3));
  root.setProperty('--high', audioState.smoothHigh.toFixed(3));
};

const AudioDriver = () => {
  useFrame(() => { updateAudioData(); });
  return null;
};

// ═══════════════════════════════════════════════════════════
// 3D SCENE COMPONENTS
// ═══════════════════════════════════════════════════════════

const LyricsBackground = () => {
  const [currentLyric, setCurrentLyric] = useState("");
  const textRef = useRef();
  
  useFrame(() => {
    if (!audioRef || !audioState.playing) return;
    const t = audioRef.currentTime;
    const active = LYRICS.find(l => t >= l.start && t <= l.end);
    if (active) {
      if (currentLyric !== active.text) setCurrentLyric(active.text);
    } else {
      if (currentLyric !== "") setCurrentLyric("");
    }
    
    if (textRef.current) {
      const scale = 1 + audioState.smoothBass * 0.05;
      textRef.current.scale.setScalar(THREE.MathUtils.lerp(textRef.current.scale.x, scale, 0.1));
    }
  });
  
  if (!currentLyric) return null;
  
  return (
    <Text 
      ref={textRef}
      position={[0, 15, -30]} 
      fontSize={8} 
      maxWidth={100}
      textAlign="center"
      color="rgba(160, 32, 240, 0.4)"
      font="https://fonts.gstatic.com/s/spacemono/v12/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff"
      anchorX="center" 
      anchorY="middle"
      depthWrite={false}
    >
      {currentLyric}
    </Text>
  );
};

const AsaIntroText = ({ playing }) => {
  const [visible, setVisible] = useState(false);
  const textGroup = useRef();
  const particleGroup = useRef();
  
  const particlesCount = 80;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    const data = [];
    for (let i = 0; i < particlesCount; i++) {
      data.push({
        pos: [(Math.random() - 0.5) * 60, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 20],
        speed: Math.random() * 2 + 0.5,
        scale: Math.random() * 0.5 + 0.1
      });
    }
    return data;
  }, [particlesCount]);

  useEffect(() => {
    if (playing) setVisible(true);
  }, [playing]);

  useFrame((state, delta) => {
    if (!visible) return;
    
    if (playing && window.introTime) {
      const timeSinceIntro = performance.now() - window.introTime;
      const spawnLimit = window.INTRO_DELAY_SEC * 1000 + 3300;
      if (timeSinceIntro > spawnLimit) {
        setVisible(false);
      }
    }
    
    if (textGroup.current) {
      const cam = state.camera;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const pos = cam.position.clone().add(dir.multiplyScalar(50));
      textGroup.current.position.copy(pos);
      textGroup.current.quaternion.copy(cam.quaternion);
    }
    
    if (particleGroup.current) {
      particles.forEach((p, i) => {
        p.pos[1] += p.speed * delta * (audioState.smoothBass * 5 + 1);
        if (p.pos[1] > 20) p.pos[1] = -20;
        dummy.position.set(...p.pos);
        dummy.scale.setScalar(p.scale * (audioState.smoothBass * 1.5 + 0.8));
        dummy.updateMatrix();
        particleGroup.current.setMatrixAt(i, dummy.matrix);
      });
      particleGroup.current.instanceMatrix.needsUpdate = true;
    }
  });

  if (!visible) return null;

  return (
    <group ref={textGroup}>
      <Text 
        fontSize={14} 
        color="#ffffff" 
        font="https://fonts.gstatic.com/s/spacemono/v12/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff"
        anchorX="center" 
        anchorY="middle"
        characters="asa"
        depthWrite={false}
      >
        asa
        <meshBasicMaterial attach="material" color="#ffffff" />
      </Text>
      <instancedMesh ref={particleGroup} args={[null, null, particlesCount]}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshBasicMaterial color="#a020f0" transparent opacity={0.6} />
      </instancedMesh>
    </group>
  );
};

// ═══════════════════════════════════════════════════════════
// DATA — Section Content
// ═══════════════════════════════════════════════════════════

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
        <a href="https://www.instagram.com/hataeruu/" target="_blank" class="hud-block full social-link">
          <div class="hud-data"><div class="hud-label">INSTAGRAM</div><div class="hud-value">hataeruu</div></div>
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
        <div class="hud-block full"><div class="hud-label">NOW PLAYING</div><div class="hud-value">MUSIC AND ME</div></div>
        <input type="range" min="0" max="1" step="0.01" defaultValue="0.5" onInput="setVolume(this.value)" class="hud-slider" />
      </div>
    `
  },
  {
    id: 'archive',
    title: 'ARCHIVE',
    icon: ICONS.archive,
    content: `
      <div class="hud-grid">
        <div class="hud-block full"><div class="hud-label">FOCUS</div><div class="hud-value small">DIGITAL EXPERIENCES</div></div>
      </div>
    `
  },
  {
    id: 'status',
    title: 'STATUS',
    icon: ICONS.status,
    content: `
      <div class="hud-grid">
        <div class="hud-block full"><div class="hud-label">SYSTEM</div><div class="hud-value">ONLINE</div></div>
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

// ═══════════════════════════════════════════════════════════
// GLOBAL AUDIO STATE & UTILS
// ═══════════════════════════════════════════════════════════

const LYRICS = [
  { start: 0.500, end: 2.400, text: "(Okay, stop fighting, I swear to God)" },
  { start: 4.900, end: 6.100, text: "(We gon' be okay)" },
  { start: 9.130, end: 11.750, text: "I'm like, \"Where you at? Can't see ya, I need you now\"" },
  { start: 11.750, end: 14.230, text: "You do it so right, dare to teach me how" },
  { start: 14.230, end: 16.820, text: "You talk about a feelin', I feel it now" },
  { start: 16.820, end: 19.450, text: "Look back if I could, but I'm not allowed" },
  { start: 19.450, end: 22.000, text: "I'm like, \"Where you at? Really need you now\"" },
  { start: 22.000, end: 24.500, text: "You do it so right, dare to teach me how" },
  { start: 24.500, end: 27.050, text: "You talk about a feelin', I feel it now" },
  { start: 27.050, end: 29.600, text: "Look back if I could, but I'm not allowed" },
  { start: 30.900, end: 33.500, text: "I'm crazy and I'm nervous and I'm sweatin' and I'm blushin'" },
  { start: 33.700, end: 36.100, text: "Think I'm doin' it for somethin', but I'm doin' it for nothin'" },
  { start: 36.500, end: 38.600, text: "The look on your face, tears runnin'" },
  { start: 38.800, end: 41.200, text: "Don't know what to say, but you still say somethin'" },
  { start: 41.600, end: 43.700, text: "Feel alive when you do what you're not allowed" },
  { start: 44.200, end: 46.300, text: "But you should know, this isn't what life 'bout" },
  { start: 46.800, end: 48.800, text: "I'ma die before I ever cry out" },
  { start: 49.400, end: 51.400, text: "And I'ma get struck down if I'm a liar" },
  { start: 51.900, end: 53.900, text: "Hot headed, deep burn, playin' with fire" },
  { start: 54.500, end: 56.500, text: "Would you ever trade your life for desire?" },
  { start: 57.100, end: 59.000, text: "Would you ever trade your life for desire?" },
  { start: 59.600, end: 60.600, text: "Would you ever—, uh" },
  { start: 61.000, end: 62.000, text: "Would you ever—, uh" },
  { start: 71.200, end: 73.800, text: "I'm like, \"Where you at? Can't see ya, I need you now\"" },
  { start: 73.800, end: 76.300, text: "You do it so right, dare to teach me how" },
  { start: 76.300, end: 78.900, text: "You talk about a feelin', I feel it now" },
  { start: 78.900, end: 81.500, text: "Look back if I could, but I'm not allowed" },
  { start: 81.500, end: 84.000, text: "I'm like, \"Where you at? Really need you now\"" },
  { start: 84.000, end: 86.500, text: "You do it so right, dare to teach me how" },
  { start: 86.500, end: 89.100, text: "You talk about a feelin', I feel it now" },
  { start: 89.100, end: 91.700, text: "Look back if I could, but I'm not allowed" },
  { start: 93.000, end: 95.600, text: "I'm crazy and I'm nervous and I'm sweatin' and I'm blushin'" },
  { start: 95.800, end: 98.200, text: "Think I'm doin' it for somethin', but I'm doin' it for nothin'" },
  { start: 98.600, end: 100.700, text: "The look on your face, tears runnin'" },
  { start: 100.900, end: 103.300, text: "Don't know what to say, but you still say somethin'" },
  { start: 103.700, end: 105.800, text: "Feel alive when you do what you're not allowed" },
  { start: 106.300, end: 108.400, text: "But you should know, this isn't what life 'bout" },
  { start: 108.900, end: 110.900, text: "I'ma die before I ever cry out" },
  { start: 111.500, end: 113.500, text: "And I'ma get struck down if I'm a liar" },
  { start: 114.000, end: 116.000, text: "Hot headed, deep burn, playin' with fire" },
  { start: 116.600, end: 118.600, text: "Would you ever trade your life for desire?" },
  { start: 119.200, end: 121.100, text: "Would you ever trade your life for desire?" },
  { start: 121.700, end: 122.700, text: "Would you ever—, uh" },
  { start: 122.900, end: 124.200, text: "(We gon' be okay)" }
];

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

// ═══════════════════════════════════════════════════════════
// SCENE CONTROLLER — Camera + DOM Effects
// ═══════════════════════════════════════════════════════════

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
    
    // ── CAMERA SHAKE (enhanced — sine-based + beat impulse) ──
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
        
        // Main layer: massive neon glow + strobe flash
        const coreGlow = `0 0 ${20 + bass * 200}px rgba(160, 32, 240, ${0.4 + bass * 0.6})`;
        const outerGlow = `0 0 ${60 + bass * 500}px rgba(160, 32, 240, ${0.15 + bass * 0.4})`;
        const megaGlow = `0 0 ${120 + bass * 800}px rgba(120, 0, 220, ${bass * 0.25})`;
        mainLayer.style.textShadow = `${coreGlow}, ${outerGlow}, ${megaGlow}`;
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
    
    // ══════════════════════════════════════
    // CAMERA NAVIGATION (preserved logic)
    // ══════════════════════════════════════
    
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
      
      // Lerp speed — slow on massive impacts for "freeze frame" feel
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
        // OVERVIEW — micro-orbit
        
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
    
    // ── POST-LOOKAT EFFECTS (applied after lookAt so they're not overridden) ──
    if (audioState.playing && introSpinFinished.current) {
      // FOV breathing — expands on bass, contracts between
      bassFovPunch.current = THREE.MathUtils.lerp(bassFovPunch.current, smoothBass, 8 * delta);
      state.camera.fov = 60 + bassFovPunch.current * 14;
      
      // Bass punch: push camera forward on beat
      if (beat && !activeSection) {
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
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1.0);
  
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
        <div className="enter-text">ENTER THE VOID</div>
        <p style={{ color: '#666', marginTop: '20px', fontFamily: 'Inter, sans-serif' }}>
          (Click anywhere. Warning: flashing lights &amp; loud audio)
        </p>
      </div>

      {/* ── ASA TITLE: Multi-Layer Chromatic Glitch ── */}
      {started && introTextVisible && (
        <div className="asa-title-wrapper">
          <div id="asa-bg-text" className="asa-title-container">
            <span className="asa-layer asa-layer-r">ASA</span>
            <span className="asa-layer asa-layer-c">ASA</span>
            <span className="asa-layer asa-layer-main">ASA</span>
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
        <directionalLight position={[0, -10, -5]} intensity={1} color="#a020f0" />
        
        <AudioDriver />
        <ReactiveFog />
        
        <Suspense fallback={null}>
          <AsaIntroText playing={started} />
          <LyricsBackground />
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
