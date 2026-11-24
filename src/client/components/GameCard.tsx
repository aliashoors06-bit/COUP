import { motion } from 'framer-motion';
import type { Role } from '../../shared/constants';
import { ROLE_META } from '../../shared/constants';
import { cardImg, cls } from '../lib/util';
import { useSettings } from '../lib/settings';

/**
 * A character card. `role` null shows the universal card back.
 * `dead` renders a revealed/lost influence: desaturated with a cracked frame, label still readable.
 */
export function GameCard({
  role,
  dead = false,
  width = 90,
  className,
  selected,
  onClick,
  label,
  badge,
  dim,
}: {
  role: Role | null;
  dead?: boolean;
  width?: number;
  className?: string;
  selected?: boolean;
  onClick?: () => void;
  label?: string;
  badge?: string;
  dim?: boolean;
}) {
  const motionSetting = useSettings((s) => s.motion);
  const height = Math.round(width * 1.25);
  const faceUp = role !== null;
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={label ?? (role ? `${ROLE_META[role].label}${dead ? ' (revealed, lost)' : ''}` : 'Hidden card')}
      className={cls('card-3d relative shrink-0', onClick && 'cursor-pointer', className)}
      style={{ width, height }}
      whileHover={onClick && motionSetting !== 'off' ? { y: -6 } : undefined}
      whileTap={onClick ? { scale: 0.97 } : undefined}
    >
      <motion.div
        className="card-inner"
        initial={false}
        animate={{ rotateY: faceUp ? 0 : 180 }}
        transition={motionSetting === 'off' ? { duration: 0 } : { duration: 0.55, ease: [0.4, 0.1, 0.2, 1] }}
      >
        {/* Front */}
        <div className={cls('card-face', dead && 'card-dead')}>
          {role && <img className="art" src={cardImg(role)} alt="" draggable={false} />}
          {dead && role && (
            <>
              <img src="/assets/effects/crack.png" alt="" className="absolute inset-0 opacity-90" draggable={false} />
              <div className="absolute inset-x-0 bottom-[3%] flex justify-center">
                <span
                  className="rounded-sm px-2 py-0.5 font-display font-bold uppercase tracking-[0.15em] text-ivory"
                  style={{ fontSize: Math.max(9, width * 0.11), background: `${ROLE_META[role].color}ee`, boxShadow: '0 0 0 1px rgba(214,190,140,.6)' }}
                >
                  {ROLE_META[role].label}
                </span>
              </div>
            </>
          )}
        </div>
        {/* Back */}
        <div className="card-face" style={{ transform: 'rotateY(180deg)' }}>
          <img src={cardImg('card-back')} alt="" draggable={false} />
        </div>
      </motion.div>
      {selected && <div className="pointer-events-none absolute -inset-1 rounded-lg border-2 border-cyanglow shadow-glow" />}
      {dim && <div className="pointer-events-none absolute inset-0 rounded-lg bg-black/50" />}
      {badge && (
        <span className="absolute -right-2 -top-2 rounded-full border border-champagne/70 bg-midnight px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-champagne">
          {badge}
        </span>
      )}
    </Comp>
  );
}
