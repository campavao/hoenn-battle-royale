// The page-drawn battle for whoever watches a fight (web/spike-b/battleview.ts): a canned log
// played on `#battleview`, and, with HBR_SHOTS set, the ROM's own battle beside it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const SHOTS = process.env.HBR_SHOTS;

/** Into a match of the page's own with a team of six, a little way from anything. */
async function withTeam(page: Page): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
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
  await spike(page, (s) => s.rom.fillParty());
}

async function intoBattle(page: Page): Promise<void> {
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const q = room.patchesOn('MAP_ROUTE117').find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map: 'MAP_ROUTE117', x: q.x - 1, y: q.y }, 4));
    const spot = { map: 'MAP_ROUTE117', x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
  });
  await page.waitForTimeout(1000);
  await key(page, 'ArrowRight', true); await page.waitForTimeout(150); await key(page, 'ArrowRight', false);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

const VIEW = (hash: string) => `/?rom=${romHashParam()}#battleview${hash}`;
const snap = (page: Page) => page.evaluate(() => (window as any).__battleview.snapshot());
async function openView(page: Page, hash = ''): Promise<void> {
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(VIEW(hash));
  await page.waitForFunction(() => !!(window as any).__battleview, undefined, { timeout: 90_000 });
  await page.waitForTimeout(500);
}
/** The pixels of the canvas that are not the ground's or black: some picture is on it. */
const painted = (page: Page) => page.evaluate(() => {
  const c = document.querySelector('#battleview-host canvas') as HTMLCanvasElement;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] && d[i] + d[i + 1] + d[i + 2] > 30) n++;
  return n;
});

