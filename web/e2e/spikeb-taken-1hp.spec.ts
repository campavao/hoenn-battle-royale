// A beaten trainer's team joins at 1 HP (Cam, 2026-11-14: "I thought we fixed the bug where pokemon
// picked up after a battle were at full HP rather than 1 HP?"). Kanto is the spec: a fallen trainer's
// team lands as Poke Balls, and a taken one "joins your party at 1 HP, exactly as it fell" (its README;
// lib/spills.lua: "each holding one of their Pokemon at 1 HP"). The ROM makes a ball's mon fresh, at
// full HP (br_loot.c MakeTaken), so the page puts it on 1, as it puts a released one back on the HP it
// went with (spikeb-swap-heal.spec.ts).
//
// Through the game: a mon out of the DAY CARE's chest (a gift: whole, as before), A at a bot, the
// battle on the real ROM until the bot is beaten, its bag where it stood, A on the bag, POKeMON, and
// one of its team taken. Its HP is read off gPlayerParty.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
/** room.ts SPILL_KEY: a trainer's bag where they fell is SPILL_KEY + their id. */
const SPILL_KEY = 1 << 20;

/** Each party slot's HP and most, off the ROM's own gPlayerParty (struct Pokemon, 86 and 88). */
const hps = (page: Page) => page.evaluate(() => {
  const s = (window as any).__spike, at = s.art.sym('gPlayerParty'), n = s.rom.partyCount() as number;
  const b = s.rom.emu.bytes(at, 600) as Uint8Array;
  return Array.from({ length: n }, (_, i) => ({ hp: b[i * 100 + 86] | (b[i * 100 + 87] << 8), maxHp: b[i * 100 + 88] | (b[i * 100 + 89] << 8) }));
});

test("a beaten bot's team, taken from its bag, joins at 1 HP", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?rom=${romHashParam()}#solo&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me) && !!s.art; }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  const party = () => page.evaluate(() => (window as any).__spike.rom.partyCount() as number);
  const swapping = () => page.evaluate(() => (window as any).__spike.swapping as boolean);

  // The bots stand where they are; a mon out of the DAY CARE's chest (spikeb-botbag.spec.ts).
  await page.evaluate(() => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    for (const b of s.link.room.actors) if (b.bot) b.calm = 2 ** 30;
    a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 };
    a.calm = 0;
  });
  await page.waitForTimeout(800);
  for (let i = 0; i < 40 && !(await party()); i++) {
    if (await page.locator('.bm-slot').first().isVisible()) {
      await page.locator('.bm-slot').first().click();
      await page.waitForTimeout(1500);
    } else if (!(await swapping())) {
      await tap('z');
      await page.waitForTimeout(800);
    } else await page.waitForTimeout(500);
  }
  expect(await party(), 'a mon out of the chest').toBe(1);
  await expect.poll(swapping, { timeout: 30_000 }).toBe(false);
  const chest = (await hps(page))[0];
  expect(chest.hp, `the chest's is whole, as before: ${JSON.stringify(chest)}`).toBe(chest.maxHp);

  // Somewhere open, a bot beside me and facing me; A at it starts the fight (room.ts, A at a bot).
  const bot = await page.evaluate(() => {
    const s = (window as any).__spike, room = s.link.room, me = room.actor(s.link.me);
    const b = room.actors.find((a: any) => a.bot && !a.battling);
    const mine = { map: 'MAP_ROUTE101', x: 10, y: 10 }, theirs = { map: 'MAP_ROUTE101', x: 11, y: 10 };
    me.m = { ...me.m, spot: mine, prev: mine, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
    b.m = { ...b.m, spot: theirs, prev: theirs, facing: 3, moveDir: 3, action: null, px: 0, py: 0 };
    me.calm = 0;
    return b.id as number;
  });
  await page.waitForTimeout(800);
  for (let i = 0; i < 10 && !(await page.evaluate(() => !!(window as any).__spike.battle)); i++) {
    await tap('z');
    await page.waitForTimeout(1500);
  }
  await page.waitForFunction(() => !!(window as any).__spike.battle, undefined, { timeout: 120_000 });
  // The fight, move by move. A chest mon is level 5 and the bot's are at the rung: mine is back on its
  // most before each move, and each of theirs is on 1 HP (time skipped: hits the battle could have come
  // to, nothing past a most). A move with no damage in it is a turn gone, so they go round.
  let turns = 0;
  for (let i = 0; i < 600 && (await page.evaluate(() => !!(window as any).__spike.battle)); i++) {
    await page.evaluate(() => {
      const s = (window as any).__spike, at = s.art.sym('gBattleMons'), emu = s.rom.emu;
      emu.write(at + 0x28, emu.read(at + 0x2c, 16), 16);
      if (emu.read(at + 0x58 + 0x28, 16) > 1) emu.write(at + 0x58 + 0x28, 1, 16);
    });
    const cell = page.locator('.bm-cell').nth(turns % 4);
    if (await cell.isVisible().catch(() => false)) {
      await cell.click({ timeout: 2000 }).catch(() => undefined);
      turns++;
    } else if (await page.locator('.bm-m-btn').first().isVisible().catch(() => false)) await page.locator('.bm-m-btn').first().click({ timeout: 2000 }).catch(() => undefined);
    else await tap('z');
    await page.waitForTimeout(400);
  }
  await expect.poll(() => page.evaluate(() => (window as any).__spike.lastResult as string), { timeout: 30_000 }).toMatch(/won|WON|win/i);

  // Beaten: out, and its bag where it stood, its team in it.
  const at = await page.evaluate((k) => { const b = (window as any).__spike.link.room.spills.get(k); return b ? { map: b.map, x: b.x, y: b.y, mons: b.bag.mons } : null; }, SPILL_KEY + bot);
  expect(at, "the bot's bag is down").not.toBeNull();
  console.log('the bag\'s team:', JSON.stringify(at!.mons));
  expect(at!.mons.length).toBeGreaterThan(0);

  // A on it, POKeMON, and the first of its team.
  await page.evaluate((to) => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    const spot = { map: to.map, x: to.x, y: to.y + 1 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    a.calm = 0;
  }, at!);
  await page.waitForTimeout(800);
  await tap('z');
  await page.getByRole('button', { name: 'POKéMON' }).click({ timeout: 20_000 });
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('.bm-slot').first().click();
  await expect.poll(party, { timeout: 60_000 }).toBe(2);
  await page.waitForTimeout(2000);
  const after = await hps(page);
  console.log('the party after the take:', JSON.stringify(after));
  const joined = after[1];
  expect(joined.maxHp).toBeGreaterThan(1);
  expect(joined.hp, `taken on ${joined.hp}/${joined.maxHp}: a beaten trainer's joins at 1 HP`).toBe(1);
  // Back: the rest of its team stays in the bag, still fallen.
  await page.getByRole('button', { name: 'Back' }).click({ timeout: 30_000 }).catch(() => undefined);
  await expect.poll(swapping, { timeout: 30_000 }).toBe(false);
  expect(errors).toEqual([]);
});
