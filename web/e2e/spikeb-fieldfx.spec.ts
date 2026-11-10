// What's drawn on the field, from Cam's 11-02 play-test: the coming fog as a line on the MAP, a poisoned look in
// the fog, the doll over whoever got away with one, a ball that goes when it's taken, the rod's box
// that adds a dot, the bird for a flight, and a bike out of the BAG.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

test.use({ screenshot: 'only-on-failure' });

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });

/** Into a match of the page's own, past the chest with one mon (the ball off its floor, by the keys). */
async function intoMatch(page: Page, opts = '#solo&nobots&safari=0&fog=900&seed=7'): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}${opts}`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
}

async function fromChest(page: Page): Promise<void> {
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await stand(page, 'MAP_ROUTE117_POKEMON_DAY_CARE', 5, 6, 2);
  await page.waitForTimeout(800);
  const party = () => spike(page, (s) => s.rom.partyCount());
  for (let i = 0; i < 40 && !(await party()); i++) {
    if (await page.locator('.bm-slot').first().isVisible()) {
      await page.locator('.bm-slot').first().click();
      await page.waitForTimeout(1500);
    } else if (!(await spike(page, (s) => s.swapping))) {
      await tap('z');
      await page.waitForTimeout(800);
    } else await page.waitForTimeout(500);
  }
  expect(await party(), 'a mon out of the chest').toBeGreaterThan(0);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000 }).toBe(false);
}

const stand = (page: Page, map: string, x: number, y: number, facing: number) => page.evaluate(([map, x, y, facing]) => {
  const s = (window as any).__spike, a = s.link.room.actor(s.link.me), spot = { map, x, y };
  a.m = { ...a.m, spot, prev: spot, facing, moveDir: facing, action: null, px: 0, py: 0, bike: false };
  a.calm = 1e9;
}, [map, x, y, facing] as const);

/** The cell's pixels on the world's canvas, top-left and 16 x 16 world pixels of it, as [r, g, b, a] rows. */
const cellPixels = (page: Page, map: string, x: number, y: number, up = 0) => page.evaluate(([map, x, y, up]) => {
  const s = (window as any).__spike, canvas = document.getElementById('world') as HTMLCanvasElement;
  const dpr = devicePixelRatio || 1, zoom = s.zoom as number, k = zoom < dpr ? dpr : Math.max(1, zoom), z = zoom / k;
  const p = s.placed.get(map);
  const wx = (p.gx + (x as number)) * 16, wy = (p.gy + (y as number)) * 16 - (up as number);
  const cx = Math.round(canvas.width / 2 - s.cam.x * z) + wx * z, cy = Math.round(canvas.height / 2 - s.cam.y * z) + wy * z;
  const size = Math.ceil(16 * z);
  return Array.from(canvas.getContext('2d')!.getImageData(cx, cy, size, size + Math.ceil((up as number) * z)).data);
}, [map, x, y, up] as const);

const changed = (a: number[], b: number[]) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };

test('a ball with the last of a drop in it goes when it is taken, and the window is as wide as its box', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await intoMatch(page);
  await fromChest(page);
  // Out in the open, with one mon lying ahead, as LANETTE's WINGULL lay on Route 110 (video 1, 11:11).
  const ground = await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me), map = 'MAP_ROUTE101';
    for (let y = 1; y < 19; y++) for (let x = 1; x < 18; x++) {
      if (room.world.cell(map, x, y) === 0 && room.world.cell(map, x, y - 1) === 0 && room.world.cell(map, x + 2, y) === 0 && room.stepFor(a)({ map, x, y }, 2) && !room.groundAt(map, x, y - 1)) return { map, x, y };
    }
    return null;
  }) as { map: string; x: number; y: number };
  await stand(page, ground.map, ground.x + 2, ground.y, 2);
  await page.waitForTimeout(800);
  const bare = await cellPixels(page, ground.map, ground.x, ground.y - 1);
  await page.evaluate((g) => {
    (window as any).__spike.link.room.spills.set(0x7e0042, { key: 0x7e0042, map: g.map, x: g.x, y: g.y - 1, name: 'LANETTE', bag: { items: [], money: 0, mons: [{ species: 278, level: 30 }] } });
  }, ground);
  await page.waitForTimeout(300);
  expect(changed(bare, await cellPixels(page, ground.map, ground.x, ground.y - 1)), 'the ball, lying there').toBeGreaterThan(10);
  await stand(page, ground.map, ground.x, ground.y, 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('z', { delay: 120 });
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 15_000 });
  // A key shows the box round the one on its own (video 1, 11:14: wider than the window).
  await page.keyboard.press('ArrowDown', { delay: 120 });
  await page.keyboard.press('ArrowUp', { delay: 120 });
  await page.waitForTimeout(300);
  await shot(page, 'drop-window');
  const sizes = await page.evaluate(() => {
    const b = document.querySelector('.bm-slot') as HTMLElement, c = b.querySelector('canvas')!;
    return { box: b.getBoundingClientRect().width, win: c.getBoundingClientRect().width };
  });
  expect.soft(sizes.box, 'the box round it is the window').toBeCloseTo(sizes.win, 0);
  await page.locator('.bm-slot').first().click();
  await expect.poll(() => spike(page, (s) => s.rom.partyCount()), { timeout: 30_000 }).toBe(2);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000 }).toBe(false);
  // Off it, so its head isn't over the cell.
  await stand(page, ground.map, ground.x + 2, ground.y, 2);
  await page.waitForTimeout(600);
  await shot(page, 'drop-taken');
  expect(changed(bare, await cellPixels(page, ground.map, ground.x, ground.y - 1)), 'the ball, taken').toBe(0);
  await ctx.close();
});

test("the rod's box adds a dot: it does not print its line again from nothing", async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await intoMatch(page);
  await fromChest(page);
  const spot = await spike(page, (s) => {
    const w = s.link.room.world, map = 'MAP_SLATEPORT_CITY';
    for (let y = 5; y < 50; y++) for (let x = 5; x < 40; x++) if (w.cell(map, x, y) === 0 && w.cell(map, x + 1, y) === 2) return { map, x, y };
    return null;
  }) as { map: string; x: number; y: number };
  await stand(page, spot.map, spot.x, spot.y, 4);
  await page.waitForTimeout(600);
  // Every frame: the words the box holds and how much of them is printed (dark pixels).
  await page.evaluate(() => {
    const el = document.getElementById('msg')!, c = el.querySelector('canvas') as HTMLCanvasElement;
    const seen: { text: string; ink: number }[] = [];
    (window as any).__ink = seen;
    const look = () => {
      const text = el.dataset.text;
      if (text !== undefined && el.classList.contains('on') && c.width) {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] && d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110) ink++;
        seen.push({ text, ink });
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.keyboard.press('Shift', { delay: 120 });
  await expect.poll(() => page.evaluate(() => (window as any).__ink.filter((x: any) => x.text.split('·').length > 4).length), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await shot(page, 'rod-box');
  const seen = await page.evaluate(() => (window as any).__ink) as { text: string; ink: number }[];
  const dots = seen.filter((x) => /^[· ]+$/.test(x.text));
  // Frame to frame, dots only ever add ink.
  let fell = 0;
  for (let i = 1; i < dots.length; i++) if (dots[i].ink < dots[i - 1].ink) fell++;
  expect(dots.length).toBeGreaterThan(20);
  expect(fell, 'frames where the dots got fewer').toBe(0);
  await ctx.close();
});

test('the MAP has the next fog as a line while it closes in, and nothing blinks', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  // A first ring soon, so there's fog and a next one, and a team before it bites.
  await intoMatch(page, '#solo&nobots&safari=0&fog=40&seed=7');
  await fromChest(page);
  await expect.poll(() => spike(page, (s) => { const r = s.link.room.ring(); return r.phase >= 1 && r.left > 120; }), { timeout: 70_000 }).toBe(true);
  await spike(page, (s) => s.rom.fillParty());
  // Field first: standing by the next ring, there's nothing on the ground to say so. The line is the
  // MAP's alone (Cam, 11-03).
  const place = await spike(page, (s) => {
    const room = s.link.room, ring = room.ring();
    // A cell just outside the next ring.
    for (const [id, p] of room.places) for (let y = 1; y < (s.placed.get(id)?.m.h ?? 0) - 1; y++) for (let x = 1; x < s.placed.get(id).m.w - 1; x++) {
      if (!s.placed.get(id).m.outdoor || room.world.cell(id, x, y) !== 0) continue;
      const d = Math.hypot(p.gx + x + 0.5 - ring.cx, p.gy + y + 0.5 - ring.cy);
      if (d > ring.next + 0.5 && d < ring.next + 2) return { map: id, x, y };
    }
    return null;
  }) as { map: string; x: number; y: number };
  await stand(page, place.map, place.x, place.y, 1);
  await page.waitForTimeout(800);
  await shot(page, 'field-no-line');
  const onField = await page.evaluate(() => {
    const c = document.getElementById('world') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let line = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 72 && d[i + 1] === 24 && d[i + 2] === 136) line++;
    return line;
  });
  expect(onField, 'no ring on the ground').toBe(0);
  await spike(page, (s) => s.runMenu('13'));
  await expect(page.locator('#map-window .map-picture')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await shot(page, 'map-line-1');
  // How much fog is on the picture, a dozen times over two blinks: the same each time.
  const pale = () => page.evaluate(() => {
    const c = document.querySelector('#map-window .map-picture') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let fog = 0, line = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 72 && d[i + 1] === 24 && d[i + 2] === 136) line++;
      if (d[i + 2] > d[i + 1] + 40 && d[i] > d[i + 1]) fog++;
    }
    return { fog, line };
  });
  const seen: { fog: number; line: number }[] = [];
  for (let i = 0; i < 12; i++) { seen.push(await pale()); await page.waitForTimeout(280); }
  await shot(page, 'map-line-2');
  const fogs = seen.map((x) => x.fog);
  expect(Math.max(...fogs) - Math.min(...fogs), 'the fog does not blink').toBeLessThan(0.02 * Math.max(...fogs));
  // Holding, no line: it shows only as the fog moves in (Cam, 11-10: "only show the fog ring on
  // the map as the fog is actively closing in").
  expect(Math.max(...seen.map((x) => x.line)), 'no line while the ring holds').toBe(0);
  await page.keyboard.press('x');
  await expect(page.locator('#map-window .map-picture')).toBeHidden({ timeout: 5_000 });
  await expect.poll(() => spike(page, (s) => { const room = s.link.room; return room.ring(room.tick + 1).r < room.ring().r; }), { timeout: 60_000, intervals: [250] }).toBe(true);
  await spike(page, (s) => s.runMenu('13'));
  await expect(page.locator('#map-window .map-picture')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await shot(page, 'map-line-closing');
  expect((await pale()).line, 'the line is on it while it closes').toBeGreaterThan(100);
  await ctx.close();
});

test('a ring that closes on my own fight gets to it: clear when it starts, hurt from the turn it arrives', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await intoMatch(page, '#solo&nobots&safari=0&fog=40&seed=7');
  await fromChest(page);
  await spike(page, (s) => s.rom.fillParty());
  await expect.poll(() => spike(page, (s) => { const r = s.link.room.ring(); return r.phase >= 1 && r.left > 25 * 60; }), { timeout: 70_000, intervals: [250] }).toBe(true);
  // A cell inside this ring and outside the next: clear now, and the fog's by this phase's end.
  const place = await spike(page, (s) => {
    const room = s.link.room, ring = room.ring();
    for (const [id, p] of room.places) for (let y = 1; y < (s.placed.get(id)?.m.h ?? 0) - 1; y++) for (let x = 1; x < s.placed.get(id).m.w - 1; x++) {
      if (!s.placed.get(id).m.outdoor || room.world.cell(id, x, y) !== 0) continue;
      const d = Math.hypot(p.gx + x + 0.5 - ring.cx, p.gy + y + 0.5 - ring.cy);
      if (d > ring.next + 0.5 && d < ring.next + 2) return { map: id, x, y };
    }
    return null;
  }) as { map: string; x: number; y: number };
  await stand(page, place.map, place.x, place.y, 1);
  const inFog = () => spike(page, (s) => s.link.room.inFog(s.link.room.actor(s.link.me).m.spot));
  expect(await inFog(), 'clear as it starts').toBe(false);
  // What the box says, every frame; and a wild fight, off a marked spot of Route 117.
  await page.evaluate(async () => {
    const { battleText } = await import('/spike-b/battlereader.ts' as string);
    const w = window as any, s = w.__spike, emu = s.rom.emu, txt = s.art.sym('gDisplayedStringBattle');
    w.__lines = [] as string[];
    emu.onFrame(() => {
      const raw = emu.bytes(txt, 128) as Uint8Array;
      let n = 0;
      while (n < 128 && raw[n] !== 0xff) n++;
      const line = n ? battleText(raw.subarray(0, n)) : '';
      if (line && w.__lines.at(-1) !== line) w.__lines.push(line);
    });
    const room = s.link.room, a = room.actor(s.link.me), q = room.patchesOn('MAP_ROUTE117')[0];
    a.battling = true;
    s.startFor({ type: 'wild', tick: room.tick, id: a.id, map: 'MAP_ROUTE117', x: q.x, y: q.y, key: q.key });
  });
  const fogLines = () => page.evaluate(() => ((window as any).__lines as string[]).filter((l) => /hurt by the fog!/.test(l)).length);
  const battleFog = () => spike(page, (s) => s.rom.emu.read(s.art.sym('gBrRing') + 31, 8));
  await expect(page.locator('.bm-cell').first()).toBeVisible({ timeout: 25_000 });
  expect(await battleFog(), 'no fog in the fight yet').toBe(0);
  // The ring comes while the fight waits on my move.
  await expect.poll(inFog, { timeout: 110_000, intervals: [500] }).toBe(true);
  expect(await spike(page, (s) => !!s.battle), 'still in the fight').toBe(true);
  expect(await fogLines(), 'nothing said before a turn has ended').toBe(0);
  await expect.poll(async () => {
    if (await page.locator('.bm-cell').first().isVisible().catch(() => false)) await page.locator('.bm-cell').first().click({ timeout: 2000 }).catch(() => undefined);
    else await page.keyboard.press('z');
    return fogLines();
  }, { timeout: 60_000, intervals: [400] }).toBeGreaterThan(0);
  await shot(page, 'own-fight-fog');
  expect(await battleFog()).toBe(1);
  await ctx.close();
});

test('in the fog a trainer goes purple, as poison does, me and the others', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await intoMatch(page, '#solo&safari=0&fog=40&seed=7');
  await fromChest(page);
  await expect.poll(() => spike(page, (s) => s.link.room.ring().phase >= 1), { timeout: 70_000 }).toBe(true);
  await spike(page, (s) => s.rom.fillParty());
  // Me and a bot, a step apart, in the fog; and another, out of it, off to the side.
  const at = await spike(page, (s) => {
    const room = s.link.room, ring = room.ring();
    for (const [id, p] of room.places) for (let y = 3; y < (s.placed.get(id)?.m.h ?? 0) - 3; y++) for (let x = 3; x < s.placed.get(id).m.w - 3; x++) {
      if (!s.placed.get(id).m.outdoor || room.world.cell(id, x, y) || room.world.cell(id, x + 2, y) || room.world.cell(id, x - 2, y)) continue;
      if (Math.hypot(p.gx + x - ring.cx, p.gy + y - ring.cy) < ring.r + 3) continue;
      // Off a marked spot: a bot's step on one is a fight (Room.botOnPatch).
      if (room.patchesOn(id).some((q: any) => q.y === y && q.x === x + 2)) continue;
      const bot = room.actors.find((o: any) => o.bot && !o.battling);
      const spot = { map: id, x: x + 2, y };
      bot.m = { ...bot.m, spot, prev: spot, action: null, px: 0, py: 0 };
      bot.calm = 1e9;
      return { map: id, x, y, bot: bot.id };
    }
    return null;
  }) as { map: string; x: number; y: number; bot: number };
  await stand(page, at.map, at.x, at.y, 1);
  await page.waitForTimeout(500);
  // Frame by frame over two pulses: how much of each sprite is the purple of RGB(30, 0, 31).
  const purple = await page.evaluate(([map, x, y, bx, botId]) => new Promise<{ me: number; bot: number; shots: number }>((done) => {
    const s = (window as any).__spike, canvas = document.getElementById('world') as HTMLCanvasElement;
    const c = canvas.getContext('2d')!;
    let n = 0, me = 0, bot = 0;
    const count = (cx: number) => {
      const dpr = devicePixelRatio || 1, zoom = s.zoom as number, k = zoom < dpr ? dpr : Math.max(1, zoom), z = zoom / k;
      const p = s.placed.get(map);
      const left = Math.round(canvas.width / 2 - s.cam.x * z) + (p.gx + cx) * 16 * z, top = Math.round(canvas.height / 2 - s.cam.y * z) + (p.gy + (y as number) - 1) * 16 * z;
      const d = c.getImageData(left, top, 16 * z, 32 * z).data;
      let m = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 2] > 170 && d[i + 1] < 90) m++;
      return m;
    };
    const look = () => {
      // Kept on its cell: a bot in the fog walks for the way out, and calm doesn't hold it.
      const b = s.link.room.actor(botId), spot = { map, x: bx, y };
      if (b) b.m = { ...b.m, spot, prev: spot, action: null, px: 0, py: 0 };
      me = Math.max(me, count(x as number));
      bot = Math.max(bot, count(bx as number));
      if (++n < 200) requestAnimationFrame(look); else done({ me, bot, shots: n });
    };
    requestAnimationFrame(look);
  }), [at.map, at.x, at.y, at.x + 2, at.bot] as const);
  await shot(page, 'poison');
  expect(purple.me, 'me').toBeGreaterThan(10);
  expect(purple.bot, 'the bot beside me').toBeGreaterThan(10);
  await ctx.close();
});

test('a bot run from with a POKe DOLL: the doll over the runner, blinking', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await intoMatch(page, '#solo&safari=0&fog=900&seed=7');
  await fromChest(page);
  // #safari=0 still opens with the Zone's rules, in which nobody fights.
  await spike(page, (s) => { s.link.room.opening = 0; });
  await spike(page, (s) => s.give(80));
  await page.waitForTimeout(1500);
  // A bot a step away, in the open: the room's own engage. Again until it has: a bot can step off
  // before the room looks, and the A that follows must not find a wild patch instead.
  await expect.poll(async () => {
    await spike(page, (s) => {
      const room = s.link.room, a = room.actor(s.link.me), map = 'MAP_ROUTE101';
      if (a.foe) return;
      const bot = room.actors.find((o: any) => o.bot && !o.battling);
      // A ZIGZAGOON in front: a lead with Shadow Tag or Arena Trap leaves nothing to run with.
      bot.caught = [288];
      for (let y = 1; y < 19; y++) for (let x = 1; x < 18; x++) {
        if (!room.world.cell(map, x, y) && !room.world.cell(map, x + 1, y) && !room.patchesOn(map).some((q: any) => q.y === y && (q.x === x || q.x === x + 1))) {
          const me = { map, x, y }, it = { map, x: x + 1, y };
          a.m = { ...a.m, spot: me, prev: me, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
          bot.m = { ...bot.m, spot: it, prev: it, facing: 3, moveDir: 3, action: null, px: 0, py: 0 };
          a.calm = bot.calm = 0;
          return;
        }
      }
    });
    await page.waitForTimeout(200);
    return spike(page, (s) => !!s.link.room.actor(s.link.me).foe);
  }, { timeout: 30_000 }).toBe(true);
  await page.keyboard.press('z', { delay: 150 });
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
  // The fight's picture, as it closes: never gone to black shapes (POK-435).
  await page.evaluate(() => {
    const k = document.getElementById('gba-key') as HTMLCanvasElement, b = document.getElementById('battle')!, seen: number[] = [];
    (window as any).__black = seen;
    const look = () => {
      if (b.classList.contains('see')) {
        const d = k.getContext('2d')!.getImageData(0, 0, k.width, k.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] && d[i] + d[i + 1] + d[i + 2] < 24) n++;
        seen.push(n);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.locator('.bm-act-run').click();
  await expect.poll(() => spike(page, (s) => { const a = s.link.room.actor(s.link.me); return !a.battling && a.shunUntil > s.link.room.tick; }), { timeout: 40_000 }).toBe(true);
  const black = await page.evaluate(() => (window as any).__black) as number[];
  expect(black.length).toBeGreaterThan(10);
  expect(Math.max(...black), 'black in the fight\'s picture, as it closed').toBeLessThan(2 * black[0] + 200);
  const box = await spike(page, (s) => { const a = s.link.room.actor(s.link.me); return { map: a.m.spot.map, x: a.m.spot.x, y: a.m.spot.y }; }) as { map: string; x: number; y: number };
  // Over the head: on, and off, and on.
  const counts: number[] = [];
  let shots = 0;
  for (let i = 0; i < 24; i++) {
    const d = await cellPixels(page, box.map, box.x, box.y, 48);
    let n = 0;
    for (let j = 0; j < d.length; j += 4) if (d[j] === 248 && d[j + 1] === 248 && d[j + 2] === 248) n++;
    counts.push(n);
    if (n > 60 && shots < 1) { shots++; await shot(page, 'doll-on'); }
    await page.waitForTimeout(40);
  }
  await shot(page, 'doll-any');
  expect(Math.max(...counts) - Math.min(...counts), 'the doll is up, and it blinks').toBeGreaterThan(40);
  await ctx.close();
});

test('FLY is Emerald\'s bird: off the MAP, and for a trainer in view', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await intoMatch(page, '#solo&safari=0&fog=900&seed=7');
  await fromChest(page);
  await spike(page, (s) => { s.link.room.opening = 0; });
  await stand(page, 'MAP_ROUTE101', 10, 10, 1);
  await spike(page, (s) => s.give(340));
  await expect(page.locator('.bm-use-head')).toBeVisible({ timeout: 15_000 });
  await page.locator('.bm-slot').first().click();
  // With four moves it asks which goes.
  await page.locator('.bm-pick-move').nth(1).click({ timeout: 8_000 }).catch(() => {});
  await expect.poll(() => page.evaluate(async () => (await (window as any).__spike.rom.fameTeam()).some((m: any) => m.moves.some((x: any) => x.id === 19))), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => spike(page, (s) => s.swapping || s.battleMenu.isShown), { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(800);
  await spike(page, (s) => s.runMenu('13'));
  await expect(page.locator('#map-window [aria-label="FLY"]')).toBeVisible({ timeout: 5_000 });
  const oldale = await spike(page, (s) => s.ringMap.cellOf({ map: 'MAP_OLDALE_TOWN', x: 5, y: 5 })) as { x: number; y: number };
  const at = (await page.locator('#map-window .map-picture').boundingBox())!;
  await page.mouse.click(at.x + ((8 * oldale.x + 12) * at.width) / 240, at.y + ((8 * oldale.y + 20) * at.height) / 160);
  await expect.poll(() => spike(page, (s) => s.mapWindow.cursor)).toEqual(oldale);
  // The canvas every few frames from the press on, to look at after.
  await page.evaluate(() => {
    const canvas = document.getElementById('world') as HTMLCanvasElement, out: string[] = [];
    (window as any).__frames = out;
    let n = 0;
    const look = () => {
      if (n++ % 8 === 0 && out.length < 16) out.push(canvas.toDataURL('image/jpeg', 0.8));
      if (out.length < 16) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.locator('#map-window [aria-label="FLY"]').click();
  const seenBird = await page.waitForFunction(() => (window as any).__spike.flights?.length > 0, undefined, { timeout: 3_000 }).then(() => true, () => false);
  await expect.poll(() => spike(page, (s) => { const p = s.link.room.actor(s.link.me).m.spot; return `${p.map}:${p.x}:${p.y}`; }), { timeout: 5_000 }).toBe('MAP_OLDALE_TOWN:6:17');
  await page.waitForTimeout(2500);
  const frames = await page.evaluate(() => (window as any).__frames) as string[];
  const { writeFileSync } = await import('node:fs');
  frames.forEach((f, i) => writeFileSync(test.info().outputPath(`fly-${String(i).padStart(2, '0')}.jpg`), Buffer.from(f.split(',')[1], 'base64')));
  expect(seenBird, 'the bird').toBe(true);
  await expect.poll(() => spike(page, (s) => s.flights.length), { timeout: 5_000 }).toBe(0);
  // Somebody else's, as the room hands it to this page: the same command off the relay. In view
  // here, and the bird comes for them where I can see.
  const other = await spike(page, (s) => {
    const room = s.link.room, me = room.actor(s.link.me).m.spot;
    const o = room.actors.find((a: any) => a.bot && !a.battling);
    const spot = { map: me.map, x: me.x + 2, y: me.y };
    o.m = { ...o.m, spot, prev: spot, action: null, px: 0, py: 0 };
    o.bot = false;
    o.calm = 1e9;
    return o.id;
  }) as number;
  await page.waitForTimeout(600);
  await page.evaluate((id) => {
    const s = (window as any).__spike;
    s.link.room.apply({ c: 'fly', id, to: { map: 'MAP_RUSTBORO_CITY', x: 16, y: 39 } });
  }, other);
  await page.waitForFunction((id) => (window as any).__spike.flights.some((f: any) => f.id === id), other, { timeout: 2_000 });
  await page.waitForTimeout(280);
  await shot(page, 'fly-other');
  await ctx.close();
});

test('the ACRO BIKE and the MACH BIKE from the BAG: the window shuts and I ride, and again gets off', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await intoMatch(page);
  await fromChest(page);
  await spike(page, (s) => { s.link.room.opening = 0; });
  await stand(page, 'MAP_ROUTE101', 10, 10, 1);
  await page.waitForTimeout(500);
  const useBike = async (item: number) => {
    await page.keyboard.press('e', { delay: 120 });
    await expect(page.locator('.bm-bag-head')).toBeVisible();
    await page.evaluate((item) => {
      const m = (window as any).__spike.battleMenu;
      for (let i = 0; i < 6 && !m.stacks().some((x: any) => x.item === item); i++) m.stepPocket(1);
      m.picked = item;
      m.setMode('item');
    }, item);
    await page.waitForTimeout(200);
    await shot(page, `bike-bag-${item}`);
    await page.locator('.bm-bag-use').click();
  };
  const riding = () => spike(page, (s) => s.link.room.actor(s.link.me).m.bike);
  await useBike(272);
  await expect.poll(riding, { timeout: 5_000, message: 'on the bike' }).toBe(true);
  await expect(page.locator('.bm-bag-head')).toBeHidden();
  await page.waitForTimeout(300);
  await shot(page, 'bike-on');
  await useBike(272);
  await expect.poll(riding, { timeout: 5_000, message: 'off it' }).toBe(false);
  await useBike(259);
  await expect.poll(riding, { timeout: 5_000, message: 'on the other' }).toBe(true);
  // Indoors there's no riding, and it says so.
  await spike(page, (s) => { s.link.room.actor(s.link.me).m.bike = false; });
  await stand(page, 'MAP_ROUTE117_POKEMON_DAY_CARE', 5, 7, 1);
  await page.waitForTimeout(400);
  await useBike(272);
  await expect(page.locator('#msg')).toHaveAttribute('data-text', /time and place/, { timeout: 5_000 });
  expect(await riding()).toBe(false);
  await ctx.close();
});

// Cam, 11-03, "Yes, make them work": the rocks of Jagged Pass and the Safari Zone's rails, on the
// real page and its real ROM, by the keys. Everything below the teleport to each start is a keypress.
test.describe('the ACRO BIKE on its own ground', () => {
  const rider = (page: Page) => spike(page, (s) => { const m = s.link.room.actor(s.link.me).m; return { map: m.spot.map, x: m.spot.x, y: m.spot.y, bike: m.bike, acro: m.acro, state: m.acroState, lift: m.lift, kind: m.action?.kind, facing: m.facing }; });
  const at = (page: Page, x: number, y: number, t = 8_000) => page.waitForFunction(([x, y]) => { const m = (window as any).__spike.link.room.actor((window as any).__spike.link.me).m; return m.spot.x === x && m.spot.y === y && !m.action; }, [x, y], { timeout: t });
  /** In the air, on the way to (x, y): the rider's coords are there from the jump's first frame. */
  const inAir = (page: Page, x: number, y: number, t = 8_000) => page.waitForFunction(([x, y]) => { const m = (window as any).__spike.link.room.actor((window as any).__spike.link.me).m; return m.spot.x === x && m.spot.y === y && m.lift <= -4; }, [x, y], { timeout: t, polling: 16 });
  const hold = async (page: Page, keys: string[], fn: () => Promise<unknown>) => {
    for (const k of keys) await key(page, k, true);
    try { await fn(); } finally { for (const k of keys) await key(page, k, false); }
  };
  const useBike = async (page: Page, item: number) => {
    await page.keyboard.press('e', { delay: 120 });
    await expect(page.locator('.bm-bag-head')).toBeVisible();
    await page.evaluate((item) => {
      const m = (window as any).__spike.battleMenu;
      for (let i = 0; i < 6 && !m.stacks().some((x: any) => x.item === item); i++) m.stepPocket(1);
      m.picked = item;
      m.setMode('item');
    }, item);
    await page.waitForTimeout(150);
    await page.locator('.bm-bag-use').click();
    await expect(page.locator('.bm-bag-head')).toBeHidden();
  };

  test('hops up the rocks of Jagged Pass, B held, where a walker and the MACH BIKE stop', async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await intoMatch(page);
    await fromChest(page);
    await spike(page, (s) => { s.link.room.opening = 0; });
    // On foot: a wall.
    await stand(page, 'MAP_JAGGED_PASS', 22, 19, 2);
    await page.waitForTimeout(500);
    await hold(page, ['ArrowUp'], () => page.waitForTimeout(700));
    expect(await rider(page)).toMatchObject({ x: 22, y: 19, bike: false });
    await shot(page, 'acro-rock-foot');
    // Beside the rock, the quick action is the ACRO BIKE (Cam, 11-04), with its own picture.
    await page.waitForTimeout(300);
    await page.locator('#hud-ctx').screenshot({ path: testInfo.outputPath('acro-near-button.png') });
    await page.keyboard.press('Shift', { delay: 120 });
    await expect.poll(async () => (await rider(page)).bike, { timeout: 5_000 }).toBe(true);
    expect((await rider(page)).acro).toBe(true);
    await page.waitForTimeout(300);
    await page.keyboard.press('Shift', { delay: 120 });
    await expect.poll(async () => (await rider(page)).bike, { timeout: 5_000 }).toBe(false);
    // The MACH BIKE: a wall, B or no B.
    await useBike(page, 259);
    await expect.poll(async () => (await rider(page)).bike, { timeout: 5_000 }).toBe(true);
    expect((await rider(page)).acro).toBe(false);
    await hold(page, ['ArrowUp', 'x'], () => page.waitForTimeout(1500));
    expect(await rider(page)).toMatchObject({ x: 22, y: 19 });
    await shot(page, 'acro-rock-mach');
    // The ACRO BIKE out of the BAG changes bikes there.
    await useBike(page, 272);
    await expect.poll(async () => (await rider(page)).acro, { timeout: 5_000 }).toBe(true);
    await page.waitForTimeout(300);
    await hold(page, ['ArrowUp'], () => page.waitForTimeout(600));
    expect(await rider(page)).toMatchObject({ x: 22, y: 19, bike: true, acro: true });
    await shot(page, 'acro-rock-acro-stopped');
    // Hold B: the wheelie, then, 40 frames on, the bunny hop on the spot.
    await key(page, 'x', true);
    await expect.poll(async () => (await rider(page)).state, { timeout: 5_000 }).toBe(2);
    await page.waitForTimeout(150);
    await shot(page, 'acro-rock-wheelie');
    await expect.poll(async () => (await rider(page)).state, { timeout: 5_000 }).toBe(3);
    // And up, a rock at a time, with the rider off the ground.
    await key(page, 'ArrowUp', true);
    await inAir(page, 22, 17);
    await shot(page, 'acro-rock-in-the-air');
    await at(page, 22, 15);
    await key(page, 'ArrowUp', false);
    await key(page, 'x', false);
    expect((await rider(page)).map).toBe('MAP_JAGGED_PASS');
    await page.waitForTimeout(300);
    await shot(page, 'acro-rock-top');
    await ctx.close();
  });

  test('rides the Safari Zone rails in the opening, jumping the isolated pieces, where a walker stops', async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await intoMatch(page, '#solo&nobots&fog=900&seed=7');
    expect(await spike(page, (s) => !!s.link.room.ring().safari), 'the opening').toBe(true);
    await stand(page, 'MAP_SAFARI_ZONE_SOUTH', 16, 7, 4);
    await page.waitForTimeout(500);
    await hold(page, ['ArrowRight'], () => page.waitForTimeout(700));
    expect(await rider(page)).toMatchObject({ x: 16, y: 7, bike: false });
    await shot(page, 'acro-rail-foot');
    // The MACH BIKE is no bike for the Zone.
    await useBike(page, 259);
    await expect(page.locator('#msg')).toHaveAttribute('data-text', /time and place/, { timeout: 5_000 });
    expect((await rider(page)).bike).toBe(false);
    await page.waitForTimeout(2800);
    await useBike(page, 272);
    await expect.poll(async () => (await rider(page)).bike, { timeout: 5_000 }).toBe(true);
    expect((await rider(page)).acro).toBe(true);
    await hold(page, ['ArrowRight'], async () => {
      await page.waitForFunction(() => { const m = (window as any).__spike.link.room.actor((window as any).__spike.link.me).m; return m.spot.x === 18; }, undefined, { polling: 16 });
      await shot(page, 'acro-rail-riding');
      await at(page, 20, 7);
    });
    // Off a rail there is no getting off, and no leaving it by pushing crosswise.
    await page.waitForTimeout(200);
    await hold(page, ['ArrowUp'], () => page.waitForTimeout(400));
    expect(await rider(page)).toMatchObject({ x: 20, y: 7, facing: 4 });
    await useBike(page, 272);
    await expect(page.locator('#msg')).toHaveAttribute('data-text', /dismount/, { timeout: 5_000 });
    expect((await rider(page)).bike).toBe(true);
    // B and up: over, facing east still, a piece at a time.
    await hold(page, ['x', 'ArrowUp'], async () => {
      await inAir(page, 20, 6);
      await shot(page, 'acro-rail-jump');
      await at(page, 20, 5);
    });
    await page.waitForTimeout(200);
    await hold(page, ['ArrowRight'], () => at(page, 22, 5));
    await page.waitForTimeout(200);
    await hold(page, ['x', 'ArrowUp'], () => at(page, 22, 3));
    await page.waitForTimeout(200);
    await hold(page, ['ArrowRight'], () => at(page, 26, 3));
    await page.waitForTimeout(300);
    // On along the rail, a step further if the key comes up late (once on CI, 27).
    const across = await rider(page);
    expect(across).toMatchObject({ map: 'MAP_SAFARI_ZONE_SOUTH', y: 3, bike: true, acro: true });
    expect(across.x).toBeGreaterThanOrEqual(26);
    await shot(page, 'acro-rail-across');
    await ctx.close();
  });
});
