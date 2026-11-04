// Who is in which slot once a battle has moved them about (Cam's 11-04 play-test: "I didn't do
// Azumarill, it was Alakazam"). The page's rows are slots of the ROM's party screen, which it
// walks unseen: a row has to be the mon the ROM's slot is, after my switches and the foe's, and
// the balls under YOU have to stay with their mons while that screen is up.
//
// A real fight on a real ROM, against a bot with two mons so that it has to send out its second:
// the foe's switch is the one that overwrites gBattlePartyCurrentOrder.
import { expect, test, type Page } from '@playwright/test';
import { giveTeam, type Craft } from './craft';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const withArg = <T>(page: Page, src: string, arg: unknown) => page.evaluate(([src, arg]) => new Function('s', 'a', `return (${src})(s, a)`)((window as any).__spike, arg), [src, arg] as const) as Promise<T>;

const ITEM_REVIVE = 24;

/** Six told apart by name, the first two moves each a hit and a nothing much; bots that will not
 *  walk up. */
const NAMES = ['BULBA', 'CHARM', 'SQUIRT', 'PIKA', 'KARP', 'EEVEE'];
const TEAM: Craft[] = NAMES.map((name, i) => ({ species: [1, 4, 7, 25, 129, 133][i], name, level: 20, moves: [33, 45], hp: 300, stats: [90, 60, 60, 60, 60], personality: 1000 + i * 25 }));

async function withTeam(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.evaluate(() => { (window as any).__calm = setInterval(() => { for (const a of (window as any).__spike.link.room.actors) if (a.bot) a.calm = 2 ** 30; }, 100); });
  await page.waitForTimeout(2000);
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  await giveTeam(page, TEAM);
  await withArg(page, '(s, id) => s.rom.give(id, 5)', ITEM_REVIVE);
}

/** A fight with a bot whose team is two, the first at a touch of HP. */
async function intoFight(page: Page): Promise<void> {
  await spike(page, (s) => {
    const r = s.rom, fight = r.fight;
    r.fight = (name: string, party: any[], ...rest: unknown[]) => {
      r.fight = fight;
      const mon = party[0];
      // Not whatever the seed dealt: a WOBBUFFET's SHADOW TAG says no to every switch.
      return fight.call(r, name, [{ ...mon, species: 19, nickname: 'RATTATA', hp: 1 }, { ...mon, species: 16, nickname: 'PIDGEY', personality: mon.personality + 1 }], ...rest);
    };
    const room = s.link.room, foe = room.actors.find((a: any) => a.bot);
    Object.assign(room.actor(s.link.me), { battling: true, foe: foe.id });
    Object.assign(foe, { battling: true, foe: s.link.me, foughtBy: s.link.me });
    s.startFor({ type: 'fight', tick: 0, id: s.link.me, foe: foe.id });
  });
  await expect(page.locator('.bm-cell').first()).toBeVisible({ timeout: 90_000 });
}

/** The field party's raw words, by the ROM. */
const field = (page: Page) => spike(page, (s) => {
  const at = s.art.sym('gPlayerParty'), e = s.rom.emu;
  return [0, 1, 2, 3, 4, 5].map((i) => ({ personality: e.read(at + i * 100, 32), hp: e.read(at + i * 100 + 86, 16) }));
});
const lead = (page: Page, battler = 0) => withArg<number>(page, `(s, b) => s.rom.emu.read(s.art.sym('gBattlerPartyIndexes') + 2 * b, 16)`, battler);

