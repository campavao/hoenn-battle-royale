// POK-258 and the match-end exit: a finished match lets go of you, and the room survives.
//
// The end of a match used to scatter the room. START locks it so latecomers cannot walk
// into a running match, and nothing unlocked it afterwards, so the only way out was the
// lobby -- eight people who had just played together, each alone on a menu. POK-258 made
// PLAY AGAIN keep the room instead of reloading.
//
// What the play-test found next is that nothing took you out of the match at all: the
// results panel was drawn over a ROM that went on walking Hoenn, and pressing PLAY AGAIN
// was the only thing that ended it. So the exit became a grace timer on every client and
// PLAY AGAIN a press of the same funnel -- and then the 2026-10-14 play-test found the
// timer took the results away before they were read (POK-371). The grace now ends ON the
// results: they stay until PLAY AGAIN or MAIN MENU is pressed.
//
// This runs a whole match at `#fast` with one human and bots, waits for the result,
// checks it stays up, presses PLAY AGAIN, and asserts the client comes out of the match
// into the same room, with its code, its roster and its socket, on a ROM that really did
// power-cycle and land in Littleroot rather than on Emerald's moving van.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrWindow = { __br: any };
type HbrWindow = { __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number } } };

const OFF_BOOT = 0x2018; // net/mailbox.ts's MAILBOX.OFF_BOOT

// START to the win, for a whole match at `#fast` with bots: a 25s opening, eight 15s ring
// phases to the final fog, its bleed, and the duels on the way, which keep both bots out
// of the fog while they last (up to 90s, bots/proxy.ts). Measured: won 185-255s in. The
// results after the win have their own limit (watchUntilResults).
const WHOLE_MATCH_MS = 360_000;
/** The win, or the end of the fight a watcher is replaying (whichever is later), to the
 *  results. A watcher's results wait for the fight on its screen to play out (POK-365,
 *  ReplayHold): the last `out` ends the stream and the replay plays what it has at its
 *  own pace, measured up to 35s past the win. Past the replay, only ReplayHold's poll
 *  and a relay hop are left. */
const RESULTS_AFTER_MS = 10_000;
/** ReplayHold gives up on a replay, and ParadeHold on a champion's Hall of Fame, at
 *  WIN_GRACE_MAX_MS (app.ts, 60s): no results wait longer than that past the win. */
const RESULTS_HELD_MAX_MS = 65_000;
/** A watcher's replay that ends this close to the cap never ended on its own: ReplayHold
 *  let go of it. The longest final fight measured played out 35s past the win. */
const REPLAY_CAP_MS = 57_000;

/** Waits out a whole match from START to `watcher`'s results, `director` being the page
 *  that runs it (the same page when the host is the one watching). Two things are held
 *  to account on the way, both of which once stalled the results for a minute:
 *  - every fight `watcher`'s ROM is handed is still on. The host never heard its own
 *    bots' `out`s into spectate's books, so following a bot handed its ROM that bot's
 *    FIRST duel, long over, and a replay waiting on a turn that never came. A duel runs
 *    at 8x and can start and finish between two looks, so "over" is a trainer in it out
 *    for longer than STALE_MS.
 *  - the results come soon after the win, or after the fight on screen plays out. */
