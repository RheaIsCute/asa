import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, useTexture, Text } from '@react-three/drei';
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
};

const AudioVisualizer = () => {
  const bars = 64; 
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

const Particles = () => {
  const count = 3000;
  const mesh = useRef();
  
  const particles = useMemo(() => {
    const temp = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      temp[i * 3] = (Math.random() - 0.5) * 200;
      temp[i * 3 + 1] = (Math.random() - 0.5) * 200;
      temp[i * 3 + 2] = (Math.random() - 0.5) * 200;
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
      mesh.current.rotation.y -= delta * (0.02 + audioState.bass * 0.1);
      const scale = 1 + audioState.bass * 0.2;
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
        opacity={0.5}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
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
      const tint = Math.min(1, audioState.bass * 1.5);
      matRef.current.color.setRGB(1, 1 - tint * 0.8, 1 - tint * 0.8);
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

const R = 30; // Radius of the character selection circle
const SECTIONS_DATA = [
  {
    id: 'identity',
    title: 'IDENTITY',
    content: `> BIRTHDAY: JUNE 23RD\n> AGE: 19\n\n> LANGUAGES:\n  ENGLISH [80%]\n  SPANISH [80%]\n  JAPANESE [15%]`
  },
  {
    id: 'socials',
    title: 'SOCIALS',
    content: `[INSTA] <a href="https://www.instagram.com/hataeruu/" target="_blank">hataeruu</a>\n[DISCO] <a href="https://discord.com/users/1408523273548988456" target="_blank">asari_atari</a>`
  },
  {
    id: 'music',
    title: 'MUSIC',
    content: `FAVORITE ARTIST:\n> Ado\n\nFAVORITE SONG:\n> 2:00 by enveel\n\nNOW PLAYING:\n> THOTTWAT - SHIRT`
  },
  {
    id: 'archive',
    title: 'ARCHIVE',
    content: `HARDWARE / SETUP:\n- RTX 5060 TI\n- AMD RYZEN 9 7900X\n- 32GB DDR5 RAM\n\nPERIPHERALS:\n- RAZER OROCHI V2\n- AULA WIN60 HE\n\nAUDIO:\n- HYPERX QUADCAST S\n- HYPERX CLOUD EARBUDS II\n\nVIDEOGAMES:\n- ARC RAIDERS, DARK SOULS, RESIDENT EVIL, TLOU\n\nSERIES / MOVIES:\n- CHAINSAWMAN, FATE SERIES, DEATH NOTE, BREAKING BAD\n- KILL LA KILL, AOT, ARCANE, SCISSOR SEVEN, YOUR NAME\n- CYBERPUNK 2077`
  },
  {
    id: 'status',
    title: 'STATUS',
    content: `ONLINE\nCONNECTION: STABLE\nSYSTEM: ACTIVE`
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

const FloatingPanel = ({ data, activeId, onClick }) => {
  const groupRef = useRef();
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 2 + data.index) * 1.0;
      
      const scale = 1 + (activeId === data.id ? audioState.bass * 0.05 : 0);
      groupRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.1);
    }
  });

  const isActive = activeId === data.id;

  return (
    <group ref={groupRef} position={[data.x, 0, data.z]} rotation={[0, data.angle, 0]}>
      <Html transform distanceFactor={15} center zIndexRange={[100, 0]}>
        <div 
          className={`html-panel ${isActive ? 'active' : ''}`}
          onClick={() => { if (!isActive) onClick(data.id) }}
        >
          <h2 className="panel-title">{data.title}</h2>
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
  const startTime = useRef(0);
  const targetRot = useRef(0);
  
  useEffect(() => {
    if (playing && startTime.current === 0) {
      startTime.current = performance.now();
    }
  }, [playing]);

  useEffect(() => {
    if (activeSection && carouselRef.current) {
      const targetData = SECTIONS.find(s => s.id === activeSection);
      let current = carouselRef.current.rotation.y;
      // We want the clicked card (at targetData.angle) to face the camera (which looks down -Z)
      let target = targetData.angle; 
      
      let diff = (-target - current) % (Math.PI * 2);
      if (diff < -Math.PI) diff += Math.PI * 2;
      if (diff > Math.PI) diff -= Math.PI * 2;
      targetRot.current = current + diff;
    }
  }, [activeSection, carouselRef]);

  useFrame((state, delta) => {
    if (audioState.bass > 0.7) {
      const shakeAmt = (audioState.bass - 0.7) * 0.8;
      state.camera.position.x += (Math.random() - 0.5) * shakeAmt;
      state.camera.position.y += (Math.random() - 0.5) * shakeAmt;
    }

    if (playing && !introFinished.current) {
      const elapsed = (performance.now() - startTime.current) / 1000;
      if (elapsed < 3) {
        // Fast aggressive dive
        const progress = Math.min(elapsed / 3, 1);
        const easeOut = 1 - Math.pow(1 - progress, 5);
        
        const startPos = new THREE.Vector3(0, 150, 100);
        const targetPos = new THREE.Vector3(0, 0, 60);
        
        state.camera.position.lerpVectors(startPos, targetPos, easeOut);
        lookAtPos.current.lerp(new THREE.Vector3(0, 0, 0), 5 * delta);
      } else {
        introFinished.current = true;
      }
    } else if (introFinished.current) {
      
      if (activeSection) {
        // ZOOMED IN (CARD SELECTED)
        carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 6 * delta);
        
        // Swoop in with a dramatic tilt
        const targetCamPos = new THREE.Vector3(-4, -6, R + 14);
        state.camera.position.lerp(targetCamPos, 5 * delta);
        
        // Look slightly up and right at the card (which is at [0,0,R])
        lookAtPos.current.lerp(new THREE.Vector3(2, 4, R), 5 * delta);
        
      } else {
        // OVERVIEW (CHARACTER SELECT PANNING)
        targetRot.current -= (state.pointer.x * 4 * delta); 
        carouselRef.current.rotation.y = THREE.MathUtils.lerp(carouselRef.current.rotation.y, targetRot.current, 8 * delta);
        
        const targetCamPos = new THREE.Vector3(0, 0, 65);
        state.camera.position.lerp(targetCamPos, 5 * delta);
        lookAtPos.current.lerp(new THREE.Vector3(0, 0, 0), 5 * delta);
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
    
    setTimeout(() => {
      setIntroTextVisible(true);
      setTimeout(() => setIntroTextVisible(false), 2000);
    }, 1000);
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
            fontSize: '10rem',
            color: '#fff',
            textShadow: '0 0 30px #ffffff, 5px 5px 0 #cc1111',
            margin: 0,
            animation: 'safe-glitch 0.1s infinite',
            mixBlendMode: 'screen'
          }}>
            ASA
          </h1>
        </div>
      )}

      {started && (
        <div className="ui-layer">
          {activeSection && (
            <button className="back-btn" onClick={() => setActiveSection(null)}>
              [ BACK TO OVERVIEW ]
            </button>
          )}
          <AudioVisualizer />
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
        <directionalLight position={[0, -10, -5]} intensity={1} color="#cc1111" />
        
        <Suspense fallback={null}>
          <Particles />
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
