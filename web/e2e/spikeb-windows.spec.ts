// The windows Cam drew (11-01 sketches, 11-02 notes): the minimap and the name by the thing on the
// field, a dropped bag's windows, and a battle's moves first with PARTY, BAG and RUN, its party
// and one of them, by a thumb and by the keys alone.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

/** Into a match of the page's own with a team of six, a little way from anything. */
async function withTeam(page: Page, fog = 900): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=${fog}&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  // The chest: A on it, POKeMON if it asks, and a mon off the windows. Each once it is up, on a
  // machine of any speed: a key pressed on a timer found the wrong screen on CI, and no team.
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

  // The moves are up, with the focus on the first.
  await expect(page.locator('.bm-cell')).toHaveCount(4);
  await expect(page.locator('.bm-cell').first()).toHaveClass(/bm-focus/);
  await expect(page.locator('.bm-actions')).toBeVisible();
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
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('z');
  await expect(page.locator('.bm-member')).toBeVisible();
  await shot(page, 'desk-member');
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
  // Once the take is through: its party write, landing after ours on a slow runner, put the HP back
  // (CI 11-10, three tries out of three on a push run, never here).
  await expect.poll(() => spike(page, (s) => s.swapping || s.asking), { timeout: 30_000 }).toBe(false);
  await expect.poll(async () => {
    await spike(page, (s) => { const at = s.art.sym('gPlayerParty'); s.rom.emu.write(at + 2 * 100 + 86, 0, 16); s.rom.emu.write(at + 3 * 100 + 86, 1, 16); });
    await page.waitForTimeout(500);
    return [await hp(2), await hp(3)].join();
  }, { timeout: 20_000, intervals: [250] }).toBe('0,1');
  await intoBattle(page);
  expect(await hp(2), 'still fainted in the fight').toBe(0);

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
    // ...and nothing but TACKLE for the foe to answer with (struct BattlePokemon: 0x58, moves at 0xC).
    for (const m of [0x64, 0x66, 0x68, 0x6a]) emu.write(mons + m, 33, 16);
  });
  // A move each time the windows ask, and A through "Use next POKeMON?", until the party asks.
  const asked = () => page.locator('.bm-use-head').isVisible();
  for (let i = 0; i < 60 && !(await asked()); i++) { await page.keyboard.press('z', { delay: 120 }); await page.waitForTimeout(600); }
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
  // SUMMARY is a window over them, and comes back to them (spikeb-summary.spec.ts has the rest).
  await page.locator('.bm-m-btn').nth(1).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#gba')).toBeHidden();
  await shot(page, 'desk-field-summary');
  await page.keyboard.press('x', { delay: 150 });
  await expect(page.locator('.bm-member')).toBeVisible({ timeout: 20_000 });
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
  // The dock's own view of the field comes round on a timer.
  await page.waitForTimeout(700);
  await page.locator('#hud-bag').click();
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  await expect(page.locator('#battle-menu .bm-back')).toBeInViewport({ ratio: 1 });
  await shot(page, 'phone-field-bag');
  await page.locator('#battle-menu .bm-back').click();
  await expect(page.locator('.bm-bag-head')).toBeHidden();
  await ctx.close();
});

test('on a small phone every window a battle opens fits on the glass (Cam, 11-02, iPhone 13 mini)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 375, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  await intoBattle(page);
  const fits = async (what: string, selector: string) => {
    const off = await page.locator(selector).evaluateAll((all) => all.filter((b) => (b as HTMLElement).offsetParent !== null && b.getBoundingClientRect().bottom > innerHeight).length);
    expect(off, `${what}: nothing past the bottom of the glass`).toBe(0);
  };
  await fits('the moves', '#battle-menu button');
  await page.locator('.bm-act-party').click();
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.waitForTimeout(200);
  await fits('the party', '#battle-menu button');
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-member')).toBeVisible();
  await page.waitForTimeout(200);
  await shot(page, 'mini-member');
  // The band behind them is dimmed, and only that: the top of the glass isn't.
  const dim = await page.locator('#battle-menu').evaluate((el) => { const s = getComputedStyle(el, '::before'); return { content: s.content, bg: s.backgroundColor, top: el.getBoundingClientRect().top }; });
  expect(dim.content).not.toBe('none');
  expect(dim.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(dim.top, 'the picture still has the top of the glass').toBeGreaterThan(100);
  await fits('one of them', '#battle-menu button');
  await page.locator('.bm-m-btn').first().click();
  await page.locator('#battle-menu .bm-back').click();
  await page.locator('.bm-act-bag').click();
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  await page.waitForTimeout(200);
  await fits('the bag', '#battle-menu button');
  await ctx.close();
});

