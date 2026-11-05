// The map painter (spike-b/map-page.ts), on a phone's fingers and a computer's mouse and keys:
// what's picked up from a real map goes down between the maps, the maps stay locked, and the
// paint outlives the page and goes from one device to the other as a link or a file.
import { join } from 'node:path';
import { devices, expect, test, type CDPSession, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

const SHOTS = process.env.HBR_SHOTS;
type Cell = { ref: string | null; id: number };
type Pos = { x: number; y: number };
/* eslint-disable @typescript-eslint/no-explicit-any */
const mp = <T, A = void>(page: Page, f: (m: any, a: A) => T, a?: A) =>
  page.evaluate(([src, arg]) => new Function('m', 'a', `return (${src})(m, a)`)((window as any).__mappage, arg), [f.toString(), a] as const) as Promise<T>;

async function open(page: Page, hash = ''): Promise<void> {
  await page.goto(`/map/?rom=${romHashParam()}${hash}`);
  await page.waitForFunction(() => (window as any).__mappage, undefined, { timeout: 120_000 });
}
/** The view close over 8 x 8 in-between cells with a real map's land just west of them: their
 *  corner, and a cell of that land, both on a phone's screen. */
async function closeUp(page: Page, z: number): Promise<{ free: Pos; real: Pos }> {
  const spot = await mp(page, (m) => {
    for (let y = -340; y < 160; y++) {
      for (let x = -170; x < 740; x++) {
        let clear = true;
        for (let v = y; v < y + 8 && clear; v++) for (let u = x; u < x + 8 && clear; u++) clear = !m.locked(u, v);
        if (!clear) continue;
        for (let dx = 1; dx <= 5; dx++) {
          if (m.mapAt(x - dx, y + 4) && m.base(x - dx, y + 4).id !== m.base(x, y).id) return { free: { x, y }, real: { x: x - dx, y: y + 4 } };
        }
      }
    }
    return null;
  }) as { free: Pos; real: Pos } | null;
  expect(spot, 'somewhere to paint, by a map').toBeTruthy();
  await mp(page, (m, a) => m.look(a.x + 2, a.y + 4, a.z), { ...spot!.free, z });
  await settle(page);
  return spot!;
}
const settle = (page: Page) => page.waitForFunction(() => (window as any).__mappage.settled, undefined, { timeout: 30_000 });
const at = (page: Page, c: Pos) => mp(page, (m, a) => m.at(a.x, a.y), c) as Promise<Pos>;
const shot = async (page: Page, name: string) => { if (SHOTS) { await settle(page); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); } };