test.describe('the page-drawn battle', () => {
  test.setTimeout(180_000);

  test('plays a canned log to its end and stands where the fight finished', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
    await openView(page, '&hold');
    expect((await snap(page)).ms).toBe(0);
    await page.evaluate(() => (window as any).__battleview.seek(1e9));
    const s = await snap(page);
    expect(s.ended).toBe(true);
    expect(s.waiting).toBe(false);
    // SHARPEDO (near, 331) took one TACKLE and is paralysed; the foe is out of mons.
    expect(s.near).toEqual({ species: 331, hp: 18, maxHp: 23, status: 0x40 });
    expect(s.far).toBeNull();
    expect(s.text).toBe('LASS ROSE is out of mons!');
    expect(s.chars).toBe(s.text.length);
    expect(await painted(page), 'the ground and the box are drawn').toBeGreaterThan(20_000);
    expect(await page.locator('#battleview-host canvas').getAttribute('data-near')).toBe('331:18');
  });

  test('joined late, drops in where the fight stands, mid-drain, with no catching up', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
    await openView(page, '&hold&at=9500');
    const s = await snap(page);
    // 9.5 s in: BITE has landed on POOCHYENA (286) and its bar is part-way from 19 down to 8.
    expect(s.far?.species).toBe(286);
    expect(s.far!.hp).toBeGreaterThan(8);
    expect(s.far!.hp).toBeLessThan(19);
    expect(s.far!.hp).toBe(13);
    expect(s.near).toEqual({ species: 331, hp: 23, maxHp: 23, status: 0 });
    expect(s.text).toBe('SHARPEDO used BITE!');
    expect(s.ms).toBe(9500);
    // Moving on in time moves the bar on, the other way round puts it back.
    await page.evaluate(() => (window as any).__battleview.seek(10_000));
    expect((await snap(page)).far!.hp).toBe(8);
    await page.evaluate(() => (window as any).__battleview.seek(9100));
    expect((await snap(page)).far!.hp).toBe(19);
  });

  test('a wild POKeMON comes with no trainer and is there from the start', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
    await openView(page, '&wild&hold&at=2100');
    const shot = async (name: string) => {
      if (SHOTS) await page.locator('#battleview-host canvas').screenshot({ path: join(SHOTS, `${name}.png`) });
    };
    await page.waitForTimeout(500);
    await shot('wild-announced');
    const said = await snap(page);
    await page.evaluate(() => (window as any).__battleview.seek(900));
    await page.waitForTimeout(300);
    await shot('wild-opening');
    const open = await snap(page);
    expect(said.far?.species).toBe(286);
    expect(said.text).toBe('Wild POOCHYENA appeared!');
    expect(open.far?.species).toBe(286);
    expect(open.text).toBe('');
  });

  test('flips for a watcher who follows side 1: that trainer is near, back to the camera', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
    await openView(page, '&hold&at=7100');
    const a = await snap(page);
    expect([a.near?.species, a.far?.species, a.follow]).toEqual([331, 286, 0]);
    await page.evaluate(() => (window as any).__battleview.follow(1));
    const b = await snap(page);
    expect([b.near?.species, b.far?.species, b.follow]).toEqual([286, 331, 1]);
    // Each shown the other way round: the near box has the numbers, so the HP of the near one is read.
    expect(b.near).toEqual({ species: 286, hp: 19, maxHp: 19, status: 0 });
    await openView(page, '&hold&at=7100&follow=1');
    expect((await snap(page)).near?.species).toBe(286);
  });

  test('a live log waits for the next turn when it runs out, and plays on when it comes', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
    await openView(page, '&hold');
    const start = { e: 'start', a: { seat: 1, name: 'A', skin: 0, team: [{ species: 331, level: 5, hp: 23, maxHp: 23, status: 0 }] }, b: { seat: 2, name: 'B', skin: 5, team: [{ species: 286, level: 5, hp: 19, maxHp: 19, status: 0 }] }, map: 'MAP_ROUTE117' };
    // Only the start is known, 2 s of it.
    await page.evaluate((start) => { const v = (window as any).__battleview; v.play([start], 0); v.resume(); }, start);
    await page.waitForTimeout(3200);
    let s = await snap(page);
    expect(s.waiting).toBe(true);
    expect(s.ms).toBe(2000);
    await page.waitForTimeout(500);
    expect((await snap(page)).ms, 'still waiting, not running on').toBe(2000);
    // The next turn arrives: a send-out, which plays out and waits again.
    await page.evaluate(() => (window as any).__battleview.add([{ e: 'send', side: 1, slot: 0 }, { e: 'send', side: 0, slot: 0 }]));
    await page.waitForTimeout(600);
    s = await snap(page);
    expect(s.waiting).toBe(false);
    expect(s.ms).toBeGreaterThan(2000);
    await page.waitForTimeout(2500);
    s = await snap(page);
    expect(s.waiting).toBe(true);
    expect(s.ms).toBe(4400);
    expect(s.near?.species).toBe(331);
    expect(s.far?.species).toBe(286);
  });

  test('fits a phone, 1280x720 and 1920x1080, at a whole number of device pixels, and draws in a few ms', async ({ browser }) => {
    const frames: Record<string, unknown> = {};
    for (const [name, w, h, dpr] of [['phone 375x667 @3x', 375, 667, 3], ['1280x720', 1280, 720, 1], ['1920x1080', 1920, 1080, 1]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      await openView(page);
      // Let the canned log play for a few seconds, drawing as it does.
      await page.waitForTimeout(6000);
      const box = (await page.locator('#battleview-host canvas').boundingBox())!;
      const s = await snap(page);
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.y, name).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, name).toBeLessThanOrEqual(w + 0.01);
      expect(box.y + box.height, name).toBeLessThanOrEqual(h + 0.01);
      expect((s.scale * dpr) % 1, `${name}: whole device pixels a pixel`).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no sideways scroll`).toBe(true);
      const stats = await page.evaluate(() => (window as any).__battleview.stats());
      // And what the browser makes of it, raster and all: the gaps between frames while the log plays.
      const gaps = await page.evaluate(() => new Promise<number[]>((done) => { const g: number[] = []; let last = performance.now(); const tick = (now: number) => { g.push(now - last); last = now; if (g.length < 90) requestAnimationFrame(tick); else done(g); }; requestAnimationFrame(tick); }));
      gaps.sort((a, b) => a - b);
      frames[name] = { frameGapMeanMs: gaps.reduce((a, b) => a + b, 0) / gaps.length, frameGapP95Ms: gaps[Math.floor(gaps.length * 0.95)], css: `${Math.round(box.width)}x${Math.round(box.height)}`, scale: s.scale, ...stats };
      expect(stats.draws, name).toBeGreaterThan(10);
      expect(stats.meanMs, `${name}: mean draw ms`).toBeLessThan(8);
      await ctx.close();
    }
    console.log('FRAMES', JSON.stringify(frames));
    if (SHOTS) writeFileSync(join(SHOTS, 'frame-times.json'), JSON.stringify(frames, null, 1));
  });
});
/** The log of the ROM's own battle's matchup, both out and waiting on a move, for the view beside it. */
function matchLog(mons: { species: number; hp: number; level: number; maxHp: number; gender: number; name: string }[], names: [string, string]): unknown[] {
  const mon = (m: { species: number; hp: number; level: number; maxHp: number; gender: number }) => ({ species: m.species, level: m.level, hp: m.hp, maxHp: m.maxHp, status: 0, gender: m.gender });
  return [
    { e: 'start', a: { seat: 1, name: names[0], skin: 0, team: [mon(mons[0])] }, b: { seat: 2, name: names[1], skin: 15, team: [mon(mons[1])] }, map: 'MAP_ROUTE117' },
    { e: 'send', side: 1, slot: 0 },
    { e: 'send', side: 0, slot: 0 },
    { e: 'text', text: `What will\n${mons[0].name} do?` },
  ];
}

test('the ROM battle and the view, side by side', async ({ browser }) => {
  test.skip(!SHOTS, 'HBR_SHOTS names the folder the frames are saved in');
  test.setTimeout(300_000);
  mkdirSync(SHOTS!, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await withTeam(page);
  await intoBattle(page);
  const frame = async (name: string) => { await page.screenshot({ path: join(SHOTS!, `${name}.png`), clip: (await page.locator('#gba').boundingBox())! }); };
  await frame('rom-menu');
  const mons = await spike(page, (s) => {
    const at = s.art.sym('gBattleMons'), info = s.art.sym('gSpeciesInfo') - 0x08000000, r = s.rom.emu.read.bind(s.rom.emu), rom = s.rom.emu.readRom();
    const read = (i: number) => {
      const o = at + i * 0x58, species = r(o, 16), personality = r(o + 0x48, 32), ratio = rom[info + species * 0x1c + 0x10];
      return { species, hp: r(o + 0x28, 16), level: r(o + 0x2a, 8), maxHp: r(o + 0x2c, 16), personality, gender: ratio === 255 ? 2 : (personality & 0xff) < ratio ? 1 : 0, name: s.art.speciesName(species) };
    };
    return [read(0), read(1)];
  });
  writeFileSync(join(SHOTS!, 'rom-mons.json'), JSON.stringify(mons));
  await ctx.close();
});

test('the view, for the look', async ({ browser }) => {
  test.skip(!SHOTS, 'HBR_SHOTS names the folder the frames are saved in');
  test.setTimeout(300_000);
  const mons = JSON.parse(readFileSync(join(SHOTS!, 'rom-mons.json'), 'utf8'));
  const ctx2 = await browser.newContext({ viewport: { width: 480, height: 320 } });
  const view = await ctx2.newPage();
  view.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
  await view.goto(`/?rom=${romHashParam()}#battleview&hold&nolv`);
  await view.waitForFunction(() => !!(window as any).__battleview, undefined, { timeout: 90_000 });
  const log = matchLog(mons, ['BRENDAN', 'LASS ROSE']);
  await view.evaluate((log) => { const v = (window as any).__battleview; v.play(log, 0); v.seek(1e9); }, log as any);
  await view.waitForTimeout(400);
  await view.screenshot({ path: join(SHOTS!, 'view-menu.png'), clip: (await view.locator('#battleview-host canvas').boundingBox())! });
  // The canned log's other moments, for the animations.
  await view.goto(`/?rom=${romHashParam()}#battleview&hold&at=1500`);
  await view.reload();
  await view.waitForFunction(() => !!(window as any).__battleview, undefined, { timeout: 90_000 });
  for (const [name, at] of [['view-start', 1500], ['view-sendout', 4400], ['view-hit', 8700], ['view-drain', 9500], ['view-faint', 15800], ['view-status', 22100]] as const) {
    await view.evaluate((at) => (window as any).__battleview.seek(at), at);
    await view.waitForTimeout(300);
    await view.screenshot({ path: join(SHOTS!, `${name}.png`), clip: (await view.locator('#battleview-host canvas').boundingBox())! });
  }
  await view.goto(`/?rom=${romHashParam()}#battleview&hold&follow=1&at=7100`);
  await view.reload();
  await view.waitForFunction(() => !!(window as any).__battleview, undefined, { timeout: 90_000 });
  await view.waitForTimeout(300);
  await view.screenshot({ path: join(SHOTS!, 'view-flipped.png'), clip: (await view.locator('#battleview-host canvas').boundingBox())! });
  await view.goto(`/?rom=${romHashParam()}#battleview&hold&behind&at=7100`);
  await view.reload();
  await view.waitForFunction(() => !!(window as any).__battleview, undefined, { timeout: 90_000 });
  await view.waitForTimeout(300);
  await view.screenshot({ path: join(SHOTS!, 'view-behind.png'), clip: (await view.locator('#battleview-host canvas').boundingBox())! });
  await ctx2.close();
});
