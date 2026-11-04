// The spectator's way out with a pad, a dock tap after a window, an item a battle refuses, how long
// the ROM's screens take to give the field back, and the MAP's cursor (Cam, 11-02).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any, arg?: any) => T, arg?: unknown) =>
  page.evaluate(([src, arg]) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as any).__spike, arg), [f.toString(), arg] as const) as Promise<T>;

const SCRATCH = process.env.HBR_E2E_SCRATCH || '';
const shot = async (page: Page, name: string) => {
  const to = SCRATCH ? path.join(SCRATCH, `${name}.png`) : test.info().outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  await page.screenshot({ path: to });
};

async function inMatch(page: Page, hash: string): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#${hash}`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me) && !!s.art; }, undefined, { timeout: 180_000 });
}

/** A team of six out of the Day Care's chest, as spikeb-windows.spec.ts has it. */
async function withTeam(page: Page): Promise<void> {
  await inMatch(page, 'solo&nobots&safari=0&fog=900&seed=7');
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
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });
  await page.waitForTimeout(300);
}

test('a trainer who is out can leave on a pad alone', async ({ page }) => {
  test.setTimeout(240_000);
  // A pad and nothing else: START and A, off the page's own read of the Gamepad API.
  await page.addInitScript(() => {
    const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), timestamp: 0 };
    (window as any).__pad = pad;
    (navigator as any).getGamepads = () => [pad];
  });
  const tap = async (i: number) => {
    await page.evaluate((i) => { (window as any).__pad.buttons[i].pressed = true; }, i);
    await page.waitForTimeout(120);
    await page.evaluate((i) => { (window as any).__pad.buttons[i].pressed = false; }, i);
    await page.waitForTimeout(150);
  };
  const A = 0, START = 9, DOWN = 13, RIGHT = 15;
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await page.locator('#room-start').click({ timeout: 30_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 180_000 });
  await spike(page, (s) => s.goOut('out'));
  await expect.poll(() => spike(page, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
  await page.waitForTimeout(1000);
  await tap(START);
  await expect.poll(() => spike(page, (s) => s.asking), { timeout: 5000, message: 'START asks' }).toBeTruthy();
  await page.waitForTimeout(200);
  await shot(page, 'leave-menu');
  // Down the rows to LEAVE.
  for (let i = 0; i < 6; i++) {
    const on = await spike(page, (s) => s.askingRows);
    if (on.rows[on.pick] === 'leave') break;
    await tap(DOWN);
  }
  await shot(page, 'leave-row');
  await tap(A);
  await expect(page.locator('#match-leave-sure')).toBeVisible({ timeout: 5000 });
  await shot(page, 'leave-sheet');
  // The sheet's cursor by the pad: down to its STAY and LEAVE, across, and A.
  const on = () => spike(page, (s) => s.lobby.stage.selected()?.id ?? '');
  for (let i = 0; i < 8 && !/^match-(stay|leave-sure)$/.test(await on()); i++) await tap(DOWN);
  if ((await on()) === 'match-stay') await tap(RIGHT);
  expect(await on(), 'the pad reaches LEAVE').toBe('match-leave-sure');
  await tap(A);
  await expect(page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }), 'back at the menu').toBeVisible({ timeout: 15_000 });
});

test('a dock tap right after a window closes is not lost', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await withTeam(page);
  const party = page.locator('#hud-party, .hud-party').first();
  const results: number[] = [];
  for (const wait of [0, 0, 16, 16, 40, 40, 80]) {
    await expect(party).toBeVisible({ timeout: 10_000 });
    await party.tap();
    await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(300);
    // BACK, then the dock's PARTY `wait` ms later: a thumb can't be that quick, a second one can.
    const opened = await page.evaluate(async (wait) => {
      const s = (window as any).__spike;
      (document.querySelector('#battle-menu .bm-back') as HTMLElement).click();
      if (wait) await new Promise((ok) => setTimeout(ok, wait));
      (document.querySelector('#hud-party, .hud-party') as HTMLElement).click();
      await new Promise((ok) => setTimeout(ok, 500));
      return s.battleMenu.isShown as boolean;
    }, wait);
    results.push(opened ? 1 : 0);
    if (opened) { await page.locator('#battle-menu .bm-back').click(); await page.waitForTimeout(400); }
  }
  console.log('opened', JSON.stringify(results));
  expect(results).toEqual(results.map(() => 1));
  await ctx.close();
});

