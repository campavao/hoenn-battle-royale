// The whole window's people (HBR-27 step 3, POK-443). With `#world` the people the ROM holds
// no object for -- another seat's ghost past the box it keeps objects in -- are no longer
// drawn by the page on an overlay over the picture: the page hands them to the core, which
// draws them into the picture among the BGs, so a roof covers them the way it covers the
// ROM's own (10-19 play-test: "bots draw on top of roofs").
//
// Landed in Rustboro (21,25), a roster of one is handed to the field: seat 16, which solo
// never deals and the ROM knows nothing of, twelve tiles east -- past the box. Standing on
// open ground at (33,20) it is drawn whole; at (33,15), the walkable row behind the house to
// the north-east, whose roof is on BG1 over the whole tile, only its head shows above the roof.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { ram, tap } from './play';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out', 'world');
const DESKTOP = { width: 1920, height: 1080 };
const SEED = 5376;
const RUSTBORO = { id: 'MAP_RUSTBORO_CITY', ref: '0:3', group: 0, num: 3 };
const LAND = { x: 21, y: 25 };
const SEAT = 16;
/** LASS, as the roster names a skin. */
const SKIN = 15;
const DIR_SOUTH = 1;
const MAP_OFFSET = 7;
const OPEN = { x: 33, y: 20 };
/** Behind the house: passable, and the roof's BG1 covers all of it (the map's cover PNG). */
const BEHIND = { x: 33, y: 15 };
/** Pixels of a 16x16 cell that count as a person drawn there. */
const DRAWN = 40;

