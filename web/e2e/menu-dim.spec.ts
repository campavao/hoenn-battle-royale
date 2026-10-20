// Feedback #33 (Cam's 2026-10-19 play-test): a battle sat over the wide map dimmed, the
// party screen over it lit -- or, indoors, on black -- two presentations of one thing.
// Off the field the field is dimmed the way a see-through battle dims it (#key-dim), a
// menu as much as a fight; the fade into the menu and out of it still runs over the map,
// and back on the field the dim is gone.
//
// Pinned: SEED and #nobots as picture.spec has them, landed in Rustboro (outdoors, so the
// composite is the map and there is something to dim).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romHashParam } from './symbols';
import { ram, tap } from './play';

const __dirname = import.meta.dirname;
const OUT_DIR = process.env.HBR_SHOT_DIR ?? path.resolve(__dirname, 'out', 'menu-dim');
const DESKTOP = { width: 1280, height: 720 };
const SEED = 5376;
const RUSTBORO = { id: 'MAP_RUSTBORO_CITY', ref: '0:3' };
const LAND = { x: 21, y: 25 };
/** index.html's #key-dim. */
const DIM = 'rgba(40, 40, 40, 0.5)';

/** The dim as shown, and the composite at a point past the picture's left edge: whether
 *  it is the map (anything but black) under it. */
function look(page: Page): Promise<{ dim: boolean; bg: string; field: number[] }> {
  return page.evaluate(() => {
    const d = document.querySelector('#key-dim') as HTMLElement;
    const f = document.querySelector('#field') as HTMLCanvasElement;
    const lcd = (document.querySelector('#canvas') as HTMLElement).getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    // Ten field pixels left of the LCD's box, halfway down it.
    const scale = fr.width / f.width;
    const x = Math.floor((lcd.x - fr.x) / scale) - 10;
    const y = Math.floor((lcd.y + lcd.height / 2 - fr.y) / scale);
    const px = f.getContext('2d')!.getImageData(Math.max(0, x), y, 1, 1).data;
    return { dim: !d.hidden, bg: getComputedStyle(d).backgroundColor, field: [px[0], px[1], px[2]] };
  });
}

test('a field menu sits over the dimmed wide map, as a battle does', async ({ browser }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: DESKTOP });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&nobots&testmon&safari=15&seed=${SEED}&land=${RUSTBORO.id},${LAND.x},${LAND.y}&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await expect
      .poll(async () => {
        const r = await ram(page, sym);
        if (r.pick) await tap(page, 'z');
        return !r.pick && r.onOverworld && r.map === RUSTBORO.ref;
      }, { timeout: 90_000, intervals: [1_000], message: 'landed in Rustboro' })
      .toBe(true);
    // The map-name popup and the landing's lines come and go.
    await page.waitForTimeout(3_000);
    const field = await look(page);
    expect(field.dim, 'on the field, no dim').toBe(false);
    expect(Math.max(...field.field), 'the map past the picture').toBeGreaterThan(0);

    // START, then A on POKéMON (the cursor's first row here): the field fades to black,
    // the party screen fades in from it.
    await tap(page, 'Enter');
    await page.waitForTimeout(800);
    await tap(page, 'z');
    await expect.poll(async () => (await ram(page, sym)).onOverworld, { timeout: 5_000, message: 'the party screen took the screen' }).toBe(false);
    await page.waitForTimeout(1_500);
    const menu = await look(page);
    await page.screenshot({ path: path.join(OUT_DIR, 'party.png') });
    expect({ dim: menu.dim, bg: menu.bg }, 'the party screen over the dimmed field, the dim the battle uses').toEqual({ dim: true, bg: DIM });
    expect(menu.field, 'under the dim the map, not black: the menu has faded in').toEqual(field.field);

    // B back out: the fade to black and the field's fade-in, and no dim on it.
    await tap(page, 'x');
    await expect.poll(async () => (await ram(page, sym)).onOverworld, { timeout: 5_000, message: 'back on the field' }).toBe(true);
    await page.waitForTimeout(1_500);
    const back = await look(page);
    expect(back.dim, 'back on the field, no dim').toBe(false);
    expect(back.field, 'the map as it was').toEqual(field.field);
  } finally {
    await ctx.close();
  }
});
