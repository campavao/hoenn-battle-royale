// Cam, 11-09, a match of two players and two bots: "there still seem to be some delays when playing,
// such as when picking up an item or teaching it". From the room's word that the item is mine to the
// box saying so, and for a TM through the party window to "Taught", each step timed.
//
// Before: a TM went through the hidden ROM's START, BAG, TM CASE, USE and party, with the field held
// still: 1.87 s from the click on a mon to "Taught" on a desktop. Now the page writes the move, as the
// team's MOVES does, and the same click is about a tenth of a second.
import { expect, test, type Page } from '@playwright/test';
import { giveTeam, type Craft } from './craft';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const MOVE_GROWL = 45, MOVE_TOXIC = 92, MOVE_CUT = 15;
const ITEM_POTION = 13;
const ITEM_TM06_TOXIC = 294;
const ITEM_HM01_CUT = 339;
// ALAKAZAM knows one move, AZUMARILL four: a TM to it asks which goes.
const TEAM: Craft[] = [
  { species: 65, name: 'ALAKAZAM', level: 30, moves: [MOVE_GROWL], hp: 200, stats: [90, 60, 60, 60, 60], personality: 1000 },
  { species: 184, name: 'AZUMARILL', level: 30, moves: [MOVE_GROWL, 33, 39, 55], hp: 200, stats: [90, 60, 60, 60, 60], personality: 1025 },
  { species: 7, name: 'SQUIRT', level: 30, moves: [MOVE_GROWL], hp: 200, stats: [90, 60, 60, 60, 60], personality: 1050 },
];
/** From the click on a mon to the box's "Taught": generous for a loaded CI runner, and a fraction
 *  of the ROM walk it replaces (1.87 s on a desktop, more on a phone). */
const TAUGHT_MS = 1000;

async function withTeam(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  await giveTeam(page, TEAM);
  await page.waitForTimeout(1000);
}

type Line = { t: number; what: string };
/** Every call to the ROM's give, take and menu, timed, and each line the box says, from here on. */
function arm(page: Page): Promise<void> {
  return page.evaluate(() => {
    const s = (window as any).__spike, r = s.rom;
    const w = window as any;
    w.__pickOff?.();
    const log: { t: number; what: string }[] = [];
    const t0 = performance.now();
    const at = (what: string) => log.push({ t: Math.round(performance.now() - t0), what });
    const was: [string, any][] = [];
    for (const name of ['give', 'menu', 'take', 'setHeld', 'setMove']) {
      const f = r[name];
      was.push([name, f]);
      r[name] = (...args: unknown[]) => { at(`${name} in`); return Promise.resolve(f.apply(r, args)).finally(() => at(`${name} out`)); };
    }
    const msg = document.getElementById('msg')!;
    const seen = new MutationObserver(() => at(`msg ${msg.getAttribute('data-text') ?? ''}`));
    seen.observe(msg, { attributes: true, attributeFilter: ['data-text'] });
    w.__pick = { log, at };
    w.__pickOff = () => { seen.disconnect(); for (const [name, f] of was) r[name] = f; };
  });
}
const log = (page: Page) => page.evaluate(() => (window as any).__pick.log as Line[]);
const mark = (page: Page, what: string) => page.evaluate((what) => (window as any).__pick.at(what), what);
const when = (lines: Line[], re: RegExp) => lines.find((x) => re.test(x.what))?.t ?? -1;
const movesOf = (page: Page, slot: number) => page.evaluate((slot) => ((window as any).__spike.battleMenu.deps.firstMoves.readParty()[slot].moves as { id: number }[]).map((m) => m.id), slot);
/** How many of `item` the bag holds, in its pocket (0 items, 2 TMs and HMs: bag.ts POCKET_*). */
const inBag = (page: Page, item: number) => page.evaluate((item) => ((window as any).__spike.pocket(item >= 289 && item <= 346 ? 2 : 0) as { item: number; n: number }[]).filter((x) => x.item === item).reduce((n, x) => n + (x.n ?? 1), 0), item);

async function pickUp(page: Page, item: number, key: number): Promise<void> {
  // The last line gone first: the box does not say again what it is still saying.
  await expect(page.locator('#msg')).not.toHaveAttribute('data-text', /./, { timeout: 10_000 });
  await arm(page);
  await mark(page, 'picked');
  await page.evaluate(([item, key]) => { const s = (window as any).__spike; s.startFor({ type: 'item', tick: 0, id: s.link.me, key, item }); }, [item, key]);
}
async function toMon(page: Page, slot: number): Promise<void> {
  await expect(page.locator('.bm-slot').nth(slot)).toBeVisible({ timeout: 20_000 });
  await mark(page, 'clicked');
  await page.locator('.bm-slot').nth(slot).click();
}
const taughtIn = async (page: Page, name: string) => {
  await expect.poll(async () => when(await log(page), /^msg Taught/), { timeout: 30_000 }).toBeGreaterThanOrEqual(0)
    .catch(async (e) => { console.log(name, 'never taught', JSON.stringify(await log(page)), await spike(page, (s) => JSON.stringify({ swapping: s.swapping, asking: s.asking }))); throw e; });
  const lines = await log(page);
  console.log(name, JSON.stringify(lines));
  expect(lines.some((x) => x.what === 'menu in'), `${name}: not through the ROM's START and BAG`).toBe(false);
  return when(lines, /^msg Taught/) - when(lines, /^clicked$/);
};

