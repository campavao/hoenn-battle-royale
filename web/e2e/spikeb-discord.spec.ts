// Cam, 11-21: "add a discord link on the hoenn main menu so folks can easily join from there".
// DISCORD is a tile under SEND FEEDBACK, and a press opens the community's invite in a new tab.
import { expect, test } from '@playwright/test';
import { romHashParam } from './symbols';
// The page's DISCORD_INVITE (src/match/lobby.ts): the specs import no app code.
const DISCORD_INVITE = 'https://discord.gg/zQdV6Nc5CR';

test('the main menu has a DISCORD tile, and a press opens the invite', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  // Not out to Discord from a test: the tab it opens is answered here.
  await ctx.route('https://discord.gg/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>invite</title>' }));
  try {
    const page = await ctx.newPage();
    await page.goto(`/?rom=${romHashParam()}`);
    await page.waitForFunction(() => !!(window as any).__spike?.lobby && !document.getElementById('stage')!.hidden, undefined, { timeout: 150_000 });
    await page.evaluate(() => (window as any).__spike.lobby.stage.paintNow());
    await page.waitForTimeout(800);
    await page.screenshot({ path: test.info().outputPath('menu-discord.png') });
    const tile = page.locator('#lobby-discord');
    await expect(tile).toHaveText(/DISCORD/);
    const [tab] = await Promise.all([ctx.waitForEvent('page'), tile.click()]);
    await tab.waitForLoadState();
    expect(tab.url()).toBe(DISCORD_INVITE);
    // The game is still on its menu behind it.
    await expect(page.locator('#lobby-howto')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
