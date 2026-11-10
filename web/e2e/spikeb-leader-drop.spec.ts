// A gym leader's team is loot (Cam, 2026-11-10: "the gym leader gives good loot (good pokemon...)"):
// beaten, ROXANNE's GEODUDE, GEODUDE and NOSEPASS lie in a bag beside the winner, at the rung they were
// fought at, and A on it offers them to take, as a fallen trainer's team is (Kanto's npcDefeated).
// The prize TM is in the bag too (br_gym.c sBosses: BRICK BREAK, TM31).
import { expect, test } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const TM31 = 319;
const LEADER_SPILL = 5 << 20;
/** The ROM's own species numbers (constants/species.h): GEODUDE 74, NOSEPASS 320. */
const GEODUDE = 74, NOSEPASS = 320;

test("ROXANNE beaten: her team lies beside the winner to take, and her TM is in the bag", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me) && !!s.art; }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  // A mon out of the day care's chest, to fight with (spikeb-botbag.spec.ts).
  await page.evaluate(() => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 };
    a.calm = 0;
  });
  await page.waitForTimeout(800);
  const party = () => page.evaluate(() => (window as any).__spike.rom.partyCount() as number);
  for (let i = 0; i < 40 && !(await party()); i++) {
    if (await page.locator('.bm-slot').first().isVisible()) {
      await page.locator('.bm-slot').first().click();
      await page.waitForTimeout(1500);
    } else if (!(await page.evaluate(() => (window as any).__spike.swapping))) {
      await tap('z');
      await page.waitForTimeout(800);
    } else await page.waitForTimeout(500);
  }
  expect(await party(), 'a mon out of the chest').toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__spike.swapping), { timeout: 30_000 }).toBe(false);

  // Stand before ROXANNE, in her gym, facing her, and press A: the room starts her battle.
  await page.evaluate(() => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    const spot = { map: 'MAP_RUSTBORO_CITY_GYM', x: 5, y: 3 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    a.calm = 0;
  });
  await page.waitForTimeout(800);
  await tap('z');
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s.battle; }, undefined, { timeout: 120_000 });
  // Her whole team: the foe's HP at 1 before each move, until it is over.
  // (My mon is a level-5 chest mon: made hard to hurt and to hit hard with: a fallen foe is never poked back up.)
  for (let i = 0; i < 500 && (await page.evaluate(() => !!(window as any).__spike.battle)); i++) {
    await page.evaluate(() => {
      const s = (window as any).__spike, at = s.art.sym('gBattleMons'), w = (o: number, v: number) => s.rom.emu.write(at + o, v, 16);
      for (const o of [0x02, 0x04, 0x0a, 0x28, 0x2c]) w(o, 999);
    });
    const cell = page.getByRole('button', { name: /^(BITE|TACKLE|SCRATCH|POUND|PECK|QUICK ATTACK|ASTONISH|WATER GUN|EMBER|VINE WHIP)/ }).first();
    if (await cell.isVisible().catch(() => false)) await cell.click({ timeout: 2000 }).catch(() => undefined);
    else if (await page.locator('.bm-m-btn').first().isVisible().catch(() => false)) await page.locator('.bm-m-btn').first().click({ timeout: 2000 }).catch(() => undefined);
    else await tap('z'); // the end's text, and the purse box, turn on A
    await page.waitForTimeout(400);
  }
  await expect.poll(() => page.evaluate(() => (window as any).__spike.lastResult as string), { timeout: 30_000 }).toMatch(/won|WON|win/i);

  // The room has her down, and her team on the floor beside me: what she fought with, at the rung.
  const drop = await page.evaluate((k) => {
    const room = (window as any).__spike.link.room, b = room.spills.get(k);
    return { down: room.bossDown(0), bag: b?.bag, at: b ? { map: b.map, x: b.x, y: b.y } : null };
  }, LEADER_SPILL | 0);
  expect(drop.down).toBe(true);
  expect(drop.at?.map).toBe('MAP_RUSTBORO_CITY_GYM');
  expect(drop.bag.mons.map((m: any) => m.species)).toEqual([GEODUDE, GEODUDE, NOSEPASS]);
  expect(new Set(drop.bag.mons.map((m: any) => m.level)).size, 'all at the rung').toBe(1);

  // The prize TM: BRICK BREAK, first in the TM pocket.
  const held = await page.evaluate(() => { const s = (window as any).__spike; return [0, 1, 2, 3, 4].flatMap((n) => s.pocket(n) as { item: number }[]).map((r) => r.item); });
  expect(held).toContain(TM31);

  // Walk to the bag and press A: her team is offered, and taking one puts it in my party.
  await page.evaluate((to) => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    const at = { map: to.map, x: to.x, y: to.y + 1 };
    a.m = { ...a.m, spot: at, prev: at, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    a.calm = 0;
  }, drop.at!);
  const before = await party();
  await page.waitForTimeout(800);
  await tap('z');
  await expect.poll(() => page.evaluate(() => (window as any).__spike.swapping), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 10_000 });
  await page.locator('.bm-slot').first().click();
  await expect.poll(party, { timeout: 30_000 }).toBe(Math.min(before + 1, 6));
  expect(errors).toEqual([]);
});
