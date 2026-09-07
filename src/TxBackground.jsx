import { useEffect, useRef } from 'react';

const GLYPHS = '0123456789abcdef';

/**
 * Ambient backdrop for the receipt route: three drifting aurora blobs (CSS),
 * plus a canvas layer of slow hex glyph columns and a pointer-reactive
 * constellation. Purely decorative and skipped entirely under reduced motion.
 */
export default function TxBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse), (max-width: 700px)').matches) return undefined;

    let width = 0;
    let height = 0;
    let columns = [];
    let nodes = [];
    let frame = 0;
    let last = 0;
    const pointer = { x: -9999, y: -9999 };

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const spacing = 34;
      columns = Array.from({ length: Math.ceil(width / spacing) }, (_, i) => ({
        x: i * spacing + spacing / 2,
        y: Math.random() * -height,
        speed: 14 + Math.random() * 26,
        glyph: GLYPHS[Math.floor(Math.random() * 16)],
        life: 0,
      }));

      const count = Math.min(70, Math.round((width * height) / 24000));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.5,
      }));
    };

    const draw = (now) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, width, height);

      // hex rain
      ctx.font = '11px "Space Mono", monospace';
      for (const column of columns) {
        column.y += column.speed * delta;
        column.life += delta;
        if (column.life > 0.9) {
          column.life = 0;
          column.glyph = GLYPHS[Math.floor(Math.random() * 16)];
        }
        if (column.y > height + 20) {
          column.y = -20 - Math.random() * height * 0.5;
          column.speed = 14 + Math.random() * 26;
        }
        const fade = 1 - Math.abs(column.y / height - 0.5) * 1.4;
        if (fade <= 0) continue;
        ctx.fillStyle = `rgba(201,138,255,${0.16 * fade})`;
        ctx.fillText(column.glyph, column.x, column.y);
      }

      // constellation
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < -20) node.x = width + 20;
        if (node.x > width + 20) node.x = -20;
        if (node.y < -20) node.y = height + 20;
        if (node.y > height + 20) node.y = -20;

        const near = Math.hypot(node.x - pointer.x, node.y - pointer.y);
        const excited = near < 160;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + (excited ? 0.7 : 0), 0, Math.PI * 2);
        ctx.fillStyle = excited ? `rgba(189,255,102,${0.5 - near / 400})` : 'rgba(255,255,255,.14)';
        ctx.fill();
      }

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > 120) continue;
          const mid = Math.hypot((a.x + b.x) / 2 - pointer.x, (a.y + b.y) / 2 - pointer.y);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = mid < 190
            ? `rgba(201,138,255,${(1 - dist / 120) * 0.3})`
            : `rgba(255,255,255,${(1 - dist / 120) * 0.06})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      frame = window.requestAnimationFrame(draw);
    };

    const onPointer = (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };

    build();
    last = performance.now();
    frame = window.requestAnimationFrame(draw);
    window.addEventListener('resize', build);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerleave', onLeave);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', build);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div className="tx-fx" aria-hidden="true">
      <div className="tx-aurora a" />
      <div className="tx-aurora b" />
      <div className="tx-aurora c" />
      <canvas ref={canvasRef} className="tx-canvas" />
      <div className="tx-vignette" />
    </div>
  );
}