test('the MAP is the page\'s window: fog, a cursor, BACK, and no ROM screen (Cam, 11-02)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // A short first phase: the ring is in by the time there is a team to see the MAP with.
  await withTeam(page, 40);
  await expect.poll(() => spike(page, (s) => s.link.room.ring().r), { timeout: 60_000 }).toBeLessThan(1000);
  await page.locator('.hud-mini').click();
  await expect(page.locator('#map-window .map-picture')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#gba'), 'not the ROM').toBeHidden();
  await page.waitForTimeout(600);
  await shot(page, 'phone-map');
  // The fog on the picture is the fog the room says is there: the purple pixels against what
  // RingMap.fogAt asks of each pixel of the grid, as much of it as a sea or a mark doesn't hide.
  const fog = () => page.evaluate(() => {
    const s = (window as any).__spike, c = document.querySelector('#map-window .map-picture') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let purple = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i + 1] + 30 && d[i] > d[i + 1]) purple++;
    let told = 0;
    for (let y = 16; y < 136; y++) for (let x = 8; x < 232; x++) if (s.ringMap.fogAt(x, y)) told++;
    return { purple, told, scale: (c.width / 240) ** 2 };
  });
  await expect.poll(async () => (await fog()).told, { timeout: 30_000, message: 'the ring has reached the map' }).toBeGreaterThan(50);
  const seen = await fog();
  expect(seen.purple, `fog on the map: ${JSON.stringify(seen)}`).toBeGreaterThan(seen.told * seen.scale * 0.5);
  await expect(page.locator('#map-window .map-btn').first()).toBeInViewport({ ratio: 1 });
  await page.locator('#map-window [aria-label="BACK"]').click();
  await expect(page.locator('#map-window')).toBeHidden();
  await ctx.close();
});

for (const [how, size] of [['upright', { width: 375, height: 812 }], ['on its side', { width: 712, height: 327 }]] as const) {
  test(`a phone ${how}: every window is on the glass, and the MAP has all of it (Cam, 11-04)`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await withTeam(page);
    const onGlass = async (sel: string, what: string) => {
      const boxes = await page.locator(sel).evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
      expect(boxes.length, what).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.top, `${what}: its top`).toBeGreaterThanOrEqual(0);
        expect(b.left, `${what}: its left`).toBeGreaterThanOrEqual(0);
        expect(b.bottom, `${what}: its bottom`).toBeLessThanOrEqual(size.height);
        expect(b.right, `${what}: its right`).toBeLessThanOrEqual(size.width);
      }
    };
    await spike(page, (s) => s.runMenu('13'));
    await expect(page.locator('#map-window .map-picture')).toBeVisible({ timeout: 5000 });
    const map = (await page.locator('#map-window .map-picture').boundingBox())!;
    if (size.width < size.height) expect(map.width, 'the MAP, as wide as the phone').toBeGreaterThan(size.width - 16);
    else expect(map.height, 'the MAP, as tall as the phone').toBeGreaterThan(size.height - 16);
    await onGlass('#map-window canvas', 'the MAP');
    await page.locator('#map-window [aria-label="BACK"]').click();
    await page.waitForTimeout(800);
    await page.locator('#hud-party').click();
    await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await onGlass('.bm-slot, .bm-back', 'the party');
    await page.locator('.bm-slot').first().click();
    await page.waitForTimeout(300);
    await onGlass('.bm-m-card, .bm-m-moves, .bm-m-btn', 'one of them');
    await page.locator('.bm-m-btn[aria-label="SUMMARY"]').click();
    await expect(page.locator('#summary')).toBeVisible();
    await page.waitForTimeout(300);
    await onGlass('#summary canvas', 'SUMMARY');
    await page.locator('.sum-back').click();
    await page.waitForTimeout(300);
    await page.locator('.bm-m-btn[aria-label="BACK"]').click();
    await page.locator('.bm-back:visible').click();
    await page.waitForTimeout(800);
    await page.locator('#hud-bag').click();
    await page.waitForTimeout(500);
    await onGlass('.bm-bag-head, .bm-bag-list, .bm-back', 'the BAG');
    await page.locator('.bm-back:visible').click();
    await page.waitForTimeout(800);
    await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0002, name: 'DRAKE', bag: { items: [{ id: 13, n: 3 }], money: 300, mons: [{ species: 373, level: 30 }] } }));
    await expect(page.locator('#bag-panel button').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await onGlass('#bag-panel canvas', 'a dropped bag');
    await ctx.close();
  });
}

