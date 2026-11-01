// Two browsers, one room, on the deployed site and the deployed relay: live.spec.ts proves
// one player can bring a stock ROM, and this that two of them can find each other. Skipped
// unless HBR_LIVE_URL and HBR_BASE_ROM are set (docs/DEPLOY.md).
import fs from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';

const site = process.env.HBR_LIVE_URL ?? '';
const baseRom = process.env.HBR_BASE_ROM ?? '';

test.beforeAll(() => {
  test.skip(
    !site || !baseRom || !fs.existsSync(baseRom),
    'set HBR_LIVE_URL to a deployed site and HBR_BASE_ROM to a retail Emerald (U) ROM',
  );
});

async function open(browser: Browser, hash: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // Named E2E on the relay, not CAM: tools/br/play-log.mjs leaves out anything an E2E opened
  // or sat in, so the play page does not count the suite as players.
  await page.addInitScript(() => {
    try { localStorage.setItem('hbr:career', JSON.stringify({ matches: 0, wins: 0, name: 'E2E' })); } catch { /* a private window */ }
  });
  await page.goto(`${site}/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rom-input', { state: 'attached', timeout: 60_000 });
  await page.setInputFiles('#rom-input', baseRom);
  return page;
}

test('two browsers meet in a room on the live relay', async ({ browser }) => {
  test.setTimeout(300_000);
  const host = await open(browser, '#host');
  await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 120_000 });
  const code = (await host.locator('#room-code').textContent())!.replace('Room ', '').trim();
  const before = await host.locator('#room-roster li').count();
  const guest = await open(browser, `#join=${code}`);
  await expect(host.locator('#room-roster li')).toHaveCount(before + 1, { timeout: 120_000 });
  await expect(guest.locator('#room-code')).toHaveText(`Room ${code}`, { timeout: 120_000 });
  await guest.context().close();
  await host.context().close();
});
