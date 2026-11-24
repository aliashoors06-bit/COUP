import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ACTION_META, ACTIONS, ROLE_META, type ActionType, type Role } from '../../shared/constants';
import type { PrivateState, PublicGameState, PublicPlayer } from '../../shared/types';
import { actionAvailability, nameOf, roleLabel } from '../lib/game';
import { useStore } from '../lib/store';
import { cls } from '../lib/util';
import { GameCard } from './GameCard';
import { Button, CoinIcon } from './ui';

const ACTION_COLOR: Record<ActionType, string> = {
  income: '#5f6672',
  foreign_aid: '#5f6672',
  coup: '#a5141d',
  tax: ROLE_META.duke.color,
  assassinate: ROLE_META.assassin.color,
  steal: ROLE_META.captain.color,
  exchange: ROLE_META.ambassador.color,
};

function costText(a: ActionType): string {
  const m = ACTION_META[a];
  if (m.cost) return `−${m.cost}`;
  if (m.gain) return `+${m.gain}`;
  if (a === 'steal') return '+2';
  return '±0';
}

export function ActionPanel({
  game,
  me,
  onChoose,
  compact,
}: {
  game: PublicGameState;
  me: PublicPlayer;
  onChoose: (a: ActionType) => void;
  compact: boolean;
}) {
  const [info, setInfo] = useState<ActionType | null>(null);
  return (
    <div className="relative">
      <div className={cls('grid gap-1.5', compact ? 'grid-cols-4' : 'grid-cols-7')} role="toolbar" aria-label="Actions">
        {ACTIONS.map((a, i) => {
          const m = ACTION_META[a];
          const av = actionAvailability(game, me, a);
          return (
            <div key={a} className="group relative">
              <button
                onClick={() => av.enabled && onChoose(a)}
                disabled={!av.enabled}
                aria-disabled={!av.enabled}
                aria-describedby={`act-${a}`}
                aria-keyshortcuts={String(i + 1)}
                className={cls(
                  'relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded border px-1 text-center transition',
                  compact ? 'min-h-[58px] py-1.5' : 'min-h-[78px] py-2',
                  av.enabled ? 'border-champagne/50 hover:-translate-y-0.5 hover:border-champagne hover:shadow-deco' : 'cursor-not-allowed border-white/10 opacity-45',
                )}
                style={{ background: `linear-gradient(180deg, ${ACTION_COLOR[a]}ee, #12141c 92%)` }}
              >
                <span className={cls('w-full break-words font-display font-bold uppercase leading-tight', compact ? 'text-[11px] tracking-[0.04em]' : 'text-[12px] tracking-[0.02em]')}>{m.label}</span>
                <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-bold text-ivory/90">
                  <CoinIcon size={12} />
                  {costText(a)}
                </span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wider text-ivory/60">{m.claim ? roleLabel(m.claim) : 'General'}</span>
                {!av.enabled && av.reason && !compact && <span className="mt-0.5 text-[8px] uppercase tracking-wide text-[#ff9aa0]">{av.reason}</span>}
                {!compact && <span className="absolute left-1 top-0.5 text-[9px] text-ivory/30">{i + 1}</span>}
              </button>
              <button
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-ivory/50 hover:bg-white/10 hover:text-ivory"
                aria-label={`About ${m.label}`}
                onClick={() => setInfo(info === a ? null : a)}
              >
                ⓘ
              </button>
              {/* Desktop hover tooltip */}
              <div
                id={`act-${a}`}
                role="tooltip"
                className={cls(
                  'pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 rounded border border-champagne/40 bg-midnight/95 p-3 text-left text-xs opacity-0 shadow-deco transition',
                  'group-hover:opacity-100 [@media(hover:none)]:hidden',
                )}
              >
                <ActionInfo a={a} reason={av.enabled ? undefined : av.reason} />
              </div>
            </div>
          );
        })}
      </div>
      {/* Tap-to-view info */}
      <AnimatePresence>
        {info && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-full left-0 right-0 z-40 mb-2 rounded border border-champagne/40 bg-midnight/95 p-3 text-xs shadow-deco"
            onClick={() => setInfo(null)}
          >
            <ActionInfo a={info} reason={actionAvailability(game, me, info).reason} />
            <div className="mt-2 text-[10px] text-ivory/40">Tap to close</div>
          </motion.div>
        )}
      </AnimatePresence>
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
        <span>Cost / reward</span>
        <span className="text-ivory">{m.cost ? `${m.cost} coins` : m.gain ? `+${m.gain} coins` : a === 'steal' ? 'up to 2 coins' : '—'}</span>
        <span>Claim</span>
        <span className="text-ivory">{m.claim ? roleLabel(m.claim) : 'None'}</span>
        <span>Challengeable</span>
        <span className="text-ivory">{m.challengeable ? 'Yes' : 'No'}</span>
        <span>Blocked by</span>
        <span className="text-ivory">{m.blockedBy.length ? m.blockedBy.map(roleLabel).join(', ') : 'Nothing'}</span>
      </div>
      {reason && <div className="pt-1 text-[11px] text-[#ff9aa0]">{reason}</div>}
    </div>
  );
}

