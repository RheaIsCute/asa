import { useState, useRef, useEffect, useCallback } from 'react';
import { playSFX } from './audio.js';
import { Icon, VIRUSTOTAL_URL } from './sections.jsx';

// ═══════════════════════════════════════════════════════════
// AMBIENT PARTICLE FIELD
//
// A spatial hash keeps link-drawing near O(n) instead of O(n²), and the
// canvas is sized to the device pixel ratio so lines stay crisp.
// ═══════════════════════════════════════════════════════════

const LINK_DIST = 110;

const CyberCanvas = ({ reducedMotion }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];
    const mouse = { x: -9999, y: -9999 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = width < 768 ? 32 : 64;
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.55,
        vy: (Math.random() - 0.5) * 0.55,
        radius: Math.random() * 1.6 + 0.8,
        cyan: Math.random() > 0.5,
        alpha: Math.random() * 0.5 + 0.25
      }));
    };

    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onMouseLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseout', onMouseLeave, { passive: true });

    // Static grid is redrawn each frame but with one path per axis rather
    // than one stroke() call per line — far fewer draw calls.
    const drawGrid = () => {
      const gridSize = 45;
      ctx.strokeStyle = 'rgba(160, 32, 240, 0.045)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    };

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      drawGrid();

      const cell = LINK_DIST;
      const cols = Math.max(1, Math.ceil(width / cell));
      const buckets = new Map();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x += width;
        else if (p.x > width) p.x -= width;
        if (p.y < 0) p.y += height;
        else if (p.y > height) p.y -= height;

        // Soft repulsion from the cursor.
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 10000 && distSq > 0.01) {
          const dist = Math.sqrt(distSq);
          p.x += (dx / dist) * 1.4;
          p.y += (dy / dist) * 1.4;
        }

        const key = Math.floor(p.y / cell) * cols + Math.floor(p.x / cell);
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, (bucket = []));
        bucket.push(i);
      }

      // ── Links: one batched path, neighbours only ──
      ctx.strokeStyle = 'rgba(160, 32, 240, 0.16)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const cx = Math.floor(p.x / cell);
        const cy = Math.floor(p.y / cell);
        for (let ox = 0; ox <= 1; ox++) {
          for (let oy = ox === 0 ? 0 : -1; oy <= 1; oy++) {
            const bucket = buckets.get((cy + oy) * cols + (cx + ox));
            if (!bucket) continue;
            for (let k = 0; k < bucket.length; k++) {
              const j = bucket[k];
              if (j <= i) continue;
              const q = particles[j];
              const dx = p.x - q.x;
              const dy = p.y - q.y;
              if (dx * dx + dy * dy < LINK_DIST * LINK_DIST) {
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(q.x, q.y);
              }
            }
          }
        }
      }
      ctx.stroke();

      // ── Dots: grouped by colour so shadowBlur is set twice, not 64 times ──
      for (let pass = 0; pass < 2; pass++) {
        const color = pass === 0 ? '#a020f0' : '#00f0ff';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          if ((pass === 1) !== p.cyan) continue;
          ctx.moveTo(p.x + p.radius, p.y);
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        }
        ctx.globalAlpha = 0.55;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      frame = requestAnimationFrame(render);
    };

    if (reducedMotion) {
      // Draw a single static frame rather than animating.
      ctx.clearRect(0, 0, width, height);
      drawGrid();
    } else {
      frame = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseout', onMouseLeave);
    };
  }, [reducedMotion]);

  return <canvas ref={canvasRef} className="hl-canvas" aria-hidden="true" />;
};

// ═══════════════════════════════════════════════════════════
// HOOKLOADER PAGE
// ═══════════════════════════════════════════════════════════

const STAGES = [
  { at: 20, status: 'ALLOCATING VIRTUAL MEMORY BUFFER...', log: 'BUFFER ALLOCATED: 54.6 KB (x64_PAYLOAD_ARCHIVE)' },
  { at: 50, status: 'VERIFYING ARCHIVE INTEGRITY...', log: 'SIGNATURE CHECK: VIRUSTOTAL 2/67 [VERIFIED]' },
  { at: 80, status: 'UNPACKING INJECTOR ARTIFACT...', log: 'VERIFYING SHA256: 33456b...64f3' }
];

