// What the player sees of the cuts (Cam, 11-02): a battle's intro at the game's own speed from the
// moment it can be seen, and the curtain over what happens under the hood.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const SCRATCH = process.env.HBR_E2E_SCRATCH || '';
const shot = async (page: Page, name: string) => {
  const to = SCRATCH ? path.join(SCRATCH, `${name}.png`) : test.info().outputPath(`${name}.png`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  await page.screenshot({ path: to });
};

test('the curtain as a match starts says how many are playing', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await page.locator('#room-start').click({ timeout: 30_000 });
  const box = page.locator('#curtain-box');
  await expect(box).toBeAttached({ timeout: 90_000 });
  // MAX 8 with FILL on: the host and seven bots, not the seven alone (Cam, 11-04: "29 TRAINERS").
  await expect(box).toHaveAttribute('data-text', /^8 TRAINERS\|.+/);
  const fits = await box.evaluate((c) => { const b = c.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; });
  expect(fits, 'on a phone').toBe(true);
  await shot(page, 'curtain-box-phone');
  await expect(page.locator('#curtain'), 'and it goes up').toHaveCount(0, { timeout: 8000 });
});

test('time zero in the Safari: the curtain, the battle ends behind it, and up comes "Drop where?"', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=25&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 180_000 });
  await page.waitForTimeout(2000);
  await spike(page, (s) => s.rom.fillParty());
  // As though something was caught: what this battle leaves of the party is not what's under test.
  await spike(page, (s) => { const spill = s.rom.spill.bind(s.rom); s.rom.spill = async () => ({ ...(await spill()), mons: [{ species: 1, level: 5 }] }); });
  // Into a battle in the Zone, so the buzzer has one to pull me out of.
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const map = a.m.spot.map;
    const q = room.patchesOn(map).find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map, x: q.x - 1, y: q.y }, 4));
    const spot = { map, x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
  });
  await page.waitForTimeout(800);
  await key(page, 'ArrowRight', true); await page.waitForTimeout(150); await key(page, 'ArrowRight', false);
  await expect.poll(() => spike(page, (s) => !!s.battle), { timeout: 15_000 }).toBe(true);
  // Every frame from here: what could be seen at each.
  await page.evaluate(() => {
    const seen: any[] = [];
    (window as any).__cut = seen;
    const s = (window as any).__spike;
    const look = () => {
      const c = document.getElementById('curtain');
      const y = c ? Number(/translateY\((-?\d+)/.exec(c.style.transform)?.[1] ?? NaN) : null;
      seen.push({ safari: !!s.link.room.ring().safari, battle: !!s.battle, map: !!s.mapWindow, curtain: y });
      requestAnimationFrame(look);
    };
    look();
  });
  await expect.poll(() => spike(page, (s) => !s.link.room.ring().safari), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(250);
  await shot(page, 'buzzer-falling');
  await expect.poll(() => spike(page, (s) => !!s.mapWindow), { timeout: 20_000 }).toBe(true);
  await shot(page, 'buzzer-map');
  await expect(page.locator('#curtain'), 'and it goes up').toHaveCount(0, { timeout: 12_000 });
  await shot(page, 'buzzer-up');
  const seen: any[] = await page.evaluate(() => (window as any).__cut);
  const zero = seen.findIndex((f) => !f.safari);
  expect(zero).toBeGreaterThan(0);
  expect(seen[zero].battle, 'the battle was on at time zero').toBe(true);
  expect(seen.slice(zero, zero + 6).some((f) => f.curtain !== null), 'it comes down at once').toBe(true);
  // The battle ends and the map opens only with the curtain all the way down.
  const end = seen.findIndex((f, i) => i > zero && !f.battle);
  expect(end).toBeGreaterThan(zero);
  expect(seen[end].curtain, 'down as the battle goes').toBe(0);
  const map = seen.findIndex((f) => f.map);
  expect(seen[map].curtain, 'down as the map comes').toBe(0);
});

test("a battle's intro runs at the game's speed from the moment it can be seen", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 180_000 });
  await page.waitForTimeout(3000);
  await spike(page, (s) => s.rom.fillParty());
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const q = room.patchesOn('MAP_ROUTE117').find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map: 'MAP_ROUTE117', x: q.x - 1, y: q.y }, 4));
    const spot = { map: 'MAP_ROUTE117', x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
    // Each emulated frame from the step on: is the picture up, is the ROM hurrying, is the menu up.
    const at = s.art.sym('gBrBattle');
    const el = document.getElementById('battle')!;
    const log: any = { t0: 0, shownAt: 0, menuAt: 0, shownFrame: 0, menuFrame: 0, frames: 0, hurriedAfterShown: 0 };
    (window as any).__intro = log;
    const off = s.rom.emu.onFrame(() => {
      const shown = el.classList.contains('on');
      if (!shown) return;
      if (!log.shownAt) log.shownAt = performance.now();
      log.frames++;
      if (s.rom.emu.read(at + 13, 8)) log.hurriedAfterShown++;
      if (s.rom.emu.read(at + 8, 8)) { log.menuAt = performance.now(); off(); }
    });
    log.t0 = performance.now();
  });
  await page.waitForTimeout(1000);
  await spike(page, () => { (window as any).__intro.t0 = performance.now(); });
  await key(page, 'ArrowRight', true); await page.waitForTimeout(150); await key(page, 'ArrowRight', false);
  await page.waitForFunction(() => (window as any).__intro.shownAt, undefined, { timeout: 30_000 });
  await page.waitForTimeout(250);
  await shot(page, 'intro-early');
  await page.waitForFunction(() => (window as any).__intro.menuAt, undefined, { timeout: 40_000 });
  const log = await page.evaluate(() => (window as any).__intro);
  const out = { toPicture: Math.round(log.shownAt - log.t0), pictureToMenu: Math.round(log.menuAt - log.shownAt), frames: log.frames, hurriedAfterShown: log.hurriedAfterShown };
  console.log(JSON.stringify(out));
  if (SCRATCH) fs.appendFileSync(path.join(SCRATCH, 'intro.jsonl'), JSON.stringify(out) + '\n');
  // Once it can be seen, it is the game's own speed (Cam, 11-02: "once something is about to paint
  // onto the screen for the first time, the animation should be normal").
  expect(log.hurriedAfterShown).toBeLessThanOrEqual(1);
});

