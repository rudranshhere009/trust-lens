import React, { useEffect, useRef } from 'react';

type Stream = {
  y: number;
  speed: number;
  length: number;
  chars: string[];
  glitch: boolean;
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

    const fontSize = 18;
    const lineStep = 19;
    const columnGap = 21;

    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#@%&*+-=<>[]{}';
    const jpGlyphs = '!?:;~^/\\|()_.,`\'"';

    let streams: Stream[] = [];

    const random = (min: number, max: number) => min + Math.random() * (max - min);
    const randomChar = () => {
      const bank = Math.random() > 0.65 ? jpGlyphs : glyphs;
      return bank.charAt(Math.floor(Math.random() * bank.length));
    };

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const createStream = (): Stream => {
      const length = Math.floor(random(10, 22));
      return {
        y: random(-canvas.height, 0),
        speed: random(1.3, 3.5),
        length,
        chars: Array.from({ length }, () => randomChar()),
        glitch: Math.random() > 0.88,
      };
    };

    const initStreams = () => {
      const count = Math.ceil(canvas.width / columnGap);
      streams = Array.from({ length: count }, () => createStream());
    };

    const drawBackdrop = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.23)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Low-intensity phosphor haze.
      const haze = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      haze.addColorStop(0, 'rgba(24, 120, 84, 0.05)');
      haze.addColorStop(0.5, 'rgba(20, 95, 72, 0.02)');
      haze.addColorStop(1, 'rgba(12, 60, 50, 0.04)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawStreams = () => {
      ctx.font = `700 ${fontSize}px monospace`;

      for (let i = 0; i < streams.length; i++) {
        const s = streams[i];
        const baseX = i * columnGap + 3;

        for (let j = 0; j < s.length; j++) {
          const y = s.y - j * lineStep;
          if (y < -lineStep || y > canvas.height + lineStep) continue;

          const t = 1 - j / s.length;

          if (j === 0) {
            ctx.fillStyle = 'rgba(190, 248, 222, 0.9)';
          } else if (j < 3) {
            ctx.fillStyle = `rgba(104, 222, 170, ${(0.62 * t).toFixed(3)})`;
          } else {
            ctx.fillStyle = `rgba(42, 170, 120, ${(0.44 * t).toFixed(3)})`;
          }

          // Selected streams have a subtle horizontal glitch wobble.
          const wobble = s.glitch ? Math.sin((tick + i * 13 + j * 7) * 0.08) * 2.8 : 0;
          ctx.fillText(s.chars[j], baseX + wobble, y);
        }

        s.y += s.speed;

        if (Math.random() > 0.88) {
          s.chars[Math.floor(random(0, s.length))] = randomChar();
        }

        if (Math.random() > 0.996) {
          s.glitch = !s.glitch;
        }

        if (s.y - s.length * lineStep > canvas.height + 60) {
          streams[i] = createStream();
        }
      }
    };

    const drawVortexRings = () => {
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.5;

      for (let i = 0; i < 4; i++) {
        const radius = 90 + ((tick * 1.8 + i * 140) % 520);
        const alpha = Math.max(0.02, 0.16 - radius / 4200);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((tick * 0.002 + i * 0.8) % (Math.PI * 2));
        ctx.strokeStyle = `rgba(86, 210, 166, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };

    const drawScanBand = () => {
      const y = (tick * 2.25) % (canvas.height + 200) - 100;
      const scan = ctx.createLinearGradient(0, y - 45, 0, y + 45);
      scan.addColorStop(0, 'rgba(0, 0, 0, 0)');
      scan.addColorStop(0.5, 'rgba(88, 210, 166, 0.09)');
      scan.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = scan;
      ctx.fillRect(0, y - 45, canvas.width, 90);
    };

    const drawCrt = () => {
      ctx.fillStyle = 'rgba(62, 172, 132, 0.022)';
      for (let y = 0; y < canvas.height; y += 4) {
        ctx.fillRect(0, y, canvas.width, 1);
      }
    };

    const draw = () => {
      tick += 1;
      drawBackdrop();
      drawStreams();
      drawVortexRings();
      drawScanBand();
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
      initStreams();
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
