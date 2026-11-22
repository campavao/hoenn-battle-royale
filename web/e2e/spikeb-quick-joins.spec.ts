// Cam, 11-22: "let's make it so quick play joins an open lobby. maybe if there is a game in
// progress we give the player an option to WATCH or PLAY NOW." A hosted room open to anybody is
// where QUICK PLAY seats a stranger; with no lobby waiting and a match on, QUICK PLAY asks.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

type Room = { code: string; quick: boolean; playing: boolean };
const roomOf = (p: Page) => p.evaluate(() => {
  const r = (window as any).__spike?.lobby?.room;
  return r ? { code: r.code, quick: r.quick, playing: r.playing } as Room : null;
});
/** The room whose match this page is in (playing or watching), or null on a menu or lobby. */
const matchOf = (p: Page) => p.evaluate(() => {
  const s = (window as any).__spike;
  return s?.link ? (s.room?.code as string | undefined) ?? null : null;
});

async function menu(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeEnabled({ timeout: 90_000 });
  return page;
}

test('QUICK PLAY joins an open hosted lobby; with a match on it asks WATCH or PLAY NOW', async ({ browser }) => {
  test.setTimeout(300_000);
  const pages: Page[] = [];
  try {
    // A host's lobby, open to anybody (the default door), waiting for its START.
    const host = await menu(browser);
    pages.push(host);
    await host.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click();
    await expect.poll(() => roomOf(host), { timeout: 30_000 }).toMatchObject({ quick: false, playing: false });
    const code = (await roomOf(host))!.code;

    // QUICK PLAY: into that lobby, not a quick room of its own.
    const guest = await menu(browser);
    pages.push(guest);
    await guest.locator('#lobby-rows button', { hasText: 'QUICK PLAY' }).click();
    await expect.poll(() => roomOf(guest), { timeout: 30_000 }).toMatchObject({ code, quick: false });

    // The host starts; now nothing is waiting and a match is on.
    await host.locator('#room-start').click({ timeout: 30_000 });
    await expect.poll(() => matchOf(host), { timeout: 60_000 }).toBe(code);

    // QUICK PLAY asks: WATCH goes into the match.
    const watcher = await menu(browser);
    pages.push(watcher);
    await watcher.locator('#lobby-rows button', { hasText: 'QUICK PLAY' }).click();
    await expect(watcher.locator('#running-watch')).toBeVisible({ timeout: 30_000 });
    await expect(watcher.locator('#running-play')).toBeVisible();
    await watcher.screenshot({ path: test.info().outputPath('quick-running.png') });
    await watcher.locator('#running-watch').click();
    await expect.poll(() => matchOf(watcher), { timeout: 60_000 }).toBe(code);

    // ...and PLAY NOW makes a quick lobby instead, with its count.
    const player = await menu(browser);
    pages.push(player);
    await player.locator('#lobby-rows button', { hasText: 'QUICK PLAY' }).click();
    await player.locator('#running-play').click({ timeout: 30_000 });
    await expect.poll(() => roomOf(player), { timeout: 30_000 }).toMatchObject({ quick: true, playing: false });
    expect((await roomOf(player))!.code).not.toBe(code);
    await expect(player.locator('#room-code')).toHaveText('QUICK PLAY');
  } finally {
    for (const p of pages) await p.context().close();
  }
});
