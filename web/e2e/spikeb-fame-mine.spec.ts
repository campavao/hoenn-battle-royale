// Cam's 11-11 recording: the last trainer beaten in a fight, "You won!" -- and in place of the
// Hall of Fame, the curtain alone for 26 s, then the results. My own parade, after a win that
// came while I fought: the ROM's picture is up over the curtain, and it moves.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romHashParam } from './symbols';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 12 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}
const spike = (page: Page, f: (s: any) => void) => page.evaluate(`(${f.toString()})(window.__spike)`);

/** How many colours are on screen where the ROM's picture stands: a parade is many, the
 *  curtain alone is a few. What the player sees, whichever canvas draws it. */
const colours = async (page: Page) => {
  const box = (await page.locator('#gba').boundingBox())!;
  const png = await page.screenshot({ clip: { x: box.x + box.width * 0.1, y: box.y + box.height * 0.2, width: box.width * 0.8, height: box.height * 0.6 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data, seen = new Set<number>();
    let red = 0;
    for (let i = 0; i < px.length; i += 4) {
      seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      // The curtain's red through a hole in the picture.
      if (px[i] > 220 && px[i + 1] < 40 && px[i + 2] < 40) red++;
    }
    return { n: seen.size, red: red / (px.length / 4) };
  }, png.toString('base64'));
};

// Cam's Firefox said "Failed to create WebGL context" (11-11): the core's own canvas draws with
// it. Battles came up all the same; the parade did not.
for (const gl of [true, false]) {
  for (const midFight of [false, true]) {
    test(`my Hall of Fame${midFight ? ', crowned mid-fight' : ''}${gl ? '' : ', no WebGL'}: the ROM's picture over the curtain`, async ({ browser, playwright }) => {
      test.setTimeout(300_000);
      // No WebGL: a browser of its own, the core's canvas with nothing to draw with.
      const own = gl ? null : await playwright.chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
      const ctx = await (own ?? browser).newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1920, height: 1040 } });
      const page = await ctx.newPage();
    await page.goto(`/?rom=${romHashParam()}#solo&safari=0&fog=900&seed=6`);
    await page.locator('#intro-go').click({ timeout: 90_000 });
    await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
    await page.waitForTimeout(3000);
    // Somebody to parade, out of the DAY CARE's chest.
    await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
    await page.waitForTimeout(800);
    for (let i = 0; i < 40 && !(await page.evaluate(() => (window as any).__spike.rom.partyCount())); i++) {
      if (await page.locator('.bm-slot').first().isVisible()) { await page.locator('.bm-slot').first().click(); await page.waitForTimeout(1500); }
      else if (!(await page.evaluate(() => (window as any).__spike.swapping))) { await key(page, 'z', true); await page.waitForTimeout(90); await key(page, 'z', false); await page.waitForTimeout(1200); }
      else await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).__spike.rom.partyCount())).toBeGreaterThan(0);
    // Practice keeps no entrants; a match's are whoever was on the map when the fog first closed.
    await spike(page, (s) => { const room = s.link.room; room.results.entrants = room.actors.map((a: any) => [a.id, a.name]); });
    expect(await page.evaluate(() => (window as any).__spike.link.room.results.entrants.length), 'bots in it, to outlast').toBeGreaterThan(1);
    if (midFight) {
      // In a fight (a legendary's, the quickest to stage), then everybody else gone.
      await spike(page, (s) => {
        const room = s.link.room, a = room.actor(s.link.me);
        const KEY = (1 << 21) + 3 * 16;
        room.spills.set(KEY, { key: KEY, map: 'MAP_OLDALE_TOWN', x: 13, y: 7, name: '', legend: true, bag: { items: [], money: 0, mons: [{ species: 407, level: 5 }] } });
        a.m = { ...a.m, spot: { map: 'MAP_OLDALE_TOWN', x: 13, y: 8 }, facing: 1 };
        room.picked.set(KEY, a.id);
        a.battling = true;
        s.startFor({ type: 'legend', tick: room.tick, id: a.id, key: KEY, species: 407, level: 5 });
      });
      await page.waitForFunction(() => (window as any).__spike.rom.menuUp(), undefined, { timeout: 60_000 });
    }
    await spike(page, (s) => { const room = s.link.room; for (const a of [...room.actors]) if (a.id !== s.link.me) { room.fall(a, 'the fog'); room.remove(a.id); } });
    const fame = page.locator('#battle.on.fame');
    await expect(fame, 'the parade is up').toBeAttached({ timeout: 90_000 });
    await page.waitForTimeout(4000);
    const { n, red } = await colours(page);
    await page.screenshot({ path: test.info().outputPath(`fame-mine-${midFight ? 'mid' : 'field'}${gl ? '' : '-nogl'}.png`) });
    expect(n, 'the ROM drew the parade over the curtain').toBeGreaterThan(8);
    expect(red, 'and the curtain does not show through it').toBeLessThan(0.01);
      await ctx.close();
      await own?.close();
    });
  }
}