export const HookloaderPage = ({ onNavigateHome, reducedMotion }) => {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('INITIALIZING CONNECTION...');
  const [logs, setLogs] = useState([]);
  const [copied, setCopied] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const cardRef = useRef(null);
  const logRef = useRef(null);
  const timerRef = useRef(null);
  const copyTimerRef = useRef(null);

  // Clear both timers on unmount so nothing calls setState after teardown.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  // Scroll the terminal after React commits the new line, not before.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const handleTilt = (e) => {
    if (reducedMotion || !cardRef.current || window.innerWidth < 768) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: -(y * 6), y: x * 6 });
  };

  const startDownload = useCallback(() => {
    if (timerRef.current) return;
    playSFX('download');
    setDownloading(true);
    setProgress(0);
    setLogs([{ time: new Date().toISOString().slice(11, 19), msg: 'INITIALIZING HOOKLOADER DISPATCH PROTOCOL...' }]);
    setStatus('ESTABLISHING SECURE HANDSHAKE...');

    let value = 0;
    let stage = 0;

    timerRef.current = setInterval(() => {
      value = Math.min(value + Math.random() * 14 + 8, 100);
      setProgress(value);

      if (stage < STAGES.length && value >= STAGES[stage].at) {
        const { status: s, log } = STAGES[stage];
        setStatus(s);
        setLogs((prev) => [
          ...prev.slice(-5),
          { time: new Date().toISOString().slice(11, 19), msg: log }
        ]);
        playSFX('step');
        stage++;
      }

      if (value >= 100) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        setStatus('DOWNLOAD COMPLETE // DISPATCHING ARCHIVE');
        setLogs((prev) => [
          ...prev.slice(-5),
          { time: new Date().toISOString().slice(11, 19), msg: 'HOOKLOADER.ZIP DELIVERED TO BROWSER' }
        ]);
        playSFX('complete');

        const link = document.createElement('a');
        link.href = '/hookloader.zip';
        link.download = 'hookloader.zip';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setDownloading(false);
      }
    }, 220);
  }, []);

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/hookloader` : '/hookloader';

  const copyShareLink = async () => {
    playSFX('copy');
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard can be blocked by permissions; the input stays selectable.
    }
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="hl-page">
      <CyberCanvas reducedMotion={reducedMotion} />
      <div className="hl-scanlines" aria-hidden="true" />
      <div className="hl-glow" aria-hidden="true" />

      <header className="hl-header">
        <button
          type="button"
          className="hl-back"
          onClick={() => {
            playSFX('back');
            onNavigateHome();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          BACK
        </button>
        <div className="hl-brand">
          <img src="/icon.png" alt="" className="hl-avatar" />
          <span className="hl-brand-text">ASA // VALORANT HOOKLOADER</span>
        </div>
        <div className="hl-header-spacer" />
      </header>

      <main className="hl-main">
        <div
          ref={cardRef}
          className="hl-card"
          style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
          onMouseMove={handleTilt}
          onMouseLeave={() => setTilt({ x: 0, y: 0 })}
        >
          <div className="hl-laser" aria-hidden="true" />
          <span className="hl-corner tl" aria-hidden="true" />
          <span className="hl-corner tr" aria-hidden="true" />
          <span className="hl-corner bl" aria-hidden="true" />
          <span className="hl-corner br" aria-hidden="true" />

          <div className="hl-badges">
            <span className="hl-badge verified">
              <span className="hl-radar" aria-hidden="true" />
              VIRUSTOTAL: 2/67 DETECTIONS
            </span>
            <span className="hl-badge">VALORANT HOOKLOADER</span>
          </div>

          <h1 className="hl-title">VALORANT HOOKLOADER</h1>
          <p className="hl-subtitle">Valorant Cheat Hook Loader &amp; Memory Injection Utility</p>
          <p className="hl-description">
            A hookloader designed for Valorant cheats. This project is 100% open-source &mdash;
            completely free to use, inspect, modify, and redistribute without any requirement to
            credit me.
          </p>

          {downloading && (
            <div className="hl-progress-section">
              <div className="hl-status">{status}</div>
              <div
                className="hl-progress-track"
                role="progressbar"
                aria-valuenow={Math.floor(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Download progress"
              >
                <div className="hl-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="hl-progress-meta">
                <span>PROTOCOL: TLS_AES_256</span>
                <span className="hl-percent">{Math.floor(progress)}%</span>
              </div>

              <div ref={logRef} className="hl-terminal" role="log" aria-live="polite">
                {logs.map((log, idx) => (
                  <div key={`${log.time}-${idx}`} className="hl-terminal-line">
                    <span className="hl-timestamp">[{log.time}]</span>
                    <span>{log.msg}</span>
                  </div>
                ))}
                <div className="hl-terminal-line streaming">
                  <span>&gt;&gt; STREAMING PAYLOAD BYTES...</span>
                  <span className="hl-cursor" aria-hidden="true" />
                </div>
              </div>
            </div>
          )}

          <div className="hl-actions">
            <button
              type="button"
              className="hl-download-btn"
              onClick={startDownload}
              disabled={downloading}
            >
              <Icon name="download" />
              {downloading ? 'DOWNLOADING .ZIP...' : 'DOWNLOAD .ZIP'}
            </button>

            <a
              href={VIRUSTOTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hl-vt-btn"
              onClick={() => playSFX('virustotal')}
            >
              <Icon name="shield" />
              VIEW VIRUSTOTAL SCAN (2/67 DETECTIONS)
            </a>
          </div>

          <div className="hl-specs">
            <div className="hl-spec">
              <span className="hl-spec-label">FILE NAME</span>
              <span className="hl-spec-value cyan">hookloader.zip</span>
            </div>
            <div className="hl-spec">
              <span className="hl-spec-label">FILE SIZE</span>
              <span className="hl-spec-value">54.6 KB</span>
            </div>
          </div>

          <div className="hl-share">
            <label className="hl-spec-label" htmlFor="hl-share-input">
              VALORANT HOOKLOADER DIRECT LINK
            </label>
            <div className="hl-share-row">
              <input
                id="hl-share-input"
                type="text"
                readOnly
                value={shareUrl}
                className="hl-share-input"
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="hl-copy-btn" onClick={copyShareLink}>
                {copied ? 'COPIED ✓' : 'COPY LINK'}
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="hl-footer">ASA &copy; 2026 // OPEN-SOURCE INJECTOR</footer>
    </div>
  );
};
