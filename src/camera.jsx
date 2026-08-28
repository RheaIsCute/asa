import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { audioState } from './audio.js';
import { R } from './sections.jsx';
import { clampDelta, damp, shortestAngle } from './scene.jsx';

// ═══════════════════════════════════════════════════════════
// CAMERA & CAROUSEL CONTROLLER
//
// Motion is built from three layers that never fight each other:
//   1. A base pose (position + look target) chosen by the current phase.
//   2. Additive shake/parallax offsets applied after the base is settled.
//   3. Roll, applied last via the camera's own up-vector so lookAt()
//      cannot overwrite it (the previous implementation set rotation.z
//      before lookAt, so the tilt never actually rendered).
// ═══════════════════════════════════════════════════════════

const PHASE = { IDLE: 0, DESCEND: 1, SPIN: 2, LIVE: 3 };

/** Cubic ease-out — quick departure, soft arrival. */
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
/** Symmetric ease for the intro swoop. */
const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Framing distances tuned per aspect ratio so cards are never clipped
 * on tall phones or ultrawide monitors.
 */
const overviewDistance = (aspect) => {
  if (aspect < 0.6) return 92;
  if (aspect < 0.8) return 82;
  if (aspect < 1.0) return 74;
  if (aspect > 2.2) return 58;
  return 65;
};

const focusDistance = (aspect, fallback) => {
  if (aspect < 0.6) return 31;
  if (aspect < 0.8) return 27;
  if (aspect < 1.0) return 24;
  return fallback;
};

