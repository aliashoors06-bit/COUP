import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ROLE_META } from '../../shared/constants';
import type { LobbyPlayer, PublicGameState, PublicPlayer } from '../../shared/types';
import { roleLabel } from '../lib/game';
import { cls } from '../lib/util';
import { GameCard } from './GameCard';
import { Avatar, CoinIcon } from './ui';

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

export interface SeatStatus {
  isTurn: boolean;
  isTarget: boolean;
  targetable: boolean;
  awaiting: boolean;
  passed: boolean;
  chip: { text: string; color: string } | null;
}

export function seatStatus(game: PublicGameState, p: PublicPlayer, targeting: boolean, validIds: string[]): SeatStatus {
  const pd = game.pending;
  const pr = game.prompt;
  let chip: SeatStatus['chip'] = null;
  if (pd && game.phase !== 'WAITING_FOR_ACTION') {
    if (pd.actorId === p.id && pd.claim) chip = { text: `Claims ${roleLabel(pd.claim)}`, color: ROLE_META[pd.claim].color };
    if (pd.challengerId === p.id) chip = { text: 'Challenges!', color: '#a5141d' };
    if (pd.blockerId === p.id && pd.blockRole) chip = { text: `Blocks · ${roleLabel(pd.blockRole)}`, color: ROLE_META[pd.blockRole].color };
    if (pd.blockChallengerId === p.id) chip = { text: 'Challenges block!', color: '#a5141d' };
  }
  return {
    isTurn: game.currentPlayerId === p.id && game.phase !== 'GAME_OVER',
    isTarget: !!pd && pd.targetId === p.id && game.phase !== 'WAITING_FOR_ACTION',
    targetable: targeting && validIds.includes(p.id),
    awaiting: !!pr && pr.kind !== 'action' && pr.playerIds.includes(p.id) && !pr.responded.includes(p.id),
    passed: !!pr && pr.responded.includes(p.id),
    chip,
  };
}

/** Floating emoji reactions above a seat. */
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

export function OpponentSeat({
  player,
  lobby,
  status,
  compact,
  onTarget,
}: {
  player: PublicPlayer;
  lobby?: LobbyPlayer;
  status: SeatStatus;
  compact: boolean;
  onTarget?: () => void;
}) {
  const reactions = useReactions(player.id);
  const cardW = compact ? 30 : 58;
  const disconnected = lobby && !lobby.connected && !lobby.isBot;
  const Tag = status.targetable ? motion.button : motion.div;
  return (
    <Tag
      type={status.targetable ? 'button' : undefined}
      onClick={status.targetable ? onTarget : undefined}
      aria-label={`${player.name}: ${player.coins} coins, ${player.influence} influence${player.eliminated ? ', exiled' : ''}${status.targetable ? '. Select as target' : ''}`}
      data-anchor={player.id}
      layout
      className={cls(
        'relative flex flex-col items-center rounded-lg border bg-gradient-to-b from-navy-800/90 to-midnight/90 transition',
        compact ? 'w-[104px] gap-1 p-1.5' : 'w-[190px] gap-2 p-3',
        status.isTurn ? 'active-turn border-cyanglow/80' : 'border-champagne/25',
        status.isTarget && 'border-coupred shadow-[0_0_0_2px_rgba(200,35,44,.8),0_0_24px_rgba(200,35,44,.5)]',
        status.targetable && 'cursor-pointer border-coupred/80 hover:scale-105 shadow-[0_0_0_2px_rgba(224,67,75,.6)]',
        player.eliminated && 'opacity-60 saturate-50',
      )}
    >
      <AnimatePresence>
        {reactions.map((r, i) => (
          <motion.span
            key={r.id}
            className="pointer-events-none absolute -top-2 z-20 text-3xl"
            style={{ left: `${40 + i * 10}%` }}
            initial={{ y: 0, opacity: 0, scale: 0.5 }}
            animate={{ y: -40, opacity: 1, scale: 1.1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            {r.text}
          </motion.span>
        ))}
      </AnimatePresence>

      <div className={cls('flex w-full items-center', compact ? 'gap-1' : 'gap-2')}>
        <Avatar avatar={player.avatar} size={compact ? 22 : 34} className={cls(disconnected && 'grayscale opacity-40')} />
        <div className="min-w-0 flex-1 text-left">
          <div className={cls('truncate font-display font-bold leading-tight', compact ? 'text-[11px]' : 'text-sm')}>{player.name}</div>
          {!compact && (
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-ivory/50" aria-hidden>
              {Array.from({ length: 2 }, (_, i) => (
                <span key={i} className={cls('h-1.5 w-1.5 rotate-45', i < player.influence ? 'bg-champagne' : 'bg-white/15')} />
              ))}
              <span className="ml-1 truncate">
                {player.isBot ? 'bot' : lobby?.botControlled ? 'stand-in' : ''}
              </span>
            </div>
          )}
        </div>
        <div className={cls('flex items-center gap-0.5 font-display font-bold tabular-nums', compact ? 'text-xs' : 'text-base')} aria-hidden>
          <CoinIcon size={compact ? 14 : 20} />
          {player.coins}
        </div>
      </div>

      <div className={cls('flex justify-center', compact ? 'gap-1' : 'gap-2')}>
        {player.slots.map((s, i) => (
          <GameCard key={i} role={s.revealed ? s.role : null} dead={s.revealed} width={cardW} />
        ))}
      </div>

      {/* Status line */}
      <div className={cls('flex min-h-[18px] items-center justify-center', compact && 'min-h-[14px]')}>
        {player.eliminated ? (
          <span className={cls('font-deco tracking-[0.3em] text-coupred', compact ? 'text-[10px]' : 'text-sm')}>EXILED</span>
        ) : status.chip ? (
          <span className={cls('rounded-sm px-1.5 py-0.5 font-bold uppercase tracking-wider text-ivory', compact ? 'text-[8px]' : 'text-[10px]')} style={{ background: status.chip.color }}>
            {status.chip.text}
          </span>
        ) : disconnected ? (
          <span className={cls('font-bold uppercase tracking-wider text-coupred', compact ? 'text-[8px]' : 'text-[10px]')}>⚠ Disconnected</span>
        ) : status.awaiting ? (
          <span className={cls('uppercase tracking-wider text-cyanglow', compact ? 'text-[8px]' : 'text-[10px]')}>Deciding…</span>
        ) : status.passed ? (
          <span className={cls('uppercase tracking-wider text-ivory/40', compact ? 'text-[8px]' : 'text-[10px]')}>✓ Pass</span>
        ) : status.isTurn ? (
          <span className={cls('uppercase tracking-wider text-cyanglow', compact ? 'text-[8px]' : 'text-[10px]')}>Their turn</span>
        ) : null}
      </div>
      {status.targetable && (
        <span className="absolute -bottom-2 rounded-sm bg-coupred px-2 text-[10px] font-bold uppercase tracking-wider text-white">Target</span>
      )}
    </Tag>
  );
}