test('the MAP: the mouse snaps to what is near, and out is one press', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await inMatch(page, 'solo&nobots&safari=0&fog=900&seed=7');
  await page.waitForTimeout(3000);
  const open = async () => {
    await spike(page, (s) => s.runMenu('13'));
    await expect(page.locator('#map-window .map-picture')).toBeVisible({ timeout: 5000 });
  };
  await open();
  const box = (await page.locator('#map-window .map-picture').boundingBox())!;
  const k = box.width / 240;
  // A place, then open sea right next to the coast: the cursor stays on land.
  const place = () => spike(page, (s) => { const c = s.mapWindow.cursor; return s.ringMap.placeAt(c.x, c.y)?.name ?? null; });
  const seen = new Set<string>();
  for (let px = 16; px < 232; px += 16) {
    for (let py = 16; py < 152; py += 12) {
      await page.mouse.move(box.x + px * k, box.y + py * k);
      const name = await place();
      if (name) seen.add(name);
    }
  }
  expect(seen.size, 'a sweep of the map lands on many places').toBeGreaterThan(20);
  await page.waitForTimeout(100);
  await shot(page, 'map-hover');
  // Out: one press on the dim round it, as fast as a click.
  await page.mouse.click(box.x + box.width + 40, box.y + 40);
  await expect(page.locator('#map-window')).toBeHidden({ timeout: 500 });
  await open();
  await page.keyboard.press('x');
  await expect(page.locator('#map-window')).toBeHidden({ timeout: 500 });
});

test('an X item a battle refuses says why, and the battle goes on', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await withTeam(page);
  const id = await spike(page, (s) => { for (let i = 1; i < 400; i++) if (s.art.itemName(i) === 'X ATTACK') return i; return 0; });
  expect(id).toBeGreaterThan(0);
  await spike(page, (s, id) => s.give(id), id);
  await page.waitForTimeout(1500);
  await intoBattle(page);
  // Attack already as high as it goes (struct BattlePokemon's statStages at 0x18, STAT_ATK 1).
  await spike(page, (s) => s.rom.emu.write(s.art.sym('gBattleMons') + 0x18 + 1, 12, 8));
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  let row = -1;
  for (let i = 0; i < 6 && row < 0; i++) {
    row = await spike(page, (s, id) => s.battleMenu.stacks().findIndex((x: any) => x.item === id), id);
    if (row < 0) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); }
  }
  expect(row, 'X ATTACK in a pocket').toBeGreaterThanOrEqual(0);
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('#msg')).toHaveAttribute('data-text', "It won't have any effect.", { timeout: 10_000 });
  await shot(page, 'refused-pressed');
  await expect.poll(() => spike(page, (s) => s.battleMenu.isShown), { timeout: 15_000, message: 'the menu comes back' }).toBe(true);
  await shot(page, 'refused-later');
  // The turn is still ours, and with room to raise it the same press goes through, off the ROM's
  // screen too.
  await spike(page, (s) => s.rom.emu.write(s.art.sym('gBattleMons') + 0x18 + 1, 6, 8));
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  await page.waitForTimeout(300);
  row = -1;
  for (let i = 0; i < 6 && row < 0; i++) {
    row = await spike(page, (s, id) => s.battleMenu.stacks().findIndex((x: any) => x.item === id), id);
    if (row < 0) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); }
  }
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await page.locator('.bm-bag-use').click();
  await expect.poll(() => spike(page, (s) => s.rom.emu.read(s.art.sym('gBattleMons') + 0x18 + 1, 8)), { timeout: 30_000, message: 'it raised ATTACK' }).toBe(7);
  await expect.poll(() => spike(page, (s) => s.battleMenu.isShown), { timeout: 40_000, message: 'and the next turn comes' }).toBe(true);
});

