// The whole window (HBR-27, Cam 2026-10-20: "one layer"). The page hands
// the core the ROM's gBrWorld and asks for a band the size of the whole layout; the core
// draws BG1..3 past the LCD from the ROM's map grid and metatiles, so on the field none
// of the window is the page's still. Held here the way picture.spec holds the ROM's band:
// every 16x16 cell of the picture that lies inside a map the check has a still for is
// that still, standing and walking.
//
// Pinned like picture.spec's Rustboro walk: solo, no bots, landed on Rustboro (21,25).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { ram, tap } from './play';
import { installStill, type StillReport } from './still';
import { aroundOf } from './maps';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out', 'world');
/** A 1920x1080 desktop: at the phone's zoom, rounded up to 2, the layout is 960x540. */
const DESKTOP = { width: 1920, height: 1080 };
const SEED = 5376;
const RUSTBORO = { id: 'MAP_RUSTBORO_CITY', ref: '0:3' };
const LAND = { x: 21, y: 25 };
const ROUTE_115 = { id: 'MAP_ROUTE115', ref: '0:30' };
const ROUTE_101 = { id: 'MAP_ROUTE101', ref: '0:16' };
const OLDALE = { id: 'MAP_OLDALE_TOWN', ref: '0:10' };
/** What the ROM's wide band draws (gBrFieldViewWide): the whole window is more. */
const WIDE = { width: 240 + 128 + 128, height: 160 + 40 + 40 };
const STILL = { tolerance: 10, pass: 0.5, minPixels: 64 };

type Pic = { width: number; height: number; left: number; top: number; data: Uint8Array };
type Emu = { onFrame(fn: () => void): () => void; picture(): Pic | null };
type PicWindow = { __hbr: { emu: Emu }; __pic?: Pic };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM, then run tools/br/dev-patch.sh`);
});

/** The core's whole picture, one frame on, saved as a PNG. */
async function savePicture(page: Page, name: string): Promise<{ width: number; height: number; left: number; top: number }> {
  const got = await page.evaluate(() => new Promise<{ url: string; width: number; height: number; left: number; top: number }>((resolve, reject) => {
    const w = window as unknown as PicWindow;
    const timer = setTimeout(() => reject(new Error('no frame')), 10_000);
    const off = w.__hbr.emu.onFrame(() => {
      off();
      clearTimeout(timer);
      const p = w.__hbr.emu.picture();
      if (!p) return reject(new Error('no picture'));
      const c = document.createElement('canvas');
      c.width = p.width;
      c.height = p.height;
      const rgba = new Uint8ClampedArray(p.data);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      c.getContext('2d')!.putImageData(new ImageData(rgba, p.width, p.height), 0, 0);
      resolve({ url: c.toDataURL('image/png'), width: p.width, height: p.height, left: p.left, top: p.top });
    });
  }));
  fs.writeFileSync(path.join(OUT_DIR, `${name}-core.png`), Buffer.from(got.url.split(',')[1], 'base64'));
  return { width: got.width, height: got.height, left: got.left, top: got.top };
}

async function walk(page: Page, key: string, done: () => Promise<boolean>, ms: number): Promise<void> {
  await page.keyboard.down(key);
  try {
    const until = Date.now() + ms;
    while (Date.now() < until && !(await done())) await page.waitForTimeout(20);
  } finally {
    await page.keyboard.up(key);
  }
  await page.waitForTimeout(500);
}

async function land(page: Page, sym: Record<string, number>, hash: string, at = { map: RUSTBORO, ...LAND }): Promise<void> {
  await page.goto(`/#solo&nobots&testmon&safari=15&seed=${SEED}&land=${at.map.id},${at.x},${at.y}${hash}&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
  await page.waitForSelector('body.in-match', { timeout: 60_000 });
  await expect
    .poll(async () => {
      const r = await ram(page, sym);
      if (r.pick) await tap(page, 'z');
      return !r.pick && r.onOverworld && r.map === at.map.ref ? `${r.x},${r.y}` : '';
    }, { timeout: 90_000, intervals: [1_000], message: `landed in ${at.map.id}` })
    .toBe(`${at.x},${at.y}`);
  await page.waitForTimeout(3_000);
}

