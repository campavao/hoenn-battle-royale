// Cam's 11-08 play-test: in a battle, PARTY and a mon went back to "What will ALAKAZAM do?" whichever
// mon was picked; ALAKAZAM was hurt and perhaps badly poisoned. A real fight on a real ROM against a
// foe whose only move is TOXIC, then a switch to each of the others in turn.
import { expect, test, type Page } from '@playwright/test';
import { giveTeam, type Craft } from './craft';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const MOVE_TOXIC = 92;
const STATUS1_TOXIC_POISON = 1 << 7;
const NAMES = ['ALAKAZAM', 'AZUMARILL', 'SQUIRT', 'PIKA', 'KARP', 'EEVEE'];
// GROWL and nothing else: the fight lasts as long as it is asked to.
const TEAM: Craft[] = NAMES.map((name, i) => ({ species: [65, 184, 7, 25, 129, 133][i], name, level: 30, moves: [45], hp: 200, stats: [90, 60, 60, 60, 60], personality: 1000 + i * 25 }));

async function withTeam(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.evaluate(() => { (window as any).__calm = setInterval(() => { for (const a of (window as any).__spike.link.room.actors) if (a.bot) a.calm = 2 ** 30; }, 100); });
  await page.waitForTimeout(2000);
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  await giveTeam(page, TEAM);
}

/** A fight with a bot whose one mon knows TOXIC and nothing else, and has HP to spare (or is
 *  `species`, as it comes). */
async function intoFight(page: Page, species = 19): Promise<void> {
  await page.evaluate((species) => {
    const s = (window as any).__spike, r = s.rom, fight = r.fight;
    r.fight = (name: string, party: any[], ...rest: unknown[]) => {
      r.fight = fight;
      const mon = party[0];
      return fight.call(r, name, [{ ...mon, species, nickname: 'FOE', level: 30, hp: 250, maxHp: 250 }], ...rest);
    };
    const room = s.link.room, foe = room.actors.find((a: any) => a.bot);
    Object.assign(room.actor(s.link.me), { battling: true, foe: foe.id });
    Object.assign(foe, { battling: true, foe: s.link.me, foughtBy: s.link.me });
    s.startFor({ type: 'fight', tick: 0, id: s.link.me, foe: foe.id });
  }, species);
  await menuUp(page);
  if (species !== 19) return;
  // TOXIC and nothing else, on the foe out (gBattleMons[1]: its moves at 0x0C, PP at 0x24). The ROM
  // builds a bot's moves from its own learnset, not the card's.
  await page.evaluate((toxic) => {
    const s = (window as any).__spike, e = s.rom.emu, at = s.art.sym('gBattleMons') + 0x58;
    for (let i = 0; i < 4; i++) { e.write(at + 0x0c + 2 * i, i ? 0 : toxic, 16); e.write(at + 0x24 + i, i ? 0 : 40, 8); }
  }, MOVE_TOXIC);
}

async function menuUp(page: Page): Promise<void> {
  await expect(page.locator('.bm-cell').first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(200);
}

const lead = (page: Page) => spike(page, (s) => s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16) as number);
/** The one out: its HP, max HP and status, from gBattleMons[0]. */
const out = (page: Page) => spike(page, (s) => {
  const e = s.rom.emu, at = s.art.sym('gBattleMons');
  return { hp: e.read(at + 0x28, 16) as number, maxHp: e.read(at + 0x2c, 16) as number, status: e.read(at + 0x4c, 32) as number };
});

/** The foe's HP back to full: the fog's tenth a turn would end the fight before the switches are through. */
const topUp = (page: Page) => spike(page, (s) => { const e = s.rom.emu, at = s.art.sym('gBattleMons') + 0x58; e.write(at + 0x28, e.read(at + 0x2c, 16), 16); });

/** One turn of GROWL: the menu goes, and comes back. */
async function growl(page: Page): Promise<void> {
  await topUp(page);
  await page.locator('.bm-cell').first().click();
  await expect(page.locator('.bm-cell').first()).toBeHidden({ timeout: 20_000 });
  await menuUp(page);
}