export const SceneController = ({
  activeSection,
  setActiveSection,
  playing,
  carouselRef,
  sections,
  rotateCommand,
  onCenterIndexChange,
  reducedMotion,
  introDuration,
  onPhaseChange
}) => {
  // ── Persistent motion state (never reallocated per frame) ──
  const phase = useRef(PHASE.IDLE);
  const phaseClock = useRef(0);
  const spin = useRef({ current: 0, target: 0, velocity: 0 });
  const lookAt = useRef(new THREE.Vector3(0, -20, 0));
  const basePos = useRef(new THREE.Vector3(0, 150, 100));
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });
  const roll = useRef(0);
  const fov = useRef(60);
  const swapPulse = useRef(0);
  const lastIndex = useRef(-1);
  const introStart = useRef(new THREE.Vector3(0, 150, 100));

  // Scratch vectors — reused every frame to keep the GC quiet.
  const scratch = useMemo(
    () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3() }),
    []
  );

  const touch = useRef({
    id: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    velocity: 0,
    dragging: false
  });

  const spacing = sections.length ? (Math.PI * 2) / sections.length : 0;

  // ── Phase transitions ──
  useEffect(() => {
    if (playing && phase.current === PHASE.IDLE) {
      phase.current = PHASE.DESCEND;
      phaseClock.current = 0;
    }
  }, [playing]);

  // ── Focus a card: align the carousel so it faces the camera ──
  useEffect(() => {
    if (!activeSection || !carouselRef.current) return;
    const target = sections.find((s) => s.id === activeSection);
    if (!target) return;
    const current = spin.current.current;
    spin.current.target = current + shortestAngle(current, -target.angle);
    spin.current.velocity = 0;
    swapPulse.current = 1;
  }, [activeSection, carouselRef, sections]);

  // ── External rotate requests (nav arrows / dots) ──
  useEffect(() => {
    if (rotateCommand == null) return;
    const current = spin.current.current;
    spin.current.target = current + shortestAngle(current, -rotateCommand.angle);
  }, [rotateCommand]);

  // ── Input ──
  useEffect(() => {
    const canInteract = () => phase.current === PHASE.LIVE;

    const step = (direction) => {
      if (activeSection) {
        const idx = sections.findIndex((s) => s.id === activeSection);
        const next = (idx + direction + sections.length) % sections.length;
        setActiveSection(sections[next].id);
      } else {
        spin.current.target -= direction * spacing;
      }
    };

    const onKeyDown = (e) => {
      if (!canInteract()) return;
      switch (e.code) {
        case 'Space':
        case 'ArrowRight':
        case 'KeyD':
          e.preventDefault();
          step(1);
          break;
        case 'ArrowLeft':
        case 'KeyA':
          e.preventDefault();
          step(-1);
          break;
        case 'Escape':
          if (activeSection) setActiveSection(null);
          break;
        case 'Enter':
          if (!activeSection && sections[lastIndex.current]) {
            setActiveSection(sections[lastIndex.current].id);
          }
          break;
        default:
          break;
      }
    };

    const onPointerMove = (e) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };

    const onWheel = (e) => {
      if (!canInteract() || activeSection) return;
      spin.current.target += e.deltaY * 0.0016;
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touch.current = {
        id: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        lastTime: performance.now(),
        velocity: 0,
        dragging: true
      };
    };

    const onTouchMove = (e) => {
      const state = touch.current;
      if (!state.dragging) return;
      const t = Array.from(e.touches).find((x) => x.identifier === state.id);
      if (!t) return;

      const dx = t.clientX - state.lastX;
      const now = performance.now();
      const dt = Math.max(now - state.lastTime, 1);
      // Blend velocity so a brief pause before release doesn't fling the wheel.
      state.velocity = state.velocity * 0.6 + (dx / dt) * 0.4;

      if (!activeSection && canInteract()) {
        spin.current.target -= dx * 0.005;
      }

      state.lastX = t.clientX;
      state.lastY = t.clientY;
      state.lastTime = now;
    };

    const onTouchEnd = () => {
      const state = touch.current;
      if (!state.dragging) return;
      state.dragging = false;

      const dx = state.lastX - state.startX;
      const dy = state.lastY - state.startY;

      if (!activeSection && canInteract()) {
        // Throw, then settle on the nearest card so the carousel always
        // comes to rest with something centred.
        spin.current.target -= state.velocity * 0.14;
        if (spacing > 0) {
          spin.current.target = Math.round(spin.current.target / spacing) * spacing;
        }
      } else if (activeSection) {
        if (dx < -45) step(1);
        else if (dx > 45) step(-1);
        else if (dy > 70) setActiveSection(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [activeSection, setActiveSection, sections, spacing]);

  useFrame((state, delta) => {
    const d = clampDelta(delta);
    const time = state.clock.elapsedTime;
    const camera = state.camera;
    const aspect = state.size.width / state.size.height;
    const portrait = aspect < 1;

    const bass = audioState.smoothBass;
    const beat = audioState.beatDetected;
    const motion = reducedMotion ? 0 : 1;

    phaseClock.current += d;

    // ── 1. Base pose per phase ────────────────────────────
    if (phase.current === PHASE.DESCEND) {
      const hold = introDuration;
      const travel = 2.6;

      if (phaseClock.current < hold) {
        // Hover high above the scene while the intro particles burst.
        const t = phaseClock.current / hold;
        basePos.current.set(0, 150 + Math.sin(time * 0.5) * 10, 100);
        lookAt.current.set(0, -20, 0);
        introStart.current.copy(basePos.current);
        void t;
      } else if (phaseClock.current < hold + travel) {
        const t = (phaseClock.current - hold) / travel;
        const eased = easeInOutCubic(t);
        const targetZ = overviewDistance(aspect);

        basePos.current.lerpVectors(
          introStart.current,
          scratch.pos.set(0, 0, targetZ),
          eased
        );

        // A single decaying arc swings the camera around the descent so it
        // arrives facing front instead of dropping straight down.
        const arc = (1 - eased) * 26 * motion;
        basePos.current.x += Math.sin(t * Math.PI) * arc;
        basePos.current.z += Math.cos(t * Math.PI * 0.5) * arc * 0.6;

        lookAt.current.set(0, -20 * (1 - eased), 0);
        roll.current = Math.sin(t * Math.PI) * 0.05 * motion;
      } else {
        phase.current = PHASE.SPIN;
        phaseClock.current = 0;
        spin.current.target = Math.PI * 2;
      }
    } else if (phase.current === PHASE.SPIN) {
      const duration = reducedMotion ? 0.4 : 2.2;
      const t = Math.min(phaseClock.current / duration, 1);
      spin.current.current = Math.PI * 2 * easeOutCubic(t) * motion;

      basePos.current.lerp(scratch.pos.set(0, 0, overviewDistance(aspect)), damp(0.08, d));
      lookAt.current.lerp(scratch.look.set(0, 0, 0), damp(0.08, d));
      roll.current *= 1 - damp(0.06, d);

      if (t >= 1) {
        phase.current = PHASE.LIVE;
        spin.current.target = spin.current.current;
        onPhaseChange?.('live');
      }
    } else if (phase.current === PHASE.LIVE) {
      if (activeSection) {
        // ── Focused on a card ──
        const data = sections.find((s) => s.id === activeSection);
        const [ox, oy, oz] = data?.camOffset ?? [0, 0, 22];
        const [lx, ly, lz] = data?.lookOffset ?? [0, 0, 0];

        const cx = portrait ? 0 : ox;
        const cy = portrait ? 0 : oy;
        const cz = focusDistance(aspect, oz);

        // Slower damping when focusing gives the push-in weight; the swap
        // pulse briefly speeds it up so card-to-card cuts feel decisive.
        const rate = 0.09 + swapPulse.current * 0.06;
        basePos.current.lerp(scratch.pos.set(cx, cy, R + cz), damp(rate, d));
        lookAt.current.lerp(
          scratch.look.set(portrait ? 0 : lx, portrait ? 0 : ly, R + lz),
          damp(rate, d)
        );
        roll.current += (0 - roll.current) * damp(0.1, d);
      } else {
        // ── Overview: slow orbital drift + pointer parallax ──
        const dist = overviewDistance(aspect);
        const orbit = time * 0.15;
        const radius = (portrait ? 1 : 2) + bass * 3 * motion;

        const px = portrait ? 0 : pointer.current.sx * 3.5 * motion;
        const py = portrait ? 0 : pointer.current.sy * 2.5 * motion;

        scratch.pos.set(
          Math.sin(orbit) * radius + px,
          Math.cos(orbit * 0.7) * (1 + bass * 2 * motion) + py,
          dist
        );
        basePos.current.lerp(scratch.pos, damp(0.07, d));
        lookAt.current.lerp(scratch.look.set(px * 0.5, py * 0.5, 0), damp(0.07, d));

        // Gentle dutch tilt that breathes with the low end.
        roll.current += (Math.sin(time * 0.35) * 0.035 * bass * motion - roll.current) * damp(0.05, d);
      }
    } else {
      basePos.current.set(0, 150, 100);
      lookAt.current.set(0, -20, 0);
    }

    // ── 2. Carousel rotation (critically damped spring) ───
    const s = spin.current;
    if (phase.current === PHASE.LIVE) {
      // A spring reaches the target without the overshoot-free mushiness of
      // a plain lerp, and stays stable regardless of frame rate.
      const stiffness = activeSection ? 150 : 90;
      const damping = 2 * Math.sqrt(stiffness);
      const accel = (s.target - s.current) * stiffness - s.velocity * damping;
      s.velocity += accel * d;
      s.current += s.velocity * d;
    }

    if (carouselRef.current) {
      carouselRef.current.rotation.y = s.current;

      if (onCenterIndexChange && spacing > 0) {
        let norm = (-s.current) % (Math.PI * 2);
        if (norm < 0) norm += Math.PI * 2;
        const idx = Math.round(norm / spacing) % sections.length;
        if (idx !== lastIndex.current) {
          lastIndex.current = idx;
          onCenterIndexChange(idx);
        }
      }
    }

    // ── 3. Smooth pointer, then apply additive offsets ────
    pointer.current.sx += (pointer.current.x - pointer.current.sx) * damp(0.05, d);
    pointer.current.sy += (pointer.current.y - pointer.current.sy) * damp(0.05, d);

    camera.position.copy(basePos.current);

    if (phase.current === PHASE.LIVE && motion) {
      // Bass shake — scaled down while a card is open so text stays readable.
      const amount = bass > 0.25 ? (bass - 0.25) * (activeSection ? 0.12 : 0.34) : 0;
      if (amount > 0.001) {
        const st = time * 34;
        camera.position.x += Math.sin(st * 1.1) * amount;
        camera.position.y += Math.cos(st * 1.3) * amount * 0.7;
      }
      if (beat && !activeSection) {
        // Dolly toward the scene on impact rather than jittering randomly.
        camera.position.z -= audioState.beatEnergy * 1.8;
      }
    }

    // ── 4. Orientation: roll via the up-vector, before lookAt ──
    swapPulse.current = Math.max(0, swapPulse.current - d * 3);
    const totalRoll = roll.current + (motion ? swapPulse.current * 0.06 : 0);
    scratch.up.set(Math.sin(totalRoll), Math.cos(totalRoll), 0);
    camera.up.copy(scratch.up);
    camera.lookAt(lookAt.current);

    // ── 5. Field of view ──────────────────────────────────
    const targetFov =
      60 +
      (motion ? bass * 10 : 0) +
      (motion ? swapPulse.current * swapPulse.current * 14 : 0) +
      (portrait ? 4 : 0);
    fov.current += (targetFov - fov.current) * damp(0.12, d);
    if (Math.abs(camera.fov - fov.current) > 0.01) {
      camera.fov = fov.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
};
