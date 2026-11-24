import { ACTION_META, ACTIONS, ROLE_META, ROLES } from '../../shared/constants';
import { GameCard } from '../components/GameCard';
import { Button, CoinIcon, DecoHeading, Panel, Slider, Toggle } from '../components/ui';
import { useSettings } from '../lib/settings';
import { useStore } from '../lib/store';
import { cls } from '../lib/util';
import { ScreenShell } from './Entry';

export function HowToPlay({ embedded = false }: { embedded?: boolean }) {
  const go = useStore((s) => s.go);
  const body = (
    <div className="space-y-8 text-sm leading-relaxed text-ivory/85">
      <section>
        <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">Goal</h3>
        <p>
          Be the last player with any <strong>influence</strong>. Each player starts with two face-down character cards (two influence) and
          two coins. Lose a card and it is flipped face-up for everyone to see. Lose both and you are <strong>exiled</strong>.
        </p>
      </section>

      <section>
        <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">The Court — 3 copies of each</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {ROLES.map((r) => (
            <div key={r} className="flex flex-col items-center text-center">
              <GameCard role={r} width={104} />
              <div className="mt-2 font-display font-bold uppercase tracking-widest" style={{ color: ROLE_META[r].accent }}>
                {ROLE_META[r].label}
              </div>
              <div className="text-xs text-ivory/70">{ROLE_META[r].ability}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">Actions</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-champagne/80">
              <tr className="border-b border-champagne/20">
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Claim</th>
                <th className="py-2 pr-3">Effect</th>
                <th className="py-2 pr-3">Challenge?</th>
                <th className="py-2">Blocked by</th>
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map((a) => {
                const m = ACTION_META[a];
                return (
                  <tr key={a} className="border-b border-white/5 align-top">
                    <td className="py-2 pr-3 font-bold text-ivory">{m.label}</td>
                    <td className="py-2 pr-3">{m.claim ? ROLE_META[m.claim].label : '—'}</td>
                    <td className="py-2 pr-3 text-ivory/75">{m.description}</td>
                    <td className="py-2 pr-3">{m.challengeable ? 'Yes' : 'No'}</td>
                    <td className="py-2">{m.blockedBy.length ? m.blockedBy.map((b) => ROLE_META[b].label).join(' / ') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3">
          With <strong>10 or more coins</strong> at the start of your turn you must launch a Coup.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">Bluffing</h3>
          <p>
            You may claim <em>any</em> character, whether or not you hold it. Nobody checks unless they challenge you. Every character action
            and every block is a claim.
          </p>
        </div>
        <div>
          <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">Challenges</h3>
          <p>
            When someone claims a character, any other surviving player may challenge. If the claimant reveals the card, the challenger loses
            an influence and the claimant shuffles that card into the Court Deck and draws a new one. If not, the claimant loses an influence
            and the claimed action or block fails.
          </p>
        </div>
        <div>
          <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">Blocks</h3>
          <p>
            Duke blocks Foreign Aid (anyone may block). Contessa blocks an assassination against you. Captain or Ambassador block a theft against
            you. Blocks can be challenged too.
          </p>
        </div>
        <div>
          <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">Money</h3>
          <p className="flex items-start gap-2">
            <CoinIcon size={22} />
            <span>
              Coin balances are public. A blocked assassination still costs 3 coins; a disproven Assassin claim gets them back. Exiled players'
              coins return to the treasury.
            </span>
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-display text-lg font-bold uppercase tracking-[0.2em] text-champagne">Digital table rules</h3>
        <ul className="list-disc space-y-1 pl-5 text-ivory/75">
          <li>Reaction windows close as soon as everyone eligible has passed. An expired timer counts as a Pass.</li>
          <li>The first challenge (or block) the server receives wins; later ones for the same claim are ignored.</li>
          <li>If your turn timer expires you take Income (or a mandatory Coup on a random opponent).</li>
          <li>If you hold only one card when you lose influence, it is revealed automatically.</li>
          <li>Keyboard: 1–7 choose actions, C challenge, P pass, Esc cancels targeting.</li>
        </ul>
      </section>
    </div>
  );
  if (embedded) return body;
  return (
    <ScreenShell onBack={() => go('menu')} wide>
      <Panel className="p-6 sm:p-10">
        <DecoHeading sub="A game of deception for exactly six players.">How to Play</DecoHeading>
        <div className="mt-8">{body}</div>
      </Panel>
    </ScreenShell>
  );
}

export function SettingsPanel() {
  const s = useSettings();
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Slider label="Music volume" value={s.musicVolume} onChange={(v) => s.update({ musicVolume: v })} />
        <Toggle label="Mute music" checked={s.musicMuted} onChange={(v) => s.update({ musicMuted: v })} />
        <Slider label="Sound effects volume" value={s.sfxVolume} onChange={(v) => s.update({ sfxVolume: v })} />
        <Toggle label="Mute sound effects" checked={s.sfxMuted} onChange={(v) => s.update({ sfxMuted: v })} />
      </div>
      <div className="deco-rule" />
      <div>
        <div className="mb-2 text-sm text-ivory/80">Animations</div>
        <div role="radiogroup" className="grid grid-cols-3 gap-2">
          {(['full', 'reduced', 'off'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={s.motion === m}
              onClick={() => s.update({ motion: m })}
              className={cls('rounded border py-2 text-xs uppercase tracking-[0.2em]', s.motion === m ? 'border-champagne bg-champagne/20 text-champagne' : 'border-white/10 text-ivory/70')}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="High-contrast interface" checked={s.highContrast} onChange={(v) => s.update({ highContrast: v })} />
    </div>
  );
}

export function SettingsScreen() {
  const go = useStore((s) => s.go);
  return (
    <ScreenShell onBack={() => go('menu')}>
      <Panel className="p-6 sm:p-8">
        <DecoHeading>Settings</DecoHeading>
        <div className="mt-6">
          <SettingsPanel />
        </div>
      </Panel>
    </ScreenShell>
  );
}

export function Credits() {
  const go = useStore((s) => s.go);
  return (
    <ScreenShell onBack={() => go('menu')}>
      <Panel className="p-6 text-center sm:p-8">
        <DecoHeading>Credits</DecoHeading>
        <div className="mt-6 space-y-4 text-sm text-ivory/80">
          <p>A digital adaptation of the social deduction card game <em>Coup</em>, designed by Rikki Tahta.</p>
          <p>Character cards, card back and coin artwork: custom illustrations supplied for this project.</p>
          <p>Backgrounds, effects and all sound effects/music: generated procedurally for this project (original, royalty-free).</p>
          <p>Fonts: Limelight and Josefin Sans (SIL Open Font License) via Google Fonts.</p>
          <p>Built with React, TypeScript, Vite, Tailwind CSS, Framer Motion, Zustand, Zod, Howler.js, Node.js, Express and Socket.IO.</p>
        </div>
        <Button className="mt-8" onClick={() => go('menu')}>
          Back to menu
        </Button>
      </Panel>
    </ScreenShell>
  );
}
