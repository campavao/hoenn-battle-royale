// POK-346 (Cam's 2026-10-14 play-test: "There's still the little bit of a weird flash at
// the beginning there"): a match drops us in under black. START showed the town the ROM
// stood in, half faded, with the HUD over it; solo showed the copyright screen. The page
// holds #stage-fade black from the moment the match is on until the ROM is back on the
// field on the drop map (match/curtain.ts), and the ROM's own fade-in is all anyone sees.
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Every frame the curtain is down or comes up, what the ROM was showing. */
async function watchCurtain(page: Page): Promise<void> {
  const sym = loadSymbols();
  await page.evaluate(([main, overworld, match]) => {
    const w = window as unknown as { __hbr: { emu: { read(a: number, b: number): number; onFrame(f: () => void): () => void } }; __curtain?: { held: number; liftedOnField: boolean | null; inMatch: boolean | null } };
    const el = document.getElementById('stage-fade')!;
    const seen = { held: 0, liftedOnField: null as boolean | null, inMatch: null as boolean | null };
    w.__curtain = seen;
    let was = el.classList.contains('hold');
    w.__hbr.emu.onFrame(() => {
      const held = el.classList.contains('hold');
      if (held) seen.held++;
      if (was && !held && seen.liftedOnField === null) {
        seen.liftedOnField = ((w.__hbr.emu.read(main + 4, 32) | 1) >>> 0) === ((overworld | 1) >>> 0);
        seen.inMatch = w.__hbr.emu.read(match, 8) !== 0;
      }
      was = held;
    });
  }, [sym.gMain, sym.CB2_Overworld, sym.gBrMatch] as const);
}

test('solo boots into its match under black, and the black goes on the drop map', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/#solo&fast&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
  await watchCurtain(page);
  await page.waitForFunction(() => (window as unknown as { __curtain: { liftedOnField: boolean | null } }).__curtain.liftedOnField !== null, undefined, { timeout: 30_000 });
  const seen = await page.evaluate(() => (window as unknown as { __curtain: unknown }).__curtain);
  expect(seen).toMatchObject({ liftedOnField: true, inMatch: true });
  await expect(page.locator('#stage-fade')).not.toHaveClass(/hold/);
});

test("a room's START goes to the Safari under black", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/#host&noauto&fast&rom=${romHashParam()}`);
  await expect(page.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
  await page.waitForTimeout(2_000);
  await watchCurtain(page);
  await page.locator('#room-start').click();
  await page.waitForFunction(() => (window as unknown as { __curtain: { liftedOnField: boolean | null } }).__curtain.liftedOnField !== null, undefined, { timeout: 30_000 });
  const seen = await page.evaluate(() => (window as unknown as { __curtain: { held: number } }).__curtain);
  expect(seen).toMatchObject({ liftedOnField: true, inMatch: true });
  // Held through the fade out of the town and the warp: a good half second of frames.
  expect(seen.held).toBeGreaterThan(30);
});
