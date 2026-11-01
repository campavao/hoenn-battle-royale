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
