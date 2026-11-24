import { useEffect, useRef, useState } from 'react';
import { QUICK_REACTIONS } from '../../shared/schemas';
import type { LogEntry } from '../../shared/types';
import { request } from '../lib/socket';
import { useStore } from '../lib/store';
import { cls } from '../lib/util';

export function ChatBox({ className, compact }: { className?: string; compact?: boolean }) {
  const chat = useStore((s) => s.chat);
  const me = useStore((s) => s.session?.playerId);
  const muted = useStore((s) => s.muted);
  const toggleMute = useStore((s) => s.toggleMute);
  const toast = useStore((s) => s.toast);
  const markRead = useStore((s) => s.markChatRead);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    markRead();
  }, [chat.length, markRead]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    const res = await request('room:chat', { text: t });
    if (!res.ok) toast(res.error ?? 'Message not sent', 'error');
  };
  const react = async (emoji: string) => {
    const res = await request('room:reaction', { emoji });
    if (!res.ok) toast(res.error ?? 'Slow down', 'error');
  };

  return (
    <div className={cls('flex min-h-0 flex-col', className)}>
      <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm" aria-live="polite">
        {chat.length === 0 && <div className="py-6 text-center text-xs text-ivory/40">No messages yet. Negotiate, persuade, deceive.</div>}
        {chat.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="text-center text-[11px] italic text-champagne/60">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="group flex items-start gap-1.5">
              <span className={cls('shrink-0 font-bold', m.playerId === me ? 'text-cyanglow' : 'text-champagne')}>{m.name}:</span>
              <span className={cls('break-words text-ivory/90', m.kind === 'reaction' && 'text-xl leading-none')}>{m.text}</span>
              {m.playerId !== me && (
                <button
                  onClick={() => toggleMute(m.playerId)}
                  className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-ivory/30 opacity-0 transition hover:text-coupred focus:opacity-100 group-hover:opacity-100"
                  aria-label={`${muted.includes(m.playerId) ? 'Unmute' : 'Mute'} ${m.name}`}
                >
                  {muted.includes(m.playerId) ? 'unmute' : 'mute'}
                </button>
              )}
            </div>
          ),
        )}
      </div>
      <div className={cls('mt-2 flex flex-wrap gap-1', compact && 'hidden sm:flex')}>
        {QUICK_REACTIONS.map((e) => (
          <button key={e} onClick={() => react(e)} className="rounded px-1.5 py-0.5 text-lg transition hover:scale-125 hover:bg-white/5" aria-label={`React ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <form onSubmit={send} className="mt-2 flex gap-2">
        <input
          className="input !py-2 !text-sm"
          value={text}
          maxLength={200}
          placeholder="Say something…"
          aria-label="Chat message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="submit" className="btn btn-ghost !min-h-0 !px-4 !py-2 !text-xs" disabled={!text.trim()}>
          Send
        </button>
      </form>
      {muted.length > 0 && (
        <div className="mt-1 text-[10px] text-ivory/40">
          {muted.length} muted ·{' '}
          <button className="underline" onClick={() => muted.forEach(toggleMute)}>
            unmute all
          </button>
        </div>
      )}
    </div>
  );
}

const LOG_COLORS: Record<LogEntry['kind'], string> = {
  action: 'text-ivory/90',
  claim: 'text-champagne',
  challenge: 'text-[#ff8a8f]',
  block: 'text-[#9fd0ff]',
  loss: 'text-[#f0a9b6]',
  coins: 'text-silver',
  system: 'text-ivory/50 italic',
  elimination: 'text-coupred font-bold',
  victory: 'text-champagne font-bold',
};

export function GameLog({ log, className }: { log: LogEntry[]; className?: string }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [log.length]);
  return (
    <ol ref={ref} className={cls('scrollbar-thin space-y-1 overflow-y-auto pr-1 text-[13px] leading-snug', className)} aria-label="Game log">
      {log.map((l) => (
        <li key={l.id} className={LOG_COLORS[l.kind]}>
          {l.text}
        </li>
      ))}
    </ol>
  );
}
