import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, useTexture, CameraControls, Text } from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import './App.css';

// Global audio state to avoid re-renders
const audioState = {
  initialized: false,
  playing: false,
  bass: 0,
  mid: 0,
  high: 0,
  raw: new Uint8Array(128) // fftSize 256 / 2
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
  
  // Bass (roughly 0-10)
  let bassSum = 0;
  for (let i = 0; i < 10; i++) bassSum += audioState.raw[i];
  audioState.bass = bassSum / 10 / 255;
  
  // Mid (roughly 10-50)
  let midSum = 0;
  for (let i = 10; i < 50; i++) midSum += audioState.raw[i];
  audioState.mid = midSum / 40 / 255;
  
  // High (roughly 50-120)
  let highSum = 0;
  for (let i = 50; i < 120; i++) highSum += audioState.raw[i];
  audioState.high = highSum / 70 / 255;
};

const AudioVisualizer = () => {
  const bars = 64; // Show 64 bars
  const barRefs = useRef([]);
  
  useEffect(() => {
    let animationFrame;
    const update = () => {
      if (audioState.playing && barRefs.current.length > 0) {
        for (let i = 0; i < bars; i++) {
          if (barRefs.current[i]) {
            const index = i * 2;
            const val = audioState.raw[index] || 0;
            const height = Math.max(2, (val / 255) * 100);
            barRefs.current[i].style.height = `${height}%`;
          }
        }
      }
      animationFrame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return (
    <div className="visualizer-container">
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} ref={el => barRefs.current[i] = el} className="vis-bar" />
      ))}
    </div>
  );
};

// Particles component
const Particles = () => {
  const count = 3000;
  const mesh = useRef();
  
  const particles = useMemo(() => {
    const temp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      temp[i * 3] = (Math.random() - 0.5) * 100;
      temp[i * 3 + 1] = (Math.random() - 0.5) * 100;
      temp[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }
    return temp;
  }, [count]);
  
  const colors = useMemo(() => {
    const temp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const isRed = Math.random() > 0.8;
      temp[i * 3] = isRed ? 0.8 : 1.0;
      temp[i * 3 + 1] = isRed ? 0.05 : 1.0;
      temp[i * 3 + 2] = isRed ? 0.05 : 1.0;
    }
    return temp;
  }, [count]);

  useFrame((state, delta) => {
    updateAudioData();
    if (mesh.current) {
      mesh.current.rotation.y -= delta * (0.05 + audioState.bass * 0.2);
      const scale = 1 + audioState.bass * 0.5;
      mesh.current.scale.set(scale, scale, scale);
    }
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particles.length / 3}
          array={particles}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.15}
        vertexColors
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};

// Horizon Trees Parallax
const HorizonTrees = () => {
  const texture = useTexture('/trees.png');
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(8, 1);
  
  const matRef = useRef();
  
  useFrame((state, delta) => {
    if (matRef.current) {
      matRef.current.map.offset.x += delta * 0.02; 
      const tint = Math.min(1, audioState.bass * 1.5);
      matRef.current.color.setRGB(1, 1 - tint * 0.8, 1 - tint * 0.8);
    }
  });

  return (
    <mesh position={[0, -10, -50]} rotation={[0, 0, 0]}>
      <cylinderGeometry args={[60, 60, 40, 32, 1, true, 0, Math.PI]} />
      <meshBasicMaterial 
        ref={matRef}
        map={texture} 
        transparent 
        opacity={0.8}
        color="white"
        side={THREE.BackSide}
      />
    </mesh>
  );
};

// Data sections
const SECTIONS = [
  {
    id: 'identity',
    title: 'IDENTITY: ASA',
    position: [0, 0, 0],
    content: `> BIRTHDAY: JUNE 23RD\n> AGE: 19\n\n> LANGUAGES:\n  ENGLISH [80%]\n  SPANISH [80%]\n  JAPANESE [15%]`
  },
  {
    id: 'socials',
    title: 'SOCIALS',
    position: [15, 5, -20],
    content: `[INSTA] <a href="https://www.instagram.com/hataeruu/" target="_blank">hataeruu</a>\n[DISCO] <a href="https://discord.com/users/1408523273548988456" target="_blank">asari_atari</a>`
  },
  {
    id: 'music',
    title: 'MUSIC',
    position: [-15, -5, -40],
    content: `FAVORITE ARTIST:\n> Ado\n\nFAVORITE SONG:\n> 2:00 by enveel\n\nNOW PLAYING:\n> THOTTWAT - SHIRT`
  },
  {
    id: 'archive',
    title: 'ARCHIVE',
    position: [20, 10, -60],
    content: `HARDWARE / SETUP:\n- RTX 5060 TI\n- AMD RYZEN 9 7900X\n- 32GB DDR5 RAM\n\nPERIPHERALS:\n- RAZER OROCHI V2\n- AULA WIN60 HE\n\nAUDIO:\n- HYPERX QUADCAST S\n- HYPERX CLOUD EARBUDS II\n\nVIDEOGAMES:\n- ARC RAIDERS, DARK SOULS, RESIDENT EVIL, TLOU\n\nSERIES / MOVIES:\n- CHAINSAWMAN, FATE SERIES, DEATH NOTE, BREAKING BAD\n- KILL LA KILL, AOT, ARCANE, SCISSOR SEVEN, YOUR NAME\n- CYBERPUNK 2077`
  },
  {
    id: 'status',
    title: 'STATUS',
    position: [-10, -10, -80],
    content: `ONLINE\nCONNECTION: STABLE\nSYSTEM: ACTIVE`
  }
];

