// The game (spike B, at /), played the way a
// player gets to it: no ROM on the device yet, PICK ROM, the menu, a hosted room with
// bots, START, and the match through to its results. Nothing here presses a key in the
// match: catching nothing in the Safari puts the player out at the drop (the rule), so
// the spec watches the rest and checks what a player who is out sees.
import { test, expect, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Presses a room option until its label reads `want` (each press steps it once). */
async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 6 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

test('a new player picks a ROM on spike B itself and gets the menu', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('#pick-rom')).toBeVisible({ timeout: 60_000 });
  await page.locator('#rom-input').setInputFiles(romPath());
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 90_000 });
  // Stored: the next visit goes straight to the menu.
  await page.reload();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#pick-rom')).toHaveCount(0);
});

test('a hosted room with bots plays through to its results', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await expect(page.locator('#room-start')).toBeVisible({ timeout: 30_000 });
  await setOption(page, 'room-fog', 'FOG 30s');
  await setOption(page, 'room-safari', 'SAFARI 60s');
  await expect(page.locator('#room-start')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#room-start').click();

  // The Safari, then out at the drop with nothing caught: watching somebody.
  const spike = (f: string) => page.evaluate((f) => (window as unknown as { __spike: Record<string, unknown> }).__spike[f], f);
  await expect.poll(() => spike('isOut'), { timeout: 120_000 }).toBe(true);
  await expect.poll(() => spike('spectating'), { timeout: 30_000 }).toBeTruthy();

  // The match ends for everybody, and the results say where the player came.
  await expect(page.locator('#results-panel')).toBeVisible({ timeout: 480_000 });
  await expect(page.locator('#results-standings')).toBeVisible();
  await expect(page.locator('#results-line')).toContainText(/of \d+/);
});

/** The walk to the nearest cell `goal` takes, over the room's own step function (bots
 *  walk the same one), as directions: 1 south, 2 north, 3 west, 4 east. */
async function route(page: Page, goal: string): Promise<number[] | null> {
  return page.evaluate((goal) => {
    const s = (window as unknown as { __spike: { link: { me: number; room: any } } }).__spike;
    const room = s.link.room, a = room.actor(s.link.me);
    const ok = new Function('p', 'room', `return (${goal})(p, room)`) as (p: unknown, room: unknown) => boolean;
    const step = room.stepFor(a);
    const k = (p: { map: string; x: number; y: number }) => `${p.map}:${p.x}:${p.y}`;
    const from = new Map<string, [string, number] | null>([[k(a.m.spot), null]]);
    const q = [a.m.spot];
    for (let i = 0; i < q.length && i < 6000; i++) {
      const p = q[i];
      if (i > 0 && ok(p, room)) {
        const dirs: number[] = [];
        for (let c = k(p); from.get(c); c = from.get(c)![0]) dirs.unshift(from.get(c)![1]);
        return dirs;
      }
      for (const d of [1, 2, 3, 4]) {
        const r = step(p, d);
        if (!r || r.warp || r.water || from.has(k(r.to))) continue;
        from.set(k(r.to), [k(p), d]);
        q.push(r.to);
      }
    }
    return null;
  }, goal);
}

const KEY = { 1: 'ArrowDown', 2: 'ArrowUp', 3: 'ArrowLeft', 4: 'ArrowRight', a: 'z' } as Record<number | string, string>;
const key = (page: Page, k: string, down: boolean) => page.evaluate(([k, down]) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k as string, bubbles: true })), [k, down] as const);

