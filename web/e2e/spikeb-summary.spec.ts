// SUMMARY as a window of the page's (Cam, 11-02 and 11-03): smaller than the screen, what the ROM's
// said that Cam asked for, and a long press on a mon in any window, by a finger, a mouse, the keys
// and a pad. A hold on a move still opens its details.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const shot = (page: Page, name: string) => page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/${name}.png` : test.info().outputPath(`${name}.png`) });

const DESK = { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** A pad the test holds down: the Gamepad API read off `window.__pad`. */
const fakePad = () => {
  (window as any).__pad = { buttons: new Array(17).fill(false), axes: [0, 0, 0, 0] };
  navigator.getGamepads = (() => [{ id: 'Xbox Wireless Controller', index: 0, axes: (window as any).__pad.axes, buttons: (window as any).__pad.buttons.map((pressed: boolean) => ({ pressed, value: pressed ? 1 : 0 })) }]) as any;
};
const padButton = (page: Page, i: number, on: boolean) => page.evaluate(([i, on]) => { (window as any).__pad.buttons[i as number] = on; }, [i, on] as const);

/** Into a match of the page's own with six on the team. */
async function withTeam(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0001, name: 'MAY', bag: { items: [], money: 0, mons: [{ species: 277, level: 30 }] } }));
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  await expect.poll(() => spike(page, (s) => s.rom.partyCount()), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000 }).toBe(false);
  await spike(page, (s) => s.rom.fillParty());
  await page.waitForTimeout(500);
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

/** The box is a box: less than this share of the screen each way. */
async function small(page: Page, w: number, h: number): Promise<void> {
  const box = (await page.locator('#summary').boundingBox())!;
  const size = page.viewportSize()!;
  expect(box.width / size.width, `${box.width} of ${size.width} across`).toBeLessThanOrEqual(w);
  expect(box.height / size.height, `${box.height} of ${size.height} down`).toBeLessThanOrEqual(h);
  expect(box.x, 'on the screen').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'on the screen').toBeLessThanOrEqual(size.height);
}

