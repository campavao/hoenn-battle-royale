// The phone's HUD and dock (ui/phonehud.ts): the route sign and the fog window over the
// field, PARTY / MAP / START / SELECT under the D-pad, all in Emerald's own windows. The
// ROM's corner box comes off while they are up (gBrHud.noCorner), PARTY and MAP open
// their screens through the start menu, and the D-pad and A/B can be faded and hidden.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

type Emu = { read(a: number, bits: number): number; write(a: number, v: number, bits: number): void };

async function read(page: Page, addr: number, bits: 8 | 16 | 32): Promise<number> {
  return page.evaluate(([a, b]) => (window as unknown as { __hbr: { emu: Emu } }).__hbr.emu.read(a, b), [addr, bits] as const);
}

async function onField(page: Page, sym: Record<string, number>): Promise<void> {
  await page.waitForFunction(
    ([main, cb2]) => ((window as unknown as { __hbr: { emu: Emu } }).__hbr.emu.read(main + 4, 32) & ~1) === cb2,
    [sym.gMain, sym.CB2_Overworld] as const,
    { timeout: 60_000 },
  );
}

test("a phone's HUD: the sign, the fog window, the dock, and the corner box off", async ({ browser }) => {
  test.setTimeout(240_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    await onField(page, sym);
    await page.waitForTimeout(3000);

    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    const sign = await box('.hud-sign canvas');
    const fog = await box('.hud-fog canvas');
    const scale = sign.width / 96;
    expect(scale, "the field's scale").toBeCloseTo(390 / 240, 1);
    expect(sign.height / scale).toBeCloseTo(40, 0);
    expect(sign.x, 'top left').toBeLessThan(20);
    expect(fog.x + fog.width, 'top right').toBeGreaterThan(PORTRAIT.width - 20);
    expect(fog.x, 'the two do not meet').toBeGreaterThan(sign.x + sign.width);
    // The dock: four windows and the menu, every one on the glass and none overlapping.
    const names = ['#hud-party', '#hud-map', '#hud-start', '#hud-ctx', '#hud-menu'];
    const rects = await Promise.all(names.map(box));
    for (const [i, r] of rects.entries()) {
      expect(r.x, names[i]).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, names[i]).toBeLessThanOrEqual(PORTRAIT.width + 0.5);
      expect(r.y + r.height, names[i]).toBeLessThanOrEqual(PORTRAIT.height + 0.5);
      for (const [j, q] of rects.entries()) {
        if (j <= i) continue;
        const overlap = r.x < q.x + q.width - 0.5 && q.x < r.x + r.width - 0.5 && r.y < q.y + q.height - 0.5 && q.y < r.y + r.height - 0.5;
        expect(overlap, `${names[i]} and ${names[j]}`).toBe(false);
      }
    }
    const dpad = await box('#dpad-surface');
    expect(dpad.y + dpad.height, 'the D-pad is above the dock').toBeLessThanOrEqual(rects[0].y + 1);
    // The corner box is off: no window, nothing put (br_hud.c).
    await expect.poll(() => read(page, sym.gBrHud + 0x17a, 8)).toBe(1);
    await expect.poll(() => read(page, sym.gBrHud + 0x6, 8)).toBe(0xff);
    await page.screenshot({ path: path.join(OUT_DIR, 'phone-hud.png') });

    // MAP: grey until the ring, when the start menu has no MAP row (a tap does nothing).
    const ringUp = (await read(page, sym.gBrRing, 8)) !== 0;
    await expect(page.locator('#hud-map')).toHaveAttribute('aria-disabled', String(!ringUp));

    // PARTY: grey before the first catch, when the start menu has no POKeMON row;
    // with a party, the party screen (not the overworld). START does nothing while a
    // script runs (a loot ball's message, a bot's hello), as it does for a thumb: tap again.
    const party = await read(page, sym.gPlayerPartyCount, 8);
    await expect(page.locator('#hud-party')).toHaveAttribute('aria-disabled', String(party === 0));
    if (party > 0) {
      const cb2 = () => read(page, sym.gMain + 4, 32).then((v) => v & ~1);
      for (let i = 0; i < 4 && (await cb2()) === sym.CB2_Overworld; i++) {
        await page.locator('#hud-party').tap();
        await page.waitForTimeout(2500);
      }
      expect(await cb2(), 'the party screen is up').not.toBe(sym.CB2_Overworld);
      await page.screenshot({ path: path.join(OUT_DIR, 'phone-hud-party.png') });
      await expect(page.locator('#hud')).toHaveClass(/off-field/);
      for (let i = 0; i < 3; i++) {
        await page.locator('.ab .btn[data-key="b"]').tap();
        await page.waitForTimeout(600);
      }
    }

    // Fade and hide the pad from the sheet's settings.
    await onField(page, sym);
    await page.locator('#hud-menu').tap();
    await page.locator('#pad-move').click();
    await expect(page.locator('#pad-edit')).toBeVisible();
    await page.locator('#pad-fade-more').click();
    await page.screenshot({ path: path.join(OUT_DIR, 'phone-hud-edit.png') });
    await page.locator('#pad-done').click();
    const alpha = await page.locator('#dpad-surface').evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(alpha)).toBeCloseTo(0.4, 2);
    await page.locator('#hud-menu').tap();
    await page.locator('#pad-hide').click();
    await page.locator('#drawer-close').click();
    await expect(page.locator('#dpad-surface')).toBeHidden();
  } finally {
    await ctx.close();
  }
});
