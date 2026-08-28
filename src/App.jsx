import { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import {
  audioState,
  initAudio,
  playAudio,
  pauseAudio,
  setVolume,
  setMuted,
  disposeAudio,
  getAudioElement,
  playSFX
} from './audio.js';
import { SECTIONS, R } from './sections.jsx';
import {
  AudioDriver,
  ReactiveFog,
  IntroParticles,
  AmbientParticles,
  VoidShapes,
  HeartShapes,
  HorizonTrees,
  BassShockwaves,
  AudioVisualizerRing,
  ReactiveFloor,
  QUALITY,
  detectQuality,
  prefersReducedMotion
} from './scene.jsx';
import { SceneController } from './camera.jsx';
import { FloatingPanel } from './Panel.jsx';
import { LYRICS } from './lyrics.js';
import './App.css';

// Lazily loaded: the standalone page needs none of the 3D stack.
const HookloaderPage = lazy(() =>
  import('./Hookloader.jsx').then((m) => ({ default: m.HookloaderPage }))
);

/** Seconds the camera hovers before descending into the carousel. */
const INTRO_HOLD = 3.2;
/** When cards begin materialising, relative to playback start. */
const CARD_DELAY = INTRO_HOLD + 2.6;

// ═══════════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════════

const HOOKLOADER_PATTERN = /(hookloader|download|projects)/;

const readRoute = () => {
  if (typeof window === 'undefined') return 'main';
  const target = `${window.location.pathname}${window.location.hash}`.toLowerCase();
  return HOOKLOADER_PATTERN.test(target) ? 'hookloader' : 'main';
};

// ═══════════════════════════════════════════════════════════
// OVERLAYS
// ═══════════════════════════════════════════════════════════

/**
 * Chromatic-split text used for both the intro wordmark and lyrics.
 * All three layers share one transform so they never desynchronise.
 */
const GlitchText = ({ text, className = '', style }) => (
  <div className={`glitch-text ${className}`} style={style} data-text={text}>
    <span className="glitch-layer r" aria-hidden="true">
      {text}
    </span>
    <span className="glitch-layer c" aria-hidden="true">
      {text}
    </span>
    <span className="glitch-layer main">{text}</span>
  </div>
);

/** Lyrics driven off the audio element clock, rendered as plain state. */
const Lyrics = ({ active }) => {
  const [line, setLine] = useState('');

  useEffect(() => {
    if (!active) return undefined;

    let raf = 0;
    let last = '';
    // Poll on a timer rather than every animation frame — lyric lines change
    // a few times a minute, so 10Hz is more than enough and costs far less.
    const tick = () => {
      const el = getAudioElement();
      if (el && audioState.playing) {
        const t = el.currentTime;
        const found = LYRICS.find((l) => t >= l.start && t <= l.end);
        const next = found ? found.text : '';
        if (next !== last) {
          last = next;
          setLine(next);
        }
      }
      raf = window.setTimeout(tick, 100);
    };
    tick();

    return () => window.clearTimeout(raf);
  }, [active]);

  if (!line) return null;

  return (
    <div className="lyrics-layer" aria-live="polite">
      <GlitchText text={line} className="lyrics-text" />
    </div>
  );
};

/** In-scene download modal for the projects card. */
const DownloadOverlay = ({ onClose }) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('INITIALIZING CONNECTION...');
  const timerRef = useRef(null);
  const closeRef = useRef(onClose);

  // Keep the latest callback in a ref so the download effect below can stay
  // mounted for its whole run without re-subscribing when the parent rerenders.
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    playSFX('download');
    let value = 0;

    timerRef.current = setInterval(() => {
      value = Math.min(value + Math.random() * 15 + 6, 100);
      setProgress(value);

      if (value > 10 && value < 45) setStatus('NEGOTIATING SECURE CHANNEL...');
      else if (value < 80) setStatus('DOWNLOADING PAYLOAD...');
      else if (value < 100) setStatus('VERIFYING ARCHIVE...');

      if (value >= 100) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setStatus('DOWNLOAD COMPLETE');
        playSFX('complete');

        const link = document.createElement('a');
        link.href = '/hookloader.zip';
        link.download = 'hookloader.zip';
        document.body.appendChild(link);
        link.click();
        link.remove();

        timerRef.current = setTimeout(() => closeRef.current(), 900);
      }
    }, 260);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Downloading Hookloader">
      <div className="modal-card">
        <div className="modal-scan" aria-hidden="true" />
        <GlitchText text="HOOKLOADER" className="modal-title" />
        <div className="modal-status">{status}</div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={Math.floor(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="modal-percent">{Math.floor(progress)}%</div>
      </div>
    </div>
  );
};

