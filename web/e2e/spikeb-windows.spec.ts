// The windows Cam drew (11-01 sketches, 11-02 notes): the minimap and the name by the thing on the
// field, a dropped bag's windows, and a battle's moves first with PARTY, BAG and RUN, its party
// and one of them, by a thumb and by the keys alone.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

/** Into a match of the page's own with a team of six, a little way from anything. */
async function withTeam(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  await tap('z'); await page.waitForTimeout(3000);
  await tap('z'); await page.waitForTimeout(1200);
  await tap('Enter'); await page.waitForTimeout(2000);
  for (let i = 0; i < 10 && (await spike(page, (s) => s.swapping)); i++) { await tap('x'); await page.waitForTimeout(1500); }
  await page.waitForTimeout(1500);
  await spike(page, (s) => s.rom.fillParty());
}

async function intoBattle(page: Page): Promise<void> {
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const q = room.patchesOn('MAP_ROUTE117').find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map: 'MAP_ROUTE117', x: q.x - 1, y: q.y }, 4));
    const spot = { map: 'MAP_ROUTE117', x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
  });
  await page.waitForTimeout(1000);
  await key(page, 'ArrowRight', true); await page.waitForTimeout(150); await key(page, 'ArrowRight', false);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

/** E, down the pocket to `item`, Z, and USE. */
async function useFromBag(page: Page, item: number): Promise<void> {
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  const row = await spike(page, new Function('s', `return s.battleMenu.stacks().findIndex((x) => x.item === ${item})`) as (s: any) => number);
  expect(row, `item ${item} in the pocket`).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
}

const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });
/** The keys' hints sit on no window of the battle's, in whichever of them is up. */
const keysClear = (page: Page) => page.evaluate(() => {
  const keys = document.querySelector('.bm-keys')!.getBoundingClientRect();
  return [...document.querySelectorAll('#battle canvas')]
    .filter((c) => !c.closest('.bm-keys'))
    .map((c) => ({ c, b: c.getBoundingClientRect() }))
    .filter(({ b }) => b.width > 0 && b.left < keys.right && keys.left < b.right && b.top < keys.bottom && keys.top < b.bottom)
    .map(({ c, b }) => `${c.parentElement!.className} ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`);
});
const leadIndex = (page: Page) => spike(page, (s) => s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16));

test('by the keys alone: moves first, PARTY and one of them, sent out, BAG, a move', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await expect(page.locator('#hud-map')).toBeHidden();
  await expect(page.locator('#hud-party')).toBeVisible();
  await expect(page.locator('#hud-bag')).toBeVisible();
  await expect(page.locator('.hud-mini')).toBeVisible();
  await shot(page, 'desk-field');
  await intoBattle(page);
  await shot(page, 'desk-battle');
  // The hidden ROM's card and swirl run quiet and fast; the sound comes back for the fight.
  await expect.poll(() => spike(page, (s) => s.rom.emu.m.getVolume()), { message: "the battle's sound" }).toBe(1);
  expect(await keysClear(page), 'the moves').toEqual([]);

  // The moves are up, with the focus on the first.
  await expect(page.locator('.bm-cell')).toHaveCount(4);
  await expect(page.locator('.bm-cell').first()).toHaveClass(/bm-focus/);
  await expect(page.locator('.bm-actions')).toBeVisible();
  await expect(page.locator('.bm-keys')).toBeVisible();
  // ...and the arrows go where the screen says: right, right to PARTY in its column.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.bm-cell').nth(1)).toHaveClass(/bm-focus/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.bm-act-party')).toHaveClass(/bm-focus/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');

  // Q is PARTY; the second of them, and SELECT.
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await shot(page, 'desk-party');
  expect(await keysClear(page), 'the party').toEqual([]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('z');
  await expect(page.locator('.bm-member')).toBeVisible();
  await shot(page, 'desk-member');
  expect(await keysClear(page), 'one of them').toEqual([]);
  expect(await leadIndex(page)).toBe(0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.bm-m-btn').nth(2)).toHaveClass(/bm-focus/);
  await page.keyboard.press('z');
  // The ROM's party screen is walked unseen, and the second is out.
  await expect.poll(() => leadIndex(page), { timeout: 30_000 }).toBe(1);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });

  // The one out heads the list now, as on the ROM's own screen, and can't be sent out again.
  await page.keyboard.press('q');
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-m-btn').nth(2)).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('x');
  await page.keyboard.press('x');
  await expect(page.locator('.bm-cell').first()).toBeVisible();

  // E is the BAG, and X back from it.
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  await shot(page, 'desk-bag');
  expect(await keysClear(page), 'the bag').toEqual([]);
  await page.keyboard.press('x');
  await expect(page.locator('.bm-cell').first()).toBeVisible();

  // Z on a move fights the turn: the windows go down for it.
  await page.keyboard.press('z');
  await page.waitForFunction(() => !(window as any).__spike.battleMenu?.isShown, undefined, { timeout: 5000 });
  await ctx.close();
});