const FloatingPanel = ({ data, activeId }) => {
  const groupRef = useRef();
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = data.position[1] + Math.sin(state.clock.elapsedTime + data.position[0]) * 1.5;
      groupRef.current.quaternion.slerp(state.camera.quaternion, 0.05);
      
      const scale = 1 + (activeId === data.id ? audioState.bass * 0.1 : 0);
      groupRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.1);
    }
  });

  const isActive = activeId === data.id;

  return (
    <group ref={groupRef} position={data.position}>
      <Html transform distanceFactor={15} center zIndexRange={[100, 0]}>
        <div className={`html-panel ${isActive ? 'active' : ''}`} style={{
          opacity: isActive ? 1 : 0.4,
          transition: 'opacity 0.5s',
          borderLeftColor: isActive ? 'var(--primary)' : 'rgba(255,255,255,0.2)'
        }}>
          <h2 className="panel-title">{data.title}</h2>
          <div className="panel-content" dangerouslySetInnerHTML={{ __html: data.content }} />
        </div>
      </Html>
    </group>
  );
};

// Scene Controller handles camera movement and intro animation
const SceneController = ({ activeSection, playing }) => {
  const controlsRef = useRef();
  const introFinished = useRef(false);
  const startTime = useRef(0);
  
  useEffect(() => {
    if (playing && startTime.current === 0) {
      startTime.current = performance.now();
    }
  }, [playing]);

  useFrame((state, delta) => {
    if (!controlsRef.current) return;
    
    if (audioState.bass > 0.7) {
      const shakeAmt = (audioState.bass - 0.7) * 0.5;
      state.camera.position.x += (Math.random() - 0.5) * shakeAmt;
      state.camera.position.y += (Math.random() - 0.5) * shakeAmt;
    }

    if (playing && !introFinished.current) {
      const elapsed = (performance.now() - startTime.current) / 1000;
      if (elapsed < 8) {
        const progress = Math.min(elapsed / 8, 1);
        const easeOut = 1 - Math.pow(1 - progress, 5);
        
        const startZ = 100;
        const targetZ = 15;
        
        const currentZ = startZ - (startZ - targetZ) * easeOut;
        state.camera.position.set(0, 0, currentZ);
        controlsRef.current.setTarget(0, 0, 0, false);
      } else {
        introFinished.current = true;
      }
    } else if (introFinished.current) {
      const target = SECTIONS.find(s => s.id === activeSection);
      if (target) {
        const targetCamPos = new THREE.Vector3(
          target.position[0],
          target.position[1],
          target.position[2] + 15
        );
        
        state.camera.position.lerp(targetCamPos, 2 * delta);
        controlsRef.current.setTarget(
          THREE.MathUtils.lerp(controlsRef.current.target.x, target.position[0], 2 * delta),
          THREE.MathUtils.lerp(controlsRef.current.target.y, target.position[1], 2 * delta),
          THREE.MathUtils.lerp(controlsRef.current.target.z, target.position[2], 2 * delta),
          false
        );
      }
    }
  });

  return (
    <CameraControls 
      ref={controlsRef} 
      makeDefault 
      minDistance={5}
      maxDistance={150}
      mouseButtons={{
        left: 1, 
        middle: 8, 
        right: 0, 
      }}
    />
  );
};

// Post Processing
const Effects = () => {
  const chromRef = useRef();
  const bloomRef = useRef();
  
  useFrame(() => {
    if (chromRef.current) {
      const offset = 0.001 + audioState.bass * 0.02;
      chromRef.current.offset.setScalar(offset);
    }
    if (bloomRef.current) {
      bloomRef.current.intensity = 1.0 + audioState.bass * 2.5;
    }
  });

  return (
    <EffectComposer>
      <Bloom ref={bloomRef} luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
      <ChromaticAberration ref={chromRef} offset={[0.002, 0.002]} />
      <Vignette eskil={false} offset={0.1} darkness={1.2} />
    </EffectComposer>
  );
};

function App() {
  const [started, setStarted] = useState(false);
  const [activeSection, setActiveSection] = useState('identity');
  const [introTextVisible, setIntroTextVisible] = useState(false);

  const handleStart = () => {
    initAudio();
    playAudio();
    setStarted(true);
    
    setTimeout(() => {
      setIntroTextVisible(true);
      setTimeout(() => setIntroTextVisible(false), 3000);
    }, 1500);
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
          <h1 style={{
            fontSize: '8rem',
            color: '#fff',
            textShadow: '0 0 20px #cc1111, 4px 4px 0 #cc1111',
            margin: 0,
            animation: 'glitch-anim 0.2s infinite',
            mixBlendMode: 'screen'
          }}>
            ASA
          </h1>
        </div>
      )}

      {started && (
        <div className="ui-layer">
          <div className="nav-container">
            {SECTIONS.map(s => (
              <button 
                key={s.id}
                className={`nav-btn ${activeSection === s.id ? 'active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.title.split(':')[0]}
              </button>
            ))}
          </div>
          <AudioVisualizer />
        </div>
      )}

      <Canvas
        camera={{ position: [0, 0, 100], fov: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#020202']} />
        <fogExp2 attach="fog" args={['#020202', 0.015]} />
        
        <ambientLight intensity={0.2} />
        <directionalLight position={[0, 10, 5]} intensity={1} color="#cc1111" />
        
        <Suspense fallback={null}>
          <Particles />
          <HorizonTrees />
          
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -15, 0]}>
            <planeGeometry args={[200, 200, 32, 32]} />
            <meshBasicMaterial color="#050000" wireframe transparent opacity={0.1} />
          </mesh>

          {SECTIONS.map(s => (
            <FloatingPanel key={s.id} data={s} activeId={activeSection} />
          ))}

          <SceneController activeSection={activeSection} playing={started} />
          <Effects />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default App;
