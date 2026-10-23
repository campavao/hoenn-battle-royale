// POK-329: the picture past the LCD as the core draws it -- read out of the core's own
// texture (emu.picture()), not off the screen, so nothing the page draws around it can
// hide what the core did.
//
// The GBA's sprite y is 8 bits and its BG maps are 256 rows, so every row the hardware has
// comes round again 256 rows on. A band of 256 rows (the ROM's ring, 40 above the LCD and
// 56 below) shows each once; a taller one would show the ring, the HUD's corner and every
// person a second time. And one sprite already came round inside 256 rows: a person whose
// top was in the band's last 32 rows had their legs drawn at its top (Cam, 2026-09-18,
// "NPCs cut off above the band"). So the core now reads each sprite's y against the
// sprite window the page declares -- the 256 rows where the ROM keeps every y to one
// reading -- and draws it once, at its true rows, which for a person whose top is near
// the window's bottom run on past it. Past the window a BG is drawn only if it is 512
// rows tall, and the weather's semi-transparent sprites repeat every 256 rows, as its
// 64x64 grid is laid out to. The field's BG1..3 are 512 rows since POK-329 (the ROM's
// ring, include/br/br_field.h), so past the window the core draws the map from them --
// its own rows, not the window's again -- and nothing of BG0 or of a person twice. And
// the ROM declares the whole ring less its one spare row (gBrFieldView: 184 above the
// LCD, 152 below, 496 rows), so that is the band the page asks for, and inside the map
// every row of it past the LCD is the map's own: the still render-maps.py draws of it
// (still.ts), standing and walking every way.
//
// Pinned: SEED puts seat 0 on SAFARI ZONE SOUTHEAST (15,14), as play.spec's does, and
// #nobots keeps anybody else off the screen, so the rows past the window hold nothing
// but what the core chose to draw there.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { clipAndCamera, edgeCut, insetOf, ram, tap } from './play';
import { installStill, type StillReport } from './still';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out', 'picture');
const PORTRAIT = { width: 390, height: 844 };
/** A desktop, which shows more beside the LCD than above and below it at a phone's zoom. */
const DESKTOP = { width: 1600, height: 900 };
/** The ROM's wide band (gBrFieldViewWide): 128 columns each side, 40 rows. */
const WIDE = { side: 128, rows: 40 };
/** A big desktop's window, wider than the wide ring's 496 columns with room to spare. */
const BIG_DESKTOP = { width: 1920, height: 1080 };
/** Of a 16-column strip, the share of pixels drifting fog changes in 16 frames, at least.
 *  Lower than the wide-band test's 0.5, which is against the clear picture and so counts
 *  the tint as well: from one fogged look to the next the tint holds still, and only the
 *  clouds, a column every four frames, change anything. */
const DRIFT = 0.2;

const SEED = 5376;
const SAFARI_SE = '26:13';
const CELL = { x: 15, y: 14 };
const BR_PHASE_SAFARI = 1;
/** field.ts's SPRITE_BAND, the sprite window the page asks the core for: copied, as a
 *  spec cannot import field.ts. */
const WINDOW = { top: 40, bottom: 56 };
/** The ROM's band (gBrFieldView, include/br/br_field.h): the 512-row ring less one row,
 *  184 above the LCD and 152 below (POK-378). phone.spec holds the page to the ROM's own
 *  bytes. */
const TALL = { top: 184, bottom: 152 };
/** A 256-row band, the legacy one: the ring before POK-329, and the sprite window's rows. */
const LEGACY = { top: WINDOW.top, bottom: WINDOW.bottom };
/** field.ts's LCD_LEFT/LCD_TOP: where our own tile sits on the LCD. */
const LCD_LEFT = 112;
const LCD_TOP = 72;
/** `struct BrSeat` (include/br/br_ghosts.h): seat 16 is nobody's in solo. */
const SEAT = 16;
const SEAT_SIZE = 16;
const BR_NO_OBJ = 0xff;
const DIR_SOUTH = 1;
const SKIN = 15;
/** Nine rows down is still inside the ROM's object box (BrField_InObjectView: seven up,
 *  nine down), so the ghost is a real object with a sprite -- a 16x32 whose top is at
 *  LCD row 200 and whose legs run on to 231, past the window's 216. */
const GHOST_ROWS_DOWN = 9;
const GHOST = { x: LCD_LEFT, y: LCD_TOP + GHOST_ROWS_DOWN * 16 + 16 - 32, w: 16, h: 32 };
/** Route 103 (80x22), whose bottom edge is Oldale Town's top: column 9 is the path south,
 *  open from row 13 to the edge. At rest on row 13 the band's last row is 96 past the
 *  map's last (13*16 - 72 + 160 + 152 - 22*16), and each step down puts 16 more of it past
 *  the edge. */
const ROUTE_103 = { id: 'MAP_ROUTE103', ref: '0:18', w: 80, h: 22 };
const EDGE_COLUMN = 9;
const EDGE_FROM = 13;
const BAND_BOTTOM = TALL.bottom;
/** Rustboro City (40x60): column 21 is clear from row 0 to row 39 -- no grass, no trainer,
 *  nobody walking into it -- and so is row 11 from column 21 to 27 (ring-tall.txt walks
 *  both). Standing anywhere from (7..31, 16..45) the band's 31 rows and 16 columns (the
 *  player's -16..+14 and -7..+8) are all inside the map, so none of it is clipped. */
const RUSTBORO = { id: 'MAP_RUSTBORO_CITY', ref: '0:3', w: 40, h: 60 };
const RUSTBORO_LAND = { x: 21, y: 25 };
/** Rustboro's top edge is Route 115's bottom (40x80, no offset), and column 21 runs on up
 *  it to row 77 at least (ring-tall.txt walks it too). */
const ROUTE_115 = { id: 'MAP_ROUTE115', ref: '0:30', w: 40, h: 80 };
/** Rustboro's right edge is Route 116's left (100x20, no offset): row 11 runs on into it,
 *  clear to its column 5. */
const ROUTE_116 = { id: 'MAP_ROUTE116', ref: '0:31', w: 100, h: 20 };
const ROUTE_116_EAST_TO = 4;
/** still.ts's thresholds: a 16x16 cell of the picture is the still when half the pixels it
 *  compares are, within mGBA's colour rounding -- a flower's frames change up to 40% of
 *  its cell, another metatile's cell matches under 20%, and a column past the ring's
 *  none -- and a cell that compares under 64 says nothing. Every picture as a whole is
 *  90% the still. */
