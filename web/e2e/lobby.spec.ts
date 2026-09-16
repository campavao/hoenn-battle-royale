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
    // The profile rows come first now (POK-243), so ask for the row by its name.
    await expect(guest.locator('#lobby-rows button', { hasText: 'SOLO VS BOTS' })).toBeVisible({
      timeout: 60_000,
    });

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

test('the host gets the room controls and START, and the guest does not', async ({ browser }) => {
  test.setTimeout(150_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&noauto&quick&testmon&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&noauto&quick&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });

    // The host's four controls, and the line under them saying what START would make.
    await expect(host.locator('#room-controls')).toBeVisible({ timeout: 30_000 });
    await expect(host.locator('#room-max')).toContainText('MAX');
    await expect(host.locator('#room-note')).toContainText(/START: 2 trainers/);
    await host.screenshot({ path: path.join(OUT_DIR, 'room-host.png') });

    // The guest has none of them -- just the wait.
    await expect(guest.locator('#room-controls')).toBeHidden();
    await expect(guest.locator('#room-note')).toContainText('Waiting for the host');

    // The match options are the host's too, and cycle.
    await expect(host.locator('#room-text')).toContainText('TEXT MID');
    await host.locator('#room-text').click();
    await expect(host.locator('#room-text')).toContainText('TEXT FAST');
    await host.locator('#room-fog').click();
    await expect(host.locator('#room-fog')).toContainText(/FOG \d+s/);

    // MAX cycles, and both sides hear about it (the relay owns it, not the page).
    await host.locator('#room-max').click();
    await expect(host.locator('#room-max')).toContainText('MAX 12', { timeout: 15_000 });

    // And START starts it -- which is the thing a ten-second timer used to do.
    await host.locator('#room-start').click();
    for (const page of [host, guest]) {
      await page.waitForFunction(
        () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = (window as any).__br.director;
          return d ? d.state.phase !== 'idle' : false;
        },
        undefined,
        { timeout: 30_000 },
      ).catch(() => undefined); // only the host runs a director
    }
    await expect(host.locator('#room-controls')).toBeHidden({ timeout: 30_000 });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test('the lobby is where you say who you are', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/#rom=${romHashParam()}`);
  const rows = page.locator('#lobby-rows button');
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });

  // Your name is the first row, and your sprite the second.
  const name = rows.nth(0);
  const skin = rows.nth(1);
  await expect(name).toContainText('your name');
  await expect(skin).toContainText('BRENDAN');

  // The sprite cycles through the four the ROM draws.
  await skin.click();
  await expect(skin).toContainText('MAY');

  // And the name is yours to set -- seven characters, Emerald's own limit.
  page.once('dialog', (d) => d.accept('wallyfromthegym'));
  await name.click();
  await expect(name).toContainText('WALLYFR');

  // It survives a reload, because it lives beside the record rather than in the tab.
  await page.reload();
  await expect(page.locator('#lobby-rows button').nth(0)).toContainText('WALLYFR', { timeout: 60_000 });
});

test('QUICK PLAY hosts a game when there is nothing to join', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/#rom=${romHashParam()}`);
  const quick = page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' });
  await expect(quick).toBeVisible({ timeout: 60_000 });
  await expect(quick).toBeEnabled({ timeout: 30_000 }); // the socket came up
  await quick.click();
  // The relay has nothing open, answers `no_open_rooms`, and the page hosts instead of
  // leaving somebody looking at an empty list (POK-240).
  await expect(page.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
  await page.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
});

test('a room that will not let you in offers the way back', async ({ browser }) => {
  test.setTimeout(150_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    // One tab hosts and starts, which locks the room -- the state any old link points
    // at once a match has begun.
    const host = await hostCtx.newPage();
    await host.goto(`/#host&quick&nobots&testmon&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');
    await host.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__br?.director !== undefined,
      undefined,
      { timeout: 60_000 },
    );
    await host.evaluate(() => {
      // START's own effect: shut the door.
      (window as unknown as { __br: { bridge: { relay: { lockRoom(b: boolean): void } } } }).__br.bridge.relay.lockRoom(true);
    });

    // Somebody follows the old link. The door is shut, and the page says so and offers
    // a way out rather than leaving them on a dead end.
    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&rom=${rom}`);
    await expect(guest.locator('#room-code')).toContainText('locked', { timeout: 60_000 });
    const back = guest.locator('#room-note button', { hasText: 'BACK TO LOBBY' });
    await expect(back).toBeVisible();

    // And it works: the lobby, with the room gone from the URL.
    await back.click();
    await expect(guest.locator('#lobby-rows button', { hasText: 'SOLO VS BOTS' })).toBeVisible({
      timeout: 60_000,
    });
    expect(new URL(guest.url()).hash).not.toContain('join=');
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
