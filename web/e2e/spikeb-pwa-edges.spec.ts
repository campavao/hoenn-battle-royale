// Cam, 11-10, the game saved to a phone's home screen: "on the main menu there is a black bar at
// the bottom". A home-screen app has no browser bars over the notch and the home bar, so #stage's
// padding there (its safe area) showed its own dark colour above and below the menu's backdrop.
// The canvas now reaches under both, the backdrop paints them, and taps still land where they did.
import { expect, test } from '@playwright/test';
import { romHashParam } from './symbols';

test('a home-screen app: the menu backdrop under the notch and the home bar, taps unmoved', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await page.waitForFunction(() => !!(window as any).__spike?.lobby && !document.getElementById('stage')!.hidden, undefined, { timeout: 150_000 });
  // An iPhone 14 on its home screen: env(safe-area-inset-*) as the stage's padding. Chromium
  // reports no insets, so they are written in.
  await page.addStyleTag({ content: '#stage { padding: 47px 0 34px 0 !important; }' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.evaluate(() => (window as any).__spike.lobby.stage.paintNow());
  await page.waitForTimeout(1500);
  // The pan wanders off the world's edge at times (nothing south of LITTLEROOT): wait until it
  // is over map under both strips. (Before the fix the canvas never reached them at all.)
  const sample = () => page.evaluate(() => {
    const c = document.getElementById('ui') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    // How many colours in a row: the pan is many, a flat fill one.
    const colours = (y: number) => { const seen = new Set<number>(); for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]); } return seen.size; };
    return { top: r.top, bottom: r.bottom, vh: innerHeight, topRow: colours(0), bottomRow: colours(c.height - 1) };
  });
  let edges = await sample();
  for (let i = 0; i < 80 && (edges.topRow <= 4 || edges.bottomRow <= 4); i++) { await page.waitForTimeout(500); edges = await sample(); }
  await page.screenshot({ path: test.info().outputPath('pwa-menu.png') });
  expect(edges.top, 'the canvas reaches the top of the screen').toBeLessThanOrEqual(0);
  expect(edges.bottom, '...and the bottom').toBeGreaterThanOrEqual(edges.vh);
  expect(edges.topRow, 'the backdrop under the notch').toBeGreaterThan(4);
  expect(edges.bottomRow, 'the backdrop under the home bar').toBeGreaterThan(4);
  // A tap on HOW TO PLAY still opens it: the hit is where the tile is drawn.
  const tile = page.locator('#ui-hits [data-id], #ui-hits *').filter({ hasText: /HOW TO PLAY/ }).first();
  await tile.click();
  await expect.poll(() => page.evaluate(() => (window as any).__spike.lobby.stage.current !== (window as any).__spike.lobby.main), { timeout: 5000 }).toBe(true);
  // An opaque status bar on iOS: under black-translucent the page ran up under the clock, where
  // iOS blurs, and came out short at the bottom (Cam's screenshot, 11-10).
  expect(await page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content')).toBe('black');
  await ctx.close();
});
