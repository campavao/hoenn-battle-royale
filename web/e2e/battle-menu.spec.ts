// The phone's battle menu (ui/battlemenu.ts): under the picture, four Emerald windows in
// place of the D-pad, A/B and the dock. FIGHT shows the moves with their type, PP and how
// they land; a hold opens a move's details; a tap attacks, through the ROM's own menus
// (FIGHT, then the move). RUN greys out in a trainer fight without a POKe DOLL. The
// game's own little menu stays off the picture (gBrHud.noBattleBox), and the D-pad, A/B
// and the dock stay down while the battle plays out between choices.
//
// Solo on a phone: a short Safari opening, the drop onto Route 102, and a wild battle off
// a patch put a tile west (as play.spec.ts does), with `#testmon`'s TREECKO.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import { picture, ram, tap, type EmuWindow, type Ram } from './play';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };
const SEED = 5376;
const ROUTE_102 = '0:17';
const LAND = { x: 36, y: 16 };
/** Tall grass on the landing's row, eleven tiles west: a patch only stirs where a battle
 *  could start. */
const GRASS = { x: 25, y: 16 };
// struct BrPatch (include/br/br_patch.h): count, the first x and the first y.
const PATCH_COUNT = 4;
const PATCH_X = 16;
const PATCH_Y = 32;
const MAP_OFFSET = 7;
const BR_MENU_ACTION = 1;
const BATTLE_TYPE_TRAINER = 1 << 3;
const MOVE_POUND = 1;
// One of each band (Cam's reference, 2026-10-15) against a ROCK/GROUND foe.
const MOVE_ABSORB = 71; // GRASS x4
const MOVE_POWDER_SNOW = 181; // ICE x2
const MOVE_THUNDER_SHOCK = 84; // ELECTRIC x0
const TYPE_GROUND = 4;
const TYPE_ROCK = 5;
// struct BattlePokemon (include/pokemon.h), as ui/battlemenu.ts reads it.
const MON_SIZE = 0x58;
const MON_MOVES = 0x0c;
const MON_TYPES = 0x21;
const MON_PP = 0x24;

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
const write = (page: Page, addr: number, v: number, bits: 8 | 16 | 32) =>
  page.evaluate(([a, x, b]) => (window as unknown as EmuWindow).__hbr.emu.write(a, x, b), [addr, v, bits] as const);

