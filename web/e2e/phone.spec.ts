// The phone layout (POK-245). A GBA screen and a thumb are the two fixed sizes here,
// so what this checks is that both fit: the screen is not shrunk to nothing, the pad is
// reachable, and turning the phone sideways puts the controls either side of the screen
// rather than under it.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

// An iPhone-ish viewport, and the same device on its side.
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a phone gets the screen and both thumbs, either way up', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });

    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    // The match layout, not the room's: the field past the picture only opens up once
    // the match is on (body.in-match), a moment after the emulator is.
    await page.waitForSelector('body.in-match', { timeout: 30_000 });

    // Portrait: screen on top, pad under it, and both on the screen.
    const screen = await box('#screen-wrap');
    const dpad = await box('#dpad-surface');
    const ab = await box('.ab');
    expect(screen.width, 'the screen is not squeezed').toBeGreaterThan(300);
    expect(dpad.y, 'the pad is below the screen').toBeGreaterThan(screen.y);
    expect(dpad.y + dpad.height, 'the pad is on the screen, not off the bottom').toBeLessThanOrEqual(PORTRAIT.height);
    // A thumb is about 44px; anything smaller is a miss waiting to happen.
    expect(Math.min(dpad.width, dpad.height)).toBeGreaterThanOrEqual(120);
    expect(Math.min(ab.width, ab.height)).toBeGreaterThanOrEqual(60);
    // The field past the picture (POK-317): the box is the height of the glass, the
    // picture spans its width at its own 3:2 and sits above the pad, and the field canvas
    // covers the box -- map above and below the picture, the pad floating over it.
    const picture = await box('#canvas');
    const field = await box('#field');
    expect(screen.height, 'the box is the glass, not the picture').toBeGreaterThan(PORTRAIT.height * 0.8);
    expect(picture.width).toBeCloseTo(screen.width, 0);
    expect(picture.height).toBeCloseTo((picture.width * 160) / 240, 0);
    expect(picture.y, 'map above the picture').toBeGreaterThan(screen.y + 40);
    expect(picture.y + picture.height, 'and the picture clears the pad').toBeLessThanOrEqual(dpad.y + 1);
    expect(field.width).toBeGreaterThanOrEqual(screen.width - 2);
    expect(field.height).toBeGreaterThanOrEqual(screen.height - 2);
    await page.screenshot({ path: path.join(OUT_DIR, 'phone-portrait.png') });

    // Sideways: the screen is the scarce thing, so the controls go either side of it.
    await page.setViewportSize(LANDSCAPE);
    await page.waitForTimeout(300);
    const wide = await box('#screen-wrap');
    const wideDpad = await box('#dpad-surface');
    const wideAb = await box('.ab');
    // Nothing runs off an edge -- a thumb cannot reach what is not on the glass.
    // A gutter, not flush with the bezel: `display: contents` on the pad drops its own
    // padding along with its box, so this is the check that it was said again.
    expect(wideDpad.x, 'the pad has a gutter').toBeGreaterThanOrEqual(6);
    expect(wideAb.x + wideAb.width, 'so do the buttons').toBeLessThanOrEqual(LANDSCAPE.width - 6);
    expect(wideDpad.x + wideDpad.width, 'the pad is left of the screen').toBeLessThanOrEqual(wide.x + 8);
    expect(wideAb.x, 'the buttons are right of it').toBeGreaterThanOrEqual(wide.x + wide.width - 8);
    expect(wide.y + wide.height, 'and the screen still fits').toBeLessThanOrEqual(LANDSCAPE.height + 1);
    await page.screenshot({ path: path.join(OUT_DIR, 'phone-landscape.png') });
  } finally {
    await ctx.close();
  }
});
