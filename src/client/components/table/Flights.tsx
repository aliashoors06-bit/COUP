import { motion } from 'framer-motion';
import { cardImg } from '../../lib/util';
import { cardPoint, cardWidthFor, coinPoint, type TableLayout } from '../../lib/tableLayout';
import { useTableFx } from '../../lib/tableFx';

/** Coins and cards in motion, drawn in stage coordinates on top of the table. */
export function Flights({ layout, coinSize }: { layout: TableLayout; coinSize: number }) {
  const { coins, cards, now } = useTableFx();
  return (
    <div className="pointer-events-none absolute inset-0 z-30" aria-hidden>
      {coins
        .filter((f) => now >= f.start && now < f.start + f.dur)
        .map((f) => {
          const a = coinPoint(layout, f.from);
          const b = coinPoint(layout, f.to);
          const bx = b.x + f.jx;
          const by = b.y + f.jy;
          const peak = Math.min(a.y, by) - f.arc;
          const d = f.dur / 1000;
          return (
            <motion.img
              key={f.id}
              src="/assets/coins/coin-angle.png"
              alt=""
              draggable={false}
              className="absolute left-0 top-0 max-w-none"
              style={{ width: coinSize, marginLeft: -coinSize / 2, marginTop: -coinSize / 2, filter: 'drop-shadow(0 10px 6px rgba(0,0,0,.45))' }}
              initial={{ x: a.x, y: a.y, rotate: 0, scale: 0.9 }}
              animate={{
                x: [a.x, (a.x + bx) / 2, bx, bx],
                y: [a.y, peak, by - 10, by],
                rotate: [0, f.spin * 0.6, f.spin, f.spin],
                scale: [0.9, 1.25, 1, 1],
              }}
              transition={{ duration: d, times: [0, 0.48, 0.86, 1], ease: ['easeOut', 'easeIn', 'easeOut'] }}
            />
          );
        })}
      {cards
        .filter((f) => now >= f.start && now < f.start + (f.hold ?? 0) + f.dur + 40)
        .map((f) => {
          const a = cardPoint(layout, f.from);
          const b = cardPoint(layout, f.to);
          const wA = f.from === 'deck' ? layout.oppCardW : cardWidthFor(layout, f.from);
          const wB = f.to === 'deck' ? layout.oppCardW : cardWidthFor(layout, f.to);
          const hold = (f.hold ?? 0) / 1000;
          const total = hold + f.dur / 1000;
          const t1 = hold / total;
          const w = layout.oppCardW;
          return (
            <motion.div
              key={f.id}
              className="absolute left-0 top-0"
              style={{ width: w, height: w * 1.25, marginLeft: -w / 2, marginTop: -w * 0.625, filter: 'drop-shadow(0 14px 12px rgba(0,0,0,.55))' }}
              initial={{ x: a.x, y: a.y, scale: wA / w, rotate: 0 }}
              animate={
                hold
                  ? { x: [a.x, a.x, b.x], y: [a.y, a.y - 40, b.y], scale: [wA / w, (wA / w) * 1.15, wB / w], rotate: [0, 0, -10] }
                  : { x: b.x, y: b.y, scale: wB / w, rotate: [0, -8, 0] }
              }
              transition={hold ? { duration: total, times: [0, t1, 1], ease: 'easeInOut' } : { duration: f.dur / 1000, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <img src={cardImg(f.role ?? 'card-back')} alt="" draggable={false} className="h-full w-full object-contain" />
            </motion.div>
          );
        })}
    </div>
  );
}
