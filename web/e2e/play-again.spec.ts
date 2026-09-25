// POK-258 and the match-end exit: a finished match lets go of you, and the room survives.
//
// The end of a match used to scatter the room. START locks it so latecomers cannot walk
// into a running match, and nothing unlocked it afterwards, so the only way out was the
// lobby -- eight people who had just played together, each alone on a menu. POK-258 made
// PLAY AGAIN keep the room instead of reloading.
//
// What the play-test found next is that nothing took you out of the match at all: the
// results panel was drawn over a ROM that went on walking Hoenn, and pressing PLAY AGAIN
// was the only thing that ended it. So the exit is now a grace timer on every client and
// PLAY AGAIN is a press of the same funnel.
//
// This runs a whole match at `#fast` with one human and bots, waits for the result, and
// asserts -- WITHOUT clicking anything -- that the client comes out of the match by
// itself, into the same room, with its code, its roster and its socket, on a ROM that
// really did power-cycle and land in Littleroot rather than on Emerald's moving van.
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrWindow = { __br: any };
type HbrWindow = { __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number } } };

const OFF_BOOT = 0x2018; // net/mailbox.ts's MAILBOX.OFF_BOOT

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a finished match lets go, and the room keeps its code, roster and socket', async ({ page }) => {
  test.setTimeout(360_000);

  await page.goto(`/#host&fast&seed=20260916&testmon&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
  const codeEl = page.locator('#room-code');
  await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
  const code = await codeEl.textContent();
  await startWith(page, 1);

  // A whole match at the dev pace: 25s opening, 15s ring phases, bots filling the room.
  await expect(page.locator('#results-panel')).toBeVisible({ timeout: 240_000 });

  // ...and the card under it says what the match was (POK-303). RINGS is always there,
  // counted off the `ring` messages this page has been watching go past all match.
  const card = page.locator('#results-record');
  await expect(card).toBeVisible();
  await expect(card).toContainText('RINGS');

  // POK-330 #16: the host never hears its own messages back, and its own bots' `out`s
  // went to the room and the director but not to its results, record or log -- so it
  // placed itself against a field it never saw thin. The round it wrote down has every
  // elimination the director counted: all but the winner.
  const round = await page.evaluate(() => JSON.parse(localStorage.getItem('hbr:log') ?? '[]')[0]);
  const outs = new Set((round.events as { t: string; seat?: number }[]).filter((e) => e.t === 'out').map((e) => e.seat));
  expect(round.seats, 'bots filled the room').toBeGreaterThan(1);
  expect(outs.size, 'every bot that went out is in the host\'s own log').toBeGreaterThanOrEqual(round.seats - 1);

  // Nothing is pressed from here. The grace is what has to move us.
  await expect(page.locator('#results-panel')).toBeHidden({ timeout: 60_000 });

  // Back in the room, not on the lobby: same code, same socket, START armed again.
  await expect(codeEl).toHaveText(code ?? '', { timeout: 30_000 });
  const stillConnected = await page.evaluate(() => (window as unknown as BrWindow).__br?.bridge !== undefined);
  expect(stillConnected, 'the socket survived the ending').toBe(true);
  await expect(page.locator('#room-start')).toBeVisible({ timeout: 30_000 });

  // And the ROM really did start over: the mailbox comes back up from power-on.
  await page.waitForFunction(
    () => (window as unknown as BrWindow).__br.mailbox.isAwake() === true,
    undefined,
    { timeout: 60_000 },
  );

  const symbols = loadSymbols();
  // The second boot block was CONSUMED, not wiped. This is the assertion that fails when
  // the reboot resolves on the previous run's magic still sitting in EWRAM: the block
  // goes in before BrInit, BrMailbox_Init's CpuFill32 erases it, and the ROM sits on the
  // title screen instead -- where the first A press starts a new game and the moving van.
  await page.waitForFunction(
    (addr) => (window as unknown as HbrWindow).__hbr.emu.read(addr, 8) === 0,
    symbols.gBrMailbox + OFF_BOOT,
    { timeout: 30_000 },
  );

  // Littleroot (group 0, num 9), and explicitly not MAP_INSIDE_OF_TRUCK (group 25, num 40).
  const where = await page.evaluate((base: number) => {
    const emu = (window as unknown as HbrWindow).__hbr.emu;
    const save = emu.read(base, 32);
    return { group: emu.read(save + 4, 8), num: emu.read(save + 5, 8) };
  }, symbols.gSaveBlock1Ptr);
  expect(where, 'the replay landed in Littleroot, not the truck').toEqual({ group: 0, num: 9 });

  // POK-330 #22: and it stays in the room. The last match was never reset, so the page's
  // one-second strip still saw a match on and took the room screen -- START with it --
  // down again about a second after coming back.
  await page.waitForTimeout(3_000);
  await expect(page.locator('#room-start'), 'START is still there three seconds on').toBeVisible();
  expect(await page.evaluate(() => document.body.classList.contains('in-match')), 'not dressed for a match').toBe(false);

  // ...and the next START deals a real match: bots filling the room again, not last
  // match's bots seated as people (which made FILL zero and a match nobody could win).
  await page.locator('#room-start').click();
  await page.waitForFunction(
    () => (window as unknown as BrWindow).__br?.director?.state?.phase === 'safari',
    undefined,
    { timeout: 30_000 },
  );
  const second = await page.evaluate(() => {
    const br = (window as unknown as BrWindow).__br;
    return { bots: br.botCount() as number, alive: br.director.state.alive as number, seats: br.match.seats.length as number };
  });
  expect(second.bots, 'the room filled with bots again').toBeGreaterThan(0);
  expect(second.alive, 'every seat in the match is somebody who can move: us and the bots').toBe(second.bots + 1);
  expect(second.seats).toBe(second.alive);
});
