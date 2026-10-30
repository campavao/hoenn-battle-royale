// Spike B (/spike-b/), the game the old overworld is being swapped for, played the way a
// player gets to it: no ROM on the device yet, PICK ROM, the menu, a hosted room with
// bots, START, and the match through to its results. Nothing here presses a key in the
// match: catching nothing in the Safari puts the player out at the drop (the rule), so
// the spec watches the rest and checks what a player who is out sees.
import { test, expect, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Presses a room option until its label reads `want` (each press steps it once). */
async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 6 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

test('a new player picks a ROM on spike B itself and gets the menu', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/spike-b/');
  await expect(page.locator('#pick-rom')).toBeVisible({ timeout: 60_000 });
  await page.locator('#rom-input').setInputFiles(romPath());
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 90_000 });
  // Stored: the next visit goes straight to the menu.
  await page.reload();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#pick-rom')).toHaveCount(0);
});

test('a hosted room with bots plays through to its results', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto(`/spike-b/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await expect(page.locator('#room-start')).toBeVisible({ timeout: 30_000 });
  await setOption(page, 'room-fog', 'FOG 30s');
  await setOption(page, 'room-safari', 'SAFARI 60s');
  await expect(page.locator('#room-start')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#room-start').click();

  // The Safari, then out at the drop with nothing caught: watching somebody.
  const spike = (f: string) => page.evaluate((f) => (window as unknown as { __spike: Record<string, unknown> }).__spike[f], f);
  await expect.poll(() => spike('isOut'), { timeout: 120_000 }).toBe(true);
  await expect.poll(() => spike('spectating'), { timeout: 30_000 }).toBeTruthy();

  // The match ends for everybody, and the results say where the player came.
  await expect(page.locator('#results-panel')).toBeVisible({ timeout: 480_000 });
  await expect(page.locator('#results-standings')).toBeVisible();
  await expect(page.locator('#results-line')).toContainText(/of \d+/);
});
