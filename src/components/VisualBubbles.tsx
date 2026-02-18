import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { FileSearch, FileText, Fingerprint, Scale, ShieldCheck } from 'lucide-react';

type BubbleConfig = {
  id: string;
  radius: number;
  icon: ComponentType<{ className?: string }>;
};

type BubbleState = BubbleConfig & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  burstUntil: number;
  respawnAt: number;
};

const BUBBLES: BubbleConfig[] = [
  { id: 'b1', radius: 34, icon: Scale },
  { id: 'b2', radius: 32, icon: ShieldCheck },
  { id: 'b3', radius: 33, icon: FileSearch },
  { id: 'b4', radius: 32, icon: Fingerprint },
  { id: 'b5', radius: 29, icon: FileText },
  { id: 'b6', radius: 29, icon: Scale },
  { id: 'b7', radius: 31, icon: ShieldCheck },
  { id: 'b8', radius: 30, icon: FileSearch },
];

const SPEED_MIN = 220;
const SPEED_MAX = 360;
const BURST_MS = 260;
const REFORM_MS = 920;

const randomSpeed = () => SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);

const randomVelocity = () => {
  const angle = Math.random() * Math.PI * 2;
  const speed = randomSpeed();
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  };
};

const randomPosition = (radius: number, width: number, height: number) => {
  const minX = radius + 8;
  const maxX = Math.max(minX + 1, width - radius - 8);
  const minY = radius + 8;
  const maxY = Math.max(minY + 1, height - radius - 8);

  return {
    x: minX + Math.random() * (maxX - minX),
    y: minY + Math.random() * (maxY - minY),
  };
};

const isInsideObstacle = (x: number, y: number, r: number, obstacle: DOMRect | null) => {
  if (!obstacle) return false;

  return (
    x + r > obstacle.left &&
    x - r < obstacle.right &&
    y + r > obstacle.top &&
    y - r < obstacle.bottom
  );
};

const createBubbleState = (bubble: BubbleConfig, width: number, height: number, obstacle: DOMRect | null): BubbleState => {
  let pos = randomPosition(bubble.radius, width, height);
  let safety = 0;

  while (isInsideObstacle(pos.x, pos.y, bubble.radius, obstacle) && safety < 20) {
    pos = randomPosition(bubble.radius, width, height);
    safety += 1;
  }

  const velocity = randomVelocity();
  return {
    ...bubble,
    x: pos.x,
    y: pos.y,
    vx: velocity.vx,
    vy: velocity.vy,
    burstUntil: 0,
    respawnAt: 0,
  };
};

const VisualBubbles = () => {
  const [bubbles, setBubbles] = useState<BubbleState[]>([]);
  const bubblesRef = useRef<BubbleState[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  const bubbleConfigs = useMemo(() => BUBBLES, []);

  const burstBubble = (id: string, now: number) => {
    const next = bubblesRef.current.map((bubble) => {
      if (bubble.id !== id) return bubble;
      return {
        ...bubble,
        burstUntil: now + BURST_MS,
        respawnAt: now + REFORM_MS,
      };
    });

    bubblesRef.current = next;
    setBubbles(next);
  };

  useEffect(() => {
    const setup = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const obstacle = document.querySelector<HTMLElement>('[data-bubble-obstacle]')?.getBoundingClientRect() ?? null;
      const initial = bubbleConfigs.map((bubble) => createBubbleState(bubble, width, height, obstacle));
      bubblesRef.current = initial;
      setBubbles(initial);
    };

    setup();

    const onResize = () => setup();
    window.addEventListener('resize', onResize);

    const tick = (ts: number) => {
      const previousTs = lastTsRef.current || ts;
      const dt = Math.min((ts - previousTs) / 1000, 0.04);
      lastTsRef.current = ts;

      const width = window.innerWidth;
      const height = window.innerHeight;
      const obstacle = document.querySelector<HTMLElement>('[data-bubble-obstacle]')?.getBoundingClientRect() ?? null;
      const now = performance.now();

      const moved = bubblesRef.current.map((bubble) => {
        if (now < bubble.respawnAt) {
          return bubble;
        }

        if (bubble.respawnAt > 0 && now >= bubble.respawnAt) {
          return createBubbleState({ id: bubble.id, radius: bubble.radius, icon: bubble.icon }, width, height, obstacle);
        }

        let nextX = bubble.x + bubble.vx * dt;
        let nextY = bubble.y + bubble.vy * dt;
        let nextVx = bubble.vx;
        let nextVy = bubble.vy;

        if (nextX - bubble.radius <= 0 || nextX + bubble.radius >= width) {
          nextVx *= -1;
          nextX = Math.max(bubble.radius + 2, Math.min(width - bubble.radius - 2, nextX));
        }

        if (nextY - bubble.radius <= 0 || nextY + bubble.radius >= height) {
          nextVy *= -1;
          nextY = Math.max(bubble.radius + 2, Math.min(height - bubble.radius - 2, nextY));
        }

        if (isInsideObstacle(nextX, nextY, bubble.radius, obstacle)) {
          return {
            ...bubble,
            x: nextX,
            y: nextY,
            vx: nextVx,
            vy: nextVy,
            burstUntil: now + BURST_MS,
            respawnAt: now + REFORM_MS,
          };
        }

        return {
          ...bubble,
          x: nextX,
          y: nextY,
          vx: nextVx,
          vy: nextVy,
        };
      });

      for (let i = 0; i < moved.length; i += 1) {
        for (let j = i + 1; j < moved.length; j += 1) {
          const a = moved[i];
          const b = moved[j];
          if (now < a.respawnAt || now < b.respawnAt) continue;

          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const minDist = a.radius + b.radius;
          if (dx * dx + dy * dy <= minDist * minDist) {
            moved[i] = { ...a, burstUntil: now + BURST_MS, respawnAt: now + REFORM_MS };
            moved[j] = { ...b, burstUntil: now + BURST_MS, respawnAt: now + REFORM_MS };
          }
        }
      }

      bubblesRef.current = moved;
      setBubbles(moved);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [bubbleConfigs]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {bubbles.map((bubble) => {
        const Icon = bubble.icon;
        const isBursting = performance.now() < bubble.burstUntil;
        const isHidden = performance.now() < bubble.respawnAt;

        return (
          <button
            key={bubble.id}
            type="button"
            aria-label="Burst background bubble"
            onClick={() => burstBubble(bubble.id, performance.now())}
            className={`bubble-node ${isBursting ? 'bubble-burst' : ''} ${isHidden ? 'bubble-hidden' : ''}`}
            style={{
              width: `${bubble.radius * 2}px`,
              height: `${bubble.radius * 2}px`,
              left: `${bubble.x - bubble.radius}px`,
              top: `${bubble.y - bubble.radius}px`,
            }}
          >
            <Icon className="h-7 w-7 text-green-200/90" />
          </button>
        );
      })}
    </div>
  );
};

export default VisualBubbles;
