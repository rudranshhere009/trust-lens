import React, { useEffect, useRef } from 'react';

type BlockColumn = {
  y: number;
  speed: number;
  length: number;
  tokens: string[];
};

const MatrixBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId = 0;
    let lastFrame = 0;
    let tick = 0;

    const targetFps = 30;
    const frameDuration = 1000 / targetFps;

    const colGap = 30;
    const blockW = 24;
    const blockH = 16;
    const stepY = 18;

    const tokenPool = [
      '01', '10', 'FF', 'A9', '7C', 'E3', 'TX', 'RX', 'OK', 'ID', 'AI', 'VR',
      'LK', 'UN', 'SC', 'TR', 'PK', 'NM', '42', '88', '0F', 'B1'
    ];

    let columns: BlockColumn[] = [];

    const random = (min: number, max: number) => min + Math.random() * (max - min);
    const randomToken = () => tokenPool[Math.floor(Math.random() * tokenPool.length)];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const createColumn = (): BlockColumn => {
      const length = Math.floor(random(8, 16));
      return {
        y: random(-canvas.height, 0),
        speed: random(1.0, 2.8),
        length,
        tokens: Array.from({ length }, () => randomToken()),
      };
    };

    const initColumns = () => {
      const count = Math.ceil(canvas.width / colGap);
      columns = Array.from({ length: count }, () => createColumn());
    };

    const drawBackdrop = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
      ctx.fillRect(0, 0, w, h);

      const diagonal = ctx.createLinearGradient(0, 0, w, h);
      diagonal.addColorStop(0, 'rgba(24, 96, 74, 0.06)');
      diagonal.addColorStop(0.5, 'rgba(10, 40, 30, 0.02)');
      diagonal.addColorStop(1, 'rgba(24, 96, 74, 0.05)');
      ctx.fillStyle = diagonal;
      ctx.fillRect(0, 0, w, h);
    };

    const drawColumns = () => {
      ctx.font = '700 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const x = i * colGap + 3;

        for (let j = 0; j < col.length; j++) {
          const y = col.y - j * stepY;
          if (y < -20 || y > canvas.height + 20) continue;

          const trail = 1 - j / col.length;
          const isHead = j === 0;

          const blockAlpha = isHead ? 0.9 : 0.12 + 0.34 * trail;
          const borderAlpha = isHead ? 0.85 : 0.16 + 0.28 * trail;
          const textAlpha = isHead ? 0.98 : 0.22 + 0.52 * trail;

          ctx.fillStyle = `rgba(22, 126, 92, ${blockAlpha.toFixed(3)})`;
          ctx.fillRect(x, y, blockW, blockH);

          ctx.strokeStyle = `rgba(86, 218, 166, ${borderAlpha.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, blockW - 1, blockH - 1);

          ctx.fillStyle = `rgba(186, 255, 226, ${textAlpha.toFixed(3)})`;
          ctx.fillText(col.tokens[j], x + blockW * 0.5, y + blockH * 0.52);
        }

        col.y += col.speed;

        if (Math.random() > 0.9) {
          col.tokens[Math.floor(random(0, col.length))] = randomToken();
        }

        if (col.y - col.length * stepY > canvas.height + 40) {
          columns[i] = createColumn();
        }
      }
    };

    const drawDataLines = () => {
      const h = canvas.height;
      const w = canvas.width;

      for (let i = 0; i < 5; i++) {
        const y = ((tick * (1.1 + i * 0.15)) + i * 110) % (h + 80) - 40;
        const xShift = (tick * (2 + i)) % 240;

        ctx.strokeStyle = 'rgba(70, 182, 142, 0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-xShift, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    };

    const drawPulseBand = () => {
      const y = (tick * 2.2) % (canvas.height + 220) - 110;
      const g = ctx.createLinearGradient(0, y - 55, 0, y + 55);
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(0.5, 'rgba(82, 214, 164, 0.10)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 55, canvas.width, 110);
    };

    const drawNoise = () => {
      for (let i = 0; i < 70; i++) {
        if (Math.random() > 0.75) {
          const x = Math.floor(random(0, canvas.width));
          const y = Math.floor(random(0, canvas.height));
          ctx.fillStyle = 'rgba(120, 230, 184, 0.07)';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    };

    const drawCrt = () => {
      ctx.fillStyle = 'rgba(58, 168, 128, 0.022)';
      for (let y = 0; y < canvas.height; y += 4) {
        ctx.fillRect(0, y, canvas.width, 1);
      }
    };

    const draw = () => {
      tick += 1;
      drawBackdrop();
      drawDataLines();
      drawColumns();
      drawPulseBand();
      drawNoise();
      drawCrt();
    };

    const animate = (timestamp: number) => {
      if (timestamp - lastFrame >= frameDuration) {
        draw();
        lastFrame = timestamp;
      }
      frameId = requestAnimationFrame(animate);
    };

    const onResize = () => {
      resize();
      initColumns();
    };

    window.addEventListener('resize', onResize);
    onResize();
    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
        backgroundColor: '#000',
        pointerEvents: 'none',
      }}
    />
  );
};

export default MatrixBackground;