const name = 'after';
test('after: a 1920x1080 desktop in Rustboro, the whole window from the map grid', async ({ browser }) => {
  test.setTimeout(240_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  try {
    const page = await ctx.newPage();
    await land(page, sym, '');
    const pic = await savePicture(page, `${name}-standing`);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-standing.png`) });
    const lay = await page.evaluate(() => (window as unknown as { __hbr: { field: { placement: { cols: number; rows: number; lcdCol: number; lcdRow: number } } } }).__hbr.field.placement);
    expect(pic.width, 'the core draws every column the layout shows').toBeGreaterThanOrEqual(lay.cols);
    expect(pic.left, '...with the LCD where the layout put it').toBeGreaterThanOrEqual(lay.lcdCol);
    expect(pic.width * pic.height, 'more than the wide band').toBeGreaterThan(WIDE.width * WIDE.height);
    console.log(`world: layout ${lay.cols}x${lay.rows}, LCD at ${lay.lcdCol},${lay.lcdRow}; picture ${pic.width}x${pic.height}, LCD at ${pic.left},${pic.top}`);

    await page.evaluate(installStill, {
      sym: { gSaveBlock1Ptr: sym.gSaveBlock1Ptr, gSaveBlock2Ptr: sym.gSaveBlock2Ptr, gTasks: sym.gTasks, gFieldCamera: sym.gFieldCamera, gMain: sym.gMain, CB2_Overworld: sym.CB2_Overworld, gBrOamHi: sym.gBrOamHi, gBrWorld: sym.gBrWorld },
      // Route 116 to the east reaches past the grid's seven metatiles on the walk right.
      ...aroundOf([RUSTBORO.id]),
      every: 0,
      keep: 6,
      ...STILL,
      skipWater: true,
    });
    const here = async () => { const r = await ram(page, sym); return { x: r.x, y: r.y, map: r.map }; };
    await page.evaluate(() => (window as unknown as { __still: { start(): void } }).__still.start());
    await walk(page, 'ArrowDown', async () => (await here()).y >= LAND.y + 6, 5_000);
    await walk(page, 'ArrowUp', async () => (await here()).y <= 11, 12_000);
    await walk(page, 'ArrowRight', async () => (await here()).x >= LAND.x + 10, 10_000);
    await savePicture(page, `${name}-walked`);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-walked.png`) });
    await walk(page, 'ArrowLeft', async () => (await here()).x <= LAND.x, 10_000);
    const report = await page.evaluate(() => (window as unknown as { __still: { stop(): StillReport } }).__still.stop());
    const kept = await page.evaluate(() => (window as unknown as { __still: { missPngs(): string[] } }).__still.missPngs());
    kept.forEach((k, i) => fs.writeFileSync(path.join(OUT_DIR, `${name}-miss-${i}.png`), Buffer.from(k.split(',')[1], 'base64')));
    fs.writeFileSync(path.join(OUT_DIR, `${name}-misses.json`), JSON.stringify(report.misses.slice(0, 40), null, 1));
    console.log(`world ${name}: ${report.samples} frames (${report.moving} mid-step), ${report.cells} cells, ${report.missed} missed, worst frame ${(100 * report.worstFrame).toFixed(1)}%, control ${(100 * report.controlFrame).toFixed(1)}%`);
    expect(report.samples, 'frames compared').toBeGreaterThan(10);
    expect(report.missed, 'every cell inside a known map is the still').toBe(0);
    expect(report.controlFrame, 'the check has teeth').toBeLessThan(0.9);
  } finally {
    await ctx.close();
  }
});

// The band is sized at boot (Cam's 2026-10-26 play-test): a window made bigger after it
// showed the stills past the boot's band -- the ocean standing still, cut off square
// where the core's picture ended. So the boot asks for the window grown to its screen.
test('a window made bigger mid-match: the core still draws all of it', async ({ browser }) => {
  test.setTimeout(240_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, screen: { width: 1600, height: 1000 } });
  try {
    const page = await ctx.newPage();
    await land(page, sym, '');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(1_000);
    const pic = await savePicture(page, 'grown');
    await page.screenshot({ path: path.join(OUT_DIR, 'grown.png') });
    const lay = await page.evaluate(() => (window as unknown as { __hbr: { field: { placement: { cols: number; rows: number; lcdCol: number; lcdRow: number } } } }).__hbr.field.placement);
    expect(pic.left, 'every column left of the LCD').toBeGreaterThanOrEqual(lay.lcdCol);
    expect(pic.width - pic.left, '...and right of it').toBeGreaterThanOrEqual(lay.cols - lay.lcdCol);
    expect(pic.top, 'every row above it').toBeGreaterThanOrEqual(lay.lcdRow);
    expect(pic.height - pic.top, '...and below it').toBeGreaterThanOrEqual(lay.rows - lay.lcdRow);
  } finally {
    await ctx.close();
  }
});