const STILL = { tolerance: 10, pass: 0.5, minPixels: 64 };
const FRAME_PASS = 0.9;
/** `struct Weather` (include/field_weather.h): the weather Task_WeatherMain changes to. */
const WEATHER_CURR = 0x6d0;
const WEATHER_NEXT = 0x6d1;
const WEATHER_FOG_HORIZONTAL = 6;

type Pic = { width: number; height: number; left: number; top: number; data: Uint8Array };
type Emu = {
  read(addr: number, width: 8 | 16 | 32): number;
  write(addr: number, value: number, width: 8 | 16 | 32): void;
  onFrame(fn: () => void): () => void;
  picture(): Pic | null;
  setSpriteBand(w: { top: number; bottom: number } | null): { top: number; bottom: number } | null;
  setOamTable(addr: number | null): boolean;
  pause(): void;
  resume(): void;
  saveState(slot: number): boolean;
  loadState(slot: number): boolean;
  viewport: { left: number; top: number; right: number; bottom: number } | null;
  spriteBand: { top: number; bottom: number } | null;
};
type PicWindow = { __hbr: { emu: Emu }; __pic?: Pic; __seen?: Record<string, Set<number>[]> };
/** A rectangle of LCD-relative rows and columns: y may be above the LCD or past it. */
type Rect = { x: number; y: number; w: number; h: number };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Solo from the boot to the seed's Safari cell, standing still. */
async function boot(page: Page, sym: Record<string, number>, hash: string): Promise<void> {
  await page.goto(`/#solo&nobots&seed=${SEED}${hash}&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
  await page.waitForSelector('body.in-match', { timeout: 60_000 });
  await expect
    .poll(async () => {
      const r = await ram(page, sym);
      return r.phase === BR_PHASE_SAFARI && r.onOverworld && r.map === SAFARI_SE ? `${r.x},${r.y}` : '';
    }, { timeout: 60_000, message: 'standing on the seed\'s Safari cell' })
    .toBe(`${CELL.x},${CELL.y}`);
  // The map-name popup and the opening's lines come and go over the first seconds.
  await page.waitForTimeout(4_000);
}

/** The picture `frames` frames on, kept in the page as __pic: taken in a frame listener,
 *  where the core's thread waits, so it is one whole frame. */
function grab(page: Page, frames = 2): Promise<{ width: number; height: number; left: number; top: number }> {
  return page.evaluate((n) => new Promise((resolve, reject) => {
    const w = window as unknown as PicWindow;
    let k = 0;
    const timer = setTimeout(() => reject(new Error('no frame')), 10_000);
    const off = w.__hbr.emu.onFrame(() => {
      if (++k < n) return;
      off();
      clearTimeout(timer);
      const p = w.__hbr.emu.picture();
      if (!p) return reject(new Error('no picture: a core without brPicturePtr, or nothing loaded'));
      w.__pic = p;
      resolve({ width: p.width, height: p.height, left: p.left, top: p.top });
    });
  }), frames);
}

/** The distinct colours in __pic's rows [from, to) (LCD rows), all columns. */
function coloursIn(page: Page, from: number, to: number): Promise<number[]> {
  return page.evaluate(([a, b]) => {
    const p = (window as unknown as PicWindow).__pic!;
    const px = new Uint32Array(p.data.buffer);
    const seen = new Set<number>();
    for (let y = Math.max(0, p.top + a); y < Math.min(p.height, p.top + b); y++) for (let x = 0; x < p.width; x++) seen.add(px[y * p.width + x] >>> 0);
    return [...seen];
  }, [from, to] as const);
}

/** __pic's rows past the sprite window, as [from, to) LCD rows. */
function pastWindow(pic: { height: number; top: number }): Array<[number, number]> {
  return [[-pic.top, -WINDOW.top], [160 + WINDOW.bottom, pic.height - pic.top]].filter(([a, b]) => b > a) as Array<[number, number]>;
}

/** Saves __pic as a PNG under out/picture, the LCD's edge marked. */
async function save(page: Page, name: string): Promise<void> {
  const url = await page.evaluate(() => {
    const p = (window as unknown as PicWindow).__pic!;
    const c = document.createElement('canvas');
    c.width = p.width;
    c.height = p.height;
    const rgba = new Uint8ClampedArray(p.data);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    c.getContext('2d')!.putImageData(new ImageData(rgba, p.width, p.height), 0, 0);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
}

/** Learns, over `frames` frames, every value each pixel of `r` takes -- the map's own
 *  animation included -- into __seen[key]. */
function learn(page: Page, key: string, r: Rect, frames: number): Promise<void> {
  return page.evaluate(([k, rect, n]) => new Promise<void>((resolve) => {
    const w = window as unknown as PicWindow;
    const seen = (w.__seen ??= {})[k] ?? Array.from({ length: rect.w * rect.h }, () => new Set<number>());
    w.__seen[k] = seen;
    let got = 0;
    const off = w.__hbr.emu.onFrame(() => {
      const p = w.__hbr.emu.picture();
      if (!p) return;
      const px = new Uint32Array(p.data.buffer);
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) seen[y * rect.w + x].add(px[(p.top + rect.y + y) * p.width + p.left + rect.x + x] >>> 0);
      if (++got >= n) {
        off();
        resolve();
      }
    });
  }), [key, r, frames] as const);
}

/** Of __pic's rows [from, to) (LCD rows), the share of pixels equal to the one `by` rows
 *  away: 1 for rows that are another rows' echo. */
function sameAs(page: Page, from: number, to: number, by: number): Promise<number> {
  return page.evaluate(([a, b, d]) => {
    const p = (window as unknown as PicWindow).__pic!;
    const px = new Uint32Array(p.data.buffer);
    let same = 0;
    let all = 0;
    for (let y = Math.max(0, p.top + a); y < Math.min(p.height, p.top + b); y++) {
      if (y + d < 0 || y + d >= p.height) continue;
      for (let x = 0; x < p.width; x++, all++) same += px[y * p.width + x] === px[(y + d) * p.width + x] ? 1 : 0;
    }
    return all ? same / all : 1;
  }, [from, to, by] as const);
}

/** Keeps __pic as __pic0, to compare a later picture with. */
function keep(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as PicWindow & { __pic0?: Pic };
    w.__pic0 = { ...w.__pic!, data: new Uint8Array(w.__pic!.data) };
  });
}

/** Of __pic's rows [from, to), the share of pixels that differ from __pic0's. */
function changed(page: Page, from: number, to: number): Promise<number> {
  return page.evaluate(([a, b]) => {
    const w = window as unknown as PicWindow & { __pic0?: Pic };
    const p = w.__pic!;
    const now = new Uint32Array(p.data.buffer);
    const then = new Uint32Array(w.__pic0!.data.buffer);
    let diff = 0;
    let all = 0;
    for (let y = Math.max(0, p.top + a); y < Math.min(p.height, p.top + b); y++) {
      for (let x = 0; x < p.width; x++, all++) diff += now[y * p.width + x] !== then[y * p.width + x] ? 1 : 0;
    }
    return all ? diff / all : 0;
  }, [from, to] as const);
}

/** Over `frames` frames, how many pixels of `r` took a value __seen[key] never had. */
function strange(page: Page, key: string, r: Rect, frames: number): Promise<number> {
  return page.evaluate(([k, rect, n]) => new Promise<number>((resolve) => {
    const w = window as unknown as PicWindow;
    const seen = w.__seen![k];
    const odd = new Set<number>();
    let got = 0;
    const off = w.__hbr.emu.onFrame(() => {
      const p = w.__hbr.emu.picture();
      if (!p) return;
      const px = new Uint32Array(p.data.buffer);
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const i = y * rect.w + x;
          if (!seen[i].has(px[(p.top + rect.y + y) * p.width + p.left + rect.x + x] >>> 0)) odd.add(i);
        }
      }
      if (++got >= n) {
        off();
        resolve(odd.size);
      }
    });
  }), [key, r, frames] as const);
}

/** Seat 16 on our map, GHOST_ROWS_DOWN rows below us, facing south: br_ghosts gives it an
 *  object, as it would a player in the match standing there. `present` 0 takes it off. */
async function ghost(page: Page, sym: Record<string, number>, present: boolean): Promise<void> {
  const here = await ram(page, sym);
  const [group, num] = here.map.split(':').map(Number);
  const y = here.y + 7 + GHOST_ROWS_DOWN; // the seat row keeps MAP_OFFSET, as the ROM does
  const x = here.x + 7;
  const row = present ? [1, SKIN, group, num, x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff, DIR_SOUTH, BR_NO_OBJ, 0, 0, 0, 0, 0, 0] : [0];
  await page.evaluate(([base, bytes]) => {
    const emu = (window as unknown as PicWindow).__hbr.emu;
    (bytes as number[]).forEach((v, i) => emu.write((base as number) + i, v, 8));
  }, [sym.gBrSeats + SEAT * SEAT_SIZE, row] as const);
}

test("the ROM's band, 496 rows, shows nothing twice: past the sprite window, the ring's own rows and the weather", async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await boot(page, sym, '');
    const emuBand = await page.evaluate(() => {
      const emu = (window as unknown as PicWindow).__hbr.emu;
      return { viewport: emu.viewport, sprites: emu.spriteBand };
    });
    expect(emuBand, "the core was asked for the ROM's band, taller than 256 rows, drawn with the 256-row window").toEqual({ viewport: { left: 0, top: TALL.top, right: 16, bottom: TALL.bottom }, sprites: WINDOW });

    // (a) Rows past the window: the map, from BG1..3's 512 rows -- the ring's rows past
    // the 256 the window holds, not those 256 again. The core before POK-329 drew every
    // BG's rows there a second time (and the HUD's corner 256 rows under itself); the ROM
    // before it had no rows there to draw, and the core drew the backdrop.
    const pic = await grab(page);
    expect({ width: pic.width, height: pic.height, top: pic.top }).toEqual({ width: 256, height: 160 + TALL.top + TALL.bottom, top: TALL.top });
    await save(page, 'tall');
    const outer = pastWindow(pic);
    expect(outer).toEqual([[-TALL.top, -WINDOW.top], [160 + WINDOW.bottom, 160 + TALL.bottom]]);
    for (const [a, b] of outer) {
      expect((await coloursIn(page, a, b)).length, `rows ${a}..${b - 1} past the window are the map`).toBeGreaterThan(4);
    }
    const echo = { above: await sameAs(page, -TALL.top, -WINDOW.top, 256), below: await sameAs(page, 160 + WINDOW.bottom, 160 + TALL.bottom, -256) };
    console.log(`picture: past the window, ${(100 * echo.above).toFixed(0)}% / ${(100 * echo.below).toFixed(0)}% of pixels match the rows 256 away`);
    expect(echo.above, 'the rows above the window are not the rows 256 below them').toBeLessThan(0.9);
    expect(echo.below, 'nor the rows below it the rows 256 above').toBeLessThan(0.9);
    // ...and the window's own band rows are the map.
    expect((await coloursIn(page, -WINDOW.top, 0)).length, 'the rows above the LCD are the map').toBeGreaterThan(4);
    expect((await coloursIn(page, 160, 160 + WINDOW.bottom)).length, 'and so are the rows below it').toBeGreaterThan(4);

    // (c) A person nine rows down, their legs past the window's bottom: drawn there, once,
    // at their true rows -- over the map -- and never at the band's top.
    const top: Rect = { x: GHOST.x, y: -WINDOW.top, w: GHOST.w, h: 16 };
    const legs: Rect = { x: GHOST.x, y: 160 + WINDOW.bottom, w: GHOST.w, h: GHOST.y + GHOST.h - (160 + WINDOW.bottom) };
    await learn(page, 'top', top, 120);
    await learn(page, 'legs', legs, 120);
    await ghost(page, sym, true);
    await expect
      .poll(() => strange(page, 'legs', legs, 4), { timeout: 15_000, message: "the ghost's legs are drawn past the window, over the map" })
      .toBeGreaterThan(8);
    await grab(page);
    await save(page, 'tall-ghost');
    expect(await strange(page, 'top', top, 30), "nothing of the ghost at the band's top").toBe(0);
    await ghost(page, sym, false);
    await expect.poll(() => strange(page, 'legs', legs, 4), { timeout: 15_000, message: 'and they go with it' }).toBe(0);

    // (b) The fog: WEATHER_FOG_HORIZONTAL, the ring's outside. Its 64x64s are a 256-row
    // grid that scrolls by wrapping, drawn every 256 rows, so the rows past the window
    // are fogged too: every 32-row stripe of them changes when it comes on.
    await grab(page);
    await keep(page);
    await page.evaluate(([at, fog]) => (window as unknown as PicWindow).__hbr.emu.write(at, fog, 8), [sym.gWeather + WEATHER_NEXT, WEATHER_FOG_HORIZONTAL] as const);
    await expect.poll(() => page.evaluate((at) => (window as unknown as PicWindow).__hbr.emu.read(at, 8), sym.gWeather + WEATHER_CURR), { timeout: 10_000 }).toBe(WEATHER_FOG_HORIZONTAL);
    await page.waitForTimeout(3_000);
    await grab(page);
    await save(page, 'tall-fog');
    for (const [a, b] of outer) {
      for (let y = a; y < b; y += 32) {
        expect(await changed(page, y, Math.min(b, y + 32)), `fog in rows ${y}..${Math.min(b, y + 32) - 1}`).toBeGreaterThan(0.5);
      }
    }
  } finally {
    await ctx.close();
  }
});

/** Of __pic's columns [from, to) (LCD columns), all rows, the share of pixels that differ
 *  from __pic0's. */
function changedColumns(page: Page, from: number, to: number): Promise<number> {
  return page.evaluate(([a, b]) => {
    const w = window as unknown as PicWindow & { __pic0?: Pic };
    const p = w.__pic!;
    const now = new Uint32Array(p.data.buffer);
    const then = new Uint32Array(w.__pic0!.data.buffer);
    let diff = 0;
    let all = 0;
    for (let y = 0; y < p.height; y++) {
      for (let x = Math.max(0, p.left + a); x < Math.min(p.width, p.left + b); x++, all++) diff += now[y * p.width + x] !== then[y * p.width + x] ? 1 : 0;
    }
    return all ? diff / all : 0;
  }, [from, to] as const);
}

// The weather's grids on the wide ring: five 64-wide columns that scroll by wrapping, a
// column off the left kept as its x & 0x1FF. Read as the hardware reads it (br_field.c
// BrField_OamEntry), and drawn 320 columns either side too (the core's _brDrawSprite),
// the fog is over every column of the band and the LCD's own left edge, at every point of
// its scroll -- not missing at the band's sides, nor drawn 512 columns off the LCD's left.
test("on a desktop the fog covers the ROM's wide band, every column of it, as it scrolls", async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  try {
    const page = await ctx.newPage();
    await boot(page, sym, '');
    const pic = await grab(page);
    expect({ width: pic.width, height: pic.height, left: pic.left, top: pic.top }, "the core draws the ROM's wide band").toEqual({ width: 240 + 2 * WIDE.side, height: 160 + 2 * WIDE.rows, left: WIDE.side, top: WIDE.rows });
    await keep(page);
    await page.evaluate(([at, fog]) => (window as unknown as PicWindow).__hbr.emu.write(at, fog, 8), [sym.gWeather + WEATHER_NEXT, WEATHER_FOG_HORIZONTAL] as const);
    await expect.poll(() => page.evaluate((at) => (window as unknown as PicWindow).__hbr.emu.read(at, 8), sym.gWeather + WEATHER_CURR), { timeout: 10_000 }).toBe(WEATHER_FOG_HORIZONTAL);
    await page.waitForTimeout(3_000);
    // The grid moves a column a few frames: 16 looks 16 frames apart see a whole 64.
    const least = new Map<number, number>();
    for (let look = 0; look < 16; look++) {
      await grab(page, 16);
      if (look === 0) await save(page, 'wide-fog');
      for (let x = -WIDE.side; x < 240 + WIDE.side; x += 16) {
        const share = await changedColumns(page, x, x + 16);
        least.set(x, Math.min(least.get(x) ?? 1, share));
      }
    }
    const bare = [...least].filter(([, share]) => share <= 0.5);
    console.log(`picture: fog over the wide band, least share changed ${Math.min(...least.values()).toFixed(2)}`);
    expect(bare.map(([x, share]) => `${x}..${x + 15}: ${share.toFixed(2)}`), 'every 16 columns fogged at every look').toEqual([]);
  } finally {
    await ctx.close();
  }
});

/** Of each 16 columns of the picture `pic` was, the least share of pixels that changed
 *  from one look to the next over 8 looks 16 frames apart. */
async function drift(page: Page, pic: { width: number; left: number }): Promise<Map<number, number>> {
  const least = new Map<number, number>();
  await grab(page);
  for (let look = 0; look < 8; look++) {
    await keep(page);
    await grab(page, 16);
    for (let x = -pic.left; x < pic.width - pic.left; x += 16) {
      const share = await changedColumns(page, x, Math.min(x + 16, pic.width - pic.left));
      least.set(x, Math.min(least.get(x) ?? 1, share));
    }
  }
  return least;
}

// With the whole window (#world, HBR-27) the row is as wide as the window, wider than
// the ring. The grid and its copies 320 columns either side (_brDrawSprite) reach 400
// columns left of the LCD and 383 right of it, past a 1920-wide window's 240 either side,
// so the clouds drift over all of it. (Roofs on BG1 stay clear: the fog is priority 2.)
test('with the whole window the fog covers every column of it, as it scrolls', async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: BIG_DESKTOP });
  try {
    const page = await ctx.newPage();
    await boot(page, sym, '&world');
    const pic = await grab(page);
    expect(pic.left, 'the window reaches past the wide ring').toBeGreaterThan(WIDE.side);
    // The control: the same looks before the fog. Nothing on this cell moves, so a strip
    // changes little from one look to the next, and the fog run's drift is the clouds'.
    const before = await drift(page, pic);
    await page.evaluate(([at, fog]) => (window as unknown as PicWindow).__hbr.emu.write(at, fog, 8), [sym.gWeather + WEATHER_NEXT, WEATHER_FOG_HORIZONTAL] as const);
    await expect.poll(() => page.evaluate((at) => (window as unknown as PicWindow).__hbr.emu.read(at, 8), sym.gWeather + WEATHER_CURR), { timeout: 10_000 }).toBe(WEATHER_FOG_HORIZONTAL);
    // Fully in (Weather_UpdateBlend), and the weather's tint on every palette with it.
    await page.waitForTimeout(5_000);
    await grab(page);
    await save(page, 'world-fog');
    const after = await drift(page, pic);
    const most = (m: Map<number, number>) => Math.max(...m.values());
    const least = (m: Map<number, number>) => Math.min(...m.values());
    console.log(`picture: whole window (${pic.width} columns), drift per 16 columns -- clear at most ${most(before).toFixed(2)}, fog at least ${least(after).toFixed(2)}`);
    // Clear, 2 to 4 of the 45 strips, all at 208..256 across the LCD's right edge, still
    // change (to 0.32 over 5 runs; something animated on this cell); the rest hold still.
    const still = [...before].filter(([, share]) => share <= DRIFT).length;
    expect(still, 'clear, the strips hold still from look to look').toBeGreaterThanOrEqual(0.8 * before.size);
    const bare = [...after].filter(([, share]) => share <= DRIFT);
    expect(bare.map(([x, share]) => `${x}..${x + 15}: ${share.toFixed(2)}`), 'clouds drifting over every 16 columns at every look').toEqual([]);
  } finally {
    await ctx.close();
  }
});

const ROUTE_120 = { id: 'MAP_ROUTE120', ref: '0:35' };
const WEATHER_SUNNY = 2;
const WEATHER_SUNNY_CLOUDS = 1;

// The clouds blend too, but they sit on the map (Route 120's three, field_weather_effect.c
// sCloudSpriteMapCoords) -- under BG2, as Emerald draws them, so they show only as
// reflections where the bottom layer is see-through: the pond at x 24..31, y 65..78. The
// test lands beside it (on land at 6,70 nothing of a cloud is ever on screen, and the
// test passed on the corner's clock alone). They are on the camera's offset, marked, so the core draws each once
// where it is -- not 320 columns either side as it does a weather grid, nor 256 rows up
// and down. Every pixel the clouds change is under a cloud the OAM has.
test("on a desktop Route 120's clouds are drawn once each, where the OAM puts them", async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&nobots&testmon&safari=15&seed=${SEED}&land=${ROUTE_120.id},27,71&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await expect
      .poll(async () => {
        const r = await ram(page, sym);
        if (r.pick) await tap(page, 'z');
        return !r.pick && r.onOverworld && r.map === ROUTE_120.ref;
      }, { timeout: 90_000, intervals: [1_000], message: 'landed on Route 120' })
      .toBe(true);
    await page.waitForTimeout(3_000);
    const pic = await grab(page);
    expect({ width: pic.width, height: pic.height }, "the core draws the ROM's wide band").toEqual({ width: 240 + 2 * WIDE.side, height: 160 + 2 * WIDE.rows });
    // Every value each pixel takes without the clouds, the map's own animation included.
    // Route 120 lands in its clouds already: clear them first.
    const weather = (w: number) => page.evaluate(([at, v]) => (window as unknown as PicWindow).__hbr.emu.write(at, v, 8), [sym.gWeather + WEATHER_NEXT, w] as const);
    await weather(WEATHER_SUNNY);
    await expect.poll(() => page.evaluate((at) => (window as unknown as PicWindow).__hbr.emu.read(at, 8), sym.gWeather + WEATHER_CURR), { timeout: 10_000 }).toBe(WEATHER_SUNNY);
    await page.waitForTimeout(3_000);
    const all: Rect = { x: -pic.left, y: -pic.top, w: pic.width, h: pic.height };
    await learn(page, 'clear', all, 240);
    await weather(WEATHER_SUNNY_CLOUDS);
    await expect.poll(() => page.evaluate((at) => (window as unknown as PicWindow).__hbr.emu.read(at, 8), sym.gWeather + WEATHER_CURR), { timeout: 10_000 }).toBe(WEATHER_SUNNY_CLOUDS);
    await page.waitForTimeout(3_000);
    // Until a cloud has crossed the pond (they drift a pixel every 2 frames and wrap every
    // 512), at least 30 frames and at most 1200: the pixels no clear frame had, and the semi-transparent OAM entries'
    // boxes where the core draws them (the side table's true place for a marked one).
    const seen = await page.evaluate(([k, g, hiAt, n]) => new Promise<{ strange: number; outside: string[]; boxes: number }>((resolve) => {
      const w = window as unknown as PicWindow & { __seen: Record<string, Set<number>[]> };
      const emu = w.__hbr.emu as unknown as { bytes(a: number, n: number): Uint8Array; picture(): Pic | null; onFrame(f: () => void): () => void };
      const learnt = w.__seen[k];
      const SIZES = [[[8, 8], [16, 16], [32, 32], [64, 64]], [[16, 8], [32, 8], [32, 16], [64, 32]], [[8, 16], [8, 32], [16, 32], [32, 64]]];
      const HI = [0, 1, -2, -1];
      // The ring's box at the LCD's top right, its clock ticking.
      const HUD = [140, 0, 240, 40];
      let boxes: number[][] = [];
      // Everybody else's boxes (a trainer turning), this frame's and last, are excused.
      let people: number[][] = [];
      let peopleNow: number[][] = [];
      let strange = 0;
      const outside = new Set<string>();
      let got = 0;
      const off = emu.onFrame(() => {
        const p = emu.picture();
        if (!p) return;
        const px = new Uint32Array(p.data.buffer);
        // The boxes read last frame are the ones this frame's picture was drawn from.
        if (got > 0) {
          for (let i = 0; i < px.length; i++) {
            if (learnt[i].has(px[i] >>> 0)) continue;
            const x = (i % p.width) - p.left;
            const y = Math.floor(i / p.width) - p.top;
            const inBox = (bs: number[][]) => bs.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b);
            if (inBox([HUD])) continue; // the clock is not a cloud
            strange++;
            if (!inBox(boxes) && !inBox(people)) outside.add(`${x},${y}`);
          }
        }
        const oam = emu.bytes(g + 0x38, 128 * 8);
        const hi = emu.bytes(hiAt, 64);
        boxes = [];
        people = peopleNow;
        peopleNow = [];
        for (let i = 0; i < 128; i++) {
          const a0 = oam[8 * i] | (oam[8 * i + 1] << 8);
          const a1 = oam[8 * i + 2] | (oam[8 * i + 3] << 8);
          if (((a0 >> 8) & 3) === 2) continue;
          const blend = ((a0 >> 10) & 3) === 1;
          let [bw, bh] = SIZES[(a0 >> 14) & 3][(a1 >> 14) & 3];
          if (((a0 >> 8) & 3) === 3) { bw *= 2; bh *= 2; }
          const nib = (hi[i >> 1] >> ((i & 1) * 4)) & 0xf;
          const y8 = a0 & 0xff;
          const x9 = a1 & 0x1ff;
          const top = nib & 4 ? y8 + 256 * HI[nib & 3] : y8 >= 216 ? y8 - 256 : y8;
          const left = nib & 4 ? x9 - (nib & 8 ? 512 : 0) : x9 >= 256 ? x9 - 512 : x9;
          (blend ? boxes : peopleNow).push([left - 1, top - 1, left + bw + 1, top + bh + 1]);
        }
        people = [...people, ...peopleNow];
        if (++got > 1200 || (got > n && strange > 0)) {
          off();
          resolve({ strange, outside: [...outside].slice(0, 20), boxes: boxes.length });
        }
      });
    }), ['clear', sym.gMain, sym.gBrOamHi, 30] as const);
    await grab(page);
    await save(page, 'wide-clouds');
    console.log(`picture: clouds, ${seen.boxes} semi-transparent entries, ${seen.strange} changed pixel-frames, ${seen.outside.length} outside every box`);
    expect(seen.boxes, 'the clouds are in the OAM').toBeGreaterThan(0);
    expect(seen.strange, 'and drawn on the picture').toBeGreaterThan(0);
    expect(seen.outside, 'nothing of a cloud where no cloud is').toEqual([]);
  } finally {
    await ctx.close();
  }
});

// A 256-row band (#band=40,56: the legacy one, a ROM without gBrFieldView's) is the
// sprite window's own rows, so the window the page asks for must draw what no window does.
test("a 256-row band: a person crossing its bottom is drawn once, and the window the page asks for is the core's own", async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await boot(page, sym, `&band=${LEGACY.top},${LEGACY.bottom}`);
    const pic = await grab(page);
    expect({ width: pic.width, height: pic.height, left: pic.left, top: pic.top }).toEqual({ width: 256, height: 256, left: 0, top: WINDOW.top });

    // (c) Cam's "NPCs cut off above the band": a person nine rows down has a top at LCD row
    // 200 and legs to 231, past the band's 216. The hardware's 8-bit y put those legs at
    // rows -40..-25, the band's top. Nothing of them may be there now.
    const top: Rect = { x: GHOST.x, y: -WINDOW.top, w: GHOST.w, h: 16 };
    const head: Rect = { x: GHOST.x, y: GHOST.y, w: GHOST.w, h: 160 + WINDOW.bottom - GHOST.y };
    await learn(page, 'top', top, 120);
    await learn(page, 'head', head, 120);
    await ghost(page, sym, true);
    // The person is the sprite's rows 11..29: its head is the last five rows above 216.
    await expect.poll(() => strange(page, 'head', head, 4), { timeout: 15_000, message: 'the ghost is drawn nine rows down' }).toBeGreaterThan(16);
    await grab(page);
    await save(page, 'band-ghost');
    expect(await strange(page, 'top', top, 30), 'nothing of the ghost at the band\'s top').toBe(0);

    // (d) The window the page asks for is the band's own 256 rows, which is what the core
    // takes with no window at all: the same frame, drawn both ways, is the same picture.
    // A window that reads the ghost's y the other way (96 rows above the LCD, none below)
    // puts it at the top, so the frames are known to differ when the reading does.
    const frameWith = async (w: { top: number; bottom: number } | null): Promise<number[]> => page.evaluate(
      ([win]) => new Promise<number[]>((resolve, reject) => {
        const emu = (window as unknown as PicWindow).__hbr.emu;
        emu.setSpriteBand(win);
        if (!emu.loadState(7)) return reject(new Error('loadState'));
        let k = 0;
        const off = emu.onFrame(() => {
          // The load lands mid-frame: the second frame after it is a whole one.
          if (++k < 3) return;
          off();
          const p = emu.picture()!;
          resolve(Array.from(new Uint32Array(p.data.buffer)));
        });
        emu.resume();
      }),
      [w] as const,
    ).then(async (px) => {
      await page.evaluate(() => (window as unknown as PicWindow).__hbr.emu.pause());
      return px;
    });
    // The window is how a core with no OAM side table reads a y; this one has the table,
    // which reads every sprite at its true rows whatever the window, so it is put away.
    await page.evaluate(() => {
      const emu = (window as unknown as PicWindow).__hbr.emu;
      emu.setOamTable(null);
      emu.pause();
      if (!emu.saveState(7)) throw new Error('saveState');
    });
    const asked = await frameWith(WINDOW);
    const none = await frameWith(null);
    const flipped = await frameWith({ top: 96, bottom: 0 });
    const differ = (a: number[], b: number[], r?: Rect) => {
      let n = 0;
      for (let i = 0; i < a.length; i++) {
        const y = Math.floor(i / 256) - WINDOW.top;
        const x = i % 256;
        if (r && (y < r.y || y >= r.y + r.h || x < r.x || x >= r.x + r.w)) continue;
        if (a[i] !== b[i]) n++;
      }
      return n;
    };
    expect(asked.length).toBe(256 * 256);
    expect(differ(asked, none), 'the window asked for draws what no window does').toBe(0);
    expect(differ(asked, flipped, top), 'a window that reads the ghost as above the LCD draws its legs at the top').toBeGreaterThan(16);
    await page.evaluate(() => (window as unknown as PicWindow).__hbr.emu.resume());
  } finally {
    await ctx.close();
  }
});

test("the band stops past the map's edge: walking down to Route 103's last row, the clip cuts exactly the rows past Oldale's first seven", async ({ browser }) => {
  test.setTimeout(240_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    // A short opening, then the drop: #land puts us on the path, whatever is picked.
    // #testmon, as play.spec has it: a party that caught nothing is out at the buzzer.
    await page.goto(`/#solo&nobots&testmon&safari=15&seed=${SEED}&land=${ROUTE_103.id},${EDGE_COLUMN},${EDGE_FROM}&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    // A on the drop map takes the section under the cursor, once it is taking presses.
    await expect
      .poll(async () => {
        const r = await ram(page, sym);
        if (r.pick) await tap(page, 'z');
        return !r.pick && r.onOverworld && r.map === ROUTE_103.ref ? `${r.x},${r.y}` : '';
      }, { timeout: 90_000, intervals: [1_000], message: 'landed on the path' })
      .toBe(`${EDGE_COLUMN},${EDGE_FROM}`);
    await page.waitForTimeout(2_000);
    const band = await page.evaluate(() => (window as unknown as PicWindow).__hbr.emu.viewport);
    expect(band, "the ROM's band").toEqual({ left: 0, top: TALL.top, right: 16, bottom: BAND_BOTTOM });

    const bottoms: number[] = [];
    for (let y = EDGE_FROM; y < ROUTE_103.h; y++) {
      await expect.poll(async () => {
        const r = await ram(page, sym);
        return `${r.x},${r.y}`;
      }, { timeout: 10_000, message: `standing on row ${y}` }).toBe(`${EDGE_COLUMN},${y}`);
      // At rest: the camera's offset back to 0, two frames on so the cut is the rest's.
      await page.waitForTimeout(300);
      const { cam, clip, scale } = await clipAndCamera(page, sym);
      expect({ x: cam.x, y: cam.y, subY: cam.subY }, 'at rest on the row').toEqual({ x: EDGE_COLUMN, y, subY: 0 });
      const inset = insetOf(clip);
      expect(inset, `a clip-path the page could have set ("${clip}")`).not.toBeNull();
      const [top, right, bottom, left] = inset!.map((v) => Math.round(v / scale));
      // The rows past the edge: the band's last row is 16y - 72 + 160 + its bottom, the
      // map's 16h -- less the 7 rows of Oldale the ROM keeps below it and draws right, the
      // two sharing their tilesets (field.ts edgeReach). None past the top: row 13's band
      // starts on the map's row 2.
      const past = Math.max(0, Math.min(BAND_BOTTOM, 16 * y - LCD_TOP + 160 + BAND_BOTTOM - 16 * ROUTE_103.h - 7 * 16));
      expect({ top, right, bottom, left }, `row ${y}: the rows past the edge, and nothing else (clip-path "${clip}")`).toEqual({ top: 0, right: 0, bottom: past, left: 0 });
      expect(edgeCut(cam, band!), "play.ts's copy agrees").toEqual({ left: 0, top: 0, right: 0, bottom: past });
      bottoms.push(bottom);
      if (y === ROUTE_103.h - 1) break;
      // One step down: held until the tile moves -- which is the step's first frame -- and
      // let go well inside the step, so a slow page never walks two (B between tries, past
      // whatever box the landing left up).
      for (let i = 0; i < 4 && (await ram(page, sym)).y === y; i++) {
        if (i) await tap(page, 'x');
        await page.keyboard.down('ArrowDown');
        try {
          for (let t = 0; t < 60 && (await ram(page, sym)).y === y; t++) await page.waitForTimeout(25);
        } finally {
          await page.keyboard.up('ArrowDown');
        }
      }
    }
    expect(bottoms, "nothing on rows 13 and 14, then 16 more a step: Oldale's seven rows are never cut").toEqual([0, 0, 16, 32, 48, 64, 80, 96, 112]);
    await page.screenshot({ path: path.join(OUT_DIR, 'edge.png') });
  } finally {
    await ctx.close();
  }
});

