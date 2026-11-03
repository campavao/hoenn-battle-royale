// The new game's room, past its start: a reload comes back as the same trainer, the out watch
// somebody and step who, a phone's battle is the battle menu. The live match's reload-rejoin,
// spectate-dpad and battle-menu specs went with its page; these are the same promises on /.
import { devices, expect, test, type Page } from '@playwright/test';
import { KEY, key, route } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

type Spike = {
  link: { me: number; room: { actor(id: number): { name: string; m: { spot: { map: string; x: number; y: number } } } | undefined; ring(): { safari?: boolean } } };
  rom?: unknown;
  battle: unknown;
  isOut: boolean;
  spectating: boolean;
  goOut(): void;
};
const s = <T>(page: Page, f: (s: Spike) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as unknown as { __spike: Spike }).__spike), f.toString()) as Promise<T>;

async function hosted(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await expect(page.locator('#room-start')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#room-start').click();
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { rom?: unknown; link?: { me: number; room: { actor(id: number): unknown } } } }).__spike;
    return !!s?.rom && !!s.link?.room.actor(s.link.me);
  }, undefined, { timeout: 120_000 });
}

test('a reload mid-match comes back as the same trainer, not a new one', async ({ page }) => {
  test.setTimeout(300_000);
  await hosted(page);
  const me = await s(page, (s) => s.link.me);
  await page.reload();
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { link?: { me: number; room: { actor(id: number): unknown } } } }).__spike;
    return !!s?.link?.room.actor(s.link.me);
  }, undefined, { timeout: 120_000 });
  expect(await s(page, (s) => s.link.me)).toBe(me);
});

test('a step over a seam that does not meet in the plane is a glide, not a jump of the camera', async ({ page }) => {
  test.setTimeout(240_000);
  await solo(page, true);
  const west = () => page.evaluate(() => {
    const w = window as any, s = w.__spike;
    const a = s.link.room.actor(s.link.me), spot = { map: 'MAP_FALLARBOR_TOWN', x: 1, y: 10 };
    a.m = { ...a.m, spot, prev: spot, facing: 3, moveDir: 3, action: null, px: 0, py: 0 };
    w.__ys = [];
    const look = () => { w.__ys.push([s.cam.y, s.link.room.actor(s.link.me).m.spot.map]); requestAnimationFrame(look); };
    look();
  });
  await west();
  await expect.poll(() => s(page, (s) => s.link.room.actor(s.link.me)?.m.spot.map)).toBe('MAP_FALLARBOR_TOWN');
  await page.waitForTimeout(300);
  await page.evaluate(() => { (window as any).__ys.length = 0; });
  await key(page, KEY[3], true);
  await expect.poll(() => s(page, (s) => s.link.room.actor(s.link.me)?.m.spot.map), { timeout: 20_000 }).toBe('MAP_ROUTE114');
  await page.waitForTimeout(500);
  await key(page, KEY[3], false);
  const ys = await page.evaluate(() => (window as any).__ys as [number, string][]);
  const crossed = ys.findIndex(([, map]) => map === 'MAP_ROUTE114');
  expect(crossed, 'over the seam').toBeGreaterThan(0);
  const worst = Math.max(...ys.slice(1).map(([y], i) => Math.abs(y - ys[i][0])));
  console.log(`[seam] the camera's worst move in a frame: ${worst} px, ${ys.length} frames`);
  expect(worst).toBeLessThan(8);
});

