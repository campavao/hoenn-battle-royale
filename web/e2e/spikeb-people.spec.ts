// People on the map (Cam, 11-02): somebody who has given away what they held stays and says so,
// the tag over them shows what they hold, and a fight near a trainer who is out says WATCH.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any, arg?: any) => T, arg?: unknown) =>
  page.evaluate(([src, arg]) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as any).__spike, arg), [f.toString(), arg] as const) as Promise<T>;

const SCRATCH = process.env.HBR_E2E_SCRATCH || '';
const shot = async (page: Page, name: string) => {
  const to = SCRATCH ? path.join(SCRATCH, `${name}.png`) : test.info().outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  await page.screenshot({ path: to });
};

async function inMatch(page: Page, hash: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#${hash}`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me) && !!s.art; }, undefined, { timeout: 180_000 });
}

/** Stands me south of the first gift-giver past `skip`, facing them, and says what they hold. */
const toGiver = (page: Page, skip = 0) => spike(page, (s, skip) => {
  const room = s.link.room, a = room.actor(s.link.me);
  const g = ([...room.ground().values()] as any[]).filter((b) => b.gift && room.world.cell(b.map, b.x, b.y + 1) === 0 && s.placed.get(b.map))[skip];
  const spot = { map: g.map, x: g.x, y: g.y + 1 };
  a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0 };
  a.calm = 0;
  return { key: g.key, map: g.map, x: g.x, y: g.y, item: g.item, name: s.art.itemName(g.item) as string };
}, skip);

test('a gift-giver: the tag shows what they hold, they stay once it is taken, and they say so', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await inMatch(page, 'solo&nobots&safari=0&fog=900&seed=7');
  await spike(page, (s) => s.rom.fillParty());
  const g = await toGiver(page);
  // What they hold, with its picture beside it.
  const tag = page.locator('#item-tag');
  await expect(tag).toHaveAttribute('data-text', g.name, { timeout: 5000 });
  await page.waitForTimeout(400);
  await shot(page, 'giver-tag');

  await page.keyboard.press('z', { delay: 150 });
  await expect.poll(() => spike(page, (s, k) => s.link.room.picked.has(k), g.key), { timeout: 15_000 }).toBe(true);
  // Who gets it is the windows': BACK keeps it in the bag.
  await expect.poll(() => spike(page, (s) => !!s.battleMenu?.isShown || s.asking), { timeout: 15_000 }).toBeTruthy();
  await page.keyboard.press('x', { delay: 150 });
  await expect.poll(() => spike(page, (s) => !s.asking && !s.battleMenu?.isShown && !s.swapping), { timeout: 30_000 }).toBeTruthy();
  await page.waitForTimeout(1000);
  await expect(tag, 'nothing left to name').toBeHidden();
  await shot(page, 'giver-gave');

  // Still in the way: the same page, the room's own step.
  expect(await spike(page, (s) => { const a = s.link.room.actor(s.link.me); return s.link.room.stepFor(a)(a.m.spot, 2); })).toBeNull();
  await page.waitForTimeout(600);
  await page.keyboard.press('z', { delay: 150 });
  await expect(page.locator('#msg')).toHaveAttribute('data-text', "That's all I had. Take care of it!", { timeout: 5000 });
  await shot(page, 'giver-mine');

  // Another's, taken by somebody else.
  const other = await toGiver(page, 1);
  await spike(page, (s, k) => { s.link.room.picked.set(k, 999); }, other.key);
  await page.waitForTimeout(600);
  await page.keyboard.press('z', { delay: 150 });
  await expect(page.locator('#msg')).toHaveAttribute('data-text', 'Sorry, somebody took it.', { timeout: 5000 });
  await shot(page, 'giver-somebody');
  expect(errors).toEqual([]);
});

test('a fight near a trainer who is out says WATCH; A goes into it', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await inMatch(page, 'solo&simbots&safari=0&fog=30&seed=11');
  await spike(page, (s) => s.goOut('out'));
  await expect.poll(() => spike(page, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
  await page.waitForTimeout(500);
  await expect(page.locator('#item-tag'), 'no fight near').toBeHidden();

  // Two bots side by side in the fog: the room's own rule has them fight. The camera loose, by them.
  const until = Date.now() + 240_000;
  let id = 0;
  while (Date.now() < until && !id) {
    id = await spike(page, (s) => {
      const r = s.link.room;
      const fighting = r.actors.find((a: any) => a.bot && a.battling && a.foe);
      if (fighting) return fighting.id as number;
      const free = r.actors.filter((a: any) => a.bot && !a.battling && !a.m.action && r.inFog(a.m.spot));
      if (free.length < 2) return 0;
      const [a, b] = free;
      const [dx, dy, fa, fb] = ([[1, 0, 4, 3], [-1, 0, 3, 4], [0, 1, 1, 2], [0, -1, 2, 1]] as const)[Math.floor(performance.now() / 300) % 4];
      b.m = { ...b.m, spot: { map: a.m.spot.map, x: a.m.spot.x + dx, y: a.m.spot.y + dy }, facing: fb, moveDir: fb };
      a.m = { ...a.m, facing: fa, moveDir: fa };
      a.calm = b.calm = 0;
      return 0;
    });
    if (!id) await page.waitForTimeout(300);
  }
  expect(id, 'a fight').toBeGreaterThan(0);
  // Next to it, not on it.
  await spike(page, (s, id) => {
    s.watch.host.setFollow(0);
    const a = s.link.room.actor(id);
    const p = s.placed.get(a.m.spot.map);
    s.cam.x = (p.gx + a.m.spot.x + 3) * 16;
    s.cam.y = (p.gy + a.m.spot.y) * 16;
  }, id);
  await expect(page.locator('#item-tag')).toHaveAttribute('data-text', 'WATCH', { timeout: 5000 });
  await expect(page.locator('#item-tag')).toBeVisible();
  await shot(page, 'watch-tag');
  await page.keyboard.press('z', { delay: 150 });
  await expect.poll(() => spike(page, (s) => s.watch.host.follow()), { timeout: 5000 }).toBeGreaterThan(0);
  await expect.poll(() => spike(page, (s) => !!s.watch.showing), { timeout: 30_000 }).toBe(true);
  await expect(page.locator('#item-tag'), 'the fight is up').toBeHidden();
  await shot(page, 'watch-up');
  expect(errors).toEqual([]);
});
