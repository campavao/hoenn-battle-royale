// The lobby is the front door (POK-240): with no hash, the page offers the ways into a
// match rather than starting one. What matters here is that the rows are real -- SOLO
// works with no socket, a hosted room shows up in somebody else's list, and pressing it
// puts them in it -- not how any of it is styled.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('the lobby lists a room somebody else is hosting, and joining it seats you', async ({ browser }) => {
  test.setTimeout(120_000);
  const rom = romHashParam();

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    // Somebody hosts. `#noauto` holds the room open so it is still listed when the
    // other tab looks -- otherwise the director starts it and the relay locks it.
    const host = await hostCtx.newPage();
    await host.goto(`/#host&noauto&nobots&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    // And somebody else opens the page with no hash at all.
    const guest = await guestCtx.newPage();
    await guest.goto(`/#rom=${rom}`);
    const rows = guest.locator('#lobby-rows button');
    await expect(rows.first()).toContainText('SOLO VS BOTS', { timeout: 60_000 });

    // The room is on the list, named by its host, with its count.
    const room = guest.locator('#lobby-rooms button').first();
    await expect(room).toBeVisible({ timeout: 30_000 });
    // One trainer in it, out of the relay's seat count: the row is a live count, not
    // a placeholder.
    await expect(room).toContainText(/1\/\d+/);
    await guest.screenshot({ path: path.join(OUT_DIR, 'lobby.png') });

    // Pressing it joins that room -- same code, and the ROM boots into it.
    await room.click();
    await expect(guest.locator('#room-code')).toHaveText(new RegExp(`Room ${code}`), { timeout: 60_000 });
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
    await expect(host.locator('#room-roster li')).toHaveCount(2, { timeout: 30_000 });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test('SOLO VS BOTS opens no socket', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/#rom=${romHashParam()}`);
  const solo = page.locator('#lobby-rows button', { hasText: 'SOLO VS BOTS' });
  await expect(solo).toBeVisible({ timeout: 60_000 });
  await solo.click();
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 30_000 });
  // The lobby's own browsing socket is closed on the way out, and the room one is
  // never opened: `__br` is the Bridge, and solo never builds one.
  expect(await page.evaluate(() => (window as unknown as { __br?: unknown }).__br !== undefined)).toBe(false);
  expect(new URL(page.url()).hash).toContain('solo');
});
