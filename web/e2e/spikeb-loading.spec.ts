// Cam, 11-10: the first load on a phone was "a black screen with 'loading the rom' near the
// top and the controls visible at the bottom", and a reload in a match left the trainer on
// the map, locked, until the game said it was ready. Now a loading screen -- Emerald's
// opening bike ride, drawn from the player's ROM -- covers the page from its first paint
// until there is something to do: the menu, or a match whose battle ROM is up.
import { expect, test, type Page } from '@playwright/test';
import { romHashParam } from './symbols';

interface Seen { up: boolean; riding: boolean; rom: boolean; menu: boolean }

/** Every frame from the first, in the page: is the loading screen up, is the ride drawn,
 *  is the battle ROM booted, is the menu showing. */
async function watch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __seen: Seen[] };
    w.__seen = [];
    const look = () => {
      const el = document.getElementById('loading');
      const s = (window as unknown as { __spike?: { rom: unknown; lobby?: { shown: boolean } } }).__spike;
      w.__seen.push({
        up: !!el && !el.hidden && !el.classList.contains('leaving') && getComputedStyle(el).display !== 'none',
        riding: !!el?.classList.contains('riding'),
        rom: !!s?.rom,
        menu: !!s?.lobby?.shown,
      });
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen);

for (const [name, opts] of [
  ['desk', { viewport: { width: 1280, height: 720 } }],
  ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
] as const) {
  test(`${name}: the ride covers the way in, and goes once the menu is up`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await watch(page);
    await page.goto(`/?rom=${romHashParam()}`);
    await expect.poll(() => page.evaluate(() => !!(window as unknown as { __spike?: { lobby?: { shown: boolean } } }).__spike?.lobby?.shown), { timeout: 90_000 }).toBe(true);
    await expect(page.locator('#loading')).toHaveCount(0, { timeout: 5000 });
    const s = await seen(page);
    expect(s[0]?.up, 'up from the first frame').toBe(true);
    expect(s.some((f) => f.riding), 'the ride drawn from the ROM').toBe(true);
    // Never down before the menu, never back after it.
    const firstDown = s.findIndex((f) => !f.up);
    expect(firstDown).toBeGreaterThan(0);
    expect(s[firstDown].menu, 'down only for the menu').toBe(true);
    expect(s.slice(firstDown).every((f) => !f.up), 'gone for good').toBe(true);
    await ctx.close();
  });
}

test('a match waits under the ride for the battle ROM, then the field is the player\'s', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await watch(page);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&seed=7`);
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __spike?: { rom: unknown } }).__spike?.rom), { timeout: 120_000 }).toBe(true);
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 5000 });
  const s = await seen(page);
  const firstDown = s.findIndex((f) => !f.up);
  expect(firstDown, 'it went').toBeGreaterThan(0);
  expect(s[firstDown].rom, 'not before the battle ROM was up').toBe(true);
  expect(s.some((f) => f.riding)).toBe(true);
  await ctx.close();
});
