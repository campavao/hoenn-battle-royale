// Cam, 11-21: the ROM screen read blurred, and a newcomer met a wall of words. Before a
// ROM the page shows the main menu itself, every tile, sharp, with PICK YOUR ROM under it;
// a tile says what it needs in a sentence or two, and BACK goes back to the menu. Then the
// ROM, and the real menu.
import { expect, test } from '@playwright/test';
import { romExists, romPath } from './symbols';

test('a newcomer sees the menu, sharp, a tile asks for the ROM, and the ROM brings the real one', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  try {
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('#pick-rom')).toBeVisible({ timeout: 60_000 });
    for (const id of ['landing-quick-play', 'landing-host-a-room', 'landing-lobbies', 'landing-join-by-code', 'landing-leaderboard', 'landing-howto', 'landing-feedback', 'landing-discord']) {
      await expect(page.locator(`#${id}`), id).toBeVisible();
    }
    // Drawn at the phone's own pixels, not 240 blown up.
    const ui = await page.evaluate(() => {
      const c = document.getElementById('ui') as HTMLCanvasElement;
      return { w: c.width, css: c.getBoundingClientRect().width };
    });
    expect(ui.w, 'the canvas has a pixel per screen pixel').toBeGreaterThanOrEqual(Math.floor(ui.css * 3) - 2);
    await page.screenshot({ path: test.info().outputPath('landing.png') });

    await page.locator('#landing-quick-play').click();
    await expect(page.locator('#pick-rom-ask')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('landing-ask.png') });
    await page.locator('#pick-rom-back').click();
    await expect(page.locator('#landing-quick-play')).toBeVisible();

    test.skip(!romExists(), `no ROM at ${romPath()}: the rest is the ROM's`);
    await page.locator('#rom-input').setInputFiles(romPath());
    await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 150_000 });
    // The ROM's letters now, one canvas pixel per GBA pixel again.
    const after = await page.evaluate(() => (document.getElementById('ui') as HTMLCanvasElement).width);
    expect(after, 'back to GBA pixels').toBeLessThan(400);
    await page.waitForTimeout(800);
    await page.screenshot({ path: test.info().outputPath('menu.png') });
  } finally {
    await ctx.close();
  }
});
