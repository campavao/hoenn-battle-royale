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
import { ram, tap } from './play';
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

/** Keeps __pic as __pic0, to compare a later picture with. */
function keep(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as PicWindow & { __pic0?: Pic };
    w.__pic0 = { ...w.__pic!, data: new Uint8Array(w.__pic!.data) };
  });
}

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

// With the whole window (HBR-27) the row is as wide as the window, wider than
// the ring. The grid and its copies 320 columns either side (_brDrawSprite) reach 400
// columns left of the LCD and 383 right of it, past a 1920-wide window's 240 either side,
// so the clouds drift over all of it. (Roofs on BG1 stay clear: the fog is priority 2.)
test('with the whole window the fog covers every column of it, as it scrolls', async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: BIG_DESKTOP });
  try {
    const page = await ctx.newPage();
    await boot(page, sym, '');
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
    expect(pic.width, 'the whole window, past the wide ring').toBeGreaterThan(240 + 2 * WIDE.side);
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
    await save(page, 'world-clouds');
    console.log(`picture: clouds, ${seen.boxes} semi-transparent entries, ${seen.strange} changed pixel-frames, ${seen.outside.length} outside every box`);
    expect(seen.boxes, 'the clouds are in the OAM').toBeGreaterThan(0);
    expect(seen.strange, 'and drawn on the picture').toBeGreaterThan(0);
    expect(seen.outside, 'nothing of a cloud where no cloud is').toEqual([]);
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

/** Rustboro's whole window against the still (HBR-27), standing, walking every way,
 *  under START and over the connection into Route 115 -- and on a desktop (`east`) into
 *  Route 116 and back: every cell the window shows is the core's, from the ROM's map. */
async function rustboroIsTheMap(browser: Browser, how: { name: string; context: BrowserContextOptions; across: number; skipWater?: boolean; east?: boolean }): Promise<void> {
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
    // The whole window (HBR-27): the band the layout asked for, every row and column the
    // window shows, drawn from the map -- so every cell of it must be the still.
    const v = await page.evaluate(() => (window as unknown as { __hbr: { emu: { viewport: { left: number; top: number; right: number; bottom: number } } } }).__hbr.emu.viewport);
    const picture = { width: 240 + v.left + v.right, height: 160 + v.top + v.bottom, left: v.left, top: v.top };
    expect({ width: pic.width, height: pic.height, left: pic.left, top: pic.top }, "the core draws the band asked for").toEqual(picture);
    await save(page, how.name);

    await page.evaluate(installStill, {
      sym: { gSaveBlock1Ptr: sym.gSaveBlock1Ptr, gSaveBlock2Ptr: sym.gSaveBlock2Ptr, gTasks: sym.gTasks, gFieldCamera: sym.gFieldCamera, gMain: sym.gMain, CB2_Overworld: sym.CB2_Overworld, gBrOamHi: sym.gBrOamHi, gBrWorld: sym.gBrWorld },
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
      expect(report.picture, `${what}: the band asked for`).toEqual(picture);
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

test("on a phone the whole window is the map, every row of it: standing, walking every way, under the START menu and over a connection", async ({ browser }) => {
  test.setTimeout(300_000);
  await rustboroIsTheMap(browser, { name: 'rustboro-phone', context: { viewport: PORTRAIT, isMobile: true, hasTouch: true }, across: 6 });
});

// A desktop: every column and row it shows, Rustboro's neighbours included, and the
// sideways legs long enough to cross into Route 116 and back.
test("on a desktop the whole window is the map, every cell of it: standing, walking every way, under the START menu and over a connection", async ({ browser }) => {
  test.setTimeout(300_000);
  await rustboroIsTheMap(browser, {
    name: 'rustboro-world',
    context: { viewport: DESKTOP },
    across: 17,
    // The desktop shows the sea in Rustboro's corner and west of Route 115: its waves are
    // tile animation, a cell of open water the still's frame 21-49% of the time, so the
    // still's sea is left out (still.ts).
    skipWater: true,
    east: true,
  });
});
