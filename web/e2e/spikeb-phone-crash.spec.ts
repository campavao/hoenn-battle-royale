// What a phone's tab can hold (Reddit, 11-12: "crashing every few minutes", back on the loading
// screen). Every map of Hoenn painted at full size was 647 MB of canvas a minute after boot; the
// page keeps the maps near the camera at full size and the rest as their small copies (mips).
// A reload that lost its match says so, not "There is no room", and a TM asked about when the tab
// went is still in the bag (Reddit, 11-12: "it didnt even teach the move and still deleted the tm").
import { test, expect, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

type P = { m: { id: string; w: number; h: number }; ground?: HTMLCanvasElement; cover?: HTMLCanvasElement; mips?: HTMLCanvasElement[] };
type S = { placed: Map<string, P>; zoom: number; link: { me: number; room: { actor(id: number): { m: { spot: { map: string } } } } } };

const held = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __spike: S }).__spike;
  const all = [...s.placed.values()];
  const full = all.filter((p) => p.ground);
  return {
    maps: all.length,
    mipped: all.filter((p) => p.mips).length,
    full: full.length,
    mb: Math.round(full.reduce((n, p) => n + p.m.w * p.m.h * 16 * 16 * 8, 0) / 1e6),
    mine: !!s.placed.get(s.link.room.actor(s.link.me).m.spot.map)?.ground,
  };
});

test("a match holds the maps near it at full size, and the rest of Hoenn's small", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => !!(window as unknown as { __spike?: S }).__spike?.link?.room.actor((window as unknown as { __spike: S }).__spike.link.me), undefined, { timeout: 90_000 });
  // The background cut reaches every map (a zoom-out never waits on one)...
  await expect.poll(async () => { const h = await held(page); return h.mipped === h.maps; }, { timeout: 150_000, intervals: [2000] }).toBe(true);
  const h = await held(page);
  console.log('held', JSON.stringify(h));
  // ...and keeps only what is near at full size: under the budget, and the map I stand on.
  expect(h.mb, `${h.full} maps at full size`).toBeLessThanOrEqual(96);
  expect(h.mine).toBe(true);
  // Zoomed all the way out, Hoenn is drawn from its mips, and nothing is cut at full size for it.
  for (let i = 0; i < 6; i++) await page.keyboard.press('-');
  await page.waitForTimeout(3000);
  expect((await held(page)).mb).toBeLessThanOrEqual(96);
});

test('a reload whose match has gone says the match ended, not that there is no room', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/?rom=${romHashParam()}`);
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 90_000 });
  // What a reload mid-battle left: the relay dropped the trainer, and a bot match with nobody
  // else in it closed.
  await page.evaluate(() => localStorage.setItem('spikeB.again', JSON.stringify({ code: 'QZQZ', id: 7, key: 'gone', at: Date.now() })));
  await page.reload();
  await expect(page.getByText('The page reloaded, and your match ended without you.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('There is no room QZQZ.')).toHaveCount(0);
  // A room's seat between matches (no match lost) still says the room has gone.
  await page.evaluate(() => localStorage.setItem('spikeB.again', JSON.stringify({ code: 'QZQZ', id: 7, key: 'gone', at: Date.now(), room: true })));
  await page.reload();
  await expect(page.getByText('There is no room QZQZ.')).toBeVisible({ timeout: 60_000 });
});

test('a TM off the ground is in the bag while it asks who learns it', async ({ page }) => {
  // In the bag, and saved so (remember), before the question: the relay took it off the ground
  // when it was picked up, and a reload at the question found it in no save.
  test.setTimeout(300_000);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const s = <T>(f: (s: any, arg?: any) => T, arg?: unknown) =>
    page.evaluate(([src, arg]) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as any).__spike, arg), [f.toString(), arg] as const) as Promise<T>;
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const x = (window as any).__spike; return !!x?.rom && !!x.link?.room.actor(x.link.me) && !!x.art; }, undefined, { timeout: 180_000 });
  // A team out of the Day Care's chest (spikeb-flow.spec.ts withTeam).
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await s((s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  const party = () => s((s) => s.rom.partyCount());
  for (let i = 0; i < 40 && !(await party()); i++) {
    if (await page.locator('.bm-slot').first().isVisible()) { await page.locator('.bm-slot').first().click(); await page.waitForTimeout(1500); }
    else if (!(await s((s) => s.swapping))) { await tap('z'); await page.waitForTimeout(800); }
    else await page.waitForTimeout(500);
  }
  expect(await party(), 'a mon out of the chest').toBeGreaterThan(0);
  await expect.poll(() => s((s) => s.swapping), { timeout: 30_000 }).toBe(false);
  const tm = await s((s) => { for (let i = 289; i < 339; i++) if (s.art.itemName(i) && !s.pocket(2).some((x: any) => x.item === i)) return i; return 0; });
  await s((s, tm) => s.give(tm), tm);
  await expect(page.locator('.bm-slot').first()).toBeVisible({ timeout: 20_000 });
  expect(await s((s, tm) => s.pocket(2).some((x: any) => x.item === tm), tm), 'in the bag with the question up').toBe(true);
});
