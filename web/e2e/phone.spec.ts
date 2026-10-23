// The phone layout (POK-245). A GBA screen and a thumb are the two fixed sizes here,
// so what this checks is that both fit: the screen is not shrunk to nothing, the pad is
// reachable, and turning the phone sideways puts the controls either side of the screen
// rather than under it. And a desktop's (POK-320): the in-match sheet docked beside the
// game leaves the game most of the window, however narrow the window is.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath, romView } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

// An iPhone-ish viewport, and the same device on its side.
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

// Both pictures: the whole window (the default, HBR-27) and the ring band (`#ring`), whose
// band is the ROM's own and is checked to the row.
for (const mode of ['', '&ring']) {
const ring = mode === '&ring';
test(`a phone gets the screen and both thumbs, either way up${ring ? ' (ring)' : ''}`, async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo${mode}&rom=${romHashParam()}`);
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
    if (ring) expect(asked, "the core draws the ROM's own picture").toEqual(romView());
    else expect(asked.sprites, "the sprite window the ROM declares").toEqual(romView().sprites);
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
    expect(bandScale, 'at the scale the width gives').toBeCloseTo(390 / 240, 3);
    if (ring) {
    // The ROM's band on a portrait phone (POK-329): the core draws 256x496 -- its 512-row
    // ring less one row, 184 above the LCD and 152 below (POK-378) -- at the picture's own
    // 1.625, and the LCD is where the layout put it: on the pad, 4 rows over it.
    expect(buffer, "the ROM's whole band").toEqual({ w: 256, h: 496 });
    expect(canvas.height, 'drawn 496 rows tall').toBeCloseTo(496 * bandScale, 0);
    const pad = await box('#pad');
    // Centred over the pad, or down towards it (field.ts PAD_GAP, 4 rows) as far as the
    // rows the ROM draws above the LCD reach.
    const free = (screen.height - pad.height) / bandScale - 160;
    const lcdRow = Math.max(Math.round(free / 2), Math.min(Math.floor(free) - 4, romView().viewport.top));
    expect((picture.y - screen.y) / bandScale, `the LCD at the layout's row ${lcdRow}`).toBeCloseTo(lcdRow, 0);
    expect((canvas.y - screen.y) / bandScale, "the picture's top 184 rows above it").toBeCloseTo(lcdRow - romView().viewport.top, 0);
    // The ROM's rows above reach the pad on this glass (POK-378): the picture is not held
    // short of it, with the page's still map over the gap.
    expect(lcdRow, 'down on the pad').toBe(Math.floor(free) - 4);
    expect(lcdRow, "and every row above it the ROM's").toBeLessThanOrEqual(romView().viewport.top);
    } else {
      // The whole window: the core draws every row the glass shows above and below the
      // LCD, from the map, and every column (none past the width here).
      const lay = await page.evaluate(() => (window as unknown as { __hbr: { field: { placement: { cols: number; rows: number; lcdCol: number; lcdRow: number } } } }).__hbr.field.placement);
      const need = { left: lay.lcdCol, top: lay.lcdRow, right: lay.cols - lay.lcdCol - 240, bottom: lay.rows - lay.lcdRow - 160 };
      for (const side of ['left', 'top', 'right', 'bottom'] as const) {
        expect(band?.[side], `the band covers the glass's ${side}`).toBeGreaterThanOrEqual(Math.max(0, need[side]));
      }
      expect(need.top, 'map above the picture').toBeGreaterThan(40);
      expect(need.bottom, 'and under it, behind the pad').toBeGreaterThan(40);
    }
    expect(field.width).toBeGreaterThanOrEqual(screen.width - 2);
    expect(field.height).toBeGreaterThanOrEqual(screen.height - 2);
    await page.screenshot({ path: path.join(OUT_DIR, `phone-portrait${ring ? '-ring' : ''}.png`) });

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
    await page.screenshot({ path: path.join(OUT_DIR, `phone-landscape${ring ? '-ring' : ''}.png`) });
  } finally {
    await ctx.close();
  }
});
}

