// A bot at a legendary with the simulator off (the room as it runs live): the room hands the fight
// to my page, whose hidden ROM fights it out and says how it went. A staged meeting on the real ROM:
// the walk up to it is botloot.test.ts's.
import { expect, test } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
test('a hidden ROM fights a bot and a legendary, and the room hears who took it', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto(`/?rom=${romHashParam()}#solo&nosim&safari=2&fog=900&seed=7`);
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
    // No ball, no fight: nothing to catch it with is nothing to fight it for (Room.botLegend).
    bot.loot = { items: [{ id: 4, n: 5 }], money: 0 };
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
    // Gone, too: a bot whose team went down at it is out of the match, as a trainer is.
    return !a || !a.battling;
  }, staged.id, { timeout: 360_000 });
  const out = await page.evaluate(({ id, key }) => {
    const room = (window as any).__spike.link.room, a = room.actor(id);
    return { out: !a, caught: a?.caught ?? [], tried: a?.tried ?? [], stands: !room.picked.has(key) };
  }, staged);
  console.log('bot at a legendary, on the ROM:', JSON.stringify(out));
  // Caught, off the map; anything else and it stands, for the bot that lost or ran as for a trainer,
  // and never a "no answer": a fight that ran.
  if (out.caught.length) {
    expect(out.caught).toEqual([407]);
    expect(out.stands).toBe(false);
  } else {
    expect(out.stands).toBe(true);
    if (!out.out) expect(out.tried).toEqual([staged.key]);
  }
});

test('a hidden ROM fights what lives on a marked spot, and the spot is gone for everybody', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto(`/?rom=${romHashParam()}#solo&nosim&safari=2&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => !(window as any).__spike.link.room.ring().safari, undefined, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const staged = await page.evaluate(() => {
    const room = (window as any).__spike.link.room;
    for (const a of room.actors) if (a.bot) a.calm = 1e9;
    const bot = room.actors.find((a: any) => a.bot && !a.battling);
    bot.calm = 0;
    // A ball to throw: what the ROM's duel has no way to, the page throws at the last of it.
    bot.loot = { items: [{ id: 4, n: 5 }], money: 0 };
    const map = 'MAP_ROUTE101';
    const p = room.patchesOn(map).find((q: any) => !room.isTaken(q.key));
    bot.m = { ...bot.m, spot: { map, x: p.x, y: p.y }, prev: { map, x: p.x, y: p.y }, action: null };
    room.duelAfter = room.wildAfter = 0;
    const pending: unknown[] = [];
    room.botOnPatch(bot, pending);
    const step = room.step;
    room.step = function (used: unknown) { const e = step.call(room, used); e.push(...pending.splice(0)); return e; };
    return { id: bot.id, key: p.key, judge: bot.judge, foe: bot.foe, me: (window as any).__spike.link.me, species: bot.wildFight.species };
  });
  expect(staged.judge).toBe(staged.me);
  expect(staged.foe).toBe(-2);
  expect(staged.species).toBeGreaterThan(0);
  await page.waitForFunction((id) => {
    const a = (window as any).__spike.link.room.actor(id);
    return !a || !a.battling;
  }, staged.id, { timeout: 360_000 });
  const out = await page.evaluate(({ id, key }) => {
    const room = (window as any).__spike.link.room, a = room.actor(id);
    return { out: !a, caught: a?.caught ?? [], wear: a?.wear ?? null, balls: a?.loot?.items ?? [], taken: room.isTaken(key) };
  }, staged);
  console.log('bot on a marked spot, on the ROM:', JSON.stringify(out));
  expect(out.taken, 'gone, however it went').toBe(true);
  if (!out.out) {
    // A fight that ran: what it left the team, or a mon for a ball. Never "no answer".
    expect(out.wear, 'the fight left its mark').not.toBeNull();
    if (out.caught.length) {
      expect(out.caught).toEqual([staged.species]);
      expect(out.balls).toEqual([{ id: 4, n: 4 }]);
    }
  }
});

test('a bot on a marked spot in the Zone, watched: its battle comes up, with what it met', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#solo&safari=600&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.evaluate(() => (window as any).__spike.goOut('out'));
  await page.waitForFunction(() => !!(window as any).__spike.spectating, undefined, { timeout: 30_000 });
  // The next bot through the grass, from the frame it steps on it.
  const id = await page.evaluate(() => new Promise<number>((done) => {
    const s = (window as any).__spike;
    const look = () => {
      const a = s.link.room.actors.find((o: any) => o.bot && o.wildFight?.zone);
      if (a) { s.watch.host.setFollow(a.id); done(a.id); } else setTimeout(look, 50);
    };
    look();
  }));
  await page.waitForFunction(() => !!(window as any).__spike.watch.showing, undefined, { timeout: 30_000 });
  const taken = await page.evaluate((id) => {
    const room = (window as any).__spike.link.room, a = room.actor(id);
    return { species: a?.wildFight?.species ?? 0, thrown: a?.zoneThrown ?? 0 };
  }, id);
  await page.waitForTimeout(3500);
  if (process.env.HBR_SHOTS) await page.screenshot({ path: `${process.env.HBR_SHOTS}/bot-zone-watched.png` });
  const far = await page.evaluate(() => (document.querySelector('canvas[data-far]') as HTMLCanvasElement | null)?.dataset.far ?? '');
  console.log('watched in the Zone:', id, JSON.stringify(taken), far);
  if (taken.species) expect(far.split(':')[0]).toBe(String(taken.species));
});