test('the drop and FLY are the MAP window: pick a place, learn it, fly to a town (Cam, 11-02)', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  // The first ring's length is the Safari's too, so the Zone ends soon after there is a team.
  await withTeam(page, 60);
  const place = () => spike(page, (s) => { const p = s.link.room.actor(s.link.me).m.spot; return `${p.map}:${p.x}:${p.y}`; }) as Promise<string>;
  // In the Zone the MAP only looks: its gate is shut, FLY or no.
  await spike(page, (s) => s.runMenu('13'));
  await expect(page.locator('#map-window .map-picture')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#map-window [aria-label="FLY"]')).toHaveCount(0);
  await page.keyboard.press('x', { delay: 100 });
  await expect(page.locator('#map-window')).toBeHidden();
  // withTeam took me to the chest: back in the Zone for the buzzer, which only calls those in it.
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me), spot = { map: 'MAP_SAFARI_ZONE_SOUTH', x: 23, y: 30 }; a.m = { ...a.m, spot, prev: spot, action: null, px: 0, py: 0 }; });
  // The buzzer: "Drop where?", no way back, the cursor by the keys, and A.
  await expect(page.locator('#map-window [aria-label="DROP"]')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#map-window [aria-label="BACK"]')).toHaveCount(0);
  await expect(page.locator('#map-window [aria-label="DROP"]'), 'the cursor starts on the Zone, not the corner').not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#gba'), 'not the ROM').toBeHidden();
  await page.waitForTimeout(400);
  await shot(page, 'desktop-map-drop');
  const was = await spike(page, (s) => s.mapWindow.cursor) as { x: number; y: number };
  await page.keyboard.press('ArrowRight', { delay: 100 });
  await expect.poll(() => spike(page, (s) => s.mapWindow.cursor.x)).toBe(was.x + 1);
  await page.keyboard.press('ArrowLeft', { delay: 100 });
  await expect.poll(() => spike(page, (s) => s.mapWindow.cursor.x)).toBe(was.x);
  await page.keyboard.press('z', { delay: 100 });
  await expect(page.locator('#map-window')).toBeHidden();
  await expect.poll(place, { timeout: 30_000, message: 'out of the Safari' }).not.toMatch(/^MAP_SAFARI/);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 15_000 }).toBe(false);
  // HM02 on the first of them, then the MAP has somebody to FLY with.
  await spike(page, (s) => s.give(340));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-pick-move').nth(1)).toBeVisible({ timeout: 20_000 });
  await page.locator('.bm-pick-move').nth(1).click();
  await expect.poll(() => spike(page, (s) => s.swapping || s.battleMenu.isShown), { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(800);
  await spike(page, (s) => s.runMenu('13'));
  await expect(page.locator('#map-window [aria-label="FLY"]')).toBeVisible({ timeout: 5_000 });
  await shot(page, 'desktop-map-fly');
  // A press on OLDALE's cell, then the button.
  const oldale = await spike(page, (s) => s.ringMap.cellOf({ map: 'MAP_OLDALE_TOWN', x: 5, y: 5 })) as { x: number; y: number };
  const at = (await page.locator('#map-window .map-picture').boundingBox())!;
  await page.mouse.click(at.x + ((8 * oldale.x + 12) * at.width) / 240, at.y + ((8 * oldale.y + 20) * at.height) / 160);
  await expect.poll(() => spike(page, (s) => s.mapWindow.cursor)).toEqual(oldale);
  await page.locator('#map-window [aria-label="FLY"]').click();
  await expect(page.locator('#map-window')).toBeHidden();
  await expect.poll(place, { timeout: 5_000 }).toBe('MAP_OLDALE_TOWN:6:17');
  await ctx.close();
});

