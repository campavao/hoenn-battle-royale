// The deployed site, against the real thing: can a player bring their own retail Emerald and
// get battle royale out of it? Skipped unless HBR_LIVE_URL and HBR_BASE_ROM are set
// (docs/DEPLOY.md). The dev server differs from what a player gets: it runs a pre-patched
// local build, and it registers no service worker.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const site = process.env.HBR_LIVE_URL ?? '';
const baseRom = process.env.HBR_BASE_ROM ?? '';

test.beforeAll(() => {
  test.skip(
    !site || !baseRom || !fs.existsSync(baseRom),
    'set HBR_LIVE_URL to a deployed site and HBR_BASE_ROM to a retail Emerald (U) ROM',
  );
});

test('the deployed site patches a stock ROM in the browser', async ({ page }) => {
  test.setTimeout(180_000);
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('pageerror', (e) => failed.push(`pageerror: ${e.message}`));

  await page.goto(site, { waitUntil: 'domcontentloaded' });
  // Picked as early as the page allows, on purpose: over a slow line the core takes seconds
  // to boot, and the page has to take a file it was given before it was listening.
  await page.waitForSelector('#rom-input', { state: 'attached', timeout: 60_000 });
  await page.setInputFiles('#rom-input', baseRom);

  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 120_000 });
  const version = () => page.evaluate(() => (window as unknown as { __spike: { version: string } }).__spike.version);
  await expect.poll(version, { timeout: 30_000 }).toContain('patch');
  expect(await version()).not.toContain('unpatched');
  expect(await version()).not.toContain('STALE');
  // A production build registers a service worker and the dev server never does, so this is
  // the only place a worker that throws on install would ever show up.
  expect(failed, 'nothing failed to load').toEqual([]);
});