// POK-320 review: the dock was 480px on every desktop window, so a window snapped to half
// a 1366px laptop screen left the game about 200px. Under 960px wide (or 640 tall) the
// sheet is drawn at the picture's own size instead.
for (const mode of ['', '&ring']) {
const ring = mode === '&ring';
test(`a desktop keeps most of the window for the game, beside the docked sheet${ring ? ' (ring)' : ''}`, async ({ browser }) => {
  test.setTimeout(120_000);
  const HALF = { width: 683, height: 768 };
  const FULL = { width: 1366, height: 768 };
  const ctx = await browser.newContext({ viewport: HALF });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo${mode}&rom=${romHashParam()}`);
    await page.waitForSelector('body.docked #stage[data-look="dock"]', { timeout: 90_000 });
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;

    const sheet = await box('#stage');
    const game = await box('#screen-wrap');
    expect(sheet.width, "the sheet at the picture's own size").toBe(240);
    expect(game.x, 'the game beside it, not under it').toBeGreaterThanOrEqual(sheet.x + sheet.width - 1);
    expect(game.width, 'and the rest of the window is the game').toBeGreaterThanOrEqual(HALF.width - 240 - 2);
    // The core draws the rows this layout shows past the picture and no more (POK-329,
    // field.ts askBand), measured before the boot as the match lays it out -- beside the
    // docked sheet -- in eights, never under the sprite window nor past the ROM's band:
    // here 128 rows above the LCD and 129 below, so 128 of the ROM's 184 above, 136 below.
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    const shows = await page.evaluate(() => {
      const box = document.querySelector('#screen-wrap') as HTMLElement;
      const scale = Math.min(box.clientWidth / 240, box.clientHeight / 160);
      const rows = Math.ceil(box.clientHeight / scale);
      const lcdRow = Math.max(0, Math.min(Math.round((box.clientHeight / scale - 160) / 2), rows - 160));
      return { top: lcdRow, bottom: rows - lcdRow - 160 };
    });
    const rom = romView();
    const eights = (n: number, window: number, most: number) => Math.min(most, Math.max(window, Math.ceil(n / 8) * 8));
    const asked = await page.evaluate(() => (window as unknown as { __hbr: { emu: { viewport: unknown } } }).__hbr.emu.viewport);
    if (ring) {
      expect(asked, `the rows the docked layout shows (${shows.top} above, ${shows.bottom} below)`).toEqual({
        ...rom.viewport,
        top: eights(shows.top, rom.sprites.top, rom.viewport.top),
        bottom: eights(shows.bottom, rom.sprites.bottom, rom.viewport.bottom),
      });
      expect((asked as { top: number }).top, "fewer than the ROM's 184 above").toBeLessThan(rom.viewport.top);
    } else {
      // The whole window (field.ts worldBand): those rows, in eights from the layout as
      // measured before the match, and a tile's margin below -- and not much more.
      const band = asked as { top: number; bottom: number };
      expect(band.top, `the ${shows.top} rows above`).toBeGreaterThanOrEqual(shows.top);
      expect(band.top, '...and not much more').toBeLessThan(shows.top + 16);
      expect(band.bottom, `the ${shows.bottom} rows below`).toBeGreaterThanOrEqual(shows.bottom);
      expect(band.bottom, '...and a tile, not much more').toBeLessThan(shows.bottom + 8 + 16 + 8);
    }

    // A wide window has the room for the sheet at twice that, and the game still gets more.
    await page.setViewportSize(FULL);
    await expect.poll(async () => (await box('#stage')).width).toBe(480);
    const wide = await box('#screen-wrap');
    expect(wide.x).toBeGreaterThanOrEqual(480 - 1);
    expect(wide.width).toBeGreaterThanOrEqual(FULL.width - 480 - 2);
    await page.screenshot({ path: path.join(OUT_DIR, `desktop-dock${ring ? '-ring' : ''}.png`) });
  } finally {
    await ctx.close();
  }
});
}

// POK-351 (Cam's 10-14 narrated play-test, item 20): a desktop window narrowed under
// 600px squeezed the game into a 160px sliver beside the 240px docked sheet. There it is
// laid out as a phone: the game the whole width, the sheet behind the menu button, the pad
// and the phone's dock -- and the keyboard still named in the sheet's help.
test('a desktop window under 600px wide is laid out as a phone', async ({ browser }) => {
  test.setTimeout(120_000);
  const NARROW = { width: 400, height: 800 };
  const ctx = await browser.newContext({ viewport: NARROW });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&rom=${romHashParam()}`);
    await page.waitForSelector('body.in-match', { timeout: 90_000 });
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    expect(await page.evaluate(() => document.body.classList.contains('docked')), 'no sheet docked beside the game').toBe(false);
    const game = await box('#screen-wrap');
    expect(game.width, 'the game the whole width').toBeGreaterThanOrEqual(NARROW.width - 2);
    await expect(page.locator('#dpad-surface'), 'the pad').toBeVisible();
    await expect(page.locator('#hud-menu'), "and the dock's menu button").toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, 'desktop-narrow.png') });
    // ...which opens the sheet over the game.
    await page.locator('#hud-menu').click();
    await expect(page.locator('#hud-menu')).toHaveAttribute('aria-expanded', 'true');

    // Wide again: the sheet docks beside the game, and the pad goes.
    await page.setViewportSize({ width: 683, height: 800 });
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('docked'))).toBe(true);
    await expect(page.locator('#dpad-surface')).toBeHidden();
  } finally {
    await ctx.close();
  }
});
