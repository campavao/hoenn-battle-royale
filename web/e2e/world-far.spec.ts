// The maps two joins away with the whole window (HBR-27 step 4). The core draws every
// joined map it can reach (software-mode0.c _brWorldMaps, two joins deep, the window's
// whole reach at 1920x1080) -- animated, with the people on them -- and the page used to
// lay its still of each map two joins away over that on the overlay, frozen and with
// nobody on it. Now the core says which maps it drew (main.c brWorldDrawn) and the page
// draws a still only where it did not. On Route 101 at (2, 2), Route 102 is two joins
// away (by Oldale), up and to the left of the player.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { ram, tap } from './play';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out', 'world');
const DESKTOP = { width: 1920, height: 1080 };
const LAND = { x: 2, y: 2 };
const TILE = 16;

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM, then run tools/br/dev-patch.sh`);
});

type W = { __hbr: { emu: { worldDrawn(): Int32Array | null } } };

test('with the whole window, the maps two joins away are the core\'s, not stills (Route 102 from Route 101)', async ({ browser }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&nobots&testmon&safari=15&seed=5376&land=MAP_ROUTE101,${LAND.x},${LAND.y}&world&rom=${romHashParam()}`);
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await expect
      .poll(async () => {
        const r = await ram(page, sym);
        if (r.pick) await tap(page, 'z');
        return !r.pick && r.onOverworld ? `${r.x},${r.y}` : '';
      }, { timeout: 90_000, intervals: [1_000], message: 'landed on Route 101' })
      .toBe(`${LAND.x},${LAND.y}`);
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: path.join(OUT_DIR, 'far-route101-page.png') });

    // The core's list: Oldale above (0, -20, 20x20) and Route 102 left of it (-50, -20, 50x20).
    const drawn = await page.evaluate(() => Array.from((window as unknown as W).__hbr.emu.worldDrawn() ?? []));
    console.log(`the core drew: ${JSON.stringify(drawn)}`);
    expect(drawn[0], 'the core drew a world').toBe(1);
    const maps = [];
    for (let i = 0; i < drawn[1]; i++) maps.push(drawn.slice(2 + 4 * i, 6 + 4 * i).join(','));
    expect(maps, 'Oldale and Route 102 among them').toEqual(expect.arrayContaining(['0,-20,20,20', '-50,-20,50,20']));

    // The overlay over Route 102: the field canvas's map pixel (0, 0) is the player's tile
    // centre less half the canvas, give or take the LCD's 8-pixel offset.
    const opaque = await page.evaluate(([lx, ly, tile]) => {
      const c = document.querySelector<HTMLCanvasElement>('#overlay');
      if (!c || !c.width) return -1;
      const ox = lx * tile + tile / 2 - c.width / 2;
      const oy = ly * tile + tile / 2 - c.height / 2;
      // Route 102 is map x < 0, y < 0; keep a tile off its edges each way.
      const x1 = Math.floor(-tile - ox);
      const y1 = Math.floor(-tile - oy);
      if (x1 <= 0 || y1 <= 0) return -2;
      const d = c.getContext('2d')!.getImageData(0, 0, x1, y1).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    }, [LAND.x, LAND.y, TILE] as const);
    console.log(`overlay pixels over Route 102: ${opaque}`);
    expect(opaque, 'the overlay lays no still over Route 102').toBe(0);
  } finally {
    await ctx.close();
  }
});
