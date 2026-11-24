import type { ActionType } from '../../../shared/constants';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** Octagonal coin glyph matching the game's coin shape. */
function Oct({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 8) * (2 * i + 1);
    return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
  }).join(' ');
  return <polygon points={pts} {...P} />;
}

export function ActionIcon({ a, size = 20 }: { a: ActionType; size?: number }) {
  const svg = (children: React.ReactNode) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {children}
    </svg>
  );
  switch (a) {
    case 'income':
      return svg(
        <>
          <Oct cx={12} cy={12} r={8} />
          <path d="M12 8v8" {...P} />
        </>,
      );
    case 'foreign_aid':
      return svg(
        <>
          <Oct cx={9} cy={13} r={6.5} />
          <Oct cx={15.5} cy={9} r={6.5} />
        </>,
      );
    case 'tax':
      return svg(<path d="M3 18h18M4 18 5.5 8l4.5 4 2-6 2 6 4.5-4L20 18" {...P} />);
    case 'steal':
      return svg(
        <>
          <path d="M7 4v9a5 5 0 0 0 10 0V9" {...P} />
          <path d="m14 12 3-3 3 3" {...P} />
        </>,
      );
    case 'exchange':
      return svg(
        <>
          <path d="M4 8h13l-3-3M20 16H7l3 3" {...P} />
        </>,
      );
    case 'assassinate':
      return svg(
        <>
          <path d="M14.5 3.5 20.5 9.5 10 20l-4-2-2-4z" {...P} />
          <path d="m4 20 3-3M13 11l-2 2" {...P} />
        </>,
      );
    case 'coup':
      return svg(
        <>
          <path d="M12 2.5 14 8l5.5-1.5L16 11l4.5 3.5L15 15l.5 6L12 16.5 8.5 21l.5-6-5.5-.5L8 11 4.5 6.5 10 8z" {...P} />
        </>,
      );
  }
}