test('a full party trades a dropped POKeMON one for one, on the windows', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  const team = () => spike(page, (s) => s.battleMenu.deps.firstMoves.readParty().map((m: any) => m.species)) as Promise<number[]>;
  const before = await team();
  expect(before.length).toBe(6);
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0005, name: 'DRAKE', bag: { items: [], money: 0, mons: [{ species: 25, level: 30 }] } }));
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await shot(page, 'phone-drop');
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  await expect(page.locator('.bm-slot').nth(5)).toBeVisible();
  await shot(page, 'phone-drop-swap');
  await page.locator('.bm-slot').nth(2).click();
  await expect.poll(team, { timeout: 20_000 }).toContain(25);
  expect((await team()).length).toBe(6);
  // Theirs went on the end; ours is in the bag now, and it is the windows' to take back.
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('#battle-menu .bm-back').click();
  await expect.poll(() => spike(page, (s) => s.swapping)).toBe(false);
  await ctx.close();
});

test('a TM off the ground and a trader ask on the windows', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  const team = () => spike(page, (s) => s.battleMenu.deps.firstMoves.readParty()) as Promise<{ species: number; moves: { id: number }[] }[]>;
  // TM46 THIEF: SHARPEDO can learn it, and knows four moves, so the ROM's own forget screen shows.
  await spike(page, (s) => s.give(334));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.bm-slot').first()).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#gba')).toBeHidden();
  await shot(page, 'phone-tm');
  await page.locator('.bm-slot').first().click();
  // Four known: which goes is the windows' too, and the ROM's screen never shows.
  await expect(page.locator('.bm-forget-head')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.bm-pick-move')).toHaveCount(4);
  await expect(page.locator('#gba')).toBeHidden();
  await shot(page, 'phone-tm-forget');
  // Forgetting nothing: BACK, and it is not learned.
  await page.locator('#battle-menu .bm-back').click();
  await expect(page.locator('.bm-forget-head')).toBeHidden();
  await expect.poll(() => spike(page, (s) => s.swapping || s.battleMenu.isShown), { timeout: 20_000 }).toBe(false);
  expect((await team())[0].moves.map((m) => m.id)).not.toContain(168);
  // Again, and BITE goes for it.
  await spike(page, (s) => s.give(334));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-pick-move').nth(1)).toBeVisible({ timeout: 20_000 });
  await page.locator('.bm-pick-move').nth(1).click();
  await expect.poll(async () => (await team())[0].moves.map((m) => m.id), { timeout: 20_000, message: 'THIEF for BITE' }).toContain(168);
  expect((await team())[0].moves.map((m) => m.id)).not.toContain(44);
  await expect(page.locator('#gba')).toBeHidden();

  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 20_000 }).toBe(false);
  await spike(page, (s) => s.startFor({ type: 'trade', tick: 0, n: 0, species: 25 }));
  await expect.poll(() => spike(page, (s) => s.asking), { timeout: 10_000 }).toBe(true);
  await key(page, 'z', true); await page.waitForTimeout(150); await key(page, 'z', false);
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  await shot(page, 'phone-trade');
  await page.locator('.bm-slot').nth(2).click();
  await expect.poll(async () => (await team()).some((m) => m.species === 25), { timeout: 30_000, message: 'traded' }).toBe(true);

  // Somebody's gift, with a full party: theirs, then which of ours for it, on the windows.
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 20_000 }).toBe(false);
  await spike(page, (s) => s.startFor({ type: 'trade', tick: 0, n: 0, species: 280, gives: true }));
  await expect.poll(() => spike(page, (s) => s.asking), { timeout: 10_000 }).toBe(true);
  await key(page, 'z', true); await page.waitForTimeout(150); await key(page, 'z', false);
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#gba')).toBeHidden();
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-slot').nth(5)).toBeVisible();
  await page.locator('.bm-slot').nth(1).click();
  await expect.poll(async () => (await team()).some((m) => m.species === 280), { timeout: 30_000, message: 'gift taken' }).toBe(true);
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

