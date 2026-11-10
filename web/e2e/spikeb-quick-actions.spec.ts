// Cam, 11-10: "We should only show the fog ring on the map as the fog is actively closing in. It
// shouldn't show on initial drop"; "quick wheel should show both mach and acro bikes"; "there should
// be a quick action in a wild battle to throw a royale ball".
import { expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const shot = (page: Page, name: string) => page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/${name}.png` : test.info().outputPath(`${name}.png`) });

const DESK = { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ITEM_MACH_BIKE = 259, ITEM_ACRO_BIKE = 272;

async function intoMatch(page: Page, hash: string): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}${hash}`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(3000);
}
/** On Route 117 on foot, past the Safari's rules, with dry land ahead. */
async function onRoute(page: Page): Promise<void> {
  // A POKeMON first: past the Safari, a trainer who caught nothing is out.
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0001, name: 'MAY', bag: { items: [], money: 0, mons: [{ species: 277, level: 30 }] } }));
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000 }).toBe(false);
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const ring = room.ring.bind(room);
    room.ring = (t?: number) => ({ ...ring(t), safari: false });
    const q = room.patchesOn('MAP_ROUTE117').find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map: 'MAP_ROUTE117', x: q.x - 1, y: q.y }, 4) && room.world.cell('MAP_ROUTE117', q.x - 1, q.y - 1) !== 2);
    const spot = { map: 'MAP_ROUTE117', x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
  });
  await page.waitForTimeout(1500);
}
const balls = (page: Page) => spike(page, (s) => (s.pocket(1) as { item: number; n: number }[]).filter((x) => x.item === 4).reduce((n, x) => n + x.n, 0));

test('the MAP draws the next ring only while the fog closes in', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await intoMatch(page, '#solo&nobots&safari=0&fog=900&seed=7');
  await onRoute(page);
  const next = () => spike(page, (s) => s.mapWindow?.deps.fogKey().next ?? null);
  const open = async () => {
    // Asked again until it comes: the drop's landing holds the menus a moment.
    await expect.poll(async () => {
      if (await spike(page, (s) => !!s.mapWindow && !s.mapWindow.el?.hidden)) return true;
      await spike(page, (s) => void s.runMenu('13'));
      return false;
    }, { timeout: 40_000, intervals: [1500] }).toBe(true);
  };
  // Past the Safari, the drop: the first ring a phase away, holding.
  // The ring as a match's goes (room.ts ring), without its clock: the Safari's end would put a
  // trainer who caught nothing out. On the drop it holds at no fog, the first ring a phase away;
  // over a phase's end it falls toward the next.
  const shiftTo = (to: 'drop' | 'closing') => page.evaluate((to) => {
    const room = (window as any).__spike.link.room, was = room.__ring ?? room.ring.bind(room);
    room.__ring = was;
    const t0 = room.tick;
    room.ring = (t?: number) => {
      const r = was(t), dt = (t ?? room.tick) - t0;
      return to === 'drop' ? { ...r, safari: false, phase: 0, r: Infinity, next: 120, left: 5000 } : { ...r, safari: false, phase: 0, r: 400 - dt * 0.1, next: 120, left: 600 - dt };
    };
  }, to);
  await shiftTo('drop');
  expect(await spike(page, (s) => { const r = s.link.room.ring(); return { safari: !!r.safari, phase: r.phase, held: r.r === Infinity, next: r.next }; }), 'the drop').toMatchObject({ safari: false, phase: 0, held: true });
  await open();
  expect(await next(), 'no ring line on the drop').toBe('');
  await shot(page, 'map-drop-no-line');
  await page.keyboard.press('x');
  await page.waitForTimeout(800);
  // Into the end of the phase, when it moves in.
  await shiftTo('closing');
  await open();
  expect(await spike(page, (s) => { const room = s.link.room; return room.ring(room.tick + 1).r < room.ring().r; }), 'closing now').toBe(true);
  expect(await next(), 'the ring line while it closes').not.toBe('');
  await shot(page, 'map-closing-line');
  await ctx.close();
});

test('both bikes on the dial: MACH up, ACRO in the corner, UP then RIGHT', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await intoMatch(page, '#solo&nobots&safari=0&fog=900&seed=7');
  await onRoute(page);
  for (const item of [ITEM_MACH_BIKE, ITEM_ACRO_BIKE]) {
    const has = await spike(page, (s) => (s.pocket(4) as { item: number }[]).map((x) => x.item));
    if (!has.includes(item)) await page.evaluate(async (item) => (window as any).__spike.rom.give(item, 1), item);
  }
  await page.keyboard.down('c');
  await expect(page.locator('#radial')).toBeVisible();
  await expect(page.locator('.rad-up')).toHaveAttribute('aria-label', 'MACH');
  await expect(page.locator('.rad-upright')).toHaveAttribute('aria-label', 'ACRO');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#radial')).toHaveAttribute('data-on', 'up');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#radial')).toHaveAttribute('data-on', 'upright');
  await page.waitForTimeout(200);
  await shot(page, 'dial-both-bikes');
  await page.keyboard.up('c');
  await expect.poll(() => spike(page, (s) => { const m = s.link.room.actor(s.link.me).m; return m.bike && !!m.acro; }), { message: 'on the ACRO BIKE' }).toBe(true);
  // Riding the ACRO: WALK in its corner, and MACH up changes bikes.
  await page.waitForTimeout(800);
  await page.keyboard.down('c');
  await expect(page.locator('.rad-upright')).toHaveAttribute('aria-label', 'WALK');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('c');
  await expect.poll(() => spike(page, (s) => { const m = s.link.room.actor(s.link.me).m; return m.bike && !m.acro; }), { message: 'on the MACH BIKE' }).toBe(true);
  await ctx.close();
});

test('BALL in a wild fight throws a ROYALE BALL at once', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await intoMatch(page, '#solo&nobots&safari=0&fog=900&seed=7');
  await onRoute(page);
  if ((await balls(page)) < 3) await page.evaluate(async () => (window as any).__spike.rom.give(4, 5));
  const before = await balls(page);
  expect(before).toBeGreaterThan(0);
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me), q = room.patchesOn('MAP_ROUTE117')[0];
    a.battling = true;
    s.startFor({ type: 'wild', tick: room.tick, id: a.id, map: 'MAP_ROUTE117', x: q.x, y: q.y, key: q.key });
  });
  const ball = page.locator('.bm-act-ball');
  await expect(ball, 'BALL beside BAG in a wild fight').toBeVisible({ timeout: 30_000 });
  for (const word of ['party', 'bag', 'run']) await expect(page.locator(`.bm-act-${word}`)).toBeVisible();
  // All four in the menu's width, none over another.
  const boxes = await Promise.all(['party', 'bag', 'ball', 'run'].map((w) => page.locator(`.bm-act-${w}`).boundingBox()));
  for (let i = 1; i < 4; i++) expect(boxes[i]!.x, 'side by side').toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width - 1);
  expect(boxes[3]!.x + boxes[3]!.width, 'inside the phone').toBeLessThanOrEqual(390);
  await shot(page, 'wild-ball-button');
  await ball.click();
  await expect.poll(() => balls(page), { timeout: 30_000, message: 'one ROYALE BALL thrown' }).toBe(before - 1);
  await ctx.close();
});
