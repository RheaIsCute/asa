import { useRef, useState, useMemo, useEffect, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { audioState } from './audio.js';
import { Icon } from './sections.jsx';
import { clampDelta, damp, QUALITY } from './scene.jsx';

// ═══════════════════════════════════════════════════════════
// CARD ASSEMBLY PARTICLES
//
// Points sweep upward into the card silhouette, then fade out as the
// HTML panel takes over.
// ═══════════════════════════════════════════════════════════

const CardParticles = memo(({ delay, quality, active, onSettled }) => {
  const pointsRef = useRef();
  const matRef = useRef();
  const elapsed = useRef(0);
  const done = useRef(false);
  const count = QUALITY[quality].cardParticles;

  const { geometry, targets } = useMemo(() => {
    const target = new Float32Array(count * 3);
    const start = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      target[i3] = (Math.random() - 0.5) * 22;
      target[i3 + 1] = (Math.random() - 0.5) * 32;
      target[i3 + 2] = (Math.random() - 0.5) * 2;

      start[i3] = target[i3] + (Math.random() - 0.5) * 40;
      start[i3 + 1] = target[i3 + 1] + 30 + Math.random() * 40;
      start[i3 + 2] = target[i3 + 2] + (Math.random() - 0.5) * 30;

      // Mostly accent hue, with a few bright sparks for contrast.
      const r = Math.random();
      if (r > 0.7) {
        colors[i3] = 1; colors[i3 + 1] = 0.85; colors[i3 + 2] = 1;
      } else if (r > 0.3) {
        colors[i3] = 0.62; colors[i3 + 1] = 0.12; colors[i3 + 2] = 0.94;
      } else {
        colors[i3] = 0.8; colors[i3 + 1] = 0.5; colors[i3 + 2] = 1;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(start, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return { geometry: geo, targets: target };
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    if (done.current || !active) return;
    const points = pointsRef.current;
    const mat = matRef.current;
    if (!points || !mat) return;

    const d = clampDelta(delta);
    elapsed.current += d;
    const local = elapsed.current - delay;

    if (local < 0) {
      mat.opacity = 0;
      return;
    }

    const progress = Math.min(local / 0.9, 1);
    const positions = geometry.attributes.position.array;
    // A scan line sweeps down the card; particles above it snap into place.
    const scanY = 20 - progress * 44;
    const rate = damp(0.25, d);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      if (targets[i3 + 1] > scanY) {
        positions[i3] += (targets[i3] - positions[i3]) * rate;
        positions[i3 + 1] += (targets[i3 + 1] - positions[i3 + 1]) * rate;
        positions[i3 + 2] += (targets[i3 + 2] - positions[i3 + 2]) * rate;
      } else {
        positions[i3 + 1] -= d * 5;
      }
    }
    geometry.attributes.position.needsUpdate = true;

    mat.opacity = progress > 0.75 ? (1 - progress) * 4 * 0.9 : 0.9;

    if (progress >= 1) {
      done.current = true;
      onSettled?.();
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={matRef}
        size={0.3}
        vertexColors
        transparent
        opacity={0}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
});

CardParticles.displayName = 'CardParticles';

// ═══════════════════════════════════════════════════════════
// FLOATING PANEL
// ═══════════════════════════════════════════════════════════

export const FloatingPanel = ({
  data,
  activeId,
  onSelect,
  onHover,
  playing,
  quality,
  reducedMotion,
  introDelay,
  children
}) => {
  const outerRef = useRef();
  const innerRef = useRef();
  const [settled, setSettled] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tilt = useRef({ x: 0, y: 0 });

  const isActive = activeId === data.id;
  const isDimmed = activeId != null && !isActive;
  const interactive = settled && !isDimmed;

  // Safety net: if the canvas never runs a frame (e.g. context loss), still
  // reveal the card rather than leaving it invisible forever. The particle
  // sweep normally calls onSettled well before this fires.
  useEffect(() => {
    if (!playing) return undefined;
    const ms = (introDelay + data.index * 0.15 + 2.5) * 1000;
    const id = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(id);
  }, [playing, introDelay, data.index]);

  useFrame((state, delta) => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const d = clampDelta(delta);
    const motion = reducedMotion ? 0 : 1;
    const t = state.clock.elapsedTime;

    // Idle bob, phase-offset per card so the ring never pulses in unison.
    const bob =
      motion *
      (Math.sin(t * 1.4 + data.index) * 0.5 +
        Math.sin(t * 3 + data.index * 0.7) * audioState.smoothBass * 1.4);
    outer.position.y += (bob - outer.position.y) * damp(0.1, d);

    // Hover lift + tilt, suppressed while any card is focused.
    const lifted = hovered && !activeId;
    const targetScale = lifted ? 1.035 : 1;
    const targetZ = lifted ? 2.2 : 0;
    const targetRotX = lifted ? tilt.current.y * 0.18 : 0;
    const targetRotY = lifted ? -tilt.current.x * 0.18 : 0;

    const rate = damp(0.18, d);
    const scale = inner.scale.x + (targetScale - inner.scale.x) * rate;
    inner.scale.setScalar(scale);
    inner.position.z += (targetZ - inner.position.z) * rate;
    inner.rotation.x += (targetRotX - inner.rotation.x) * rate;
    inner.rotation.y += (targetRotY - inner.rotation.y) * rate;
  });

  const handleMouseMove = (e) => {
    if (activeId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    tilt.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    tilt.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  };

  const handleActivate = () => {
    if (!isActive && interactive) onSelect(data.id);
  };

  const classes = [
    'panel',
    settled && 'is-settled',
    isActive && 'is-active',
    isDimmed && 'is-dimmed',
    hovered && !activeId && 'is-hovered'
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <group ref={outerRef} position={[data.x, 0, data.z]} rotation={[0, data.angle, 0]}>
      {!settled && (
        <CardParticles
          delay={introDelay + data.index * 0.15}
          quality={quality}
          active={playing}
          onSettled={() => setSettled(true)}
        />
      )}
      <group ref={innerRef}>
        <Html
          transform
          distanceFactor={15}
          center
          zIndexRange={[100, 0]}
          style={{ pointerEvents: interactive ? 'auto' : 'none' }}
        >
          <div
            className={classes}
            style={data.width ? { width: `${data.width}px` } : undefined}
            role="button"
            tabIndex={interactive && !isActive ? 0 : -1}
            aria-label={`Open ${data.title}`}
            aria-expanded={isActive}
            onClick={handleActivate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleActivate();
              }
            }}
            onMouseEnter={() => {
              setHovered(true);
              if (!activeId) onHover?.();
            }}
            onMouseLeave={() => {
              setHovered(false);
              tilt.current.x = 0;
              tilt.current.y = 0;
            }}
            onMouseMove={handleMouseMove}
          >
            <div className="panel-sheen" aria-hidden="true" />
            <h2 className="panel-title">
              <Icon name={data.icon} />
              <span>{data.title}</span>
            </h2>
            <div className="panel-body">{children}</div>
            {!isActive && <div className="panel-cue">OPEN</div>}
          </div>
        </Html>
      </group>
    </group>
  );
};
