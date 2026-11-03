// The world's frame (POK-431): what shows past the edge of a map. Cam, 11-02: "fill this in
// ... kind of like matching the seams", "these large swaths ... we can just keep this blue".
// A trainer walks all four ways at a desktop's sizes and a phone's, at the edges of Hoenn.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { KEY, key, route } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** HBR_SHOTS=<dir> keeps the frames, for before/after. */
const SHOTS = process.env.HBR_SHOTS;
const TAG = process.env.HBR_SHOT_TAG ?? 'now';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-${name}.png`) });
}

type P = { m: { id: string; w: number; h: number }; gx: number; gy: number };
type S = { link: { me: number; room: any }; placed: Map<string, P>; zoom: number; cam: { x: number; y: number } };

/** Puts me on the walkable cell of `map` nearest (x, y). */
async function standAt(page: Page, map: string, x: number, y: number): Promise<{ x: number; y: number }> {
  const at = await page.evaluate(([map, wx, wy]) => {
    const s = (window as unknown as { __spike: S }).__spike, room = s.link.room, a = room.actor(s.link.me), p = s.placed.get(map as string)!;
    const step = room.stepFor(a);
    let best: { x: number; y: number } | null = null, d = Infinity;
    for (let cy = 0; cy < p.m.h; cy++) for (let cx = 0; cx < p.m.w; cx++) {
      const q = (cx - (wx as number)) ** 2 + (cy - (wy as number)) ** 2;
      if (q >= d) continue;
      const here = { map, x: cx, y: cy };
      if ([1, 2, 3, 4].some((dir) => { const r = step(here, dir); return r && !r.warp && !r.water; })) { best = { x: cx, y: cy }; d = q; }
    }
    if (!best) return null;
    const spot = { map, ...best };
    a.m = { ...a.m, spot, prev: spot, action: null, px: 0, py: 0 };
    return best;
  }, [map, x, y] as const);
  expect(at, `${map} has somewhere to stand`).not.toBeNull();
  await page.waitForTimeout(400);
  return at!;
}

/** A match of the page's own, the ROM up, so the keys walk. */
async function inMatch(page: Page, q = ''): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/?${q}rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { rom?: unknown; link?: { me: number; room: { actor(id: number): unknown } } } }).__spike;
    return !!s?.rom && !!s.link?.room.actor(s.link.me);
  }, undefined, { timeout: 120_000 });
}

/** Holds a direction, as a player does. */
async function walk(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
}

/** The field's own draw time over a stretch, off ?stats. */
async function drawMs(page: Page, samples = 12): Promise<number> {
  const seen: number[] = [];
  for (let i = 0; i < samples; i++) {
    await page.waitForTimeout(300);
    const m = /draw ([\d.]+) ms/.exec((await page.locator('#stats').textContent()) ?? '');
    if (m) seen.push(Number(m[1]));
  }
  seen.sort((a, b) => a - b);
  return seen[seen.length >> 1] ?? NaN;
}

// Around Hoenn: a town's south edge over the sea, a ridge, a forest's corner, the far east.
const EDGES: [string, string, number, number][] = [
  ['route116', 'MAP_ROUTE116', 50, 18],
  ['route104', 'MAP_ROUTE104', 30, 40],
  ['route103', 'MAP_ROUTE103', 40, 3],
  ['route110', 'MAP_ROUTE110', 35, 60],
  ['route111', 'MAP_ROUTE111', 35, 70],
  ['route114', 'MAP_ROUTE114', 5, 40],
  ['route118', 'MAP_ROUTE118', 40, 18],
  ['route120', 'MAP_ROUTE120', 35, 50],
  ['route123', 'MAP_ROUTE123', 70, 18],
  ['route134', 'MAP_ROUTE134', 40, 38],
  ['slateport', 'MAP_SLATEPORT_CITY', 5, 40],
];
const SIZES: [string, number, number][] = [['720p', 1280, 720], ['1080p', 1920, 1080]];

test('past every map\'s edge, walking at a desktop\'s sizes', async ({ page }) => {
  test.setTimeout(420_000);
  const costs: string[] = [];
  for (const [size, width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await inMatch(page, 'stats&');
    for (const [name, map, x, y] of EDGES) {
      await standAt(page, map, x, y);
      await shot(page, `${size}-${name}`);
      if (name === 'route116') {
        for (const [way, key] of [['n', 'ArrowUp'], ['s', 'ArrowDown'], ['w', 'ArrowLeft'], ['e', 'ArrowRight']] as const) {
          await walk(page, key, 900);
          await shot(page, `${size}-${name}-walk-${way}`);
        }
      }
    }
    await standAt(page, 'MAP_ROUTE134', 40, 38);
    const sea = await drawMs(page);
    await standAt(page, 'MAP_ROUTE116', 50, 18);
    const land = await drawMs(page);
    // The farthest out a spectator can go (zoom.ts roomFloor; #286's freeze was out here), over
    // the middle of the plane, where the fill is most of the view.
    const floor = Math.max(width, height) / (2 * 48 * 16);
    await standAt(page, 'MAP_ROUTE110', 35, 60);
    await page.evaluate((z) => { (window as unknown as { __spike: S }).__spike.zoom = z; }, floor);
    await page.waitForTimeout(800);
    await shot(page, `${size}-farthest`);
    const farthest = await drawMs(page);
    await page.evaluate((z) => { (window as unknown as { __spike: S }).__spike.zoom = z; }, Math.max(1, Math.floor(height / 360)));
    costs.push(`${size} sea ${sea} ms, land ${land} ms, farthest ${farthest} ms`);
  }
  console.log(`[world-edges ${TAG}] draw: ${costs.join('; ')}`);
});

/** The colour the field shows at a world pixel, read off its canvas. */
async function worldPixel(page: Page, wx: number, wy: number): Promise<number[]> {
  return page.evaluate(([wx, wy]) => {
    const s = (window as unknown as { __spike: S }).__spike, cv = document.getElementById('world') as HTMLCanvasElement;
    const dpr = devicePixelRatio || 1, k = s.zoom < dpr ? dpr : Math.max(1, s.zoom), z = s.zoom / k;
    const ox = Math.round(cv.width / 2 - s.cam.x * z), oy = Math.round(cv.height / 2 - s.cam.y * z);
    return Array.from(cv.getContext('2d')!.getImageData(ox + wx * z, oy + wy * z, 1, 1).data);
  }, [wx, wy] as const);
}

test('the land past the edge stays what it is as a trainer crosses a seam', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await inMatch(page);
  // ROUTE 111's foot, walking down into MAUVILLE: Route 111's border was rock, Mauville's the
  // sea, so the hole east of them changed with the map under the camera (Cam, 11-02: "the
  // changing of this like space").
  await standAt(page, 'MAP_ROUTE111', 19, 139);
  const hole = await page.evaluate(() => {
    const s = (window as unknown as { __spike: S }).__spike, p = s.placed.get('MAP_ROUTE111')!;
    const x = p.gx + p.m.w + 2, y = p.gy + p.m.h - 3;
    const onMap = [...s.placed.values()].some((q) => x >= q.gx && y >= q.gy && x < q.gx + q.m.w && y < q.gy + q.m.h);
    return { x: x * 16 + 8, y: y * 16 + 8, onMap };
  });
  expect(hole.onMap, 'the point is in a hole between maps').toBe(false);
  await page.waitForTimeout(300);
  const before = await worldPixel(page, hole.x, hole.y);
  // Off the canvas would read as transparent both times, and pass.
  expect(before[3], 'the point is in view').toBe(255);
  const dirs = await route(page, `(p) => p.map === 'MAP_MAUVILLE_CITY'`);
  expect(dirs, 'a way down').not.toBeNull();
  const spot = () => page.evaluate(() => { const s = (window as unknown as { __spike: S }).__spike; const q = s.link.room.actor(s.link.me).m.spot; return `${q.map}:${q.x}:${q.y}`; });
  for (const d of dirs!) {
    const was = await spot();
    await key(page, KEY[d], true);
    await expect.poll(spot, { timeout: 5000, intervals: [30] }).not.toBe(was);
    await key(page, KEY[d], false);
  }
  await expect.poll(() => page.evaluate(() => { const s = (window as unknown as { __spike: S }).__spike; return s.link.room.actor(s.link.me).m.spot.map; })).toBe('MAP_MAUVILLE_CITY');
  await page.waitForTimeout(300);
  expect(await worldPixel(page, hole.x, hole.y)).toEqual(before);
});

test('a phone walks the same world', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await inMatch(page, 'stats&');
  for (const [name, map, x, y] of EDGES) {
    await standAt(page, map, x, y);
    await shot(page, `phone-${name}`);
  }
  await standAt(page, 'MAP_ROUTE134', 40, 38);
  const sea = await drawMs(page);
  await standAt(page, 'MAP_ROUTE116', 50, 18);
  const land = await drawMs(page);
  // Under half a canvas pixel to a world pixel the field is drawn from mips and flat colours:
  // an older phone's spectator at the floor (1080 x 1920 at 3x).
  await standAt(page, 'MAP_ROUTE110', 35, 60);
  await page.evaluate(() => { (window as unknown as { __spike: S }).__spike.zoom = 1.25; });
  await page.waitForTimeout(800);
  await shot(page, 'phone-far');
  const far = await drawMs(page);
  console.log(`[world-edges ${TAG}] phone draw: sea ${sea} ms, land ${land} ms, far ${far} ms`);
  await ctx.close();
});
