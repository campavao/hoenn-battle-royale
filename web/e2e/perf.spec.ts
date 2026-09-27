// What a match costs (POK-247, the measuring half).
//
// The ticket says measure first, so this does: it runs a real match at `#fast` pace
// with the host walking a full room of bots (twenty-nine of them), and samples what
// actually matters on a phone -- the emulator's frame rate, and how long the longest
// main-thread task was while the bots were thinking. The host is the worst case by
// construction: it runs the director, the bots' A*, the loot table and the ticker on
// top of the emulator that every other client runs alone.
//
// A desktop is not a phone, so the CPU is throttled 4x through CDP -- roughly a
// mid-range Android against this machine. It still asserts a floor rather than a
// number, because a number on a CI box is a thing to fight rather than a thing to
// know. The floor is "the emulator is still running the game": below 40 fps a GBA is
// visibly wrong, and a main-thread task over a second reads as a hang.
//
// The numbers are the emulator's own (POK-247), not requestAnimationFrame's: frames the
// core delivered and the time between them as a p95, the page's share of each, the
// speaker's late and cut buffers, and what the processes cost -- CPU-seconds a
// second and the renderer's resident memory. perf.json has the lot.
//
// Twice: in a desktop's window, and on a portrait phone's glass (POK-329). The phone is
// the one that pays for the picture past the LCD -- the core draws 256x496 there, the
// ROM's whole band, against a desktop's 256x256 (field.ts askBand: the rows the layout
// shows) -- so it is the phone the floor has to hold on. perf-phone.json is its lot.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Browser, type BrowserContextOptions } from '@playwright/test';
import { cost, costLine, processes, snapshot, type PageSample } from './proc';
import { loadSymbols, romExists, romHashParam, romPath, romView, startWith } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_PHASE_SAFARI = 1;
const BR_PHASE_PLAY = 2;
type RamWindow = { __br: { mailbox: { ram: { read(a: number, w: 8 | 16 | 32): number } } } };
type PerfWindow = {
  __perf: { long: number; longest: number; probe: { sample(reset?: boolean): PageSample } };
  __hbr: { perf(): { sample(reset?: boolean): PageSample } };
  /** One probe for the boot check: each perf() is a meter of its own, for good. */
  __boot?: { sample(reset?: boolean): PageSample };
};
type Band = { left: number; top: number; right: number; bottom: number };
type BandWindow = { __hbr: { emu: { viewport: Band | null } } };

/** Where each run is: its window, the files it leaves, and the band its layout asks for
 *  -- the ROM's sprite window on a desktop (the picture takes the window's height, and
 *  the sheet docked beside it leaves 28 rows each way), all of the ROM's band on the
 *  phone (it shows 118 above and 242 below, and the ROM has 104 and 232). */
const RUNS: { name: string; file: string; context: BrowserContextOptions; band: (rom: ReturnType<typeof romView>) => Band }[] = [
  { name: 'desktop', file: 'perf', context: {}, band: (rom) => ({ ...rom.viewport, top: rom.sprites.top, bottom: rom.sprites.bottom }) },
  { name: 'phone', file: 'perf-phone', context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, band: (rom) => rom.viewport },
];

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

for (const run of RUNS) {
  test(`the host carries a match without the emulator falling over (${run.name})`, async ({ browser }) => {
    test.setTimeout(240_000);
    await hostsAMatch(browser, run);
  });
}

