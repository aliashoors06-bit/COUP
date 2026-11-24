import { motion } from 'framer-motion';
import { useState } from 'react';
import { DEFAULT_TIMERS, PLAYER_COUNT, TIMER_LIMITS, type TimerSettings } from '../../shared/constants';
import type { RoomSettings } from '../../shared/types';
import { ChatBox } from '../components/ChatPanel';
import { Avatar, AvatarPicker, Button, Modal, Panel } from '../components/ui';
import { request } from '../lib/socket';
import { useStore } from '../lib/store';
import { cls } from '../lib/util';

const TIMER_LABELS: Record<keyof TimerSettings, string> = {
  turn: 'Turn',
  challenge: 'Challenge window',
  counter: 'Block window',
  proof: 'Prove / concede',
  influence: 'Lose influence',
  exchange: 'Exchange',
};

export function Lobby() {
  const room = useStore((s) => s.room);
  const session = useStore((s) => s.session);
  const toast = useStore((s) => s.toast);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!room || !session) {
    return <div className="flex h-full items-center justify-center text-ivory/60">Connecting to the court…</div>;
  }
  const me = room.players.find((p) => p.id === session.playerId);
  const isHost = room.hostId === session.playerId;
  const allReady = room.players.length === PLAYER_COUNT && room.players.every((p) => p.ready && p.connected);
  const link = `${window.location.origin}/?room=${room.code}`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied to clipboard`);
    } catch {
      toast(`${what}: ${text}`);
    }
  };
  const call = async (ev: string, payload?: unknown) => {
    const res = await request(ev, payload);
    if (!res.ok) toast(res.error ?? 'Request failed', 'error');
  };

  const slots = Array.from({ length: PLAYER_COUNT }, (_, i) => room.players[i] ?? null);

  return (
    <div className="relative min-h-full overflow-y-auto">
      <div className="table-bg fixed inset-0" />
      <div className="fixed inset-0 bg-black/40" />
      <div className="relative z-10 mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {/* Header with room code */}
          <Panel className="flex flex-col items-center gap-4 p-5 sm:flex-row sm:justify-between sm:p-6">
            <div className="text-center sm:text-left">
              <div className="text-xs uppercase tracking-[0.3em] text-champagne/70">Private room</div>
              <button
                onClick={() => copy(room.code, 'Room code')}
                className="deco-title text-5xl tracking-[0.35em] sm:text-6xl"
                aria-label={`Room code ${room.code.split('').join(' ')}. Click to copy.`}
              >
                {room.code}
              </button>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="gold" onClick={() => copy(link, 'Invitation link')}>
                Copy invite link
              </Button>
              <Button onClick={() => leaveRoom()}>Leave</Button>
            </div>
          </Panel>

          {/* Seats */}
          <Panel className="p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold uppercase tracking-[0.25em] text-champagne">The Court</h2>
              <div className={cls('font-deco text-2xl', room.players.length === PLAYER_COUNT ? 'text-champagne' : 'text-ivory/70')} aria-label={`${room.players.length} of 6 players`}>
                {room.players.length}/{PLAYER_COUNT}
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {slots.map((p, i) => (
                <motion.li
                  key={p?.id ?? `empty-${i}`}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cls(
                    'relative flex min-h-[132px] flex-col items-center justify-center gap-2 rounded border p-3 text-center',
                    p ? 'border-champagne/30 bg-black/30' : 'border-dashed border-white/10 bg-black/10',
                    p?.ready && 'border-[#6fd39a]/60',
                  )}
                >
                  {p ? (
                    <>
                      <div className="relative">
                        <Avatar avatar={p.avatar} size={56} className={cls(!p.connected && 'opacity-40 grayscale')} />
                        {p.isHost && (
                          <span className="absolute -right-2 -top-2 rounded-full bg-champagne px-1.5 text-[10px] font-bold text-midnight" title="Host">
                            HOST
                          </span>
                        )}
                      </div>
                      <div className="max-w-full truncate font-display font-semibold tracking-wide">
                        {p.name}
                        {p.id === session.playerId && <span className="text-cyanglow"> (you)</span>}
                      </div>
                      <div className={cls('text-[11px] font-bold uppercase tracking-[0.2em]', !p.connected ? 'text-coupred' : p.ready ? 'text-[#6fd39a]' : 'text-ivory/50')}>
                        {!p.connected ? 'Disconnected' : p.ready ? '✓ Ready' : 'Not ready'}
                      </div>
                      {isHost && p.id !== session.playerId && (
                        <button
                          onClick={() => call('room:kick', { playerId: p.id })}
                          className="absolute right-1.5 top-1.5 rounded px-1.5 text-xs text-ivory/40 hover:bg-coupred/20 hover:text-coupred"
                          aria-label={`Remove ${p.name}`}
                        >
                          ✕
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-xs uppercase tracking-[0.2em] text-ivory/30">Waiting for player…</div>
                  )}
                </motion.li>
              ))}
            </ul>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Button onClick={() => setAvatarOpen(true)}>Change avatar</Button>
              <Button variant={me?.ready ? 'ghost' : 'gold'} onClick={() => call('room:ready', { ready: !me?.ready })}>
                {me?.ready ? 'Not ready' : "I'm ready"}
              </Button>
              {isHost && (
                <>
                  <Button onClick={() => setSettingsOpen(true)}>Timers</Button>
                  <Button variant="gold" disabled={!allReady} onClick={() => call('room:start')} title={allReady ? 'Start the match' : 'All six players must be connected and ready'}>
                    Start Game
                  </Button>
                </>
              )}
            </div>
            {!allReady && (
              <p className="mt-3 text-center text-xs text-ivory/50">
                {room.players.length < PLAYER_COUNT
                  ? `Waiting for ${PLAYER_COUNT - room.players.length} more player${PLAYER_COUNT - room.players.length === 1 ? '' : 's'}. COUP needs exactly six.`
                  : 'Waiting for everyone to be ready.'}
                {!isHost && ' The host starts the match.'}
              </p>
            )}
          </Panel>

          <Panel className="p-5 text-xs text-ivory/70">
            <div className="mb-2 font-display text-sm font-bold uppercase tracking-[0.2em] text-champagne">Table settings</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {(Object.keys(TIMER_LABELS) as (keyof TimerSettings)[]).map((k) => (
                <div key={k} className="flex justify-between">
                  <span>{TIMER_LABELS[k]}</span>
                  <span className="text-ivory">{room.settings.timers[k]}s</span>
                </div>
              ))}
              <div className="col-span-2 flex justify-between sm:col-span-3">
                <span>Disconnected players</span>
                <span className="text-ivory">
                  {room.settings.disconnectPolicy === 'bot' ? `Stand-in bot after ${room.settings.botTakeoverAfter}s` : 'Timers act for them'}
                </span>
              </div>
            </div>
          </Panel>
        </div>

        <Panel className="flex h-[420px] flex-col p-4 lg:h-auto lg:max-h-[calc(100vh-48px)]">
          <div className="mb-2 font-display text-sm font-bold uppercase tracking-[0.25em] text-champagne">Lobby chat</div>
          <ChatBox className="flex-1" />
        </Panel>
      </div>

      <Modal open={avatarOpen} onClose={() => setAvatarOpen(false)} title="Choose avatar">
        <AvatarPicker
          value={me?.avatar ?? 'duke'}
          onChange={(a) => {
            void call('room:avatar', { avatar: a });
            setAvatarOpen(false);
          }}
        />
      </Modal>
      {isHost && <TimerSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} current={room.settings} onSave={(s) => call('room:settings', s)} />}
    </div>
  );
}

function TimerSettingsModal({ open, onClose, current, onSave }: { open: boolean; onClose: () => void; current: RoomSettings; onSave: (s: RoomSettings) => void }) {
  const [s, setS] = useState<RoomSettings>(current);
  return (
    <Modal open={open} onClose={onClose} title="Table timers">
      <div className="space-y-3">
        {(Object.keys(TIMER_LABELS) as (keyof TimerSettings)[]).map((k) => (
          <label key={k} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ivory/80">{TIMER_LABELS[k]}</span>
            <span className="flex items-center gap-2">
              <input
                type="range"
                min={TIMER_LIMITS[k][0]}
                max={TIMER_LIMITS[k][1]}
                value={s.timers[k]}
                onChange={(e) => setS({ ...s, timers: { ...s.timers, [k]: Number(e.target.value) } })}
                className="w-32 accent-[#d6be8c]"
              />
              <span className="w-10 text-right tabular-nums">{s.timers[k]}s</span>
            </span>
          </label>
        ))}
        <div className="deco-rule my-3" />
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ivory/80">When a player disconnects mid-match</span>
          <select
            className="input !w-auto !py-1 !text-sm"
            value={s.disconnectPolicy}
            onChange={(e) => setS({ ...s, disconnectPolicy: e.target.value as RoomSettings['disconnectPolicy'] })}
          >
            <option value="bot">Stand-in bot</option>
            <option value="wait">Timers only</option>
          </select>
        </label>
        {s.disconnectPolicy === 'bot' && (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ivory/80">Bot takes over after</span>
            <span className="flex items-center gap-2">
              <input type="range" min={15} max={300} step={15} value={s.botTakeoverAfter} onChange={(e) => setS({ ...s, botTakeoverAfter: Number(e.target.value) })} className="w-32 accent-[#d6be8c]" />
              <span className="w-10 text-right tabular-nums">{s.botTakeoverAfter}s</span>
            </span>
          </label>
        )}
        <p className="text-xs text-ivory/50">The original player can always reconnect and retake their seat.</p>
        <div className="flex justify-between gap-2 pt-3">
          <Button onClick={() => setS({ ...s, timers: { ...DEFAULT_TIMERS } })}>Defaults</Button>
          <Button
            variant="gold"
            onClick={() => {
              onSave(s);
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
