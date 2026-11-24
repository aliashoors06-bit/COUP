import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_META, ACTIONS, ROLE_META, type ActionType } from '../../shared/constants';
import type { PublicPlayer } from '../../shared/types';
import { ChatBox, GameLog } from '../components/ChatPanel';
import { ActionPanel, ExchangePicker, InfluencePicker, ReactionBar } from '../components/Controls';
import { FxLayer } from '../components/FxLayer';
import { GameCard } from '../components/GameCard';
import { GameOver } from '../components/GameOver';
import { OpponentSeat, seatStatus, TimerRing } from '../components/Seat';
import { Avatar, Button, CoinIcon, Modal } from '../components/ui';
import { actionAvailability, describeMoment, isMyPrompt, nameOf, useServerNow, validTargets } from '../lib/game';
import { useSettings } from '../lib/settings';
import { sound } from '../lib/sound';
import { useStore } from '../lib/store';
import { cls } from '../lib/util';
import { HowToPlay, SettingsPanel } from './Info';

function useCompact() {
  const get = () => window.innerWidth < 820 || window.innerHeight < 560;
  const [c, setC] = useState(get);
  useEffect(() => {
    const on = () => setC(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return c;
}

export function Game() {
  const game = useStore((s) => s.game);
  const priv = useStore((s) => s.priv);
  const room = useStore((s) => s.room);
  const session = useStore((s) => s.session);
  const connected = useStore((s) => s.connected);
  const send = useStore((s) => s.send);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const unread = useStore((s) => s.unreadChat);
  const compact = useCompact();
  const now = useServerNow(200);

  const [targeting, setTargeting] = useState<ActionType | null>(null);
  const [confirm, setConfirm] = useState<{ action: ActionType; targetId: string } | null>(null);
  const [panel, setPanel] = useState<'log' | 'chat'>('log');
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState<'rules' | 'settings' | 'leave' | null>(null);
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const motionSetting = useSettings((s) => s.motion);
  const lastTick = useRef(0);

  const meId = session?.playerId ?? '';
  const me = game?.players.find((p) => p.id === meId);
  const pr = game?.prompt ?? null;
  const myPrompt = isMyPrompt(game, meId);
  const remaining = pr ? Math.max(0, (pr.deadline - now) / 1000) : 0;

  // Reset local UI state whenever the server opens a new decision.
  useEffect(() => {
    setTargeting(null);
    setConfirm(null);
    setSubmitting(false);
  }, [pr?.id]);

  // Countdown warning ticks for my own decisions.
  useEffect(() => {
    if (!myPrompt || !pr) return;
    const secs = Math.ceil(remaining);
    if (secs <= 3 && secs > 0 && secs !== lastTick.current) {
      lastTick.current = secs;
      sound.play('tick');
    }
  }, [myPrompt, pr, remaining]);

  const choose = useCallback(
    async (action: ActionType, targetId?: string) => {
      if (!game || !me) return;
      const meta = ACTION_META[action];
      if (meta.targeted && !targetId) {
        setTargeting(action);
        return;
      }
      if ((action === 'coup' || action === 'assassinate') && targetId && !confirm) {
        setConfirm({ action, targetId });
        return;
      }
      setSubmitting(true);
      setTargeting(null);
      setConfirm(null);
      const res = await send({ type: 'action', action, targetId: targetId ?? null });
      if (!res.ok) setSubmitting(false);
    },
    [game, me, confirm, send],
  );

  // Keyboard: 1–7 actions, Esc cancels targeting.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') {
        setTargeting(null);
        return;
      }
      const n = Number(e.key);
      if (!game || !me || !n || n > 7 || modal) return;
      const a = ACTIONS[n - 1]!;
      if (actionAvailability(game, me, a).enabled && !submitting) void choose(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, me, choose, modal, submitting]);

  const onShake = useCallback(() => {
    if (useSettings.getState().motion !== 'full') return;
    setShake(true);
    setTimeout(() => setShake(false), 460);
  }, []);

  // Seats relative to me: I sit at the bottom; others follow clockwise.
  const ordered = useMemo(() => {
    if (!game) return [] as PublicPlayer[];
    const mySeat = me?.seat ?? 0;
    return [...game.players].sort((a, b) => ((a.seat - mySeat + 6) % 6) - ((b.seat - mySeat + 6) % 6)).filter((p) => p.id !== meId);
  }, [game, me?.seat, meId]);

  if (!game || !session) {
    return <div className="flex h-full items-center justify-center text-ivory/60">Loading the table…</div>;
  }

  const validIds = targeting ? validTargets(game, meId).map((p) => p.id) : [];
  const moment = describeMoment(game, meId);
  const isMyTurn = game.currentPlayerId === meId && pr?.kind === 'action';
  const lobbyOf = (id: string) => room?.players.find((p) => p.id === id);
  // Clockwise around an oval: r1 left, r2 top-left, r3 top, r4 top-right, r5 right.
  const [r1, r2, r3, r4, r5] = ordered;

  const seat = (p: PublicPlayer | undefined, align: string) =>
    p ? (
      <div className={cls('flex', align)}>
        <OpponentSeat
          player={p}
          lobby={lobbyOf(p.id)}
          status={seatStatus(game, p, !!targeting, validIds)}
          compact={compact}
          onTarget={() => targeting && choose(targeting, p.id)}
        />
      </div>
    ) : (
      <div />
    );

  const sidePanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex gap-1" role="tablist">
        {(['log', 'chat'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={panel === t}
            onClick={() => setPanel(t)}
            className={cls('flex-1 rounded-sm py-1.5 text-xs font-bold uppercase tracking-[0.25em]', panel === t ? 'bg-champagne/20 text-champagne' : 'text-ivory/50 hover:text-ivory')}
          >
            {t === 'log' ? 'Action log' : `Chat${unread && panel !== 'chat' ? ` (${unread})` : ''}`}
          </button>
        ))}
      </div>
      {panel === 'log' ? <GameLog log={game.log} className="min-h-0 flex-1" /> : <ChatBox className="min-h-0 flex-1" compact={compact} />}
    </div>
  );

  return (
    <div className={cls('table-bg relative flex h-full flex-col overflow-hidden', shake && 'shake', motionSetting === 'off' && 'motion-off')}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,.55))]" />

      {/* Top bar */}
      <header className="relative z-20 flex items-center gap-2 border-b border-champagne/15 bg-midnight/70 px-3 py-2 backdrop-blur">
        <span className="font-deco text-xl tracking-[0.2em] text-champagne">COUP</span>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-ivory/50 sm:inline">{room?.practice ? `Practice · ${room.difficulty}` : `Room ${room?.code ?? ''}`}</span>
        <span className="text-xs uppercase tracking-[0.2em] text-ivory/50">· Turn {game.turnNumber}</span>
        <span className={cls('ml-1 h-2 w-2 rounded-full', connected ? 'bg-[#6fd39a]' : 'animate-pulse bg-coupred')} title={connected ? 'Connected' : 'Reconnecting'} />
        <div className="ml-auto flex items-center gap-1">
          <IconBtn label="Log and chat" onClick={() => setDrawer((d) => !d)} className="lg:hidden">
            ☰{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-coupred px-1 text-[9px]">{unread}</span>}
          </IconBtn>
          <IconBtn label="Rules" onClick={() => setModal('rules')}>?</IconBtn>
          <IconBtn label="Settings" onClick={() => setModal('settings')}>⚙</IconBtn>
          <IconBtn label="Leave match" onClick={() => setModal('leave')}>⎋</IconBtn>
        </div>
      </header>

      {!connected && <div className="relative z-20 bg-coupred/90 py-1 text-center text-xs font-bold uppercase tracking-widest">Connection lost — reconnecting…</div>}

      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Table */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-3 sm:px-4">
          <div className={cls('grid w-full items-center', compact ? 'grid-cols-3 gap-x-1 gap-y-2' : 'mx-auto max-w-5xl grid-cols-[1fr_1.15fr_1fr] gap-x-4 gap-y-3')}>
            {seat(r2, cls('justify-center sm:justify-end', !compact && 'mt-10'))}
            {seat(r3, 'justify-center')}
            {seat(r4, cls('justify-center sm:justify-start', !compact && 'mt-10'))}
            {seat(r1, 'justify-center sm:justify-end')}
            {/* Centre: Court Deck + Treasury */}
            <div className="flex items-center justify-center gap-3 sm:gap-6">
              <div className="flex flex-col items-center" data-anchor="deck" aria-label={`Court Deck: ${game.deckCount} cards`}>
                <div className="relative">
                  {Array.from({ length: Math.min(3, game.deckCount) }).map((_, i) => (
                    <div key={i} className={i === 0 ? '' : 'absolute'} style={i ? { left: i * 2, top: -i * 2 } : undefined}>
                      <GameCard role={null} width={compact ? 36 : 64} />
                    </div>
                  ))}
                </div>
                <span className="mt-1 text-[10px] uppercase tracking-[0.2em] text-ivory/60">{compact ? '' : 'Deck · '}{game.deckCount}</span>
              </div>
              <div className="flex flex-col items-center" data-anchor="treasury" aria-label={`Treasury: ${game.treasury} coins`}>
                <img src="/assets/coins/coin-stack.png" alt="" className={compact ? 'w-10' : 'w-[72px]'} draggable={false} />
                <span className="mt-1 text-[10px] uppercase tracking-[0.2em] text-ivory/60">{compact ? '' : 'Treasury · '}{game.treasury}</span>
              </div>
            </div>
            {seat(r5, 'justify-center sm:justify-start')}
          </div>

          {/* Announcement */}
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 rounded-lg border border-champagne/20 bg-midnight/70 px-3 py-2 backdrop-blur sm:px-4" aria-live="polite">
            {pr && game.phase !== 'GAME_OVER' && <TimerRing remaining={remaining} duration={pr.duration} size={compact ? 36 : 44} urgent={myPrompt} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {moment.role && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: ROLE_META[moment.role].color, boxShadow: '0 0 0 1px rgba(214,190,140,.6)' }} />}
                <div className="truncate font-display text-sm font-bold tracking-wide sm:text-lg">{moment.title}</div>
              </div>
              <div className="truncate text-xs text-ivory/60 sm:text-sm">{moment.sub}</div>
            </div>
          </div>

          {/* My decision */}
          <div className="mx-auto w-full max-w-3xl">
            <AnimatePresence mode="wait">
              {myPrompt && priv && pr && ['action_challenge', 'block', 'block_challenge', 'prove_action', 'prove_block'].includes(pr.kind) && (
                <ReactionBar key={pr.id} game={game} priv={priv} meId={meId} />
              )}
            </AnimatePresence>
          </div>

          <div className="flex-1" />

          {/* My area */}
          {me && (
            <section className="mx-auto w-full max-w-5xl" aria-label="Your hand">
              <AnimatePresence>
                {targeting && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-2 flex items-center justify-center gap-3 rounded border border-coupred/60 bg-[#2a1015]/90 px-3 py-2 text-sm">
                    <span>
                      Choose a target for <b>{ACTION_META[targeting].label}</b>
                    </span>
                    <Button className="!min-h-0 !px-3 !py-1.5 !text-xs" onClick={() => setTargeting(null)}>
                      Cancel
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className={cls('flex items-end gap-3 sm:gap-5', compact ? 'flex-col items-center' : 'justify-center')}>
                <div
                  data-anchor={me.id}
                  className={cls(
                    'flex items-center gap-3 rounded-lg border bg-gradient-to-b from-navy-800/90 to-midnight/95 p-2 sm:p-3',
                    game.currentPlayerId === me.id && game.phase !== 'GAME_OVER' ? 'active-turn border-cyanglow/80' : 'border-champagne/30',
                    game.pending?.targetId === me.id && game.phase !== 'WAITING_FOR_ACTION' && 'border-coupred shadow-[0_0_0_2px_rgba(200,35,44,.8)]',
                  )}
                >
                  <div className="flex flex-col items-center gap-1">
                    <Avatar avatar={me.avatar} size={compact ? 36 : 48} />
                    <div className="max-w-[90px] truncate text-xs font-bold">{me.name}</div>
                    <div className="flex items-center gap-1 font-display text-lg font-bold tabular-nums" aria-label={`${me.coins} coins`}>
                      <CoinIcon size={20} />
                      {me.coins}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {(priv?.hand ?? []).map((s, i) => (
                      <GameCard key={`${i}-${s.card.id}`} role={s.card.role} dead={s.revealed} width={compact ? 78 : 112} />
                    ))}
                  </div>
                  {me.eliminated && <div className="font-deco text-lg tracking-[0.3em] text-coupred">EXILED</div>}
                </div>
                {!me.eliminated && game.phase !== 'GAME_OVER' && (
                  <div className={cls('w-full', !compact && 'max-w-[640px]')}>
                    {isMyTurn ? (
                      <ActionPanel game={game} me={me} compact={compact} onChoose={(a) => !submitting && choose(a)} />
                    ) : (
                      <div className="rounded border border-white/5 bg-black/30 px-3 py-3 text-center text-xs uppercase tracking-[0.2em] text-ivory/40">
                        {myPrompt ? 'Your decision is required' : `Waiting for ${nameOf(game, pr?.playerIds[0]) || '…'}`}
                      </div>
                    )}
                  </div>
                )}
                {me.eliminated && game.phase !== 'GAME_OVER' && <div className="text-center text-sm text-ivory/60">You have been exiled. You may keep watching as a spectator.</div>}
              </div>
            </section>
          )}
        </main>

        {/* Side panel (desktop) */}
        <aside className="hidden w-[320px] shrink-0 border-l border-champagne/15 bg-midnight/75 p-3 backdrop-blur lg:block">{sidePanel}</aside>
      </div>

      {/* Drawer (mobile/tablet) */}
      <AnimatePresence>
        {drawer && (
          <motion.div className="fixed inset-0 z-40 bg-black/50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)}>
            <motion.aside
              className="absolute bottom-0 right-0 top-0 w-[min(88vw,360px)] border-l border-champagne/20 bg-midnight/95 p-3"
              initial={{ x: 360 }}
              animate={{ x: 0 }}
              exit={{ x: 360 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="mb-2 text-xs uppercase tracking-widest text-ivory/50" onClick={() => setDrawer(false)}>
                Close ✕
              </button>
              <div className="h-[calc(100%-28px)]">{sidePanel}</div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Private decision sheets */}
      <AnimatePresence>
        {myPrompt && pr?.kind === 'lose_influence' && priv && <InfluencePicker key={`l${pr.id}`} game={game} priv={priv} />}
        {myPrompt && pr?.kind === 'exchange' && priv?.exchangeOptions && <ExchangePicker key={`x${pr.id}`} priv={priv} />}
      </AnimatePresence>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? ACTION_META[confirm.action].label : ''}>
        {confirm && (
          <div className="space-y-5 text-center">
            <p>
              Pay <b>{ACTION_META[confirm.action].cost} coins</b> to {confirm.action === 'coup' ? 'launch a Coup against' : 'assassinate'} <b>{nameOf(game, confirm.targetId)}</b>?
            </p>
            <div className="flex justify-center gap-3">
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => choose(confirm.action, confirm.targetId)}>
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={modal === 'rules'} onClose={() => setModal(null)} title="How to play" className="max-w-3xl">
        <HowToPlay embedded />
      </Modal>
      <Modal open={modal === 'settings'} onClose={() => setModal(null)} title="Settings">
        <SettingsPanel />
      </Modal>
      <Modal open={modal === 'leave'} onClose={() => setModal(null)} title="Leave the match?">
        <p className="text-center text-sm text-ivory/80">
          {room?.practice ? 'Your practice match will end.' : game.phase === 'GAME_OVER' ? 'You will leave this room.' : 'A stand-in bot will play your seat for the rest of the match.'}
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Button onClick={() => setModal(null)}>Stay</Button>
          <Button variant="danger" onClick={() => leaveRoom()}>
            Leave
          </Button>
        </div>
      </Modal>

      <FxLayer onShake={onShake} />
      {game.phase === 'GAME_OVER' && <GameOver game={game} room={room} meId={meId} />}
    </div>
  );
}

function IconBtn({ label, onClick, children, className }: { label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cls('relative flex h-9 w-9 items-center justify-center rounded border border-champagne/25 text-champagne hover:bg-champagne/10', className)}
    >
      {children}
    </button>
  );
}
