// POK-254: a player's own stock ROM, patched in the tab.
//
// Most specs load the fork's own build through `?rom=`, which skips the patcher, so the path
// a real player takes (import a retail Emerald, get battle royale) needs this one. Needs a
// retail ROM and a BPS: HBR_BASE_ROM, and tools/br/dev-patch.sh <map> <that rom>.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const baseRom = process.env.HBR_BASE_ROM ?? '';
const bps = path.resolve(import.meta.dirname, '../public/patch/hoenn-br.bps');

test.beforeAll(() => {
  test.skip(
    !baseRom || !fs.existsSync(baseRom) || !fs.existsSync(bps),
    'set HBR_BASE_ROM to a retail Emerald (U) ROM and run tools/br/dev-patch.sh <map> <that rom>',
  );
});

test('a stock Emerald ROM is patched in the browser and boots battle royale', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#pick-rom')).toBeVisible({ timeout: 60_000 });
  await page.setInputFiles('#rom-input', baseRom);
  // The version line is the patcher's own verdict.
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 120_000 });
  const version = () => page.evaluate(() => (window as unknown as { __spike: { version: string } }).__spike.version);
  await expect.poll(version, { timeout: 30_000 }).toContain('patch');
  expect(await version()).not.toContain('unpatched');
  expect(await version()).not.toContain('STALE');
  // And it really is our ROM: a retail one has no mailbox for the page to boot its battles on.
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { rom?: { partyCount(): number } } }).__spike;
    return s?.rom?.partyCount() === 0;
  }, undefined, { timeout: 60_000 });
});
