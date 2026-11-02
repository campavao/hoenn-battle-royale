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
  await page.locator('.bm-act-party').click();
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.locator('.bm-slot').nth(2).click();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(() => leadIndex(page), { timeout: 30_000 }).toBe(2);
  await ctx.close();
});
