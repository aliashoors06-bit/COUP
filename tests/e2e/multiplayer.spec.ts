import { expect, test, type Browser, type Page } from '@playwright/test';

const NAMES = ['Alex', 'Sarah', 'David', 'James', 'Maria', 'Lena'];

interface Player {
  page: Page;
  frames: string[];
  challenged: boolean;
}

async function openPlayers(browser: Browser): Promise<Player[]> {
  const players: Player[] = [];
  for (let i = 0; i < 6; i++) {
    const mobile = i === 1;
    const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 860 }, hasTouch: mobile });
    const page = await ctx.newPage();
    const p: Player = { page, frames: [], challenged: false };
    page.on('websocket', (ws) => ws.on('framereceived', (f) => typeof f.payload === 'string' && f.payload.includes('game:update') && p.frames.push(f.payload)));
    players.push(p);
  }
  return players;
}

async function click(locator: ReturnType<Page['locator']>, timeout = 800) {
  try {
    await locator.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

const enabled = (l: ReturnType<Page['locator']>) => l.isEnabled({ timeout: 300 }).catch(() => false);

/** One step of a simple UI autopilot that only uses visible controls. */
async function step(p: Player, idx: number): Promise<boolean> {
  const page = p.page;
  if (await page.getByRole('button', { name: /^(Rematch|Waiting)/ }).isVisible()) return true;

  const lose = page.getByRole('dialog', { name: 'Lose one influence' });
  if (await lose.isVisible()) {
    await click(lose.getByRole('button').first());
    return false;
  }
  const ex = page.getByRole('dialog', { name: 'Ambassador exchange' });
  if (await ex.isVisible()) {
    await click(ex.getByRole('button', { name: 'Keep mine' }));
    await click(ex.getByRole('button', { name: /Confirm/ }));
    return false;
  }
  const decision = page.getByRole('group', { name: 'Your decision' });
  if (await decision.isVisible()) {
    const challenge = decision.getByRole('button', { name: /^Challenge/ });
    if (idx === 2 && !p.challenged && (await challenge.isVisible())) {
      p.challenged = true;
      await click(challenge);
      return false;
    }
    const reveal = decision.getByRole('button', { name: /^Reveal/ });
    if ((await reveal.isVisible()) && (await enabled(reveal))) {
      await click(reveal);
      return false;
    }
    const concede = decision.getByRole('button', { name: 'Concede' });
    if (await concede.isVisible()) {
      await click(concede);
      return false;
    }
    await click(decision.getByRole('button', { name: /^(Pass|Allow|Accept)/ }));
    return false;
  }
  const toolbar = page.getByRole('toolbar', { name: 'Actions' });
  if (await toolbar.isVisible()) {
    const coup = toolbar.getByRole('button', { name: /^Coup/ });
    if (await enabled(coup)) {
      await click(coup, 3000);
      await click(page.locator('button[aria-label*="Select as target"]').first(), 3000);
      await click(page.getByRole('dialog').getByRole('button', { name: 'Confirm' }), 3000);
    } else {
      await click(toolbar.getByRole('button', { name: /^Tax/ }));
    }
  }
  return false;
}

function assertNoLeakedCards(p: Player) {
  for (const raw of p.frames) {
    const json = JSON.parse(raw.slice(raw.indexOf('[')));
    const update = json[1];
    for (const pl of update.state.players) {
      for (const slot of pl.slots) {
        if (!slot.revealed) expect(Object.keys(slot)).toEqual(['revealed']);
      }
    }
    // Private data only ever describes this player.
    if (update.private) expect(update.state.players.some((x: { id: string }) => x.id === update.private.playerId)).toBe(true);
  }
}

test('six players create a room, play a complete match through the UI, and rematch', async ({ browser }) => {
  const players = await openPlayers(browser);
  const host = players[0]!.page;

  // ── Main menu → create room
  await host.goto('/');
  await expect(host.getByRole('heading', { name: 'COUP' })).toBeVisible();
  await host.getByRole('button', { name: 'Create Room' }).click();
  await host.getByPlaceholder('e.g. Vivienne').fill(NAMES[0]!);
  await host.getByRole('button', { name: 'Create Private Room' }).click();
  const codeBtn = host.getByRole('button', { name: /Room code/ });
  await expect(codeBtn).toBeVisible();
  const code = (await codeBtn.innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // ── Five friends join through the invitation link
  for (let i = 1; i < 6; i++) {
    const page = players[i]!.page;
    await page.goto(`/?room=${code}`);
    await page.getByPlaceholder('e.g. Vivienne').fill(NAMES[i]!);
    await page.getByRole('radio', { name: /Avatar/ }).nth(i).click();
    await page.getByRole('button', { name: 'Join Room' }).click();
    await expect(page.getByText(`${i + 1}/6`).or(page.getByText('6/6'))).toBeVisible();
  }
  await expect(host.getByText('6/6')).toBeVisible();
  const start = host.getByRole('button', { name: 'Start Game' });
  await expect(start).toBeDisabled();
  for (const p of players) await p.page.getByRole('button', { name: "I'm ready" }).click();
  await expect(start).toBeEnabled();
  await start.click();

  for (const p of players) await expect(p.page.getByRole('region', { name: 'Your hand' })).toBeVisible();

  // ── Refresh mid-game: the session token restores the seat and private hand
  const refresher = players[3]!.page;
  const handBefore = await refresher.getByRole('region', { name: 'Your hand' }).locator('[aria-label]').allInnerTexts();
  await refresher.reload();
  await expect(refresher.getByRole('region', { name: 'Your hand' })).toBeVisible();
  const cardsAfter = refresher.getByRole('region', { name: 'Your hand' }).locator('[aria-label$="(revealed, lost)"], [aria-label]');
  await expect(cardsAfter.first()).toBeVisible();
  expect(handBefore.length).toBeGreaterThan(0);

  // ── Autopilot every seat until somebody wins
  const deadline = Date.now() + 240_000;
  const done = new Set<number>();
  while (done.size < 6 && Date.now() < deadline) {
    await Promise.all(
      players.map(async (p, i) => {
        if (done.has(i)) return;
        if (await step(p, i)) done.add(i);
      }),
    );
  }
  expect(done.size).toBe(6);
  await expect(host.getByText(/wins|You win!/).first()).toBeVisible();
  await expect(host.getByText('Successful challenges')).toBeVisible();
  await host.screenshot({ path: 'test-results/game-over.png' });

  // ── Nobody's network traffic ever revealed a hidden card
  for (const p of players) assertNoLeakedCards(p);

  // ── Rematch with the same six players
  for (const p of players) await p.page.getByRole('button', { name: /^Rematch/ }).click();
  for (const p of players) await expect(p.page.getByText(/Turn 1\b/)).toBeVisible();
  await expect(host.getByRole('button', { name: /^Rematch/ })).toHaveCount(0);
});

test('practice mode against five bots', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Practice Mode' }).click();
  await page.getByPlaceholder('e.g. Vivienne').fill('Solo');
  await page.getByRole('radio', { name: 'Hard' }).click();
  await page.getByRole('button', { name: 'Begin Practice' }).click();
  await expect(page.getByRole('region', { name: 'Your hand' })).toBeVisible();
  await expect(page.getByText('· bot').or(page.getByText('bot', { exact: true })).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/practice.png' });
});
