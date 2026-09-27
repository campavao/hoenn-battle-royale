// The phone layout (POK-245). A GBA screen and a thumb are the two fixed sizes here,
// so what this checks is that both fit: the screen is not shrunk to nothing, the pad is
// reachable, and turning the phone sideways puts the controls either side of the screen
// rather than under it. And a desktop's (POK-320): the in-match sheet docked beside the
// game leaves the game most of the window, however narrow the window is.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

/** The picture the ROM declares (POK-329): `struct BrFieldView` (include/br/br_field.h),
 *  six u16s at gBrFieldView, read here off the ROM file the page boots -- a spec cannot
 *  import field.ts's romBand. */
function romView(): { viewport: { left: number; top: number; right: number; bottom: number }; sprites: { top: number; bottom: number } } {
  const at = loadSymbols().gBrFieldView;
  if (at === undefined) throw new Error('no gBrFieldView in br-symbols.json: run tools/br/dev-patch.sh on a build that has it');
  const rom = fs.readFileSync(romPath());
  const u16 = (i: number) => rom.readUInt16LE(at - 0x08000000 + 2 * i);
  return { viewport: { left: u16(0), top: u16(1), right: u16(2), bottom: u16(3) }, sprites: { top: u16(4), bottom: u16(5) } };
}

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
    // The core's canvas is the LCD plus a band past it on each side (POK-319), so the
    // picture the layout places is the LCD inside that canvas, not the canvas itself.
    const band = await page.evaluate(() => (window as unknown as { __hbr: { emu: { viewport: { left: number; top: number; right: number; bottom: number } | null } } }).__hbr.emu.viewport);
    // ...and the band is the one the ROM declares, drawn with the sprite window it
    // declares (POK-329): the page asked for what the ROM was built to feed.
    const asked = await page.evaluate(() => {
      const emu = (window as unknown as { __hbr: { emu: { viewport: unknown; spriteBand: unknown } } }).__hbr.emu;
      return { viewport: emu.viewport, sprites: emu.spriteBand };
    });
    expect(asked, "the core draws the ROM's own picture").toEqual(romView());
    const canvas = await box('#canvas');
    const bandScale = canvas.width / (240 + (band?.left ?? 0) + (band?.right ?? 0));
    const picture = {
      x: canvas.x + (band?.left ?? 0) * bandScale,
      y: canvas.y + (band?.top ?? 0) * bandScale,
      width: 240 * bandScale,
      height: 160 * bandScale,
    };
    const field = await box('#field');
    expect(screen.height, 'the box is the glass, not the picture').toBeGreaterThan(PORTRAIT.height * 0.8);
    expect(picture.width).toBeCloseTo(screen.width, 0);
    expect(picture.height).toBeCloseTo((picture.width * 160) / 240, 0);
    expect(picture.y, 'map above the picture').toBeGreaterThan(screen.y + 40);
    expect(picture.y + picture.height, 'and the picture clears the pad').toBeLessThanOrEqual(dpad.y + 1);
    if (band) {
      expect(canvas.height, 'the core draws the band above and below').toBeCloseTo(((160 + band.top + band.bottom) * picture.width) / 240, 0);
      expect(canvas.y, 'the band above starts higher than the picture').toBeLessThan(picture.y);
    }
    // The element's aspect is the buffer's aspect, whatever the band: a 256-row buffer in
    // an element sized for 160 was "everything got squished" (Cam, 2026-09-18).
    const buffer = await page.evaluate(() => { const c = document.querySelector('#canvas') as HTMLCanvasElement; return { w: c.width, h: c.height }; });
    expect(canvas.width / canvas.height, 'the picture is never squashed or stretched').toBeCloseTo(buffer.w / buffer.h, 2);
    // The ROM's band on a portrait phone (POK-329): the core draws 256x496 -- its 512-row
    // ring less one row, 104 above the LCD and 232 below -- at the picture's own 1.625, and
    // the LCD is where the layout put it, over the pad: canvas row 118 on this glass.
    expect(buffer, "the ROM's whole band").toEqual({ w: 256, h: 496 });
    expect(bandScale, 'at the scale the width gives').toBeCloseTo(390 / 240, 3);
    expect(canvas.height, 'drawn 496 rows tall').toBeCloseTo(496 * bandScale, 0);
    const pad = await box('#pad');
    const lcdRow = Math.round(((screen.height - pad.height) / bandScale - 160) / 2);
    expect((picture.y - screen.y) / bandScale, `the LCD at the layout's row ${lcdRow}`).toBeCloseTo(lcdRow, 0);
    expect((canvas.y - screen.y) / bandScale, "the picture's top 104 rows above it").toBeCloseTo(lcdRow - 104, 0);
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

// POK-320 review: the dock was 480px on every desktop window, so a window snapped to half
// a 1366px laptop screen left the game about 200px. Under 960px wide (or 640 tall) the
// sheet is drawn at the picture's own size instead.
test('a desktop keeps most of the window for the game, beside the docked sheet', async ({ browser }) => {
  test.setTimeout(120_000);
  const HALF = { width: 683, height: 768 };
  const FULL = { width: 1366, height: 768 };
  const ctx = await browser.newContext({ viewport: HALF });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&rom=${romHashParam()}`);
    await page.waitForSelector('body.docked #stage[data-look="dock"]', { timeout: 90_000 });
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;

    const sheet = await box('#stage');
    const game = await box('#screen-wrap');
    expect(sheet.width, "the sheet at the picture's own size").toBe(240);
    expect(game.x, 'the game beside it, not under it').toBeGreaterThanOrEqual(sheet.x + sheet.width - 1);
    expect(game.width, 'and the rest of the window is the game').toBeGreaterThanOrEqual(HALF.width - 240 - 2);

    // A wide window has the room for the sheet at twice that, and the game still gets more.
    await page.setViewportSize(FULL);
    await expect.poll(async () => (await box('#stage')).width).toBe(480);
    const wide = await box('#screen-wrap');
    expect(wide.x).toBeGreaterThanOrEqual(480 - 1);
    expect(wide.width).toBeGreaterThanOrEqual(FULL.width - 480 - 2);
    await page.screenshot({ path: path.join(OUT_DIR, 'desktop-dock.png') });
  } finally {
    await ctx.close();
  }
});
