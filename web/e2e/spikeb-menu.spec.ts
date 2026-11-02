// The new game's menu and page: SEND FEEDBACK, HOW TO PLAY, the line a missing chunk gets,
// and the layout on a phone and a desktop. The live match's feedback, howto, chunk-reload and
// phone specs went with its page; these are the same promises on /.
import { devices, expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

const PHONE = { viewport: devices['Pixel 7'].viewport, isMobile: true, hasTouch: true };
const quickPlay = (page: Page) => page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' });

test('SEND FEEDBACK reaches the relay and comes back to the menu', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(quickPlay(page)).toBeVisible({ timeout: 90_000 });
  await page.locator('#lobby-feedback').tap();
  await expect(page.locator('#feedback-send'), 'nothing to send yet').toBeDisabled();
  await page.locator('#feedback-text').fill('a note from the new game');
  await expect(page.locator('#feedback-send')).toBeEnabled();
  await page.locator('#feedback-send').tap();
  await expect(page.locator('#feedback-note')).toHaveText('Sent. Thank you!', { timeout: 15_000 });
  await page.locator('#feedback-back').tap();
  await expect(quickPlay(page)).toBeVisible();
  await ctx.close();
});

test('HOW TO PLAY pages through its panels and back to the menu', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(quickPlay(page)).toBeVisible({ timeout: 90_000 });
  await page.locator('#lobby-howto').tap();
  await expect(page.locator('#howto-heading')).toHaveText('Start in Safari');
  // A moving picture on a panel redraws its buttons, so Playwright's wait for a still one
  // never ends: the press goes straight to the element.
  const press = (id: string) => page.evaluate((id) => document.getElementById(id)?.click(), id);
  for (let i = 0; i < 20 && (await page.locator('#howto-next').count()); i++) { await press('howto-next'); await page.waitForTimeout(150); }
  await press('howto-done');
  await expect(quickPlay(page)).toBeVisible();
  await ctx.close();
});

test("a chunk that won't load: one tap-to-reload line, and the tap reloads", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(quickPlay(page)).toBeVisible({ timeout: 90_000 });
  // What Vite's preload helper fires when a release took the page's hashed files away.
  const fail = () => page.evaluate(() => dispatchEvent(new Event('vite:preloadError')));
  await fail();
  await fail();
  const line = page.locator('#chunk-reload');
  await expect(line).toHaveText("Part of the game didn't load. Tap to reload.");
  await expect(line).toHaveCount(1);
  await Promise.all([page.waitForEvent('load'), line.tap()]);
  await expect(line).toHaveCount(0);
  await ctx.close();
});

/** The ROM is up and my trainer is on the field. */
async function onField(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { rom?: unknown; link?: { me: number; room: { actor(id: number): unknown } } } }).__spike;
    return !!s?.rom && !!s.link?.room.actor(s.link.me);
  }, undefined, { timeout: 120_000 });
}

/** A match of the page's own, on the field. */
async function inMatch(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await onField(page);
}

const boxOf = (page: Page, sel: string) => page.locator(sel).boundingBox();

test('a phone gets the map and both thumbs, either way up; a desktop gets the keys and no pad', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await inMatch(page);
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(500);
    const world = (await boxOf(page, '#world'))!;
    const pad = (await boxOf(page, '#dpad-surface'))!;
    expect(world.width * world.height, `${size.width}x${size.height}: the map fills the glass`).toBeGreaterThan(size.width * size.height * 0.5);
    expect(pad.x, 'the pad is on the glass').toBeGreaterThanOrEqual(0);
    expect(pad.x + pad.width).toBeLessThanOrEqual(size.width);
    expect(pad.y + pad.height).toBeLessThanOrEqual(size.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
  await ctx.close();

  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await desk.newPage();
  await inMatch(dp);
  await expect(dp.locator('#keys'), 'the key legend').toBeVisible();
  await expect(dp.locator('#dpad-surface'), 'no pad').toBeHidden();
  await desk.close();
});