async function watchUntilResults(watcher: Page, director: Page = watcher): Promise<void> {
  const STALE_MS = 5_000;
  const spectate = loadSymbols().gBrSpectate;
  const outAt = new Map<number, number>();
  const deadline = Date.now() + WHOLE_MATCH_MS;
  const me = await watcher.evaluate(() => (window as unknown as BrWindow).__br.bridge.seat as number);
  let watched = -1;
  let handed = 0;
  let winAt: number | undefined;
  let winner: number | undefined;
  let replayEndAt: number | undefined;
  let watchedAtWin = -1;
  while (!(await watcher.locator('#results-panel').isVisible())) {
    expect(Date.now(), 'the match was won within a whole match').toBeLessThan(deadline);
    const now = Date.now();
    const match = await director.evaluate(() => {
      const state = (window as unknown as BrWindow).__br.director?.state;
      return state && { out: state.placements as number[], ended: state.phase === 'ended', winner: state.winner as number | undefined };
    });
    expect(match, 'the director page runs the match').toBeTruthy();
    if (match!.ended && winAt === undefined) {
      winAt = now;
      winner = match!.winner;
      watchedAtWin = watched;
    }
    for (const seat of match!.out) if (!outAt.has(seat)) outAt.set(seat, now);
    const rom = await watcher.evaluate((base) => {
      const emu = (window as unknown as HbrWindow).__hbr.emu;
      return { watching: emu.read(base + 5, 8) !== 0, lo: emu.read(base + 6, 8), hi: emu.read(base + 7, 8) };
    }, spectate);
    const id = rom.watching ? rom.lo | (rom.hi << 8) : -1;
    if (id !== -1 && id !== watched) {
      handed++;
      for (const seat of [rom.lo, rom.hi]) {
        const age = now - (outAt.get(seat) ?? now);
        expect(age, `handed a fight of seat ${seat}'s, out ${Math.round(age / 1000)}s`).toBeLessThan(STALE_MS);
      }
    }
    if (winAt !== undefined && watched !== -1 && id === -1) replayEndAt = now;
    watched = id;
    await watcher.waitForTimeout(500);
  }
  // A win and its results can both land between two looks.
  if (winAt === undefined) {
    const last = await director.evaluate(() => {
      const state = (window as unknown as BrWindow).__br.director?.state;
      return { ended: state?.phase === 'ended', winner: state?.winner as number | undefined };
    });
    if (last.ended) [winAt, winner] = [Date.now(), last.winner];
  }
  expect(winAt, 'the results came after the win').toBeDefined();
  const shown = Date.now();
  const after = shown - winAt!;
  // Not an assertion: the bot we follow may fight nobody after we go out, and a page that
  // won was never out to watch. Written down, so a run that checked nothing says so.
  const out = outAt.has(me) ? 'out' : 'never out';
  const replay = replayEndAt === undefined ? 'none' : `${replayEndAt - winAt!}ms`;
  const note = `${out}, ${handed} fights handed, watching ${watchedAtWin} at the win, its replay over ${replay} after, results ${after}ms after`;
  test.info().annotations.push({ type: 'watched', description: note });
  console.log(`play-again: ${note}`);
  expect(after, `the results ${Math.round(after / 1000)}s after the win`).toBeLessThan(RESULTS_HELD_MAX_MS);
  // The champion's wait is its Hall of Fame, which nothing here measures; a watcher's is
  // the fight on its screen, and once that is over the results are next. (They can go up
  // over a replay still on, too: ReplayHold lets go at its cap, or of a replay it never saw.)
  if (winner !== me) {
    const held = (replayEndAt ?? shown) - winAt!;
    expect(held, `the fight on screen held the results ${Math.round(held / 1000)}s: ReplayHold's cap, not its end`).toBeLessThan(REPLAY_CAP_MS);
    const from = Math.max(winAt!, replayEndAt ?? 0);
    expect(shown - from, `the results ${Math.round((shown - from) / 1000)}s after the win and the fight on screen`).toBeLessThan(RESULTS_AFTER_MS);
  }
}

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a finished match lets go, and the room keeps its code, roster and socket', async ({ page }) => {
  test.setTimeout(WHOLE_MATCH_MS + 120_000);

  await page.goto(`/#host&fast&seed=20260916&testmon&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
  const codeEl = page.locator('#room-code');
  await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
  const code = await codeEl.textContent();
  await startWith(page, 1);

  // A whole match at the dev pace, bots filling the room -- and this page goes out early
  // and watches one of them, which is where it used to stall (watchUntilResults).
  await watchUntilResults(page);

  // POK-320: a champion's results come after their ROM's own Hall of Fame, never over it.
  // Only when this page won, which a bot usually does: nothing here can crown the host
  // without a dev hook. The page's side of it is pinned whatever the outcome in
  // ui/results.test.ts (ParadeHold.holds, which the room and solo both ask).
  const parade = await page.evaluate((base) => {
    const round = JSON.parse(localStorage.getItem('hbr:log') ?? '[]')[0];
    const won = round?.winner === (window as unknown as BrWindow).__br.bridge.seat;
    return { won, phase: (window as unknown as HbrWindow).__hbr.emu.read(base, 8) };
  }, loadSymbols().gBrMatch);
  if (parade.won) expect(parade.phase, 'the Hall of Fame is over (BR_PHASE_DONE) before the results show').toBe(5);

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

  // Well past the grace (four seconds; a champion's parade is over already), the results
  // are still up: nothing has been pressed (POK-371).
  await page.waitForTimeout(8_000);
  await expect(page.locator('#results-panel'), 'the results wait for a press').toBeVisible();
  await page.locator('#play-again').click();
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

// POK-330 #9. The host sends `again` in the same tick as its `win`, and every guest took it
// as the way out: its results panel lasted as long as a reboot, and a guest who won had
// the Hall of Fame power-cycled out from under it. `again` is recovery for a page that
// never heard the `win`; a page that did keeps its own grace. The single-page test above
// cannot see this -- nobody hears their own `again` -- so this one needs a guest.
test("a guest reads its result for the whole grace, whatever the host's `again` says", async ({ browser }) => {
  test.setTimeout(WHOLE_MATCH_MS + 120_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();

  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&fast&seed=20260916&testmon&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&fast&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
    await startWith(host, 2);

    // A whole match at the dev pace, bots filling the room, until the guest is told.
    const panel = guest.locator('#results-panel');
    await watchUntilResults(guest, host);
    const shownAt = Date.now();

    // END_GRACE_MS is four seconds (a champion waits longer, for the parade). Two and a
    // half in, the panel must still be up: the bug took it down in the time a reboot takes.
    await guest.waitForTimeout(2_500);
    await expect(panel, 'still reading the result, `again` or no `again`').toBeVisible();

    // ...and past the grace, still up: only a press takes the results away (POK-371).
    await guest.waitForTimeout(4_000);
    await expect(panel, 'the results wait for a press').toBeVisible();
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(6_000);
    await guest.locator('#play-again').click();
    await expect(panel).toBeHidden({ timeout: 90_000 });
    await expect(guest.locator('#room-code')).toHaveText(`Room ${code}`, { timeout: 30_000 });

    // POK-331 #13 review: back in the room, whoever went out is on the heir list again. A
    // guest out in the match said can_host false and nothing ever said true, so a host
    // leaving between matches found nobody to hand the room to -- or handed it to a
    // newcomer ahead of everybody who had played. The host goes; the guest has the room.
    const seat = await guest.evaluate(() => (window as unknown as BrWindow).__br.bridge.seat as number);
    await hostCtx.close();
    await guest.waitForFunction(
      (me) => (window as unknown as BrWindow).__br.controls?.roster?.host === me,
      seat,
      { timeout: 30_000 },
    );
  } finally {
    await guestCtx.close();
    await hostCtx.close().catch(() => {});
  }
});

// POK-331 #18. The host can deal the next match while a guest is still reading the last
// one: a champion's parade runs up to a minute, and a host who lost is back in four
// seconds. The guest's `start` went into a ROM about to be rebooted and into books about
// to be wiped, and the grace then took that seat into Littleroot with no match at all --
// alive on every roster, a phantom nobody could reach. Kanto's onStart: a START that finds
// the last match still on screen tears it down, and plays. Here the guest's grace is held
// open for good, the way a long parade holds it, so only the START can move it.
test("a guest still in its grace when the host deals again goes into the new match", async ({ browser }) => {
  await dealAgainWhileReading(browser, 'grace');
});

// The same START for a guest whose grace is over but whose results are still up -- a
// winner's: its grace ends on the parade, and PLAY AGAIN is its exit (POK-371). Held
// by nothing but the results, the START went into the finished ROM (#41's review).
test('a guest reading its results with the grace over goes into the new match', async ({ browser }) => {
  await dealAgainWhileReading(browser, 'results');
});

async function dealAgainWhileReading(browser: Browser, hold: 'grace' | 'results'): Promise<void> {
  test.setTimeout(WHOLE_MATCH_MS + 180_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const BR_PHASE_SAFARI = 1;
  const BR_PHASE_PLAY = 2;

  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&fast&seed=20260916&testmon&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&fast&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
    await startWith(host, 2);

    await watchUntilResults(guest, host);
    if (hold === 'grace') {
      // The grace's own exit becomes nothing: the guest stays in it until something else moves it.
      await guest.evaluate(() => (window as unknown as BrWindow).__br.grace.arm(() => {}));
    } else {
      // The grace done, as a champion's ends on the parade: only the results are up.
      await guest.evaluate(() => (window as unknown as BrWindow).__br.grace.cancel());
    }

    // The host reads its own result, comes back to the room, and deals again.
    await expect(host.locator('#results-panel')).toBeVisible({ timeout: 120_000 });
    await host.locator('#play-again').click();
    await expect(host.locator('#room-start')).toBeVisible({ timeout: 120_000 });
    await host.locator('#room-start').click();
    await host.waitForFunction(() => (window as unknown as BrWindow).__br?.director?.state?.phase === 'safari', undefined, {
      timeout: 30_000,
    });
    const seed = await host.evaluate(() => (window as unknown as BrWindow).__br.match.seed as number);

    // The guest is in it: its books hold the new match, its results are down, and its ROM
    // -- rebooted, not the one that played the last match -- is in the new opening.
    await guest.waitForFunction(
      (s) => {
        const m = (window as unknown as BrWindow).__br.match;
        return m.active === true && m.seed === s;
      },
      seed,
      { timeout: 60_000 },
    );
    await expect(guest.locator('#results-panel')).toBeHidden({ timeout: 10_000 });
    const symbols = loadSymbols();
    await guest.waitForFunction(
      ([base, safari, play]) => {
        const phase = (window as unknown as HbrWindow).__hbr.emu.read(base, 8);
        return phase === safari || phase === play;
      },
      [symbols.gBrMatch, BR_PHASE_SAFARI, BR_PHASE_PLAY],
      { timeout: 60_000 },
    );
    const romSeed = await guest.evaluate((base) => (window as unknown as HbrWindow).__hbr.emu.read(base + 8, 32), symbols.gBrMatch);
    expect(romSeed >>> 0, "the guest's ROM plays the host's new deal").toBe(seed >>> 0);
  } finally {
    await guestCtx.close();
    await hostCtx.close().catch(() => {});
  }
}