test('a Safari catch, the drop on the fly map, and out of the Safari', async ({ page }) => {
  test.setTimeout(420_000);
  // Straight in, the way quick play can be: the battle ROM may still be booting.
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await setOption(page, 'room-safari', 'SAFARI 120s');
  await page.locator('#room-start').click();
  type S = { link: { me: number; room: { actor(id: number): { m: { spot: { map: string; x: number; y: number } } } | undefined; ring(): { safari?: boolean } } }; rom?: { partyCount(): number }; battle: unknown; swapping: boolean };
  const s = <T>(f: (s: S) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as unknown as { __spike: S }).__spike), f.toString()) as Promise<T>;
  await expect.poll(() => s((s) => !!s.link?.room.actor(s.link.me)), { timeout: 60_000 }).toBe(true);
  const spot = () => s((s) => { const p = s.link.room.actor(s.link.me)?.m.spot; return p ? `${p.map}:${p.x}:${p.y}` : ''; });

  // To marked spots until something is caught: A once every two seconds in a battle
  // (BALL is where the cursor starts), never a spot spent on a ROM still booting.
  let caught = 0;
  for (let tries = 0; tries < 8 && !caught; tries++) {
    const dirs = await route(page, '(p, room) => room.patchesOn(p.map).some((q) => q.x === p.x && q.y === p.y) && !room.taken.has(room.patchKey ? room.patchKey(p) : -1)');
    expect(dirs, 'a marked spot to walk to').not.toBeNull();
    for (const d of dirs!) {
      const was = await spot();
      await key(page, KEY[d], true);
      await expect.poll(async () => (await spot()) !== was || !!(await s((s) => s.battle)), { timeout: 15_000, intervals: [30] }).toBe(true);
      await key(page, KEY[d], false);
      if (await s((s) => s.battle)) break;
    }
    await expect.poll(() => s((s) => !!s.battle), { timeout: 5_000 }).toBe(true).catch(() => undefined);
    for (let t = 0; t < 45 && (await s((s) => !!s.battle)); t++) {
      expect(await page.locator('#battle-note').textContent(), 'a real battle, not "still loading"').not.toContain('loading');
      await key(page, KEY.a, true); await page.waitForTimeout(150); await key(page, KEY.a, false);
      await page.waitForTimeout(1850);
    }
    caught = await s((s) => s.rom?.partyCount() ?? 0);
  }
  expect(caught, 'a POKeMON caught in the Safari').toBeGreaterThan(0);

  // The buzzer: the ROM's own fly map ("Drop where?"), A to pick, and out of the Safari.
  await expect.poll(() => s((s) => !s.link.room.ring().safari), { timeout: 150_000 }).toBe(true);
  await expect.poll(() => s((s) => s.swapping), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(3000);
  await key(page, KEY.a, true); await page.waitForTimeout(150); await key(page, KEY.a, false);
  await expect.poll(() => spot(), { timeout: 60_000 }).not.toMatch(/^MAP_SAFARI/);
  expect(await s((s) => s.rom?.partyCount() ?? 0), 'the team came with the trainer').toBe(caught);
});

test('a dropped bag opens its team, and MOVES off the team opens the move screen', async ({ page }) => {
  test.setTimeout(300_000);
  // A world of the page's own with a long Safari, so nothing ends under the test.
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  type S = { link: { me: number; room: { actor(id: number): unknown } }; rom?: { partyCount(): number }; swapping: boolean; asking: boolean; startFor(e: unknown): void };
  const s = <T>(f: (s: S) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as unknown as { __spike: S }).__spike), f.toString()) as Promise<T>;
  await page.waitForFunction(() => { const s = (window as unknown as { __spike?: S }).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 90_000 });
  const press = async (k: string) => { await key(page, k, true); await page.waitForTimeout(120); await key(page, k, false); await page.waitForTimeout(400); };
  const shown = () => page.locator('#battle').evaluate((el) => el.classList.contains('on'));
  const idle = () => expect.poll(() => s((s) => s.swapping), { timeout: 20_000 }).toBe(false);

  // A beaten trainer's bag at my feet: POKeMON is the ROM's team screen (HBR-82). It
  // opened nothing (Cam, 10-30): the page waited on a BUSY the ROM sends 120 frames late.
  // TREECKO at 30 has forgotten moves to relearn; TORCHIC at 11 knows all it has learned.
  await s((s) => s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0001, name: 'MAY', bag: { items: [{ id: 13, n: 3 }], money: 300, mons: [{ species: 277, level: 30 }, { species: 280, level: 11 }] } }));
  await expect.poll(() => s((s) => s.asking), { timeout: 10_000 }).toBe(true);
  await press('z');
  await expect.poll(shown, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(1000);
  // A marks a mon of theirs, START moves the marked across, B is done.
  await press('z');
  await press('ArrowRight');
  await press('z');
  await press('Enter');
  await press('x');
  await idle();
  expect(await s((s) => s.rom!.partyCount()), 'both mons taken out of the bag').toBe(2);

  // START > POKeMON > a mon > MOVES (its second row): the party menu shuts and the field
  // opens the move relearner (BrCatch_Tick). It did that on the hidden field after the
  // page took the screen back, so nothing showed (Cam, 10-30).
  const moves = async (slot: number) => {
    await press('m');
    await expect.poll(() => s((s) => s.asking), { timeout: 5_000 }).toBe(true);
    await press('z');
    await expect.poll(shown, { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(1500);
    for (let i = 0; i < slot; i++) await press('ArrowDown');
    await press('z');
    await press('ArrowDown');
    await press('z');
  };
  await moves(0);
  await page.waitForTimeout(4000);
  expect(await shown(), "TREECKO's move screen on show").toBe(true);
  expect(await s((s) => s.swapping)).toBe(true);
  for (let i = 0; i < 6 && (await s((s) => s.swapping)); i++) await press('x');
  await idle();

  // Nothing to learn: the ROM says so on its own field, and the page says it on its own.
  await moves(1);
  await idle();
  await expect(page.locator('#msg')).toHaveAttribute('data-text', /No new moves/, { timeout: 5_000 });
});

test("a MART sells the way Emerald's does: the shelf, how many, the price, YES", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  type S = { link: { me: number; room: { actor(id: number): unknown } }; rom?: { money(): Promise<number>; spill(): Promise<{ items: { id: number; n: number }[] }> }; asking: boolean; startFor(e: unknown): void };
  const s = <T>(f: (s: S) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as unknown as { __spike: S }).__spike), f.toString()) as Promise<T>;
  await page.waitForFunction(() => { const s = (window as unknown as { __spike?: S }).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 90_000 });
  const press = async (k: string) => { await key(page, k, true); await page.waitForTimeout(100); await key(page, k, false); await page.waitForTimeout(350); };
  const before = await s((s) => s.rom!.money());

  // OLDALE's clerk at the opening's rung: ROYALe BALL, POTION, POKe DOLL. The shelf is a
  // canvas of Emerald's windows (askbox.ts), not the page's old list (Cam, 10-30).
  await s((s) => s.startFor({ type: 'mart', tick: 0, id: s.link.me, map: 'MAP_OLDALE_TOWN_MART' }));
  await expect.poll(() => s((s) => s.asking), { timeout: 10_000 }).toBe(true);
  await expect(page.locator('#askbox')).toBeVisible();
  await press('ArrowDown'); // POTION
  await press('z');
  await press('ArrowUp'); await press('ArrowUp'); // x3 on the roller
  await press('z');
  await press('z'); // YES
  await expect.poll(() => s((s) => s.rom!.money()), { timeout: 15_000 }).toBe(before - 900);
  expect(await s(async (s) => (await s.rom!.spill()).items.find((r) => r.id === 13)?.n ?? 0), 'three POTIONs in the bag').toBe(3);
  await press('x'); // CANCEL off the shelf
  await expect.poll(() => s((s) => s.asking), { timeout: 5_000 }).toBe(false);
  await expect(page.locator('#askbox')).toBeHidden();
});

