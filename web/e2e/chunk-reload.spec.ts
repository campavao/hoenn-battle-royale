// POK-419: a lazy chunk that will not load. After a release takes a page's hashed chunks
// off the site, every retry is a 404; Safari can keep a failed fetch in its module map
// and reject the next import() without asking again. After a few failures the page
// offers a reload (app.ts chunkFailed), and never reloads on its own.
//
// A phone, with the three lazy chunks (results, profile, phone UI) refused at the network.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

/** The dev server's module (`/src/ui/results.ts`) or a build's chunk
 *  (`/assets/results-<hash>.js`); not ui/results-hold.ts or match/results.ts, which
 *  main.js imports itself. */
const OUT_DIR = path.resolve(import.meta.dirname, 'out');
const CHUNKS = /\/(ui\/(results|profile|phone-ui)\.ts|assets\/(results|profile|phone-ui)-[\w-]{8}\.js)(\?|$)/;

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test("chunks that won't load: a tap-to-reload line, and the tap reloads", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.route(CHUNKS, (route) => route.abort('failed'));
    await page.goto(`/#solo&rom=${romHashParam()}`);
    const line = page.locator('#chunk-reload');
    await expect(line).toBeVisible({ timeout: 60_000 });
    await expect(line).toHaveText("Part of the game didn't load. Tap to reload.");
    // One line, however many more failures follow.
    await page.waitForTimeout(5_000);
    await expect(line).toHaveCount(1);
    await page.screenshot({ path: path.join(OUT_DIR, 'chunk-reload.png') });

    // The chunks are back (a new release is up): the tap reloads, and the line is gone.
    await page.unroute(CHUNKS);
    await Promise.all([page.waitForEvent('load'), line.tap()]);
    await expect(page.locator('#chunk-reload')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
