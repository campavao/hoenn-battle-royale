// The game's speed is the GBA's, whatever the screen refreshes at (POK-247).
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

type HbrWindow = {
  __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number }; perf(): { sample(reset?: boolean): { frames: { fps: number } } } };
  __rafTicks?: number;
};

/** gMain.vblankCounter1: the ROM's own count of the frames it has run. */
const VBLANK_COUNTER1 = 0x20;
const MEASURE_MS = 6000;

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** requestAnimationFrame at `hz`, the way a phone with a fast screen calls it. The
 *  emulator's presenter is emscripten's MainLoop, which calls the global rAF each frame,
 *  so this is the clock it sees; `__rafTicks` proves it was. */
function fakeRefresh(hz: number): void {
  const period = 1000 / hz;
  const w = window as unknown as { __rafTicks: number };
  let next = performance.now();
  w.__rafTicks = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    next = Math.max(next + period, performance.now());
    return window.setTimeout(() => {
      w.__rafTicks++;
      cb(performance.now());
    }, next - performance.now()) as unknown as number;
  };
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
}

async function gameFps(page: Page): Promise<{ rom: number; emu: number; raf: number }> {
  const counter = loadSymbols().gMain + VBLANK_COUNTER1;
  await page.goto(`/#solo&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 30_000 });
  await page.waitForFunction((a) => (window as unknown as HbrWindow).__hbr.emu.read(a, 32) > 300, counter, { timeout: 30_000 });
  return page.evaluate(
    async ([a, ms]) => {
      const hbr = (window as unknown as HbrWindow).__hbr;
      const probe = hbr.perf();
      const t0 = performance.now();
      const v0 = hbr.emu.read(a, 32);
      const r0 = (window as unknown as HbrWindow).__rafTicks ?? 0;
      await new Promise((r) => setTimeout(r, ms));
      const secs = (performance.now() - t0) / 1000;
      const raf = ((window as unknown as HbrWindow).__rafTicks ?? 0) - r0;
      return { rom: (hbr.emu.read(a, 32) - v0) / secs, emu: probe.sample().frames.fps, raf: raf / secs };
    },
    [counter, MEASURE_MS] as const,
  );
}

for (const hz of [60, 120]) {
  test(`the GBA runs at ~60 fps on a ${hz} Hz screen`, async ({ page }) => {
    test.setTimeout(90_000);
    if (hz !== 60) await page.addInitScript(fakeRefresh, hz);
    const fps = await gameFps(page);
    console.log(`${hz} Hz: rom ${fps.rom.toFixed(1)} fps, emulator ${fps.emu.toFixed(1)} fps, rAF ${fps.raf.toFixed(1)}/s`);
    if (hz !== 60) expect(fps.raf, 'the page really is being called at the fast rate').toBeGreaterThan(hz * 0.8);
    // A loaded runner starves the core (perf.spec.ts), so the floor only says it runs.
    expect(fps.rom, 'the ROM counts GBA frames, ~59.7 a second').toBeGreaterThan(40);
    expect(fps.rom, 'and no more: a fast screen must not run the game fast').toBeLessThan(64);
  });
}