test('a tap on the map walks the trainer there, and the pad buzzes', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { (window as unknown as { buzzes: number }).buzzes = 0; navigator.vibrate = () => { (window as unknown as { buzzes: number }).buzzes++; return true; }; });
  await page.goto(`/?rom=${romHashParam()}`);
  await page.locator('#lobby-rows button', { hasText: 'HOST A ROOM' }).click({ timeout: 90_000 });
  await page.locator('#room-start').click({ timeout: 30_000 });
  type W = { link: { me: number; room: any }; rom?: unknown; cam: { x: number; y: number }; zoom: number; placed: Map<string, { gx: number; gy: number }> };
  await page.waitForFunction(() => { const s = (window as unknown as { __spike: W }).__spike; return !!s.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 90_000 });
  await page.waitForTimeout(1500);
  // A cell five steps off on the room's own steps, and where it is on the screen.
  const goal = await page.evaluate(() => {
    const s = (window as unknown as { __spike: W }).__spike, room = s.link.room, a = room.actor(s.link.me);
    const step = room.stepFor(a);
    const k = (p: { map: string; x: number; y: number }) => `${p.map}:${p.x}:${p.y}`;
    const depth = new Map([[k(a.m.spot), 0]]);
    const q = [a.m.spot];
    for (let i = 0; i < q.length; i++) {
      const p = q[i], n = depth.get(k(p))!;
      if (n === 5) {
        const g = s.placed.get(p.map)!, dpr = devicePixelRatio || 1;
        return { spot: k(p), x: ((g.gx + p.x) * 16 + 8 - s.cam.x) * s.zoom / dpr + innerWidth / 2, y: ((g.gy + p.y) * 16 + 8 - s.cam.y) * s.zoom / dpr + innerHeight / 2 };
      }
      for (const d of [1, 2, 3, 4]) { const r = step(p, d); if (r && !r.warp && !r.water && !depth.has(k(r.to))) { depth.set(k(r.to), n + 1); q.push(r.to); } }
    }
    return null;
  });
  expect(goal, 'a cell five steps away').not.toBeNull();
  await page.mouse.click(goal!.x, goal!.y);
  const at = () => page.evaluate(() => { const s = (window as unknown as { __spike: W }).__spike; const p = s.link.room.actor(s.link.me).m.spot; return `${p.map}:${p.x}:${p.y}`; });
  await expect.poll(at, { timeout: 15_000 }).toBe(goal!.spot);
  // A pad button going down buzzes, as the live game's does (POK-245).
  await page.locator('#pad .k[data-k="b"]').dispatchEvent('pointerdown', { pointerId: 1 });
  expect(await page.evaluate(() => (window as unknown as { buzzes: number }).buzzes)).toBeGreaterThan(0);
});