test('a medicine asks on the party windows: a Revive for the fainted, a Potion for the hurt', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0002, name: 'DRAKE', bag: { items: [{ id: 24, n: 1 }, { id: 13, n: 2 }], money: 0, mons: [{ species: 373, level: 30 }] } }));
  await expect(page.locator('#bag-panel button')).toHaveCount(3);
  await page.locator('#bag-panel button').nth(1).click();
  await page.locator('#bag-panel button').first().click();
  await expect(page.locator('#bag-panel')).toBeHidden();
  // The third fainted, the fourth hurt.
  const hp = (slot: number) => spike(page, new Function('s', `return s.rom.emu.read(s.art.sym('gPlayerParty') + ${slot} * 100 + 86, 16)`) as (s: any) => number);
  await spike(page, (s) => { const at = s.art.sym('gPlayerParty'); s.rom.emu.write(at + 2 * 100 + 86, 0, 16); s.rom.emu.write(at + 3 * 100 + 86, 1, 16); });
  await intoBattle(page);

  const use = (item: number) => useFromBag(page, item);

  await use(24);
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  await shot(page, 'desk-use');
  await expect(page.locator('#battle-menu .bm-back')).toBeInViewport({ ratio: 1 });
  const shut = await page.locator('.bm-slot').evaluateAll((all) => all.map((b) => b.getAttribute('aria-disabled')));
  expect(shut, 'a Revive only for the fainted').toEqual(['true', 'true', 'false', 'true', 'true', 'true']);
  // BACK is the item again, and nothing has gone near the ROM.
  await page.keyboard.press('x');
  await expect(page.locator('.bm-bag-use')).toBeVisible();
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-use-head')).toBeVisible();
  // The keys land on the one who can take it.
  await expect(page.locator('.bm-slot').nth(2)).toHaveClass(/bm-focus/);
  await page.keyboard.press('z');
  await expect.poll(() => hp(2), { timeout: 30_000, message: 'revived' }).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  await shot(page, 'desk-use-walk');
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });
  await expect(page.locator('.bm-use-head')).toBeHidden();

  const before = await hp(3);
  await use(13);
  await expect(page.locator('.bm-slot').nth(3)).not.toHaveAttribute('aria-disabled', 'true');
  await page.locator('.bm-slot').nth(3).click();
  await expect.poll(() => hp(3), { timeout: 30_000, message: 'healed' }).toBeGreaterThan(before);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });
  await ctx.close();
});

test('an Ether asks who and then which move, on the windows', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0003, name: 'DRAKE', bag: { items: [{ id: 34, n: 1 }], money: 0, mons: [{ species: 373, level: 30 }] } }));
  await page.locator('#bag-panel button').nth(1).click();
  await page.locator('#bag-panel button').first().click();
  await expect(page.locator('#bag-panel')).toBeHidden();
  await intoBattle(page);
  const first = () => spike(page, (s) => s.battleMenu.deps.firstMoves.readParty()[0].moves[0]) as Promise<{ pp: number; maxPp: number }>;
  // A move spent, so there is a point to restore.
  await page.keyboard.press('z');
  await expect.poll(async () => { const m = await first(); return m.pp < m.maxPp; }, { timeout: 30_000 }).toBe(true);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });
  const spent = (await first()).pp;

  await useFromBag(page, 34);
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-pick-move').first()).toBeVisible();
  await shot(page, 'desk-ether');
  await expect(page.locator('#battle-menu .bm-back')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.bm-pick-move').nth(1), 'the full ones are no use').toHaveAttribute('aria-disabled', 'true');
  // BACK is who again, and a slot the question again.
  await page.keyboard.press('x');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.locator('.bm-slot').first().click();
  await page.locator('.bm-pick-move').first().click();
  await expect.poll(async () => (await first()).pp, { timeout: 30_000, message: 'restored' }).toBeGreaterThan(spent);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });
  await ctx.close();
});

test('a Safari battle is the windows too, with its four', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const map = a.m.spot.map;
    const q = room.patchesOn(map).find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map, x: q.x - 1, y: q.y }, 4));
    const spot = { map, x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
  });
  await page.waitForTimeout(1000);
  await key(page, 'ArrowRight', true); await page.waitForTimeout(150); await key(page, 'ArrowRight', false);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('.bm-cell')).toHaveCount(4);
  await expect(page.locator('#battle-menu')).toHaveAttribute('data-mode', 'action');
  await shot(page, 'phone-safari');
  // BALL throws.
  await page.locator('.bm-cell').first().click();
  await page.waitForFunction(() => !(window as any).__spike.battleMenu?.isShown, undefined, { timeout: 5000 });
  await ctx.close();
});