test('taking a ball off the ground says nothing, and a buried one its name (POK-440)', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as any).msgSeen = seen;
    new MutationObserver(() => seen.push(document.getElementById('msg')!.getAttribute('data-text') ?? '')).observe(document.getElementById('msg')!, { attributes: true, attributeFilter: ['data-text'] });
  });
  const seen = () => page.evaluate(() => (window as any).msgSeen as string[]);
  // Off the ground: its tag named it, and the jingle says it was taken.
  const ball = await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const g = [...room.ground().values()].find((g: any) => !g.gift && g.item < 100 && /^MAP_ROUTE1/.test(g.map) && s.placed.get(g.map) && room.stepFor(a)({ map: g.map, x: g.x, y: g.y + 1 }, 3)) as any;
    const spot = { map: g.map, x: g.x, y: g.y + 1 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    return g.key as number;
  });
  await page.waitForTimeout(800);
  await page.keyboard.press('z', { delay: 150 });
  await expect.poll(() => page.evaluate((k) => (window as any).__spike.link.room.ground().has(k), ball), { timeout: 10_000, message: 'it was taken' }).toBe(false);
  await page.waitForTimeout(1500);
  expect((await seen()).filter((t) => /Found/.test(t))).toEqual([]);
  // Dug up, nothing named it first.
  const hidden = JSON.parse(readFileSync('spike-b/data/hidden.json', 'utf8')) as [string, number, number, number][];
  const [map, x, y, item] = hidden.find(([m, , , i]) => /^MAP_ROUTE1/.test(m) && i < 100)!;
  const named = await page.evaluate(([map, x, y, item]) => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    const spot = { map, x, y: (y as number) + 1 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    return s.art.itemName(item) as string;
  }, [map, x, y, item] as const);
  await page.waitForTimeout(800);
  await page.keyboard.press('z', { delay: 150 });
  await expect.poll(seen, { timeout: 10_000 }).toContain(`${named} went in the BAG.`);
  expect((await seen()).filter((t) => /Found/.test(t))).toEqual([]);
  await ctx.close();
});

