import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ROLE_META, type Role } from '../../../shared/constants';
import type { LobbyPlayer, PrivateState, PublicGameState, PublicPlayer } from '../../../shared/types';
import { roleLabel } from '../../lib/game';
import { shownCoins, slotFaceDown, slotHidden, useTableFx } from '../../lib/tableFx';
import type { SeatGeo, TableLayout } from '../../lib/tableLayout';
import { avatarImg, cls } from '../../lib/util';
import { GameCard } from '../GameCard';
import { CoinStack } from './Coins';

export interface SeatStatus {
  isTurn: boolean;
  isTarget: boolean;
  isActor: boolean;
  targetable: boolean;
  awaiting: boolean;
  passed: boolean;
  chip: { text: string; color: string } | null;
}

export function seatStatus(game: PublicGameState, p: PublicPlayer, targeting: boolean, validIds: string[]): SeatStatus {
  const pd = game.pending;
  const pr = game.prompt;
  const live = !!pd && game.phase !== 'WAITING_FOR_ACTION' && game.phase !== 'GAME_OVER';
  let chip: SeatStatus['chip'] = null;
  if (live && pd) {
    if (pd.actorId === p.id && pd.claim) chip = { text: roleLabel(pd.claim), color: ROLE_META[pd.claim].color };
    if (pd.challengerId === p.id) chip = { text: 'Challenge!', color: '#a5141d' };
    if (pd.blockerId === p.id && pd.blockRole) chip = { text: `Block · ${roleLabel(pd.blockRole)}`, color: ROLE_META[pd.blockRole].color };
    if (pd.blockChallengerId === p.id) chip = { text: 'Challenge!', color: '#a5141d' };
  }
  return {
    isTurn: game.currentPlayerId === p.id && game.phase !== 'GAME_OVER',
    isActor: live && pd?.actorId === p.id,
    isTarget: live && pd?.targetId === p.id,
    targetable: targeting && validIds.includes(p.id),
    awaiting: !!pr && pr.kind !== 'action' && pr.playerIds.includes(p.id) && !pr.responded.includes(p.id),
    passed: !!pr && pr.kind !== 'action' && pr.responded.includes(p.id),
    chip,
  };
}

function useReactions(playerId: string) {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent).detail as { id: string; playerId: string; text: string };
      if (m.playerId !== playerId) return;
      setItems((xs) => [...xs, { id: m.id, text: m.text }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== m.id)), 2200);
    };
    window.addEventListener('coup:reaction', on);
    return () => window.removeEventListener('coup:reaction', on);
  }, [playerId]);
  return items;
}

/** Glow pooled on the felt under a seat. */
function SeatGlow({ geo, w, tone, pulse }: { geo: SeatGeo; w: number; tone: 'cyan' | 'red'; pulse?: boolean }) {
  const c = tone === 'cyan' ? '143,227,239' : '224,67,75';
  return (
    <motion.div
      className="pointer-events-none absolute rounded-[50%]"
      style={{
        left: geo.center.x - w * 2.1,
        top: geo.center.y - w * 1.05,
        width: w * 4.2,
        height: w * 2.9,
        background: `radial-gradient(closest-side, rgba(${c},.34), rgba(${c},.12) 55%, transparent)`,
      }}
      animate={pulse ? { opacity: [0.55, 1, 0.55] } : { opacity: 1 }}
      transition={pulse ? { duration: 1.4, repeat: Infinity } : { duration: 0.3 }}
    />
  );
}

