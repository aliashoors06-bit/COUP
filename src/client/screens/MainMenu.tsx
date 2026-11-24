import { motion } from 'framer-motion';
import { ROLES } from '../../shared/constants';
import { Particles } from '../components/Particles';
import { Button } from '../components/ui';
import { useStore } from '../lib/store';
import { useSettings } from '../lib/settings';
import { cardImg } from '../lib/util';
import { sound } from '../lib/sound';

export function MainMenu() {
  const go = useStore((s) => s.go);
  const session = useStore((s) => s.session);
  const room = useStore((s) => s.room);
  const motionSetting = useSettings((s) => s.motion);
  const animate = motionSetting !== 'off';

  const items: { label: string; to: Parameters<typeof go>[0]; variant: 'gold' | 'ghost' }[] = [
    { label: 'Create Room', to: 'create', variant: 'gold' },
    { label: 'Join Room', to: 'join', variant: 'gold' },
    { label: 'Practice Mode', to: 'practice', variant: 'ghost' },
    { label: 'How to Play', to: 'howto', variant: 'ghost' },
    { label: 'Settings', to: 'settings', variant: 'ghost' },
    { label: 'Credits', to: 'credits', variant: 'ghost' },
  ];

  return (
    <div className="relative flex min-h-full flex-col items-center overflow-hidden" onPointerDown={() => sound.startMusic()}>
      <motion.div
        className="menu-bg absolute inset-0"
        initial={{ scale: 1.08 }}
        animate={animate ? { scale: [1.08, 1.0, 1.08] } : { scale: 1.02 }}
        transition={{ duration: 40, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-black/85" />
      <Particles count={80} />

      <div className="relative z-10 flex w-full max-w-5xl flex-1 flex-col items-center px-4 pb-8 pt-[6vh]">
        <motion.h1
          className="deco-title select-none text-[22vw] leading-none sm:text-[9rem]"
          initial={{ opacity: 0, y: -20, letterSpacing: '0.5em' }}
          animate={{ opacity: 1, y: 0, letterSpacing: '0.22em' }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ paddingLeft: '0.22em' }}
        >
          COUP
        </motion.h1>
        <motion.p
          className="mt-2 text-center font-display text-xs uppercase tracking-[0.5em] text-champagne/80 sm:text-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          Deception · Influence · Betrayal
        </motion.p>

        {/* Fanned character cards */}
        <div className="relative my-6 h-[150px] w-full max-w-[560px] sm:my-8 sm:h-[210px]" aria-hidden>
          {ROLES.map((r, i) => {
            const offset = i - 2;
            return (
              <motion.img
                key={r}
                src={cardImg(r)}
                alt=""
                draggable={false}
                className="absolute left-1/2 top-0 w-[96px] drop-shadow-[0_18px_25px_rgba(0,0,0,.7)] sm:w-[140px]"
                style={{ marginLeft: -48, transformOrigin: '50% 140%' }}
                initial={{ opacity: 0, y: 80, rotate: 0, x: 0 }}
                animate={{
                  opacity: 1,
                  y: animate ? [Math.abs(offset) * 10, Math.abs(offset) * 10 - 8, Math.abs(offset) * 10] : Math.abs(offset) * 10,
                  rotate: offset * 11,
                  x: offset * 62,
                }}
                transition={{
                  opacity: { delay: 0.3 + i * 0.12 },
                  rotate: { delay: 0.3 + i * 0.12, type: 'spring', stiffness: 80 },
                  x: { delay: 0.3 + i * 0.12, type: 'spring', stiffness: 80 },
                  y: animate ? { delay: 1.2 + i * 0.2, duration: 4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0 },
                }}
              />
            );
          })}
        </div>

        {session && room && (
          <Button variant="silver" className="mb-4" onClick={() => go(room.status === 'lobby' ? 'lobby' : 'game')}>
            Return to room {session.code}
          </Button>
        )}

        <nav className="grid w-full max-w-md grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Main menu">
          {items.map((it, i) => (
            <motion.div key={it.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 + i * 0.07 }}>
              <Button variant={it.variant} className="w-full" onClick={() => go(it.to)}>
                {it.label}
              </Button>
            </motion.div>
          ))}
        </nav>
      </div>
      <footer className="relative z-10 pb-4 text-center text-[11px] tracking-widest text-ivory/40">SIX PLAYERS · PRIVATE ROOMS · ONE SURVIVOR</footer>
    </div>
  );
}
