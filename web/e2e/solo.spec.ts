// POK-330 #42: solo keeps its books in the room's own session (match/session.ts). The
// room's specs play that session through a whole match; nothing played solo's, and solo
// is where a match once ended in complete silence -- no results, no way out but the URL.
//
// This plays a whole solo match at the dev pace, pressing nothing, and asserts the page
// draws the result and then takes the player back to the lobby by itself. Solo ignores
// `#seed` (it deals a fresh one every match), so the seed is only checked for being there.
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a solo match ends on its results, then goes back to the lobby by itself', async ({ page }) => {
  test.setTimeout(360_000);

  await page.goto(`/#solo&fast&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });

  // A whole match at the dev pace: 25s opening, 15s ring phases, bots filling the field.
  await expect(page.locator('#results-panel')).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('#results-line')).toHaveText(/seed \d+/);
  await expect(page.locator('#results-career')).toHaveText(/^1 played/);
  await expect(page.locator('#results-record')).toContainText('RINGS');

  // The round was written down, with the bots in it and every one of them out but the winner.
  const round = await page.evaluate(() => JSON.parse(localStorage.getItem('hbr:log') ?? '[]')[0]);
  expect(round.seats, 'bots filled the field').toBeGreaterThan(1);
  const outs = new Set((round.events as { t: string; seat?: number }[]).filter((e) => e.t === 'out').map((e) => e.seat));
  expect(outs.size, 'everybody but the winner went out').toBeGreaterThanOrEqual(round.seats - 1);
  // A room of one, us by our own name (POK-331 #26): the ticker and the round said P0.
  expect(round.roster[0], 'the player is named, as a room names them').not.toBe('P0');

  // Solo never opens a socket, and never gets the room's dev surface.
  expect(await page.evaluate(() => (window as unknown as { __br?: unknown }).__br !== undefined)).toBe(false);

  // Nothing is pressed from here. The grace is what has to move us.
  await expect(page.locator('#lobby-rows button', { hasText: 'SOLO VS BOTS' })).toBeVisible({ timeout: 90_000 });
  expect(new URL(page.url()).hash).not.toContain('solo');
});
