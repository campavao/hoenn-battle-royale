// A whole match, watched the whole way (POK-247, the soak).
//
// perf.spec.ts measures thirty seconds of the busiest part; this measures all sixteen
// minutes, because the things a soak finds are the ones that only show up over time:
// a heap that climbs, a bot list that gets slower as the field thins, a second wasm
// core that never gets let go of. The acceptance in the ticket is a phone; this is a
// desktop, so it records the numbers and asserts only the floors that mean "the game
// is still running" -- a number from this machine is a thing to know, not a target.
//
// Every 30 s it reads the page's own meter (ui/fps.ts: emulator frame times, the page's
// share of each frame, late and cut audio, the JS heap, the proxy's counts) and what
// the processes cost (proc.ts: CPU-seconds a second, the renderer's resident memory).
// soak.txt is the table, soak.json the lot.
//
// Opt-in, because it takes twenty minutes: `HBR_SOAK=1 npx playwright test e2e/soak`.
// `HBR_SOAK_THROTTLE=4` runs it with the CPU throttled 4x through CDP, as perf.spec does.
// It is deliberately not part of the suite, which already starves its own emulators by
// the twentieth test (POK-272).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { cost, processes, snapshot, type PageSample, type ProcCost } from './proc';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_PHASE_PLAY = 2;
/** How often the page is asked how it is doing. */
const SAMPLE_MS = 30_000;
/** Long enough for the opening, the drop and every fog phase at the default pace. */
const SOAK_MS = 17 * 60_000;
const THROTTLE = Number(process.env.HBR_SOAK_THROTTLE) || 1;

interface Sample {
  at: number;
  page: PageSample;
  proc: ProcCost;
  long: number;
  longest: number;
  alive: number;
}

type SoakWindow = {
  __soak: { long: number; longest: number; probe: { sample(reset?: boolean): PageSample }; mark: number };
  __hbr: { perf(): { sample(reset?: boolean): PageSample } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  __br: any;
};

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!process.env.HBR_SOAK, 'set HBR_SOAK=1 to run the sixteen-minute soak');
  test.skip(!romExists(), `no ROM at ${romPath()} -- run tools/br/dev-patch.sh first`);
});

function row(s: Sample): string {
  const f = s.page.frames;
  const a = s.page.audio;
  const p = s.page.proxy;
  return [
    `${String(s.at).padStart(4)}s`,
    `${f.fps.toFixed(1).padStart(5)} fps`,
    `p95 ${f.p95.toFixed(1).padStart(4)} p99 ${f.p99.toFixed(1).padStart(4)} max ${f.max.toFixed(0).padStart(4)} ms`,
    `work ${f.work.mean.toFixed(2)}`,
    `audio ${a.late}/${a.cut}`,
    `cpu ${s.proc.renderer.toFixed(2)}+${s.proc.gpu.toFixed(2)}`,
    `rss ${s.proc.rssMb ?? '?'} heap ${s.page.heapMb ?? '?'} MB`,
    `${String(s.alive).padStart(2)} alive`,
    p ? `proxy ${p.fought}/${p.fellBack} ${p.frames}f` : 'proxy -',
    `${s.long} long (${s.longest.toFixed(0)}ms)`,
  ].join('  ');
}

