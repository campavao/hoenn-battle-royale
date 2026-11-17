// Cam's 11-16 match: on a TM's "Which POKeMON?" a trainer never died in the fog. Cam: "There should
// never be a menu or situation that prevents you from taking fog damage." A team at 1 HP stands in
// the fog with a TM's party pick up, nobody answering it, and is out at the next bite, the pick gone.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const ITEM_TM04_CALM_MIND = 292;

const stand = (page: Page, map: string, x: number, y: number, facing: number) => page.evaluate(([map, x, y, facing]) => {
  const s = (window as any).__spike, a = s.link.room.actor(s.link.me), spot = { map, x, y };
  a.m = { ...a.m, spot, prev: spot, facing, moveDir: facing, action: null, px: 0, py: 0, bike: false };
  a.calm = 1e9;
}, [map, x, y, facing] as const);

async function fromChest(page: Page): Promise<void> {
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await stand(page, 'MAP_ROUTE117_POKEMON_DAY_CARE', 5, 6, 2);
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
}

test("a TM's party pick is no place out of the fog: a team at 1 HP is out at the next bite", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=40&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  await fromChest(page);
  await spike(page, (s) => s.rom.fillParty());
  // The first ring is in: a cell outside it, in the fog now.
  await expect.poll(() => spike(page, (s) => s.link.room.ring().phase >= 1), { timeout: 70_000, intervals: [250] }).toBe(true);
  const place = await spike(page, (s) => {
    const room = s.link.room, ring = room.ring();
    for (const [id, p] of room.places) for (let y = 1; y < (s.placed.get(id)?.m.h ?? 0) - 1; y++) for (let x = 1; x < s.placed.get(id).m.w - 1; x++) {
      if (!s.placed.get(id).m.outdoor || room.world.cell(id, x, y) !== 0) continue;
      const d = Math.hypot(p.gx + x + 0.5 - ring.cx, p.gy + y + 0.5 - ring.cy);
      if (d > ring.r + 3) return { map: id, x, y };
    }
    return null;
  }) as { map: string; x: number; y: number };
  expect(place, 'a cell in the fog').toBeTruthy();
  // A TM's "Which POKeMON?", left unanswered, then into the fog.
  await spike(page, (s) => s.give(292));
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000, message: "the TM's party pick is up" }).toBe(true);
  await stand(page, place.map, place.x, place.y, 1);
  expect(await spike(page, (s) => s.link.room.inFog(s.link.room.actor(s.link.me).m.spot)), 'in the fog').toBe(true);
  // The team's HP, as the ROM has it, while the pick stays up: a bite every four seconds takes a
  // tenth of each, so it falls, and a full team is out in ten of them.
  const hp = () => spike(page, (s) => { const e = s.rom.emu, at = s.art.sym('gPlayerParty'), n = e.read(s.art.sym('gPlayerPartyCount'), 8); let t = 0; for (let i = 0; i < n; i++) t += e.read(at + i * 100 + 86, 16); return t; });
  const before = await hp();
  await page.waitForTimeout(9_000);
  const after = await hp();
  console.log(`team HP with the pick up: ${before} -> ${after}`);
  expect(after, 'the fog bites with the pick up').toBeLessThan(before);
  expect(await spike(page, (s) => s.swapping), 'the pick still up').toBe(true);
  await expect.poll(() => spike(page, (s) => s.isOut), { timeout: 60_000, intervals: [500], message: 'out in the fog with the pick up' }).toBe(true);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 10_000 }).toBe(false);
  expect(ITEM_TM04_CALM_MIND).toBe(292);
  await ctx.close();
});