test('any mon takes any machine, off the ground and from the BAG (Cam 10-17: only who knows it is greyed)', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  const team = () => spike(page, (s) => s.battleMenu.deps.firstMoves.readParty()) as Promise<{ moves: { id: number }[] }[]>;
  const shut = () => page.locator('.bm-slot').evaluateAll((all) => all.map((b) => b.getAttribute('aria-disabled') === 'true'));
  // TM22 SOLARBEAM: vanilla's table says no to SHARPEDO. The ROM says yes (CanMonLearnTMHM).
  await spike(page, (s) => s.give(310));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.bm-slot')).toHaveCount(6);
  expect(await shut(), 'nobody greyed').toEqual(Array(6).fill(false));
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-pick-move').nth(1)).toBeVisible({ timeout: 20_000 });
  await page.locator('.bm-pick-move').nth(1).click();
  await expect.poll(async () => (await team())[0].moves.map((m) => m.id), { timeout: 20_000, message: 'SOLARBEAM learned' }).toContain(76);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 20_000 }).toBe(false);
  // Again: now the first knows it, and only the first is greyed. BACK keeps it in the bag.
  await spike(page, (s) => s.give(310));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  expect(await shut()).toEqual([true, false, false, false, false, false]);
  await page.locator('#battle-menu .bm-back').click();
  await expect.poll(() => spike(page, (s) => s.swapping || s.battleMenu.isShown), { timeout: 20_000 }).toBe(false);
  // The same from the BAG.
  await page.waitForTimeout(700);
  await page.locator('#hud-bag').click();
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  const row = () => spike(page, (s) => s.battleMenu.stacks().findIndex((x: any) => x.item === 310)) as Promise<number>;
  for (let i = 0; i < 4 && (await row()) < 0; i++) { await page.getByLabel('Next pocket').click(); await page.waitForTimeout(200); }
  expect(await row(), 'TM22 in its pocket').toBeGreaterThanOrEqual(0);
  for (let i = await row(); i > 0; i--) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-use-head')).toBeVisible();
  expect(await shut()).toEqual([true, false, false, false, false, false]);
  await ctx.close();
});

// Cam 11-02: the TMs & HMs pocket named a machine "TM22", and the learn window said nothing of
// the move it asked about. A machine is its move; and the forget window shows the type and the
// power of the new move and of each of the four it could replace.
test('a machine is named by its move, and the forget window shows type and power', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  const snap = (name: string) => page.screenshot({ path: `${process.env.HBR_SHOTS ?? test.info().outputDir}/${name}.png` });
  // TM22 SOLARBEAM (310): SHARPEDO knows four moves, so which goes is asked on the windows.
  await spike(page, (s) => s.give(310));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-forget-head')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.bm-pick-move')).toHaveCount(4);
  await page.waitForTimeout(500);
  await snap('forget');
  await expect.soft(page.locator('.bm-forget-head')).toHaveAttribute('aria-label', /SOLARBEAM, GRASS, POWER 120/);
  const labels = await page.locator('.bm-pick-move').evaluateAll((all) => all.map((b) => b.getAttribute('aria-label') ?? ''));
  expect(labels.length).toBe(4);
  for (const l of labels) expect.soft(l, 'a move, its type and its power').toMatch(/^.+, [A-Z]+, POWER (\d+|---), PP \d+\/\d+$/);
  await page.locator('#battle-menu .bm-back').click();
  await expect.poll(() => spike(page, (s) => s.swapping || s.battleMenu.isShown), { timeout: 20_000 }).toBe(false);
  // The same machine in the BAG's pocket: its move, not TM22.
  await page.waitForTimeout(700);
  await page.locator('#hud-bag').click();
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  const row = () => spike(page, (s) => s.battleMenu.stacks().findIndex((x: any) => x.item === 310)) as Promise<number>;
  for (let i = 0; i < 4 && (await row()) < 0; i++) { await page.getByLabel('Next pocket').click(); await page.waitForTimeout(200); }
  expect(await row(), 'TM22 in its pocket').toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(300);
  await snap('pocket');
  for (let i = await row(); i > 0; i--) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await expect.soft(page.locator('.bm-bag-use')).toHaveAttribute('aria-label', 'Use SOLARBEAM', { timeout: 3000 });
  await snap('pocket-item');
  await ctx.close();
});

