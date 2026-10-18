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

/** Solo on a phone into a wild battle off a patch in the grass west of the landing,
 *  up to its action menu. */
async function intoWildBattle(page: Page, sym: Record<string, number>): Promise<Ram> {
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
  return until(page, sym, 'a wild battle', (x) => x.inBattle, 10_000);
}

test("a phone's battle menu: under the picture, the moves, a hold for details, a tap to attack", async ({ browser }) => {
  test.setTimeout(300_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const r = await intoWildBattle(page, sym);
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

// The bag (Cam's mockup v3): BAG opens the page's own -- three pockets behind big arrows
// and a swipe, each row with the game's icon and count, the description under them, and
// only what a battle can use. USE is the ROM's BAG doing it (src/br/br_bag.c).
const SAVE1_ITEMS = 0x560;
const SAVE1_BALLS = 0x650;
const SAVE1_BERRIES = 0x790;
const SAVE2_KEY = 0xac;
const ITEM = { POTION: 13, SUPER_POTION: 22, X_ATTACK: 75, ESCAPE_ROPE: 85, POKE_BALL: 4, GREAT_BALL: 3, ORAN_BERRY: 139, SITRUS_BERRY: 142 };

test("a phone's bag: pockets, a swipe, the description, and USE throws the ball", async ({ browser }) => {
  test.setTimeout(300_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await intoWildBattle(page, sym);
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 30_000 }).toBe(BR_MENU_ACTION);

    // A bag to look at: the key zeroed so a count is a count, and an ESCAPE ROPE among
    // the potions, which a battle cannot use and so is not listed.
    const save1 = await read(page, sym.gSaveBlock1Ptr, 32);
    const save2 = await read(page, sym.gSaveBlock2Ptr, 32);
    await write(page, save2 + SAVE2_KEY, 0, 32);
    const stock = async (at: number, stacks: [number, number][]) => {
      for (const [i, [item, n]] of stacks.entries()) {
        await write(page, save1 + at + 4 * i, item, 16);
        await write(page, save1 + at + 4 * i + 2, n, 16);
      }
    };
    await stock(SAVE1_ITEMS, [[ITEM.POTION, 3], [ITEM.ESCAPE_ROPE, 1], [ITEM.SUPER_POTION, 2], [ITEM.X_ATTACK, 1]]);
    await stock(SAVE1_BALLS, [[ITEM.POKE_BALL, 5], [ITEM.GREAT_BALL, 2]]);
    await stock(SAVE1_BERRIES, [[ITEM.ORAN_BERRY, 4], [ITEM.SITRUS_BERRY, 1]]);

    const menu = page.locator('#battle-menu');
    await page.locator('.bm-cell[data-slot="1"]').tap();
    await expect(menu).toHaveAttribute('data-mode', 'bag');
    await expect(page.locator('.bm-bag-list')).toBeVisible();
    // Still the ROM's action menu behind it: nothing was pressed in the game.
    expect(await read(page, sym.gBrBattle + 8, 8)).toBe(BR_MENU_ACTION);
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-label', 'Use POTION');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-items.png') });

    // Inside the glass, and nothing on top of anything.
    const boxes = await Promise.all(['.bm-bag-head', '.bm-bag-list', '.bm-bag:not(.bm-bag-head):not(.bm-bag-list):not(.bm-info-row)', '.bm-bag-back', '.bm-bag-use'].map(async (sel) => (await page.locator(sel).boundingBox())!));
    for (const [i, c] of boxes.entries()) {
      expect(c.x, `box ${i}`).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width, `box ${i}`).toBeLessThanOrEqual(PORTRAIT.width + 0.5);
      expect(c.y + c.height, `box ${i}`).toBeLessThanOrEqual(PORTRAIT.height + 0.5);
      for (const [j, d] of boxes.entries()) {
        if (j <= i) continue;
        const overlap = c.x < d.x + d.width - 0.5 && d.x < c.x + c.width - 0.5 && c.y < d.y + d.height - 0.5 && d.y < c.y + c.height - 0.5;
        expect(overlap, `boxes ${i} and ${j}`).toBe(false);
      }
    }

    // A row tapped: the cursor and the description follow it.
    const list = (await page.locator('.bm-bag-list').boundingBox())!;
    const scale = list.width / 232;
    await page.mouse.click(list.x + list.width / 2, list.y + (8 + 24 * 1 + 12) * scale);
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-label', 'Use SUPER POTION');
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-items-picked.png') });

    // The right arrow: POKe BALLS. A swipe left from there: BERRIES. The left arrow back.
    await page.locator('.bm-bag-next').tap();
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-label', 'Use POKé BALL');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-balls.png') });
    const y = list.y + list.height / 2;
    await page.mouse.move(list.x + list.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(list.x + list.width * 0.2, y, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-label', 'Use ORAN BERRY');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-berries.png') });
    await page.locator('.bm-bag-prev').tap();

    // A trainer's POKeMON: the ball says why not, and USE will not go. (The flag, for a
    // frame or two.)
    const flags = await read(page, sym.gBattleTypeFlags, 32);
    await write(page, sym.gBattleTypeFlags, flags | BATTLE_TYPE_TRAINER, 32);
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-disabled', 'true');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-balls-trainer.png') });
    await write(page, sym.gBattleTypeFlags, flags, 32);
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-disabled', 'false');

    // USE: the ROM's own BAG opens on POKe BALLS, takes the row and USE, and throws.
    await page.locator('.bm-bag-use').tap();
    await expect(menu).toBeHidden();
    await expect.poll(() => read(page, save1 + SAVE1_BALLS + 2, 16), { timeout: 20_000 }).toBe(4);
    expect(await read(page, save1 + SAVE1_BALLS + 6, 16), 'the GREAT BALLs kept').toBe(2);
    expect(await read(page, sym.gBrBag, 16), 'the pick spent').toBe(0);
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-thrown.png') });
    expect(errors, 'nothing thrown on the page').toEqual([]);
  } finally {
    await ctx.close();
  }
});