/** Holds `key` until `done` says the walk is over (or `ms` pass), then lets go. */
async function walk(page: Page, key: string, done: () => Promise<boolean>, ms: number): Promise<void> {
  await page.keyboard.down(key);
  try {
    const until = Date.now() + ms;
    while (Date.now() < until && !(await done())) await page.waitForTimeout(20);
  } finally {
    await page.keyboard.up(key);
  }
  // The step under way finishes, and the camera comes to rest.
  await page.waitForTimeout(500);
}

/** One line per cell that was not the still, for the log. */
function misses(r: StillReport): string {
  return r.misses.filter((m, i) => i < 6 || m.share < 0.5).slice(0, 30).map((m) => `cell ${m.x},${m.y} ${(100 * m.share).toFixed(0)}% of ${m.compared} (control ${(100 * m.control).toFixed(0)}%) at ${m.cam.x},${m.cam.y} sub ${m.cam.subX},${m.cam.subY} clip ${m.clip.join(' ')} fit ${m.fit?.join(',')} next ${JSON.stringify(m.next)}`).join(NL);
}
const NL = String.fromCharCode(10);

/** Rustboro's band against the still, standing, walking every way, under START and over
 *  the connection into Route 115: the tall ring on a portrait phone, the wide one on a
 *  desktop (`wide`), whose band is `picture` and whose sideways legs are long enough to
 *  wrap its 64-column ring. */
