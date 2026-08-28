import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { audioState, updateAudioData } from './audio.js';

// ═══════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════

/** Clamp per-frame delta so a stalled tab can't teleport animations. */
export const clampDelta = (delta) => (delta > 0.1 ? 0.1 : delta);

/**
 * Frame-rate independent lerp factor.
 * `rate` is roughly "how much of the gap is closed per second".
 */
export const damp = (rate, delta) => 1 - Math.pow(1 - rate, delta * 60);

/** Shortest signed angular distance from `a` to `b`. */
export const shortestAngle = (a, b) => {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
};

/**
 * Quality tiers keep one knob for every particle count in the scene,
 * so a low-end device scales down consistently instead of per-component.
 */
export const QUALITY = {
  low: { particles: 0.3, rings: 3, bars: 32, voids: 6, hearts: 4, cardParticles: 120, effects: false },
  medium: { particles: 0.6, rings: 4, bars: 48, voids: 10, hearts: 6, cardParticles: 320, effects: true },
  high: { particles: 1, rings: 6, bars: 64, voids: 15, hearts: 8, cardParticles: 600, effects: true }
};

export const detectQuality = () => {
  if (typeof window === 'undefined') return 'high';
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const narrow = window.innerWidth <= 768;
  if (narrow || (coarse && cores <= 4) || memory <= 2) return 'low';
  if (cores <= 4 || memory <= 4 || coarse) return 'medium';
  return 'high';
};

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const ACCENT = new THREE.Color('#a020f0');

// ═══════════════════════════════════════════════════════════
// AUDIO DRIVER — samples the analyser once per frame
// ═══════════════════════════════════════════════════════════

export const AudioDriver = () => {
  const cache = useRef({ bass: -1, sub: -1, mid: -1, high: -1 });

  // Runs before every other useFrame subscriber (negative priority) so the
  // whole scene reads a single, consistent audio sample each frame.
  useFrame((_, delta) => {
    const d = clampDelta(delta);
    updateAudioData(d);

    // Pipe bands to CSS custom properties, but only when a value actually
    // changed — writing to documentElement.style every frame forces a style
    // recalculation across the entire document.
    const root = document.documentElement.style;
    const write = (key, value) => {
      const rounded = Math.round(value * 100) / 100;
      if (cache.current[key] !== rounded) {
        cache.current[key] = rounded;
        root.setProperty(`--${key}`, rounded.toFixed(2));
      }
    };
    write('bass', audioState.smoothBass);
    write('sub', audioState.smoothSub);
    write('mid', audioState.smoothMid);
    write('high', audioState.smoothHigh);
  }, -1);

  return null;
};

// ═══════════════════════════════════════════════════════════
// BACKGROUND GEOMETRY
// ═══════════════════════════════════════════════════════════

export const HorizonTrees = () => {
  const texture = useLoader(THREE.TextureLoader, '/trees.png');
  const matRef = useRef();

  // Configure the texture in an effect rather than during render: the loader
  // caches by URL, so mutating it inline would leak settings across mounts.
  useEffect(() => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(12, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
  }, [texture]);

  useFrame((_, delta) => {
    const mat = matRef.current;
    if (!mat?.map) return;
    const d = clampDelta(delta);
    mat.map.offset.x += d * 0.01;
    const b = audioState.smoothBass;
    mat.color.setRGB(1 - b * 0.4, 1 - b * 0.9, 1 - b * 0.1);
    mat.opacity = 0.5 + b * 0.3;
  });

  return (
    <mesh position={[0, -25, 0]} frustumCulled={false}>
      <cylinderGeometry args={[90, 90, 50, 48, 1, true]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        transparent
        opacity={0.6}
        depthWrite={false}
        side={THREE.BackSide}
      />
    </mesh>
  );
};

export const VoidShapes = ({ quality }) => {
  const meshRef = useRef();
  const count = QUALITY[quality].voids;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const shapes = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        pos: [
          (Math.random() - 0.5) * 200,
          (Math.random() - 0.5) * 100 + 30,
          (Math.random() - 0.5) * 200
        ],
        rot: [Math.random() * Math.PI, Math.random() * Math.PI, 0],
        speed: (Math.random() - 0.5) * 0.3,
        scale: Math.random() * 3 + 1
      })),
    [count]
  );

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const d = clampDelta(delta);
    const bassScale = 1 + audioState.smoothBass * 1.2;
    const beatPush = audioState.beatDetected ? audioState.beatEnergy * 3 : 0;

    for (let i = 0; i < count; i++) {
      const shape = shapes[i];
      shape.rot[0] += (shape.speed + audioState.smoothMid * 0.5) * d;
      shape.rot[1] += (shape.speed + audioState.smoothHigh * 0.3) * d;

      const [x, y, z] = shape.pos;
      const dist = Math.hypot(x, z) || 1;
      dummy.position.set(x + (x / dist) * beatPush, y, z + (z / dist) * beatPush);
      dummy.rotation.set(shape.rot[0], shape.rot[1], 0);
      dummy.scale.setScalar(shape.scale * bassScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color={ACCENT} wireframe transparent opacity={0.15} depthWrite={false} />
    </instancedMesh>
  );
};