async function menuUp(page: Page): Promise<void> {
  await expect(page.locator('.bm-cell').first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(200);
}

/** Stage: my lead switched for the fourth, the bot's first down and its second sent out. */
async function stage(page: Page): Promise<{ names: string[] }> {
  await withTeam(page);
  await intoFight(page);
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.locator('.bm-slot').nth(3).click();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(() => lead(page), { timeout: 40_000, message: 'the fourth went out' }).toBe(3);
  // Whatever it knows that hits, until the bot sends out its second.
  for (let i = 0; i < 12; i++) {
    await menuUp(page);
    if (await lead(page, 1) === 1) break;
    const hit = await spike(page, (s) => { const m = s.battleMenu; for (let n = 0; n < 4; n++) if (m.moveInfoAt(n)?.power > 1 && m.view.moves[n].pp > 0) return n; return 0; });
    await page.locator('.bm-cell').nth(hit).click();
    await page.waitForTimeout(1000);
    await expect.poll(async () => (await lead(page, 1)) === 1 || !(await page.locator('.bm-cell').first().isVisible()), { timeout: 20_000 }).toBe(true);
  }
  expect(await lead(page, 1), "the bot's second is out").toBe(1);
  await menuUp(page);
  const orders = await spike(page, (s) => {
    const e = s.rom.emu, cur = s.art.sym('gBattlePartyCurrentOrder'), st = e.read(s.art.sym('gBattleStruct'), 32) + 96;
    const hex = (at: number) => [0, 1, 2].map((i) => e.read(at + i, 8).toString(16).padStart(2, '0')).join('');
    return { current: hex(cur), mine: hex(st), foe: hex(st + 3) };
  });
  console.log(`gBattlePartyCurrentOrder ${orders.current}, battlerPartyOrders mine ${orders.mine} foe's ${orders.foe}`);
  return { names: NAMES };
}

test("an item goes on the mon its row names, after my switch and the foe's", async ({ browser }) => {
  test.setTimeout(420_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const { names } = await stage(page);

  // The first two, behind the one out, down; as Cam's ALAKAZAM and AZUMARILL were.
  await spike(page, (s) => { const at = s.art.sym('gPlayerParty'); for (const i of [0, 1]) s.rom.emu.write(at + i * 100 + 86, 0, 16); });

  // Balls, every frame from here: the two down stay down where they are, and the one out stays up.
  await page.evaluate(async () => {
    const { readSides } = await import('/src/ui/sides.ts' as string);
    const s = (window as any).__spike, emu = s.rom.emu, sym = s.art.sym;
    const shown = { serial: 0 } as any;
    const seen = new Set<string>();
    (window as any).__balls = seen;
    emu.onFrame(() => { const v = readSides(emu, (n: string) => { const a = sym(n); return Number.isNaN(a) ? undefined : a; }, shown); if (v) seen.add(v.mine.balls.map((b: string) => (b === 'fainted' ? '-' : 'o')).join('')); });
  });

  // The REVIVE, on the row that says the first of the field's: no other.
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  const row = await withArg<number>(page, '(s, item) => s.battleMenu.stacks().findIndex((x) => x.item === item)', ITEM_REVIVE);
  expect(row).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-use-head')).toBeVisible();
  const at = await withArg<number>(page, '(s, name) => s.battleMenu.team.findIndex((m) => m.name === name)', names[0]);
  await page.locator('.bm-slot').nth(at).click();
  // Read back on the battle: while the ROM's party screen is up the party is in its order.
  await expect(page.locator('.bm-use-head')).toBeHidden();
  await page.waitForTimeout(1000);
  await menuUp(page);
  const after = await field(page);
  expect({ first: after[0].hp > 0, second: after[1].hp > 0 }, `REVIVE on ${names[0]}`).toEqual({ first: true, second: false });

  const balls = await page.evaluate(() => [...(window as any).__balls] as string[]);
  console.log(`balls seen: ${balls.join(' ')}`);
  // Field order throughout: 0 and 1 down, or 0 up after the REVIVE.
  expect(balls.sort(), 'each ball stays with its mon').toEqual(['--oooo', 'o-oooo'].filter((b) => balls.includes(b)));
  await ctx.close();
});

test("PARTY sends out the mon its row names, after my switch and the foe's", async ({ browser }) => {
  test.setTimeout(420_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const { names } = await stage(page);
  // The row list is the ROM's slots, the one out first, every time it is asked.
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  const rows = await spike(page, (s) => s.battleMenu.team.map((m: any) => ({ name: m.name, active: m.active })));
  expect(rows.map((r: any) => r.name), 'the one out first, the one it swapped with fourth').toEqual([names[3], names[1], names[2], names[0], names[4], names[5]]);
  expect(rows.map((r: any) => r.active)).toEqual([true, false, false, false, false, false]);
  const at = await withArg<number>(page, '(s, name) => s.battleMenu.team.findIndex((m) => m.name === name)', names[1]);
  await page.locator('.bm-slot').nth(at).click();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(() => lead(page), { timeout: 40_000, message: `${names[1]} went out` }).toBe(1);
  await ctx.close();
});

test('the moves keep the cursor between turns, and a switch-in starts on the first', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await intoFight(page);
  const count = await spike(page, (s) => s.battleMenu.view.moves.filter((m: any) => m.id).length);
  expect(count, 'something to move to').toBeGreaterThan(1);
  await expect(page.locator('.bm-cell').first()).toHaveClass(/bm-focus/);
  // Cam, 11-04: "I was on Zap Cannon, clicked it, then it reset to Giga Drain."
  await page.locator('.bm-cell').nth(count - 1).click();
  await page.waitForTimeout(1500);
  await menuUp(page);
  await expect.poll(() => spike(page, (s) => s.rom.emu.read(s.art.sym('gMoveSelectionCursor'), 8)), { message: "the ROM's cursor" }).toBe(count - 1);
  await expect(page.locator('.bm-cell').nth(count - 1)).toHaveClass(/bm-focus/);
  // BACK from the party is the same cursor.
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('.bm-cell').nth(count - 1)).toHaveClass(/bm-focus/);
  // A mon sent out starts on its first move, as PlayerHandleSwitchInAnim has it.
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  await page.locator('.bm-slot').nth(1).click();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(() => lead(page), { timeout: 40_000 }).toBe(1);
  await page.waitForTimeout(1500);
  await menuUp(page);
  await expect(page.locator('.bm-cell').first()).toHaveClass(/bm-focus/);
  await ctx.close();
});

const LAYOUTS = [
  { name: 'keyboard', box: 1, opts: { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } } },
  // The windows stand over the box here: the clock stays at the top, where it can be seen.
  { name: 'touch-side', box: 2, opts: { viewport: { width: 712, height: 327 }, isMobile: true, hasTouch: true } },
  { name: 'phone', box: 1, opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];
for (const { name, box, opts } of LAYOUTS) {
  test(`the shot clock is in the box, bottom right: ${name}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await withTeam(page);
    await intoFight(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: test.info().outputPath(`clock-${name}.png`) });
    if (process.env.HBR_E2E_SCRATCH) await page.screenshot({ path: `${process.env.HBR_E2E_SCRATCH}/clock-${name}.png` });
    // The page has the menus, which is what puts it there: tools/br/drivers/clock-in-box.txt holds
    // the ROM to the cell. Here, every layout asks for it, and the pictures are the proof it reads.
    const asks = await spike(page, (s) => ({ box: s.rom.emu.read(s.art.sym('gBrHud') + 0x17b, 8), menu: s.rom.emu.read(s.art.sym('gBrBattle') + 8, 8) }));
    expect(asks).toEqual({ box, menu: 1 });
    await ctx.close();
  });
}