/** PARTY, the row naming `name`, SHIFT; then the one out, once the turn is through. */
async function switchTo(page: Page, name: string): Promise<number> {
  await page.keyboard.press('q');
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  const at = await page.evaluate((name) => (window as any).__spike.battleMenu.team.findIndex((m: any) => m.name === name), name);
  expect(at, `${name} has a row`).toBeGreaterThanOrEqual(0);
  await page.locator('.bm-slot').nth(at).click();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(async () => NAMES[await lead(page)], { timeout: 40_000, message: `${name} went out` }).toBe(name);
  await menuUp(page);
  console.log(`${name} out: ${JSON.stringify(await out(page))}`);
  return lead(page);
}

test('a hurt, badly poisoned lead switches out for each of the others, and back in', async ({ browser }) => {
  test.setTimeout(400_000);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (/battle|fight|result|outcome/i.test(m.text())) console.log(`page: ${m.text()}`); });
  await withTeam(page);
  await intoFight(page);
  expect(NAMES[await lead(page)]).toBe('ALAKAZAM');
  // GROWL until TOXIC lands, counting from the turn it does. Which turn that is, is the game's: the
  // foe's first move was picked from its own learnset before TOXIC was written in, and the ROM plays
  // whatever now sits in that slot (TOXIC, or a move with no PP); and TOXIC is 85% accurate, so a
  // "missed!" is a turn with no poison.
  let before = await out(page);
  for (let turn = 1; !(before.status & STATUS1_TOXIC_POISON); turn++) {
    expect(turn, 'TOXIC lands within 8 turns').toBeLessThanOrEqual(8);
    await growl(page);
    const now = await out(page);
    const landed = !!(now.status & STATUS1_TOXIC_POISON);
    console.log(`turn ${turn}: ${JSON.stringify(now)}${landed ? ', TOXIC landed' : ''}`);
    // Gen 3's TOXIC: n/16 of max HP on the nth turn it has been poisoned (12, 24, ... of 200), the
    // count back to 1 on a switch (battle_util.c ENDTURN_POISON).
    expect(before.hp - now.hp, landed ? 'the turn TOXIC lands, 1/16' : 'no TOXIC yet, no hurt').toBe(landed ? 12 : 0);
    before = now;
  }
  await growl(page);
  const hurt = await out(page);
  console.log(`ALAKAZAM a turn after TOXIC: ${JSON.stringify(hurt)}`);
  expect(hurt.status & STATUS1_TOXIC_POISON, 'badly poisoned').toBeTruthy();
  expect(before.hp - hurt.hp, 'the next turn, 2/16').toBe(24);
  let was = hurt.hp;
  for (const name of NAMES.slice(1, 3)) {
    await switchTo(page, name);
    await growl(page);
    await switchTo(page, 'ALAKAZAM');
    const now = await out(page);
    expect(now.status & STATUS1_TOXIC_POISON, 'ALAKAZAM still badly poisoned').toBeTruthy();
    expect(was - now.hp, 'back in, the count starts over at 1/16').toBe(12);
    was = now.hp;
  }
  await ctx.close();
});

for (const { name, opts } of [
  { name: 'keyboard', opts: { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } } },
  { name: 'phone', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
]) test(`a trapped mon says why it can't switch, on the page, and the turn is still ours: ${name}`, async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await withTeam(page);
  // WOBBUFFET: SHADOW TAG, its only ability, holds whoever faces it.
  await intoFight(page, 202);
  expect(NAMES[await lead(page)]).toBe('ALAKAZAM');
  await page.locator('.bm-act-party').click();
  await expect(page.locator('.bm-slot').first()).toBeVisible();
  const at = await page.evaluate(() => (window as any).__spike.battleMenu.team.findIndex((m: any) => m.name === 'AZUMARILL'));
  await page.locator('.bm-slot').nth(at).click();
  await page.locator('.bm-m-btn').nth(2).click();
  await expect(page.locator('#msg'), "the ROM's reason, on the page").toHaveAttribute('data-text', /SHADOW TAG prevents switching|can't be switched out/, { timeout: 30_000 });
  await menuUp(page);
  expect(NAMES[await lead(page)], 'still out').toBe('ALAKAZAM');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: test.info().outputPath(`trapped-says-why-${name}.png`) });
  // ...and the turn is ours: a move goes through.
  await growl(page);
  await ctx.close();
});
