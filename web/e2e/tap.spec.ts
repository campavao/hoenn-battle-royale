// Tap the picture to walk there (touch.ts; Cam, 2026-09-18). A phone, a solo match in
// the Safari, and one tap on a tile a few steps away: the trainer ends up standing on
// it. The route is the bots' A*, the walk is the D-pad held by the page, and the
// proof is `gBrOwnPos` -- the same struct the relay is told from.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { World, type WorldMap } from '../src/bots/world';
import { findPath } from '../src/bots/path';
import worldData from '../src/data/world.json' with { type: 'json' };

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };
const BR_PHASE_SAFARI = 1;
/** touch.ts's constants: the tile under the player, and the object-event offset. */
const PLAYER_COL = 7;
const PLAYER_ROW = 5;
const MAP_OFFSET = 7;

type EmuWindow = { __hbr: { emu: { read(addr: number, width: 8 | 16 | 32): number } } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a tap on a tile walks the trainer to it', async ({ browser }) => {
  test.setTimeout(150_000);
  const symbols = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&fast&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });

    // In the Zone, with the boot's warp done: the position holds still for a moment.
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
    let before = await own();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const now = await own();
      if (now.x === before.x && now.y === before.y && now.group === before.group && now.num === before.num && now.num !== 0) break;
      before = now;
    }
    expect(before.group, 'standing somewhere real').toBeGreaterThan(0);

    // Somewhere on screen, a few steps away, that the world says is reachable.
    const maps = (worldData as { maps: WorldMap[] }).maps;
    const world = new World(maps);
    const id = maps.find((m) => m.group === before.group && m.num === before.num)!.id;
    const from = { map: id, x: before.x - MAP_OFFSET, y: before.y - MAP_OFFSET };
    let goal: { x: number; y: number; dx: number; dy: number } | null = null;
    outer: for (const d of [3, 2, 4]) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, 1], [-d, -1], [1, d], [-1, -d]] as [number, number][]) {
        const to = { map: id, x: from.x + dx, y: from.y + dy };
        if (!world.standable(id, to.x, to.y)) continue;
        const p = findPath(world, from, to);
        if (p.found && p.steps.length > 0 && p.steps.length <= 8 && p.steps.every((s) => s.to.map === id)) {
          goal = { x: to.x, y: to.y, dx, dy };
          break outer;
        }
      }
    }
    expect(goal, 'a reachable tile on screen').not.toBeNull();

    // The tap: the tile's centre, in the picture's pixels, through the canvas's box.
    const box = (await page.locator('#canvas').boundingBox())!;
    const scale = box.width / 240;
    const px = box.x + ((PLAYER_COL + goal!.dx) * 16 + 8) * scale;
    const py = box.y + ((PLAYER_ROW + goal!.dy) * 16 + 8) * scale;
    await page.screenshot({ path: path.join(OUT_DIR, 'tap-before.png') });
    await page.touchscreen.tap(px, py);

    const want = { x: goal!.x + MAP_OFFSET, y: goal!.y + MAP_OFFSET };
    await page.waitForFunction(
      ([base, x, y]) => {
        const emu = (window as unknown as EmuWindow).__hbr.emu;
        const s16 = (v: number) => (v << 16) >> 16;
        return s16(emu.read(base + 2, 16)) === x && s16(emu.read(base + 4, 16)) === y;
      },
      [symbols.gBrOwnPos, want.x, want.y],
      { timeout: 15_000 },
    );
    await page.screenshot({ path: path.join(OUT_DIR, 'tap-after.png') });
    const after = await own();
    expect({ x: after.x, y: after.y }).toEqual(want);

    // Meanwhile the chrome: in a match, the header and the room are off the glass and
    // the menu button is on it; it opens the drawer, which has the settings in it.
    await expect(page.locator('header')).toBeHidden();
    await expect(page.locator('#drawer')).toBeHidden();
    await expect(page.locator('#menu-btn')).toBeVisible();
    await page.locator('#menu-btn').tap();
    await expect(page.locator('#drawer')).toBeVisible();
    await expect(page.locator('#stretch')).toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, 'tap-drawer.png') });

    // Stretch (Cam's question): the picture takes the height the pad leaves, and a tap
    // still lands on the right tile through the other geometry. Walk back the way we came.
    await page.locator('#stretch').tap();
    await expect(page.locator('#stretch')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#drawer-close').tap();
    await expect(page.locator('#drawer')).toBeHidden();
    await page.waitForTimeout(300);
    const tall = (await page.locator('#canvas').boundingBox())!;
    expect(tall.height, 'taller than 3:2 allows').toBeGreaterThan(tall.width / 1.5 + 100);
    const bx = tall.x + ((PLAYER_COL - goal!.dx) * 16 + 8) * (tall.width / 240);
    const by = tall.y + ((PLAYER_ROW - goal!.dy) * 16 + 8) * (tall.height / 160);
    await page.touchscreen.tap(bx, by);
    await page.waitForFunction(
      ([base, x, y]) => {
        const emu = (window as unknown as EmuWindow).__hbr.emu;
        const s16 = (v: number) => (v << 16) >> 16;
        return s16(emu.read(base + 2, 16)) === x && s16(emu.read(base + 4, 16)) === y;
      },
      [symbols.gBrOwnPos, before.x, before.y],
      { timeout: 15_000 },
    );
    await page.screenshot({ path: path.join(OUT_DIR, 'tap-stretched.png') });
  } finally {
    await ctx.close();
  }
});
