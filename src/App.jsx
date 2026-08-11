import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, useTexture } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import './App.css';

// Global audio state to avoid re-renders
const audioState = {
  initialized: false,
  playing: false,
  bass: 0,
  mid: 0,
  high: 0,
  raw: new Uint8Array(128)
};

let audioCtx, analyser, source, audioRef;

const initAudio = () => {
  if (audioState.initialized) return;
  
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  audioState.raw = new Uint8Array(analyser.frequencyBinCount);
  
  audioRef = new Audio('/shirt.mp3');
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

const updateAudioData = () => {
  if (!audioState.playing || !analyser) return;
  
  analyser.getByteFrequencyData(audioState.raw);
  
  let bassSum = 0;
  for (let i = 0; i < 10; i++) bassSum += audioState.raw[i];
  audioState.bass = bassSum / 10 / 255;
  
  let midSum = 0;
  for (let i = 10; i < 50; i++) midSum += audioState.raw[i];
  audioState.mid = midSum / 40 / 255;
  
  let highSum = 0;
  for (let i = 50; i < 120; i++) highSum += audioState.raw[i];
  audioState.high = highSum / 70 / 255;
  
  // Pipe bass data to CSS variables for dynamic glowing effects!
  document.documentElement.style.setProperty('--bass', audioState.bass.toFixed(3));
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
      const tint = audioState.bass;
      matRef.current.color.setRGB(1 - tint * 0.4, 1 - tint * 0.9, 1 - tint * 0.1);
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
  const count = 40; // 40 floating geometric shapes for the background
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const shapesData = useMemo(() => {
    const data = [];
    for(let i=0; i<count; i++) {
      data.push({
        // Spread around the void, avoiding the direct center where cards are
        pos: [(Math.random() - 0.5) * 200, (Math.random() - 0.5) * 100 + 30, (Math.random() - 0.5) * 200],
        rot: [Math.random() * Math.PI, Math.random() * Math.PI, 0],
        speed: (Math.random() - 0.5) * 0.3,
        scale: Math.random() * 3 + 1
      });
    }
    return data;
  }, []);

  useFrame((state, delta) => {
    if (group.current) {
      const bassScale = 1 + audioState.bass * 0.8; // They throb heavily to the bass
      shapesData.forEach((shape, i) => {
        shape.rot[0] += shape.speed * delta;
        shape.rot[1] += shape.speed * delta;
        
        dummy.position.set(...shape.pos);
        dummy.rotation.set(...shape.rot);
        dummy.scale.set(shape.scale * bassScale, shape.scale * bassScale, shape.scale * bassScale);
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
  const count = 150;
  const mesh = useRef();
  
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
    if (mesh.current) {
      mesh.current.rotation.y += delta * 0.05; // Extremely slow drift
    }
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={particles} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.4} color="#a020f0" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
};

const R = 30; // Radius of the character selection circle
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
        <div class="hud-block full"><div class="hud-label">LANGUAGES</div>
          <div class="hud-value small">ENGLISH [80%]</div><div class="hud-progress-bg"><div class="hud-progress-fill" style="width: 80%"></div></div>
          <div class="hud-value small" style="margin-top:5px">SPANISH [80%]</div><div class="hud-progress-bg"><div class="hud-progress-fill" style="width: 80%"></div></div>
          <div class="hud-value small" style="margin-top:5px">JAPANESE [15%]</div><div class="hud-progress-bg"><div class="hud-progress-fill" style="width: 15%"></div></div>
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
        <div class="hud-block full" style="flex-direction:row; justify-content:flex-start; gap:15px">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg></div>
          <div class="hud-data"><div class="hud-label">INSTAGRAM</div><div class="hud-value"><a href="https://www.instagram.com/hataeruu/" target="_blank">hataeruu</a></div></div>
        </div>
        <div class="hud-block full" style="flex-direction:row; justify-content:flex-start; gap:15px">
          <div class="hud-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div>
          <div class="hud-data"><div class="hud-label">DISCORD</div><div class="hud-value"><a href="https://discord.com/users/1408523273548988456" target="_blank">asari_atari</a></div></div>
        </div>
      </div>
    `
  },
  {
    id: 'music',
    title: 'MUSIC',
    icon: ICONS.music,
    content: `
      <div class="hud-grid">
        <div class="hud-block"><div class="hud-label">FAV ARTIST</div><div class="hud-value">Ado</div></div>
        <div class="hud-block"><div class="hud-label">FAV SONG</div><div class="hud-value small">2:00 by enveel</div></div>
        <div class="hud-block full"><div class="hud-label">NOW PLAYING</div><div class="hud-value" style="color:var(--accent)">THOTTWAT - SHIRT</div></div>
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
        <div class="hud-block full"><div class="hud-label">HARDWARE</div><div class="hud-value small">RTX 5060 TI / R9 7900X / 32GB DDR5</div></div>
        <div class="hud-block full"><div class="hud-label">GEAR</div><div class="hud-value small">RAZER OROCHI V2 / AULA WIN60 / QUADCAST</div></div>
        <div class="hud-block full"><div class="hud-label">GAMES & MEDIA</div><div class="hud-value small">DARK SOULS / CHAINSAWMAN / CYBERPUNK</div></div>
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
  return {
    ...s,
    index: i,
    angle: angle,
    x: Math.sin(angle) * R,
    z: Math.cos(angle) * R,
  };
});

const CardParticles = ({ materialized, playing, dataIndex }) => {
  const count = 1500;
  const meshRef = useRef();
  const matRef = useRef();
  
  const targetPositions = useMemo(() => new Float32Array(count * 3), [count]);
  const currentPositions = useMemo(() => new Float32Array(count * 3), [count]);
  const colors = useMemo(() => new Float32Array(count * 3), [count]);
  
  useEffect(() => {
    // A standard html-panel in our 3D space is roughly 22 wide by 32 high
    for(let i = 0; i < count; i++) {
      targetPositions[i*3] = (Math.random() - 0.5) * 22;
      targetPositions[i*3+1] = (Math.random() - 0.5) * 32;
      targetPositions[i*3+2] = (Math.random() - 0.5) * 2;
      
      // Start scattered high up
      currentPositions[i*3] = targetPositions[i*3] + (Math.random() - 0.5) * 40;
      currentPositions[i*3+1] = targetPositions[i*3+1] + 30 + Math.random() * 40;
      currentPositions[i*3+2] = targetPositions[i*3+2] + (Math.random() - 0.5) * 30;
      
      const r = Math.random();
      if(r > 0.6) {
        colors[i*3] = 0; colors[i*3+1] = 0; colors[i*3+2] = 0; // Black
      } else if (r > 0.3) {
        colors[i*3] = 0.62; colors[i*3+1] = 0.12; colors[i*3+2] = 0.94; // Purple
      } else {
        colors[i*3] = 0.8; colors[i*3+1] = 0.5; colors[i*3+2] = 1.0; // Light Purple
      }
    }
  }, [count, targetPositions, currentPositions, colors]);

  useFrame((state, delta) => {
    if (!meshRef.current || !matRef.current || materialized) return;
    
    if (playing && window.introTime) {
      const timeSinceIntro = performance.now() - window.introTime;
      // Start materializing the cards AFTER the camera lands! (Starts at 3.5s)
      const startTime = 3500 + dataIndex * 200; 
      
      if (timeSinceIntro > startTime) {
        const positions = meshRef.current.geometry.attributes.position.array;
        
        // Scanner moves down over 1.5 seconds
        const progress = Math.min((timeSinceIntro - startTime) / 1500, 1);
        const scanY = 50 - progress * 80;
        
        for(let i = 0; i < count; i++) {
           const targetY = targetPositions[i*3+1];
           if (targetY > scanY) {
             // Snap to target rectangle
             positions[i*3] = THREE.MathUtils.lerp(positions[i*3], targetPositions[i*3], 15 * delta);
             positions[i*3+1] = THREE.MathUtils.lerp(positions[i*3+1], targetPositions[i*3+1], 15 * delta);
             positions[i*3+2] = THREE.MathUtils.lerp(positions[i*3+2], targetPositions[i*3+2], 15 * delta);
           } else {
             // Let them float down gently before snapping
             positions[i*3+1] -= delta * 5;
           }
        }
        meshRef.current.geometry.attributes.position.needsUpdate = true;
        
        // Smoothly fade out the particles at the very end as HTML fades in
        if (progress > 0.8) {
          matRef.current.opacity = (1 - progress) * 5 * 0.9;
        }
      }
    }
  });

  if (materialized) return null; // Unmount completely

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
      const floatY = Math.sin(state.clock.elapsedTime * 1.5 + data.index) * 0.5;
      groupRef.current.position.y = floatY;
      
      // Card appears fully after materialization finishes (3.5s start + 1.5s build = 5.0s)
      if (playing && !materialized && window.introTime) {
        if (performance.now() - window.introTime > 5000 + data.index * 200) {
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

const SceneController = ({ activeSection, playing, carouselRef }) => {
  const lookAtPos = useRef(new THREE.Vector3(0, 0, 0));
  const introFinished = useRef(false);
  const introSpinFinished = useRef(false);
  const startTime = useRef(0);
  const targetRot = useRef(0);
  
  const pointerTracker = useRef({ target: 0, current: 0 });

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

  useFrame((state, delta) => {
    // Variable camera shake based on state
    if (audioState.bass > 0.6) {
      let shakeAmt = 0;
      if (!activeSection && !window.isHoveringCard) {
        shakeAmt = (audioState.bass - 0.6) * 2.0; // Intense overview shake
      } else if (activeSection) {
        shakeAmt = (audioState.bass - 0.6) * 0.7; // Mild impact when zoomed in
      }
      
      if (shakeAmt > 0) {
        state.camera.position.x += (Math.random() - 0.5) * shakeAmt;
        state.camera.position.y += (Math.random() - 0.5) * shakeAmt;
      }
    }
    
    // Dynamic ASA Text Animation (Parallax + Bass Scale + Dynamic Glow)
    const textEl = document.getElementById('asa-bg-text');
    if (textEl) {
       const time = state.clock.elapsedTime;
       const floatY = Math.sin(time * 2) * 20; // Float up and down
       const floatX = Math.cos(time * 1.5) * 10;
       const bassScale = 1 + (audioState.bass * 0.2); // Thump to the beat
       // Inverse parallax based on mouse
       const mouseX = state.pointer.x * -30;
       const mouseY = state.pointer.y * -30;
       
       textEl.style.transform = `translate(calc(${mouseX}px + ${floatX}px), calc(${mouseY}px + ${floatY}px)) scale(${bassScale})`;
       
       // Dynamic Glow
       const glowSize = 10 + audioState.bass * 150;
       const glowOpacity = 0.1 + audioState.bass * 0.7;
       textEl.style.textShadow = `0 0 ${glowSize}px rgba(160, 32, 240, ${glowOpacity})`;
    }

    if (playing && !introFinished.current) {
      const elapsed = (performance.now() - startTime.current) / 1000;
      if (elapsed < 3.5) {
        const progress = Math.min(elapsed / 3.5, 1);
        const easeOut = 1 - Math.pow(1 - progress, 5);
        
        const startPos = new THREE.Vector3(0, 200, 50);
        const targetPos = new THREE.Vector3(0, 0, 65);
        
        state.camera.position.lerpVectors(startPos, targetPos, easeOut);
        
        // Swirling camera dive
        state.camera.position.x += Math.sin(progress * Math.PI * 4) * 80 * (1 - easeOut);
        state.camera.position.z += Math.cos(progress * Math.PI * 4) * 80 * (1 - easeOut);
        
        lookAtPos.current.lerp(new THREE.Vector3(0, -20 * (1-easeOut), 0), 5 * delta);
      } else {
        introFinished.current = true;
      }
    } else if (introFinished.current && !introSpinFinished.current && playing) {
      // Intro dramatic spin effect!
      const elapsedSinceSpinStart = (performance.now() - window.introTime - 5000) / 1000;
      if (elapsedSinceSpinStart > 0) {
          if (elapsedSinceSpinStart < 2.0) {
             const spinProgress = elapsedSinceSpinStart / 2.0;
             const spinEase = 1 - Math.pow(1 - spinProgress, 4); // ease out quart
             // Spin by exactly 2 full rotations to land flawlessly back at the first card (angle 0)
             pointerTracker.current.target = (Math.PI * 4) * spinEase;
          } else {
             introSpinFinished.current = true;
             pointerTracker.current.target = Math.PI * 4;
          }
      }
      
      pointerTracker.current.current = THREE.MathUtils.lerp(pointerTracker.current.current, pointerTracker.current.target, 8 * delta);
      targetRot.current = pointerTracker.current.current;
      carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 10 * delta);
      
      const targetCamPos = new THREE.Vector3(0, 0, 65);
      state.camera.position.lerp(targetCamPos, 6 * delta);
      lookAtPos.current.lerp(new THREE.Vector3(0, 0, 0), 6 * delta);

    } else if (introFinished.current && introSpinFinished.current) {
      
      if (activeSection) {
        // ZOOMED IN (CARD SELECTED)
        carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 8 * delta);
        
        const targetCamPos = new THREE.Vector3(0, -2, R + 25); // Backed up to prevent pixelation
        state.camera.position.lerp(targetCamPos, 6 * delta);
        lookAtPos.current.lerp(new THREE.Vector3(0, 0, R), 6 * delta);
        
      } else {
        // OVERVIEW (EDGE PANNING)
        if (!window.isHoveringCard) {
          const px = state.pointer.x;
          // Deadzone in the middle 5% of the screen
          if (Math.abs(px) > 0.05) {
             const speed = (Math.abs(px) - 0.05) * Math.sign(px) * 4.0;
             pointerTracker.current.target += speed * delta;
          }
        }
        
        pointerTracker.current.current = THREE.MathUtils.lerp(pointerTracker.current.current, pointerTracker.current.target, 8 * delta);
        targetRot.current = pointerTracker.current.current;
        carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 10 * delta);
        
        const targetCamPos = new THREE.Vector3(0, 0, 65);
        state.camera.position.lerp(targetCamPos, 6 * delta);
        lookAtPos.current.lerp(new THREE.Vector3(0, 0, 0), 6 * delta);
      }
    }
    
    state.camera.lookAt(lookAtPos.current);
  });

  return null;
};

const Effects = () => {
  return (
    <EffectComposer>
      <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
      <Vignette eskil={false} offset={0.1} darkness={1.2} />
    </EffectComposer>
  );
};

function App() {
  const [started, setStarted] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [introTextVisible, setIntroTextVisible] = useState(false);
  
  const carouselRef = useRef();

  const handleStart = () => {
    initAudio();
    playAudio();
    setStarted(true);
    
    // Spawn the ASA text as the camera dive starts (0.5s)
    setTimeout(() => {
      setIntroTextVisible(true);
    }, 500);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      
      <div className={`splash-screen ${started ? 'hidden' : ''}`} onClick={handleStart}>
        <img src="/icon.png" alt="ASA" className="splash-avatar" />
        <div className="enter-text">ENTER THE VOID</div>
        <p style={{ color: '#666', marginTop: '20px', fontFamily: 'Inter, sans-serif' }}>
          (Click anywhere. Warning: flashing lights & loud audio)
        </p>
      </div>

      {started && introTextVisible && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 50,
          pointerEvents: 'none'
        }}>
          <h1 id="asa-bg-text" style={{
            fontSize: '12rem',
            color: 'rgba(255, 255, 255, 0.03)',
            margin: 0,
            animation: 'safe-glitch 0.5s infinite',
            mixBlendMode: 'screen',
            transition: 'transform 0.1s ease-out'
          }}>
            ASA
          </h1>
        </div>
      )}

      {/* Subtle audio-reactive radial blur overlay */}
      {started && (
        <div className="audio-blur-overlay"></div>
      )}

      {started && (
        <div className="ui-layer">
          {activeSection && (
            <button className="back-btn" onClick={() => setActiveSection(null)}>
              [ BACK TO OVERVIEW ]
            </button>
          )}
        </div>
      )}

      <Canvas
        camera={{ position: [0, 150, 100], fov: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#020202']} />
        <fogExp2 attach="fog" args={['#020202', 0.015]} />
        
        <ambientLight intensity={0.2} />
        <directionalLight position={[0, 10, 5]} intensity={2} color="#ffffff" />
        <directionalLight position={[0, -10, -5]} intensity={1} color="#a020f0" />
        
        <Suspense fallback={null}>
          <AmbientParticles />
          <VoidShapes />
          <HorizonTrees />
          
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -20, 0]}>
            <planeGeometry args={[300, 300, 32, 32]} />
            <meshBasicMaterial color="#050000" wireframe transparent opacity={0.15} />
          </mesh>

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