// Cam 11-02, on a controller: the dock and the legend said Q and E. A pad's last press makes
// them its own names (LB and RB on an Xbox pad); a key of the keyboard brings Q and E back.
test('the key hints are the pad\'s once a pad is what was last used, and the keyboard\'s after a key', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const snap = (name: string) => page.screenshot({ path: `${process.env.HBR_SHOTS ?? test.info().outputDir}/${name}.png` });
  await withTeam(page);
  const padLast = () => page.evaluate(async () => (await import(/* @vite-ignore */ '/src/ui/hints.ts')).padIsLast());
  // A standard Xbox pad the page polls: `__held` is the buttons down.
  await page.evaluate(() => {
    const w = window as any;
    w.__held = [] as number[];
    const buttons = () => Array.from({ length: 17 }, (_, i) => ({ pressed: w.__held.includes(i), value: w.__held.includes(i) ? 1 : 0 }));
    navigator.getGamepads = () => [{ id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: buttons() }] as any;
  });
  const tapPad = async (i: number) => { await page.evaluate((n) => ((window as any).__held = [n]), i); await page.waitForTimeout(120); await page.evaluate(() => ((window as any).__held = [])); await page.waitForTimeout(80); };
  expect(await padLast(), 'the keyboard to start').toBe(false);
  await expect(page.locator('#hud-party')).toBeVisible();
  await expect(page.locator('#keys')).toBeVisible();
  await snap('dock-keyboard');
  await tapPad(14);
  expect(await padLast(), 'a pad press').toBe(true);
  await page.waitForTimeout(300);
  await snap('dock-pad');
  // The field's keyboard legend (W A S D, Z A...) goes with the keyboard.
  await expect(page.locator('#keys')).toBeHidden();
  await key(page, 'ArrowLeft', true); await page.waitForTimeout(90); await key(page, 'ArrowLeft', false);
  expect(await padLast(), 'a key of the keyboard').toBe(false);
  await expect(page.locator('#keys')).toBeVisible();
  await intoBattle(page);
  await snap('battle-keyboard');
  await tapPad(14);
  expect(await padLast()).toBe(true);
  await page.waitForTimeout(300);
  await snap('battle-pad');
  await ctx.close();
});

/** A wild one caught with a MASTER BALL and six in the party, up to the window. Watching from the
 *  start for any frame of the ROM's own: its field and "Your party is full." (Cam, 11-02). */
async function catchWithFullParty(page: Page): Promise<void> {
  await spike(page, (s) => s.rom.give(1, 5));
  await intoBattle(page);
  await page.evaluate(() => {
    const s = (window as any).__spike, e = s.rom.emu, y = (n: string) => s.art.sym(n);
    const el = document.getElementById('battle')!, fight = y('BattleMainCB2');
    const w = window as any;
    w.romSeen = 0;
    const look = () => {
      if (e.read(y('gBrCatch'), 8) && ((e.read(y('gMain') + 4, 32) ^ fight) & ~1) !== 0 && el.classList.contains('on') && !el.classList.contains('panel')) w.romSeen++;
      requestAnimationFrame(look);
    };
    look();
  });
  await page.locator('.bm-act-bag').click();
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  // The keys on a phone too: their first press only shows the focus.
  await spike(page, (s) => { s.battleMenu.showFocus = true; });
  await page.keyboard.press('ArrowRight');
  const row = await spike(page, (s) => s.battleMenu.stacks().findIndex((x: any) => x.item === 1));
  expect(row, 'the MASTER BALL in its pocket').toBeGreaterThanOrEqual(0);
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-catch')).toBeVisible({ timeout: 60_000 });
}
const partyNow = (page: Page) => spike(page, (s) => s.battleMenu.deps.firstMoves.readParty().map((m: any) => m.species)) as Promise<number[]>;
const newCatch = (page: Page) => spike(page, (s) => s.battleMenu.releasing.species) as Promise<number>;
const spillsOf = (page: Page, species: number) => page.evaluate((sp) => [...(window as any).__spike.link.room.spills.values()].filter((b: any) => b.bag.mons.some((m: any) => m.species === sp)).length, species);

