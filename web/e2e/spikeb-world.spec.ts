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

// ---- POK-442: a room over the world ----------------------------------------------------

/** Through the door of `map` that leads to `to`, walking; returns once inside. */
async function throughDoor(page: Page, map: string, to: string): Promise<{ x: number; y: number }> {
  const door = await page.evaluate(([map, to]) => {
    const s = (window as unknown as { __spike: { link: { me: number; room: any }; placed: Map<string, { m: { warps?: { x: number; y: number; to: string }[] } }> } }).__spike;
    const w = s.placed.get(map as string)!.m.warps!.find((q) => q.to.includes(to as string))!;
    const a = s.link.room.actor(s.link.me), spot = { map, x: w.x, y: w.y + 1 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, action: null, px: 0, py: 0 };
    return { x: w.x, y: w.y };
  }, [map, to] as const);
  await page.waitForTimeout(400);
  return door;
}

const mapNow = (page: Page) => page.evaluate(() => { const s = (window as unknown as { __spike: S }).__spike; return s.link.room.actor(s.link.me).m.spot.map as string; });

/** Canvas colours at some points round the window's rim. */
async function rimPixels(page: Page, shift: number): Promise<number[][]> {
  return page.evaluate((shift) => {
    const cv = document.getElementById('world') as HTMLCanvasElement, c = cv.getContext('2d')!;
    const out: number[][] = [];
    for (const [fx, fy] of [[0.04, 0.2], [0.04, 0.5], [0.04, 0.8], [0.96, 0.2], [0.96, 0.5], [0.96, 0.8], [0.5, 0.04], [0.3, 0.97], [0.7, 0.97]]) {
      out.push(Array.from(c.getImageData(Math.floor(cv.width * fx), Math.floor(cv.height * fy) + shift, 1, 1).data));
    }
    return out;
  }, shift);
}

test('a room sits over the world it is in, dimmed like a battle, the door where it was', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await inMatch(page, 'stats&');
  await throughDoor(page, 'MAP_OLDALE_TOWN', 'POKEMON_CENTER');
  // Standing under the door. Through it the trainer walks one step on (sim.ts walkOn), so the
  // camera ends two cells north of here over the world: the same screen spot is two cells up.
  const scale = await page.evaluate(() => { const s = (window as unknown as { __spike: S }).__spike; const dpr = devicePixelRatio || 1; return s.zoom / (s.zoom < dpr ? dpr : Math.max(1, s.zoom)); });
  const outside = await rimPixels(page, -32 * scale);
  await shot(page, 'room-720p-outside');
  await page.keyboard.down('ArrowUp');
  await expect.poll(() => mapNow(page), { timeout: 5000, intervals: [30] }).toContain('POKEMON_CENTER');
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(160);
  await shot(page, 'room-720p-door-mid');
  await page.waitForTimeout(700);
  await shot(page, 'room-720p-inside');
  const inside = await rimPixels(page, 0);
  // #battle.see's #0007 over the same pixels of the world.
  const DIM = 1 - 0x77 / 255;
  const dimmed = inside.filter((px, i) => px.slice(0, 3).every((v, j) => Math.abs(v - outside[i][j] * DIM) <= 12));
  expect(dimmed.length, `rim ${JSON.stringify(inside)} over ${JSON.stringify(outside)}`).toBeGreaterThanOrEqual(6);
  const roomMs = await drawMs(page);
  // The fog stays what it is on both layers: over the world by the ring, in the room by its door.
  if (SHOTS) {
    await page.evaluate(() => {
      const r = (window as unknown as { __spike: S }).__spike.link.room, ring = r.ring.bind(r);
      r.ring = () => ({ ...ring(), r: 0, cx: 0, cy: 0 });
      setTimeout(() => { delete r.ring; }, 500);
    });
    await page.waitForTimeout(250);
    await shot(page, 'room-720p-fog');
    await page.waitForTimeout(400);
  }
  // ...and the room itself is at full strength: its middle isn't dim.
  const middle = await page.evaluate(() => { const cv = document.getElementById('world') as HTMLCanvasElement; return Array.from(cv.getContext('2d')!.getImageData(cv.width >> 1, (cv.height >> 1) - 40, 1, 1).data); });
  expect(Math.max(...middle.slice(0, 3))).toBeGreaterThan(120);
  // Out again: the world back at full strength.
  await page.keyboard.down('ArrowDown');
  await expect.poll(() => mapNow(page), { timeout: 8000, intervals: [30] }).toBe('MAP_OLDALE_TOWN');
  await page.keyboard.up('ArrowDown');
  await page.waitForTimeout(160);
  await shot(page, 'room-720p-out-mid');
  await page.waitForTimeout(800);
  await shot(page, 'room-720p-back-outside');
  console.log(`[world-edges ${TAG}] room draw 720p: ${roomMs} ms`);
});

test('rooms at 1080p, on a phone, and on a watched trainer\'s page', async ({ browser }) => {
  test.setTimeout(420_000);
  const rooms: [string, string, string][] = [['center', 'MAP_OLDALE_TOWN', 'POKEMON_CENTER'], ['mart', 'MAP_OLDALE_TOWN', 'MART'], ['gym', 'MAP_RUSTBORO_CITY', 'GYM'], ['house', 'MAP_LITTLEROOT_TOWN', 'HOUSE'], ['cave', 'MAP_ROUTE116', 'RUSTURF']];
  const within = async (page: Page, name: string, ms: boolean) => {
    const costs: string[] = [];
    await inMatch(page, 'stats&');
    for (const [room, map, to] of rooms) {
      await throughDoor(page, map, to);
      await page.keyboard.down('ArrowUp');
      await expect.poll(() => mapNow(page), { timeout: 5000, intervals: [30] }).not.toBe(map);
      await page.keyboard.up('ArrowUp');
      await page.waitForTimeout(800);
      await shot(page, `room-${name}-${room}`);
      if (ms && room === 'center') costs.push(`${await drawMs(page)} ms`);
    }
    if (ms) console.log(`[world-edges ${TAG}] room draw ${name}: ${costs.join(', ')}`);
  };
  const desk = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await within(await desk.newPage(), '1080p', true);
  await desk.close();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await within(await phone.newPage(), 'phone', true);
  await phone.close();

  // Out of the match, following a bot, and the bot goes indoors.
  const watch = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await watch.newPage();
  await page.goto(`/?stats&rom=${romHashParam()}#solo&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { rom?: unknown; link?: { me: number; room: { actor(id: number): unknown } } } }).__spike;
    return !!s?.rom && !!s.link?.room.actor(s.link.me);
  }, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as unknown as { __spike: { link: { room: { actors: { bot?: boolean }[] } } } }).__spike; return s.link.room.actors.some((a) => a.bot); }, undefined, { timeout: 60_000 });
  await page.evaluate(() => { (window as unknown as { __spike: { goOut(w: string): void } }).__spike.goOut('watching'); });
  await page.waitForFunction(() => !!(window as unknown as { __spike: { spectating: unknown } }).__spike.spectating, undefined, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const s = (window as unknown as { __spike: { link: { room: { actors: { id: number; bot?: boolean; m: unknown }[] } } } }).__spike;
    for (const a of s.link.room.actors) if (a.bot) {
      const spot = { map: 'MAP_OLDALE_TOWN_POKEMON_CENTER_1F', x: 5, y: 5 };
      a.m = { ...(a.m as object), spot, prev: spot, action: null, px: 0, py: 0 };
    }
  });
  await page.waitForTimeout(120);
  await shot(page, 'room-watched');
  await watch.close();
});
