// POK-260: a room mid-match is not a dead end.
//
// Kanto's quick play answers WATCH, PLAY NEXT -- you drop into the running match as a
// spectator and you are in the next one. Every piece of that existed here except the
// page's idea of being a watcher: the relay has always admitted one to a locked room,
// and the lobby has always asked, but the director seated them anyway (a drop they
// never take, and a seat that keeps the match from ever ending) and their ROM walked
// around Littleroot broadcasting a ghost into somebody else's match.
import { test, expect } from '@playwright/test';
import { romExists, romHashParam, romPath, startWith } from './symbols';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrWindow = { __br: any };

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a watcher walks in on a running match, and the match is not theirs', async ({ browser }) => {
  test.setTimeout(420_000); // two ROMs boot, then a whole opening runs before the watch
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const watcherCtx = await browser.newContext();

  try {
    // A match, running and locked.
    const host = await hostCtx.newPage();
    await host.goto(`/#host&fast&seed=20260916&testmon&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    await startWith(host, 1);
    await host.waitForFunction(
      () => ((window as unknown as BrWindow).__br?.director?.state?.ring?.phase ?? 0) >= 1,
      undefined,
      { timeout: 120_000 },
    );

    // And somebody walks in on it. `#watch=CODE` is the deterministic door -- quick
    // play's WATCH answer is the relay's own matchmaking (it picks the fullest running
    // room), which is worth its own test rather than a race inside this one.
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');
    const watcher = await watcherCtx.newPage();
    await watcher.goto(`/#watch=${code}&rom=${rom}`);
    await watcher.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });

    // The late start: the fog's position arrives at once rather than at the next ring.
    await expect(watcher.locator('#match-strip')).toContainText(/RING \d/, { timeout: 60_000 });

    // POK-330 #4: walking in is a roster event, and no roster lists a bot -- so the host
    // counted every bot still standing as departed and, when the ten-second grace ran
    // out, eliminated the lot and handed itself the match. Eleven seconds on, the field
    // is still a field.
    const field = () =>
      host.evaluate(() => {
        const state = (window as unknown as BrWindow).__br.director.state;
        return { alive: state.alive as number, phase: state.phase as string };
      });
    const before = await field();
    expect(before.alive, 'bots in the match to lose').toBeGreaterThan(2);
    await host.waitForTimeout(11_000);
    const after = await field();
    expect(after.phase, 'nobody won by default').not.toBe('ended');
    expect(after.alive, 'the bots are still standing').toBeGreaterThan(1);

    // And the match does not think it is in it: the host's seat list never took it.
    const seatedWatcher = await host.evaluate(() => {
      const br = (window as unknown as BrWindow).__br;
      const watching = new Set(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (br.controls?.roster?.members ?? []).filter((m: any) => m.spectate).map((m: any) => m.id),
      );
      const alive = br.director?.state?.placements ?? [];
      return { watchers: watching.size, alive: alive.length };
    });
    expect(seatedWatcher.watchers, 'the relay marked them a watcher').toBeGreaterThan(0);
  } finally {
    // Tolerant: a context Playwright has already disposed throws on a second close,
    // and a cleanup that fails hides the result of the test it was cleaning up after.
    await watcherCtx.close().catch(() => {});
    await hostCtx.close().catch(() => {});
  }
});