test('a medicine pressed on somebody it would do nothing for says so', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await withTeam(page);
  const id = await spike(page, (s) => { for (let i = 1; i < 400; i++) if (s.art.itemName(i) === 'POTION') return i; return 0; });
  await spike(page, (s, id) => s.give(id), id);
  await page.waitForTimeout(1500);
  await intoBattle(page);
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  let row = -1;
  for (let i = 0; i < 6 && row < 0; i++) {
    row = await spike(page, (s, id) => s.battleMenu.stacks().findIndex((x: any) => x.item === id), id);
    if (row < 0) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); }
  }
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.waitForTimeout(300);
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-slot').first()).toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
  await page.locator('.bm-slot').first().click({ force: true });
  await expect(page.locator('#msg')).toHaveAttribute('data-text', "It won't have any effect.", { timeout: 3000 });
  await shot(page, 'refused-medicine');
});

test('how long a TM takes, from picking who to the field', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await withTeam(page);
  // Each of the ROM's calls in it, timed.
  await spike(page, (s) => {
    const log: any[] = [];
    (window as any).__tm = log;
    for (const name of ['give', 'menu', 'take', 'setHeld']) {
      const was = s.rom[name].bind(s.rom);
      s.rom[name] = async (...a: unknown[]) => { const t0 = performance.now(); log.push(['start', name, Math.round(t0)]); const r = await was(...a); log.push(['end', name, Math.round(performance.now()), Math.round(performance.now() - t0)]); return r; };
    }
  });
  const tm = await spike(page, (s) => { for (let i = 289; i < 339; i++) if (s.art.itemName(i)) return i; return 0; });
  await spike(page, (s, id) => s.give(id), tm);
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  const t0 = await page.evaluate(() => performance.now());
  const slot = await page.locator('.bm-slot').evaluateAll((bs) => bs.findIndex((b) => b.getAttribute('aria-disabled') !== 'true'));
  const movesOf = (slot: number) => spike(page, (s, slot) => s.battleMenu.deps.firstMoves.readParty()[slot].moves.map((m: any) => m.id), slot);
  const before = await movesOf(slot);
  await page.locator('.bm-slot').nth(slot).click();
  // Which move to forget, if it asks: the first, as soon as it does.
  const forget = page.locator('.bm-pick-move:visible').first();
  const done = () => page.evaluate(() => (window as any).__tm.some((l: any) => l[0] === 'end' && l[1] === 'menu'));
  let asked = 0, answered = 0;
  for (let i = 0; i < 1200 && !(await done()); i++) {
    if (!asked && await forget.isVisible()) {
      asked = await page.evaluate(() => performance.now());
      await shot(page, 'tm-forget');
      answered = await page.evaluate(() => performance.now());
      await forget.click();
      answered = await page.evaluate(() => performance.now());
    }
    await page.waitForTimeout(25);
  }
  expect(await done(), 'the machine went through').toBe(true);
  await expect.poll(() => spike(page, (s) => !s.swapping && !s.asking && !s.battleMenu.isShown && !document.getElementById('battle')!.classList.contains('on')), { timeout: 60_000, intervals: [50] }).toBe(true);
  const t1 = await page.evaluate(() => performance.now());
  const log = await page.evaluate(() => (window as any).__tm);
  const after = await movesOf(slot);
  console.log(JSON.stringify({ tm, slot, before, after }));
  expect(after, 'it was taught').not.toEqual(before);
  const out = { pickToField: Math.round(t1 - t0), pickToForget: asked ? Math.round(asked - t0) : null, forgetToField: asked ? Math.round(t1 - answered) : null, calls: log.filter((l: any) => l[0] === 'end').map((l: any) => `${l[1]} ${l[3]}`) };
  console.log(JSON.stringify(out));
  if (SCRATCH) fs.appendFileSync(path.join(SCRATCH, 'tm.jsonl'), JSON.stringify(out) + '\n');
  await shot(page, 'tm-back');
});