test('a TM off the ground teaches at once, the four ask which goes, and an HM stays in the bag', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);

  await pickUp(page, ITEM_POTION, 0x7f0001);
  await expect.poll(async () => when(await log(page), /^give out$/), { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
  console.log('POTION', JSON.stringify(await log(page)));
  expect(await inBag(page, ITEM_POTION), 'the POTION in the bag').toBeGreaterThan(0);

  // One move known: TOXIC is its second, and the TM is spent.
  await pickUp(page, ITEM_TM06_TOXIC, 0x7f0002);
  await toMon(page, 0);
  const one = await taughtIn(page, 'TM to one move');
  expect(await movesOf(page, 0)).toEqual([MOVE_GROWL, MOVE_TOXIC]);
  expect(await inBag(page, ITEM_TM06_TOXIC), 'a TM that taught is spent').toBe(0);
  expect(one, 'click to "Taught"').toBeLessThan(TAUGHT_MS);
  // The field is the player's again.
  expect(await spike(page, (s) => s.swapping)).toBe(false);

  // Four known: the windows ask which goes, and the one picked is the one gone.
  await pickUp(page, ITEM_TM06_TOXIC, 0x7f0003);
  await toMon(page, 1);
  await expect(page.locator('.bm-forget-head')).toBeVisible({ timeout: 10_000 });
  await mark(page, 'forgot');
  await page.locator('.bm-pick-move').nth(2).click();
  await taughtIn(page, 'TM to four moves');
  expect(await movesOf(page, 1)).toEqual([MOVE_GROWL, 33, MOVE_TOXIC, 55]);
  expect(await inBag(page, ITEM_TM06_TOXIC), 'spent').toBe(0);

  // An HM teaches and stays.
  await pickUp(page, ITEM_HM01_CUT, 0x7f0004);
  await toMon(page, 2);
  const hm = await taughtIn(page, 'HM');
  expect(await movesOf(page, 2)).toEqual([MOVE_GROWL, MOVE_CUT]);
  expect(await inBag(page, ITEM_HM01_CUT), 'an HM is not spent').toBe(1);
  expect(hm, 'click to "Taught"').toBeLessThan(TAUGHT_MS);

  // BACK at the party: it went in the bag, nobody learned anything.
  await pickUp(page, ITEM_TM06_TOXIC, 0x7f0005);
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('x');
  await expect.poll(async () => when(await log(page), /^msg .* went in the BAG/), { timeout: 20_000 }).toBeGreaterThanOrEqual(0)
    .catch(async (e) => { console.log('BACK', JSON.stringify(await log(page)), await spike(page, (s) => JSON.stringify({ swapping: s.swapping }))); throw e; });
  expect(await inBag(page, ITEM_TM06_TOXIC)).toBe(1);
  expect(await movesOf(page, 2)).toEqual([MOVE_GROWL, MOVE_CUT]);
  await ctx.close();
});

// A fallen bot's bag, taken (main.ts takeBag): a GIVE to the ROM a row. Eight rows, timed.
test('a bag of eight rows goes in quickly', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  // POTION, ANTIDOTE, PARALYZE HEAL, AWAKENING, BURN HEAL, ICE HEAL, ESCAPE ROPE, REPEL.
  const rows = [13, 14, 18, 17, 15, 16, 85, 86];
  const each = await page.evaluate(async (rows) => {
    const r = (window as any).__spike.rom, out: number[] = [];
    for (const id of rows) { const t = performance.now(); const got = await r.give(id, 2); out.push(got ? Math.round(performance.now() - t) : -1); }
    return out;
  }, rows);
  const total = each.reduce((a, b) => a + b, 0);
  console.log('bag of eight', JSON.stringify(each), total);
  // Each went in (as itself or as br_items.c's Apply made it).
  expect(each.filter((t) => t < 0), 'every row taken').toEqual([]);
  // 785 ms on a desktop at the ROM's own speed, 341 hurried; a phone is a few times either.
  expect(total, "eight rows").toBeLessThan(600);
  await ctx.close();
});
