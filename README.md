# COUP — Six-Player Online

A real-time, browser-based adaptation of the social deduction card game **Coup**, for 2–6 players on separate devices. It includes private rooms, a full rules engine, bluffing, challenges, blocks, reconnection, a practice mode against bots, and a retro-futuristic Art Deco presentation built from the supplied card and coin artwork.

## Quick start

Requires **Node.js 20+**.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies Socket.IO to the game server on port 3001. To play with friends on your LAN during development, open `http://<your-ip>:5173` on each device.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Game server (tsx watch, :3001) and Vite client (:5173) together |
| `npm test` | Vitest: engine rules, edge cases, bot simulations, fuzzing, six-client Socket.IO matches |
| `npm run test:e2e` | Playwright: six browsers create a room, play a full match through the UI, and rematch |
| `npm run typecheck` | TypeScript check for client, server and shared code |
| `npm run build` | Typecheck, build the client into `dist/` and compile the server into `dist-server/` |
| `npm start` | Production server: serves `dist/` and Socket.IO on `$PORT` (default 3001) |

Before the first e2e run on a new machine, install the browser with `npx playwright install chromium`.

## Production deployment

```bash
npm ci
```

```bash
npm run build
```

```bash
PORT=8080 NODE_ENV=production node dist-server/server/index.js
```

**Render:** create a *Web Service* (not a Static Site), or use the included `render.yaml` Blueprint. Use the build command `npm install && npm run build` and the start command `npm start`. Build tools (Vite, TypeScript, Tailwind) are regular dependencies, so the build also works when the host sets `NODE_ENV=production`.

One Node process serves the static client, the WebSocket endpoint and `/healthz`. Deployment notes:

- **WebSockets must be allowed** by your proxy or host. Render, Railway, Fly.io and any VPS behind nginx all work. For nginx, pass the `Upgrade` and `Connection` headers on `/socket.io/`.
- **Run a single instance.** Rooms live in memory. If you need several instances, add sticky sessions and the Socket.IO Redis adapter, and move room state to a shared store.
- **Use HTTPS in production.** Clipboard copy and other browser APIs need a secure context.
- **Serving the client separately:** if the client is on another origin (e.g. a CDN), build it with `VITE_SERVER_URL=https://your-server` and set `CLIENT_ORIGIN` on the server.

See `.env.example` for every variable.

## Project layout

```
public/assets/          prepared art: cards, coins, backgrounds, icons/avatars, sounds, effects
src/shared/             framework-free code shared by server, client and tests
  engine.ts             authoritative finite-state rules engine (the single source of truth)
  bot.ts                AI opponents (easy / medium / hard)
  schemas.ts            Zod validation for every network message
  constants.ts types.ts rng.ts
src/server/             Express + Socket.IO: rooms, sessions, timers, bots, reconnection
src/client/             React + Vite + Tailwind + Framer Motion + Zustand + Howler
tests/unit/             Vitest suites
tests/e2e/              Playwright multiplayer suite
```

## Architecture

**The server is authoritative.** Each match is a `CoupEngine` instance on the server. Clients send *intents* (`{actionId, promptId, command}`), and the engine validates them against the current phase, turn, eligibility, coins and targets. Clients never send card identities or coin balances.

**Public and private state are separate.** Each client receives the public state plus only its own hand (and its own exchange options during an Ambassador exchange). Hidden opponent slots are serialised as `{revealed:false}` with no role or card id. Tests check this on every update, both in the Socket.IO suite and from raw WebSocket frames in the browser suite.

**Finite-state machine.** Phases follow the spec: `WAITING_FOR_ACTION → ACTION_CHALLENGE_WINDOW → RESOLVING_ACTION_CHALLENGE → COUNTERACTION_WINDOW → BLOCK_CHALLENGE_WINDOW → RESOLVING_BLOCK_CHALLENGE → RESOLVING_ACTION → WAITING_FOR_INFLUENCE_SELECTION / WAITING_FOR_EXCHANGE_SELECTION → TURN_END`, plus `GAME_OVER`. `TURN_START`, `ACTION_DECLARED`, `BLOCK_DECLARED` and `TURN_END` are transient: the engine passes through them in the same tick. Influence losses go into a queue, and after the queue resolves the engine follows an explicit continuation (continue to blocks, execute, block succeeds, or end turn). This is how one assassination can cost a player both cards.

