import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { Difficulty } from '../../shared/constants';
import { AvatarPicker, Button, DecoHeading, Panel } from '../components/ui';
import { useStore } from '../lib/store';
import { useSettings } from '../lib/settings';
import { cls } from '../lib/util';

export function ScreenShell({ children, onBack, wide }: { children: ReactNode; onBack?: () => void; wide?: boolean }) {
  return (
    <div className="relative flex min-h-full items-start justify-center overflow-y-auto px-4 py-8 sm:items-center">
      <div className="menu-bg fixed inset-0 opacity-40" />
      <div className="fixed inset-0 bg-gradient-to-b from-black/70 to-black/90" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className={cls('relative z-10 w-full', wide ? 'max-w-4xl' : 'max-w-lg')}
      >
        {onBack && (
          <button onClick={onBack} className="mb-3 text-sm uppercase tracking-[0.2em] text-champagne/80 hover:text-champagne">
            ← Back
          </button>
        )}
        {children}
      </motion.div>
    </div>
  );
}

function useIdentity() {
  const { lastName, lastAvatar, update } = useSettings();
  const [name, setName] = useState(lastName);
  const [avatar, setAvatar] = useState(lastAvatar);
  const persist = () => update({ lastName: name.trim(), lastAvatar: avatar });
  return { name, setName, avatar, setAvatar, persist };
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs uppercase tracking-[0.25em] text-champagne/80">Display name</span>
      <input className="input" value={value} maxLength={16} autoComplete="nickname" placeholder="e.g. Vivienne" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function CreateRoomScreen() {
  const { go, createRoom, toast, busy, connected } = useStore();
  const id = useIdentity();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    id.persist();
    const res = await createRoom(id.name, id.avatar);
    if (!res.ok) toast(res.error ?? 'Could not create the room', 'error');
  };
  return (
    <ScreenShell onBack={() => go('menu')}>
      <Panel className="p-6 sm:p-8">
        <DecoHeading sub="Open a private court for 2–6 players.">Create Room</DecoHeading>
        <form onSubmit={submit} className="mt-6 space-y-6">
          <NameField value={id.name} onChange={id.setName} />
          <div>
            <span className="mb-3 block text-xs uppercase tracking-[0.25em] text-champagne/80">Avatar</span>
            <AvatarPicker value={id.avatar} onChange={id.setAvatar} />
          </div>
          <Button variant="gold" type="submit" className="w-full" disabled={!id.name.trim() || busy || !connected}>
            {connected ? 'Create Private Room' : 'Connecting…'}
          </Button>
        </form>
      </Panel>
    </ScreenShell>
  );
}

export function JoinRoomScreen() {
  const { go, joinRoom, toast, busy, inviteCode, connected } = useStore();
  const id = useIdentity();
  const [code, setCode] = useState(inviteCode ?? '');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    id.persist();
    const res = await joinRoom(id.name, id.avatar, code);
    if (!res.ok) toast(res.error ?? 'Could not join the room', 'error');
  };
  return (
    <ScreenShell onBack={() => go('menu')}>
      <Panel className="p-6 sm:p-8">
        <DecoHeading sub={inviteCode ? 'You have been invited to a private court.' : 'Enter the six-character code from your host.'}>Join Room</DecoHeading>
        <form onSubmit={submit} className="mt-6 space-y-6">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.25em] text-champagne/80">Room code</span>
            <input
              className="input text-center font-deco text-3xl tracking-[0.5em] uppercase"
              value={code}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="······"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
          <NameField value={id.name} onChange={id.setName} />
          <div>
            <span className="mb-3 block text-xs uppercase tracking-[0.25em] text-champagne/80">Avatar</span>
            <AvatarPicker value={id.avatar} onChange={id.setAvatar} />
          </div>
          <Button variant="gold" type="submit" className="w-full" disabled={!id.name.trim() || code.length !== 6 || busy || !connected}>
            {connected ? 'Join Room' : 'Connecting…'}
          </Button>
        </form>
      </Panel>
    </ScreenShell>
  );
}

const DIFFS: { id: Difficulty; label: string; desc: string }[] = [
  { id: 'easy', label: 'Easy', desc: 'Basic economy, occasional bluffs, little deduction.' },
  { id: 'medium', label: 'Medium', desc: 'Strategic stealing, selective challenges, sharper targeting.' },
  { id: 'hard', label: 'Hard', desc: 'Card counting, claim memory and bluff probability estimates.' },
];

export function PracticeScreen() {
  const { go, startPractice, toast, busy, connected } = useStore();
  const id = useIdentity();
  const [diff, setDiff] = useState<Difficulty>('medium');
  const [bots, setBots] = useState(5);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    id.persist();
    const res = await startPractice(id.name, id.avatar, diff, bots);
    if (!res.ok) toast(res.error ?? 'Could not start practice', 'error');
  };
  return (
    <ScreenShell onBack={() => go('menu')}>
      <Panel className="p-6 sm:p-8">
        <DecoHeading sub="You against 1–5 computer-controlled courtiers. Same rules, no peeking.">Practice</DecoHeading>
        <form onSubmit={submit} className="mt-6 space-y-6">
          <NameField value={id.name} onChange={id.setName} />
          <div>
            <span className="mb-3 block text-xs uppercase tracking-[0.25em] text-champagne/80">Avatar</span>
            <AvatarPicker value={id.avatar} onChange={id.setAvatar} />
          </div>
          <div role="radiogroup" aria-label="Difficulty" className="grid gap-2 sm:grid-cols-3">
            {DIFFS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={diff === d.id}
                onClick={() => setDiff(d.id)}
                className={cls(
                  'rounded border p-3 text-left transition',
                  diff === d.id ? 'border-champagne bg-champagne/15' : 'border-white/10 bg-black/30 hover:border-champagne/40',
                )}
              >
                <div className="font-display font-bold uppercase tracking-[0.2em] text-champagne">{d.label}</div>
                <div className="mt-1 text-xs leading-snug text-ivory/70">{d.desc}</div>
              </button>
            ))}
          </div>
          <div>
            <span className="mb-3 block text-xs uppercase tracking-[0.25em] text-champagne/80">Opponents</span>
            <div role="radiogroup" aria-label="Number of bot opponents" className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={bots === n}
                  aria-label={`${n} bot${n === 1 ? '' : 's'}`}
                  onClick={() => setBots(n)}
                  className={cls('rounded border py-2 font-deco text-xl transition', bots === n ? 'border-champagne bg-champagne/15 text-champagne' : 'border-white/10 bg-black/30 text-ivory/70 hover:border-champagne/40')}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <Button variant="gold" type="submit" className="w-full" disabled={!id.name.trim() || busy || !connected}>
            {connected ? 'Begin Practice' : 'Connecting…'}
          </Button>
        </form>
      </Panel>
    </ScreenShell>
  );
}