async function hostsAMatch(browser: Browser, run: (typeof RUNS)[number]): Promise<void> {
  const rom = romHashParam();
  const symbols = loadSymbols();

  const ctx = await browser.newContext(run.context);
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
    const procs = await processes(browser);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    try {
      // One tab hosting, bots filling it: START deals the same match anybody would get.
      // `#perf`, so the readout a phone would show is up too.
      await host.goto(`/#host&fast&seed=20260916&testmon&perf&rom=${rom}`);
      await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
      // A full room, not the default eight (POK-330 #49): rooms fill to thirty now, and
      // thirty bots' route-finding is the host's worst case -- the one the tick budget
      // is sized for. MAX climbs its ladder a press at a time, and each press is the
      // relay's to answer before the next.
      const max = host.locator('#room-max');
      await expect(max).toBeVisible({ timeout: 60_000 });
      for (const want of [12, 16, 20, 26, 30]) {
        await max.click();
        await expect(max).toContainText(`MAX ${want}`, { timeout: 15_000 });
      }
      await startWith(host, 1);

      // The proxy's first boot -- a whole second core, the page's longest task -- comes
      // in the opening, where nobody fights (POK-247), not on the first bot duel.
      const phase = () =>
        host.evaluate((addr) => (window as unknown as Partial<RamWindow>).__br?.mailbox.ram.read(addr, 8) ?? 0, symbols.gBrMatch);
      await expect.poll(phase, { timeout: 60_000 }).toBe(BR_PHASE_SAFARI);
      await expect
        .poll(
          () =>
            host.evaluate(() => {
              const w = window as unknown as PerfWindow;
              w.__boot ??= w.__hbr.perf();
              return w.__boot.sample().proxy?.booted ?? false;
            }),
          { timeout: 20_000 },
        )
        .toBe(true);
      expect(await phase(), 'booted while the opening was still on').toBe(BR_PHASE_SAFARI);

      // Wait out the opening and the drop, then measure the part with bots in it.
      await host.waitForFunction(
        ([addr, want]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === want,
        [symbols.gBrMatch, BR_PHASE_PLAY],
        { timeout: 120_000 },
      );
      // The page's own meter from here on (ui/fps.ts), and the long main-thread tasks --
      // a slow frame on a phone is almost always one of those rather than slow wasm.
      await host.evaluate(() => {
        const w = window as unknown as PerfWindow;
        w.__perf = { long: 0, longest: 0, probe: w.__hbr.perf() };
        // PerformanceObserver's longtask entries are anything over 50 ms.
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__perf.long++;
              w.__perf.longest = Math.max(w.__perf.longest, entry.duration);
            }
          }).observe({ entryTypes: ['longtask'] });
        } catch {
          // Not every engine has it; the frame times still tell most of the story.
        }
      });
      const from = await snapshot(procs);
      await host.waitForTimeout(30_000);
      const proc = cost(from, await snapshot(procs));
      const read = await host.evaluate(() => {
        const w = window as unknown as PerfWindow;
        return { sample: w.__perf.probe.sample(), long: w.__perf.long, longest: w.__perf.longest };
      });
      const { frames, audio, proxy } = read.sample;
      const band = await host.evaluate(() => (window as unknown as BandWindow).__hbr.emu.viewport);
      const drawn = band ? `${240 + band.left + band.right}x${160 + band.top + band.bottom}` : '240x160';
      console.log(
        `${run.name} host over ${proc.seconds.toFixed(1)}s of match at 4x CPU throttle, picture ${drawn}: ${frames.fps.toFixed(1)} fps, ` +
          `frame p50 ${frames.p50.toFixed(1)} p95 ${frames.p95.toFixed(1)} p99 ${frames.p99.toFixed(1)} max ${frames.max.toFixed(0)} ms, ` +
          `work ${frames.work.mean.toFixed(2)} ms (p95 ${frames.work.p95.toFixed(1)}), ` +
          `audio ${audio.callbacks} callbacks ${audio.late} late ${audio.cut} cut (${audio.state}), ` +
          `${read.long} long tasks, longest ${read.longest.toFixed(0)}ms\n  ${costLine(proc)}, heap ${read.sample.heapMb} MB` +
          (proxy ? `, proxy ${proxy.fought} fought ${proxy.fellBack} fell back ${proxy.frames} frames` : ''),
      );
      fs.writeFileSync(path.join(OUT_DIR, `${run.file}.json`), `${JSON.stringify({ ...read, proc, band }, null, 2)}\n`);
      await host.screenshot({ path: path.join(OUT_DIR, `${run.file}-host.png`) });
      // The #perf readout is up, with the whole page's line under this second's.
      await expect(host.locator('#fps')).toContainText(/fps[\s\S]*all \d+ frames/);

      // The floor, not a number: below this a GBA is visibly wrong, and a number would
      // be a thing to fight rather than a thing to know.
      expect(frames.fps, 'the emulator is still delivering frames').toBeGreaterThan(40);
      // And no single hitch long enough to be felt as a freeze.
      expect(frames.max, 'no frame long enough to look like a hang').toBeLessThan(1000);
      expect(read.longest, 'no main-thread task long enough to look like a hang').toBeLessThan(1000);
      // And the speaker was playing, so "0 late, 0 cut" is a speaker heard rather than one
      // that never started: a headless AudioContext can sit suspended, and then every
      // audio number reads 0.
      expect(audio.state, 'the AudioContext is running').toBe('running');
      expect(audio.callbacks, 'the speaker asked the core for sound').toBeGreaterThan(0);
      // ...and it was the picture this layout shows that was paid for (POK-329): a desktop
      // draws no row past the sprite window, a phone the ROM's whole band.
      expect(band, `the band a ${run.name} asks for`).toEqual(run.band(romView()));
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  } finally {
    await ctx.close();
  }
}

// A hidden host tab used to say so, because the match was waiting on it. It no longer
// waits: the host hands the room over the moment its tab goes to the background, and
// migration.spec.ts is where that lives -- it takes two browsers to see it, which is
// exactly what this file does not have.