test("a phone's battle menu: under the picture, the moves, a hold for details, a tap to attack", async ({ browser }) => {
  test.setTimeout(300_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/#solo&safari=5&fog=600&testmon&seed=${SEED}&land=MAP_ROUTE102,${LAND.x},${LAND.y}&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });

    // The opening runs out; A takes the section under the drop map's cursor.
    await until(page, sym, 'the drop map', (x) => x.pick, 60_000);
    await page.waitForTimeout(1_000);
    for (let i = 0; i < 20 && (await ram(page, sym)).pick; i++) {
      await tap(page, 'z');
      await page.waitForTimeout(1_000);
    }
    await until(page, sym, 'landed', (x) => !x.pick && x.onOverworld && x.map === ROUTE_102, 20_000);
    await page.waitForTimeout(1_000);

    // A patch in the grass west of us, walked onto.
    await page.evaluate(([a, k]) => {
      const emu = (window as unknown as EmuWindow).__hbr.emu;
      emu.write(a + k.PATCH_X, k.x + k.MAP_OFFSET, 16);
      emu.write(a + k.PATCH_Y, k.y + k.MAP_OFFSET, 16);
      emu.write(a + k.PATCH_COUNT, 1, 8);
    }, [sym.gBrPatch, { PATCH_X, PATCH_Y, PATCH_COUNT, MAP_OFFSET, ...GRASS }] as const);
    for (let i = 0; i < 30 && !(await ram(page, sym)).inBattle; i++) await tap(page, 'ArrowLeft', 250);
    const r = await until(page, sym, 'a wild battle', (x) => x.inBattle, 10_000);
    expect(r.battleType & BATTLE_TYPE_TRAINER, 'a wild one').toBe(0);

    // Through the intro to the action menu, with no A: on a phone the battle's text turns
    // its own pages (BrBattle_PhoneAutoScroll). The windows come up.
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 30_000 }).toBe(BR_MENU_ACTION);
    const menu = page.locator('#battle-menu');
    await expect(menu).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, 'battle-menu-action.png') });

    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    const lcd = (await picture(page)).lcd;
    const cells = await Promise.all([0, 1, 2, 3].map((i) => box(`.bm-cell[data-slot="${i}"]`)));
    const scale = cells[0].width / 112;
    expect(scale, "the field's scale").toBeCloseTo(390 / 240, 1);
    // Right under the picture (four GBA pixels), and inside the glass.
    expect(cells[0].y - (lcd.y + lcd.height)).toBeGreaterThanOrEqual(0);
    expect(cells[0].y - (lcd.y + lcd.height)).toBeLessThan(6 * scale);
    for (const [i, c] of cells.entries()) {
      expect(c.x, `cell ${i}`).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width, `cell ${i}`).toBeLessThanOrEqual(PORTRAIT.width + 0.5);
      for (const [j, d] of cells.entries()) {
        if (j <= i) continue;
        const overlap = c.x < d.x + d.width - 0.5 && d.x < c.x + c.width - 0.5 && c.y < d.y + d.height - 0.5 && d.y < c.y + c.height - 0.5;
        expect(overlap, `cells ${i} and ${j}`).toBe(false);
      }
    }
    // The D-pad, A/B and the dock make way.
    const padDown = async (dock = true) => {
      for (const sel of dock ? ['#dpad-surface', '#pad .ab', '#dock'] : ['#dpad-surface', '#pad .ab']) {
        expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).visibility), sel).toBe('hidden');
      }
    };
    await padDown();
    // ...and the game's own FIGHT/BAG box is off the picture: bg0 on the message box.
    expect(await read(page, sym.gBattle_BG0_Y, 16), 'the battle box off').toBe(0);
    await expect(page.locator('.bm-cell[data-slot="0"]')).toHaveAttribute('aria-label', 'FIGHT');
    await expect(page.locator('.bm-cell[data-slot="3"]'), 'a wild one: RUN works').toHaveAttribute('aria-disabled', 'false');

    // A trainer fight with no POKe DOLL: RUN greys out. (The flag, for a frame or two.)
    const flags = await read(page, sym.gBattleTypeFlags, 32);
    await write(page, sym.gBattleTypeFlags, flags | BATTLE_TYPE_TRAINER, 32);
    await expect(page.locator('.bm-cell[data-slot="3"]')).toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: path.join(OUT_DIR, 'battle-menu-no-doll.png') });
    await write(page, sym.gBattleTypeFlags, flags, 32);
    await expect(page.locator('.bm-cell[data-slot="3"]')).toHaveAttribute('aria-disabled', 'false');

    // FIGHT: the moves, and the ROM's own move menu opened behind them (its shot clock
    // picks a move then, not RUN).
    await page.locator('.bm-cell[data-slot="0"]').tap();
    await expect(page.locator('#battle-menu')).toHaveAttribute('data-mode', 'moves');
    await expect(page.locator('.bm-cell[data-slot="0"]')).toHaveAttribute('aria-label', /^POUND, NORMAL, PP \d+\/35$/);
    await expect(page.locator('.bm-back')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'battle-menu-moves.png') });

    // Held: its details, in the same place.
    const pound = await box('.bm-cell[data-slot="0"]');
    await page.mouse.move(pound.x + pound.width / 2, pound.y + pound.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, 'battle-menu-holding.png') });
    await page.waitForTimeout(500);
    await page.mouse.up();
    await expect(page.locator('#battle-menu')).toHaveAttribute('data-mode', 'info');
    await expect(page.locator('.bm-info')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'battle-menu-info.png') });
    // CLOSE and USE fill the sheet's width, whole: neither window is cut.
    const sheet = await box('.bm-info > canvas');
    const close = await box('.bm-close');
    const use = await box('.bm-use');
    expect(close.width / scale).toBeCloseTo(72, 0);
    expect(close.x).toBeCloseTo(sheet.x, 0);
    expect(use.x + use.width).toBeCloseTo(sheet.x + sheet.width, 0);
    await page.locator('.bm-close').tap();
    await expect(page.locator('#battle-menu')).toHaveAttribute('data-mode', 'moves');
    expect(await read(page, sym.gBattle_BG0_Y, 16), "the move box off").toBe(0);

    // How each lands: a band and a mark per grade. Four moves and a foe's types, for a
    // look; put back before anything is chosen.
    const ours = sym.gBattleMons + MON_MOVES;
    const foeTypes = sym.gBattleMons + MON_SIZE + MON_TYPES;
    const kept = await Promise.all([0, 1, 2, 3].map((i) => read(page, ours + 2 * i, 16)));
    const keptTypes = await read(page, foeTypes, 16);
    const pps = sym.gBattleMons + MON_PP;
    const keptPp = await read(page, pps, 32);
    await write(page, pps, 0x0a141405, 32);
    const show = [MOVE_ABSORB, MOVE_POWDER_SNOW, MOVE_POUND, MOVE_THUNDER_SHOCK];
    for (const [i, m] of show.entries()) await write(page, ours + 2 * i, m, 16);
    await write(page, foeTypes, TYPE_ROCK | (TYPE_GROUND << 8), 16);
    await expect(page.locator('.bm-cell[data-slot="3"]')).toHaveAttribute('aria-label', /^THUNDERSHOCK, /);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'battle-menu-effects.png') });
    for (const [i, m] of kept.entries()) await write(page, ours + 2 * i, m, 16);
    await write(page, foeTypes, keptTypes, 16);
    await write(page, pps, keptPp, 32);
    await expect(page.locator('.bm-cell[data-slot="0"]')).toHaveAttribute('aria-label', /^POUND, NORMAL/);

    // BACK, and FIGHT again.
    await page.locator('.bm-back').tap();
    await expect(page.locator('#battle-menu')).toHaveAttribute('data-mode', 'action');
    await page.locator('.bm-cell[data-slot="0"]').tap();

    // Tapped: POUND, through FIGHT and the move menu. The windows go while it plays.
    await write(page, sym.gCurrentMove, 0, 16);
    await page.locator('.bm-cell[data-slot="0"]').tap();
    await expect(menu).toBeHidden();
    await expect.poll(() => read(page, sym.gCurrentMove, 16), { timeout: 10_000 }).toBe(MOVE_POUND);
    // While it plays out, nothing for the D-pad or A/B to do: they stay down (Cam,
    // 2026-10-15). In a battle the dock's windows go; the room menu stays.
    await padDown(false);
    expect(await page.locator('#hud-party').evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
    await expect(page.locator('#hud-menu')).toBeVisible();
    await page.screenshot({ path: path.join(OUT_DIR, 'battle-menu-attack.png') });
    expect(errors, 'nothing thrown on the page').toEqual([]);
  } finally {
    await ctx.close();
  }
});