test.describe('on a phone', () => {
  const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
  test.use(pixel);

  const touch = (cdp: CDPSession, type: string, points: Pos[]) => cdp.send('Input.dispatchTouchEvent', { type: type as any, touchPoints: points });

  test('picks a tile off a real map, paints beside it, and the map stays locked', async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    await shot(page, 'phone-all');
    const { free, real } = await closeUp(page, 20);
    const tapCell = async (c: Pos) => { const p = await at(page, c); await page.touchscreen.tap(p.x, p.y); };
    const count = () => mp(page, (m) => m.count) as Promise<number>;
    const before = await mp(page, (m, a) => m.base(a.x, a.y), real) as Cell;

    // MOVE to begin with: a stray tap paints nothing.
    expect(await mp(page, (m) => m.tool)).toBe('move');
    await tapCell(free);
    expect(await count()).toBe(0);

    await page.locator('#t-pick').tap();
    await tapCell(real);
    await expect.poll(() => mp(page, (m) => m.tool)).toBe('brush');
    expect((await mp(page, (m) => m.stamp) as { cells: Cell[] }).cells).toEqual([before]);

    await tapCell(free);
    await expect.poll(count).toBe(1);
    expect(await mp(page, (m, a) => m.shown(a.x, a.y), free)).toEqual(before);
    await shot(page, 'phone-painted');

    // A real map takes no paint.
    await tapCell(real);
    await page.waitForTimeout(200);
    expect(await count()).toBe(1);

    await page.locator('#undo').tap();
    await expect.poll(count).toBe(0);
    await page.locator('#redo').tap();
    await expect.poll(count).toBe(1);

    // One screen, nothing sliding sideways.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const id of ['t-move', 't-pick', 't-brush', 't-box', 't-snap', 'undo', 'redo']) {
      const b = await page.locator(`#${id}`).boundingBox();
      expect(b!.height, id).toBeGreaterThanOrEqual(40);
    }

    await page.reload();
    await page.waitForFunction(() => (window as any).__mappage, undefined, { timeout: 120_000 });
    expect(await count(), 'still here after a reload').toBe(1);
    expect(await mp(page, (m, a) => m.shown(a.x, a.y), free)).toEqual(before);
  });

  test('one finger drags a stroke, a second finger means the view and paints nothing', async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    const { free } = await closeUp(page, 20);
    const cdp = await page.context().newCDPSession(page);
    const count = () => mp(page, (m) => m.count) as Promise<number>;

    await page.locator('#t-brush').tap();
    const a = await at(page, free), b = await at(page, { x: free.x + 4, y: free.y });
    await touch(cdp, 'touchStart', [a]);
    await page.waitForTimeout(120);
    for (let i = 1; i <= 4; i++) await touch(cdp, 'touchMove', [{ x: a.x + (b.x - a.x) * i / 4, y: a.y }]);
    await touch(cdp, 'touchEnd', []);
    await expect.poll(count, 'five cells of grass, less any that were it already').toBeGreaterThan(2);
    const painted = await count();

    const z0 = (await mp(page, (m) => m.view) as { z: number }).z;
    const c = { x: a.x, y: a.y + 40 }, d = { x: a.x + 40, y: a.y + 40 };
    await touch(cdp, 'touchStart', [c]);
    await touch(cdp, 'touchStart', [c, d]);
    for (let i = 1; i <= 5; i++) await touch(cdp, 'touchMove', [{ x: c.x - i * 12, y: c.y }, { x: d.x + i * 12, y: d.y }]);
    await touch(cdp, 'touchEnd', []);
    await settle(page);
    expect((await mp(page, (m) => m.view) as { z: number }).z, 'the pinch zoomed').toBeGreaterThan(z0 * 1.5);
    expect(await count(), 'and painted nothing').toBe(painted);

    // A second finger coming after the stroke began takes it back.
    await touch(cdp, 'touchStart', [c]);
    await page.waitForTimeout(150);
    await touch(cdp, 'touchStart', [c, d]);
    await touch(cdp, 'touchEnd', []);
    await settle(page);
    expect(await count()).toBe(painted);
  });

  test('a link carries the paint to another device', async ({ browser }) => {
    test.setTimeout(240_000);
    const phone = await (await browser.newContext(pixel)).newPage();
    await open(phone);
    const { free } = await closeUp(phone, 20);
    await phone.locator('#t-brush').tap();
    const p = await at(phone, free);
    await phone.touchscreen.tap(p.x, p.y);
    await expect.poll(() => mp(phone, (m) => m.count)).toBeGreaterThan(0);
    const file = await mp(phone, (m) => m.file());
    const hash = await mp(phone, (m) => m.hash()) as string;
    await phone.locator('#menu').tap();
    await expect(phone.locator('#copy')).toBeVisible();
    await shot(phone, 'phone-menu');
    await expect.poll(() => phone.locator('#link').inputValue()).toContain(`/map/#${hash}`);

    // Nothing there yet: it just comes in, and the link leaves the address bar.
    const computer = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await open(computer, `#${hash}`);
    await expect.poll(() => mp(computer, (m) => m.file())).toEqual(file);
    expect(new URL(computer.url()).hash).toBe('');
  });
});

