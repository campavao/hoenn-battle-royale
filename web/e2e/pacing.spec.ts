// The game keeps the GBA's speed while the page is busy (HBR-59).
//
// A phone's main thread is busy with more than the game: compositing, the HUD, the
// speaker. Each rAF here burns `busy` ms of it on a phone-sized page, and the ROM's own
// frame counter says how fast the game ran meanwhile. The core used to wait on the page
// after every frame, so emulation, the wait for the main thread and the page's work ran
// in series and a busy page slowed the game (at 4x throttle, 8 ms a rAF gave 44.7 fps,
// 12 ms 38.5). Now the core gives the page a few ms and runs on. Two more cases: a tap
// walk, which keeps the core at most 2 frames ahead (touch.ts WALK_LEAD), and a page
// whose frame listeners themselves take 5 ms, past the core's wait, every frame. The
// speaker is an AudioWorklet reading the core's sound ring, so a busy page does not make
// it run dry either (on SDL's ScriptProcessorNode the same cases had 1-20 late buffers in
// 8 s).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

type HbrWindow = {
  __hbr: {
    emu: { read(a: number, w: 8 | 16 | 32): number; setVolume(v: number): void; holdLead(n: number): () => void; onFrame(l: () => void): () => void; lostWrites: number };
    perf(): { sample(reset?: boolean): { frames: { fps: number; p95: number; work: { mean: number } }; audio: { callbacks: number; late: number; cut: number; skipped: number; heard: number; starved: boolean; state: string } } };
  };
  __busyMs: number;
  __rafs: number;
};

/** gMain.vblankCounter1: the ROM's own count of the frames it has run. */
const VBLANK_COUNTER1 = 0x20;
/** gBrMailbox.dropped: messages the ROM could not queue for the page, its ring full. */
const MAILBOX_DROPPED = 0x14;
const MEASURE_MS = 8000;
/** A GBA's frame rate: 16.78 MHz over 280896 cycles a frame. */
const GBA_FPS = 59.73;
/** Page work a rAF, the core's lead held (as a tap walk does), and work in each frame's
 *  listeners. */
const CASES: { busy: number; lead?: number; listener?: number }[] = [
  { busy: 0 },
  { busy: 4 },
  { busy: 8 },
  { busy: 12 },
  { busy: 8, lead: 2 },
  { busy: 12, lead: 2 },
  { busy: 0, listener: 5 },
];
const THROTTLE = Number(process.env.HBR_PACING_THROTTLE ?? 1);

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Burns `window.__busyMs` of the main thread on every animation frame. */
function busyMainThread(): void {
  const w = window as unknown as { __busyMs: number; __rafs: number };
  w.__busyMs = 0;
  w.__rafs = 0;
  const tick = () => {
    w.__rafs++;
    const until = performance.now() + w.__busyMs;
    while (performance.now() < until) {
      /* busy */
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

type Case = (typeof CASES)[number];
async function measure(page: Page, counter: number, c: Case): Promise<Case & { rom: number; emu: number; p95: number; work: number; raf: number; lost: number; audio: { callbacks: number; late: number; cut: number; skipped: number; heard: number; starved: boolean; state: string } }> {
  return page.evaluate(
    async ([a, ms, c]) => {
      const w = window as unknown as HbrWindow;
      w.__busyMs = c.busy;
      const letGo = c.lead ? w.__hbr.emu.holdLead(c.lead) : () => {};
      const off = c.listener
        ? w.__hbr.emu.onFrame(() => {
            const until = performance.now() + (c.listener ?? 0);
            while (performance.now() < until) {
              /* busy */
            }
          })
        : () => {};
      await new Promise((r) => setTimeout(r, 1000));
      const probe = w.__hbr.perf();
      const t0 = performance.now();
      const v0 = w.__hbr.emu.read(a, 32);
      const r0 = w.__rafs;
      const l0 = w.__hbr.emu.lostWrites;
      await new Promise((r) => setTimeout(r, ms));
      const secs = (performance.now() - t0) / 1000;
      const sample = probe.sample();
      const f = sample.frames;
      const out = { ...c, rom: (w.__hbr.emu.read(a, 32) - v0) / secs, emu: f.fps, p95: f.p95, work: f.work.mean, raf: (w.__rafs - r0) / secs, lost: w.__hbr.emu.lostWrites - l0, audio: sample.audio };
      off();
      letGo();
      return out;
    },
    [counter, MEASURE_MS, c] as const,
  );
}

test('a busy phone page does not slow the game', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.addInitScript(busyMainThread);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    const sym = loadSymbols();
    const counter = sym.gMain + VBLANK_COUNTER1;
    const dropped = () => page.evaluate((a) => (window as unknown as HbrWindow).__hbr.emu.read(a, 32), sym.gBrMailbox + MAILBOX_DROPPED);
    await page.goto(`/#solo&perf&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 30_000 });
    await page.waitForFunction((a) => (window as unknown as HbrWindow).__hbr.emu.read(a, 32) > 600, counter, { timeout: 60_000 });
    const droppedBefore = await dropped();
    const runs = [];
    for (const c of CASES) {
      const r = await measure(page, counter, c);
      const how = `${c.lead ? `, lead ${c.lead}` : ''}${c.listener ? `, listeners ${c.listener} ms` : ''}`;
      console.log(`busy ${c.busy} ms a rAF${how}: rom ${r.rom.toFixed(1)} fps, emulator ${r.emu.toFixed(1)} fps, frame p95 ${r.p95.toFixed(1)} ms, page work ${r.work.toFixed(2)} ms, rAF ${r.raf.toFixed(1)}/s, writes lost ${r.lost}, audio ${r.audio.callbacks} buffers ${r.audio.late} late ${r.audio.cut} cut ${r.audio.skipped} skipped ${r.audio.heard} heard (${r.audio.state})`);
      runs.push(r);
    }
    // The volume is the core's own mix, so the worklet hears it: at 0, nothing but silence.
    // Last, since it leaves the game muted.
    const heardAt = (volume: number) =>
      page.evaluate(async (v) => {
        const w = window as unknown as HbrWindow;
        w.__hbr.emu.setVolume(v);
        await new Promise((r) => setTimeout(r, 500));
        const probe = w.__hbr.perf();
        await new Promise((r) => setTimeout(r, 1500));
        const a = probe.sample().audio;
        return a;
      }, volume);
    const muted = await heardAt(0);
    console.log(`volume 0: ${muted.callbacks} buffers, ${muted.heard} with sound`);
    expect(muted.callbacks, 'the speaker kept playing at volume 0').toBeGreaterThan(20);
    expect(muted.heard, 'volume 0 is silence').toBe(0);
    fs.writeFileSync(path.join(OUT_DIR, 'pacing.json'), `${JSON.stringify(runs, null, 2)}\n`);
    // The page drains the ROM's messages less often when it sees fewer frames: none lost.
    expect(await dropped(), 'no message the ROM sent was dropped').toBe(droppedBefore);
    for (const r of runs) {
      const how = JSON.stringify({ busy: r.busy, lead: r.lead, listener: r.listener });
      expect(r.rom, `the game at full speed with ${how}`).toBeGreaterThan(GBA_FPS - 2);
      expect(r.audio.state, 'the AudioContext is running').toBe('running');
      // One at most: the speaker's first lead can land just past a window's start.
      expect(r.audio.late, `the speaker never ran dry with ${how}`).toBeLessThanOrEqual(1);
      expect(r.audio.skipped, `the speaker jumped over no sound with ${how}`).toBe(0);
      expect(r.audio.starved, 'the speaker is not mute').toBe(false);
    }
  } finally {
    await ctx.close();
  }
});
