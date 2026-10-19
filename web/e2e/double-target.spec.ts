// A double battle's target, on a phone (POK-383). The ROM picks a target with the D-pad
// and A over a bouncing healthbox (HandleInputChooseTarget), and B goes back to the
// moves. The page's move windows used to stay up through it with the pad hidden, so the
// only way to a target was tapping the move again, and there was no BACK. Now the ROM
// says BR_MENU_TARGET and the page steps aside: the pad is back for the pick.
//
// Solo on a phone, landed in Mossdeep Gym under TATE and LIZA, `#testmon`'s TREECKO
// copied into slot two so the double fight opens. POUND hits one foe: a target to pick.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { ram, tap, type EmuWindow, type Ram } from './play';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };
const SEED = 5376;
const MOSSDEEP_GYM = '14:0';
// The cell under TATE (23,7): one step up and we face him.
const LAND = { x: 23, y: 9 };
const MON_SIZE = 100; // struct Pokemon
const BR_MENU_ACTION = 1;
const BR_MENU_MOVE = 2;
const BR_MENU_TARGET = 4;
const BATTLE_TYPE_DOUBLE = 1 << 0;

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

async function until(page: Page, sym: Record<string, number>, what: string, ok: (r: Ram) => boolean, timeoutMs: number): Promise<Ram> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await ram(page, sym);
    if (ok(r)) return r;
    if (Date.now() > end) throw new Error(`${what}: not by ${timeoutMs} ms (${JSON.stringify(r)})`);
    await page.waitForTimeout(250);
  }
}

const read = (page: Page, addr: number, bits: 8 | 16 | 32) =>
  page.evaluate(([a, b]) => (window as unknown as EmuWindow).__hbr.emu.read(a, b), [addr, bits] as const);

/** A thumb on a pad button: down for a few frames, as a finger is (a tap's down and up
 *  can land between two frames, and the ROM never sees it). */
async function hold(page: Page, sel: string): Promise<void> {
  const b = page.locator(sel);
  await b.dispatchEvent('pointerdown');
  await page.waitForTimeout(150);
  await b.dispatchEvent('pointerup');
}

const visibility = (page: Page, sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).visibility);

test("a phone's double battle: the pad picks the target, and B goes back to the moves", async ({ browser }) => {
  test.setTimeout(300_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/#solo&safari=5&fog=600&testmon&seed=${SEED}&land=MAP_MOSSDEEP_CITY_GYM,${LAND.x},${LAND.y}&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await until(page, sym, 'the drop map', (x) => x.pick, 60_000);
    await page.waitForTimeout(1_000);
    for (let i = 0; i < 20 && (await ram(page, sym)).pick; i++) {
      await tap(page, 'z');
      await page.waitForTimeout(1_000);
    }
    await until(page, sym, 'landed in the gym', (x) => !x.pick && x.onOverworld && x.map === MOSSDEEP_GYM, 20_000);
    await page.waitForTimeout(1_000);

    // A second mon, so the double fight opens.
    await page.evaluate(([party, count, size]) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      for (let i = 0; i < size; i++) emu.write(party + size + i, emu.read(party + i, 8), 8);
      emu.write(count, 2, 8);
    }, [sym.gPlayerParty, sym.gPlayerPartyCount, MON_SIZE] as const);

    // Up to TATE, and talk.
    await tap(page, 'ArrowUp', 250);
    await page.waitForTimeout(500);
    for (let i = 0; i < 15 && !(await ram(page, sym)).inBattle; i++) {
      await tap(page, 'z');
      await page.waitForTimeout(700);
    }
    const r = await until(page, sym, 'the double fight', (x) => x.inBattle, 20_000);
    expect(r.battleType & BATTLE_TYPE_DOUBLE, 'a double').toBe(BATTLE_TYPE_DOUBLE);
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 60_000 }).toBe(BR_MENU_ACTION);
    await expect(page.locator('#battle-menu')).toBeVisible();

    // FIGHT, then POUND: the target pick, and the page steps aside for the pad.
    await page.locator('.bm-cell[data-slot="0"]').tap();
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 10_000 }).toBe(BR_MENU_MOVE);
    await page.waitForTimeout(300);
    await page.locator('.bm-cell[data-slot="0"]').tap();
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 10_000 }).toBe(BR_MENU_TARGET);
    await expect(page.locator('#battle-menu')).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/battle-no-pad/);
    for (const sel of ['#dpad-surface', '#pad .ab']) expect(await visibility(page, sel), sel).toBe('visible');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'double-target-pick.png') });

    // B: back to the moves, and the page's windows with them.
    await hold(page, '.ab .btn[data-key="b"]');
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 10_000 }).toBe(BR_MENU_MOVE);
    await expect(page.locator('#battle-menu')).toBeVisible();
    await expect(page.locator('.bm-cell[data-slot="0"]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'double-target-back.png') });

    // POUND again, and A on the pad takes the target: the second mon's turn.
    await page.locator('.bm-cell[data-slot="0"]').tap();
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 10_000 }).toBe(BR_MENU_TARGET);
    await hold(page, '.ab .btn[data-key="a"]');
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 10_000 }).toBe(BR_MENU_ACTION);
    await expect(page.locator('#battle-menu')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