/** Challenge / block / prove decisions for the local player. */
export function ReactionBar({ game, priv, meId }: { game: PublicGameState; priv: PrivateState; meId: string }) {
  const send = useStore((s) => s.send);
  const [sent, setSent] = useState<number | null>(null);
  const pr = game.prompt!;
  const pd = game.pending!;
  const busy = sent === pr.id;
  const go = async (cmd: Parameters<typeof send>[0]) => {
    setSent(pr.id);
    const res = await send(cmd);
    if (!res.ok) setSent(null);
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

  let prompt: React.ReactNode = null;
  let buttons: React.ReactNode = null;
  switch (pr.kind) {
    case 'action_challenge':
      prompt = (
        <>
          <b>{nameOf(game, pd.actorId)}</b> claims <RoleTag r={pd.claim!} />
          {pd.targetId === meId && <span className="text-[#ff9aa0]"> — targeting you</span>}
        </>
      );
      buttons = (
        <>
          <Button variant="danger" disabled={busy} onClick={() => go({ type: 'challenge' })}>
            Challenge <kbd className="hidden opacity-60 sm:inline">C</kbd>
          </Button>
          <Button disabled={busy} onClick={() => go({ type: 'pass' })}>
            Pass <kbd className="hidden opacity-60 sm:inline">P</kbd>
          </Button>
        </>
      );
      break;
    case 'block': {
      const roles = pr.blockRoles ?? [];
      prompt =
        pd.action === 'foreign_aid' ? (
          <>
            <b>{nameOf(game, pd.actorId)}</b> takes Foreign Aid. Block by claiming <RoleTag r="duke" />?
          </>
        ) : pd.action === 'assassinate' ? (
          <>
            <b>{nameOf(game, pd.actorId)}</b> is assassinating <span className="text-[#ff9aa0]">you</span>! Block with <RoleTag r="contessa" />?
          </>
        ) : (
          <>
            <b>{nameOf(game, pd.actorId)}</b> is stealing from <span className="text-[#ff9aa0]">you</span>! Block?
          </>
        );
      buttons = (
        <>
          {roles.map((r) => (
            <Button key={r} variant="gold" disabled={busy} onClick={() => go({ type: 'block', role: r })} title={holds(r) ? `You hold ${roleLabel(r)}` : `Bluff: you do not hold ${roleLabel(r)}`}>
              Block · {roleLabel(r)}
              {!holds(r) && <span className="text-[9px] opacity-70">(bluff)</span>}
            </Button>
          ))}
          <Button disabled={busy} onClick={() => go({ type: 'pass' })}>
            Allow <kbd className="hidden opacity-60 sm:inline">P</kbd>
          </Button>
        </>
      );
      break;
    }
    case 'block_challenge':
      prompt = (
        <>
          <b>{nameOf(game, pd.blockerId)}</b> blocks with <RoleTag r={pd.blockRole!} />
          {pd.actorId === meId && <span> — your action</span>}
        </>
      );
      buttons = (
        <>
          <Button variant="danger" disabled={busy} onClick={() => go({ type: 'challenge' })}>
            Challenge block <kbd className="hidden opacity-60 sm:inline">C</kbd>
          </Button>
          <Button disabled={busy} onClick={() => go({ type: 'pass' })}>
            Accept <kbd className="hidden opacity-60 sm:inline">P</kbd>
          </Button>
        </>
      );
      break;
    case 'prove_action':
    case 'prove_block': {
      const r = pr.role!;
      const challenger = pr.kind === 'prove_action' ? pd.challengerId : pd.blockChallengerId;
      prompt = (
        <>
          <b>{nameOf(game, challenger)}</b> challenges your <RoleTag r={r} /> claim!
        </>
      );
      buttons = (
        <>
          <Button variant="gold" disabled={busy || !holds(r)} onClick={() => go({ type: 'prove' })} title={holds(r) ? '' : `You do not hold a ${roleLabel(r)}`}>
            Reveal {roleLabel(r)}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => go({ type: 'concede' })}>
            Concede
          </Button>
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
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="flex flex-col items-center gap-3 rounded-lg border border-cyanglow/50 bg-midnight/90 p-3 shadow-glow sm:flex-row sm:justify-between sm:p-4"
      role="group"
      aria-label="Your decision"
    >
      <div className="text-center text-sm sm:text-left sm:text-base">{prompt}</div>
      <div className="flex flex-wrap justify-center gap-2">{buttons}</div>
    </motion.div>
  );
}

export function RoleTag({ r }: { r: Role }) {
  return (
    <span className="mx-0.5 inline-block rounded-sm px-1.5 py-0.5 text-[0.8em] font-bold uppercase tracking-wider text-ivory" style={{ background: ROLE_META[r].color, boxShadow: '0 0 0 1px rgba(214,190,140,.5)' }}>
      {ROLE_META[r].label}
    </span>
  );
}

/** Choose which hidden card to reveal. Shown as a bottom sheet so the table stays visible. */
export function InfluencePicker({ game, priv }: { game: PublicGameState; priv: PrivateState }) {
  const send = useStore((s) => s.send);
  const [busy, setBusy] = useState(false);
  const pr = game.prompt!;
  return (
    <BottomSheet title="Lose one influence" sub={pr.reason ? `You ${pr.reason}. Choose a card to reveal.` : 'Choose a card to reveal.'}>
      <div className="flex justify-center gap-4">
        {priv.hand.map((s, i) =>
          s.revealed ? null : (
            <div key={s.card.id} className="flex flex-col items-center gap-2">
              <GameCard
                role={s.card.role}
                width={120}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  const r = await send({ type: 'lose', slot: i });
                  if (!r.ok) setBusy(false);
                }}
                label={`Reveal ${roleLabel(s.card.role)}`}
              />
              <span className="text-xs uppercase tracking-wider text-ivory/70">Reveal {roleLabel(s.card.role)}</span>
            </div>
          ),
        )}
      </div>
    </BottomSheet>
  );
}