test('a whole match, with the host carrying it', async ({ browser }) => {
  test.setTimeout(SOAK_MS + 8 * 60_000);
  const rom = romHashParam();
  const symbols = loadSymbols();
  const ctx = await browser.newContext();
  const procs = await processes(browser);

  try {
    const host = await ctx.newPage();
    const cdp = await ctx.newCDPSession(host);
    if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    // What the page says about itself while it works: the proxy's own notes, and errors.
    const notes: string[] = [];
    host.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[proxy]') || text.toLowerCase().includes('error')) notes.push(text);
    });
    try {
      // The real thing: default pace, a full room of bots, no `#fast`. The host is the
      // worst case by construction -- the director, the bots' A*, the loot table, the
      // ticker and (once two bots meet) a second emulator, all on top of its own game.
      await host.goto(`/#host&seed=20260916&testmon&perf&rom=${rom}`);
      await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
      // Thirty, not the default eight (perf.spec's ladder): rooms fill to thirty now, and
      // a full room is what the ticket's acceptance is written for.
      const max = host.locator('#room-max');
      await expect(max).toBeVisible({ timeout: 60_000 });
      for (const want of [12, 16, 20, 26, 30]) {
        await max.click();
        await expect(max).toContainText(`MAX ${want}`, { timeout: 15_000 });
      }
      await startWith(host, 1);

      // Measure from the drop: the opening is two minutes of one map and tells us little.
      await host.waitForFunction(
        ([addr, want]) => (window as unknown as SoakWindow).__br.mailbox.ram.read(addr, 8) === want,
        [symbols.gBrMatch, BR_PHASE_PLAY],
        { timeout: 4 * 60_000 },
      );
      await host.evaluate(() => {
        const w = window as unknown as SoakWindow;
        // The mark is how the end knows this is still the page it started with: a tab the
        // browser reloaded under memory pressure would have lost it.
        w.__soak = { long: 0, longest: 0, probe: w.__hbr.perf(), mark: Date.now() };
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              w.__soak.long++;
              w.__soak.longest = Math.max(w.__soak.longest, entry.duration);
            }
          }).observe({ entryTypes: ['longtask'] });
        } catch {
          // No longtask support: the frame times still carry most of the story.
        }
      });

      const samples: Sample[] = [];
      const startedAt = Date.now();
      let from = await snapshot(procs);

      while (Date.now() - startedAt < SOAK_MS) {
        await host.waitForTimeout(SAMPLE_MS);
        const to = await snapshot(procs);
        const read = await host.evaluate(() => {
          const w = window as unknown as SoakWindow;
          const out = {
            page: w.__soak.probe.sample(),
            long: w.__soak.long,
            longest: w.__soak.longest,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            alive: (w.__br.roster?.all() ?? []).filter((e: any) => e.alive).length as number,
          };
          w.__soak.long = 0;
          w.__soak.longest = 0;
          return out;
        });
        samples.push({ at: Math.round((to.at - startedAt) / 1000), proc: cost(from, to), ...read });
        from = to;
        // A match that ends early (everybody out) is a finished soak, not a failure.
        if (read.alive <= 1) break;
      }
      const stillHere = await host.evaluate(() => typeof (window as unknown as SoakWindow).__soak?.mark === 'number');

      const title = `soak, host, MAX 30, ${THROTTLE}x CPU, from the drop (audio late/cut, cpu renderer+gpu per s, proxy fought/fell back frames):`;
      const table = samples.map(row).join('\n');
      console.log(`\n${title}\n${table}\n`);
      console.log(notes.length ? `page said:\n  ${notes.slice(0, 20).join('\n  ')}\n` : 'page said nothing worth repeating\n');
      const tag = THROTTLE > 1 ? `-${THROTTLE}x` : '';
      fs.writeFileSync(path.join(OUT_DIR, `soak${tag}.txt`), `${title}\n${table}\n`);
      fs.writeFileSync(path.join(OUT_DIR, `soak${tag}.json`), `${JSON.stringify({ throttle: THROTTLE, samples, notes }, null, 2)}\n`);
      await host.screenshot({ path: path.join(OUT_DIR, `soak${tag}-host.png`) });

      // Floors, not targets. The phone numbers in the ticket are for a phone.
      const worstFps = Math.min(...samples.map((s) => s.page.frames.fps));
      const worstTask = Math.max(...samples.map((s) => s.longest));
      const heaps = samples.map((s) => s.page.heapMb ?? 0);
      const heapGrowth = heaps.length > 1 ? heaps[heaps.length - 1] - heaps[0] : 0;

      expect(stillHere, 'the tab was never reloaded under the match').toBe(true);
      expect(samples.length, 'the match ran long enough to sample').toBeGreaterThan(4);
      expect(worstFps, 'the emulator is still delivering frames all the way through').toBeGreaterThan(30);
      expect(worstTask, 'no main-thread task long enough to read as a hang').toBeLessThan(2000);
      // A heap that climbs all match is the one thing a soak is really for: 200 MB of
      // growth over sixteen minutes is a leak, whatever the absolute number is.
      expect(heapGrowth, 'the heap is not climbing all match').toBeLessThan(200);
    } finally {
      if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    }
  } finally {
    await ctx.close().catch(() => {});
  }
});
