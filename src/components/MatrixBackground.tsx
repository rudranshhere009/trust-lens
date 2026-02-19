import React, { useEffect, useRef } from 'react';

type Tile = {
  x: number;
  y: number;
  phase: number;
  pulse: number;
  flicker: number;
};

const MatrixBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    let tick = 0;

    let w = 0;
    let h = 0;
    let tiles: Tile[] = [];

    const cell = 26;
    const gap = 4;
    const step = cell + gap;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const init = () => {
      tiles = [];
      const cols = Math.ceil(w / step) + 1;
      const rows = Math.ceil(h / step) + 1;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          tiles.push({
            x: c * step,
            y: r * step,
            phase: rand(0, Math.PI * 2),
            pulse: rand(0.2, 1),
            flicker: rand(0, 1),
          });
        }
      }
    };

    const drawBackdrop = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.11)';
      ctx.fillRect(0, 0, w, h);

      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(10, 28, 22, 0.14)');
      g.addColorStop(0.5, 'rgba(5, 14, 11, 0.1)');
      g.addColorStop(1, 'rgba(10, 28, 22, 0.14)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };

    const drawTiles = (dt: number) => {
      const waveX = (tick * 40) % (w + h);

      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];

        const d = Math.abs((t.x + t.y) - waveX);
        const waveBoost = Math.max(0, 1 - d / 220);

        t.flicker += dt * 0.016;
        if (t.flicker > 1 && Math.random() > 0.9) {
          t.flicker = 0;
          t.pulse = rand(0.2, 1);
        }

        const base = 0.05 + 0.12 * (0.5 + 0.5 * Math.sin(tick * 0.03 + t.phase));
        const alpha = Math.min(0.5, base + waveBoost * 0.2 + t.pulse * 0.03);

        ctx.fillStyle = `rgba(72, 204, 162, ${alpha.toFixed(3)})`;
        ctx.fillRect(t.x, t.y, cell, cell);

        ctx.strokeStyle = `rgba(132, 242, 204, ${(alpha * 0.7).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(t.x + 0.5, t.y + 0.5, cell - 1, cell - 1);

        const innerA = alpha * 0.35;
        ctx.fillStyle = `rgba(170, 255, 226, ${innerA.toFixed(3)})`;
        ctx.fillRect(t.x + 6, t.y + 6, 6, 6);
      }
    };

    const drawWaveFront = () => {
      const p = (tick * 2.2) % (w + h + 220) - 110;
      ctx.strokeStyle = 'rgba(110, 236, 194, 0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p - h, h);
      ctx.lineTo(p, 0);
      ctx.stroke();

      const glow = ctx.createLinearGradient(p - 60, h, p + 60, 0);
      glow.addColorStop(0, 'rgba(0, 0, 0, 0)');
      glow.addColorStop(0.5, 'rgba(106, 232, 192, 0.12)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(p - h - 80, 0, 160, h);
    };

    const drawCrt = () => {
      ctx.fillStyle = 'rgba(58, 168, 130, 0.016)';
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y, w, 1);
      }
    };

    const draw = (dt: number) => {
      tick += dt;
      drawBackdrop();
      drawTiles(dt);
      drawWaveFront();
      drawCrt();
    };

    const loop = (ts: number) => {
      if (!last) last = ts;
      const dt = Math.min(2, (ts - last) / 16.67);
      last = ts;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      resize();
      init();
    };

    window.addEventListener('resize', onResize);
    onResize();
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
        opacity: 0.64,
        filter: 'blur(1.2px)',
        backgroundColor: 'transparent',
        pointerEvents: 'none',
      }}
    />
  );
};

export default MatrixBackground;
