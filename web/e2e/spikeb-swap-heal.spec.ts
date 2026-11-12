// A mon let go keeps the health it had (Cam, 2026-11-11: "the Mon you released should have the same
// health it was at, regardless of what it was at"). The ROM makes a ball's mon fresh, at full HP
// (br_loot.c MakeTaken), so a hurt one released and taken straight back was healed, again and again
// ("Picking up mons fully heals them meaning you can spam swap"). Both ways a mon of yours goes down
// are here: a full party's catch lets one go (room.ts `released`), and a swap on a bag's team gives
// one back (rom.ts team's `put`). Taken again, each has the HP it went with.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The ROM's TREECKO (constants/species.h). */
const TREECKO = 277;

/** Each party slot's HP and most, off the ROM's own gPlayerParty (struct Pokemon, 86 and 88). */
const hps = (page: Page) => page.evaluate(() => {
  const s = (window as any).__spike, at = s.art.sym('gPlayerParty'), n = s.rom.partyCount() as number;
  const b = s.rom.emu.bytes(at, 600) as Uint8Array;
  return Array.from({ length: n }, (_, i) => ({ hp: b[i * 100 + 86] | (b[i * 100 + 87] << 8), maxHp: b[i * 100 + 88] | (b[i * 100 + 89] << 8) }));
});

/** Stand below the ball `k` facing it, and press A on it: its windows come up. */
async function faceAndTake(page: Page, k: number): Promise<void> {
  const at = await page.evaluate((k) => { const b = (window as any).__spike.link.room.spills.get(k); return b ? { map: b.map, x: b.x, y: b.y } : null; }, k);
  expect(at, `the ball ${k} is down`).not.toBeNull();
  await page.evaluate((to) => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    const spot = { map: to.map, x: to.x, y: to.y + 1 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    a.calm = 0;
  }, at!);
  await page.waitForTimeout(800);
  await key(page, 'z', true); await page.waitForTimeout(90); await key(page, 'z', false);
  await expect.poll(() => page.evaluate(() => (window as any).__spike.swapping), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 10_000 });
}

/** Let `mons` go beside me, as a full party's catch does (net.ts `released`), and the key of the newest ball. */
async function release(page: Page, mons: { species: number; level: number; hp?: number; maxHp?: number }[]): Promise<number> {
  const was = await page.evaluate(() => [...(window as any).__spike.link.room.spills.keys()] as number[]);
  await page.evaluate((m) => (window as any).__spike.link.released(m), mons);
  await expect.poll(() => page.evaluate((was) => [...(window as any).__spike.link.room.spills.keys()].filter((k: number) => !was.includes(k)).length, was), { timeout: 10_000 }).toBe(1);
  return page.evaluate((was) => [...(window as any).__spike.link.room.spills.keys()].find((k: number) => !was.includes(k)) as number, was);
}

/** A swap through: the ROM's box has been and gone, and the panel is back on what is left in the ball (the one
 *  given): BACK puts that back on the ground (main.ts dropPanel, link.drop). */
async function done(page: Page, hurt: number): Promise<void> {
  await expect.poll(async () => (await hps(page)).filter((m) => m.hp < m.maxHp).length, { timeout: 60_000 }).toBe(hurt);
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__spike.swapping), { timeout: 30_000 }).toBe(false);
}

test('a mon let go and taken again has the HP it went with, released or given in a swap', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me) && !!s.art; }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  // Somewhere open, nothing about.
  await page.evaluate(() => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    const spot = { map: 'MAP_ROUTE101', x: 10, y: 10 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
    a.calm = 0;
  });
  await page.waitForTimeout(800);
  const party = () => page.evaluate(() => (window as any).__spike.rom.partyCount() as number);

  // (a) A released one: a TREECKO down on 7 of 33. Taken up, it is hurt, on its share of its new most.
  const ball = await release(page, [{ species: TREECKO, level: 12, hp: 7, maxHp: 33 }]);
  expect(await page.evaluate((k) => (window as any).__spike.link.room.spills.get(k).bag.mons, ball)).toEqual([{ species: TREECKO, level: 12, hp: 7, maxHp: 33 }]);
  const before = await party();
  await faceAndTake(page, ball);
  await page.locator('.bm-slot').first().click();
  await expect.poll(party, { timeout: 30_000 }).toBe(before + 1);
  await expect.poll(() => page.evaluate(() => (window as any).__spike.swapping), { timeout: 30_000 }).toBe(false);
  const joined = (await hps(page)).at(-1)!;
  expect(joined.maxHp).toBeGreaterThan(0);
  expect(joined.hp, `taken on ${joined.hp}/${joined.maxHp}, not full`).toBeLessThan(joined.maxHp);
  expect(joined.hp).toBe(joined.maxHp === 33 ? 7 : Math.min(Math.max(Math.round((7 * joined.maxHp) / 33), 1), joined.maxHp - 1));

  // (b) A swap: six, all full but the third, down to 3, and a ball beside me from an old page (no HP
  // said: made full, as before).
  await page.evaluate((max) => (window as any).__spike.rom.setHp(0, max), joined.maxHp);
  await page.evaluate(() => (window as any).__spike.rom.fillParty());
  await page.evaluate(() => (window as any).__spike.rom.setHp(2, 3));
  expect(await party()).toBe(6);
  const third = (await hps(page))[2];
  expect(third.hp).toBe(3);
  expect((await hps(page)).filter((m) => m.hp < m.maxHp)).toHaveLength(1);
  const bag = await release(page, [{ species: TREECKO, level: 12 }]);
  await faceAndTake(page, bag);
  // Theirs first, then mine to give for it: the third.
  await page.locator('.bm-slot').first().click();
  await page.waitForTimeout(600);
  await page.locator('.bm-slot').nth(2).click();
  await done(page, 0);
  expect(await party()).toBe(6);
  const left = await page.evaluate((k) => (window as any).__spike.link.room.spills.get(k)?.bag.mons, bag);
  expect(left, 'the one given lies in the ball, on the HP it had').toEqual([expect.objectContaining({ hp: 3, maxHp: third.maxHp })]);
  const swapped = await hps(page);
  expect(swapped.filter((m) => m.hp < m.maxHp), `${JSON.stringify(swapped)}: the old page's ball came up full`).toHaveLength(0);

  // ...and taken back, for the first, it is still on its 3: no heal.
  await faceAndTake(page, bag);
  await page.locator('.bm-slot').first().click();
  await page.waitForTimeout(600);
  await page.locator('.bm-slot').nth(0).click();
  await done(page, 1);
  const after = await hps(page);
  const hurt = after.filter((m) => m.hp < m.maxHp);
  expect(hurt, `${JSON.stringify(after)}: the hurt one came back hurt`).toHaveLength(1);
  const m = hurt[0];
  expect(m.hp).toBe(m.maxHp === third.maxHp ? 3 : Math.min(Math.max(Math.round((3 * m.maxHp) / third.maxHp), 1), m.maxHp - 1));
  expect(errors).toEqual([]);
});