const createHeartShape = () => {
  const shape = new THREE.Shape();
  shape.moveTo(-2.659, -5.183);
  shape.bezierCurveTo(-4.301, -5.183, -5.6, -3.86, -5.6, -2.242);
  shape.bezierCurveTo(-5.6, 1.066, -2.267, 1.924, -0.012, 5.183);
  shape.bezierCurveTo(2.144, 1.948, 5.6, 0.944, 5.6, -2.242);
  shape.bezierCurveTo(5.6, -3.86, 4.277, -5.183, 2.659, -5.183);
  shape.bezierCurveTo(1.483, -5.183, 0.453, -4.497, -0.012, -3.492);
  shape.bezierCurveTo(-0.478, -4.497, -1.483, -5.183, -2.659, -5.183);
  return shape;
};

export const HeartShapes = ({ quality }) => {
  const meshRef = useRef();
  const count = QUALITY[quality].hearts;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(
    () => new THREE.ExtrudeGeometry(createHeartShape(), { depth: 0.5, bevelEnabled: false }),
    []
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  const shapes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        pos: [
          (Math.random() - 0.5) * 150,
          (Math.random() - 0.5) * 100 + 40,
          (Math.random() - 0.5) * 150
        ],
        baseY: 0,
        rot: Math.random() * Math.PI * 2,
        speed: (Math.random() - 0.5) * 0.5,
        scale: Math.random() * 0.2 + 0.1,
        phase: i * 1.7
      })),
    [count]
  );

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const d = clampDelta(delta);
    const t = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      const shape = shapes[i];
      shape.rot += shape.speed * d;
      // Oscillate around the spawn height instead of integrating sin() into
      // position, which made hearts drift away over long sessions.
      const bob = Math.sin(t * 0.6 + shape.phase) * 2.5;
      dummy.position.set(shape.pos[0], shape.pos[1] + bob, shape.pos[2]);
      dummy.rotation.set(Math.PI, shape.rot, 0);
      dummy.scale.setScalar(shape.scale * (1 + audioState.smoothBass * 0.5));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, count]}
      frustumCulled={false}
    >
      <meshBasicMaterial color={ACCENT} transparent opacity={0.3} wireframe depthWrite={false} />
    </instancedMesh>
  );
};

export const AmbientParticles = ({ quality }) => {
  const count = Math.round(150 * QUALITY[quality].particles);
  const pointsRef = useRef();
  const matRef = useRef();

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 250;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100 + 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 250;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state, delta) => {
    const points = pointsRef.current;
    const mat = matRef.current;
    if (!points || !mat) return;
    const d = clampDelta(delta);
    const b = audioState.smoothBass;

    points.rotation.y += d * (0.05 + b * 1.2);
    points.position.y = Math.sin(state.clock.elapsedTime * 0.2) * 5;
    mat.size = 0.4 + b * 2;
    mat.opacity = 0.3 + b * 0.7;
    mat.color.setRGB(0.63 + b * 0.37, 0.12 * (1 - b), 0.94);
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={matRef}
        size={0.4}
        color={ACCENT}
        transparent
        opacity={0.5}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};

