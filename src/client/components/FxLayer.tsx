import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ROLE_META } from '../../shared/constants';
import type { GameEvent } from '../../shared/types';
import { fxBus } from '../lib/fx';
import { useSettings } from '../lib/settings';
import { sound } from '../lib/sound';
import { useStore } from '../lib/store';
import { uid } from '../lib/util';

interface Flight {
  id: string;
  kind: 'coin' | 'card';
  from: { x: number; y: number };
  to: { x: number; y: number };
  delay: number;
}

interface Banner {
  id: string;
  title: string;
  sub?: string;
  tone: 'red' | 'gold' | 'silver' | 'blue';
}

function center(anchor: string) {
  const el = document.querySelector(`[data-anchor="${anchor}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Plays animations and sounds for authoritative server events. Purely cosmetic:
 * nothing here influences game state.
 */
export function FxLayer({ onShake }: { onShake: () => void }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const queue = useRef<Banner[]>([]);
  const showing = useRef(false);
  const motionSetting = useSettings((s) => s.motion);
  const motionRef = useRef(motionSetting);
  motionRef.current = motionSetting;
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;

  useEffect(() => {
    const name = (id: string) => {
      const st = useStore.getState();
      if (id === st.session?.playerId) return 'You';
      return st.game?.players.find((p) => p.id === id)?.name ?? '';
    };
    const me = () => useStore.getState().session?.playerId;

    const fly = (kind: Flight['kind'], from: string, to: string, count: number, baseDelay = 0) => {
      if (motionRef.current !== 'full') return;
      const a = center(from);
      const b = center(to);
      if (!a || !b) return;
      const items: Flight[] = Array.from({ length: Math.min(count, 6) }, (_, i) => ({
        id: uid(),
        kind,
        from: { x: a.x + (Math.random() - 0.5) * 16, y: a.y + (Math.random() - 0.5) * 16 },
        to: { x: b.x + (Math.random() - 0.5) * 20, y: b.y + (Math.random() - 0.5) * 12 },
        delay: baseDelay + i * 0.09,
      }));
      setFlights((f) => [...f, ...items]);
      const ttl = (baseDelay + items.length * 0.09 + 0.9) * 1000;
      setTimeout(() => setFlights((f) => f.filter((x) => !items.includes(x))), ttl);
    };

    const pushBanner = (b: Omit<Banner, 'id'>) => {
      if (motionRef.current === 'off') return;
      if (queue.current.length > 2) queue.current.shift();
      queue.current.push({ ...b, id: uid() });
      pump();
    };
    const pump = () => {
      if (showing.current) return;
      const next = queue.current.shift();
      if (!next) return;
      showing.current = true;
      setBanner(next);
      setTimeout(
        () => {
          setBanner(null);
          setTimeout(() => {
            showing.current = false;
            pump();
          }, 180);
        },
        motionRef.current === 'reduced' ? 900 : 1250,
      );
    };

    const handle = (e: GameEvent) => {
      switch (e.t) {
        case 'deal':
          sound.play('deal');
          e.order.forEach((pid, i) => {
            fly('card', 'deck', pid, 1, i * 0.12);
            fly('card', 'deck', pid, 1, 0.75 + i * 0.12);
          });
          setTimeout(() => sound.play('deal'), 750);
          pushBanner({ title: 'The court assembles', sub: 'Two influence and two coins each', tone: 'gold' });
          break;
        case 'turn':
          if (e.playerId === me()) {
            sound.play('turn');
            pushBanner({ title: 'Your turn', tone: 'blue' });
          }
          break;
        case 'coins':
          sound.play(e.to === 'treasury' ? 'spend' : 'coin');
          fly('coin', e.from, e.to, e.amount);
          break;
        case 'challenge':
          sound.play('challenge');
          onShakeRef.current();
          pushBanner({ title: 'Challenge!', sub: `${name(e.challengerId)} doubts ${name(e.claimantId)}'s ${ROLE_META[e.role].label}`, tone: 'red' });
          break;
        case 'proof':
          sound.play(e.success ? 'flip' : 'block');
          pushBanner(
            e.success
              ? { title: 'Claim proven', sub: `${name(e.playerId)} reveals ${ROLE_META[e.role].label}`, tone: 'gold' }
              : { title: 'Bluff exposed', sub: `${name(e.playerId)} cannot show ${ROLE_META[e.role].label}`, tone: 'red' },
          );
          break;
        case 'replace':
          fly('card', e.playerId, 'deck', 1, 0.3);
          fly('card', 'deck', e.playerId, 1, 0.9);
          setTimeout(() => sound.play('deal'), 900);
          break;
        case 'block':
          sound.play('block');
          pushBanner({ title: `Block · ${ROLE_META[e.role].label}`, sub: `${name(e.playerId)} blocks ${name(e.actorId)}`, tone: 'blue' });
          break;
        case 'blocked':
          sound.play('block');
          pushBanner({ title: 'Blocked', sub: `${name(e.blockerId)} stops ${name(e.actorId)}`, tone: 'silver' });
          break;
        case 'reveal':
          sound.play('flip');
          break;
        case 'coup':
          sound.play('coup');
          onShakeRef.current();
          pushBanner({ title: 'COUP', sub: `${name(e.actorId)} overthrows ${name(e.targetId)}`, tone: 'red' });
          break;
        case 'assassinate':
          sound.play('assassinate');
          pushBanner({ title: 'Assassination', sub: `${name(e.actorId)} strikes ${name(e.targetId)}`, tone: 'red' });
          break;
        case 'steal':
          break;
        case 'exchange':
          if (!e.done) {
            fly('card', 'deck', e.playerId, 2);
            sound.play('deal');
          } else {
            fly('card', e.playerId, 'deck', 2);
          }
          break;
        case 'eliminated':
          sound.play('eliminate');
          pushBanner({ title: 'Exiled', sub: `${name(e.playerId)} has lost all influence`, tone: 'red' });
          break;
        case 'victory':
          sound.play(e.playerId === me() ? 'victory' : 'defeat');
          break;
      }
    };
    return fxBus.on(handle);
  }, []);

  const toneClass: Record<Banner['tone'], string> = {
    red: 'from-[#5a0d14] via-[#a5141d] to-[#5a0d14] text-white',
    gold: 'from-[#5b4a28] via-[#b89a62] to-[#5b4a28] text-[#1a1408]',
    silver: 'from-[#3a3d44] via-[#aeb2ba] to-[#3a3d44] text-[#111]',
    blue: 'from-[#0f2a33] via-[#1f5d6b] to-[#0f2a33] text-white',
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-live="assertive">
      {flights.map((f) => (
        <motion.img
          key={f.id}
          src={f.kind === 'coin' ? '/assets/coins/coin-angle.png' : '/assets/cards/card-back.png'}
          alt=""
          className="absolute left-0 top-0 drop-shadow-[0_6px_8px_rgba(0,0,0,.6)]"
          style={{ width: f.kind === 'coin' ? 26 : 44, marginLeft: f.kind === 'coin' ? -13 : -22, marginTop: f.kind === 'coin' ? -13 : -27 }}
          initial={{ x: f.from.x, y: f.from.y, opacity: 0, scale: 0.7, rotate: 0 }}
          animate={{ x: f.to.x, y: f.to.y, opacity: [0, 1, 1, 0.9], scale: [0.7, 1.15, 1], rotate: f.kind === 'coin' ? 360 : 8 }}
          transition={{ duration: 0.65, delay: f.delay, ease: [0.3, 0.1, 0.2, 1] }}
        />
      ))}
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.id}
            className="absolute inset-x-0 top-[38%] flex justify-center"
            initial={{ opacity: 0, scaleX: 0.3 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleY: 0.4 }}
            transition={{ duration: 0.25 }}
          >
            <div className={`w-full bg-gradient-to-r ${toneClass[banner.tone]} px-4 py-3 text-center shadow-[0_10px_40px_rgba(0,0,0,.6)]`}>
              <div className="font-deco text-3xl uppercase tracking-[0.25em] sm:text-5xl">{banner.title}</div>
              {banner.sub && <div className="mt-1 font-display text-sm font-semibold tracking-wider opacity-90 sm:text-base">{banner.sub}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
