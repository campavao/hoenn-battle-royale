// The key items on a dial: a pad's right trigger held (Cam, 11-02), C on a keyboard, the round button
// held by a finger or a mouse. And that round button on a desktop, where it was hidden (Cam, 11-02,
// 10:31: "we don't see the quick action button"), and a bike or a rod USEd off the BAG, which did
// nothing to see (6:27: "Acro bike use. Is it doing anything?").
import { expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const shot = (page: Page, name: string) => page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/${name}.png` : test.info().outputPath(`${name}.png`) });

const DESK = { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const fakePad = () => {
  (window as any).__pad = { buttons: new Array(17).fill(false), axes: [0, 0, 0, 0] };
  navigator.getGamepads = (() => [{ id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)', index: 0, connected: true, mapping: 'standard', axes: (window as any).__pad.axes, buttons: (window as any).__pad.buttons.map((pressed: boolean) => ({ pressed, value: pressed ? 1 : 0 })) }]) as any;
};
const padButton = (page: Page, i: number, on: boolean) => page.evaluate(([i, on]) => { (window as any).__pad.buttons[i as number] = on; }, [i, on] as const);
const padAxes = (page: Page, axes: number[]) => page.evaluate((axes) => { (window as any).__pad.axes = axes; }, axes);

/** Out on a route in a match of the page's own, on foot, with a team. */
async function onRoute(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0001, name: 'MAY', bag: { items: [], money: 0, mons: [{ species: 277, level: 30 }] } }));
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000 }).toBe(false);
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    // Past the Safari, whose rules keep the bike and the MAP shut, without its minute to wait.
    const ring = room.ring.bind(room);
    room.ring = () => ({ ...ring(), safari: false });
    // Somewhere to stand with dry land ahead: facing water, SELECT is the rod.
    const q = room.patchesOn('MAP_ROUTE117').find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map: 'MAP_ROUTE117', x: q.x - 1, y: q.y }, 4) && room.world.cell('MAP_ROUTE117', q.x - 1, q.y - 1) !== 2);
    const spot = { map: 'MAP_ROUTE117', x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
  });
  await page.waitForTimeout(1500);
}

const riding = (page: Page) => spike(page, (s) => s.link.room.actor(s.link.me).m.bike);

test('a desktop has the round button, and SHIFT named on it; it gets on the bike', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await onRoute(page);
  const round = page.locator('#hud-ctx');
  await expect(round, 'the quick action on a desktop').toBeVisible();
  const box = (await round.boundingBox())!;
  const bag = (await page.locator('#hud-bag').boundingBox())!;
  expect(box.x, 'beside the BAG').toBeGreaterThanOrEqual(bag.x + bag.width);
  await shot(page, 'desk-field-round');
  expect(await riding(page)).toBe(false);
  await expect(round, 'not lit on foot').not.toHaveClass(/hud-on/);
  // Over it, a word that it has a dial behind it, for a while, and not once the dial's been used.
  const tip = page.locator('#dial-tip');
  await expect(tip).toBeVisible();
  const over = (await tip.boundingBox())!;
  expect(over.y + over.height, 'over the button').toBeLessThanOrEqual(box.y + 1);
  await shot(page, 'desk-dial-tip');
  await round.click();
  await expect.poll(() => riding(page)).toBe(true);
  await expect(round, 'lit while it is in use (Cam, 11-04)').toHaveClass(/hud-on/);
  await shot(page, 'desk-round-lit');
  await page.waitForTimeout(600);
  await round.click();
  await expect.poll(() => riding(page)).toBe(false);
  await expect(round).not.toHaveClass(/hud-on/);
  await ctx.close();
});

test('C held: the dial, the arrows lean, and letting go uses it', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await onRoute(page);
  await page.keyboard.down('c');
  await expect(page.locator('#radial')).toBeVisible();
  await expect(page.locator('#dial-tip'), 'it knows now').toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.rad-up canvas')!).imageRendering), 'crisp at any scale').toBe('pixelated');
  // Standing still on it: nobody walks for the arrows.
  const at = await spike(page, (s) => s.link.room.actor(s.link.me).m.spot.x);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#radial')).toHaveAttribute('data-on', 'up');
  await page.waitForTimeout(300);
  await shot(page, 'desk-radial');
  expect(await spike(page, (s) => s.link.room.actor(s.link.me).m.spot.x)).toBe(at);
  await page.keyboard.up('c');
  await expect(page.locator('#radial')).toBeHidden();
  await expect.poll(() => riding(page), { message: 'BIKE, used' }).toBe(true);

  // WALK now on the same side, and let go leaning on nothing: nothing.
  await page.waitForTimeout(800);
  await page.keyboard.down('c');
  await expect(page.locator('.rad-up')).toHaveAttribute('aria-label', 'WALK');
  await page.keyboard.up('c');
  await page.waitForTimeout(300);
  expect(await riding(page)).toBe(true);

  // A rod not facing water says why, and letting go on it does nothing.
  await page.keyboard.down('c');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.rad-right')).toHaveAttribute('aria-disabled', 'true');
  await page.waitForTimeout(100);
  await shot(page, 'desk-radial-why');
  await page.keyboard.up('c');
  await expect(page.locator('#radial')).toBeHidden();

  // MAP.
  await page.waitForTimeout(300);
  await page.keyboard.down('c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('c');
  await expect(page.locator('#map-window')).toBeVisible({ timeout: 10_000 });
  await ctx.close();
});

test('facing water, the dial casts the rod, and the round button shows it', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await onRoute(page);
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me), map = 'MAP_ROUTE117';
    for (let y = 2; y < 30; y++) for (let x = 2; x < 60; x++) {
      if (room.world.cell(map, x, y - 1) === 2 && room.world.cell(map, x, y) !== 2 && room.stepFor(a)({ map, x, y }, 1)) {
        const spot = { map, x, y };
        a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
        return;
      }
    }
  });
  await page.waitForTimeout(600);
  await page.keyboard.down('c');
  await expect(page.locator('.rad-right')).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#radial')).toHaveAttribute('data-on', 'right');
  await page.keyboard.up('c');
  await expect.poll(() => spike(page, (s) => s.link.room.actor(s.link.me).battling), { message: 'the rod out' }).toBe(true);
  await ctx.close();
});

test("a pad's right trigger: held, a stick leans, let go; the dial stays out of a battle", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(DESK);
  await ctx.addInitScript(fakePad);
  const page = await ctx.newPage();
  await onRoute(page);
  await padButton(page, 7, true);
  await expect(page.locator('#radial')).toBeVisible();
  // The right stick up: BIKE.
  await padAxes(page, [0, 0, 0, -1]);
  await expect(page.locator('#radial')).toHaveAttribute('data-on', 'up');
  await padButton(page, 7, false);
  await padAxes(page, [0, 0, 0, 0]);
  await expect(page.locator('#radial')).toBeHidden();
  await expect.poll(() => riding(page)).toBe(true);
  await page.waitForTimeout(600);
  // The D-pad leans too, and B thinks better of it.
  await padButton(page, 7, true);
  await expect(page.locator('#radial')).toBeVisible();
  await padButton(page, 12, true);
  await expect(page.locator('#radial')).toHaveAttribute('data-on', 'up');
  await padButton(page, 12, false);
  await padButton(page, 1, true);
  await expect(page.locator('#radial')).toBeHidden();
  await padButton(page, 1, false);
  await padButton(page, 7, false);
  await page.waitForTimeout(200);
  expect(await riding(page), 'B: nothing used').toBe(true);
  await ctx.close();
});

test('USE on a bike off the BAG gets on it; the ITEMFINDER off the BAG answers', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await onRoute(page);
  const use = async (item: number) => {
    await page.keyboard.press('e');
    await expect(page.locator('.bm-bag-head')).toBeVisible();
    // The key items' pocket.
    for (let i = 0; i < 8 && !(await spike(page, new Function('s', `return s.battleMenu.stacks().some((x) => x.item === ${item})`) as (s: any) => boolean)); i++) await page.keyboard.press('ArrowRight');
    const row = await spike(page, new Function('s', `return s.battleMenu.stacks().findIndex((x) => x.item === ${item})`) as (s: any) => number);
    expect(row, `item ${item} in the BAG`).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('z');
    await page.locator('.bm-bag-use').click();
  };
  await use(272); // the ACRO BIKE
  await expect(page.locator('.bm-bag-head')).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => riding(page), { message: 'on the bike' }).toBe(true);
  await page.waitForTimeout(800);
  await use(261); // the ITEMFINDER
  await expect(page.locator('#msg')).toHaveAttribute('data-text', /ITEMFINDER|no response/, { timeout: 5000 });
  await ctx.close();
});

test('by a thumb: the round button held opens the dial, a slide and a lift uses it, and a tap is still SELECT', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await onRoute(page);
  const b = (await page.locator('#hud-ctx').boundingBox())!;
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await expect(page.locator('#radial')).toBeVisible({ timeout: 2000 });
  await page.waitForTimeout(200);
  await shot(page, 'phone-radial');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x, y: at.y - 80 }] });
  await expect(page.locator('#radial')).toHaveAttribute('data-on', 'up');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#radial')).toBeHidden();
  await expect.poll(() => riding(page)).toBe(true);
  await page.waitForTimeout(800);
  await page.locator('#hud-ctx').tap();
  await expect.poll(() => riding(page), { message: 'a tap: off again' }).toBe(false);
  // Held and lifted without a slide, it waits for a tap.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await expect(page.locator('#radial')).toBeVisible({ timeout: 2000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  await expect(page.locator('#radial')).toBeVisible();
  await page.locator('.rad-up').tap();
  await expect(page.locator('#radial')).toBeHidden();
  await expect.poll(() => riding(page)).toBe(true);
  await ctx.close();
});