test('out of the match, watching the bots walk for a minute: nobody jumps and the Room never leaves the relay', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await hosted(page);
  const counts = () => page.evaluate(() => (window as unknown as { __spike: { jank: { counts(): Record<string, number> } } }).__spike.jank.counts());
  await s(page, (s) => s.goOut());
  await expect.poll(() => s(page, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
  await page.waitForTimeout(60_000);
  const j = await counts();
  console.log(`[jank] ${JSON.stringify(j)}`);
  expect(j.watched, 'it was watching').toBeGreaterThan(30);
  expect(j.checks, 'the frames carry their hash').toBeGreaterThan(0);
  expect(j.drifts, 'the same Room as the relay').toBe(0);
  expect(j.lost, 'no resync').toBe(0);
  expect(j.snaps, 'nobody jumped').toBe(0);
  expect(j.cam).toBe(0);
  await ctx.close();
});

test('out of the match, the strip names who is watched, and the D-pad steps to the next', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: devices['Pixel 7'].viewport, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await hosted(page);
  await s(page, (s) => s.goOut());
  await expect.poll(() => s(page, (s) => s.isOut), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => s(page, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
  const who = page.getByText(/^WATCHING /);
  await expect(who).toBeVisible({ timeout: 30_000 });
  const first = await who.textContent();
  await key(page, KEY[4], true);
  await page.waitForTimeout(150);
  await key(page, KEY[4], false);
  await expect.poll(() => who.textContent(), { timeout: 10_000 }).not.toBe(first);
  await ctx.close();
});

/** Into a match of the page's own, its sound as it was left. */
async function solo(page: Page, muted: boolean): Promise<() => Promise<number>> {
  await page.addInitScript((m) => { localStorage.setItem('hbr:muted', m ? '1' : '0'); }, muted);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  // The core's own reading (a multiplier: 1 is full, and it ignores anything over 2).
  return () => page.evaluate(() => (window as any).__spike.rom.emu.m.getVolume());
}

test('Sound off, then on: the core goes quiet and comes back', async ({ page }) => {
  test.setTimeout(240_000);
  const volume = await solo(page, false);
  const flip = () => page.evaluate(() => document.getElementById('sound')!.click());
  await expect.poll(volume).toBe(1);
  await flip();
  await expect.poll(volume).toBe(0);
  await flip();
  await expect.poll(volume).toBe(1);
});

test('Sound turned on during a catching up stays quiet at eight times, and comes on level with the fight', async ({ page }) => {
  test.setTimeout(240_000);
  const volume = await solo(page, true);
  const flip = () => page.evaluate(() => document.getElementById('sound')!.click());
  await expect.poll(volume).toBe(0);
  await page.evaluate(() => {
    const s = (window as any).__spike, emu = s.rom.emu, read = emu.read.bind(emu), w = window as any;
    const at = s.art.sym('gBrSpectate'), main = s.art.sym('gBattleMainFunc');
    w.__behind = 1;
    w.__stop = false;
    emu.read = (a: number, bits: number) => (a === at + 5 ? 1 : a === at + 15 ? w.__behind : a === main ? 1 : read(a, bits));
    w.__mirror = s.rom.mirror({ peek: () => null, shift() {}, over: () => false, stopped: () => w.__stop, turned: false, skins: [0, 0] }, () => {});
  });
  await page.waitForTimeout(1500);
  await flip();
  await page.waitForTimeout(500);
  expect(await volume(), 'catching up, whatever the button says').toBe(0);
  await page.evaluate(() => { (window as any).__behind = 0; });
  await expect.poll(volume, { message: 'level with the fight' }).toBe(1);
  await flip();
  await expect.poll(volume, { message: 'off again' }).toBe(0);
  await page.evaluate(() => { (window as any).__stop = true; });
});

for (const muted of [true, false]) {
  test(`a ${muted ? 'muted' : 'listening'} watcher keeps their sound through a replay's catching up`, async ({ page }) => {
    test.setTimeout(240_000);
    const volume = await solo(page, muted);
    const left = muted ? 0 : 1;
    await expect.poll(volume).toBe(left);
    // The replay itself takes a real fight's feed; what is under test is what the page does on
    // the ROM's word that it is behind, so the ROM's word is all that is stood in for.
    await page.evaluate(() => {
      const s = (window as any).__spike, emu = s.rom.emu, read = emu.read.bind(emu), w = window as any;
      const at = s.art.sym('gBrSpectate'), main = s.art.sym('gBattleMainFunc');
      w.__behind = 2;
      w.__stop = false;
      emu.read = (a: number, bits: number) => (a === at + 5 ? 1 : a === at + 15 ? w.__behind : a === main ? 1 : read(a, bits));
      w.__mirror = s.rom.mirror({ peek: () => null, shift() {}, over: () => false, stopped: () => w.__stop, turned: false, skins: [0, 0] }, () => {});
    });
    const behind = (n: number) => page.evaluate((n) => { (window as any).__behind = n; }, n);
    await page.waitForTimeout(1500);
    expect(await volume(), 'lagging, at twice the speed').toBe(left);
    await behind(1);
    await expect.poll(volume, { message: 'catching up, at eight times: quiet' }).toBe(0);
    await behind(0);
    await expect.poll(volume, { message: 'level with the fight' }).toBe(left);
    await page.waitForTimeout(500);
    expect(await volume(), 'and it stays').toBe(left);
    await page.evaluate(() => { (window as any).__stop = true; });
  });
}

test("a phone's battle is the battle menu, with the pad off the glass", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __spike?: { rom?: unknown; link?: { me: number; room: { actor(id: number): unknown } } } }).__spike;
    return !!s?.rom && !!s.link?.room.actor(s.link.me);
  }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  // Onto the nearest marked spot in the Zone, for its wild battle.
  for (let tries = 0; tries < 6 && !(await s(page, (s) => !!s.battle)); tries++) {
    const dirs = await route(page, '(p, room) => room.patchesOn(p.map).some((q) => q.x === p.x && q.y === p.y) && !room.taken.has(room.patchKey ? room.patchKey(p) : -1)');
    expect(dirs, 'a marked spot to walk to').not.toBeNull();
    for (const d of dirs!) {
      const spot = () => s(page, (s) => JSON.stringify(s.link.room.actor(s.link.me)?.m.spot));
      const was = await spot();
      await key(page, KEY[d], true);
      const moved = await expect.poll(async () => (await spot()) !== was || (await s(page, (s) => !!s.battle)), { timeout: 5_000, intervals: [30] }).toBe(true).then(() => true, () => false);
      await key(page, KEY[d], false);
      if (!moved || (await s(page, (s) => !!s.battle))) break;
    }
    await page.waitForTimeout(1500);
  }
  const menu = page.locator('#battle-menu');
  await expect(menu).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.bm-cell'), 'its four windows').toHaveCount(4);
  await expect(page.locator('#dpad-surface'), 'the pad gives way').toBeHidden();
  await ctx.close();
});