async function rustboroIsTheMap(browser: Browser, how: { name: string; context: BrowserContextOptions; picture: { width: number; height: number; left: number; top: number }; across: number; skipWater?: boolean; east?: boolean }): Promise<void> {
  const sym = loadSymbols();
  const ctx = await browser.newContext(how.context);
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&nobots&testmon&safari=15&seed=${SEED}&land=${RUSTBORO.id},${RUSTBORO_LAND.x},${RUSTBORO_LAND.y}&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await expect
      .poll(async () => {
        const r = await ram(page, sym);
        if (r.pick) await tap(page, 'z');
        return !r.pick && r.onOverworld && r.map === RUSTBORO.ref ? `${r.x},${r.y}` : '';
      }, { timeout: 90_000, intervals: [1_000], message: 'landed in Rustboro' })
      .toBe(`${RUSTBORO_LAND.x},${RUSTBORO_LAND.y}`);
    // The map-name popup and the landing's lines come and go.
    await page.waitForTimeout(3_000);

    const pic = await grab(page);
    expect({ width: pic.width, height: pic.height, left: pic.left, top: pic.top }, "the core draws the ROM's band").toEqual(how.picture);
    await save(page, how.name);

    await page.evaluate(installStill, {
      sym: { gSaveBlock1Ptr: sym.gSaveBlock1Ptr, gSaveBlock2Ptr: sym.gSaveBlock2Ptr, gTasks: sym.gTasks, gFieldCamera: sym.gFieldCamera, gMain: sym.gMain, CB2_Overworld: sym.CB2_Overworld, gBrOamHi: sym.gBrOamHi },
      stills: { [RUSTBORO.ref]: `/field-maps/${RUSTBORO.id}.png`, [ROUTE_115.ref]: `/field-maps/${ROUTE_115.id}.png`, [ROUTE_116.ref]: `/field-maps/${ROUTE_116.id}.png` },
      every: 0,
      keep: 12,
      ...STILL,
      skipWater: how.skipWater,
    });
    const start = () => page.evaluate(() => (window as unknown as { __still: { start(): void } }).__still.start());
    const stop = () => page.evaluate(() => (window as unknown as { __still: { stop(): StillReport } }).__still.stop());
    const hold = async (what: string, report: StillReport) => {
      const w = report.worstAt;
      console.log(`picture: ${what}: ${report.samples} frames (${report.moving} mid-step, ${report.lagged} lagged, ${report.popup} with the popup), ${report.cells} cells, ${report.missed} missed, worst frame ${(100 * report.worstFrame).toFixed(1)}% (control at best ${(100 * report.controlFrame).toFixed(1)}%), worst cell ${(100 * report.worst).toFixed(1)}%${w ? ` (cell ${w.x},${w.y} at ${w.cam.x},${w.cam.y} sub ${w.cam.subX},${w.cam.subY})` : ''}, gaps ${report.gaps}`);
      const png = await page.evaluate(() => (window as unknown as { __still: { worstPng(): string | null } }).__still.worstPng());
      const slug = what.replace(/\W+/g, '-').toLowerCase();
      fs.writeFileSync(path.join(OUT_DIR, `${how.name}-${slug}-trace.txt`), report.trace.join(NL));
      fs.writeFileSync(path.join(OUT_DIR, `${how.name}-${slug}-misses.json`), JSON.stringify(report.misses));
      if (png) fs.writeFileSync(path.join(OUT_DIR, `${how.name}-${slug}-worst.png`), Buffer.from(png.split(',')[1], 'base64'));
      const kept = await page.evaluate(() => (window as unknown as { __still: { missPngs(): string[] } }).__still.missPngs());
      kept.forEach((k, i) => fs.writeFileSync(path.join(OUT_DIR, `${how.name}-${slug}-miss-${i}.png`), Buffer.from(k.split(',')[1], 'base64')));
      expect(report.samples, `${what}: frames compared`).toBeGreaterThan(10);
      expect(report.picture, `${what}: the ROM's band`).toEqual(how.picture);
      expect(report.missed, `${what}: every cell of every frame is the still\n${misses(report)}`).toBe(0);
      expect(report.worstFrame, `${what}: every frame is the still`).toBeGreaterThanOrEqual(FRAME_PASS);
      // The check has teeth: no picture is the still one metatile down.
      expect(report.controlFrame, `${what}: the still one row off would pass`).toBeLessThan(FRAME_PASS);
    };
    const here = async () => { const r = await ram(page, sym); return { x: r.x, y: r.y, map: r.map }; };
    // The ring's rows the ROM has still to draw, which the page cuts off the band: none,
    // a moment after the camera comes to rest -- the cut is for the frames a redraw takes.
    const stale = () => page.evaluate((at) => (window as unknown as PicWindow).__hbr.emu.read(at, 32) >>> 0, sym.gBrRingStale);

    // Standing: a second of frames.
    await start();
    await page.waitForTimeout(1_000);
    await hold('standing', await stop());
    expect(await stale(), 'at rest the ring is whole').toBe(0);

    // Walking, every frame of every step: down six, up twenty (to row 11), right and left
    // `across` (six; row 11 is clear to column 39).
    await start();
    await walk(page, 'ArrowDown', async () => (await here()).y >= RUSTBORO_LAND.y + 6, 5_000);
    await walk(page, 'ArrowUp', async () => (await here()).y <= 11, 12_000);
    expect(await here(), 'up column 21 to row 11').toEqual({ x: RUSTBORO_LAND.x, y: 11, map: RUSTBORO.ref });
    await walk(page, 'ArrowRight', async () => (await here()).x >= RUSTBORO_LAND.x + how.across, 10_000);
    await walk(page, 'ArrowLeft', async () => (await here()).x <= RUSTBORO_LAND.x, 10_000);
    const walked = await stop();
    await hold('walking', walked);

    if (how.east) {
      // East over the connection into Route 116 and back: the wide ring's columns past
      // pret's were drawn from the last map's grid, where the ones more than MAP_OFFSET
      // past its edge are its border, until the ROM draws them again (gBrRingStale's
      // columns, which the page cuts).
      await start();
      await walk(page, 'ArrowRight', async () => { const h = await here(); return h.map === ROUTE_116.ref && h.x >= ROUTE_116_EAST_TO; }, 10_000);
      expect(await here(), 'along row 11 over the connection').toEqual({ x: ROUTE_116_EAST_TO, y: 11, map: ROUTE_116.ref });
      await page.waitForTimeout(500);
      expect(await stale(), "at rest on Route 116 the ring is Route 116's").toBe(0);
      await walk(page, 'ArrowLeft', async () => { const h = await here(); return h.map === RUSTBORO.ref && h.x <= RUSTBORO_LAND.x; }, 15_000);
      await hold('east over the connection and back', await stop());
      expect(await here(), 'back along row 11').toEqual({ x: RUSTBORO_LAND.x, y: 11, map: RUSTBORO.ref });
    }
    // At a run a step is 8 frames (the page's player has the running shoes).
    const steps = 26 + 2 * how.across;
    expect(walked.moving, `every frame of ${steps} steps, near enough`).toBeGreaterThan(steps * 6);

    // START: the menu is BG0's, in the LCD, and nothing of it -- nor of the corner -- is
    // drawn past the window, where the band's rows must still be the map.
    await tap(page, 'Enter');
    await page.waitForTimeout(1_000);
    await start();
    await page.waitForTimeout(1_000);
    const menu = await stop();
    await grab(page);
    await save(page, `${how.name}-start`);
    await hold('START up', menu);
    await tap(page, 'x');
    await page.waitForTimeout(1_000);

    // Over the connection, north into Route 115: the ring's rows past pret's were drawn
    // from Rustboro's grid, and the ones more than MAP_OFFSET above its edge are its
    // border -- inside Route 115 now. Until the ROM has drawn them again (gBrRingStale)
    // the page cuts them and the still shows there: Route 115 on every frame.
    await start();
    await walk(page, 'ArrowUp', async () => { const h = await here(); return h.map === ROUTE_115.ref && h.y <= ROUTE_115.h - 4; }, 8_000);
    const crossed = await stop();
    expect(await here(), 'up column 21 over the connection').toEqual({ x: RUSTBORO_LAND.x, y: ROUTE_115.h - 4, map: ROUTE_115.ref });
    await hold('over the connection', crossed);
    expect(await stale(), "at rest on Route 115 the ring is Route 115's").toBe(0);
  } finally {
    await ctx.close();
  }
}

