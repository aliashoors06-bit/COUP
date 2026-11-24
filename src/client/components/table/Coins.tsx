import { memo } from 'react';
import { cls } from '../../lib/util';

/** Deterministic pseudo-random in [0,1) from an integer — keeps piles stable between renders. */
function rand(i: number, salt = 0) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** A player's physical coin stack: angled coins piled in up to two columns, with a count. */
export const CoinStack = memo(function CoinStack({ count, size, x, y, label = true, dim }: { count: number; size: number; x: number; y: number; label?: boolean; dim?: boolean }) {
  const shown = Math.min(count, 24);
  const perCol = 12;
  const step = size * 0.13;
  const coins = Array.from({ length: shown }, (_, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    return {
      i,
      left: col * size * 0.62 + (rand(i, 1) - 0.5) * size * 0.08,
      bottom: row * step,
      rot: (rand(i, 2) - 0.5) * 10,
    };
  });
  const cols = Math.max(1, Math.ceil(shown / perCol));
  const width = size + (cols - 1) * size * 0.62;
  return (
    <div
      className={cls('pointer-events-none absolute', dim && 'opacity-60 grayscale')}
      style={{ left: x - width / 2, top: y - size / 2, width, height: size }}
      aria-hidden
    >
      {/* soft contact shadow on the felt */}
      <div className="absolute rounded-[50%] bg-black/45 blur-[6px]" style={{ left: -size * 0.1, right: -size * 0.1, bottom: -size * 0.18, height: size * 0.45 }} />
      {coins.map((c) => (
        <img
          key={c.i}
          src="/assets/coins/coin-angle.png"
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{ width: size, left: c.left, bottom: c.bottom, transform: `rotate(${c.rot}deg)`, filter: 'drop-shadow(0 2px 1.5px rgba(0,0,0,.55))' }}
        />
      ))}
      {label && (
        <div
          className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-2 font-display font-bold tabular-nums text-ivory shadow"
          style={{ top: size * 1.02, fontSize: Math.max(13, size * 0.36), lineHeight: 1.35, boxShadow: '0 0 0 1px rgba(201,204,211,.35)' }}
        >
          {count}
        </div>
      )}
    </div>
  );
});

/** The central treasury: coins lying scattered on the felt. */
export const TreasuryPile = memo(function TreasuryPile({ count, x, y, size, spread }: { count: number; x: number; y: number; size: number; spread: number }) {
  const coins = Array.from({ length: Math.min(count, 50) }, (_, i) => {
    // Sunflower spiral packing with jitter → a natural pile, denser at the centre.
    const r = Math.sqrt((i + 0.5) / 50) * spread;
    const a = i * 2.399963 + rand(i, 3) * 0.6;
    return {
      i,
      dx: Math.cos(a) * r + (rand(i, 4) - 0.5) * size * 0.3,
      dy: Math.sin(a) * r * 0.62 + (rand(i, 5) - 0.5) * size * 0.2,
      rot: rand(i, 6) * 360,
      back: rand(i, 7) < 0.35,
      tilt: 0.78 + rand(i, 8) * 0.22,
    };
  });
  // Coins further back are drawn first.
  coins.sort((a, b) => a.dy - b.dy);
  return (
    <div className="pointer-events-none absolute" style={{ left: x, top: y }} aria-hidden>
      <div className="absolute rounded-[50%] bg-black/35 blur-xl" style={{ left: -spread * 1.15, top: -spread * 0.6, width: spread * 2.3, height: spread * 1.3 }} />
      {coins.map((c) => (
        <img
          key={c.i}
          src={c.back ? '/assets/coins/coin-back.png' : '/assets/coins/coin-front.png'}
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{
            width: size,
            left: c.dx - size / 2,
            top: c.dy - size / 2,
            transform: `rotate(${c.rot}deg) scaleY(${c.tilt})`,
            filter: 'drop-shadow(0 3px 2px rgba(0,0,0,.6))',
          }}
        />
      ))}
    </div>
  );
});
