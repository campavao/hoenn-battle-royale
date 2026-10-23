// POK-318, then the world as big as the picture. Emerald keeps an object only from 7 rows
// above the player to 9 below, and a phone's field runs a dozen rows past that -- where
// Cam's trainer "cuts in and out depending on where I'm located", and where the page
// used to draw who the ROM knew of from its own tables. Now the page tells the ROM the
// rows it shows (gBrFieldShown) and the core reads the ROM's OAM side table, so the ROM
// grows its box to those rows and the core draws what is in it, at its true rows.
//
// This puts an unused seat's row into the ROM's gBrSeats fourteen rows below us -- past
// pret's box, inside a portrait phone's 152 rows below the LCD, and 256 rows below the
// LCD's top, so its OAM y is one of the LCD's own rows -- and looks for the ROM's own
// object there, drawn by the core once and not by the overlay; then takes the row away
// and sees it go.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };
const BR_PHASE_SAFARI = 1;
/** src/field.ts's measured LCD_LEFT/LCD_TOP: where our own tile sits in the picture.
 *  Copied, not imported, as tap.spec.ts does: field.ts imports JSON Playwright's loader
 *  refuses. */
const LCD_LEFT = 112;
const LCD_TOP = 72;
/** `struct BrSeat` (include/br/br_ghosts.h), 16 bytes a seat. Solo is seat 0 and its
 *  eight bots count down from 31 (bots/roster.ts dealBots): 31 was a live bot, whose own
 *  rows moved it off this spec's cell. 16 is nobody's. */
const SEAT = 16;
const SEAT_SIZE = 16;
const BR_NO_OBJ = 0xff;
const DIR_SOUTH = 1;
/** LASS: a 16x32 person, like every skin. */
const SKIN = 15;
const W = 16;
const H = 32;
/** Rows below us to try, past the box's 9: the first with nobody already on it. From 13
 *  down a person's top is 256 rows or more below the LCD's, an OAM y inside the LCD's own
 *  rows, so a core that read only the 8 bits would draw them there too. */
const ROWS_DOWN = [14, 13, 15];
/** The LCD's top rows, where a 32-row person 248..280 rows down would show again. */
const LCD_TOP_ROWS = 48;
/** The map's templates in the save block (field-ghosts.ts, held to the C by parity.test.ts),
 *  and a row's own. */
const SB1_TEMPLATES = 0xc70;
const TEMPLATE_COUNT = 64;
const TEMPLATE_SIZE = 0x18;
const MAP_OFFSET = 7;
/** A local id no Zone map uses, under LOCALID_CAMERA (127): a map's own. */
const STRIP_LOCAL_ID = 60;
const GFX_BLACK_BELT = 44;
const MOVEMENT_TYPE_FACE_DOWN = 8;

type Pic = { width: number; height: number; left: number; top: number; data: Uint8Array };
type Emu = {
  read(addr: number, width: 8 | 16 | 32): number;
  write(addr: number, value: number, width: 8 | 16 | 32): void;
  onFrame(fn: () => void): () => void;
  picture(): Pic | null;
  viewport: { left: number; top: number; right: number; bottom: number } | null;
};
type EmuWindow = { __hbr: { emu: Emu } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Opaque pixels on the overlay in a rect of the picture's pixels (the LCD's top-left
 *  is 0,0). The overlay is the field's size; the LCD sits in it where the core's canvas
 *  was placed, less the band. */
async function opaqueAt(page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<number> {
  return page.evaluate((r) => {
    const overlay = document.querySelector('#overlay') as HTMLCanvasElement;
    const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
    const band = (window as unknown as EmuWindow).__hbr.emu.viewport ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const o = overlay.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    const scale = o.width / overlay.width;
    const lcdCol = Math.round((c.left - o.left) / scale) + band.left;
    const lcdRow = Math.round((c.top - o.top) / scale) + band.top;
    const ctx = overlay.getContext('2d')!;
    const x = lcdCol + r.x;
    const y = lcdRow + r.y;
    if (x < 0 || y < 0 || x + r.w > overlay.width || y + r.h > overlay.height) return -1;
    const px = ctx.getImageData(x, y, r.w, r.h).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
    return n;
  }, rect);
}

/** The core's picture over `rect` (LCD pixels) for `frames` frames: every value each pixel
 *  took, as `seen` -- and, given a `seen` from before, how many pixels took one it never
 *  had. -1 when the rect is not all inside the picture. */
function corePixels(page: Page, rect: { x: number; y: number; w: number; h: number }, frames: number, seen: number[][] | null): Promise<{ seen: number[][]; strange: number }> {
  return page.evaluate(([r, n, before]) => new Promise((resolve) => {
    const emu = (window as unknown as EmuWindow).__hbr.emu;
    const sets = Array.from({ length: r.w * r.h }, (_, i) => new Set<number>(before ? before[i] : []));
    const odd = new Set<number>();
    let got = 0;
    const off = emu.onFrame(() => {
      const p = emu.picture();
      if (!p) return;
      if (r.x + p.left < 0 || r.y + p.top < 0 || r.x + p.left + r.w > p.width || r.y + p.top + r.h > p.height) {
        off();
        resolve({ seen: [], strange: -1 });
        return;
      }
      const px = new Uint32Array(p.data.buffer);
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const v = px[(p.top + r.y + y) * p.width + p.left + r.x + x] >>> 0;
          if (before && !sets[y * r.w + x].has(v)) odd.add(y * r.w + x);
          if (!before) sets[y * r.w + x].add(v);
        }
      }
      if (++got >= n) {
        off();
        resolve({ seen: sets.map((set) => [...set]), strange: odd.size });
      }
    });
  }), [rect, frames, seen] as const);
}

