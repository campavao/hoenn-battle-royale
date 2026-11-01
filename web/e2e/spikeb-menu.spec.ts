// The new game's menu and page: SEND FEEDBACK, HOW TO PLAY, the line a missing chunk gets,
// and the layout on a phone and a desktop. The live match's feedback, howto, chunk-reload and
// phone specs went with its page; these are the same promises on /.
import { devices, expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

const PHONE = { viewport: devices['Pixel 7'].viewport, isMobile: true, hasTouch: true };
const quickPlay = (page: Page) => page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' });

test('SEND FEEDBACK reaches the relay and comes back to the menu', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(quickPlay(page)).toBeVisible({ timeout: 90_000 });
  await page.locator('#lobby-feedback').tap();
  await expect(page.locator('#feedback-send'), 'nothing to send yet').toBeDisabled();
  await page.locator('#feedback-text').fill('a note from the new game');
  await expect(page.locator('#feedback-send')).toBeEnabled();
  await page.locator('#feedback-send').tap();
  await expect(page.locator('#feedback-note')).toHaveText('Sent. Thank you!', { timeout: 15_000 });
  await page.locator('#feedback-back').tap();
  await expect(quickPlay(page)).toBeVisible();
  await ctx.close();
});

test('HOW TO PLAY pages through its panels and back to the menu', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(quickPlay(page)).toBeVisible({ timeout: 90_000 });
  await page.locator('#lobby-howto').tap();
  await expect(page.locator('#howto-heading')).toHaveText('Start in Safari');
  // A moving picture on a panel redraws its buttons, so Playwright's wait for a still one
  // never ends: the press goes straight to the element.
  const press = (id: string) => page.evaluate((id) => document.getElementById(id)?.click(), id);
  for (let i = 0; i < 20 && (await page.locator('#howto-next').count()); i++) { await press('howto-next'); await page.waitForTimeout(150); }
  await press('howto-done');
  await expect(quickPlay(page)).toBeVisible();
  await ctx.close();
});

test("a chunk that won't load: one tap-to-reload line, and the tap reloads", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(quickPlay(page)).toBeVisible({ timeout: 90_000 });
  // What Vite's preload helper fires when a release took the page's hashed files away.
  const fail = () => page.evaluate(() => dispatchEvent(new Event('vite:preloadError')));
  await fail();
  await fail();
  const line = page.locator('#chunk-reload');
  await expect(line).toHaveText("Part of the game didn't load. Tap to reload.");
  await expect(line).toHaveCount(1);
  await Promise.all([page.waitForEvent('load'), line.tap()]);
  await expect(line).toHaveCount(0);
  await ctx.close();
});

/** A match of the page's own, on the field. */
async function inMatch(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { rom?: unknown; link?: { me: number; room: { actor(id: number): unknown } } } }).__spike;
    return !!s?.rom && !!s.link?.room.actor(s.link.me);
  }, undefined, { timeout: 120_000 });
}

const boxOf = (page: Page, sel: string) => page.locator(sel).boundingBox();

test('a phone gets the map and both thumbs, either way up; a desktop gets the keys and no pad', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await inMatch(page);
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(500);
    const world = (await boxOf(page, '#world'))!;
    const pad = (await boxOf(page, '#dpad-surface'))!;
    expect(world.width * world.height, `${size.width}x${size.height}: the map fills the glass`).toBeGreaterThan(size.width * size.height * 0.5);
    expect(pad.x, 'the pad is on the glass').toBeGreaterThanOrEqual(0);
    expect(pad.x + pad.width).toBeLessThanOrEqual(size.width);
    expect(pad.y + pad.height).toBeLessThanOrEqual(size.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
  await ctx.close();

  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await desk.newPage();
  await inMatch(dp);
  await expect(dp.locator('#keys'), 'the key legend').toBeVisible();
  await expect(dp.locator('#dpad-surface'), 'no pad').toBeHidden();
  await desk.close();
});