export function ExchangePicker({ priv }: { priv: PrivateState }) {
  const send = useStore((s) => s.send);
  const options = priv.exchangeOptions ?? [];
  const keepN = priv.hand.filter((s) => !s.revealed).length;
  const [keep, setKeep] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setKeep((k) => (k.includes(id) ? k.filter((x) => x !== id) : k.length < keepN ? [...k, id] : [...k.slice(1), id]));
  const currentIds = priv.hand.filter((s) => !s.revealed).map((s) => s.card.id);
  return (
    <BottomSheet title="Ambassador exchange" sub={`Keep ${keepN} card${keepN === 1 ? '' : 's'}. The rest return to the Court Deck.`}>
      <div className="flex flex-wrap justify-center gap-3">
        {options.map((c) => (
          <div key={c.id} className="flex flex-col items-center gap-1">
            <GameCard role={c.role} width={96} selected={keep.includes(c.id)} dim={keep.length === keepN && !keep.includes(c.id)} onClick={() => toggle(c.id)} badge={currentIds.includes(c.id) ? 'Yours' : 'Drawn'} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-2">
        <Button onClick={() => setKeep(currentIds)} disabled={busy}>
          Keep mine
        </Button>
        <Button
          variant="gold"
          disabled={keep.length !== keepN || busy}
          onClick={async () => {
            setBusy(true);
            const r = await send({ type: 'exchange', keep });
            if (!r.ok) setBusy(false);
          }}
        >
          Confirm ({keep.length}/{keepN})
        </Button>
      </div>
    </BottomSheet>
  );
}

function BottomSheet({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-2"
      initial={{ y: 200, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 200, opacity: 0 }}
      role="dialog"
      aria-label={title}
    >
      <div className="deco-panel safe-bottom w-full max-w-2xl p-4 sm:p-6">
        <div className="mb-1 text-center font-deco text-xl tracking-[0.15em] text-champagne sm:text-2xl">{title}</div>
        {sub && <div className="mb-4 text-center text-sm text-ivory/70">{sub}</div>}
        {children}
      </div>
    </motion.div>
  );
}
