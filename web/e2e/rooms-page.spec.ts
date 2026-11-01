// The room painter on a phone (spike-b/rooms-page.ts): two taps place a room's ball and
// person, a door cannot hold one, and the painting outlives the page.
import { devices, expect, test } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.use({ ...devices['Pixel 7'] });

type Rooms = { at: number; mode: string; count(): number; file(): string; current(): { item: number[] | null; person: number[] }; tile(): { left: number; top: number; size: number } };
const rooms = (page: import('@playwright/test').Page) => page.waitForFunction(() => (window as unknown as { __rooms?: Rooms }).__rooms, undefined, { timeout: 120_000 });

test('a room is two taps, a door takes neither, and it is still there after a reload', async ({ page }) => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
  test.setTimeout(240_000);
  await page.goto(`/rooms/?rom=${romHashParam()}`);
  await rooms(page);
  const read = () => page.evaluate(() => { const r = (window as unknown as { __rooms: Rooms }).__rooms; return { at: r.at, mode: r.mode, n: r.count(), c: r.current(), file: r.file() }; });
  const tap = async (x: number, y: number) => {
    const t = await page.evaluate(() => (window as unknown as { __rooms: Rooms }).__rooms.tile());
    await page.touchscreen.tap(t.left + (x + 0.5) * t.size, t.top + (y + 0.5) * t.size);
  };
  await expect(page.locator('#copy')).toBeDisabled();
  await tap(2, 5);
  await expect.poll(async () => (await read()).c.item).toEqual([2, 5]);
  expect((await read()).mode, 'the next tap is the person').toBe('person');
  await tap(6, 4);
  await expect.poll(async () => (await read()).c.person).toEqual([6, 4]);
  await expect(page.locator('#say')).toContainText('1 room changed');
  // MAP_DEWFORD_TOWN_HOUSE1's door.
  await tap(3, 7);
  await expect(page.locator('#say')).toContainText('nobody could reach');
  expect((await read()).c.person).toEqual([6, 4]);
  // No page overflow: everything on one phone screen.
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.reload();
  await rooms(page);
  expect(JSON.parse((await read()).file)).toEqual({ MAP_DEWFORD_TOWN_HOUSE1: { item: [2, 5], person: [6, 4] } });
  await page.locator('#next').tap();
  await expect.poll(async () => (await read()).at).toBe(1);
  await page.locator('#prev').tap();
  await page.locator('#reset').tap();
  await expect(page.locator('#say')).toContainText('0 rooms changed');
});
