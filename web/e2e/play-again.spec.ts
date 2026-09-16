// POK-258: PLAY AGAIN keeps the room together.
//
// The end of a match used to scatter it. START locks the room so latecomers cannot walk
// into a running match, and nothing unlocked it afterwards, so the only way out was the
// lobby -- eight people who had just played together, each alone on a menu.
//
// This runs a whole match at `#fast` with one human and bots, waits for the result,
// presses PLAY AGAIN, and asserts the client is still in the same room with its code,
// its roster and a socket -- and that the room's door is open again.
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrWindow = { __br: any };

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('PLAY AGAIN keeps the room, the code and the roster', async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto(`/#host&fast&seed=20260916&testmon&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
  const codeEl = page.locator('#room-code');
  await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
  const code = await codeEl.textContent();

  // A whole match at the dev pace: 25s opening, 15s ring phases, bots filling the room.
  await expect(page.locator('#results-panel')).toBeVisible({ timeout: 240_000 });

  await page.locator('#play-again').click();

  // Back in the room, not on the lobby: same code, same socket, results put away.
  await expect(page.locator('#results-panel')).toBeHidden({ timeout: 60_000 });
  await expect(codeEl).toHaveText(code ?? '', { timeout: 30_000 });
  const stillConnected = await page.evaluate(() => (window as unknown as BrWindow).__br?.bridge !== undefined);
  expect(stillConnected, 'the socket survived the replay').toBe(true);

  // And the ROM really did start over: the mailbox comes back up from power-on.
  await page.waitForFunction(
    () => (window as unknown as BrWindow).__br.mailbox.isAwake() === true,
    undefined,
    { timeout: 60_000 },
  );

  // The host can deal another match: START is on the panel again.
  await expect(page.locator('#room-start')).toBeVisible({ timeout: 30_000 });
});
