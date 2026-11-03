// A bot at a legendary with the simulator off (the room as it runs live): the room hands the fight
// to my page, whose hidden ROM fights it out and says how it went. A staged meeting on the real ROM:
// the walk up to it is botloot.test.ts's.
import { expect, test } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
test('a hidden ROM fights a bot and a legendary, and the room hears who took it', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto(`/?rom=${romHashParam()}#solo&safari=2&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => !(window as any).__spike.link.room.ring().safari, undefined, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const staged = await page.evaluate(() => {
    const room = (window as any).__spike.link.room;
    const KEY = 1 << 22;
    // Nobody else fights here: this page has one hidden ROM.
    for (const a of room.actors) if (a.bot) a.calm = 1e9;
    const bot = room.actors.find((a: any) => a.bot && !a.battling);
    bot.calm = 0;
    const { map, x, y } = bot.m.spot;
    room.spills.set(KEY, { key: KEY, map, x, y: y + 1, name: '', legend: true, bag: { items: [], money: 0, mons: [{ species: 407, level: 5 }] } });
    const pending: unknown[] = [];
    room.botLegend(bot, room.spills.get(KEY), pending);
    const step = room.step;
    room.step = function (used: unknown) { const e = step.call(room, used); e.push(...pending.splice(0)); return e; };
    return { id: bot.id, key: KEY, judge: bot.judge, foe: bot.foe, me: (window as any).__spike.link.me };
  });
  expect(staged.judge).toBe(staged.me);
  expect(staged.foe).toBe(-2);
  // Answered: the bot walks again, with what came of it on it.
  await page.waitForFunction((id) => {
    const a = (window as any).__spike.link.room.actor(id);
    return a && !a.battling;
  }, staged.id, { timeout: 360_000 });
  const out = await page.evaluate(({ id, key }) => {
    const room = (window as any).__spike.link.room, a = room.actor(id);
    return { caught: a.caught ?? [], tried: a.tried ?? [], wear: a.wear ?? null, stands: !room.picked.has(key), worn: room.spills.get(key)?.worn ?? null };
  }, staged);
  console.log('bot at a legendary, on the ROM:', JSON.stringify(out));
  // One or the other, and never a "no answer": a fight that ran.
  if (out.caught.length) {
    expect(out.caught).toEqual([407]);
    expect(out.stands).toBe(false);
  } else {
    expect(out.tried).toEqual([staged.key]);
    expect(out.stands).toBe(true);
    expect(out.wear?.every((w: number) => w === 0.15)).toBe(true);
    expect(out.worn).not.toBeNull();
  }
});