// Cam 11-02: "it doesn't look like I can leave except for reloading". Out of the match the dock
// (and its room button) went with the trainer, and R was the only way to the sheet's LEAVE.
for (const [name, ctxOpts] of [
  ['a phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['a desktop', { viewport: { width: 1280, height: 720 } }],
] as const) {
  test(`out of the match, ${name} can reach LEAVE from the screen, and leaves`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const snap = (n: string) => page.screenshot({ path: `${process.env.HBR_SHOTS ?? test.info().outputDir}/${n}.png` });
    await hosted(page);
    await s(page, (s) => s.goOut());
    await expect.poll(() => s(page, (s) => s.isOut), { timeout: 30_000 }).toBe(true);
    await expect(page.getByText(/^WATCHING /)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await snap(`out-${name.replace(' ', '-')}`);
    // LEAVE on the watch strip, by mouse or thumb: it asks first, and STAY keeps the match.
    await expect(page.locator('#watch-leave'), 'a way out on the screen').toBeVisible();
    await page.locator('#watch-leave').click();
    await expect(page.locator('#match-leave-sure')).toBeVisible();
    await snap(`sheet-${name.replace(' ', '-')}`);
    await page.locator('#match-stay').click();
    await expect(page.locator('#match-leave')).toBeVisible();
    await page.locator('#drawer-close').click();
    await expect(page.locator('#watch-leave')).toBeVisible();
    await page.locator('#watch-leave').click();
    await page.locator('#match-leave-sure').click();
    await expect.poll(() => s(page, (s) => s.lobby?.shown), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => s(page, (s) => s.isOut), { timeout: 5_000 }).toBe(false);
    await ctx.close();
  });
}
