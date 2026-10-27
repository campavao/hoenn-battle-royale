// HOW TO PLAY (POK-429, POK-430): offered over the menu the first time somebody imports a ROM,
// never again on that device, and a row on the menu from then on.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { romExists, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a first import shows the panels once; the menu row shows them again', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // No `#rom=`: the file goes in the way a player's does, which is what makes them new.
  await page.goto('/');
  await expect(page.locator('#pick-rom')).toBeVisible({ timeout: 30_000 });
  await page.setInputFiles('#rom-input', romPath());

  await expect(page.locator('#howto-heading')).toHaveText('Start in Safari', { timeout: 60_000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'howto-first.png') });
  for (const heading of ['Where we flying?', 'Encounters', 'Item pickups', 'Weezing Fog', 'Leveling up', 'Battles', 'Special events', 'How to win']) {
    await page.locator('#howto-next').click();
    await expect(page.locator('#howto-heading')).toHaveText(heading);
  }
  await page.locator('#howto-done').click();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible();

  // The ROM is stored now: the next visit is a returning player's, straight to the menu.
  await page.reload();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#howto-heading')).toHaveCount(0);

  await page.locator('#lobby-rows button', { hasText: 'HOW TO PLAY' }).click();
  await expect(page.locator('#howto-heading')).toHaveText('Start in Safari');
  // A alone clicks through: the cursor starts on NEXT, and on DONE at the end.
  for (let i = 0; i < 8; i++) await page.keyboard.press('z');
  await expect(page.locator('#howto-heading')).toHaveText('How to win');
  await page.keyboard.press('z');
  await expect(page.locator('#lobby-rows button', { hasText: 'HOW TO PLAY' })).toBeVisible();

  await page.locator('#lobby-rows button', { hasText: 'HOW TO PLAY' }).click();
  await page.locator('#howto-skip').click();
  await expect(page.locator('#howto-heading')).toHaveCount(0);
});