/** A finger on it for `ms`: the real touch events, as a phone sends them. */
async function touchHold(page: Page, sel: ReturnType<Page['locator']>, ms: number): Promise<void> {
  const b = (await sel.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const at = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('SUMMARY off the field: a window, with the real numbers, and back where it was', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await withTeam(page);
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.locator('.bm-slot').first().click();
  await expect(page.locator('.bm-member')).toBeVisible();
  await page.locator('.bm-m-btn').nth(1).click();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#gba'), 'no ROM screen for it').toBeHidden();
  await small(page, 0.6, 0.6);
  await page.waitForTimeout(300);
  await shot(page, 'desk-summary');

  // What it was given is the party's own bytes, the ROM's stats.
  const read = await spike(page, (s) => {
    const m = s.battleMenu.deps.firstMoves.readParty()[0], at = s.art.sym('gPlayerParty');
    return { m, atk: s.rom.emu.read(at + 90, 16), spd: s.rom.emu.read(at + 98, 16), spe: s.rom.emu.read(at + 94, 16) };
  }) as any;
  expect(read.m.stats.attack).toBe(read.atk);
  expect(read.m.stats.spDefense).toBe(read.spd);
  expect(read.m.stats.speed).toBe(read.spe);
  expect(read.atk).toBeGreaterThan(0);

  // Over to the moves, and each one's page.
  await expect(page.locator('.sum-move').first()).toHaveClass(/bm-focus/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sum-move').nth(1)).toHaveClass(/bm-focus/);
  await expect(page.locator('.sum-detail')).toHaveAttribute('aria-label', /:/);
  await shot(page, 'desk-summary-move');
  // L and R: the next of the party.
  await expect(page.locator('#summary')).toHaveAttribute('data-at', '0');
  await page.keyboard.press('e');
  await expect(page.locator('#summary')).toHaveAttribute('data-at', '1');
  // B: back to the windows it stood over.
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  await expect(page.locator('.bm-member')).toBeVisible();
  await ctx.close();
});

test('a long press is its SUMMARY, on the party, a dropped team and a gift: mouse, keys and pad', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(DESK);
  await ctx.addInitScript(fakePad);
  const page = await ctx.newPage();
  await withTeam(page);
  await page.keyboard.press('q');
  const slot = page.locator('.bm-slot').nth(1);
  await expect(slot).toBeVisible();
  // A mouse held: the window, and the click that ends the hold does not also open the member.
  const b = (await slot.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(page.locator('#summary')).toBeVisible({ timeout: 2000 });
  await page.mouse.up();
  await expect(page.locator('.bm-member')).toBeHidden();
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  // A press is still a press.
  await slot.click();
  await expect(page.locator('.bm-member')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  // Z held, and let go short of it.
  await page.keyboard.down('z');
  await page.waitForTimeout(700);
  await page.keyboard.up('z');
  await expect(page.locator('#summary')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  await page.keyboard.press('z', { delay: 60 });
  await expect(page.locator('.bm-member')).toBeVisible();
  await expect(page.locator('#summary')).toBeHidden();
  await page.keyboard.press('x');
  // The pad's A held, and B out.
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await padButton(page, 0, true);
  await page.waitForTimeout(700);
  await padButton(page, 0, false);
  await expect(page.locator('#summary')).toBeVisible();
  await page.waitForTimeout(100);
  await padButton(page, 1, true);
  await page.waitForTimeout(100);
  await padButton(page, 1, false);
  await expect(page.locator('#summary')).toBeHidden();
  await page.keyboard.press('x');
  await expect(page.locator('.bm-slot').first()).toBeHidden();
  await expect.poll(() => spike(page, (s) => s.swapping)).toBe(false);

  // A dropped team: nobody's bytes to read, so its base stats and no moves.
  await spike(page, (s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0004, name: 'DRAKE', bag: { items: [], money: 0, mons: [{ species: 373, level: 30 }] } }));
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  const d = (await page.locator('.bm-slot').first().boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await expect(page.locator('#summary')).toBeVisible({ timeout: 2000 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot(page, 'desk-summary-dropped');
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  await expect(page.locator('.bm-slot').first(), 'still asking who to take').toBeVisible();
  await page.keyboard.press('x');
  await expect.poll(() => spike(page, (s) => s.swapping)).toBe(false);

  // Somebody's offer: SUMMARY on the question, and the question again.
  await spike(page, (s) => s.startFor({ type: 'trade', tick: 0, id: s.link.me, n: 0, species: 280, gives: true }));
  await expect.poll(() => spike(page, (s) => s.asking)).toBe(true);
  await page.keyboard.press('ArrowDown', { delay: 60 });
  await page.keyboard.press('z', { delay: 60 });
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#summary')).toHaveAttribute('aria-label', /TORCHIC/);
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  await expect.poll(() => spike(page, (s) => s.asking)).toBe(true);
  await ctx.close();
});

test('in a battle: SUMMARY and a held mon leave the fight as it was; a held move still shows its details', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  await withTeam(page);
  await intoBattle(page);
  await expect(page.locator('.bm-cell').first()).toBeVisible();
  // The hold on a move: mouse, then the keys.
  const m = (await page.locator('.bm-cell').first().boundingBox())!;
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await page.mouse.down();
  await expect(page.locator('.bm-info')).toBeVisible({ timeout: 2000 });
  await page.mouse.up();
  await page.keyboard.press('x');
  await expect(page.locator('.bm-info')).toBeHidden();
  await page.keyboard.down('z');
  await page.waitForTimeout(700);
  await page.keyboard.up('z');
  await expect(page.locator('.bm-info')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('.bm-cell').first()).toBeVisible();

  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.locator('.bm-slot').nth(1).click();
  await page.locator('.bm-m-btn').nth(1).click();
  await expect(page.locator('#summary')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'desk-summary-battle');
  await page.keyboard.press('x');
  await expect(page.locator('#summary')).toBeHidden();
  await expect(page.locator('.bm-member')).toBeVisible();
  await page.keyboard.press('x');
  await page.keyboard.press('x');
  // A press on a move attacks, on the way up.
  await expect(page.locator('.bm-cell').first()).toBeVisible();
  await page.keyboard.press('z', { delay: 60 });
  await expect(page.locator('.bm-cell').first()).toBeHidden({ timeout: 5000 });
  await ctx.close();
});

test('by a thumb: the same window fits a phone, and a finger held on a mon opens it', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await withTeam(page);
  await page.locator('#hud-party').click();
  const slot = page.locator('.bm-slot').nth(1);
  await expect(slot).toBeVisible();
  // The last one: lifted, the finger is over the window's moves, and that is not a tap on them.
  await touchHold(page, page.locator('.bm-slot').nth(5), 700);
  await expect(page.locator('#summary')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('.sum-stats'), 'the lift tapped nothing').toBeVisible();
  await expect(page.locator('.bm-member')).toBeHidden();
  await page.keyboard.press('x');
  await touchHold(page, slot, 700);
  await expect(page.locator('#summary')).toBeVisible();
  await small(page, 1, 0.75);
  await page.waitForTimeout(300);
  await shot(page, 'phone-summary');
  // A move's page in place of the stats, and BACK.
  await page.locator('.sum-move').first().tap();
  await expect(page.locator('.sum-detail')).toBeVisible();
  await expect(page.locator('.sum-stats')).toBeHidden();
  await shot(page, 'phone-summary-move');
  await page.locator('.sum-move').first().tap();
  await expect(page.locator('.sum-stats')).toBeVisible();
  await page.locator('.sum-back').tap();
  await expect(page.locator('#summary')).toBeHidden();
  // A short finger is a tap.
  await slot.tap();
  await expect(page.locator('.bm-member')).toBeVisible();
  await ctx.close();
});
