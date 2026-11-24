import { cls } from '../../lib/util';

export function TimerRing({ remaining, duration, size = 44, urgent }: { remaining: number; duration: number; size?: number; urgent?: boolean }) {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remaining / Math.max(1, duration)));
  const warn = remaining <= 3;
  return (
    <div className="relative" style={{ width: size, height: size }} role="timer" aria-label={`${Math.ceil(remaining)} seconds left`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.12)" strokeWidth={3} fill="rgba(0,0,0,.45)" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={warn ? '#e0434b' : urgent ? '#8fe3ef' : '#d6be8c'}
          strokeWidth={3}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .2s linear' }}
        />
      </svg>
      <span className={cls('absolute inset-0 flex items-center justify-center font-display font-bold tabular-nums', warn ? 'text-[#ff7a80]' : 'text-ivory')} style={{ fontSize: size * 0.34 }}>
        {Math.ceil(remaining)}
      </span>
    </div>
  );
}