test('a seat past pret\'s box but in the rows a phone shows is the ROM\'s own: an object, drawn by the core, once', async ({ browser }) => {
  test.setTimeout(150_000);
  const symbols = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 30_000 });

    // In the Zone (outdoors, the whole two-minute opening ahead), standing still.
    await page.waitForFunction(
      ([addr, phase]) => (window as unknown as EmuWindow).__hbr.emu.read(addr, 8) === phase,
      [symbols.gBrMatch, BR_PHASE_SAFARI],
      { timeout: 60_000 },
    );
    const own = async () => page.evaluate((base) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      const s16 = (v: number) => (v << 16) >> 16;
      return { group: emu.read(base, 8), num: emu.read(base + 1, 8), x: s16(emu.read(base + 2, 16)), y: s16(emu.read(base + 4, 16)) };
    }, symbols.gBrOwnPos);
    let here = await own();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const now = await own();
      if (now.x === here.x && now.y === here.y && now.group === here.group && now.num === here.num && now.num !== 0) break;
      here = now;
    }
    expect(here.group, 'standing somewhere real').toBeGreaterThan(0);

    // A row below us that nobody is standing on yet.
    let down = 0;
    let rect = { x: 0, y: 0, w: W, h: H };
    for (const d of ROWS_DOWN) {
      const r = { x: LCD_LEFT + 8 - W / 2, y: LCD_TOP + d * 16 + 16 - H, w: W, h: H };
      const n = await opaqueAt(page, r);
      expect(n, `row +${d} is on the phone's overlay`).toBeGreaterThanOrEqual(0);
      if (n === 0) {
        down = d;
        rect = r;
        break;
      }
    }
    expect(down, 'a clear row past the box').toBeGreaterThan(0);

    // What the core draws there without anybody: the map, its animation included -- and
    // in the LCD's top rows over the same columns.
    const bare = await corePixels(page, rect, 90, null);
    const lcdTop = { x: rect.x, y: 0, w: rect.w, h: LCD_TOP_ROWS };
    const bareTop = await corePixels(page, lcdTop, 90, null);

    // Seat 16 there: present, a skin, our map, the cell (MAP_OFFSET included, as the ROM
    // keeps it), facing south, no object.
    const seat = symbols.gBrSeats + SEAT * SEAT_SIZE;
    const row = [1, SKIN, here.group, here.num, here.x & 0xff, (here.x >> 8) & 0xff, (here.y + down) & 0xff, ((here.y + down) >> 8) & 0xff, DIR_SOUTH, BR_NO_OBJ, 0, 0, 0, 0, 0, 0];
    const poke = (bytes: number[]) => page.evaluate(([base, b]) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      (b as number[]).forEach((v, i) => emu.write((base as number) + i, v, 8));
    }, [seat, bytes] as const);
    const shown = await page.evaluate((at) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      return { top: emu.read(at, 16), bottom: emu.read(at + 2, 16) };
    }, symbols.gBrFieldShown);
    expect(shown, 'the page told the ROM the rows a portrait phone shows').toEqual({ top: 184, bottom: 152 });

    await poke(row);
    await expect.poll(() => page.evaluate((base) => (window as unknown as EmuWindow).__hbr.emu.read(base + 9, 8), seat), {
      timeout: 10_000, message: 'the ROM gives the seat past pret\'s box an object',
    }).not.toBe(BR_NO_OBJ);
    await expect.poll(async () => (await corePixels(page, rect, 10, bare.seen)).strange, {
      timeout: 10_000, message: "the core's own picture draws it there",
    }).toBeGreaterThan(40);
    expect(await opaqueAt(page, rect), 'and the overlay does not draw it again').toBe(0);
    expect((await corePixels(page, lcdTop, 30, bareTop.seen)).strange, 'nor the core, 256 rows up, in the LCD').toBe(0);
    await page.screenshot({ path: path.join(OUT_DIR, 'people-past-box.png') });

    // Out of the match (present 0): gone.
    await poke([0]);
    await expect.poll(async () => (await corePixels(page, rect, 10, bare.seen)).strange, {
      timeout: 10_000, message: 'the ghost goes with its row',
    }).toBe(0);
  } finally {
    await ctx.close();
  }
});

