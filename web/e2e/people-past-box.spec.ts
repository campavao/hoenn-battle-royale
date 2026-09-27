// POK-318: the people past the ROM's object box. Emerald keeps an object only from 7 rows
// above the player to 9 below (and 9 left to 10 right), and a phone's field runs a dozen
// rows past that -- where Cam's trainer "cuts in and out depending on where I'm located".
// Past the box the page draws who the ROM still knows of, from its own tables, on the
// overlay (web/src/field-ghosts.ts).
//
// This puts an unused seat's row into the ROM's gBrSeats twelve rows below us -- a ghost
// the ROM gives no object, being past its box -- and looks for its sprite on the overlay
// where the ROM would stand it, then takes the row away again and sees it go.
//
// Since POK-329 the core's own picture reaches that row (the ROM's band runs 232 rows
// below the LCD), so the ghost must be drawn once: on the overlay, and not by the core.
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
/** Rows below us to try, past the box's 9: the first with nobody already on it. */
const ROWS_DOWN = [12, 13, 11];

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

test('a ghost past the box is drawn on the overlay where the ROM would stand it, and goes with its row', async ({ browser }) => {
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

    // What the core draws there without anybody: the map, its animation included.
    const bare = await corePixels(page, rect, 90, null);

    // Seat 16 there: present, a skin, our map, the cell (MAP_OFFSET included, as the ROM
    // keeps it), facing south, no object.
    const seat = symbols.gBrSeats + SEAT * SEAT_SIZE;
    const row = [1, SKIN, here.group, here.num, here.x & 0xff, (here.x >> 8) & 0xff, (here.y + down) & 0xff, ((here.y + down) >> 8) & 0xff, DIR_SOUTH, BR_NO_OBJ, 0, 0, 0, 0, 0, 0];
    const poke = (bytes: number[]) => page.evaluate(([base, b]) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      (b as number[]).forEach((v, i) => emu.write((base as number) + i, v, 8));
    }, [seat, bytes] as const);
    await poke(row);
    await expect.poll(() => opaqueAt(page, rect), { timeout: 10_000, message: 'the ghost is drawn twelve rows down' }).toBeGreaterThan(40);
    expect(await page.evaluate((base) => (window as unknown as EmuWindow).__hbr.emu.read(base + 9, 8), seat), 'and the ROM gave it no object').toBe(BR_NO_OBJ);
    // ...so the core, whose picture reaches the row, draws nothing of it: drawn once.
    expect((await corePixels(page, rect, 30, bare.seen)).strange, "the core's picture there is the bare map (-1: the band does not reach the row)").toBe(0);
    await page.screenshot({ path: path.join(OUT_DIR, 'people-past-box.png') });

    // Out of the match (present 0): gone.
    await poke([0]);
    await expect.poll(() => opaqueAt(page, rect), { timeout: 10_000, message: 'the ghost goes with its row' }).toBe(0);
  } finally {
    await ctx.close();
  }
});
