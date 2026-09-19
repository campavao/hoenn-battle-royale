// POK-252: the room outlives its host.
//
// A host closing the tab used to close the room on everybody in it -- the relay asks
// `heirOf()` for somebody who said `can_host`, nobody ever had, so the answer was
// always null. Two halves had to land together: the relay promoting a guest, and the
// promoted guest picking the match up from what the wire already told it. Neither half
// is provable on its own, and no driver can see any of it: this is two browsers and a
// relay, which is what makes it an e2e.
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrWindow = { __br: any };
type RamWindow = { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } };

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('the host drops mid-match and the guest picks up the clock', async ({ browser }) => {
  test.setTimeout(180_000);
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

    // A guest draws its own strip now (POK-268), from the same messages a promoted
    // host would resume from -- so this is both the wait and an assertion.
    await expect(guest.locator('#match-strip')).toContainText(/RING \d/, { timeout: 120_000 });
    // And the ROM has it too: gBrRing.phase is the host's own ring number, off the wire.
    const ring = loadSymbols().gBrRing;
    await guest.waitForFunction(
      (addr) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr + 1, 8) >= 1,
      ring,
      { timeout: 120_000 },
    );
    const before = await guest.evaluate(() => (window as unknown as BrWindow).__br.director);
    expect(before, 'a guest must not be running the match').toBeUndefined();

    // Before the host goes: the guest has been keeping the match state all along --
    // that is what makes a takeover possible without anybody sending it anything.
    const seen = await guest.evaluate(() => {
      const m = (window as unknown as BrWindow).__br.match;
      return { seed: m.seed, seats: m.seats.length, ringPhase: m.ringPhase, clockLeft: m.clockLeft };
    });
    console.log('guest match state', JSON.stringify(seen));
    expect(seen.seed, 'the guest heard the start').not.toBe(0);
    expect(seen.ringPhase, 'the guest heard the ring').toBeGreaterThan(0);

    // The host's tab goes away mid-match, the way a closed laptop does.
    await hostCtx.close();

    // The relay moves `host` on the roster and says nothing else about it, so the
    // guest finding out at all is the first half of the fix.
    await guest.waitForFunction(() => (window as unknown as BrWindow).__br.director !== undefined, undefined, {
      timeout: 60_000,
    });

    // And the second half: it picked the match up where it was rather than starting a
    // new one. Same ring phase it was already in, still counting.
    const phase = await guest.evaluate(
      () => ((window as unknown as BrWindow).__br.director.state.ring?.phase as number) ?? 0,
    );
    expect(phase, 'the new host resumed the ring, it did not restart the match').toBeGreaterThan(0);

    await guest.waitForFunction(
      (was) => (((window as unknown as BrWindow).__br.director.state.ring?.phase as number) ?? 0) > was,
      phase,
      { timeout: 60_000 },
    );

    // The bots came with it. Without the re-deal they freeze where they stood and the
    // match can never reach a winner.
    const bots = await guest.evaluate(() => (window as unknown as BrWindow).__br.botCount?.() ?? 0);
    expect(bots, 'the promoted host walks the bots now').toBeGreaterThan(0);
  } finally {
    await guestCtx.close();
    await hostCtx.close().catch(() => {});
  }
});

test('the host tabs out and hands the match over without leaving', async ({ browser }) => {
  // The other half of POK-252, and the play-test's own: "we cannot pause the game if
  // the host tabs out. If that happens it should swap hosts. No alert is needed." A
  // backgrounded tab has its timers throttled and its emulator stopped, so a host that
  // stays a host is a match that stops for everybody in it.
  test.setTimeout(180_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();

  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&fast&seed=20260917&testmon&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&fast&testmon&rom=${rom}`);
    await startWith(host, 2);
    await expect(guest.locator('#match-strip')).toContainText(/RING \d/, { timeout: 120_000 });
    expect(await guest.evaluate(() => (window as unknown as BrWindow).__br.director)).toBeUndefined();

    // The tab goes to the background. Nothing closes; the page just stops being one
    // anybody should be waiting on.
    await host.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await guest.waitForFunction(() => (window as unknown as BrWindow).__br.director !== undefined, undefined, {
      timeout: 60_000,
    });
    const phase = await guest.evaluate(
      () => ((window as unknown as BrWindow).__br.director.state.ring?.phase as number) ?? 0,
    );
    expect(phase, 'the new host resumed the ring rather than restarting the match').toBeGreaterThan(0);

    // The old host stood down: still in the room, no longer running it, and told
    // nothing about being paused.
    await host.waitForFunction(() => (window as unknown as BrWindow).__br.director === undefined, undefined, {
      timeout: 30_000,
    });
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/);
    expect(await host.title(), 'no PAUSED banner: nothing is paused').not.toContain('PAUSED');
    expect(await host.locator('#room-note').textContent()).not.toMatch(/hidden for/);
  } finally {
    await guestCtx.close();
    await hostCtx.close().catch(() => {});
  }
});