test('in the final ring a watched fight comes up under the curtain', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#solo&simbots&safari=0&fog=30&seed=11`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 180_000 });
  await spike(page, (s) => s.goOut('out'));
  await expect.poll(() => spike(page, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
  // The final ring as the watch sees it, with the camera off the fight it is about to be shown.
  await spike(page, (s) => { s.watch.host.lastRing = () => true; s.watch.host.setFollow(0); });
  await page.evaluate(() => {
    const seen: any[] = [];
    (window as any).__cut = seen;
    const s = (window as any).__spike;
    const look = () => {
      const c = document.getElementById('curtain');
      seen.push({ view: !!s.watch.showing, curtain: c ? Number(/translateY\((-?\d+)/.exec(c.style.transform)?.[1] ?? NaN) : null });
      requestAnimationFrame(look);
    };
    look();
  });
  // Two bots side by side in the fog: the room's own rule has them fight. Then on to one of them.
  const until = Date.now() + 240_000;
  let id = 0;
  while (Date.now() < until && !id) {
    id = await page.evaluate(() => {
      const s = (window as any).__spike, r = s.link.room;
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
  await page.evaluate((id) => (window as any).__spike.watch.host.setFollow(id), id);
  await expect.poll(() => page.evaluate(() => !!document.getElementById('curtain')), { timeout: 30_000 }).toBe(true);
  await shot(page, 'final-curtain');
  await expect.poll(() => spike(page, (s) => !!s.watch.showing), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#curtain'), 'and up').toHaveCount(0, { timeout: 8000 });
  await shot(page, 'final-fight');
  const seen: any[] = await page.evaluate(() => (window as any).__cut);
  // The watch may still be on a fight from before the final ring when the recording starts:
  // the one this is about is the first shown after the curtain came down.
  const down = seen.findIndex((f) => typeof f.curtain === 'number');
  const first = seen.findIndex((f, i) => i > down && f.view);
  expect(down, 'the curtain comes down').toBeGreaterThanOrEqual(0);
  expect(seen[first].curtain, 'all the way down as the fight appears').toBe(0);
  expect(seen.slice(first).some((f) => typeof f.curtain === 'number' && f.curtain < -16), 'and it rises off it').toBe(true);
});

test('the Hall of Fame: a window in the middle with a mouse, the curtain down behind it, and quick', async ({ page }) => {
  test.setTimeout(240_000);
  // Cam's window: the How to Play's own size comes out 720 wide on it.
  await page.setViewportSize({ width: 1920, height: 1040 });
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await page.locator('#room-start').click({ timeout: 30_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 90_000 });
  // One bot left standing, with the team the match dealt it: its parade, on my ROM.
  await page.waitForFunction(() => (window as any).__spike.link.room.results.entrants.length >= 2, undefined, { timeout: 120_000 });
  const crowned = Date.now();
  await spike(page, (s) => { const room = s.link.room; const left = room.actors.find((a: any) => a.bot); for (const a of [...room.actors]) if (a !== left) { room.fall(a, 'the fog'); room.remove(a.id); } });

  const fame = page.locator('#battle.on.fame');
  await expect(fame, 'the parade is up').toBeAttached({ timeout: 30_000 });
  await expect(page.locator('#curtain'), 'the curtain, behind it').toBeAttached();
  await page.waitForTimeout(3000);
  const box = (await page.locator('#gba').boundingBox())!;
  expect(box.width, "a window's size").toBe(720);
  expect(Math.abs(box.x + box.width / 2 - 960), 'in the middle').toBeLessThan(1);
  expect(Math.abs(box.y + box.height / 2 - 520), 'in the middle').toBeLessThan(1);
  const hung = await page.locator('#curtain').evaluate((c) => { const b = c.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, z: getComputedStyle(c).zIndex }; });
  expect(hung.top, 'all the way down').toBe(0);
  expect(hung.bottom).toBeGreaterThanOrEqual(1040);
  expect(Number(hung.z), 'behind the ROM').toBeLessThan(Number(await fame.evaluate((b) => getComputedStyle(b).zIndex)));
  await expect(page.locator('#keys'), 'the keys are not over it').toBeHidden();
  await shot(page, 'fame-desktop');

  // Nobody presses A. The clock is the game's own speed on a machine that may be busy, so a
  // bound and not a number: Emerald's took 34 s for six before anything of the page's.
  await expect(fame, 'and it goes').toHaveCount(0, { timeout: 40_000 });
  const took = Date.now() - crowned;
  console.log(`crown to the parade's end: ${took} ms`);
  await expect(page.locator('#curtain'), 'and up').toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('#results-panel, #win.on').first(), 'and on to the results').toBeVisible({ timeout: 30_000 });
});
