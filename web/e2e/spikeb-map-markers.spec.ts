// Cam's 11-21 notes, spectating on a phone: trainers far out as their heads, not boxes; a
// legendary on the minimap and the MAP as itself, not a ball; the minimap glowing gold for it and
// purple over the fog's last stretch; and the MAP's FLY lit when it would fly, with the flyer by it.
// HBR_SHOTS=<dir> (and HBR_SHOT_TAG=before|after) puts the pictures there for a before/after.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const tag = process.env.HBR_SHOT_TAG ?? 'shot';
const path = (name: string) => (process.env.HBR_SHOTS ? `${process.env.HBR_SHOTS}/${tag}-${name}.png` : test.info().outputPath(`${name}.png`));
const shot = (page: Page, name: string) => page.screenshot({ path: path(name) });
/** Just the minimap's window, with room round it for its glow. */
async function shotMini(page: Page, name: string): Promise<void> {
  const b = (await page.locator('.hud-mini').boundingBox())!;
  const pad = 28;
  await page.screenshot({ path: path(name), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } });
}

async function intoMatch(page: Page, hash: string): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&${hash}`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
}

/** In the Zone for the buzzer (it only calls those in it), "Drop where?", and A where the cursor starts. */
async function dropOut(page: Page): Promise<void> {
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me), spot = { map: 'MAP_SAFARI_ZONE_SOUTH', x: 23, y: 30 }; a.m = { ...a.m, spot, prev: spot, action: null, px: 0, py: 0 }; });
  await expect(page.locator('#map-window [aria-label="DROP"]')).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(400);
  await page.keyboard.press('z', { delay: 100 });
  await expect(page.locator('#map-window')).toBeHidden();
  await expect.poll(() => spike(page, (s) => s.link.room.actor(s.link.me)?.m.spot.map ?? ''), { timeout: 30_000, message: 'out of the Safari' }).not.toMatch(/^MAP_SAFARI/);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 15_000 }).toBe(false);
}

/** A mon out of the Day Care's chest, the way the match gives one, and the party filled; then the
 *  Safari's end (the first ring's length is the Safari's too) and the drop. */
async function withTeam(page: Page, fog: number): Promise<void> {
  await intoMatch(page, `nobots&fog=${fog}&seed=7`);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  const party = () => spike(page, (s) => s.rom.partyCount());
  for (let i = 0; i < 40 && !(await party()); i++) {
    if (await page.locator('.bm-slot').first().isVisible()) {
      await page.locator('.bm-slot').first().click();
      await page.waitForTimeout(1500);
    } else if (!(await spike(page, (s) => s.swapping))) {
      await tap('z');
      await page.waitForTimeout(800);
    } else await page.waitForTimeout(500);
  }
  expect(await party(), 'a mon out of the chest').toBeGreaterThan(0);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000 }).toBe(false);
  await spike(page, (s) => s.rom.fillParty());
  await dropOut(page);
}

test("the MAP's FLY: lit on a town it would fly to, grey on a route, the flyer beside it (Cam, 11-21)", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await withTeam(page, 60);
  // HM02 on the first of them, as the game teaches it.
  await spike(page, (s) => s.give(340));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-pick-move').nth(1)).toBeVisible({ timeout: 20_000 });
  await page.locator('.bm-pick-move').nth(1).click();
  await expect.poll(() => spike(page, (s) => s.swapping || s.battleMenu.isShown), { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(800);
  // Onto a route with no town in it (ROUTE 117), and the MAP.
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me), spot = { map: 'MAP_ROUTE117', x: 30, y: 8 }; a.m = { ...a.m, spot, prev: spot, action: null, px: 0, py: 0 }; });
  await page.waitForTimeout(800);
  await spike(page, (s) => s.runMenu('13'));
  const fly = page.locator('#map-window [aria-label="FLY"]');
  await expect(fly).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(800);
  const pixels = () => fly.locator('canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await expect(fly).toHaveAttribute('aria-disabled', 'true');
  const onRoute = await pixels();
  await shot(page, 'map-fly-route');
  // OLDALE's cell, then the button: lit, and drawn lit.
  const oldale = await spike(page, (s) => s.ringMap.cellOf({ map: 'MAP_OLDALE_TOWN', x: 5, y: 5 })) as { x: number; y: number };
  const at = (await page.locator('#map-window .map-picture').boundingBox())!;
  await page.mouse.click(at.x + ((8 * oldale.x + 12) * at.width) / 240, at.y + ((8 * oldale.y + 20) * at.height) / 160);
  await expect.poll(() => spike(page, (s) => s.mapWindow.cursor)).toEqual(oldale);
  await expect(fly).toHaveAttribute('aria-disabled', 'false');
  await page.waitForTimeout(400);
  await shot(page, 'map-fly-town');
  expect(await pixels(), 'the button is drawn again once it would fly (it kept its first look)').not.toBe(onRoute);
  await ctx.close();
});

test('a legendary on the minimap and the MAP is itself; the minimap glows gold for it, purple over the fog\'s last stretch (Cam, 11-21)', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await withTeam(page, 60);
  // A long phase from here, so the clock is far from its red (the fog's glow comes first).
  await spike(page, (s) => { s.link.room.ringPhase = 900 * 60; });
  // The room drops this round's first event as the ring would (room.ts dropEvent).
  const e = await spike(page, (s) => {
    const room = s.link.room;
    for (let n = 0; n < 4 && !room.events.some((q: any) => q.species > 0); n++) room.dropEvent(n, room.ring());
    const ev = room.events.find((q: any) => q.species > 0);
    const a = room.actor(s.link.me), spot = { map: ev.map, x: ev.x + 3, y: ev.y };
    a.m = { ...a.m, spot, prev: spot, action: null, px: 0, py: 0 };
    return { species: ev.species, map: ev.map };
  }) as { species: number; map: string };
  expect(e.species, 'a legendary dropped').toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  await shotMini(page, 'mini-legend');
  await shot(page, 'field-legend');
  await expect(page.locator('.hud-mini'), 'gold while it stands').toHaveClass(/hud-glow-legend/);
  await spike(page, (s) => s.runMenu('13'));
  await expect(page.locator('#map-window .map-picture')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(800);
  await shot(page, 'map-legend');
  await page.keyboard.press('x', { delay: 100 });
  await expect(page.locator('#map-window')).toBeHidden();
  // The fog's last stretch with the legendary still up: the phase cut to end 20 s from now (time
  // skipped, not a state of its own). The purple wins over the gold.
  await spike(page, (s) => { const room = s.link.room; room.ringPhase = room.tick - room.epoch - room.opening + 20 * 60; });
  await expect.poll(() => spike(page, (s) => Math.ceil(s.link.room.ring().left / 60))).toBeLessThanOrEqual(20);
  await page.waitForTimeout(1500);
  await shotMini(page, 'mini-fog');
  await expect(page.locator('.hud-mini'), 'purple over the gold').toHaveClass(/hud-glow-fog/);
  await expect(page.locator('.hud-mini')).not.toHaveClass(/hud-glow-legend/);
  await ctx.close();
});

test('far out, every trainer is their head, not a box (Cam, 11-21)', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await intoMatch(page, 'fog=900&seed=7');
  // Six of the bots on ROUTE 117 by me, and the spectator's camera as far out as it goes.
  await spike(page, (s) => {
    const room = s.link.room;
    const put = (a: any, x: number, y: number) => { const spot = { map: 'MAP_ROUTE117', x, y }; a.m = { ...a.m, spot, prev: spot, action: null, px: 0, py: 0 }; };
    put(room.actor(s.link.me), 30, 8);
    room.actors.filter((a: any) => a.bot).slice(0, 6).forEach((a: any, i: number) => put(a, 16 + i * 5, 4 + (i % 3) * 4));
  });
  await spike(page, (s) => { s.toggleSpectate(); s.zoom = 1.7; });
  await page.waitForTimeout(1500);
  await shot(page, 'far-heads');
  await ctx.close();
});