/** The way a player gets a match: a hosted room with bots, on the field (the room's sheet
 *  is only there). */
async function hosted(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await page.locator('#room-start').click({ timeout: 30_000 });
  await onField(page);
}

const zoomOf = (page: Page) => page.evaluate(() => (window as unknown as { __spike: { zoom: number } }).__spike.zoom);

test('a desktop player picks how close the map sits: wheel, keys, the sheet, and it is kept', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await hosted(page);
  await expect.poll(() => zoomOf(page), 'the default, the farthest here').toBe(2);
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => zoomOf(page), 'a notch forward').toBe(3);
  await page.keyboard.press('=');
  await expect.poll(() => zoomOf(page)).toBe(4);
  await page.keyboard.press('=');
  expect(await zoomOf(page), 'the GBA fills the window: no closer').toBe(4);

  // The menu is the window's size, whatever the field's.
  await page.keyboard.press('m');
  await expect(page.locator('#startmenu')).toBeVisible();
  const close = await boxOf(page, '#startmenu');
  await page.keyboard.press('x');
  await expect(page.locator('#startmenu')).toBeHidden();
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect.poll(() => zoomOf(page)).toBe(2);
  await page.keyboard.press('-');
  expect(await zoomOf(page), 'no farther').toBe(2);
  await page.keyboard.press('m');
  await expect(page.locator('#startmenu')).toBeVisible();
  const far = await boxOf(page, '#startmenu');
  expect({ w: far!.width, h: far!.height }).toEqual({ w: close!.width, h: close!.height });
  await page.keyboard.press('x');
  await expect(page.locator('#startmenu')).toBeHidden();

  // The sheet's row steps round.
  await page.keyboard.press('r');
  await expect(page.locator('#zoom')).toHaveText('ZOOM 1/3');
  await page.locator('#zoom').click();
  await expect(page.locator('#zoom')).toHaveText('ZOOM 2/3');
  expect(await zoomOf(page)).toBe(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('#zoom')).toHaveCount(0);

  // Spectating has its own free zoom, and the camera comes back to the choice.
  await page.keyboard.press('v');
  await page.mouse.wheel(0, 300);
  await expect.poll(() => zoomOf(page), 'free').toBeLessThan(3);
  await page.keyboard.press('v');
  await expect.poll(() => zoomOf(page)).toBe(3);

  // The next visit (back into the same match), a resize.
  await page.reload();
  await onField(page);
  await expect.poll(() => zoomOf(page), 'kept').toBe(3);
  await page.setViewportSize({ width: 1000, height: 600 });
  await expect.poll(() => zoomOf(page), 'still fits').toBe(3);
  await page.setViewportSize({ width: 500, height: 320 });
  await expect.poll(() => zoomOf(page), 'held inside a small window').toBeLessThan(3);
  await ctx.close();
});

test('a phone player pinches the map: whole steps, kept, and no walk', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await inMatch(page);
  await expect.poll(() => zoomOf(page), "the GBA's 15 tiles across the glass").toBe(4);
  const spot = () => page.evaluate(() => { const s = (window as unknown as { __spike: { link: { me: number; room: { actor(id: number): { m: { spot: { map: string; x: number; y: number } } } } } } }).__spike; return JSON.stringify(s.link.room.actor(s.link.me).m.spot); });
  const at = await spot();
  const pinch = (from: number, to: number) => page.evaluate(({ from, to }) => {
    const c = document.getElementById('world')!;
    const ev = (type: string, id: number, x: number) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: 300, bubbles: true }));
    ev('pointerdown', 11, 195 - from / 2);
    ev('pointerdown', 12, 195 + from / 2);
    ev('pointermove', 11, 195 - to / 2);
    ev('pointermove', 12, 195 + to / 2);
    ev('pointerup', 11, 195 - to / 2);
    ev('pointerup', 12, 195 + to / 2);
  }, { from, to });
  await pinch(200, 100);
  await expect.poll(() => zoomOf(page), 'fingers together: farther').toBe(3);
  await pinch(100, 40);
  expect(await zoomOf(page), 'no farther than a desktop sees').toBe(3);
  await page.waitForTimeout(800);
  expect(await spot(), 'a pinch is not a tap to walk').toBe(at);
  await pinch(100, 200);
  await expect.poll(() => zoomOf(page), 'fingers apart: closer').toBe(4);
  await pinch(100, 40);
  await expect.poll(() => zoomOf(page)).toBe(3);
  await page.reload();
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await onField(page);
  await expect.poll(() => zoomOf(page), 'kept').toBe(3);
  await ctx.close();
});

