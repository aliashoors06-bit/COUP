import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ACTION_META, ROLE_META, type ActionType, type Role } from '../../../shared/constants';
import type { GameCommand, PrivateState, PublicGameState, PublicPlayer } from '../../../shared/types';
import { actionAvailability, nameOf, roleLabel } from '../../lib/game';
import { cls } from '../../lib/util';
import { sound } from '../../lib/sound';
import { TimerRing } from './TimerRing';
import { ActionIcon } from './icons';

/** Order requested for the action bar. */
export const BAR_ACTIONS: ActionType[] = ['income', 'foreign_aid', 'tax', 'steal', 'exchange', 'assassinate', 'coup'];

const ACCENT: Record<ActionType, string> = {
  income: '#9aa0aa',
  foreign_aid: '#9aa0aa',
  tax: ROLE_META.duke.color,
  steal: ROLE_META.captain.color,
  exchange: ROLE_META.ambassador.color,
  assassinate: ROLE_META.assassin.color,
  coup: '#b3121c',
};

function money(a: ActionType) {
  const m = ACTION_META[a];
  if (m.cost) return `−${m.cost}`;
  if (m.gain) return `+${m.gain}`;
  if (a === 'steal') return '+2';
  return '';
}

function Pill({ children, onClick, tone = 'ghost', disabled, title, className }: { children: React.ReactNode; onClick?: () => void; tone?: 'gold' | 'ghost' | 'red' | 'teal'; disabled?: boolean; title?: string; className?: string }) {
  const tones = {
    gold: 'bg-gradient-to-b from-[#f1dfb4] via-[#d6be8c] to-[#a68b5b] text-[#1a1408] hover:brightness-110',
    ghost: 'bg-white/[.06] text-ivory shadow-[inset_0_0_0_1px_rgba(214,190,140,.4)] hover:bg-white/[.12]',
    red: 'bg-gradient-to-b from-[#e5444c] to-[#9c121b] text-white hover:brightness-110',
    teal: 'bg-gradient-to-b from-[#2d7f8c] to-[#164a53] text-white hover:brightness-110',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => {
        sound.play('click', 0.5);
        onClick?.();
      }}
      className={cls(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 font-display text-sm font-bold uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-40',
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ActionBar({ game, me, onChoose, busy }: { game: PublicGameState; me: PublicPlayer; onChoose: (a: ActionType) => void; busy: boolean }) {
  const [tip, setTip] = useState<ActionType | null>(null);
  return (
    <div className="relative">
      <AnimatePresence>
        {tip && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 w-[min(92vw,320px)] -translate-x-1/2 rounded-lg border border-champagne/40 bg-midnight/95 p-3 text-xs shadow-deco"
            role="tooltip"
          >
            <ActionInfo a={tip} reason={actionAvailability(game, me, tip).reason} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-stretch justify-center gap-1.5 sm:gap-2" role="toolbar" aria-label="Actions">
        {BAR_ACTIONS.map((a, i) => {
          const m = ACTION_META[a];
          const av = actionAvailability(game, me, a);
          const enabled = av.enabled && !busy;
          return (
            <button
              key={a}
              type="button"
              disabled={!enabled}
              aria-keyshortcuts={String(i + 1)}
              aria-label={`${m.label}${money(a) ? ` ${money(a)} coins` : ''}${m.claim ? `, claim ${roleLabel(m.claim)}` : ''}${av.enabled ? '' : ` — ${av.reason}`}`}
              onMouseEnter={() => setTip(a)}
              onMouseLeave={() => setTip((t) => (t === a ? null : t))}
              onFocus={() => setTip(a)}
              onBlur={() => setTip((t) => (t === a ? null : t))}
              onClick={() => {
                sound.play('click', 0.5);
                onChoose(a);
              }}
              className={cls(
                'group relative flex min-h-[52px] min-w-[84px] flex-col items-center justify-center rounded-xl px-2.5 py-1.5 transition sm:min-w-[100px]',
                enabled ? 'bg-black/55 hover:-translate-y-0.5 hover:bg-black/70' : 'cursor-not-allowed bg-black/35 opacity-40',
              )}
              style={{ boxShadow: `inset 0 0 0 1px ${enabled ? 'rgba(214,190,140,.45)' : 'rgba(255,255,255,.08)'}, inset 0 -3px 0 ${ACCENT[a]}` }}
            >
              <span className="flex items-center gap-1.5" style={{ color: enabled ? '#efe3c4' : '#aaa' }}>
                <ActionIcon a={a} size={18} />
                <span className="font-display text-[12px] font-bold uppercase tracking-[0.08em] sm:text-[13px]">{m.label}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-ivory/60">
                {money(a) && (
                  <span className={cls('font-bold', m.cost ? 'text-[#ff9aa0]' : 'text-[#9fe0a8]')}>
                    {money(a)}
                    <img src="/assets/coins/coin-front.png" alt="" className="ml-0.5 inline h-3 w-3 align-[-2px]" />
                  </span>
                )}
                <span>{m.claim ? roleLabel(m.claim) : 'General'}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActionInfo({ a, reason }: { a: ActionType; reason?: string }) {
  const m = ACTION_META[a];
  return (
    <div className="space-y-1">
      <div className="font-display text-sm font-bold uppercase tracking-[0.15em] text-champagne">{m.label}</div>
      <div className="text-ivory/85">{m.description}</div>
      <div className="grid grid-cols-2 gap-x-2 pt-1 text-[11px] text-ivory/70">
        <span>Claim</span>
        <span className="text-ivory">{m.claim ? `${roleLabel(m.claim)} (you may bluff)` : 'None'}</span>
        <span>Challengeable</span>
        <span className="text-ivory">{m.challengeable ? 'Yes' : 'No'}</span>
        <span>Blocked by</span>
        <span className="text-ivory">{m.blockedBy.length ? m.blockedBy.map(roleLabel).join(', ') : 'Nothing'}</span>
      </div>
      {reason && <div className="pt-1 text-[11px] text-[#ff9aa0]">{reason}</div>}
    </div>
  );
}

export function RoleTag({ r }: { r: Role }) {
  return (
    <span className="mx-0.5 inline-block rounded-sm px-1.5 py-0.5 text-[0.82em] font-bold uppercase tracking-wider text-ivory" style={{ background: ROLE_META[r].color, boxShadow: '0 0 0 1px rgba(214,190,140,.5)' }}>
      {ROLE_META[r].label}
    </span>
  );
}

/** Compact strip for challenge / block / prove decisions. */
export function ReactionStrip({ game, priv, meId, send, remaining }: { game: PublicGameState; priv: PrivateState; meId: string; send: (c: GameCommand) => Promise<{ ok: boolean }>; remaining: number }) {
  const [sentFor, setSentFor] = useState<number | null>(null);
  const pr = game.prompt!;
  const pd = game.pending!;
  const busy = sentFor === pr.id;
  const go = async (cmd: GameCommand) => {
    setSentFor(pr.id);
    const r = await send(cmd);
    if (!r.ok) setSentFor(null);
  };
  const holds = (r: Role) => priv.hand.some((s) => !s.revealed && s.card.role === r);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || busy) return;
      const k = e.key.toLowerCase();
      if (k === 'p' && ['action_challenge', 'block', 'block_challenge'].includes(pr.kind)) void go({ type: 'pass' });
      if (k === 'c' && ['action_challenge', 'block_challenge'].includes(pr.kind)) void go({ type: 'challenge' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let text: React.ReactNode = null;
  let buttons: React.ReactNode = null;
  const actor = nameOf(game, pd.actorId);
  switch (pr.kind) {
    case 'action_challenge':
      text = (
        <>
          <b>{actor}</b> claims <RoleTag r={pd.claim!} />
          {pd.targetId === meId && <span className="text-[#ff9aa0]"> against you</span>}
        </>
      );
      buttons = (
        <>
          <Pill tone="red" disabled={busy} onClick={() => go({ type: 'challenge' })}>
            Challenge
          </Pill>
          <Pill disabled={busy} onClick={() => go({ type: 'pass' })}>
            Pass
          </Pill>
        </>
      );
      break;
    case 'block':
      text =
        pd.action === 'foreign_aid' ? (
          <>
            <b>{actor}</b> takes Foreign Aid
          </>
        ) : pd.action === 'assassinate' ? (
          <>
            <b>{actor}</b> is assassinating <span className="text-[#ff9aa0]">you</span>
          </>
        ) : (
          <>
            <b>{actor}</b> is stealing from <span className="text-[#ff9aa0]">you</span>
          </>
        );
      buttons = (
        <>
          {(pr.blockRoles ?? []).map((r) => (
            <Pill key={r} tone="teal" disabled={busy} onClick={() => go({ type: 'block', role: r })} title={holds(r) ? `You hold ${roleLabel(r)}` : `Bluff — you do not hold ${roleLabel(r)}`}>
              Block · {roleLabel(r)}
              {!holds(r) && <span className="text-[9px] font-normal opacity-70">bluff</span>}
            </Pill>
          ))}
          <Pill disabled={busy} onClick={() => go({ type: 'pass' })}>
            Pass
          </Pill>
        </>
      );
      break;
    case 'block_challenge':
      text = (
        <>
          <b>{nameOf(game, pd.blockerId)}</b> blocks with <RoleTag r={pd.blockRole!} />
        </>
      );
      buttons = (
        <>
          <Pill tone="red" disabled={busy} onClick={() => go({ type: 'challenge' })}>
            Challenge
          </Pill>
          <Pill disabled={busy} onClick={() => go({ type: 'pass' })}>
            Pass
          </Pill>
        </>
      );
      break;
    case 'prove_action':
    case 'prove_block': {
      const r = pr.role!;
      const by = pr.kind === 'prove_action' ? pd.challengerId : pd.blockChallengerId;
      text = (
        <>
          <b>{nameOf(game, by)}</b> challenges your <RoleTag r={r} />
        </>
      );
      buttons = (
        <>
          <Pill tone="gold" disabled={busy || !holds(r)} onClick={() => go({ type: 'prove' })} title={holds(r) ? '' : `You do not hold a ${roleLabel(r)}`}>
            Reveal {roleLabel(r)}
          </Pill>
          <Pill tone="red" disabled={busy} onClick={() => go({ type: 'concede' })}>
            Concede
          </Pill>
        </>
      );
      break;
    }
    default:
      return null;
  }
  return (
    <motion.div
      key={pr.id}
      initial={{ y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2"
      role="group"
      aria-label="Your decision"
    >
      <TimerRing remaining={remaining} duration={pr.duration} size={40} urgent />
      <div className="text-center text-sm sm:text-base">{text}</div>
      <div className="flex flex-wrap justify-center gap-2">{buttons}</div>
    </motion.div>
  );
}

export function PromptLine({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex flex-wrap items-center justify-center gap-3" role="group">
      <div className="text-center text-sm sm:text-base">{children}</div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </motion.div>
  );
}

export { Pill };
