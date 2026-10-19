// FEEDBACK (POK-428): a note typed on the menu or in a match reaches the relay, which
// answers it. The relay here is the suite's own (playwright.config.ts), so a send is
// real: the page opens its socket, the relay logs the line and says feedback_ok.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

async function sendNote(page: Page, shot: string): Promise<void> {
  const box = page.locator('#feedback-text');
  await expect(box).toBeVisible();
  await expect(page.locator('#feedback-send'), 'nothing to send yet').toBeDisabled();
  await page.screenshot({ path: path.join(OUT_DIR, `${shot}-empty.png`) });
  await box.click();
  // Z and X are A and B to the game, Enter is START, arrows the cursor: in the box they
  // are letters, and the screen stays where it is.
  await page.keyboard.type('Zx the ferry softlocked');
  await page.keyboard.press('Enter');
  await page.keyboard.type('at Slateport');
  await expect(box).toHaveValue('Zx the ferry softlocked\nat Slateport');
  await expect(page.locator('#feedback-note')).toHaveText('36/1000');
  await page.screenshot({ path: path.join(OUT_DIR, `${shot}-typed.png`) });
  await page.locator('#feedback-send').click();
  await expect(page.locator('#feedback-note')).toHaveText('Sent. Thank you!', { timeout: 15_000 });
  await expect(box, 'emptied for the next one').toHaveValue('');
  await page.screenshot({ path: path.join(OUT_DIR, `${shot}-sent.png`) });
  await page.locator('#feedback-back').click();
}

test('SEND FEEDBACK on the menu sends a note and comes back to the menu', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`/#rom=${romHashParam()}`);
  const row = page.locator('#lobby-feedback');
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  await sendNote(page, 'feedback-menu');
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible();
});

test('FEEDBACK in the sheet of a phone match sends a note and goes back to the sheet', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&fast&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await expect(page.locator('#hud-menu')).toBeVisible({ timeout: 60_000 });
    await page.locator('#hud-menu').tap();
    await expect(page.locator('#feedback')).toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, 'feedback-sheet.png') });
    await page.locator('#feedback').tap();
    await sendNote(page, 'feedback-match');
    await expect(page.locator('#drawer')).toBeVisible();
    await expect(page.locator('#feedback')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