// Cam's 2026-10-17 play-test, on a phone in Mossdeep: a BLACK BELT on the water and a BOY
// by the CENTER were drawn past the box -- the page's copy, from the map's templates --
// and gone the moment they came inside it, where the match had stripped them. The ROM
// marks the rows it strips in gBrStripped as a map's rows are copied in (strip-rows.txt
// holds Mossdeep's); this holds the page to them. A BLACK BELT goes into an empty row of
// the Zone's templates on a clear row below us, past pret's box: unmarked, the page draws
// him there; marked, nobody does. (The two halves meet in no one test: a phone in
// Mossdeep itself needs a savestate the e2e does not have.)
test('a person the match strips is not drawn past the box either', async ({ browser }) => {
  test.setTimeout(150_000);
  const symbols = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&nobots&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 30_000 });
    await page.waitForFunction(
      ([addr, phase]) => (window as unknown as EmuWindow).__hbr.emu.read(addr, 8) === phase,
      [symbols.gBrMatch, BR_PHASE_SAFARI],
      { timeout: 60_000 },
    );
    const read = (addr: number, width: 8 | 16 | 32) => page.evaluate(([a, w]) => (window as unknown as EmuWindow).__hbr.emu.read(a, w as 8 | 16 | 32), [addr, width] as const);
    const own = async () => page.evaluate((base) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      const s16 = (v: number) => (v << 16) >> 16;
      return { x: s16(emu.read(base + 2, 16)), y: s16(emu.read(base + 4, 16)) };
    }, symbols.gBrOwnPos);
    let here = await own();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const now = await own();
      if (now.x === here.x && now.y === here.y) break;
      here = now;
    }

    // The first empty row of the Zone's templates (gSaveBlock1Ptr->objectEventTemplates).
    const sb1 = await read(symbols.gSaveBlock1Ptr, 32);
    const templates = sb1 + SB1_TEMPLATES;
    let row = -1;
    for (let i = 0; i < TEMPLATE_COUNT && row < 0; i++) if ((await read(templates + i * TEMPLATE_SIZE, 8)) === 0) row = i;
    expect(row, 'an empty template row').toBeGreaterThanOrEqual(0);
    let down = 0;
    let rect = { x: 0, y: 0, w: W, h: H };
    for (const d of ROWS_DOWN) {
      const r = { x: LCD_LEFT + 8 - W / 2, y: LCD_TOP + d * 16 + 16 - H, w: W, h: H };
      if ((await opaqueAt(page, r)) === 0) {
        down = d;
        rect = r;
        break;
      }
    }
    expect(down, 'a clear row past the box').toBeGreaterThan(0);
    // What the core draws there without him: the map, its animation included.
    const bare = await corePixels(page, rect, 90, null);
    const x = here.x - MAP_OFFSET;
    const y = here.y - MAP_OFFSET + down;
    // localId, graphicsId, kind, pad, x, y, elevation, movementType (FACE_DOWN), ranges, ...
    const tpl = [STRIP_LOCAL_ID, GFX_BLACK_BELT, 0, 0, x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff, 3, MOVEMENT_TYPE_FACE_DOWN];
    const poke = (addr: number, bytes: number[]) => page.evaluate(([base, b]) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      (b as number[]).forEach((v, i) => emu.write((base as number) + i, v, 8));
    }, [addr, bytes] as const);
    const bit = symbols.gBrStripped + (row >> 3);
    const before = await read(bit, 8);
    try {
      await poke(templates + row * TEMPLATE_SIZE, tpl);
      await expect.poll(async () => (await corePixels(page, rect, 10, bare.seen)).strange, { timeout: 10_000, message: 'a row the match keeps: the core draws him past the box' }).toBeGreaterThan(40);
      await page.screenshot({ path: path.join(OUT_DIR, 'people-past-box-kept.png') });
      await poke(bit, [before | (1 << (row & 7))]);
      await expect.poll(async () => (await corePixels(page, rect, 10, bare.seen)).strange, { timeout: 10_000, message: 'a row the match strips: nobody draws him' }).toBe(0);
      expect(await opaqueAt(page, rect), 'not the overlay either').toBe(0);
      await page.screenshot({ path: path.join(OUT_DIR, 'people-past-box-stripped.png') });
    } finally {
      // Put the Zone back; a page that crashed has nothing to put back, and its error is the one to see.
      await poke(bit, [before]).catch(() => {});
      await poke(templates + row * TEMPLATE_SIZE, [0]).catch(() => {});
    }
  } finally {
    await ctx.close();
  }
});