type Pic = { width: number; height: number; left: number; top: number; data: Uint8Array };
type Row = { seat: number; name: string; alive: boolean; isMe: boolean; map: { group: number; num: number }; x: number; y: number; dir: number; skin: string };
type W = {
  __hbr: {
    emu: { read(addr: number, width: 8 | 16 | 32): number; onFrame(fn: () => void): () => void; picture(): Pic | null };
    field: { setPeople(fn: (() => Row[]) | null): void };
  };
  __rows?: Row[];
};
/** One frame's picture, and where gBrWorld put the LCD on the grid that frame. */
type Shot = { width: number; height: number; left: number; top: number; lcdX: number; lcdY: number; rgba: number[] };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM, then run tools/br/dev-patch.sh`);
});

async function shoot(page: Page, world: number, name: string): Promise<Shot> {
  const got = await page.evaluate((at) => new Promise<Shot & { url: string }>((resolve, reject) => {
    const w = window as unknown as W;
    const timer = setTimeout(() => reject(new Error('no frame')), 10_000);
    const off = w.__hbr.emu.onFrame(() => {
      off();
      clearTimeout(timer);
      const p = w.__hbr.emu.picture();
      if (!p) return reject(new Error('no picture'));
      const s16 = (v: number) => (v << 16) >> 16;
      const rgba = new Uint8ClampedArray(p.data);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      const c = document.createElement('canvas');
      c.width = p.width;
      c.height = p.height;
      c.getContext('2d')!.putImageData(new ImageData(rgba, p.width, p.height), 0, 0);
      resolve({
        url: c.toDataURL('image/png'), width: p.width, height: p.height, left: p.left, top: p.top,
        lcdX: s16(w.__hbr.emu.read(at + 4, 16)), lcdY: s16(w.__hbr.emu.read(at + 6, 16)), rgba: Array.from(rgba),
      });
    });
  }), world);
  fs.writeFileSync(path.join(OUT_DIR, `people-${name}.png`), Buffer.from(got.url.split(',')[1], 'base64'));
  return got;
}

/** Pixels of the 16x16 cell at map tile (tx, ty) that differ between two shots, each
 *  placed by its own frame's gBrWorld. */
function changed(a: Shot, b: Shot, tx: number, ty: number): number {
  let n = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const at = (s: Shot) => {
        const px = s.left + (tx + MAP_OFFSET) * 16 + x - s.lcdX;
        const py = s.top + (ty + MAP_OFFSET) * 16 + y - s.lcdY;
        return px < 0 || py < 0 || px >= s.width || py >= s.height ? -1 : (py * s.width + px) * 4;
      };
      const i = at(a);
      const j = at(b);
      if (i < 0 || j < 0) continue;
      if (Math.abs(a.rgba[i] - b.rgba[j]) + Math.abs(a.rgba[i + 1] - b.rgba[j + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[j + 2]) > 24) n++;
    }
  }
  return n;
}

test('with the whole window, a person past the box is drawn into the picture, under a roof', async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&nobots&testmon&safari=15&seed=${SEED}&land=${RUSTBORO.id},${LAND.x},${LAND.y}&world&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await expect
      .poll(async () => {
        const r = await ram(page, sym);
        if (r.pick) await tap(page, 'z');
        return !r.pick && r.onOverworld && r.map === RUSTBORO.ref ? `${r.x},${r.y}` : '';
      }, { timeout: 90_000, intervals: [1_000], message: 'landed in Rustboro' })
      .toBe(`${LAND.x},${LAND.y}`);
    await page.waitForTimeout(3_000);

    // The roster's cells are the ROM's object coordinates, MAP_OFFSET in.
    const stand = (at: { x: number; y: number } | null) => page.evaluate(([spot, seat, skin, dir, map, off]) => {
      const w = window as unknown as W;
      w.__rows = spot ? [{ seat, name: 'T', alive: true, isMe: false, map, x: spot.x + off, y: spot.y + off, dir, skin: String(skin) }] : [];
      w.__hbr.field.setPeople(() => w.__rows ?? []);
    }, [at, SEAT, SKIN, DIR_SOUTH, { group: RUSTBORO.group, num: RUSTBORO.num }, MAP_OFFSET] as const);

    await stand(null);
    await page.waitForTimeout(1_000);
    const empty = await shoot(page, sym.gBrWorld, 'empty');

    await stand(OPEN);
    await page.waitForTimeout(1_000);
    const open = await shoot(page, sym.gBrWorld, 'open');
    await page.screenshot({ path: path.join(OUT_DIR, 'people-open-page.png') });
    const openHead = changed(empty, open, OPEN.x, OPEN.y - 1);
    const openFeet = changed(empty, open, OPEN.x, OPEN.y);
    console.log(`open ground: head ${openHead}, feet ${openFeet} pixels drawn`);
    expect(openFeet, 'on open ground its feet are drawn').toBeGreaterThan(DRAWN);
    expect(openHead, '...and its head').toBeGreaterThan(DRAWN / 2);

    // While we walk a step, the camera moves under it and the person stands still on the
    // map: its grid pixel in the core's buffer is the same every frame of the step.
    // Ours is the 16x32 entry in its column (the map's own people are in the buffer too).
    const seen = page.evaluate((col) => new Promise<string[]>((resolve) => {
      const w = window as unknown as W & { __hbr: { emu: { peopleBuffer(n: number): Uint8Array | null } } };
      const at: string[] = [];
      let left = 40;
      const off = w.__hbr.emu.onFrame(() => {
        const head = w.__hbr.emu.peopleBuffer(8);
        const n = head ? new DataView(head.buffer, head.byteOffset, 8).getUint32(4, true) : 0;
        const buf = w.__hbr.emu.peopleBuffer(8 + 16 * n);
        if (buf) {
          const v = new DataView(buf.buffer, buf.byteOffset, buf.length);
          for (let i = 0; i < n; i++) {
            const e = 8 + 16 * i;
            if (v.getUint8(e + 4) === 16 && v.getUint8(e + 5) === 32 && Math.abs(v.getInt16(e, true) - col) <= 32) at.push(`${v.getInt16(e, true)},${v.getInt16(e + 2, true)}`);
          }
        }
        if (--left <= 0) {
          off();
          resolve(at);
        }
      });
    }), (OPEN.x + MAP_OFFSET) * 16);
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(250);
    await page.keyboard.up('ArrowLeft');
    const spots = [...new Set(await seen)];
    console.log(`walking a step: the person at ${spots.join(' / ')}`);
    expect((await ram(page, sym)).x, 'we took a step').toBeLessThan(LAND.x);
    expect(spots, 'it stands still on the map while the camera moves').toEqual([`${(OPEN.x + MAP_OFFSET) * 16},${(OPEN.y + MAP_OFFSET) * 16 - 16}`]);

    await stand(BEHIND);
    await page.waitForTimeout(1_000);
    const behind = await shoot(page, sym.gBrWorld, 'behind');
    await page.screenshot({ path: path.join(OUT_DIR, 'people-behind-page.png') });
    const behindHead = changed(empty, behind, BEHIND.x, BEHIND.y - 1);
    const behindFeet = changed(empty, behind, BEHIND.x, BEHIND.y);
    console.log(`behind the roof: head ${behindHead}, feet ${behindFeet} pixels drawn`);
    // The roof's BG1 covers 248 of the tile's 256 pixels (the map's cover PNG); the cell
    // above it is open, so whatever of the figure is up there shows as it did in the open.
    expect(behindFeet, 'behind the house the roof covers its tile').toBeLessThanOrEqual(8);
    expect(behindHead, '...and its head shows above the roof').toBe(openHead);
    // The page's overlay draws none of it: the field's people are the core's.
    const overlay = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#overlay');
      if (!c || !c.width || !c.height) return 0;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    expect(overlay, 'nothing on the overlay').toBe(0);
  } finally {
    await ctx.close();
  }
});
