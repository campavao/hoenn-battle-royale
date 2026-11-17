// Cam's 11-16 notes, both from the field's BAG: a TM taught to one who knows four, its "forget
// which?" cancelled, hung the screen under an empty overlay; and a stone played the whole evolution
// scene rather than just evolving.
import { expect, test, type Page } from '@playwright/test';
import { giveTeam, type Craft } from './craft';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const ITEM_THUNDER_STONE = 96;
const ITEM_TM17_PROTECT = 305;
// PIKACHU (a THUNDER STONE makes it RAICHU), knowing four, and a team behind it.
const TEAM: Craft[] = [0, 1, 2].map((i) => ({ species: 25, name: 'PIKA', level: 30, moves: [45, 33, 39, 43], hp: 80, stats: [60, 50, 90, 50, 50], personality: 777 + i * 13 }));

async function withTeam(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
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
  await giveTeam(page, TEAM);
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.calm = 1e9; });
}

/** The BAG, on the pocket that holds `item`, its row picked and USE pressed. */
async function useFromBag(page: Page, item: number): Promise<void> {
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  const rowOf = () => spike(page, new Function('s', `return s.battleMenu.stacks().findIndex((x) => x.item === ${item})`) as (s: any) => number);
  for (let i = 0; i < 6 && (await rowOf()) < 0; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); }
  const row = await rowOf();
  expect(row, `item ${item} in a pocket`).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
}

const species = (page: Page, slot: number) => spike(page, new Function('s', `return s.battleMenu.deps.firstMoves.readParty()[${slot}]?.species ?? 0`) as (s: any) => number);

test('a TM to one who knows four, its forget cancelled: back to the BAG, nothing hung', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await spike(page, (s) => s.rom.give(305, 1));
  await useFromBag(page, ITEM_TM17_PROTECT);
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-forget-head'), 'which move goes').toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('x');
  // Nothing taught, the TM kept, and the windows back: the BAG, or the field, not an empty overlay.
  await expect.poll(async () => (await page.locator('.bm-bag-head').isVisible()) || !(await spike(page, (s) => s.swapping)), { timeout: 20_000, message: 'not hung' }).toBe(true);
  await page.screenshot({ path: test.info().outputPath('after-cancel.png') });
  const kept = await spike(page, (s) => s.pocket(3).some((x: any) => x.item === 305) || s.pocket(2).some((x: any) => x.item === 305));
  expect(kept, 'the TM is still in the BAG').toBe(true);
  await ctx.close();
});

test('a stone evolves at once: no evolution scene', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await spike(page, (s) => s.rom.give(96, 1));
  expect(await species(page, 0)).toBe(25);
  // Whether the ROM's own screen comes up, every frame from USE on.
  await page.evaluate(() => { const w = window as any; w.__screen = false; const t = setInterval(() => { if (document.getElementById('battle')?.classList.contains('screen')) w.__screen = true; }, 50); w.__stop = () => clearInterval(t); });
  await useFromBag(page, ITEM_THUNDER_STONE);
  await expect(page.locator('.bm-use-head')).toBeVisible();
  const t0 = Date.now();
  await page.locator('.bm-slot').first().click();
  await expect.poll(() => species(page, 0), { timeout: 60_000, message: 'RAICHU' }).toBe(26);
  const took = Date.now() - t0;
  const screen = await page.evaluate(() => { const w = window as any; w.__stop(); return w.__screen as boolean; });
  console.log(`stone: RAICHU in ${took} ms; the ROM's screen shown: ${screen}`);
  expect(screen, 'no evolution scene shown').toBe(false);
  expect(took, 'at once').toBeLessThan(5_000);
  await ctx.close();
});
