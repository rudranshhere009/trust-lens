import React, { useRef, useEffect } from 'react';

const MatrixBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastFrameTime = 0;
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+-=';
    const fontSize = 18;
    const targetFps = 24;
    const frameDuration = 1000 / targetFps;
    let drops: number[] = [];

    const resetDrops = () => {
      const columns = Math.floor(canvas.width / fontSize);
      drops = Array.from({ length: columns }, () => 1);
    };

    resetDrops();

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#16f55a';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = charSet.charAt(Math.floor(Math.random() * charSet.length));
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }

    };

    const animate = (timestamp: number) => {
      if (timestamp - lastFrameTime >= frameDuration) {
        draw();
        lastFrameTime = timestamp;
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    const resizeAndReset = () => {
      resizeCanvas();
      resetDrops();
    };

    window.addEventListener('resize', resizeAndReset);
    resizeAndReset();
    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeAndReset);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, zIndex: -1, width: '100%', height: '100%', backgroundColor: '#000' }} />;
};

export default MatrixBackground;