test('one faints: who goes out is the party windows, with no way back and the ROM unseen', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await intoBattle(page);
  // The lead on its last point, and the second already gone.
  await spike(page, (s) => {
    const emu = s.rom.emu, at = s.art.sym('gPlayerParty'), mons = s.art.sym('gBattleMons');
    emu.write(at + 86, 1, 16); emu.write(mons + 0x28, 1, 16); emu.write(at + 100 + 86, 0, 16);
  });
  // A move each time the windows ask, and A through "Use next POKeMON?", until the party asks.
  const asked = () => page.locator('.bm-use-head').isVisible();
  for (let i = 0; i < 60 && !(await asked()); i++) { await page.keyboard.press('z'); await page.waitForTimeout(700); }
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await shot(page, 'desk-forced');
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  await expect(page.locator('#battle-menu .bm-back')).toBeHidden();
  // X goes nowhere: somebody has to go out.
  await page.keyboard.press('x');
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await page.locator('.bm-slot').nth(2).click();
  await expect(page.locator('.bm-member')).toBeVisible();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(() => leadIndex(page), { timeout: 30_000 }).toBe(2);
  await shot(page, 'desk-forced-out');
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });
  await expect(page.locator('.bm-cell').first()).toBeVisible();
  await ctx.close();
});

test('PARTY and BAG on the field are the windows: switch, hold, summary, and use', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0004, name: 'DRAKE', bag: { items: [{ id: 24, n: 1 }, { id: 13, n: 3 }], money: 0, mons: [{ species: 373, level: 30 }] } }));
  await page.locator('#bag-panel button').nth(1).click();
  await page.locator('#bag-panel button').first().click();
  await expect(page.locator('#bag-panel')).toBeHidden();
  await page.waitForTimeout(800);
  const hp = (slot: number) => spike(page, new Function('s', `return s.rom.emu.read(s.art.sym('gPlayerParty') + ${slot} * 100 + 86, 16)`) as (s: any) => number);
  const team = () => spike(page, (s) => s.battleMenu.deps.firstMoves.readParty()) as Promise<{ hp: number; item: number }[]>;
  const stacks = () => spike(page, (s) => s.battleMenu.stacks()) as Promise<{ item: number; n: number }[]>;

  // PARTY: no ROM screen comes up for it, and the keys drive it.
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await expect(page.locator('#battle.panel')).toHaveCount(1);
  await expect(page.locator('#gba')).toBeHidden();
  await shot(page, 'desk-field-party');
  // GIVE the fourth a POTION from the field's own bag.
  await page.locator('.bm-slot').nth(3).click();
  await expect(page.locator('.bm-member')).toBeVisible();
  await shot(page, 'desk-field-member');
  await page.locator('.bm-m-btn').nth(3).click();
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  const potion = (await stacks()).find((x) => x.item === 13)!;
  const row = (await stacks()).findIndex((x) => x.item === 13);
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-member')).toBeVisible();
  await expect.poll(async () => (await team())[3].item).toBe(13);
  expect(potion.n).toBe(3);
  // SWITCH it with the first, by the page alone: the POTION goes with it.
  await page.locator('.bm-m-btn').nth(2).click();
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await page.locator('.bm-slot').first().click();
  await expect.poll(async () => (await team())[0].item).toBe(13);
  await expect(page.locator('.bm-use-head')).toBeHidden();
  // TAKE it back.
  await page.locator('.bm-slot').first().click();
  await page.locator('.bm-m-btn').nth(3).click();
  await expect.poll(async () => (await team())[0].item, { timeout: 15_000 }).toBe(0);
  // SUMMARY is the ROM's own, and comes back to the windows.
  await page.locator('.bm-m-btn').nth(1).click();
  await expect(page.locator('#gba')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'desk-field-summary');
  await page.keyboard.press('x', { delay: 150 });
  await expect(page.locator('.bm-member')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#gba')).toBeHidden();
  // BACK, BACK: the field, and walking again.
  await page.keyboard.press('x');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('.bm-slot').first()).toBeHidden();
  await expect.poll(() => spike(page, (s) => s.swapping)).toBe(false);

  // BAG: a REVIVE asks, and only the fainted can take it.
  await spike(page, (s) => { const at = s.art.sym('gPlayerParty'); s.rom.emu.write(at + 86, 5, 16); s.rom.emu.write(at + 2 * 100 + 86, 0, 16); });
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  await shot(page, 'desk-field-bag');
  const revive = (await stacks()).findIndex((x) => x.item === 24);
  for (let i = 0; i < revive; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-use-head')).toBeVisible();
  const shut = await page.locator('.bm-slot').evaluateAll((all) => all.map((b) => b.getAttribute('aria-disabled')));
  expect(shut, 'a Revive only for the fainted').toEqual(['true', 'true', 'false', 'true', 'true', 'true']);
  await shot(page, 'desk-field-use');
  await page.locator('.bm-slot').nth(2).click();
  await expect.poll(() => hp(2), { timeout: 30_000, message: 'revived' }).toBeGreaterThan(0);
  await expect(page.locator('.bm-bag-head')).toBeVisible({ timeout: 20_000 });
  // A POTION asks nothing in a match: all of them at once.
  const potionRow = (await stacks()).findIndex((x) => x.item === 13);
  for (let i = 0; i < potionRow; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
  await expect.poll(() => hp(0), { timeout: 30_000, message: 'healed' }).toBeGreaterThan(5);
  await expect(page.locator('.bm-bag-head')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('x');
  await expect.poll(() => spike(page, (s) => s.swapping)).toBe(false);
  await ctx.close();
});

test('PARTY and BAG on a phone: the dock opens the windows, and everything fits', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  await page.locator('#hud-party').click();
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  await expect(page.locator('#battle-menu .bm-back')).toBeInViewport({ ratio: 1 });
  await shot(page, 'phone-field-party');
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-member')).toBeVisible();
  for (let i = 0; i < 5; i++) await expect(page.locator('.bm-m-btn').nth(i)).toBeInViewport({ ratio: 1 });
  await shot(page, 'phone-field-member');
  await page.locator('.bm-m-btn').first().click();
  await page.locator('#battle-menu .bm-back').click();
  await expect(page.locator('.bm-slot').first()).toBeHidden();
  await expect(page.locator('#hud-bag')).toBeVisible();
  await page.locator('#hud-bag').click();
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  await expect(page.locator('#battle-menu .bm-back')).toBeInViewport({ ratio: 1 });
  await shot(page, 'phone-field-bag');
  await page.locator('#battle-menu .bm-back').click();
  await expect(page.locator('.bm-bag-head')).toBeHidden();
  await ctx.close();
});

