import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import type { PrivateState } from '../../../shared/types';
import type { TableLayout } from '../../lib/tableLayout';
import { useTableFx } from '../../lib/tableFx';
import { GameCard } from '../GameCard';
import { Pill } from './Dock';

const NOISE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** The oval casino table: lacquered rim, gold piping, textured felt and Art Deco inlays. */
export function TableSurface({ layout }: { layout: TableLayout }) {
  const { cx, cy, rx, ry } = layout.table;
  const rim = layout.orientation === 'portrait' ? 34 : 30;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {/* floor shadow */}
      <div className="absolute rounded-[50%] bg-black/70 blur-3xl" style={{ left: cx - rx - 10, top: cy - ry + 40, width: (rx + 10) * 2, height: (ry + 10) * 2 }} />
      {/* rim */}
      <div
        className="absolute rounded-[50%]"
        style={{
          left: cx - rx,
          top: cy - ry,
          width: rx * 2,
          height: ry * 2,
          background: 'radial-gradient(ellipse at 50% 30%, #3a2d24 0%, #1d1511 55%, #0e0a08 100%)',
          boxShadow: '0 0 0 2px #6b5636, inset 0 2px 0 rgba(255,255,255,.12), inset 0 -10px 30px rgba(0,0,0,.6), 0 30px 60px rgba(0,0,0,.6)',
        }}
      />
      {/* gold piping */}
      <div
        className="absolute rounded-[50%]"
        style={{ left: cx - rx + rim - 5, top: cy - ry + rim - 5, width: (rx - rim + 5) * 2, height: (ry - rim + 5) * 2, background: 'linear-gradient(180deg,#f0dcaa,#a68b5b 50%,#6b5636)' }}
      />
      {/* felt */}
      <div
        className="absolute overflow-hidden rounded-[50%]"
        style={{
          left: cx - rx + rim,
          top: cy - ry + rim,
          width: (rx - rim) * 2,
          height: (ry - rim) * 2,
          background: 'radial-gradient(ellipse at 50% 42%, #1d5a48 0%, #134235 45%, #0b2a22 80%, #071b16 100%)',
          boxShadow: 'inset 0 0 80px rgba(0,0,0,.65), inset 0 0 0 1px rgba(0,0,0,.6)',
        }}
      >
        <div className="absolute inset-0 opacity-[.08] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
        {/* overhead lamp */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 55% 45% at 50% 40%, rgba(255,236,190,.10), transparent 70%)' }} />
      </div>
      {/* Art Deco inlays */}
      <svg className="absolute inset-0" width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`}>
        <ellipse cx={cx} cy={cy} rx={rx - rim - 26} ry={ry - rim - 26} fill="none" stroke="rgba(214,190,140,.28)" strokeWidth="1.5" />
        <ellipse cx={cx} cy={cy} rx={rx - rim - 34} ry={ry - rim - 34} fill="none" stroke="rgba(214,190,140,.14)" strokeWidth="1" strokeDasharray="2 8" />
        <ellipse cx={cx} cy={cy} rx={rx * 0.3} ry={ry * 0.3} fill="none" stroke="rgba(214,190,140,.16)" strokeWidth="1.2" />
        {Array.from({ length: 32 }).map((_, i) => {
          const a = (i / 32) * Math.PI * 2;
          const r1 = 0.32;
          const r2 = i % 2 ? 0.4 : 0.47;
          return (
            <line
              key={i}
              x1={cx + Math.cos(a) * rx * r1}
              y1={cy + Math.sin(a) * ry * r1}
              x2={cx + Math.cos(a) * rx * r2}
              y2={cy + Math.sin(a) * ry * r2}
              stroke="rgba(214,190,140,.10)"
              strokeWidth={i % 2 ? 1 : 2}
            />
          );
        })}
        {[0, 1, 2, 3].map((k) => {
          // diamond studs on the inner rule
          const a = (k * Math.PI) / 2;
          const x = cx + Math.cos(a) * (rx - rim - 26);
          const y = cy + Math.sin(a) * (ry - rim - 26);
          return <rect key={k} x={x - 5} y={y - 5} width={10} height={10} transform={`rotate(45 ${x} ${y})`} fill="#d6be8c" opacity={0.55} />;
        })}
      </svg>
    </div>
  );
}

export function CourtDeck({ layout, count }: { layout: TableLayout; count: number }) {
  const w = layout.oppCardW;
  return (
    <div className="pointer-events-none absolute" style={{ left: layout.deck.x - w / 2, top: layout.deck.y - w * 0.625 }} aria-label={`Court Deck, ${count} cards`} role="img">
      {Array.from({ length: Math.max(1, Math.min(count, 5)) }).map((_, i) => (
        <div key={i} className="absolute" style={{ left: -i * 1.5, top: -i * 2.2, filter: i === 0 ? 'drop-shadow(0 10px 10px rgba(0,0,0,.6))' : undefined, opacity: count === 0 ? 0.2 : 1 }}>
          <GameCard role={null} width={w} />
        </div>
      ))}
      <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-display text-[13px] uppercase tracking-[0.25em] text-ivory/55" style={{ top: w * 1.32 }}>
        Deck · {count}
      </div>
    </div>
  );
}

export function TableRibbon({ layout }: { layout: TableLayout }) {
  const ribbon = useTableFx((s) => s.ribbon);
  const tones = {
    red: 'from-transparent via-[#4d070d]/95 to-transparent text-[#ffd4d8]',
    gold: 'from-transparent via-[#2a2213]/95 to-transparent text-[#ecd9ab]',
    silver: 'from-transparent via-[#24262b]/95 to-transparent text-[#e6e8ec]',
    teal: 'from-transparent via-[#0c343a]/95 to-transparent text-[#c4f1f6]',
  };
  const y = layout.orientation === 'portrait' ? layout.center.y - 230 : layout.center.y - 150;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center" style={{ top: y }} aria-live="assertive">
      <AnimatePresence>
        {ribbon && (
          <motion.div
            key={ribbon.id}
            initial={{ opacity: 0, scaleX: 0.4 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22 }}
            className={`relative bg-gradient-to-r ${tones[ribbon.tone]} px-10 py-2 text-center`}
            style={{ width: Math.min(layout.w - 80, 900) }}
          >
            <div className="absolute inset-x-[10%] top-0 h-px bg-gradient-to-r from-transparent via-[#d6be8c] to-transparent" />
            <div className="absolute inset-x-[10%] bottom-0 h-px bg-gradient-to-r from-transparent via-[#d6be8c] to-transparent" />
            <div className="whitespace-nowrap font-deco uppercase tracking-[0.22em] drop-shadow-[0_2px_2px_rgba(0,0,0,.8)]" style={{ fontSize: layout.orientation === 'portrait' ? 50 : 40 }}>
              {ribbon.title}
            </div>
            {ribbon.sub && <div className="font-display font-semibold tracking-wide" style={{ fontSize: layout.orientation === 'portrait' ? 24 : 18 }}>{ribbon.sub}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Ambassador exchange shown on the felt (no pop-up): pick which cards to keep. */
export function ExchangeTray({ layout, priv, send }: { layout: TableLayout; priv: PrivateState; send: (c: { type: 'exchange'; keep: string[] }) => Promise<{ ok: boolean }> }) {
  const options = priv.exchangeOptions ?? [];
  const keepN = priv.hand.filter((s) => !s.revealed).length;
  const mine = priv.hand.filter((s) => !s.revealed).map((s) => s.card.id);
  const [keep, setKeep] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const w = layout.orientation === 'portrait' ? 150 : 118;
  const toggle = (id: string) => setKeep((k) => (k.includes(id) ? k.filter((x) => x !== id) : k.length < keepN ? [...k, id] : [...k.slice(1), id]));
  const submit = async (ids: string[]) => {
    setBusy(true);
    const r = await send({ type: 'exchange', keep: ids });
    if (!r.ok) setBusy(false);
  };
  const y = layout.center.y - (layout.orientation === 'portrait' ? 40 : 10);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="absolute z-30 flex flex-col items-center"
      style={{ left: layout.center.x, top: y, transform: 'translate(-50%, -50%)' }}
      role="group"
      aria-label="Ambassador exchange: choose cards to keep"
    >
      <div className="absolute -inset-x-16 -inset-y-10 rounded-[50%] bg-black/55 blur-md" />
      <div className="relative mb-3 font-display font-bold uppercase tracking-[0.2em] text-champagne" style={{ fontSize: layout.orientation === 'portrait' ? 26 : 18 }}>
        Keep {keepN} · return the rest
      </div>
      <div className="relative flex gap-4">
        {options.map((c, i) => (
          <motion.div key={c.id} initial={{ y: -30, opacity: 0, rotate: -6 }} animate={{ y: keep.includes(c.id) ? -14 : 0, opacity: 1, rotate: 0 }} transition={{ delay: i * 0.06 }}>
            <GameCard role={c.role} width={w} selected={keep.includes(c.id)} dim={keep.length === keepN && !keep.includes(c.id)} onClick={() => toggle(c.id)} badge={mine.includes(c.id) ? 'Yours' : 'Drawn'} />
          </motion.div>
        ))}
      </div>
      <div className="relative mt-4 flex gap-3" style={{ transform: `scale(${layout.orientation === 'portrait' ? 1.5 : 1.15})` }}>
        <Pill disabled={busy} onClick={() => submit(mine)}>
          Keep mine
        </Pill>
        <Pill tone="gold" disabled={busy || keep.length !== keepN} onClick={() => submit(keep)}>
          Confirm {keep.length}/{keepN}
        </Pill>
      </div>
    </motion.div>
  );
}
