// The game's speed is the GBA's, whatever the screen refreshes at (POK-247).
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

type HbrWindow = {
  __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number; setSpeed(x: number): void }; perf(): { sample(reset?: boolean): { frames: { fps: number } } } };
  __rafTicks?: number;
};

/** gMain.vblankCounter1: the ROM's own count of the frames it has run. */
const VBLANK_COUNTER1 = 0x20;
const MEASURE_MS = 6000;

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** requestAnimationFrame at `hz`, the way a phone with a fast screen calls it, or the
 *  browser's own with `hz` 0. Either way `__rafTicks` counts the calls. The emulator's
 *  presenter is emscripten's MainLoop, which looks up the global rAF every frame, so a
 *  fast count says the page's MainLoop ran on this clock. */
function fakeRefresh(hz: number): void {
  const w = window as unknown as { __rafTicks: number };
  const native = window.requestAnimationFrame.bind(window);
  const period = 1000 / hz;
  let next = performance.now();
  w.__rafTicks = 0;
  if (hz === 0) {
    window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      native((t) => {
        w.__rafTicks++;
        cb(t);
      });
    return;
  }
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    next = Math.max(next + period, performance.now());
    return window.setTimeout(() => {
      w.__rafTicks++;
      cb(performance.now());
    }, next - performance.now()) as unknown as number;
  };
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
}

async function gameFps(page: Page, speed = 1): Promise<{ rom: number; emu: number; raf: number }> {
  const counter = loadSymbols().gMain + VBLANK_COUNTER1;
  await page.goto(`/#solo&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 30_000 });
  await page.waitForFunction((a) => (window as unknown as HbrWindow).__hbr.emu.read(a, 32) > 300, counter, { timeout: 30_000 });
  return page.evaluate(
    async ([a, ms, x]) => {
      const w = window as unknown as HbrWindow;
      const hbr = w.__hbr;
      if (x !== 1) hbr.emu.setSpeed(x);
      const probe = hbr.perf();
      const t0 = performance.now();
      const v0 = hbr.emu.read(a, 32);
      const r0 = w.__rafTicks ?? 0;
      await new Promise((r) => setTimeout(r, ms));
      const secs = (performance.now() - t0) / 1000;
      return { rom: (hbr.emu.read(a, 32) - v0) / secs, emu: probe.sample().frames.fps, raf: ((w.__rafTicks ?? 0) - r0) / secs };
    },
    [counter, MEASURE_MS, speed] as const,
  );
}

function log(what: string, fps: { rom: number; emu: number; raf: number }): void {
  console.log(`${what}: rom ${fps.rom.toFixed(1)} fps, emulator ${fps.emu.toFixed(1)} fps, rAF ${fps.raf.toFixed(1)}/s`);
}

for (const hz of [60, 120]) {
  test(`the GBA runs at ~60 fps on a ${hz} Hz screen`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(fakeRefresh, hz === 60 ? 0 : hz);
    const fps = await gameFps(page);
    log(`${hz} Hz`, fps);
    // Well clear of the ceiling below, or a green ceiling would mean nothing; a starved
    // main thread (perf.spec.ts) calls a 120 Hz clock nearer 85.
    expect(fps.raf, 'the page presents on this clock').toBeGreaterThan(hz === 60 ? 40 : 70);
    // A loaded runner starves the core too, so the floor only says it runs.
    expect(fps.rom, 'the ROM counts GBA frames, ~59.7 a second').toBeGreaterThan(40);
    expect(fps.rom, 'and no more: a fast screen must not run the game fast').toBeLessThan(64);
  });
}

// The other side of the ceiling: a game that does run fast is caught by it. The core's
// own videoSync setting does not tie it to rAF on this build (measured: 60.1 fps on a
// 120 Hz clock), so double speed stands in for a core that steps per presented frame.
test('a GBA running fast reads above the ceiling', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(fakeRefresh, 120);
  const fps = await gameFps(page, 2);
  log('120 Hz at x2', fps);
  expect(fps.rom).toBeGreaterThan(64);
});
