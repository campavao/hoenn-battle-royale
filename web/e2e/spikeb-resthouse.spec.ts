// Cam's 11-08 play-test: walking into the Safari Zone's rest house in the opening ended the match
// for both players. The Zone is laid out by its seams; the rest house is through a door.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

test.use({ screenshot: 'only-on-failure' });

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });
const where = (page: Page) => spike(page, (s) => { const m = s.link.room.actor(s.link.me).m; return `${m.spot.map}:${m.spot.x}:${m.spot.y}`; });

test('walks into the Safari rest house and back out in the opening, the page drawing it all along', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  expect(await spike(page, (s) => !!s.link.room.ring().safari), 'the opening').toBe(true);
  // Every map the room lets a trainer onto has a place on the page.
  expect(await spike(page, (s) => [...s.link.room.maps.keys()].filter((id: string) => !s.placed.has(id)))).toEqual([]);
  // Two cells below the rest house's door (SafariZone_Southwest's warp at 29, 7), facing it.
  await page.evaluate(() => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me), spot = { map: 'MAP_SAFARI_ZONE_SOUTHWEST', x: 29, y: 9 };
    a.m = { ...a.m, spot, prev: spot, facing: 2, moveDir: 2, action: null, px: 0, py: 0, bike: false };
    a.calm = 1e9;
  });
  await page.waitForTimeout(500);
  await key(page, 'ArrowUp', true);
  try {
    await expect.poll(() => where(page), { timeout: 10_000 }).toMatch(/^MAP_SAFARI_ZONE_REST_HOUSE:/);
    await page.waitForTimeout(1500);
  } finally { await key(page, 'ArrowUp', false); }
  const frame = () => spike(page, (s) => s.link.room.tick as number);
  const t = await frame();
  await page.waitForTimeout(1000);
  expect(await frame(), 'the match still running inside: ' + errors.join(' | ').slice(0, 1500)).toBeGreaterThan(t + 30);
  await shot(page, 'rest-house-inside');
  expect(await spike(page, (s) => !!s.placed.get('MAP_SAFARI_ZONE_REST_HOUSE')), 'a place on the page').toBe(true);
  await key(page, 'ArrowDown', true);
  try {
    await expect.poll(() => where(page), { timeout: 10_000 }).toMatch(/^MAP_SAFARI_ZONE_SOUTHWEST:/);
  } finally { await key(page, 'ArrowDown', false); }
  await page.waitForTimeout(800);
  await shot(page, 'rest-house-out');
  expect(errors, 'no page errors').toEqual([]);
  await ctx.close();
});
