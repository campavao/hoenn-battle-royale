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
// the ROM declares the whole ring less its one spare row (gBrFieldView: 104 above the
// LCD, 232 below, 496 rows), so that is the band the page asks for, and inside the map
// every row of it past the LCD is the map's own: the still render-maps.py draws of it
// (still.ts), standing and walking every way.
//
// Pinned: SEED puts seat 0 on SAFARI ZONE SOUTHEAST (15,14), as play.spec's does, and
// #nobots keeps anybody else off the screen, so the rows past the window hold nothing
// but what the core chose to draw there.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { clipAndCamera, edgeCut, insetOf, ram, tap } from './play';
import { installStill, type StillReport } from './still';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out', 'picture');
const PORTRAIT = { width: 390, height: 844 };

const SEED = 5376;
const SAFARI_SE = '26:13';
const CELL = { x: 15, y: 14 };
const BR_PHASE_SAFARI = 1;
/** field.ts's SPRITE_BAND, the sprite window the page asks the core for: copied, as a
 *  spec cannot import field.ts. */
const WINDOW = { top: 40, bottom: 56 };
/** The ROM's band (gBrFieldView, include/br/br_field.h): the 512-row ring less one row,
 *  104 above the LCD and 232 below. phone.spec holds the page to the ROM's own bytes. */
const TALL = { top: 104, bottom: 232 };
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
 *  open from row 13 to the edge. At rest on row 13 the band's last row is 176 past the
 *  map's last (13*16 - 72 + 160 + 232 - 22*16), and each step down puts 16 more of it past
 *  the edge until all 232 are. */
const ROUTE_103 = { id: 'MAP_ROUTE103', ref: '0:18', w: 80, h: 22 };
const EDGE_COLUMN = 9;
const EDGE_FROM = 13;
const BAND_BOTTOM = TALL.bottom;
/** Rustboro City (40x60): column 21 is clear from row 0 to row 39 -- no grass, no trainer,
 *  nobody walking into it -- and so is row 11 from column 21 to 27 (ring-tall.txt walks
 *  both). Standing anywhere from (7..31, 11..40) the band's 31 rows and 16 columns (the
 *  player's -11..+19 and -7..+8) are all inside the map, so none of it is clipped. */
const RUSTBORO = { id: 'MAP_RUSTBORO_CITY', ref: '0:3', w: 40, h: 60 };
const RUSTBORO_LAND = { x: 21, y: 25 };
/** Rustboro's top edge is Route 115's bottom (40x80, no offset), and column 21 runs on up
 *  it to row 77 at least (ring-tall.txt walks it too). */
const ROUTE_115 = { id: 'MAP_ROUTE115', ref: '0:30', w: 40, h: 80 };
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
    await page.evaluate(() => {
      const emu = (window as unknown as PicWindow).__hbr.emu;
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
    expect(bottoms, '176 on row 13, then 16 more a step until the band is all past the edge').toEqual([176, 192, 208, 224, 232, 232, 232, 232, 232]);
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

test("inside the map the ROM's band is the map, every row of it past the LCD: standing, walking every way, under the START menu and over a connection", async ({ browser }) => {
  test.setTimeout(300_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
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
    expect({ width: pic.width, height: pic.height, left: pic.left, top: pic.top }, "the core draws the ROM's band: 256x496, the LCD at its row 104").toEqual({ width: 256, height: 160 + TALL.top + TALL.bottom, left: 0, top: TALL.top });
    await save(page, 'rustboro');

    await page.evaluate(installStill, {
      sym: { gSaveBlock1Ptr: sym.gSaveBlock1Ptr, gSaveBlock2Ptr: sym.gSaveBlock2Ptr, gTasks: sym.gTasks, gFieldCamera: sym.gFieldCamera, gMain: sym.gMain, CB2_Overworld: sym.CB2_Overworld },
      stills: { [RUSTBORO.ref]: `/field-maps/${RUSTBORO.id}.png`, [ROUTE_115.ref]: `/field-maps/${ROUTE_115.id}.png` },
      every: 0,
      keep: 12,
      ...STILL,
    });
    const start = () => page.evaluate(() => (window as unknown as { __still: { start(): void } }).__still.start());
    const stop = () => page.evaluate(() => (window as unknown as { __still: { stop(): StillReport } }).__still.stop());
    const hold = async (what: string, report: StillReport) => {
      const w = report.worstAt;
      console.log(`picture: ${what}: ${report.samples} frames (${report.moving} mid-step, ${report.lagged} lagged, ${report.popup} with the popup), ${report.cells} cells, ${report.missed} missed, worst frame ${(100 * report.worstFrame).toFixed(1)}% (control at best ${(100 * report.controlFrame).toFixed(1)}%), worst cell ${(100 * report.worst).toFixed(1)}%${w ? ` (cell ${w.x},${w.y} at ${w.cam.x},${w.cam.y} sub ${w.cam.subX},${w.cam.subY})` : ''}, gaps ${report.gaps}`);
      const png = await page.evaluate(() => (window as unknown as { __still: { worstPng(): string | null } }).__still.worstPng());
      const slug = what.replace(/\W+/g, '-').toLowerCase();
      fs.writeFileSync(path.join(OUT_DIR, `rustboro-${slug}-trace.txt`), report.trace.join(NL));
      fs.writeFileSync(path.join(OUT_DIR, `rustboro-${slug}-misses.json`), JSON.stringify(report.misses));
      if (png) fs.writeFileSync(path.join(OUT_DIR, `rustboro-${slug}-worst.png`), Buffer.from(png.split(',')[1], 'base64'));
      const kept = await page.evaluate(() => (window as unknown as { __still: { missPngs(): string[] } }).__still.missPngs());
      kept.forEach((k, i) => fs.writeFileSync(path.join(OUT_DIR, `rustboro-${slug}-miss-${i}.png`), Buffer.from(k.split(',')[1], 'base64')));
      expect(report.samples, `${what}: frames compared`).toBeGreaterThan(10);
      expect(report.picture, `${what}: the ROM's band`).toEqual({ width: 256, height: 160 + TALL.top + TALL.bottom, left: 0, top: TALL.top });
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

    // Walking, every frame of every step: down six, up twenty (to row 11), right six, left six.
    await start();
    await walk(page, 'ArrowDown', async () => (await here()).y >= RUSTBORO_LAND.y + 6, 5_000);
    await walk(page, 'ArrowUp', async () => (await here()).y <= 11, 12_000);
    expect(await here(), 'up column 21 to row 11').toEqual({ x: RUSTBORO_LAND.x, y: 11, map: RUSTBORO.ref });
    await walk(page, 'ArrowRight', async () => (await here()).x >= RUSTBORO_LAND.x + 6, 5_000);
    await walk(page, 'ArrowLeft', async () => (await here()).x <= RUSTBORO_LAND.x, 5_000);
    const walked = await stop();
    await hold('walking', walked);
    // At a run a step is 8 frames (the page's player has the running shoes).
    expect(walked.moving, 'every frame of 38 steps, near enough').toBeGreaterThan(38 * 6);

    // START: the menu is BG0's, in the LCD, and nothing of it -- nor of the corner -- is
    // drawn past the window, where the band's rows must still be the map.
    await tap(page, 'Enter');
    await page.waitForTimeout(1_000);
    await start();
    await page.waitForTimeout(1_000);
    const menu = await stop();
    await grab(page);
    await save(page, 'rustboro-start');
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
});
