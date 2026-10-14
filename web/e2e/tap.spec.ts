// Tap the picture to walk there (touch.ts; Cam, 2026-09-18). A phone, a solo match in
// the Safari, and one tap on a tile a few steps away: the trainer ends up standing on
// it. The route is the bots' A*, the walk is the D-pad held by the page, and the
// proof is `gBrOwnPos` -- the same struct the relay is told from.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { World, type WorldMap } from '../src/bots/world';
import worldData from '../src/data/world.json' with { type: 'json' };

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };
const BR_PHASE_SAFARI = 1;
/** Where the player's tile sits in the picture: src/field.ts's measured LCD_LEFT/LCD_TOP,
 *  the numbers touch.ts aims by (POK-330 #34). Copied, not imported: field.ts imports
 *  world.json with no import attribute, which Playwright's Node loader refuses. The old
 *  PLAYER_ROW 5 grid was 8 px low, so a tap aimed by it landed on the tile under the one
 *  it meant. */
const LCD_LEFT = 112;
const LCD_TOP = 72;
/** The object-event offset. */
const MAP_OFFSET = 7;
/** play.spec's seed: its Safari cell is SOUTHEAST 15,14 (BrMatch_SafariCell), with no
 *  patch dealt within reach. A random spawn made this test flaky: one run in #28's CI
 *  never reached its tile, and whatever stopped it (a patch, a person, a loot ball in
 *  the way) a fixed cell and a fixed goal take out of the picture. */
const SEED = 5376;
const SAFARI_SE = { group: 26, num: 13, id: 'MAP_SAFARI_ZONE_SOUTHEAST' };
const SPAWN = { x: 15, y: 14 };
/** Three tiles north: 15,13 is grass (which meets nothing since #19), 15,12 and 15,11
 *  open ground, nobody's object on any of them. */
const STEP = { dx: 0, dy: -3 };
/** gBrPatch.count: no patch at all, whatever the seed dealt. */
const PATCH_COUNT = 4;

type EmuWindow = { __hbr: { emu: { read(addr: number, width: 8 | 16 | 32): number } } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a tap on a tile walks the trainer to it', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const symbols = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&fast&seed=${SEED}&rom=${romHashParam()}`);
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

    expect({ group: before.group, num: before.num, x: before.x - MAP_OFFSET, y: before.y - MAP_OFFSET }, 'the seed\'s cell')
      .toEqual({ group: SAFARI_SE.group, num: SAFARI_SE.num, ...SPAWN });
    const world = new World((worldData as { maps: WorldMap[] }).maps);
    const goal = { x: SPAWN.x + STEP.dx, y: SPAWN.y + STEP.dy, dx: STEP.dx, dy: STEP.dy };
    for (let k = 1; k <= Math.abs(STEP.dy); k++) {
      expect(world.standable(SAFARI_SE.id, SPAWN.x, SPAWN.y - k), `${SPAWN.x},${SPAWN.y - k} can be walked`).toBe(true);
    }
    expect(symbols.gBrPatch, 'gBrPatch is in the symbol table').toBeDefined();
    await page.evaluate(([a, off]) => (window as unknown as { __hbr: { emu: { write(addr: number, v: number, w: 8): void } } }).__hbr.emu.write(a + off, 0, 8), [symbols.gBrPatch, PATCH_COUNT]);

    // The tap: the tile's centre, in the picture's pixels, through the canvas's box --
    // the LCD inside it, since the core's canvas carries a band past the LCD (POK-319).
    const box = (await page.locator('#canvas').boundingBox())!;
    const band = await page.evaluate(() => (window as unknown as { __hbr: { emu: { viewport: { left: number; top: number; right: number; bottom: number } | null } } }).__hbr.emu.viewport);
    const scale = box.width / (240 + (band?.left ?? 0) + (band?.right ?? 0));
    const px = box.x + ((band?.left ?? 0) + LCD_LEFT + goal.dx * 16 + 8) * scale;
    const py = box.y + ((band?.top ?? 0) + LCD_TOP + goal.dy * 16 + 8) * scale;
    await page.screenshot({ path: path.join(OUT_DIR, `tap-before-${testInfo.retry}.png`) });
    await page.touchscreen.tap(px, py);

    const want = { x: goal.x + MAP_OFFSET, y: goal.y + MAP_OFFSET };
    await page.waitForFunction(
      ([base, x, y]) => {
        const emu = (window as unknown as EmuWindow).__hbr.emu;
        const s16 = (v: number) => (v << 16) >> 16;
        return s16(emu.read(base + 2, 16)) === x && s16(emu.read(base + 4, 16)) === y;
      },
      [symbols.gBrOwnPos, want.x, want.y],
      { timeout: 15_000 },
    );
    await page.screenshot({ path: path.join(OUT_DIR, `tap-after-${testInfo.retry}.png`) });
    const after = await own();
    expect({ x: after.x, y: after.y }).toEqual(want);

    // Meanwhile the chrome: in a match, the header and the room are off the glass and
    // the menu button is on it; it opens the sheet, drawn over the game (POK-320), which
    // has the settings in it and puts itself away again.
    await expect(page.locator('header')).toBeHidden();
    await expect(page.locator('#drawer')).toBeHidden();
    await expect(page.locator('#menu-btn')).toBeVisible();
    await page.locator('#menu-btn').tap();
    await expect(page.locator('#drawer')).toBeVisible();
    await expect(page.locator('#mute')).toBeVisible();
    await expect(page.locator('#match-leave'), 'solo always has its way out').toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, 'tap-drawer.png') });
    await page.locator('#drawer-close').tap();
    await expect(page.locator('#drawer')).toBeHidden();
  } finally {
    await ctx.close();
  }
});
