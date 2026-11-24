/**
 * Table geometry in fixed "stage" coordinates. The stage is scaled to fit the screen,
 * so every client places seats, cards and coin stacks at the same relative positions,
 * and animations can travel between exact coordinates without measuring the DOM.
 */
export type Orientation = 'landscape' | 'portrait';

export interface Pt {
  x: number;
  y: number;
}

export interface SeatGeo {
  id: string;
  center: Pt;
  cards: [Pt, Pt];
  stack: Pt;
  plate: Pt;
  /** Which side of the cards the coin stack sits on */
  side: -1 | 1;
}

export interface TableLayout {
  orientation: Orientation;
  w: number;
  h: number;
  table: { cx: number; cy: number; rx: number; ry: number };
  oppCardW: number;
  myCardW: number;
  seats: Record<string, SeatGeo>;
  me: SeatGeo & { id: string };
  deck: Pt;
  treasury: Pt;
  center: Pt;
}

const CFG = {
  landscape: {
    w: 1600,
    h: 830,
    table: { cx: 800, cy: 395, rx: 720, ry: 345 },
    seat: { rx: 600, ry: 292 },
    oppCardW: 76,
    myCardW: 150,
    me: { y: 650, stackDx: -215, plateDx: 230 },
    deck: { x: 700, y: 385 },
    treasury: { x: 890, y: 395 },
  },
  portrait: {
    w: 900,
    h: 1320,
    table: { cx: 450, cy: 640, rx: 430, ry: 620 },
    seat: { rx: 300, ry: 455 },
    oppCardW: 92,
    myCardW: 190,
    me: { y: 1075, stackDx: -265, plateDx: 0 },
    deck: { x: 365, y: 640 },
    treasury: { x: 545, y: 650 },
  },
} as const;

/**
 * @param ids player ids starting with the local player, then clockwise.
 */
export function computeLayout(orientation: Orientation, ids: string[]): TableLayout {
  const c = CFG[orientation];
  const { cx, cy } = c.table;
  const n = Math.max(1, ids.length);
  const seats: Record<string, SeatGeo> = {};
  const cw = c.oppCardW;
  const gap = cw * 0.56;

  ids.forEach((id, k) => {
    if (k === 0) return;
    // Local player at the bottom (90°); others evenly spaced clockwise (screen y points down).
    const ang = ((90 + (k * 360) / n) * Math.PI) / 180;
    const x = cx + Math.cos(ang) * c.seat.rx;
    const y = cy + Math.sin(ang) * c.seat.ry;
    const side: -1 | 1 = x < cx - 20 ? 1 : x > cx + 20 ? -1 : 1;
    seats[id] = {
      id,
      center: { x, y },
      cards: [
        { x: x - gap, y },
        { x: x + gap, y },
      ],
      stack: { x: x + side * (cw * 1.45), y: y + cw * 0.2 },
      plate: { x, y: y + cw * 1.02 },
      side,
    };
  });

  const myGap = c.myCardW * 0.56;
  const meY = c.me.y;
  const me = {
    id: ids[0] ?? '',
    center: { x: cx, y: meY },
    cards: [
      { x: cx - myGap, y: meY },
      { x: cx + myGap, y: meY },
    ] as [Pt, Pt],
    stack: { x: cx + c.me.stackDx, y: meY + 30 },
    plate: c.me.plateDx ? { x: cx + c.me.plateDx, y: meY + 10 } : { x: cx, y: meY + c.myCardW * 0.625 + 40 },
    side: -1 as const,
  };
  if (ids[0]) seats[ids[0]] = me;

  return {
    orientation,
    w: c.w,
    h: c.h,
    table: { ...c.table },
    oppCardW: c.oppCardW,
    myCardW: c.myCardW,
    seats,
    me,
    deck: { ...c.deck },
    treasury: { ...c.treasury },
    center: { x: cx, y: cy },
  };
}

/** Where coins land for an anchor ('treasury' or a player id). */
export function coinPoint(l: TableLayout, anchor: string): Pt {
  if (anchor === 'treasury') return l.treasury;
  return l.seats[anchor]?.stack ?? l.center;
}

/** Where a card goes for an anchor ('deck', '<pid>' or '<pid>:<slot>'). */
export function cardPoint(l: TableLayout, anchor: string): Pt {
  if (anchor === 'deck') return l.deck;
  const [pid, slot] = anchor.split(':');
  const s = l.seats[pid!];
  if (!s) return l.center;
  if (slot === undefined) return s.center;
  return s.cards[Number(slot) === 1 ? 1 : 0];
}

export function cardWidthFor(l: TableLayout, anchor: string): number {
  const pid = anchor.split(':')[0];
  return pid === l.me.id ? l.myCardW : l.oppCardW;
}
