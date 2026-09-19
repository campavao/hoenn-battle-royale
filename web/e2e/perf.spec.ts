// What a match costs (POK-247, the measuring half).
//
// The ticket says measure first, so this does: it runs a real match at `#fast` pace
// with the host walking eight bots, and samples what actually matters on a phone --
// the emulator's frame rate, and how long the longest main-thread task was while the
// bots were thinking. The host is the worst case by construction: it runs the
// director, the bots' A*, the loot table and the ticker on top of the emulator that
// every other client runs alone.
//
// A desktop is not a phone, so the CPU is throttled 4x through CDP -- roughly a
// mid-range Android against this machine. It still asserts a floor rather than a
// number, because a number on a CI box is a thing to fight rather than a thing to
// know. The floor is "the emulator is still running the game": below 40 fps a GBA is
// visibly wrong, and a main-thread task over a second reads as a hang.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_PHASE_PLAY = 2;
type RamWindow = { __br: { mailbox: { ram: { read(a: number, w: 8 | 16 | 32): number } } } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('the host carries a match without the emulator falling over', async ({ browser }) => {
  test.setTimeout(240_000);
  const rom = romHashParam();
  const symbols = loadSymbols();

  const ctx = await browser.newContext();
  try {
    const host = await ctx.newPage();
    // 4x slower than this machine: the point is to find out what the host's own work
    // -- the bots' A*, the director, the ticker -- costs when there is less to spare.
    //
    // Emulation.setCPUThrottlingRate is a CDP session setting, not a page one -- it is
    // not reliably torn down just because this test's context closes, and the browser
    // instance is reused (workers: 1) for every spec file that runs after this one.
    // Left at 4x, a later spec's mgba core runs the game for real but starved, which
    // reads as that spec's own bug. The inner try/finally resets it even when an
    // assertion below throws, so a throttled run never outlives this test.
    const cdp = await ctx.newCDPSession(host);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      // One tab hosting, bots filling it: START deals the same match anybody would get.
      await host.goto(`/#host&fast&seed=20260916&testmon&rom=${rom}`);
      await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
      await startWith(host, 1);

      // Count emulator frames ourselves, and watch for long main-thread tasks -- a
      // dropped frame on a phone is almost always one of those rather than slow wasm.
      await host.evaluate(() => {
        const w = window as unknown as {
          __perf: { frames: number; longest: number; long: number };
          __br: { mailbox: { ram: { onFrame?: unknown } } };
        };
        w.__perf = { frames: 0, longest: 0, long: 0 };
        // PerformanceObserver's longtask entries are anything over 50 ms.
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__perf.long++;
              w.__perf.longest = Math.max(w.__perf.longest, entry.duration);
            }
          }).observe({ entryTypes: ['longtask'] });
        } catch {
          // Not every engine has it; the frame count still tells us most of the story.
        }
        const tick = () => {
          w.__perf.frames++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      // Wait out the opening and the drop, then measure the part with bots in it.
      await host.waitForFunction(
        ([addr, want]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === want,
        [symbols.gBrMatch, BR_PHASE_PLAY],
        { timeout: 120_000 },
      );
      await host.evaluate(() => {
        (window as unknown as { __perf: { frames: number } }).__perf.frames = 0;
      });
      const started = Date.now();
      await host.waitForTimeout(30_000);
      const elapsed = (Date.now() - started) / 1000;

      const perf = (await host.evaluate(
        () => (window as unknown as { __perf: { frames: number; longest: number; long: number } }).__perf,
      )) as { frames: number; longest: number; long: number };
      const fps = perf.frames / elapsed;
      console.log(
        `host over ${elapsed.toFixed(1)}s of match at 4x CPU throttle: ${fps.toFixed(1)} fps, ` +
          `${perf.long} long tasks, longest ${perf.longest.toFixed(0)}ms`,
      );
      await host.screenshot({ path: path.join(OUT_DIR, 'perf-host.png') });

      // The floor, not a number: below this a GBA is visibly wrong, and a number would
      // be a thing to fight rather than a thing to know.
      expect(fps, 'the host is still drawing frames').toBeGreaterThan(40);
      // And no single hitch long enough to be felt as a freeze.
      expect(perf.longest, 'no main-thread task long enough to look like a hang').toBeLessThan(1000);
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  } finally {
    await ctx.close();
  }
});

// A hidden host tab used to say so, because the match was waiting on it. It no longer
// waits: the host hands the room over the moment its tab goes to the background, and
// migration.spec.ts is where that lives -- it takes two browsers to see it, which is
// exactly what this file does not have.
