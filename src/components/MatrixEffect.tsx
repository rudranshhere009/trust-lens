import React, { useRef, useEffect, useCallback, useState } from 'react';

const MatrixEffect: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number | null>(null);
  const [animationPhase, setAnimationPhase] = useState('initial'); // initial, slideDown, slideRightToLeft, slideLeftToRight, complete
  const [offsetY, setOffsetY] = useState(-window.innerHeight); // Start off-screen above
  const [offsetX, setOffsetX] = useState(0);

  const resizeCanvas = useCallback((canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const drawMatrix = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const font_size = 16;
    const columns = canvas.width / font_size;
    const drops: number[] = [];

    for (let x = 0; x < columns; x++) {
      drops[x] = 1;
    }

    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas for translation
      ctx.save(); // Save current canvas state
      ctx.translate(offsetX, offsetY); // Apply translation

      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(-offsetX, -offsetY, canvas.width, canvas.height); // Fill background considering offset

      ctx.fillStyle = '#0F0'; // Green text
      ctx.font = `${font_size}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = characters.charAt(Math.floor(Math.random() * characters.length));
        ctx.fillText(text, i * font_size, drops[i] * font_size);

        if (drops[i] * font_size > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      ctx.restore(); // Restore canvas state
      animationFrameId.current = requestAnimationFrame(render);
    };

    render();
  }, [offsetX, offsetY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      resizeCanvas(canvas, ctx);
      // Reset offsets on resize to avoid weird behavior
      setOffsetY(animationPhase === 'initial' ? -window.innerHeight : 0);
      setOffsetX(0);
    };

    resizeCanvas(canvas, ctx);
    drawMatrix();

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [resizeCanvas, drawMatrix, animationPhase]);

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const animate = async () => {
      // Phase 1: Slide Down
      setAnimationPhase('slideDown');
      let currentY = -window.innerHeight;
      while (currentY < 0) {
        currentY = Math.min(0, currentY + 10); // Adjust speed as needed
        setOffsetY(currentY);
        await new Promise(resolve => setTimeout(resolve, 16)); // ~60fps
      }
      setOffsetY(0);

      timeout = setTimeout(() => {
        // Phase 2: Slide Right to Left
        setAnimationPhase('slideRightToLeft');
        let currentX = 0;
        const targetX = -window.innerWidth / 2; // Slide halfway to the left
        const slideSpeed = 5; // Adjust speed
        const interval = setInterval(() => {
          if (currentX > targetX) {
            currentX -= slideSpeed;
            setOffsetX(currentX);
          } else {
            clearInterval(interval);
            timeout = setTimeout(() => {
              // Phase 3: Slide Left to Right
              setAnimationPhase('slideLeftToRight');
              const targetX2 = window.innerWidth / 2; // Slide halfway to the right
              const interval2 = setInterval(() => {
                if (currentX < targetX2) {
                  currentX += slideSpeed;
                  setOffsetX(currentX);
                } else {
                  clearInterval(interval2);
                  setAnimationPhase('complete');
                  setOffsetX(0); // Reset for potential re-render or static state
                }
              }, 16);
            }, 1000); // Delay before sliding left to right
          }
        }, 16);
      }, 2000); // Delay before sliding right to left
    };

    animate();

    return () => {
      clearTimeout(timeout);
    };
  }, []); // Run once on mount

  return <canvas ref={canvasRef} className="absolute inset-0 z-0" />;
};

export default MatrixEffect;
