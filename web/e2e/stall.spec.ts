// POK-328: the game stopping under the player says so. Cam's Mossdeep Gym black screen
// (2026-09-18) had the pad up and nothing else: no word of what had stopped, and no way
// out but closing the tab. The watchdog itself is pinned in vitest (emu/watchdog.test.ts);
// this is the page around it -- the overlay and its line, the round's log, the game
// coming back, the way out -- and the one hold every page makes, the lobby's, which must
// never read as a stop.
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

/** field.ts's MAIN_CALLBACK2. */
const MAIN_CALLBACK2 = 4;
/** Thumb `b .` and `bx lr`. */
const THUMB_SPIN = 0xe7fe;
const THUMB_RETURN = 0x4770;

interface HbrWindow {
  __hbr: {
    emu: {
      read(addr: number, width: 8 | 16 | 32): number;
      write(addr: number, value: number, width: 8 | 16 | 32): void;
      isPaused(): boolean;
      /** The core module itself: pausing it there stops the frames without the page
       *  knowing, which is what a stuck core looks like from the page. */
      m: { pauseGame(): void };
    };
  };
}

interface Logged {
  events: { t: string; kind?: string; detail?: string; map?: string; last?: string[] }[];
}

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** A solo match, started and standing on the field: a round in the log to write a stop into. */
async function soloOnField(page: Page): Promise<void> {
  const symbols = loadSymbols();
  await page.goto(`/#solo&testmon&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
  await expect(page.locator('#match-strip')).toContainText('SAFARI', { timeout: 60_000 });
  await page.waitForFunction(
    ([at, cb2]) => ((window as unknown as HbrWindow).__hbr.emu.read(at, 32) & ~1) === cb2,
    [symbols.gMain + MAIN_CALLBACK2, symbols.CB2_Overworld],
    { timeout: 30_000 },
  );
  await expect(page.locator('#stall')).toBeHidden();
}

test('the lobby holds the ROM still for as long as it likes, and that is no stop', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/#rom=${romHashParam()}`);
  const solo = page.locator('#lobby-rows button', { hasText: 'SOLO VS BOTS' });
  await expect(solo).toBeVisible({ timeout: 60_000 });
  // The boot block's hold: the core paused from the mailbox answering until a way in
  // is chosen. Six seconds of it is twice what a stuck core gets.
  expect(await page.evaluate(() => (window as unknown as HbrWindow).__hbr.emu.isPaused())).toBe(true);
  await page.waitForTimeout(6_000);
  await expect(page.locator('#stall')).toBeHidden();

  // ...and nor is the resume, however long the hold before it was.
  await solo.click();
  await expect(page.locator('#match-strip')).toContainText('SAFARI', { timeout: 60_000 });
  await page.waitForTimeout(5_000);
  await expect(page.locator('#stall')).toBeHidden();
});

test('a ROM stuck inside one pass of its main loop is named over the picture, written down, and let go when it comes back', async ({ page }) => {
  test.setTimeout(120_000);
  await soloOnField(page);
  const symbols = loadSymbols();
  const cb2At = symbols.gMain + MAIN_CALLBACK2;
  // Two bytes of scratch at the end of the decompression buffer, which a player standing
  // on the field is not decompressing into.
  const spin = symbols.gDecompressionBuffer + 0x3ff0;

  // callback2 pointed at a Thumb `b .`: the main loop calls it and never comes back, so
  // BrFrame never runs again -- while the frames go on, the VBlank interrupt still
  // taken every one. The ROM's heartbeat (gBrMailbox.frame) stops for real.
  const was = await page.evaluate(
    ([at, code, loop]) => {
      const emu = (window as unknown as HbrWindow).__hbr.emu;
      const was = emu.read(at, 32);
      emu.write(code, loop, 16);
      emu.write(at, code | 1, 32);
      return was;
    },
    [cb2At, spin, THUMB_SPIN],
  );

  const overlay = page.locator('#stall');
  await expect(overlay).toBeVisible({ timeout: 6_000 });
  const line = page.locator('#stall-line');
  await expect(line).toHaveText(/^rom · /);
  await expect(line).toContainText('local build');
  // Where it is stuck, by address: nothing in the symbol table is named for it.
  await expect(line).toContainText(`cb2 0x${((spin | 1) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`);
  await expect(line).toContainText(/map \d+:\d+/);
  await expect(line).toContainText(/phase \d/);
  await expect(page.locator('#stall-reload')).toBeVisible();
  await expect(page.locator('#stall-leave')).toBeVisible();

  // The round is on disk with the stop in it: a game that stopped never reaches the
  // verdict that files it.
  const stall = await page.waitForFunction(() => {
    const rounds = JSON.parse(localStorage.getItem('hbr:log') ?? '[]') as Logged[];
    return rounds[0]?.events.find((e) => e.t === 'stall') ?? false;
  });
  const event = (await stall.jsonValue()) as Logged['events'][number];
  expect(event.kind).toBe('rom');
  expect(event.detail).toBe(await line.textContent());
  expect(event.map).toMatch(/^\d+:\d+$/);
  expect(event.last?.length).toBeGreaterThan(0);

  // The loop returns and the overworld has its callback back: the heartbeat moves
  // again, the verdict is taken back, and the game is the player's.
  await page.evaluate(
    ([at, cb2, code, ret]) => {
      const emu = (window as unknown as HbrWindow).__hbr.emu;
      emu.write(at, cb2, 32);
      emu.write(code, ret, 16);
    },
    [cb2At, was, spin, THUMB_RETURN],
  );
  await expect(overlay).toBeHidden({ timeout: 6_000 });
});

test('a core that stops making frames is named, and LEAVE takes the player to the lobby', async ({ page }) => {
  test.setTimeout(120_000);
  await soloOnField(page);

  await page.evaluate(() => (window as unknown as HbrWindow).__hbr.emu.m.pauseGame());
  await expect(page.locator('#stall')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('#stall-line')).toHaveText(/^core · .*cb2 CB2_Overworld/);

  await page.locator('#stall-leave').click();
  await expect(page.locator('#lobby-rows button', { hasText: 'SOLO VS BOTS' })).toBeVisible({ timeout: 60_000 });
  expect(new URL(page.url()).hash).not.toContain('solo');
});