function ImpactFx({ geo, w, playerId }: { geo: SeatGeo; w: number; playerId: string }) {
  const impacts = useTableFx((s) => s.impacts).filter((i) => i.playerId === playerId);
  return (
    <AnimatePresence>
      {impacts.map((i) =>
        i.kind === 'coup' || i.kind === 'reveal' ? (
          <motion.div
            key={i.id}
            className="pointer-events-none absolute rounded-full"
            style={{ left: geo.center.x - w * 1.6, top: geo.center.y - w * 1.6, width: w * 3.2, height: w * 3.2, border: `${i.kind === 'coup' ? 6 : 3}px solid rgba(224,67,75,.9)` }}
            initial={{ scale: 0.3, opacity: 1 }}
            animate={{ scale: 1.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        ) : i.kind === 'assassinate' ? (
          <motion.svg
            key={i.id}
            className="pointer-events-none absolute"
            style={{ left: geo.center.x - w * 1.3, top: geo.center.y - w * 0.9, width: w * 2.6, height: w * 1.8 }}
            viewBox="0 0 100 70"
            initial={{ opacity: 1 }}
            animate={{ opacity: [1, 1, 0] }}
            transition={{ duration: 1, times: [0, 0.6, 1] }}
          >
            <motion.path d="M8 62 L92 8" stroke="#ff3b47" strokeWidth="5" strokeLinecap="round" fill="none" strokeDasharray="120" initial={{ strokeDashoffset: 120 }} animate={{ strokeDashoffset: 0 }} transition={{ duration: 0.22 }} />
            <motion.path d="M14 66 L96 16" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity={0.7} strokeDasharray="120" initial={{ strokeDashoffset: 120 }} animate={{ strokeDashoffset: 0 }} transition={{ duration: 0.22, delay: 0.05 }} />
          </motion.svg>
        ) : i.kind === 'challenge' || i.kind === 'block' ? (
          <motion.div
            key={i.id}
            className="pointer-events-none absolute rounded-full"
            style={{
              left: geo.center.x - w * 1.3,
              top: geo.center.y - w * 1.3,
              width: w * 2.6,
              height: w * 2.6,
              boxShadow: `0 0 40px 12px ${i.kind === 'challenge' ? 'rgba(224,67,75,.55)' : 'rgba(111,200,220,.5)'}`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.9 }}
          />
        ) : null,
      )}
    </AnimatePresence>
  );
}

function NamePlate({ p, at, status, lobby, size, me }: { p: PublicPlayer; at: { x: number; y: number }; status: SeatStatus; lobby?: LobbyPlayer; size: number; me?: boolean }) {
  const disconnected = lobby && !lobby.connected && !lobby.isBot;
  const reactions = useReactions(p.id);
  const sub = p.eliminated
    ? { text: 'EXILED', cls: 'text-[#ff6b73] font-deco tracking-[0.25em]' }
    : status.chip
      ? null
      : disconnected
        ? { text: 'Disconnected', cls: 'text-[#ff6b73]' }
        : status.awaiting
          ? { text: 'Deciding…', cls: 'text-cyanglow' }
          : status.passed
            ? { text: 'Pass', cls: 'text-ivory/45' }
            : lobby?.botControlled
              ? { text: 'Stand-in bot', cls: 'text-ivory/50' }
              : p.isBot
                ? { text: 'Bot', cls: 'text-ivory/45' }
                : null;
  return (
    <div className="pointer-events-none absolute flex flex-col items-center" style={{ left: at.x, top: at.y, transform: 'translate(-50%, -50%)' }}>
      <AnimatePresence>
        {reactions.map((r, i) => (
          <motion.span
            key={r.id}
            className="absolute -top-6 z-20"
            style={{ fontSize: size * 1.4, left: `${30 + i * 18}%` }}
            initial={{ y: 0, opacity: 0, scale: 0.4 }}
            animate={{ y: -size * 2.2, opacity: 1, scale: 1.1 }}
            exit={{ opacity: 0, y: -size * 3 }}
            transition={{ duration: 0.6 }}
          >
            {r.text}
          </motion.span>
        ))}
      </AnimatePresence>
      <div
        className={cls(
          'flex items-center gap-2 whitespace-nowrap rounded-full py-1 pl-1 pr-3 backdrop-blur-[2px] transition',
          status.isTurn ? 'bg-[#0d2a30]/85 shadow-[0_0_0_2px_rgba(143,227,239,.85),0_0_22px_rgba(143,227,239,.45)]' : 'bg-black/55 shadow-[0_0_0_1px_rgba(214,190,140,.3)]',
          p.eliminated && 'opacity-60 grayscale',
        )}
        style={{ fontSize: size }}
      >
        <img src={avatarImg(p.avatar)} alt="" draggable={false} className={cls('rounded-full', disconnected && 'opacity-40 grayscale')} style={{ width: size * 1.9, height: size * 1.9 }} />
        <span className="max-w-[9em] truncate font-display font-bold text-ivory">
          {p.name}
          {me && <span className="text-cyanglow"> (you)</span>}
        </span>
      </div>
      <div className="mt-1 flex h-[1.4em] items-center" style={{ fontSize: size * 0.78 }}>
        {status.chip && !p.eliminated ? (
          <span className="rounded-sm px-2 font-bold uppercase tracking-wider text-ivory shadow" style={{ background: status.chip.color, boxShadow: '0 0 0 1px rgba(214,190,140,.55)' }}>
            {status.chip.text}
          </span>
        ) : sub ? (
          <span className={cls('font-bold uppercase tracking-wider', sub.cls)}>{sub.text}</span>
        ) : null}
      </div>
    </div>
  );
}

export function OpponentSeat({
  player,
  geo,
  layout,
  status,
  lobby,
  onTarget,
}: {
  player: PublicPlayer;
  geo: SeatGeo;
  layout: TableLayout;
  status: SeatStatus;
  lobby?: LobbyPlayer;
  onTarget: () => void;
}) {
  const { coins, cards, now } = useTableFx();
  const w = layout.oppCardW;
  const coinsShown = shownCoins(player.id, player.coins, coins, now);
  const fontSize = layout.orientation === 'portrait' ? 24 : 17;
  return (
    <>
      {status.isTurn && <SeatGlow geo={geo} w={w} tone="cyan" />}
      {(status.isTarget || status.targetable) && <SeatGlow geo={geo} w={w} tone="red" pulse={status.targetable} />}
      <ImpactFx geo={geo} w={w} playerId={player.id} />
      {player.slots.map((s, i) => {
        const key = `${player.id}:${i}`;
        if (slotHidden(key, cards, now)) return null;
        const pos = geo.cards[i as 0 | 1];
        return (
          <div
            key={i}
            className={cls('absolute transition-opacity', player.eliminated && 'opacity-80')}
            style={{ left: pos.x - w / 2, top: pos.y - w * 0.625, transform: `rotate(${i ? 5 : -5}deg)`, filter: 'drop-shadow(0 10px 8px rgba(0,0,0,.55))' }}
          >
            <GameCard role={s.revealed ? s.role : null} dead={s.revealed} width={w} />
          </div>
        );
      })}
      <CoinStack count={coinsShown} size={w * 0.58} x={geo.stack.x} y={geo.stack.y} dim={player.eliminated} label={!player.eliminated || coinsShown > 0} />
      <NamePlate p={player} at={geo.plate} status={status} lobby={lobby} size={fontSize} />
      {status.targetable && (
        <motion.div
          className="pointer-events-none absolute rounded-2xl border-[3px] border-[#ff4d57]"
          style={{ left: geo.center.x - w * 1.25, top: geo.center.y - w * 0.82, width: w * 2.5, height: w * 1.64, boxShadow: '0 0 26px rgba(255,77,87,.65), inset 0 0 18px rgba(255,77,87,.35)' }}
          animate={{ opacity: [0.55, 1, 0.55], scale: [0.98, 1.03, 0.98] }}
          transition={{ duration: 1.1, repeat: Infinity }}
        >
          <span className="absolute -top-[1.1em] left-1/2 -translate-x-1/2 rounded-full bg-[#d3242e] px-3 font-display font-bold uppercase tracking-[0.2em] text-white" style={{ fontSize: w * 0.2 }}>
            Target
          </span>
        </motion.div>
      )}
      {status.targetable && (
        <button
          type="button"
          onClick={onTarget}
          aria-label={`Target ${player.name} (${player.coins} coins, ${player.influence} influence)`}
          className="absolute z-20 cursor-crosshair rounded-[40%] focus-visible:outline-4"
          style={{ left: geo.center.x - w * 2, top: geo.center.y - w * 1.05, width: w * 4, height: w * 2.6 }}
        />
      )}
      {!status.targetable && (
        <div
          className="absolute"
          role="img"
          aria-label={`${player.name}: ${player.coins} coins, ${player.influence} influence${player.eliminated ? ', exiled' : ''}`}
          style={{ left: geo.center.x - w, top: geo.center.y - w * 0.6, width: w * 2, height: w * 1.2 }}
        />
      )}
    </>
  );
}

const ROLE_HELP: Record<Role, { action: string; counter: string }> = {
  duke: { action: 'Tax — take 3 coins from the treasury.', counter: 'Blocks Foreign Aid.' },
  assassin: { action: 'Assassinate — pay 3 coins; target loses an influence.', counter: 'No counteraction.' },
  captain: { action: 'Steal — take up to 2 coins from a player.', counter: 'Blocks stealing.' },
  ambassador: { action: 'Exchange — swap cards with the Court Deck.', counter: 'Blocks stealing.' },
  contessa: { action: 'No action.', counter: 'Blocks assassination against you.' },
};

export function MyHand({
  me,
  priv,
  layout,
  status,
  lobby,
  choosingLoss,
  onLose,
}: {
  me: PublicPlayer;
  priv: PrivateState | null;
  layout: TableLayout;
  status: SeatStatus;
  lobby?: LobbyPlayer;
  choosingLoss: boolean;
  onLose: (slot: number) => void;
}) {
  const { coins, cards, now } = useTableFx();
  const [inspect, setInspect] = useState<number | null>(null);
  const geo = layout.me;
  const w = layout.myCardW;
  const coinsShown = shownCoins(me.id, me.coins, coins, now);
  const fontSize = layout.orientation === 'portrait' ? 26 : 18;
  const hand = priv?.hand ?? [];

  return (
    <>
      {status.isTurn && <SeatGlow geo={geo} w={w * 0.62} tone="cyan" />}
      {status.isTarget && <SeatGlow geo={geo} w={w * 0.62} tone="red" />}
      <ImpactFx geo={geo} w={w * 0.75} playerId={me.id} />
      {hand.map((s, i) => {
        const key = `${me.id}:${i}`;
        if (slotHidden(key, cards, now)) return null;
        const faceDown = slotFaceDown(key, cards, now);
        const pos = geo.cards[i as 0 | 1];
        const pickable = choosingLoss && !s.revealed;
        return (
          <motion.div
            key={`${i}-${s.card.id}`}
            className="absolute"
            style={{ left: pos.x - w / 2, top: pos.y - w * 0.625, rotate: i ? 3 : -3, filter: 'drop-shadow(0 16px 14px rgba(0,0,0,.6))', zIndex: inspect === i ? 25 : 10 }}
            onMouseEnter={() => setInspect(i)}
            onMouseLeave={() => setInspect((x) => (x === i ? null : x))}
            animate={pickable ? { y: [0, -10, 0] } : { y: 0 }}
            transition={pickable ? { duration: 1.1, repeat: Infinity } : { duration: 0.2 }}
          >
            <GameCard
              role={faceDown ? null : s.card.role}
              dead={s.revealed}
              width={w}
              onClick={pickable ? () => onLose(i) : () => setInspect((x) => (x === i ? null : i))}
              label={pickable ? `Reveal and lose ${roleLabel(s.card.role)}` : `${roleLabel(s.card.role)}${s.revealed ? ' (revealed, lost)' : ''} — show abilities`}
            />
            {pickable && <div className="pointer-events-none absolute -inset-1.5 rounded-xl border-[3px] border-[#ff4d57] shadow-[0_0_24px_rgba(255,77,87,.7)]" />}
            <AnimatePresence>
              {inspect === i && !faceDown && !pickable && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 rounded-lg border border-champagne/50 bg-midnight/95 p-3 text-left shadow-deco"
                  style={{ width: w * 1.9, fontSize: fontSize * 0.8 }}
                >
                  <div className="font-display font-bold uppercase tracking-[0.15em]" style={{ color: ROLE_META[s.card.role].accent }}>
                    {roleLabel(s.card.role)}
                    {s.revealed && <span className="ml-2 text-[#ff8a90]">· lost</span>}
                  </div>
                  <div className="mt-1 text-ivory/90">{ROLE_HELP[s.card.role].action}</div>
                  <div className="text-ivory/70">{ROLE_HELP[s.card.role].counter}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
      <CoinStack count={coinsShown} size={w * 0.42} x={geo.stack.x} y={geo.stack.y} />
      <NamePlate p={me} at={geo.plate} status={status} lobby={lobby} size={fontSize} me />
    </>
  );
}
