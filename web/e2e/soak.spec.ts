// A whole match, watched the whole way (POK-247, the soak).
//
// perf.spec.ts measures thirty seconds of the busiest part; this measures all sixteen
// minutes, because the things a soak finds are the ones that only show up over time:
// a heap that climbs, a bot list that gets slower as the field thins, a second wasm
// core that never gets let go of. The acceptance in the ticket is a phone; this is a
// desktop, so it records the numbers and asserts only the floors that mean "the game
// is still running" -- a number from this machine is a thing to know, not a target.
//
// Opt-in, because it takes twenty minutes: `HBR_SOAK=1 npx playwright test e2e/soak`.
// It is deliberately not part of the suite, which already starves its own emulators by
// the twentieth test (POK-272).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_PHASE_PLAY = 2;
/** How often the page is asked how it is doing. */
const SAMPLE_MS = 30_000;
/** Long enough for the opening, the drop and every fog phase at the default pace. */
const SOAK_MS = 17 * 60_000;

interface Sample {
  at: number;
  fps: number;
  long: number;
  longest: number;
  heapMb: number;
  alive: number;
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!process.env.HBR_SOAK, 'set HBR_SOAK=1 to run the sixteen-minute soak');
  test.skip(!romExists(), `no ROM at ${romPath()} -- run tools/br/dev-patch.sh first`);
});

test('a whole match, with the host carrying it', async ({ browser }) => {
  test.setTimeout(SOAK_MS + 5 * 60_000);
  const rom = romHashParam();
  const symbols = loadSymbols();
  const ctx = await browser.newContext();

  try {
    const host = await ctx.newPage();
    // What the page says about itself while it works. The proxy duel instance is the
    // one thing a frame counter cannot see (POK-238): it boots a second wasm core, and
    // `performance.memory` counts only the JS heap, so without this a soak cannot tell
    // a match where bots fought for real from one where they never did.
    const notes: string[] = [];
    host.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[proxy]') || text.toLowerCase().includes('error')) notes.push(text);
    });
    // The real thing: default pace, a full field of bots, no `#quick`. The host is the
    // worst case by construction -- the director, the bots' A*, the loot table, the
    // ticker and (once two bots meet) a second emulator, all on top of its own game.
    await host.goto(`/#host&seed=20260916&testmon&rom=${rom}`);
    await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });

    await host.evaluate(() => {
      const w = window as unknown as { __perf: { frames: number; long: number; longest: number } };
      w.__perf = { frames: 0, long: 0, longest: 0 };
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            w.__perf.long++;
            w.__perf.longest = Math.max(w.__perf.longest, entry.duration);
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch {
        // No longtask support: the frame count still carries most of the story.
      }
      const tick = () => {
        w.__perf.frames++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // Measure from the drop: the opening is two minutes of one map and tells us little.
    await host.waitForFunction(
      ([addr, want]) => (window as unknown as { __br: { mailbox: { ram: { read(a: number, w: 8 | 16 | 32): number } } } }).__br.mailbox.ram.read(addr, 8) === want,
      [symbols.gBrMatch, BR_PHASE_PLAY],
      { timeout: 4 * 60_000 },
    );

    const samples: Sample[] = [];
    const startedAt = Date.now();
    let lastFrames = 0;
    let lastAt = Date.now();

    while (Date.now() - startedAt < SOAK_MS) {
      await host.waitForTimeout(SAMPLE_MS);
      const now = Date.now();
      const read = (await host.evaluate(() => {
        const w = window as unknown as {
          __perf: { frames: number; long: number; longest: number };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          __br: any;
        };
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return {
          frames: w.__perf.frames,
          long: w.__perf.long,
          longest: w.__perf.longest,
          heap: memory ? memory.usedJSHeapSize : 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          alive: (w.__br.roster?.all() ?? []).filter((e: any) => e.alive).length,
        };
      })) as { frames: number; long: number; longest: number; heap: number; alive: number };

      samples.push({
        at: Math.round((now - startedAt) / 1000),
        fps: (read.frames - lastFrames) / ((now - lastAt) / 1000),
        long: read.long,
        longest: read.longest,
        heapMb: Math.round(read.heap / (1024 * 1024)),
        alive: read.alive,
      });
      lastFrames = read.frames;
      lastAt = now;
      // A match that ends early (everybody out) is a finished soak, not a failure.
      if (samples[samples.length - 1].alive <= 1) break;
    }

    const table = samples
      .map((s) => `${String(s.at).padStart(4)}s  ${s.fps.toFixed(1).padStart(5)} fps  ${String(s.alive).padStart(2)} alive  ${String(s.heapMb).padStart(4)} MB  ${s.long} long (worst ${s.longest.toFixed(0)}ms)`)
      .join('\n');
    console.log(`\nsoak, host, from the drop:\n${table}\n`);
    console.log(notes.length ? `page said:\n  ${notes.slice(0, 20).join('\n  ')}\n` : 'page said nothing worth repeating\n');
    fs.writeFileSync(path.join(OUT_DIR, 'soak.txt'), `${table}\n`);
    await host.screenshot({ path: path.join(OUT_DIR, 'soak-host.png') });

    // Floors, not targets. The phone numbers in the ticket are for a phone.
    const worstFps = Math.min(...samples.map((s) => s.fps));
    const worstTask = Math.max(...samples.map((s) => s.longest));
    const heapGrowth = samples.length > 1 ? samples[samples.length - 1].heapMb - samples[0].heapMb : 0;

    expect(samples.length, 'the match ran long enough to sample').toBeGreaterThan(4);
    expect(worstFps, 'the page is still drawing frames all the way through').toBeGreaterThan(30);
    expect(worstTask, 'no main-thread task long enough to read as a hang').toBeLessThan(2000);
    // A heap that climbs all match is the one thing a soak is really for: 200 MB of
    // growth over sixteen minutes is a leak, whatever the absolute number is.
    expect(heapGrowth, 'the heap is not climbing all match').toBeLessThan(200);
  } finally {
    await ctx.close().catch(() => {});
  }
});
