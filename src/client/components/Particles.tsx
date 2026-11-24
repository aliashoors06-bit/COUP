import { useEffect, useRef } from 'react';
import { useSettings } from '../lib/settings';

/** Lightweight canvas particle field (floating dust / silver sparks). */
export function Particles({ count = 60, color = '214,190,140', burst = false, className }: { count?: number; color?: string; burst?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const motion = useSettings((s) => s.motion);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || motion === 'off') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const n = motion === 'reduced' ? Math.round(count / 3) : count;
    const ps = Array.from({ length: n }, () => ({
      x: burst ? w / 2 : Math.random() * w,
      y: burst ? h / 2 : Math.random() * h,
      vx: burst ? (Math.random() - 0.5) * 6 : (Math.random() - 0.5) * 0.15,
      vy: burst ? (Math.random() - 0.8) * 6 : -0.08 - Math.random() * 0.25,
      r: 0.6 + Math.random() * 1.8,
      a: 0.2 + Math.random() * 0.6,
      tw: Math.random() * Math.PI * 2,
    }));
    let raf = 0;
    const loop = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.x += p.vx;
        p.y += p.vy;
        p.tw += 0.03;
        if (burst) {
          p.vy += 0.04;
          p.vx *= 0.99;
        }
        if (!burst) {
          if (p.y < -5) p.y = h + 5;
          if (p.x < -5) p.x = w + 5;
          if (p.x > w + 5) p.x = -5;
        } else if (p.y > h + 10) {
          p.x = w / 2 + (Math.random() - 0.5) * w * 0.4;
          p.y = h * 0.3;
          p.vx = (Math.random() - 0.5) * 6;
          p.vy = -Math.random() * 6;
        }
        const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
        ctx.beginPath();
        ctx.fillStyle = `rgba(${color},${alpha})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [count, color, burst, motion]);

  return <canvas ref={ref} aria-hidden className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'} />;
}