test("inside the map the ROM's band is the map, every row of it past the LCD: standing, walking every way, under the START menu and over a connection", async ({ browser }) => {
  test.setTimeout(300_000);
  await rustboroIsTheMap(browser, {
    name: 'rustboro',
    context: { viewport: PORTRAIT, isMobile: true, hasTouch: true },
    picture: { width: 256, height: 160 + TALL.top + TALL.bottom, left: 0, top: TALL.top },
    across: 6,
  });
});

// THE WIDE RING (include/br/br_field.h): a desktop shows far more map beside the LCD than
// above and below it, so the page asks for the ROM's wide ring, 512x256 BGs, and the core
// draws its 128 columns each side and 40 rows. Every cell of it past the LCD is the map,
// walking every way -- 18 steps each way along row 11 turn the 64-column ring more than
// once -- and over the connection, where the columns past pret's are Route 115's.
test("on a desktop the ROM's wide band is the map, every column of it past the LCD: standing, walking every way, under the START menu and over a connection", async ({ browser }) => {
  test.setTimeout(300_000);
  await rustboroIsTheMap(browser, {
    name: 'rustboro-wide',
    context: { viewport: DESKTOP },
    picture: { width: 240 + 2 * WIDE.side, height: 160 + 2 * WIDE.rows, left: WIDE.side, top: WIDE.rows },
    across: 17,
    // The wide band shows the sea in Rustboro's corner and west of Route 115, which the
    // tall band never reaches: its waves are tile animation, a cell of open water the
    // still's frame 21-49% of the time, so the still's sea is left out (still.ts).
    skipWater: true,
    east: true,
  });
});
