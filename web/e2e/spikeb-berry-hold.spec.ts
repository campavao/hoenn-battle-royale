// Cam, 2026-11-21: "Picking up a berry should prompt you to give to a pokemon to hold." A berry off
// the ground asks YES or NO in Emerald's own box; YES is the party, a POKeMON picked holds it (one
// holding something already asks to switch, party_menu.c's rule, the old one to the bag), and NO
// keeps it in the bag as before. On a phone: the YES tapped, the mon tapped.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });

// include/constants/items.h
const ITEM_ORAN_BERRY = 139, ITEM_SITRUS_BERRY = 142, ITEM_LEFTOVERS = 200;
const POCKET_ITEMS = 0, POCKET_BERRIES = 3;

/** Into a match of the page's own with a team of six (the chest's mon, then fillParty), a little
 *  way from anything: spikeb-windows.spec.ts's withTeam. */
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
  await spike(page, (s) => s.rom.fillParty());
  await page.waitForTimeout(500);
}

/** What each of the party holds, off the ROM's party. */
const held = (page: Page) => spike(page, (s) => s.battleMenu.deps.firstMoves.readParty().map((m: any) => m.item)) as Promise<number[]>;
/** How many of `item` the ROM's bag holds in `pocket`. */
const inBag = (page: Page, pocket: number, item: number) => page.evaluate(([pocket, item]) => ((window as any).__spike.pocket(pocket) as { item: number; n: number }[]).filter((x) => x.item === item).reduce((n, x) => n + (x.n ?? 1), 0), [pocket, item]);
/** A ball of `item` taken off the ground, as the room says so (room.ts's 'item' event). */
const pickUp = (page: Page, item: number, key: number) => page.evaluate(([item, key]) => { const s = (window as any).__spike; s.startFor({ type: 'item', tick: 0, id: s.link.me, key, item }); }, [item, key]);
const msg = (page: Page) => page.locator('#msg');
const asked = (page: Page) => spike(page, (s) => s.askingRows) as Promise<{ rows: string[]; pick: number } | null>;

/** A tap on the YES of the YES/NO: the middle of the points askbox.ts's own rowFor says are row 0. */
async function tapYes(page: Page): Promise<void> {
  const at = await page.evaluate(() => {
    const box = (window as any).__spike.askBox, r = document.getElementById('askbox')!.getBoundingClientRect();
    const hits: { x: number; y: number }[] = [];
    for (let y = r.top; y < r.bottom; y += 2) for (let x = r.left; x < r.right; x += 2) if (box.rowFor(x, y) === 0) hits.push({ x, y });
    if (!hits.length) return null;
    return { x: hits.reduce((n, p) => n + p.x, 0) / hits.length, y: hits.reduce((n, p) => n + p.y, 0) / hits.length };
  });
  expect(at, 'a YES row on the askbox').not.toBeNull();
  await page.touchscreen.tap(at!.x, at!.y);
}

test('a berry off the ground asks to be held: YES and a mon holds it, NO keeps it, a held one switches', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  const was = await held(page);
  expect(was.length).toBe(6);
  expect(was[0], 'the lead holds nothing to start').toBe(0);

  // YES, by a tap, then the lead, by a tap: it holds the ORAN BERRY, and the bag has none.
  await pickUp(page, ITEM_ORAN_BERRY, 0x7f2001);
  await expect.poll(() => asked(page), { timeout: 20_000 }).toEqual({ rows: ['y', ''], pick: 0 });
  await expect(page.locator('#askbox')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'phone-berry-ask');
  await tapYes(page);
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  // The tap that said YES is not also a pick: the party waits for one (its first phone run gave
  // the lead the berry off the YES alone).
  await page.waitForTimeout(600);
  expect(await spike(page, (s) => s.swapping), 'the party still asking').toBe(true);
  expect((await held(page))[0]).toBe(0);
  await shot(page, 'phone-berry-party');
  await page.locator('.bm-slot').first().tap();
  await expect(msg(page)).toHaveAttribute('data-text', /was given the ORAN BERRY to hold/, { timeout: 20_000 });
  await expect.poll(async () => (await held(page))[0], { timeout: 10_000 }).toBe(ITEM_ORAN_BERRY);
  expect(await inBag(page, POCKET_BERRIES, ITEM_ORAN_BERRY), 'given, not bagged').toBe(0);
  await expect.poll(() => spike(page, (s) => s.swapping || !!s.asking), { timeout: 10_000 }).toBe(false);
  await page.waitForTimeout(1200); // the line typed out
  await shot(page, 'phone-berry-given');

  // NO, by the keys: in the bag, and nobody's held item changed.
  await expect(msg(page)).not.toHaveAttribute('data-text', /./, { timeout: 10_000 });
  await pickUp(page, ITEM_SITRUS_BERRY, 0x7f2002);
  await expect.poll(() => asked(page), { timeout: 20_000 }).not.toBeNull();
  await page.keyboard.press('x');
  await expect(msg(page)).toHaveAttribute('data-text', /SITRUS BERRY went in the BAG/, { timeout: 20_000 });
  expect(await inBag(page, POCKET_BERRIES, ITEM_SITRUS_BERRY)).toBe(1);
  expect((await held(page))[0]).toBe(ITEM_ORAN_BERRY);
  await shot(page, 'phone-berry-no');

  // The second mon holds LEFTOVERS (a gift's own screen), then a SITRUS BERRY for it: the switch is
  // asked, YES, and the LEFTOVERS go in the bag.
  await expect(msg(page)).not.toHaveAttribute('data-text', /./, { timeout: 10_000 });
  await spike(page, (s) => s.give(200));
  await expect(page.locator('.bm-slot').nth(1)).toBeVisible({ timeout: 20_000 });
  await page.locator('.bm-slot').nth(1).tap();
  await expect.poll(async () => (await held(page))[1], { timeout: 20_000 }).toBe(ITEM_LEFTOVERS);
  await expect.poll(() => spike(page, (s) => s.swapping || !!s.asking), { timeout: 10_000 }).toBe(false);
  await expect(msg(page)).not.toHaveAttribute('data-text', /./, { timeout: 10_000 });
  await pickUp(page, ITEM_SITRUS_BERRY, 0x7f2003);
  await expect.poll(() => asked(page), { timeout: 20_000 }).not.toBeNull();
  await page.keyboard.press('z');
  await expect(page.locator('.bm-slot').nth(1)).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').nth(1).tap();
  await expect.poll(() => asked(page), { timeout: 15_000 }).toEqual({ rows: ['y', ''], pick: 0 });
  await shot(page, 'phone-berry-switch');
  await page.keyboard.press('z');
  await expect(msg(page)).toHaveAttribute('data-text', /The LEFTOVERS was taken and replaced with the SITRUS BERRY/, { timeout: 20_000 });
  await expect.poll(async () => (await held(page))[1], { timeout: 10_000 }).toBe(ITEM_SITRUS_BERRY);
  expect(await inBag(page, POCKET_ITEMS, ITEM_LEFTOVERS), 'the old one in the bag').toBe(1);
  expect(await inBag(page, POCKET_BERRIES, ITEM_SITRUS_BERRY), 'the one from the NO is still there').toBe(1);
  expect((await held(page))[0]).toBe(ITEM_ORAN_BERRY);
  await page.waitForTimeout(1200);
  await shot(page, 'phone-berry-switched');
  await ctx.close();
});
