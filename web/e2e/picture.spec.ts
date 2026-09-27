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
// 64x64 grid is laid out to.
//
// Pinned: SEED puts seat 0 on SAFARI ZONE SOUTHEAST (15,14), as play.spec's does, and
// #nobots keeps anybody else off the screen, so the rows past the window hold nothing
// but what the core chose to draw there.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { clipAndCamera, edgeCut, insetOf, ram, tap } from './play';

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
/** A band taller than 256 rows: POK-329's split, 104 above and 232 below. */
const TALL = { top: 104, bottom: 232 };
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
 *  open from row 13 to the edge. At rest on row 13 the band's last row is the map's last
 *  (13*16 - 72 + 160 + 56 = 22*16), and each step down puts 16 more of it past the edge
 *  until all 56 are. */
const ROUTE_103 = { id: 'MAP_ROUTE103', ref: '0:18', w: 80, h: 22 };
const EDGE_COLUMN = 9;
const EDGE_FROM = 13;
/** field.ts's LEGACY_BAND's bottom, which is gBrFieldView's today (phone.spec holds the
 *  page to the ROM's). */
const BAND_BOTTOM = 56;
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

test('a band taller than 256 rows shows nothing twice: past the sprite window, the backdrop and the weather', async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await boot(page, sym, `&band=${TALL.top},${TALL.bottom}`);
    const emuBand = await page.evaluate(() => {
      const emu = (window as unknown as PicWindow).__hbr.emu;
      return { viewport: emu.viewport, sprites: emu.spriteBand };
    });
    expect(emuBand, 'the core was asked for the tall band, drawn with the 256-row window').toEqual({ viewport: { left: 0, top: TALL.top, right: 16, bottom: TALL.bottom }, sprites: WINDOW });

    // (a) Rows past the window: one colour, the backdrop. The old core drew the ring's
    // rows there again, and the HUD's corner 256 rows under itself.
    const pic = await grab(page);
    expect({ width: pic.width, height: pic.height, top: pic.top }).toEqual({ width: 256, height: 160 + TALL.top + TALL.bottom, top: TALL.top });
    await save(page, 'tall');
    const outer = pastWindow(pic);
    expect(outer).toEqual([[-TALL.top, -WINDOW.top], [160 + WINDOW.bottom, 160 + TALL.bottom]]);
    const backdrop = new Set<number>();
    for (const [a, b] of outer) for (const c of await coloursIn(page, a, b)) backdrop.add(c);
    expect(backdrop.size, `rows past the window are the backdrop alone, not the ring again (${[...backdrop].slice(0, 6).map((c) => c.toString(16))})`).toBe(1);
    // ...and the window's own band rows are the map.
    expect((await coloursIn(page, -WINDOW.top, 0)).length, 'the rows above the LCD are the map').toBeGreaterThan(4);
    expect((await coloursIn(page, 160, 160 + WINDOW.bottom)).length, 'and so are the rows below it').toBeGreaterThan(4);

    // (c) A person nine rows down, their legs past the window's bottom: drawn there, once,
    // at their true rows -- over the backdrop -- and never at the band's top.
    const top: Rect = { x: GHOST.x, y: -WINDOW.top, w: GHOST.w, h: 16 };
    const legs: Rect = { x: GHOST.x, y: 160 + WINDOW.bottom, w: GHOST.w, h: GHOST.y + GHOST.h - (160 + WINDOW.bottom) };
    await learn(page, 'top', top, 120);
    await ghost(page, sym, true);
    await expect
      .poll(async () => {
        await grab(page);
        const [a, b] = [legs.y, legs.y + legs.h];
        return (await coloursIn(page, a, b)).length;
      }, { timeout: 15_000, message: 'the ghost\'s legs are drawn past the window, over the backdrop' })
      .toBeGreaterThan(1);
    await save(page, 'tall-ghost');
    expect(await strange(page, 'top', top, 30), 'nothing of the ghost at the band\'s top').toBe(0);
    await ghost(page, sym, false);
    await expect.poll(async () => {
      await grab(page);
      return (await coloursIn(page, legs.y, legs.y + legs.h)).length;
    }, { timeout: 15_000, message: 'and they go with it' }).toBe(1);

    // (b) The fog: WEATHER_FOG_HORIZONTAL, the ring's outside. Its 64x64s are a 256-row
    // grid that scrolls by wrapping, drawn every 256 rows, so the rows past the window
    // are fog over the backdrop -- its pattern, and nothing of the map.
    await page.evaluate(([at, fog]) => (window as unknown as PicWindow).__hbr.emu.write(at, fog, 8), [sym.gWeather + WEATHER_NEXT, WEATHER_FOG_HORIZONTAL] as const);
    await expect.poll(() => page.evaluate((at) => (window as unknown as PicWindow).__hbr.emu.read(at, 8), sym.gWeather + WEATHER_CURR), { timeout: 10_000 }).toBe(WEATHER_FOG_HORIZONTAL);
    await page.waitForTimeout(3_000);
    await grab(page);
    await save(page, 'tall-fog');
    const fogged = new Set<number>();
    for (const [a, b] of outer) {
      for (let y = a; y < b; y += 32) {
        const stripe = await coloursIn(page, y, Math.min(b, y + 32));
        expect(stripe.length, `fog in rows ${y}..${Math.min(b, y + 32) - 1}`).toBeGreaterThan(1);
        for (const c of stripe) fogged.add(c);
      }
    }
    // The fog's palette is 16 colours, each blended over the one backdrop.
    expect(fogged.size, 'fog over the backdrop, and nothing of the map').toBeLessThanOrEqual(17);
  } finally {
    await ctx.close();
  }
});

test("the page's band: a person crossing its bottom is drawn once, and the window it asks for is the core's own", async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await boot(page, sym, '');
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

test("the band stops at the map's edge: walking down to Route 103's last row, the clip cuts exactly the rows past it", async ({ browser }) => {
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
    expect(band?.bottom).toBe(BAND_BOTTOM);

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
      // The rows past the edge: the band's last row is 16y + 144, the map's 16h.
      const past = Math.max(0, Math.min(BAND_BOTTOM, 16 * y + 144 - 16 * ROUTE_103.h));
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
    expect(bottoms, 'none on row 13, then 16 more a step until the band is all past the edge').toEqual([0, 16, 32, 48, 56, 56, 56, 56, 56]);
    await page.screenshot({ path: path.join(OUT_DIR, 'edge.png') });
  } finally {
    await ctx.close();
  }
});
