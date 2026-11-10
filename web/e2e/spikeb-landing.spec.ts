// Cam, 11-10: "remove the dialog box that appears briefly when landing on the main page? Something
// about spike b I think?" The old engine preview's notes ("Engine preview: our own overworld") and
// the dev's buttons over them were on the page from its first paint, until the script took them
// away. From the first frame to the ROM screen, neither shows.
import { expect, test } from '@playwright/test';

test('landing: no preview notes and no dev buttons, from the first paint', async ({ browser }) => {
  test.setTimeout(60_000);
  for (const opts of [{ viewport: { width: 1280, height: 720 } }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    // Every frame from the first, in the page: did either show?
    await page.addInitScript(() => {
      const w = window as unknown as { __seen: string[] };
      w.__seen = [];
      const look = () => {
        const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
        if (shown(document.getElementById('intro'))) w.__seen.push('intro');
        for (const id of ['menu', 'find', 'mode', 'sound']) if (shown(document.getElementById(id))) w.__seen.push(id);
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.goto('/');
    await page.waitForTimeout(4000);
    const seen = await page.evaluate(() => [...new Set((window as unknown as { __seen: string[] }).__seen)]);
    expect(seen, 'nothing of the old preview on the live way in').toEqual([]);
    await ctx.close();
  }
});