// POK-415 (Cam, 2026-10-18): on a 375-wide phone with Safari's bars the bag ran past the
// bottom of the glass, so USE was never on screen and a tap on an item only moved the
// cursor. The list gives up room instead, and a second tap on the cursor's row uses it.
const SHORT_PHONE = { width: 375, height: 667 };

test("a short phone's bag: USE stays on the glass, and a second tap on a row uses it", async ({ browser }) => {
  test.setTimeout(300_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: SHORT_PHONE, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await intoWildBattle(page, sym);
    await expect.poll(() => read(page, sym.gBrBattle + 8, 8), { timeout: 30_000 }).toBe(BR_MENU_ACTION);
    const save1 = await read(page, sym.gSaveBlock1Ptr, 32);
    const save2 = await read(page, sym.gSaveBlock2Ptr, 32);
    await write(page, save2 + SAVE2_KEY, 0, 32);
    for (const [i, [item, n]] of ([[ITEM.POKE_BALL, 5], [ITEM.GREAT_BALL, 6]] as const).entries()) {
      await write(page, save1 + SAVE1_BALLS + 4 * i, item, 16);
      await write(page, save1 + SAVE1_BALLS + 4 * i + 2, n, 16);
    }

    await page.locator('.bm-cell[data-slot="1"]').tap();
    await expect(page.locator('#battle-menu')).toHaveAttribute('data-mode', 'bag');
    await page.locator('.bm-bag-next').tap();
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-label', 'Use POKé BALL');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-short-phone.png') });
    // A tap on the row the bag opened on only reads it.
    const list = (await page.locator('.bm-bag-list').boundingBox())!;
    const rowY = (row: number) => list.y + (8 + 24 * row + 12) * (list.width / 232);
    await page.touchscreen.tap(list.x + list.width / 2, rowY(0));
    await page.waitForTimeout(300);
    expect(await read(page, save1 + SAVE1_BALLS + 2, 16), 'a first tap throws nothing').toBe(5);
    await expect(page.locator('#battle-menu')).toHaveAttribute('data-mode', 'bag');
    // Every window of the bag, BACK and USE too, wholly on the glass.
    for (const sel of ['.bm-bag-head', '.bm-bag-list', '.bm-bag-back', '.bm-bag-use']) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.y + b.height, sel).toBeLessThanOrEqual(SHORT_PHONE.height + 0.5);
    }

    // The first tap on GREAT BALL picks it; the second throws it.
    await page.touchscreen.tap(list.x + list.width / 2, rowY(1));
    await expect(page.locator('.bm-bag-use')).toHaveAttribute('aria-label', 'Use GREAT BALL');
    expect(await read(page, save1 + SAVE1_BALLS + 6, 16), 'one tap throws nothing').toBe(6);
    await page.touchscreen.tap(list.x + list.width / 2, rowY(1));
    await expect(page.locator('#battle-menu')).toBeHidden();
    await expect.poll(() => read(page, save1 + SAVE1_BALLS + 6, 16), { timeout: 20_000 }).toBe(5);
    expect(await read(page, save1 + SAVE1_BALLS + 2, 16), 'the POKé BALLs kept').toBe(5);
    await page.screenshot({ path: path.join(OUT_DIR, 'bag-short-phone-thrown.png') });
    expect(errors, 'nothing thrown on the page').toEqual([]);
  } finally {
    await ctx.close();
  }
});
