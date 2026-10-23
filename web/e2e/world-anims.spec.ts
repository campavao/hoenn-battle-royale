// A joined town's own animations (HBR-27 step 4). The ROM animates only the map it is on,
// in VRAM; a joined map on another secondary tileset is drawn from the core's decoded copy
// of it, which stood still. The core now plays tileset_anims.c's frames into that copy
// (field-extra.ts TILE_ANIMS). Standing in Slateport by its east edge, Route 134 is on
// Pacifidlog's tileset, and its strong currents (metatile 0x263, both of its tiles the
// current's, 1012 and 1013) change frame every 16 frames.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { ram, tap } from './play';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out', 'world');
const DESKTOP = { width: 1920, height: 1080 };
const SLATEPORT = { id: 'MAP_SLATEPORT_CITY', ref: '0:1', width: 40 };
const LAND = { x: 37, y: 13 };
const MAP_OFFSET = 7;
/** Route 134 cells of metatile 0x263, the current, in Route 134's own coordinates. */
const CURRENT = [{ x: 15, y: 15 }, { x: 16, y: 16 }, { x: 17, y: 17 }];

type Pic = { width: number; height: number; left: number; top: number; data: Uint8Array };
type W = { __hbr: { emu: { read(addr: number, width: 8 | 16 | 32): number; onFrame(fn: () => void): () => void; picture(): Pic | null } } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM, then run tools/br/dev-patch.sh`);
});

/** The current's cells' pixels, frames apart: each look is one frame's picture, its cells
 *  placed by that frame's gBrWorld. */
function looks(page: Page, world: number, cells: { x: number; y: number }[], every: number, n: number): Promise<string[]> {
  return page.evaluate(([at, cs, gap, count]) => new Promise<string[]>((resolve, reject) => {
    const w = window as unknown as W;
    const out: string[] = [];
    let k = 0;
    const timer = setTimeout(() => reject(new Error('no frames')), 20_000);
    const off = w.__hbr.emu.onFrame(() => {
      if (++k % gap) return;
      const p = w.__hbr.emu.picture();
      if (!p) return;
      const s16 = (v: number) => (v << 16) >> 16;
      const lcdX = s16(w.__hbr.emu.read(at + 4, 16));
      const lcdY = s16(w.__hbr.emu.read(at + 6, 16));
      let sig = '';
      for (const c of cs) {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const px = p.left + c.x * 16 + x - lcdX;
            const py = p.top + c.y * 16 + y - lcdY;
            const i = (py * p.width + px) * 4;
            sig += px < 0 || py < 0 || px >= p.width || py >= p.height ? '-' : `${p.data[i]},${p.data[i + 1]},${p.data[i + 2]};`;
          }
        }
      }
      out.push(sig);
      if (out.length >= count) {
        off();
        clearTimeout(timer);
        resolve(out);
      }
    });
  }), [world, cells, every, n] as const);
}

test("with the whole window, a joined town's own tiles animate (Route 134's currents from Slateport)", async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&nobots&testmon&safari=15&seed=5376&land=${SLATEPORT.id},${LAND.x},${LAND.y}&world&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await expect
      .poll(async () => {
        const r = await ram(page, sym);
        if (r.pick) await tap(page, 'z');
        return !r.pick && r.onOverworld && r.map === SLATEPORT.ref ? `${r.x},${r.y}` : '';
      }, { timeout: 90_000, intervals: [1_000], message: 'landed in Slateport' })
      .toBe(`${LAND.x},${LAND.y}`);
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: path.join(OUT_DIR, 'anims-slateport-page.png') });
    // Grid pixels: Route 134 is joined on Slateport's right, rows level.
    const cells = CURRENT.map((c) => ({ x: SLATEPORT.width + c.x + MAP_OFFSET, y: c.y + MAP_OFFSET }));
    const seen = await looks(page, sym.gBrWorld, cells, 16, 9);
    expect(seen.every((s) => !s.includes('-')), "the current's cells are in the picture").toBe(true);
    const frames = new Set(seen).size;
    console.log(`Route 134's current from Slateport: ${frames} different pictures in 9 looks 16 frames apart`);
    expect(frames, 'the current moves').toBeGreaterThanOrEqual(4);
  } finally {
    await ctx.close();
  }
});
