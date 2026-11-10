// Cam, 11-10, a live match of two players and two bots: "Sometimes when picking up an item or
// talking to an NPC, it feels like the first click doesn't go through." One A at a ball, on the
// page, with its real keys, and whether the room gave it to me:
//  - walking into it (the direction still held, the trainer walking in place): the room read
//    no A until the 32-frame bump was over, so a press in it was spent (shared/firstpress.test.ts);
//  - turning to face it and pressing at once: the same, over the turn's 8 frames;
//  - a tap whose keydown and keyup both come before the next frame (a quick thumb, or both
//    queued behind a long frame): myBits read `held` only, and never saw it.
import { expect, test, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any, arg?: any) => T, arg?: unknown) =>
  page.evaluate(([src, arg]) => new Function('s', 'arg', `return (${src})(s, arg)`)((window as any).__spike, arg), [f.toString(), arg] as const) as Promise<T>;

const TRIES = 5;

type Ball = { map: string; x: number; y: number; key: number };

/** Balls with open ground west of them, nothing marked there: somewhere to stand facing each. */
const balls = (page: Page) => spike(page, (s) => {
  const room = s.link.room;
  const out: Ball[] = [];
  for (const q of room.ground().values()) {
    if (q.gift || room.world.cell(q.map, q.x - 1, q.y) !== 0 || room.patchesOn(q.map).some((p: any) => p.x === q.x - 1 && p.y === q.y)) continue;
    if (room.groundAt(q.map, q.x - 1, q.y) || room.spillAt(q.map, q.x - 1, q.y)) continue;
    out.push({ map: q.map, x: q.x, y: q.y, key: q.key });
  }
  return out;
}) as Promise<Ball[]>;

/** Me west of `b`, standing, facing `facing` (1 south, 4 east), every key up. */
async function standBy(page: Page, b: Ball, facing: number): Promise<void> {
  await spike(page, (s, arg) => {
    const { b, facing } = arg as { b: Ball; facing: number };
    const a = s.link.room.actor(s.link.me);
    const spot = { map: b.map, x: b.x - 1, y: b.y };
    a.m = { ...a.m, spot, prev: spot, facing, moveDir: facing, action: null, px: 0, py: 0, runningState: 0, bike: false };
    a.calm = 0;
  }, { b, facing });
  await page.waitForTimeout(400);
}

const taken = (page: Page, b: Ball) => spike(page, (s, b) => !s.link.room.groundAt((b as Ball).map, (b as Ball).x, (b as Ball).y), b);

/** Waits for the box to be clear and the page to be on the field, so one try never sees the last. */
async function settle(page: Page): Promise<void> {
  await expect.poll(() => spike(page, (s) => !s.battle && !s.swapping && !s.asking), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(900);
}

test('the first A at a ball takes it: walking into it, turning to it, and a tap shorter than a frame', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const pool = await balls(page);
  expect(pool.length, 'balls to try').toBeGreaterThanOrEqual(3 * TRIES);
  const got = { bump: 0, turn: 0, tap: 0 };

  for (let i = 0; i < TRIES; i++) {
    // Into it: ArrowRight held, the bump under way, then one A (60 ms, a keyboard's press).
    let b = pool.shift()!;
    await settle(page);
    await standBy(page, b, 4);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(150 + i * 40);
    await page.keyboard.down('z');
    await page.waitForTimeout(60);
    await page.keyboard.up('z');
    await page.waitForTimeout(100);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(600);
    if (await taken(page, b)) got.bump++;

    // Turning to it: facing south, a tap of RIGHT turns in place; A at once.
    b = pool.shift()!;
    await settle(page);
    await standBy(page, b, 1);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(30);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.down('z');
    await page.waitForTimeout(50);
    await page.keyboard.up('z');
    await page.waitForTimeout(600);
    if (await taken(page, b)) got.turn++;

    // A tap inside one frame: keydown and keyup in one task, as a long frame delivers them.
    b = pool.shift()!;
    await settle(page);
    await standBy(page, b, 4);
    await page.evaluate(() => {
      dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
      dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }));
    });
    await page.waitForTimeout(600);
    if (await taken(page, b)) got.tap++;
  }
  console.log(`[first-press] of ${TRIES} each: into it ${got.bump}, turning to it ${got.turn}, a tap inside a frame ${got.tap}`);
  expect(got).toEqual({ bump: TRIES, turn: TRIES, tap: TRIES });
});