test('by a thumb: moves first, RUN says its odds, and a dropped bag asks with windows', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  await expect(page.locator('#hud-bag')).toBeVisible();
  await expect(page.locator('#hud-ctx')).toBeVisible();
  // The tag says what lies ahead, over it.
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const g = [...room.ground().values()].find((g: any) => !g.gift && /ROUTE1|CITY$|TOWN$/.test(g.map) && room.stepFor(a)({ map: g.map, x: g.x, y: g.y + 1 }, 3) && s.placed.get(g.map)) as any;
    const spot = { map: g.map, x: g.x, y: g.y + 1 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    a.calm = 1e9;
  });
  await expect(page.locator('#item-tag')).toBeVisible({ timeout: 5000 });
  await shot(page, 'phone-field');

  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0001, name: 'DRAKE', bag: { items: [{ id: 13, n: 3 }], money: 300, mons: [{ species: 373, level: 30 }] } }));
  await expect(page.locator('#bag-panel button')).toHaveCount(3);
  await shot(page, 'phone-bag');
  await page.locator('#bag-panel button').nth(1).click();
  await expect(page.locator('#bag-panel button')).toHaveCount(2);
  // TAKE ALL: into the bag, and the team stays on the ground.
  await page.locator('#bag-panel button').first().click();
  await expect(page.locator('#bag-panel')).toBeHidden();
  await expect.poll(() => spike(page, (s) => s.link.room.spillAt ? [...s.link.room.spills.values()].some((b: any) => b.bag.mons?.length) : false)).toBe(true);

  await intoBattle(page);
  await expect(page.locator('.bm-cell').first()).toBeVisible();
  await expect(page.locator('.bm-act-run')).toBeVisible();
  await shot(page, 'phone-battle');
  // A POTION with nobody hurt: the party asks, nobody can take it, and BACK is the item again.
  await page.locator('.bm-act-bag').click();
  await page.locator('.bm-bag-list').click({ position: { x: 60, y: 24 } });
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await expect(page.locator('#battle-menu .bm-back')).toBeInViewport({ ratio: 1 });
  await shot(page, 'phone-use');
  await expect(page.locator('.bm-slot[aria-disabled="false"]')).toHaveCount(0);
  await page.locator('#battle-menu .bm-back').click();
  await expect(page.locator('.bm-bag-use')).toBeVisible();
  await page.locator('.bm-bag-back').click();
  await page.locator('#battle-menu .bm-back').click();
  await expect(page.locator('.bm-act-party')).toBeVisible();
  await page.locator('.bm-act-party').click();
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.locator('.bm-slot').nth(2).click();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(() => leadIndex(page), { timeout: 30_000 }).toBe(2);
  await ctx.close();
});