export const BassShockwaves = ({ quality }) => {
  const maxRings = QUALITY[quality].rings;
  const meshRefs = useRef([]);
  const rings = useRef(
    Array.from({ length: maxRings }, () => ({ active: false, start: 0 }))
  );
  const next = useRef(0);

  useFrame((state) => {
    const now = state.clock.elapsedTime;

    if (audioState.beatDetected) {
      const ring = rings.current[next.current % maxRings];
      ring.active = true;
      ring.start = now;
      next.current++;
    }

    for (let i = 0; i < maxRings; i++) {
      const mesh = meshRefs.current[i];
      const ring = rings.current[i];
      if (!mesh) continue;

      if (!ring.active) {
        if (mesh.visible) mesh.visible = false;
        continue;
      }

      const progress = (now - ring.start) / 2;
      if (progress >= 1) {
        ring.active = false;
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;
      // Ease the expansion so rings burst outward then glide, rather than
      // travelling at a constant rate for their whole life.
      const eased = 1 - Math.pow(1 - progress, 2.5);
      const scale = 1 + eased * 80;
      mesh.scale.set(scale, scale, 1);
      mesh.material.opacity = (1 - progress * progress) * 0.35;
      if (progress < 0.08) mesh.material.color.setRGB(1, 1, 1);
      else mesh.material.color.copy(ACCENT);
    }
  });

  return (
    <group position={[0, -19, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {Array.from({ length: maxRings }, (_, i) => (
        <mesh key={i} ref={(el) => (meshRefs.current[i] = el)} visible={false} frustumCulled={false}>
          <ringGeometry args={[0.85, 1, 64]} />
          <meshBasicMaterial
            color={ACCENT}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
};

export const AudioVisualizerRing = ({ quality }) => {
  const meshRef = useRef();
  const barCount = QUALITY[quality].bars;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const heights = useRef(new Float32Array(barCount));
  const radius = 38;

  // Precompute the ring layout once — trig per bar per frame was pure waste.
  const layout = useMemo(
    () =>
      Array.from({ length: barCount }, (_, i) => {
        const angle = (i / barCount) * Math.PI * 2;
        return {
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          bin: Math.floor((i / barCount) * 128)
        };
      }),
    [barCount]
  );

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const d = clampDelta(delta);
    // Bars rise instantly but fall smoothly, which reads far better than
    // snapping directly to the raw FFT bin every frame.
    const fall = damp(0.25, d);

    for (let i = 0; i < barCount; i++) {
      const { x, z, bin } = layout[i];
      const target = 0.3 + (audioState.raw[bin] / 255) * 14;
      const current = heights.current[i];
      const height = target > current ? target : current + (target - current) * fall;
      heights.current[i] = height;

      dummy.position.set(x, -19 + height * 0.5, z);
      dummy.scale.set(0.35, height, 0.35);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, barCount]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color={ACCENT}
        transparent
        opacity={0.25}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
};

export const ReactiveFloor = () => {
  const matRef = useRef();

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    const b = audioState.smoothBass;
    mat.opacity = 0.1 + b * 0.35;
    mat.color.setRGB(0.02 + b * 0.4, 0, b * 0.6);
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -20, 0]} frustumCulled={false}>
      <planeGeometry args={[300, 300, 32, 32]} />
      <meshBasicMaterial ref={matRef} wireframe transparent opacity={0.15} depthWrite={false} />
    </mesh>
  );
};

export const ReactiveFog = () => {
  useFrame((state) => {
    const fog = state.scene.fog;
    if (!fog) return;
    const breathing = Math.sin(state.clock.elapsedTime * 0.3) * 0.003;
    fog.density = 0.012 + audioState.smoothBass * 0.01 + breathing;
  });
  return null;
};

/**
 * Particles that rush outward during the opening beat, then retire.
 * Driven by an explicit elapsed clock rather than a global so it stays
 * deterministic and testable.
 */
export const IntroParticles = ({ active, quality, duration }) => {
  const meshRef = useRef();
  const groupRef = useRef();
  const count = Math.round(100 * QUALITY[quality].particles);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const elapsed = useRef(0);
  const retired = useRef(false);

  const particles = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        from: [
          (Math.random() - 0.5) * 40,
          (Math.random() - 0.5) * 40,
          (Math.random() - 0.5) * 15
        ],
        to: [
          (Math.random() - 0.5) * 120,
          (Math.random() - 0.5) * 120,
          (Math.random() - 0.5) * 80
        ],
        speed: Math.random() * 1.5 + 0.3
      })),
    [count]
  );

  useFrame((_, delta) => {
    if (!active || retired.current) return;
    const mesh = meshRef.current;
    const group = groupRef.current;
    if (!mesh || !group) return;

    elapsed.current += clampDelta(delta);
    const progress = Math.min(elapsed.current / duration, 1);

    if (progress >= 1) {
      retired.current = true;
      group.visible = false;
      return;
    }

    // Ease out so the burst decelerates into the void.
    const eased = 1 - Math.pow(1 - progress, 3);
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const t = Math.min(eased * p.speed, 1);
      dummy.position.set(
        p.from[0] + (p.to[0] - p.from[0]) * t,
        p.from[1] + (p.to[1] - p.from[1]) * t,
        p.from[2] + (p.to[2] - p.from[2]) * t
      );
      dummy.scale.setScalar(1 - progress * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.25, 6, 6]} />
        <meshBasicMaterial
          color={ACCENT}
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
};