test('a catch with a full party asks on the windows: SUMMARY held, one let go for it, and the ROM unseen', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  const before = await partyNow(page);
  expect(before.length).toBe(6);
  const was = await spillsOf(page, before[2]);
  await catchWithFullParty(page);
  const caught = await newCatch(page);
  await expect(page.locator('.bm-slot:visible')).toHaveCount(6);
  await expect(page.locator('#gba'), 'no ROM screen for it').toBeHidden();
  await page.waitForTimeout(600);
  await shot(page, 'phone-full-party');
  const box = (await page.locator('#battle-menu').boundingBox())!;
  expect(box.y + box.height, 'all of it on the glass').toBeLessThanOrEqual(844);
  // A phone on its side: smaller, the question and the new one still on the glass.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await page.locator('.bm-catch-head').boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => { const b = (await page.locator('.bm-back').boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await page.locator('.bm-catch').boundingBox())!.width).toBeGreaterThan(300);

  // Held, whichever it is: its SUMMARY, the new one first and the party after it.
  const hold = async (sel: ReturnType<Page['locator']>) => {
    const b = (await sel.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const at = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at });
    await page.waitForTimeout(700);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // eatLiftClick lingers 80 ms past the lift for the click it makes: quicker than any thumb.
    await page.waitForTimeout(200);
  };
  await hold(page.locator('.bm-slot').nth(1));
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#summary')).toHaveAttribute('data-at', '2');
  await shot(page, 'phone-full-party-summary');
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  await expect.poll(() => spike(page, (s) => s.battleMenu.isShown), { message: 'nobody let go by the hold' }).toBe(true);
  await hold(page.locator('.bm-catch'));
  await expect(page.locator('#summary')).toHaveAttribute('data-at', '0');
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();

  // The third goes: the catch in its slot, the rest as they were, and it on the ground.
  await page.locator('.bm-slot').nth(2).click();
  await expect.poll(() => spike(page, (s) => !!s.battle), { timeout: 20_000 }).toBe(false);
  expect(await partyNow(page)).toEqual(before.map((sp, i) => (i === 2 ? caught : sp)));
  await expect.poll(() => spillsOf(page, before[2]), { message: 'the one let go, on the ground for anybody' }).toBe(was + 1);
  expect(await page.evaluate(() => (window as any).romSeen), 'frames of the ROM\'s own screen').toBe(0);
  await shot(page, 'phone-full-party-done');
  await ctx.close();
});

test('a catch with a full party on the keys: B only reaches KEEP PARTY, A says it, and nothing changes but the catch gone', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await ctx.newPage();
  await withTeam(page);
  const before = await partyNow(page);
  const was = await spillsOf(page, before[0]);
  await catchWithFullParty(page);
  const caught = await newCatch(page);
  const wasCaught = await spillsOf(page, caught);
  await expect(page.locator('#gba'), 'no ROM screen for it').toBeHidden();
  await page.waitForTimeout(600);
  await shot(page, 'desk-full-party');
  const box = (await page.locator('#battle-menu').boundingBox())!;
  expect(box.y + box.height, 'all of it on the window').toBeLessThanOrEqual(640);

  // A held on one of the party is its SUMMARY, not its release.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.bm-slot.bm-focus')).toHaveCount(1);
  await page.keyboard.down('z');
  await expect(page.locator('#summary')).toBeVisible();
  await page.keyboard.up('z');
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  // B on its own lets nothing go.
  await page.keyboard.press('x');
  await expect(page.locator('#battle-menu .bm-back')).toHaveClass(/bm-focus/);
  await page.waitForTimeout(500);
  expect(await spike(page, (s) => !!s.battle), 'still asking').toBe(true);
  await page.keyboard.press('z');
  await expect.poll(() => spike(page, (s) => !!s.battle), { timeout: 20_000 }).toBe(false);
  expect(await partyNow(page), 'the party as it was').toEqual(before);
  await page.waitForTimeout(1000);
  expect(await spillsOf(page, before[0]), 'nobody on the ground').toBe(was);
  expect(await spillsOf(page, caught), 'nor the catch').toBe(wasCaught);
  expect(await page.evaluate(() => (window as any).romSeen), 'frames of the ROM\'s own screen').toBe(0);
  await ctx.close();
});