test("a step leaves the ROM's marks: ash comes off, sand takes prints, grass rustles", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  type P = { m: { id: string; w: number; h: number; group: number; num: number }; ground?: HTMLCanvasElement };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type S = { link: { me: number; room: any }; placed: Map<string, P>; art: { behavior(g: number, n: number, x: number, y: number): number }; effects: { kind: string }[]; ashGone: Map<string, Set<number>> };
  /** A new match each time: grass and ash can start a wild battle, and that holds the walk. */
  const standOn = async (map: string, mb: number) => {
    await page.goto('about:blank');
    await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
    await page.locator('#intro-go').click({ timeout: 90_000 });
    await onField(page);
    await page.waitForTimeout(1500);
    const at = await page.evaluate(([map, mb]) => {
      const s = (window as unknown as { __spike: S }).__spike, room = s.link.room, a = room.actor(s.link.me), p = s.placed.get(map as string)!;
      for (let y = 0; y < p.m.h; y++) for (let x = 0; x < p.m.w - 1; x++) {
        if (s.art.behavior(p.m.group, p.m.num, x, y) !== mb || s.art.behavior(p.m.group, p.m.num, x + 1, y) !== mb) continue;
        const spot = { map, x, y };
        const r = room.stepFor(a)(spot, 4);
        if (!r || r.warp || r.water || r.to.x !== x + 1) continue;
        a.m = { ...a.m, spot, prev: spot, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
        return { x, y };
      }
      return null;
    }, [map, mb] as const);
    expect(at, `${map} has a walk over ${mb}`).not.toBeNull();
    await page.waitForTimeout(200);
    return at!;
  };
  const kinds = () => page.evaluate(() => (window as unknown as { __spike: S }).__spike.effects.map((e) => e.kind));
  const step = async () => { await page.keyboard.down('ArrowRight'); await page.waitForTimeout(100); await page.keyboard.up('ArrowRight'); };

  // Route 113: the ash goes up, and the cell is plain grass from then on.
  const ash = await standOn('MAP_ROUTE113', 36);
  const pixels = () => page.evaluate(({ x, y }) => {
    const p = (window as unknown as { __spike: S }).__spike.placed.get('MAP_ROUTE113')!;
    return Array.from(p.ground!.getContext('2d')!.getImageData((x + 1) * 16, y * 16, 16, 16).data).join();
  }, ash);
  const before = await pixels();
  await step();
  await expect.poll(kinds, { timeout: 3000 }).toContain('ash');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spike: S }).__spike.ashGone.get('MAP_ROUTE113')?.size ?? 0)).toBeGreaterThan(0);
  expect(await pixels(), 'the ground under it changed').not.toBe(before);

  // Sand keeps a print behind me: the desert's deep, a beach's shallow. Grass rustles.
  for (const [map, mb, kind] of [['MAP_ROUTE111', 6, 'deep'], ['MAP_ROUTE109', 33, 'foot'], ['MAP_ROUTE101', 2, 'grass']] as const) {
    await standOn(map, mb);
    await step();
    await expect.poll(kinds, { timeout: 3000 }).toContain(kind);
  }
  await ctx.close();
});