test.describe('on a computer', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the mouse and the keys do all of it', async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    await shot(page, 'computer-all');
    const { free } = await closeUp(page, 24);
    const count = () => mp(page, (m) => m.count) as Promise<number>;
    const view = () => mp(page, (m) => m.view) as Promise<{ x: number; y: number; z: number }>;
    await expect(page.locator('#copy'), 'all there, no menu to open').toBeVisible();
    await expect(page.locator('#menu')).toBeHidden();

    // The wheel zooms where the mouse is, a right-drag moves.
    const a = await at(page, free);
    await page.mouse.move(a.x, a.y);
    const z0 = (await view()).z;
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await view()).z).toBeGreaterThan(z0);
    const under = await at(page, free);
    expect(Math.abs(under.x - a.x), 'the cell under the mouse stays under it').toBeLessThan(2);
    await page.mouse.wheel(0, 200);
    await settle(page);
    const v0 = await view();
    await page.mouse.move(600, 400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(650, 400);
    await page.mouse.up({ button: 'right' });
    expect((await view()).x).toBeLessThan(v0.x);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await mp(page, (m, f) => m.look(f.x + 4, f.y + 4, 24), free);
    await settle(page);

    // B and a drag: a stroke. Ctrl+Z takes all of it, and Ctrl+Y brings it back.
    await page.keyboard.press('b');
    expect(await mp(page, (m) => m.tool)).toBe('brush');
    const from = await at(page, free), to = await at(page, { x: free.x + 5, y: free.y });
    await page.mouse.move(from.x, from.y);
    await shot(page, 'computer-hover');
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    const stroke = await count();
    expect(stroke, 'every cell of a quick drag').toBeGreaterThan(3);
    await page.keyboard.press('Control+z');
    await expect.poll(count).toBe(0);
    await page.keyboard.press('Control+y');
    await expect.poll(count).toBe(stroke);

    // Alt-drag picks up a 2 x 2 block, X and a drag fills a box with it, E takes it off.
    const s0 = await at(page, { x: free.x, y: free.y }), s1 = await at(page, { x: free.x + 1, y: free.y + 1 });
    await page.keyboard.down('Alt');
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.down();
    await page.mouse.move(s1.x, s1.y);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const stamp = await mp(page, (m) => m.stamp) as { w: number; h: number; sx: number; sy: number };
    expect([stamp.w, stamp.h, stamp.sx, stamp.sy]).toEqual([2, 2, free.x, free.y]);
    await page.keyboard.press('e');
    expect((await mp(page, (m) => m.stamp) as { cells: unknown[] }).cells).toEqual([null]);
    await page.keyboard.press('x');
    expect(await mp(page, (m) => m.tool)).toBe('box');
    const b0 = await at(page, { x: free.x - 1, y: free.y - 1 }), b1 = await at(page, { x: free.x + 7, y: free.y + 7 });
    await page.mouse.move(b0.x, b0.y);
    await page.mouse.down();
    await page.mouse.move(b1.x, b1.y, { steps: 3 });
    await shot(page, 'computer-box');
    await page.mouse.up();
    await expect.poll(count, 'the eraser in a box').toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(count).toBe(stroke);
  });

  test('a saved file opens somewhere that has paint, and asks first', async ({ page, browser }) => {
    test.setTimeout(240_000);
    await open(page);
    const { free } = await closeUp(page, 24);
    await page.keyboard.press('b');
    const a = await at(page, free);
    await page.mouse.click(a.x, a.y);
    await expect.poll(() => mp(page, (m) => m.count)).toBe(1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()]);
    const path = await download.path();
    expect(download.suggestedFilename()).toBe('hoenn-map-paint.json');

    const other = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await open(other);
    // Its own cell, somewhere else, so ADD and REPLACE differ.
    await closeUp(other, 24);
    await other.keyboard.press('b');
    const b = await at(other, { x: free.x + 3, y: free.y + 3 });
    await other.mouse.click(b.x, b.y);
    await expect.poll(() => mp(other, (m) => m.count)).toBe(1);

    await other.locator('#open').setInputFiles(path);
    await expect(other.locator('#ask')).toBeVisible();
    await shot(other, 'computer-ask');
    await other.locator('#ask-no').click();
    await expect(other.locator('#ask')).toBeHidden();
    expect(await mp(other, (m) => m.count)).toBe(1);
    await other.locator('#open').setInputFiles(path);
    await other.locator('#ask-add').click();
    await expect.poll(() => mp(other, (m) => m.count)).toBe(2);
    await other.locator('#undo').click();
    await expect.poll(() => mp(other, (m) => m.count)).toBe(1);
    await other.locator('#open').setInputFiles(path);
    await other.locator('#ask-replace').click();
    await expect.poll(() => mp(other, (m) => m.file())).toEqual(await mp(page, (m) => m.file()));

    await other.locator('#clear').click();
    await expect.poll(() => mp(other, (m) => m.count)).toBe(0);
    await other.locator('#undo').click();
    await expect.poll(() => mp(other, (m) => m.count)).toBe(1);
  });

  test('a stamp keeps in step with where it came from, or goes anywhere with SNAP off', async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    const { free } = await closeUp(page, 24);
    // The forest: its 2 x 2 is in step from (0, 0), so an even corner is in step and an odd one isn't.
    await page.locator('[data-stamp="1"]').click();
    expect(await mp(page, (m) => m.tool)).toBe('brush');
    const forest = await mp(page, (m) => m.stamp) as { w: number; cells: Cell[]; sx: number; sy: number };
    expect([forest.w, forest.sx, forest.sy]).toEqual([2, 0, 0]);
    const id = (c: Pos) => mp(page, (m, a) => m.shown(a.x, a.y).id, c) as Promise<number>;
    // A press whose stamp, round the finger, has an odd corner in x and an even one in y.
    const tap = { x: free.x + 3 + ((free.x + 3) & 1), y: free.y + 3 + (((free.y + 3) & 1) ^ 1) };
    const lay = async () => { const p = await at(page, tap); await page.mouse.click(p.x, p.y); };

    await lay();
    await expect.poll(() => id({ x: tap.x, y: tap.y - 1 }), 'SNAP: the corner moved to an even cell').toBe(forest.cells[0].id);
    expect(await id({ x: tap.x - 1, y: tap.y - 1 }), 'and left that column alone').toBe((await mp(page, (m, a) => m.base(a.x, a.y), { x: tap.x - 1, y: tap.y - 1 }) as Cell).id);

    await page.keyboard.press('Control+z');
    await page.keyboard.press('s');
    await lay();
    await expect.poll(() => id({ x: tap.x - 1, y: tap.y - 1 }), 'no SNAP: right round the finger').toBe(forest.cells[0].id);
    await shot(page, 'computer-forest');
  });
});
