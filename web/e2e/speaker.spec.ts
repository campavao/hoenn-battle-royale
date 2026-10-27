// The worklet speaker on a page that has more than one core, and a speaker iOS stopped
// (HBR-59, 2026-10-27). Cam's iPhone went quiet in a match with bots: the proxy's second
// core opened SDL's own AudioContext when it booted, and the page's sound stopped and never
// came back. So: one AudioContext on the page whatever boots, and a context that will not
// resume is made again at the next tap, still playing the game.
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

const BR_PHASE_SAFARI = 1;

type Audio = { callbacks: number; heard: number; state: string };
type SpeakerWindow = {
  __contexts: AudioContext[];
  __br?: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } };
  __hbr: { perf(): { sample(reset?: boolean): { audio: Audio; proxy: { booted: boolean } | null } } };
};

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Every AudioContext the page makes, SDL's included, in `__contexts`. */
function countContexts(): void {
  const w = window as unknown as { __contexts: AudioContext[]; webkitAudioContext?: typeof AudioContext };
  w.__contexts = [];
  const Real = window.AudioContext;
  class Counted extends Real {
    constructor(options?: AudioContextOptions) {
      super(options);
      w.__contexts.push(this);
    }
  }
  window.AudioContext = Counted;
  w.webkitAudioContext = Counted;
}

/** The speaker over the next 1.5 s. */
function listen(page: Page): Promise<Audio> {
  return page.evaluate(async () => {
    const probe = (window as unknown as SpeakerWindow).__hbr.perf();
    await new Promise((r) => setTimeout(r, 1500));
    return probe.sample().audio;
  });
}

test('the proxy\'s core opens no AudioContext of its own, and the page keeps its sound', async ({ page }) => {
  test.setTimeout(180_000);
  const symbols = loadSymbols();
  await page.addInitScript(countContexts);
  await page.goto(`/#host&fast&seed=20260916&testmon&perf&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 60_000 });
  await startWith(page, 1);
  const phase = () => page.evaluate((addr) => (window as unknown as SpeakerWindow).__br?.mailbox.ram.read(addr, 8) ?? 0, symbols.gBrMatch);
  await expect.poll(phase, { timeout: 60_000 }).toBe(BR_PHASE_SAFARI);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as SpeakerWindow).__hbr.perf().sample().proxy?.booted ?? false), { timeout: 30_000 })
    .toBe(true);
  // A second core's boot is SDL opening its audio as its thread starts: give it time to.
  await page.waitForTimeout(2_000);
  const contexts = await page.evaluate(() => (window as unknown as SpeakerWindow).__contexts.map((c) => c.state));
  const audio = await listen(page);
  console.log(`proxy booted: contexts ${JSON.stringify(contexts)}, audio ${audio.callbacks} buffers ${audio.heard} heard (${audio.state})`);
  expect(contexts).toEqual(['running']);
  expect(audio.state).toBe('running');
  expect(audio.heard, 'the game is heard with the proxy booted').toBeGreaterThan(10);
});

test('a context that will not resume is made again at the next tap, and plays', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(countContexts);
  await page.goto(`/#solo&perf&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 30_000 });
  await expect.poll(async () => (await listen(page)).heard, { timeout: 60_000 }).toBeGreaterThan(10);

  // iOS's interrupted context: stopped, and resume() never brings it back.
  await page.evaluate(async () => {
    const c = (window as unknown as SpeakerWindow).__contexts[0];
    c.resume = () => Promise.resolve();
    await c.suspend();
  });
  const stopped = await listen(page);
  console.log(`stopped: ${stopped.callbacks} buffers (${stopped.state})`);
  expect(stopped.state).toBe('suspended');
  expect(stopped.callbacks).toBe(0);

  // A tap asks it to resume; a tap a second after that one gives up on it.
  await page.mouse.click(5, 5);
  await page.waitForTimeout(1_200);
  await page.mouse.click(5, 5);
  await expect.poll(() => page.evaluate(() => (window as unknown as SpeakerWindow).__contexts.map((c) => c.state)), { timeout: 10_000 }).toEqual(['closed', 'running']);
  await expect.poll(async () => (await listen(page)).heard, { timeout: 20_000 }).toBeGreaterThan(10);
});