// Past the grid (HBR-27 step 2): the 10-20 play-test's seams were where the backup grid's
// seven metatiles of each neighbour ran out (feedback item 2). The core now walks the
// map's connections itself, so every neighbour on screen is drawn from its own layout --
// Route 101's two towns, which share its tiles, and Route 115 north of Rustboro, which
// does not (gTileset_Fallarbor over gTileset_Rustboro: tiles decoded, palettes fitted).
// Each walk crosses the join and back, the frame of the crossing included.
const CROSSINGS = [
  { name: 'Route 101 into Oldale and back', at: { map: ROUTE_101, x: 10, y: 4 }, maps: [ROUTE_101.id, OLDALE.id, 'MAP_LITTLEROOT_TOWN'], there: OLDALE, stopY: 15 },
  { name: 'Rustboro into Route 115 and back', at: { map: RUSTBORO, x: 21, y: 10 }, maps: [RUSTBORO.id, ROUTE_115.id], there: ROUTE_115, stopY: 76 },
];

for (const cross of CROSSINGS) {
  test(`after: ${cross.name}, every neighbour on screen its own still`, async ({ browser }) => {
    test.setTimeout(240_000);
    const sym = loadSymbols();
    const ctx = await browser.newContext({ viewport: DESKTOP });
    try {
      const page = await ctx.newPage();
      await land(page, sym, '', cross.at);
      const tag = `cross-${cross.at.map.id}`;
      await savePicture(page, `${tag}-standing`);
      await page.evaluate(installStill, {
        sym: { gSaveBlock1Ptr: sym.gSaveBlock1Ptr, gSaveBlock2Ptr: sym.gSaveBlock2Ptr, gTasks: sym.gTasks, gFieldCamera: sym.gFieldCamera, gMain: sym.gMain, CB2_Overworld: sym.CB2_Overworld, gBrOamHi: sym.gBrOamHi, gBrWorld: sym.gBrWorld },
        ...aroundOf(cross.maps),
        every: 0,
        keep: 6,
        ...STILL,
        skipWater: true,
      });
      const here = async () => { const r = await ram(page, sym); return { x: r.x, y: r.y, map: r.map }; };
      await page.evaluate(() => (window as unknown as { __still: { start(): void } }).__still.start());
      // North over the join, a few steps on, then back to where it began.
      await walk(page, 'ArrowUp', async () => { const h = await here(); return h.map === cross.there.ref && h.y <= cross.stopY; }, 15_000);
      expect((await here()).map, 'crossed the join').toBe(cross.there.ref);
      await savePicture(page, `${tag}-there`);
      await page.screenshot({ path: path.join(OUT_DIR, `${tag}-there.png`) });
      await walk(page, 'ArrowDown', async () => { const h = await here(); return h.map === cross.at.map.ref && h.y >= cross.at.y; }, 15_000);
      expect((await here()).map, 'and back').toBe(cross.at.map.ref);
      const report = await page.evaluate(() => (window as unknown as { __still: { stop(): StillReport } }).__still.stop());
      const kept = await page.evaluate(() => (window as unknown as { __still: { missPngs(): string[] } }).__still.missPngs());
      kept.forEach((k, i) => fs.writeFileSync(path.join(OUT_DIR, `${tag}-miss-${i}.png`), Buffer.from(k.split(',')[1], 'base64')));
      fs.writeFileSync(path.join(OUT_DIR, `${tag}-misses.json`), JSON.stringify(report.misses.slice(0, 40), null, 1));
      console.log(`${cross.name}: ${report.samples} frames (${report.moving} mid-step), ${report.cells} cells, ${report.missed} missed, worst frame ${(100 * report.worstFrame).toFixed(1)}%, control ${(100 * report.controlFrame).toFixed(1)}%`);
      expect(report.samples, 'frames compared').toBeGreaterThan(10);
      expect(report.missed, 'every cell inside a known map is the still').toBe(0);
      expect(report.controlFrame, 'the check has teeth').toBeLessThan(0.9);
    } finally {
      await ctx.close();
    }
  });
}