**Stale and duplicate protection.** Every decision window has a `promptId`, and a command for an older prompt is rejected. Every command has a unique `actionId`, and repeats are ignored. Every state has an increasing `version`, and clients drop out-of-order snapshots. A command that arrives after its deadline loses to the timer, because the engine processes the expired timer first.

**Invariants.** After every change the server checks that there are 15 cards (deck + hands + revealed + cards drawn mid-exchange) and 50 coins (treasury + balances). Simulations and fuzz tests check the same after every command.

**Animations are cosmetic.** The engine emits public events (`coins`, `challenge`, `reveal`, `coup`…), which drive the effects layer and sounds. The rendered state always comes from the latest server snapshot.

## Rules clarifications (deterministic digital rulings)

0. **Table size:** 2–6 players. The host can start once at least two players are connected and ready. Practice mode takes 1–5 bots. The standard rules apply at every size; the deck always holds 15 cards (3 per character), so the Court Deck holds 15 − 2 × players.

1. **Competing responses:** the server handles messages one at a time. The first valid challenge or block to arrive closes that window, and later responses to the same prompt are rejected. For Foreign Aid, the first Duke claim is the block.
2. **Pass** declines only the current window. A window closes as soon as every eligible player has passed, and an expired timer counts as Pass.
3. **Costs** (Coup 7, Assassinate 3) are paid to the treasury when declared. A successfully challenged Assassin claim refunds the 3 coins. A blocked assassination does not.
4. **Proof:** a challenged player may prove (reveal a matching *hidden* card, which is shuffled into the Court Deck and replaced by a secret draw) or concede. If the proof timer expires, the engine proves when the player holds the card and concedes otherwise.
5. **One card left:** losing influence reveals it automatically.
6. **Exiled players' coins** return to the treasury at the end of the turn, after any pending theft from them has been settled.
7. **Treasury shortfall:** a reward is capped at what the treasury holds, and the log says so.
8. **Timeouts:** an idle turn takes Income, or a Coup on a random opponent when the Coup is mandatory. Influence selection reveals a random hidden card. An Exchange keeps the original cards.
9. **Game end:** the match ends the instant one player has influence left, even mid-action.
10. **Rematch:** every human must vote. The previous winner starts, and all cards, coins, timers, statistics and pending actions reset.
11. **Disconnection:** the seat, hand and timers are preserved. Depending on the host's room policy, either timers keep acting for the missing player, or a stand-in bot takes over after N seconds. The player can always reconnect with their session token and take the seat back. Leaving mid-match hands the seat to a stand-in bot. If the host disconnects, hosting passes to another connected player.
12. **Bluffing:** every character action and block is always available. Actions are disabled only for turn, phase, coins, targets, elimination or the mandatory Coup.

## Bots

Bots see only what a human in their seat would see: public state, their own hand and the public event stream. They act through the same validation path as humans, after realistic thinking delays.

- **Easy:** basic economy, occasional bluffs, no deduction.
- **Medium:** card counting, a Bayesian estimate of each claim, steals from rich players who are unlikely to block, sharper targeting.
- **Hard:** adds memory of every player's claims and exposed bluffs, suspicion of players claiming too many roles, threat-based targeting, and card valuation that adapts to visible cards.

Practice mode lets you choose 1–5 bot opponents. In simulations, hard beats easy (~68%), medium beats easy (~63%), and hard beats medium (~59%). A test guards this ordering.

## Assets

The supplied sheets were split into individual transparent PNGs, normalised to 400×500 for cards and 256×256 for coins, without cropping or stretching the artwork:

- `cards/{duke,assassin,captain,ambassador,contessa,card-back}.png`. The card back's "CARD BACK" caption was repainted as a matching "COUP" plaque; the untouched original is kept as `card-back-original.png`.
- `coins/coin-front.png`, `coin-back.png`, `coin-angle.png`, and `coin-stack.png` (stacked from the angled coin).
- Avatars in `icons/` are circular crops of the supplied portraits.
- Backgrounds, the cracked-frame effect and every sound (including the music loop) are original and generated procedurally for this project.

## Accessibility

- Role names appear as text on every card, revealed card and claim chip, so roles never depend on colour alone.
- Keyboard play: `1`–`7` choose actions, `C` challenges, `P` passes, `Esc` cancels targeting.
- Focus outlines, ARIA roles and labels, and live regions for announcements.
- Animation settings (full, reduced or off; the default follows the system reduced-motion preference), a high-contrast mode, and separate music and sound-effect volume controls.
- Responsive layouts for phones in portrait and landscape, tablets and desktops.
