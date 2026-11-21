// Cam, 11-21: the ROM screen read blurred, and a newcomer met a wall of words. Before a
// ROM the page shows the main menu itself, every tile, sharp, with PICK YOUR ROM under it;
// a tile says what it needs in a sentence or two, and BACK goes back to the menu. Then the
// ROM -- a zip of it, after a file that is not one -- and the real menu.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { romExists, romPath } from './symbols';

/** One file in a zip, deflated: enough of the format for the page's reader. */
function zipOne(name: string, data: Buffer): Buffer {
  const n = Buffer.from(name);
  const packed = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + packed.length, 16);
  return Buffer.concat([local, n, packed, cen, n, end]);
}

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

    // A file that is not one says why, in words, on the ask.
    await page.locator('#rom-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a rom') });
    await expect(page.locator('#import-error')).toContainText("isn't a ROM");

    test.skip(!romExists(), `no ROM at ${romPath()}: the rest is the ROM's`);
    // Zipped, the way most copies are (src/rom/romfile.ts).
    await page.locator('#rom-input').setInputFiles({ name: 'emerald.zip', mimeType: 'application/zip', buffer: zipOne('Pokemon Emerald.gba', fs.readFileSync(romPath())) });
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
