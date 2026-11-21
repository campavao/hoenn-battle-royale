// Cam, 11-21: "make it so quick play lobbies show up on the lobby page". A quick room waiting
// for its count used to be left off LOBBIES (only a hosted one, or a match under way, showed):
// now it is a QUICK PLAY row with its seats and its count, and pressing it seats you in it.
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a quick room waiting for its start is on LOBBIES, and its row seats you in it', async ({ browser }) => {
  test.setTimeout(180_000);
  const [qc, gc] = [await browser.newContext(), await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })];
  try {
    const quick = await qc.newPage();
    await quick.goto(`/?rom=${romHashParam()}`);
    const play = quick.locator('#lobby-rows button', { hasText: 'QUICK PLAY' });
    await expect(play).toBeEnabled({ timeout: 90_000 });
    await play.click();
    // A quick room's head says QUICK PLAY, not its code: the page knows it.
    const roomCode = (p: typeof quick) => p.evaluate(() => (window as any).__spike?.lobby?.room?.code as string | undefined);
    await expect.poll(() => roomCode(quick), { timeout: 60_000 }).toMatch(/^[A-Z0-9]{6}$/);
    const code = (await roomCode(quick))!;

    const guest = await gc.newPage();
    await guest.goto(`/?rom=${romHashParam()}`);
    const lobbies = guest.locator('#lobby-rows button', { hasText: 'LOBBIES' });
    await expect(lobbies).toBeEnabled({ timeout: 90_000 });
    await lobbies.click();
    // QUICK PLAY, not the first trainer's name: of its 30 seats, and its count to the start.
    const row = guest.locator(`#lobbies-${code}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('QUICK PLAY');
    await expect(row).toContainText(/1\/30 · \d:\d\d/);
    await guest.screenshot({ path: test.info().outputPath('lobbies-quick.png') });
    await row.click();
    await expect.poll(() => roomCode(guest), { timeout: 30_000 }).toBe(code);
    await expect(guest.locator('#room-code')).toHaveText('QUICK PLAY');
  } finally {
    await qc.close();
    await gc.close();
  }
});