/** Live now-playing block for the music card. */
const NowPlaying = () => {
  const [state, setState] = useState({ progress: 0, time: 0, duration: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      setState({
        progress: audioState.progress,
        time: audioState.currentTime,
        duration: audioState.duration
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  const format = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="hud-grid single">
      <div className="hud-block full now-playing">
        <div className="hud-label">NOW PLAYING</div>
        <div className="hud-value lead">Music and me</div>
        <div className="hud-value small muted">by Fakemink</div>

        <div className="track-track" aria-hidden="true">
          <div className="track-fill" style={{ width: `${state.progress * 100}%` }} />
        </div>
        <div className="track-times mono">
          <span>{format(state.time)}</span>
          <span>{format(state.duration)}</span>
        </div>

        {/* Eight bars driven straight from the CSS audio variables. */}
        <div className="eq" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={`eq-bar eq-${i % 4}`} />
          ))}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// POST-PROCESSING
// ═══════════════════════════════════════════════════════════

const Effects = ({ quality, reducedMotion }) => {
  const offset = useMemo(() => new THREE.Vector2(0.0006, 0.0006), []);
  if (!QUALITY[quality].effects) return null;

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        luminanceThreshold={0.22}
        luminanceSmoothing={0.85}
        intensity={reducedMotion ? 0.7 : 1.25}
        mipmapBlur
      />
      <ChromaticAberration
        offset={offset}
        blendFunction={BlendFunction.NORMAL}
        radialModulation
        modulationOffset={0.3}
      />
      <Vignette eskil={false} offset={0.12} darkness={1.05} />
    </EffectComposer>
  );
};

// ═══════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [centerIndex, setCenterIndex] = useState(0);
  const [rotateCommand, setRotateCommand] = useState(null);
  const [showTitle, setShowTitle] = useState(false);
  const [titleFading, setTitleFading] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(0.45);
  const [showDownload, setShowDownload] = useState(false);
  const [quality, setQuality] = useState(detectQuality);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [isCoarse, setIsCoarse] = useState(false);

  const carouselRef = useRef();
  const timers = useRef([]);

  // ── Routing ──
  const navigate = useCallback((path) => {
    window.history.pushState({}, '', path);
    setRoute(readRoute());
  }, []);

  useEffect(() => {
    const onLocationChange = () => setRoute(readRoute());
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);

  // ── Environment ──
  useEffect(() => {
    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const sync = () => {
      setIsCoarse(coarseQuery.matches || window.innerWidth <= 768);
      setQuality(detectQuality());
    };
    const syncMotion = () => setReducedMotion(motionQuery.matches);

    sync();
    syncMotion();
    window.addEventListener('resize', sync);
    coarseQuery.addEventListener('change', sync);
    motionQuery.addEventListener('change', syncMotion);

    return () => {
      window.removeEventListener('resize', sync);
      coarseQuery.removeEventListener('change', sync);
      motionQuery.removeEventListener('change', syncMotion);
    };
  }, []);

  // ── Pause audio when the tab is hidden, resume when it returns ──
  useEffect(() => {
    const onVisibility = () => {
      if (!started) return;
      if (document.hidden) pauseAudio();
      else playAudio();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [started]);

  // ── Clean up every pending timer and the audio graph on unmount ──
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      disposeAudio();
    },
    []
  );

  const sections = useMemo(
    () =>
      SECTIONS.map((section, index) => {
        const angle = (index / SECTIONS.length) * Math.PI * 2;
        return {
          ...section,
          index,
          angle,
          x: Math.sin(angle) * R,
          z: Math.cos(angle) * R
        };
      }),
    []
  );

  const handleStart = useCallback(() => {
    if (started) return;
    initAudio();
    setVolume(volume);
    playAudio();
    setStarted(true);

    const schedule = (fn, ms) => timers.current.push(setTimeout(fn, ms));
    schedule(() => setShowTitle(true), 250);
    schedule(() => setTitleFading(true), (INTRO_HOLD + 2) * 1000);
    schedule(() => {
      setShowTitle(false);
      setTitleFading(false);
    }, (INTRO_HOLD + 2.8) * 1000);
  }, [started, volume]);

  const handleMute = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev;
      setMuted(next);
      return next;
    });
  }, []);

  const handleVolume = useCallback((e) => {
    const next = parseFloat(e.target.value);
    setVolumeState(next);
    setVolume(next);
  }, []);

  const selectSection = useCallback(
    (id) => {
      playSFX('select');
      setActiveSection(id);
    },
    []
  );

  const closeSection = useCallback(() => {
    playSFX('back');
    setActiveSection(null);
  }, []);

  const step = useCallback(
    (direction) => {
      playSFX('select');
      if (activeSection) {
        const idx = sections.findIndex((s) => s.id === activeSection);
        const next = (idx + direction + sections.length) % sections.length;
        setActiveSection(sections[next].id);
      } else {
        const next = (centerIndex + direction + sections.length) % sections.length;
        setRotateCommand({ angle: sections[next].angle, at: performance.now() });
      }
    },
    [activeSection, centerIndex, sections]
  );

  const jumpTo = useCallback(
    (id, index) => {
      playSFX('select');
      if (activeSection) setActiveSection(id);
      else setRotateCommand({ angle: sections[index].angle, at: performance.now() });
    },
    [activeSection, sections]
  );

  const renderContent = useCallback(
    (section) => {
      if (section.id === 'music') return <NowPlaying />;
      const Content = section.Content;
      if (!Content) return null;
      return (
        <Content
          onDownload={() => {
            playSFX('download');
            setShowDownload(true);
          }}
          onSfx={playSFX}
        />
      );
    },
    []
  );

  if (route === 'hookloader') {
    return (
      <Suspense fallback={<div className="hl-page" />}>
        <HookloaderPage onNavigateHome={() => navigate('/')} reducedMotion={reducedMotion} />
      </Suspense>
    );
  }

  const activeTitle = activeSection
    ? sections.find((s) => s.id === activeSection)?.title
    : sections[centerIndex]?.title;

  return (
    <div className="stage">
      {showDownload && <DownloadOverlay onClose={() => setShowDownload(false)} />}

      {/* ── Splash ── */}
      <button
        type="button"
        className={`splash ${started ? 'is-hidden' : ''}`}
        onClick={handleStart}
        aria-hidden={started}
        tabIndex={started ? -1 : 0}
      >
        <img src="/icon.png" alt="" className="splash-avatar" />
        <span className="splash-cta">INITIALIZE EXPERIENCE</span>
        <span className="splash-hint">
          {isCoarse
            ? 'Tap anywhere to enter · audio reactive'
            : 'Click anywhere · loud audio and screen motion ahead'}
        </span>
      </button>

      {/* ── Intro wordmark ── */}
      {started && showTitle && (
        <div className={`title-layer ${titleFading ? 'is-fading' : ''}`}>
          <GlitchText text="ASA" className="wordmark" />
        </div>
      )}

      {/* ── Atmosphere ── */}
      {started && (
        <>
          <div className="screen-scanlines" aria-hidden="true" />
          <div className="screen-edge" aria-hidden="true" />
          <div className="screen-bloom" aria-hidden="true" />
        </>
      )}

      <Lyrics active={started} />

      {/* ── UI ── */}
      {started && (
        <div className="ui-layer">
          <div className="top-bar">
            <div className="sys-badge">
              <span className="sys-dot" aria-hidden="true" />
              <span>ASA // ONLINE</span>
            </div>

            <div className="audio-controls">
              <button
                type="button"
                className="icon-btn"
                onClick={handleMute}
                aria-pressed={muted}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  {muted ? (
                    <>
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </>
                  ) : (
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  )}
                </svg>
              </button>

              <div className="volume-wrap">
                <input
                  type="range"
                  className="volume-slider"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolume}
                  aria-label="Volume"
                  style={{ '--fill': `${volume * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* ── Navigation rail ── */}
          <div className="nav-bar">
            <button
              type="button"
              className="nav-arrow"
              onClick={() => step(-1)}
              aria-label="Previous section"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="nav-dots" role="tablist" aria-label="Sections">
              {sections.map((s, idx) => {
                const current = activeSection ? s.id === activeSection : idx === centerIndex;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={current}
                    className={`nav-dot ${current ? 'is-active' : ''}`}
                    title={s.title}
                    aria-label={s.title}
                    onClick={() => jumpTo(s.id, idx)}
                  />
                );
              })}
            </div>

            <span className="nav-label">{activeTitle || 'EXPLORE'}</span>

            <button
              type="button"
              className="nav-arrow"
              onClick={() => step(1)}
              aria-label="Next section"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {activeSection && (
            <button type="button" className="back-btn" onClick={closeSection}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              BACK TO OVERVIEW
            </button>
          )}

          {ready && !activeSection && (
            <p className="hint">
              {isCoarse ? 'Swipe to rotate · tap a card to open' : 'Scroll or ← → to rotate · click a card'}
            </p>
          )}
        </div>
      )}

      {/* ── 3D scene ── */}
      <Canvas
        camera={{ position: [0, 150, 100], fov: 60, near: 0.1, far: 500 }}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true
        }}
        dpr={quality === 'low' ? 1 : [1, 2]}
        // Render on demand is not viable here (the scene is always animating),
        // but capping DPR and skipping antialias keeps fill rate in budget.
        frameloop={started ? 'always' : 'demand'}
      >
        <color attach="background" args={['#020202']} />
        <fogExp2 attach="fog" args={['#020202', 0.015]} />

        <ambientLight intensity={0.25} />
        <directionalLight position={[0, 10, 5]} intensity={1.8} />
        <directionalLight position={[0, -10, -5]} intensity={0.9} color="#a020f0" />

        <AudioDriver />
        <ReactiveFog />
        <IntroParticles active={started} quality={quality} duration={INTRO_HOLD} />

        <Suspense fallback={null}>
          <AmbientParticles quality={quality} />
          <VoidShapes quality={quality} />
          <HeartShapes quality={quality} />
          <HorizonTrees />
          <BassShockwaves quality={quality} />
          <AudioVisualizerRing quality={quality} />
          <ReactiveFloor />

          <group ref={carouselRef}>
            {sections.map((section) => (
              <FloatingPanel
                key={section.id}
                data={section}
                activeId={activeSection}
                onSelect={selectSection}
                onHover={() => playSFX('hover')}
                playing={started}
                quality={quality}
                reducedMotion={reducedMotion}
                introDelay={CARD_DELAY}
              >
                {renderContent(section)}
              </FloatingPanel>
            ))}
          </group>

          <SceneController
            activeSection={activeSection}
            setActiveSection={setActiveSection}
            playing={started}
            carouselRef={carouselRef}
            sections={sections}
            rotateCommand={rotateCommand}
            onCenterIndexChange={setCenterIndex}
            reducedMotion={reducedMotion}
            introDuration={INTRO_HOLD}
            onPhaseChange={() => setReady(true)}
          />

          <Effects quality={quality} reducedMotion={reducedMotion} />
        </Suspense>
      </Canvas>
    </div>
  );
}