test('two players: the room link brings a friend in, and both see one world', async ({ browser }) => {
  test.setTimeout(300_000);
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const [hc, gc] = [await browser.newContext(phone), await browser.newContext(phone)];
  try {
    const [host, guest] = [await hc.newPage(), await gc.newPage()];
    // The host hosts; the address bar is the room's link.
    await host.goto(`/?rom=${romHashParam()}#host`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 90_000 });
    const link = new URL(host.url());
    const code = (await host.locator('#room-code').textContent())!.replace('Room ', '');
    expect(link.hash, 'the room link').toBe(`#join=${code}`);
    // The friend opens it: straight into the room.
    await guest.goto(`/?rom=${romHashParam()}${link.hash}`);
    await expect(host.locator('#room-roster li', { hasText: 'CAM' })).toHaveCount(2, { timeout: 90_000 });
    await expect(host.locator('#room-start')).toBeEnabled();
    await host.locator('#room-start').click();

    type W = { link: { me: number; room: { actors: { id: number; name: string; bot?: boolean; battling?: number; m: { spot: { map: string; x: number; y: number } } }[] } }; rom?: unknown };
    const humans = (p: typeof host) => p.evaluate(() => {
      const s = (window as unknown as { __spike: W }).__spike;
      return s.link?.room.actors.filter((a) => !a.bot).map((a) => ({ id: a.id, at: `${a.m.spot.map}:${a.m.spot.x}:${a.m.spot.y}`, battling: !!a.battling })).sort((a, b) => a.id - b.id) ?? [];
    });
    await expect.poll(async () => (await humans(host)).length, { timeout: 90_000 }).toBe(2);
    await expect.poll(async () => (await humans(guest)).length, { timeout: 30_000 }).toBe(2);
    // One world: both pages put both trainers in the same cells.
    await expect.poll(async () => JSON.stringify(await humans(host)) === JSON.stringify(await humans(guest)), { timeout: 10_000 }).toBe(true);
    // Not pulled into a duel on the spot (HBR-104).
    await guest.waitForTimeout(8_000);
    expect((await humans(host)).some((h) => h.battling), 'nobody fighting eight seconds in').toBe(false);

    // The guest walks; the host sees the same steps.
    await guest.waitForFunction(() => !!(window as unknown as { __spike: W }).__spike.rom, undefined, { timeout: 60_000 });
    const before = await humans(guest);
    for (const k of ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) {
      await guest.evaluate((k) => dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), k);
      await guest.waitForTimeout(700);
      await guest.evaluate((k) => dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })), k);
      if (JSON.stringify(await humans(guest)) !== JSON.stringify(before)) break;
    }
    const moved = await humans(guest);
    expect(JSON.stringify(moved), 'the guest moved').not.toBe(JSON.stringify(before));
    await expect.poll(async () => JSON.stringify(await humans(host)) === JSON.stringify(await humans(guest)), { timeout: 10_000 }).toBe(true);
  } finally {
    await hc.close();
    await gc.close();
  }
});

test('the debug flags deal a world of the page own: #solo&fast&nobots&seed=7', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/?rom=${romHashParam()}#solo&fast&nobots&seed=7`);
  type W = { link?: { me: number; room: { seed: number; ringPhase: number; opening: number; actors: { id: number; name: string }[] } } };
  await page.waitForFunction(() => !!(window as unknown as { __spike: W }).__spike?.link, undefined, { timeout: 90_000 });
  const r = await page.evaluate(() => { const l = (window as unknown as { __spike: W }).__spike.link!; return { seed: l.room.seed, ring: l.room.ringPhase, opening: l.room.opening, actors: l.room.actors.map((a) => a.name) }; });
  expect(r.seed, '#seed=7').toBe(7);
  expect(r.ring, '#fast: 15 s a fog phase').toBe(15 * 60);
  expect(r.opening, '#fast: 25 s of Safari').toBe(25 * 60);
  expect(r.actors, '#nobots: me and nobody else, by my own name').toEqual(['CAM']);
});
