import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACTION_META, ROLE_META, type ActionType } from '../../shared/constants';
import { ChatBox, GameLog } from '../components/ChatPanel';
import { GameOver } from '../components/GameOver';
import { Button, Modal } from '../components/ui';
import { ActionBar, BAR_ACTIONS, Pill, PromptLine, ReactionStrip } from '../components/table/Dock';
import { TreasuryPile } from '../components/table/Coins';
import { Flights } from '../components/table/Flights';
import { CourtDeck, ExchangeTray, TableRibbon, TableSurface } from '../components/table/TableParts';
import { MyHand, OpponentSeat, seatStatus } from '../components/table/TableSeat';
import { TimerRing } from '../components/table/TimerRing';
import { actionAvailability, describeMoment, isMyPrompt, nameOf, useServerNow, validTargets } from '../lib/game';
import { useSettings } from '../lib/settings';
import { sound } from '../lib/sound';
import { useStore } from '../lib/store';
import { shownCoins, useTableFx } from '../lib/tableFx';
import { computeLayout, type Orientation } from '../lib/tableLayout';
import { cls } from '../lib/util';
import { HowToPlay, SettingsPanel } from './Info';

/** Measure the area available for the table and compute the stage scale. */
function useStageFit(w: number, h: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: window.innerWidth, h: Math.max(200, window.innerHeight - 160) });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const scale = Math.max(0.1, Math.min(box.w / w, box.h / h));
  return { ref, box, scale };
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
  const motionSetting = useSettings((s) => s.motion);
  const now = useServerNow(200);

  const [targeting, setTargeting] = useState<ActionType | null>(null);
  const [confirm, setConfirm] = useState<{ action: ActionType; targetId: string } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState<'log' | 'chat'>('log');
  const [modal, setModal] = useState<'rules' | 'settings' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const lastTick = useRef(0);

  const meId = session?.playerId ?? '';
  const me = game?.players.find((p) => p.id === meId);
  const pr = game?.prompt ?? null;
  const myPrompt = isMyPrompt(game, meId);
  const remaining = pr ? Math.max(0, (pr.deadline - now) / 1000) : 0;

  const [short, setShort] = useState(() => window.innerHeight < 520);
  useEffect(() => {
    const on = () => setShort(window.innerHeight < 520);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const [orientation, setOrientation] = useState<Orientation>(() =>
    window.innerWidth / Math.max(1, window.innerHeight - 160) < 0.95 ? 'portrait' : 'landscape',
  );
  const playerCount = game?.players.length ?? 0;
  const mySeat = me?.seat ?? 0;
  const ids = useMemo(() => {
    if (!game) return [] as string[];
    const n = game.players.length;
    return [...game.players].sort((a, b) => ((a.seat - mySeat + n) % n) - ((b.seat - mySeat + n) % n)).map((p) => p.id);
    // Seating only changes when a new match starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerCount, game?.startedAt, mySeat]);
  const layout = useMemo(() => computeLayout(orientation, ids), [orientation, ids]);
  const fit = useStageFit(layout.w, layout.h);
  useEffect(() => {
    const o: Orientation = fit.box.w / Math.max(1, fit.box.h) < 0.95 ? 'portrait' : 'landscape';
    if (o !== orientation) setOrientation(o);
  }, [fit.box.w, fit.box.h, orientation]);

  const shakeAt = useTableFx((s) => s.shakeAt);
  useEffect(() => {
    if (!shakeAt) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 460);
    return () => clearTimeout(t);
  }, [shakeAt]);

  useEffect(() => {
    setTargeting(null);
    setConfirm(null);
    setBusy(false);
  }, [pr?.id]);

  useEffect(() => {
    if (!myPrompt || !pr) return;
    const secs = Math.ceil(remaining);
    if (secs <= 3 && secs > 0 && secs !== lastTick.current) {
      lastTick.current = secs;
      sound.play('tick');
    }
  }, [myPrompt, pr, remaining]);

  const submitAction = useCallback(
    async (action: ActionType, targetId: string | null) => {
      setBusy(true);
      setTargeting(null);
      setConfirm(null);
      const res = await send({ type: 'action', action, targetId });
      if (!res.ok) setBusy(false);
    },
    [send],
  );

  const choose = useCallback(
    (action: ActionType) => {
      if (!game || !me || busy) return;
      if (!actionAvailability(game, me, action).enabled) return;
      if (ACTION_META[action].targeted) {
        setConfirm(null);
        setTargeting((t) => (t === action ? null : action));
        return;
      }
      void submitAction(action, null);
    },
    [game, me, busy, submitAction],
  );

  const pickTarget = useCallback(
    (targetId: string) => {
      if (!targeting) return;
      if (targeting === 'coup' || targeting === 'assassinate') {
        setConfirm({ action: targeting, targetId });
        setTargeting(null);
      } else void submitAction(targeting, targetId);
    },
    [targeting, submitAction],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || modal) return;
      if (e.key === 'Escape') {
        setTargeting(null);
        setConfirm(null);
        return;
      }
      if (e.key === 'Enter' && confirm) {
        void submitAction(confirm.action, confirm.targetId);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 7) choose(BAR_ACTIONS[n - 1]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, confirm, modal, submitAction]);

  const fx = useTableFx();
  if (!game || !session) return <div className="flex h-full items-center justify-center text-ivory/60">Loading the table…</div>;

  const validIds = targeting ? validTargets(game, meId).map((p) => p.id) : [];
  const moment = describeMoment(game, meId);
  const isMyTurn = game.currentPlayerId === meId && pr?.kind === 'action';
  const lobbyOf = (id: string) => room?.players.find((p) => p.id === id);
  const treasuryShown = shownCoins('treasury', game.treasury, fx.coins, fx.now);
  const portrait = layout.orientation === 'portrait';

  // ── Controls below my cards
  let dock: React.ReactNode = null;
  if (me && !me.eliminated && game.phase !== 'GAME_OVER') {
    if (confirm) {
      dock = (
        <PromptLine
          actions={
            <>
              <Pill onClick={() => setConfirm(null)}>Cancel</Pill>
              <Pill tone="red" onClick={() => submitAction(confirm.action, confirm.targetId)}>
                {confirm.action === 'coup' ? 'Launch Coup' : 'Assassinate'}
              </Pill>
            </>
          }
        >
          Pay <b>{ACTION_META[confirm.action].cost} coins</b> to {confirm.action === 'coup' ? 'overthrow' : 'assassinate'}{' '}
          <b className="text-[#ff9aa0]">{nameOf(game, confirm.targetId)}</b>?
        </PromptLine>
      );
    } else if (targeting) {
      dock = (
        <PromptLine actions={<Pill onClick={() => setTargeting(null)}>Cancel</Pill>}>
          <span className="text-[#ff9aa0]">◎</span> Select a highlighted player to <b>{ACTION_META[targeting].label}</b>
          {ACTION_META[targeting].claim && <span className="text-ivory/60"> (claiming {ROLE_META[ACTION_META[targeting].claim!].label})</span>}
        </PromptLine>
      );
    } else if (isMyTurn) {
      dock = <ActionBar game={game} me={me} onChoose={choose} busy={busy} />;
    } else if (myPrompt && priv && pr && ['action_challenge', 'block', 'block_challenge', 'prove_action', 'prove_block'].includes(pr.kind)) {
      dock = <ReactionStrip game={game} priv={priv} meId={meId} send={send} remaining={remaining} />;
    } else if (myPrompt && pr?.kind === 'lose_influence') {
      dock = (
        <PromptLine actions={<TimerRing remaining={remaining} duration={pr.duration} size={40} urgent />}>
          <b className="text-[#ff9aa0]">You {pr.reason ?? 'must lose an influence'}.</b> Tap one of your cards to reveal it.
        </PromptLine>
      );
    } else if (myPrompt && pr?.kind === 'exchange') {
      dock = (
        <PromptLine actions={<TimerRing remaining={remaining} duration={pr.duration} size={40} urgent />}>
          Choose the cards to keep on the table above.
        </PromptLine>
      );
    } else {
      dock = (
        <div className="text-center text-xs uppercase tracking-[0.25em] text-ivory/40">
          {pr?.kind === 'action' ? `${nameOf(game, game.currentPlayerId)} is choosing an action` : 'Waiting for other players'}
        </div>
      );
    }
  } else if (me?.eliminated && game.phase !== 'GAME_OVER') {
    dock = <div className="text-center text-sm text-ivory/60">You have been exiled — watching as a spectator.</div>;
  }

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
      {panel === 'log' ? <GameLog log={game.log} className="min-h-0 flex-1" /> : <ChatBox className="min-h-0 flex-1" />}
    </div>
  );

  return (
    <div
      className={cls('relative flex h-full flex-col overflow-hidden', shaking && 'shake', motionSetting === 'off' && 'motion-off')}
      style={{ background: 'radial-gradient(ellipse at 50% 45%, #1b2030 0%, #101218 55%, #08090c 100%)' }}
    >
      {/* ── Top: brand, announcement, menu ── */}
      <header className={cls('z-20 flex items-center gap-2 px-3 pt-2 sm:px-4', short ? 'pointer-events-none absolute inset-x-0 top-0 [&>*]:pointer-events-auto' : 'relative')}>
        <div className={cls('hidden min-w-0 items-baseline gap-2 md:w-[230px]', !short && 'md:flex')}>
          <span className="font-deco text-xl tracking-[0.2em] text-champagne">COUP</span>
          <span className="truncate text-[11px] uppercase tracking-[0.2em] text-ivory/45">
            {room?.practice ? `Practice · ${room.difficulty}` : room?.code} · Turn {game.turnNumber}
          </span>
          <span className={cls('h-2 w-2 shrink-0 rounded-full', connected ? 'bg-[#6fd39a]' : 'animate-pulse bg-coupred')} title={connected ? 'Connected' : 'Reconnecting'} />
        </div>
        <div className={cls('flex min-w-0 flex-1', short ? 'justify-start' : 'justify-center')} aria-live="polite">
          <div
            className={cls(
              'flex min-w-0 items-center gap-3 rounded-full bg-black/45 py-1 pl-1 pr-5 shadow-[0_0_0_1px_rgba(214,190,140,.22)]',
              short ? 'max-w-[30vw]' : 'max-w-[720px]',
            )}
          >
            {pr && game.phase !== 'GAME_OVER' ? <TimerRing remaining={remaining} duration={pr.duration} size={34} urgent={myPrompt} /> : <span className="w-2" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {moment.role && <span className="h-2.5 w-2.5 shrink-0 rotate-45" style={{ background: ROLE_META[moment.role].color, boxShadow: '0 0 0 1px rgba(214,190,140,.7)' }} />}
                <div className="truncate font-display text-sm font-bold tracking-wide sm:text-base">{moment.title}</div>
              </div>
              <div className="truncate text-[11px] text-ivory/55 sm:text-xs">{moment.sub}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 md:w-[230px]">
          <IconBtn label="Log and chat" onClick={() => setDrawer((d) => !d)}>
            ☰{unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-coupred px-1 text-[9px] text-white">{unread}</span>}
          </IconBtn>
          <IconBtn label="Rules" onClick={() => setModal('rules')}>
            ?
          </IconBtn>
          <IconBtn label="Settings" onClick={() => setModal('settings')}>
            ⚙
          </IconBtn>
          <IconBtn label="Leave match" onClick={() => setModal('leave')}>
            ⎋
          </IconBtn>
        </div>
      </header>
      {!connected && <div className="relative z-20 mx-auto mt-1 rounded-full bg-coupred/90 px-4 py-0.5 text-[11px] font-bold uppercase tracking-widest">Connection lost — reconnecting…</div>}

      {/* ── The table: a fixed stage scaled to fit, so every seat keeps its position ── */}
      <div ref={fit.ref} className="relative min-h-0 flex-1" role="region" aria-label="Game table">
        <div
          className="absolute left-1/2 top-1/2"
          style={{ width: layout.w, height: layout.h, transform: `translate(-50%, -50%) scale(${fit.scale})`, transformOrigin: '50% 50%' }}
        >
          <TableSurface layout={layout} />
          <CourtDeck layout={layout} count={game.deckCount} />
          <TreasuryPile count={treasuryShown} x={layout.treasury.x} y={layout.treasury.y} size={portrait ? 46 : 40} spread={portrait ? 95 : 85} />
          <div
            className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-display text-[13px] uppercase tracking-[0.25em] text-ivory/55"
            style={{ left: layout.treasury.x, top: layout.treasury.y + (portrait ? 80 : 70) }}
          >
            Treasury · {treasuryShown}
          </div>

          {game.players
            .filter((p) => p.id !== meId && layout.seats[p.id])
            .map((p) => (
              <OpponentSeat
                key={p.id}
                player={p}
                geo={layout.seats[p.id]!}
                layout={layout}
                status={seatStatus(game, p, !!targeting, validIds)}
                lobby={lobbyOf(p.id)}
                onTarget={() => pickTarget(p.id)}
              />
            ))}
          {me && (
            <section aria-label="Your hand">
              <MyHand
                me={me}
                priv={priv}
                layout={layout}
                status={seatStatus(game, me, false, [])}
                lobby={lobbyOf(me.id)}
                choosingLoss={myPrompt && pr?.kind === 'lose_influence'}
                onLose={(slot) => {
                  if (busy) return;
                  setBusy(true);
                  void send({ type: 'lose', slot }).then((r) => !r.ok && setBusy(false));
                }}
              />
            </section>
          )}
          {myPrompt && pr?.kind === 'exchange' && priv?.exchangeOptions && <ExchangeTray key={pr.id} layout={layout} priv={priv} send={send} />}
          <Flights layout={layout} coinSize={portrait ? 44 : 38} />
          <TableRibbon layout={layout} />
        </div>
      </div>

      {/* ── Controls below my cards ── */}
      <div className="safe-bottom relative z-20 flex min-h-[76px] items-center justify-center px-2 pb-3 pt-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={confirm ? 'c' : targeting ? 't' : isMyTurn ? 'a' : (pr?.id ?? 'x')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full"
          >
            {dock}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Log / chat drawer ── */}
      <AnimatePresence>
        {drawer && (
          <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)}>
            <motion.aside
              className="absolute bottom-0 right-0 top-0 w-[min(88vw,360px)] border-l border-champagne/20 bg-midnight/95 p-3 shadow-2xl backdrop-blur"
              initial={{ x: 380 }}
              animate={{ x: 0 }}
              exit={{ x: 380 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="mb-2 text-xs uppercase tracking-widest text-ivory/50 hover:text-ivory" onClick={() => setDrawer(false)}>
                Close ✕
              </button>
              <div className="h-[calc(100%-28px)]">{sidePanel}</div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

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

      {game.phase === 'GAME_OVER' && <GameOver game={game} room={room} meId={meId} />}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-champagne shadow-[0_0_0_1px_rgba(214,190,140,.3)] hover:bg-champagne/15"
    >
      {children}
    </button>
  );
}
