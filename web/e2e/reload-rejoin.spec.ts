// A reload in the middle of a match (POK-433, HBR-20). Cam: "They should be able to
// rejoin back within a minute. After that they are out with the WATCH option."
//
// Inside the relay's hold the tab comes back to the match it left: the ROM from the
// savestate the page wrote as it went, its seat from the relay's token, and -- for the
// host -- the director and its bots, the way a host back from a dropped socket picks the
// match up (match/resume.ts). Past the hold it goes to the menu and says so, with WATCH
// at the top, never back to the room screen Cam found in the 10-19 play-test.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_PHASE_SAFARI = 1;
type BrWindow = {
  __br?: {
    mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } };
    match?: { active: boolean; seed: number };
    director?: unknown;
  };
};

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root`);
});

/** Where the player stands and what the ROM thinks of the match, off its RAM. */
async function where(page: Page): Promise<{ phase: number; seat: number; map: number; x: number; y: number }> {
  const sym = loadSymbols();
  return page.evaluate(
    ([phase, seat, sb1]) => {
      const ram = (window as unknown as BrWindow).__br!.mailbox.ram;
      const save = ram.read(sb1, 32);
      return {
        phase: ram.read(phase, 8),
        seat: ram.read(seat, 8),
        x: ram.read(save, 16),
        y: ram.read(save + 2, 16),
        map: ram.read(save + 4, 16),
      };
    },
    [sym.gBrMatch, sym.gBrMySeat, sym.gSaveBlock1Ptr],
  );
}

async function startMatch(page: Page): Promise<void> {
  await page.goto(`/#host&fast&seed=20261019&testmon&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as BrWindow).__br !== undefined, { timeout: 30_000 });
  // One human and the bots: START is the host's, enabled once the fill is on.
  const start = page.locator('#room-start');
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.click();
  const phase = loadSymbols().gBrMatch;
  await page.waitForFunction(
    ([addr, want]) => (window as unknown as BrWindow).__br!.mailbox.ram.read(addr, 8) === want,
    [phase, BR_PHASE_SAFARI],
    { timeout: 60_000 },
  );
  // On the field, with the bots dealt: the director has been running a moment.
  await page.waitForFunction(() => (window as unknown as BrWindow).__br?.director !== undefined, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

test('a reload mid-match goes back into the match, as the host', async ({ page }) => {
  test.setTimeout(180_000);
  await startMatch(page);
  const before = await where(page);
  const seed = await page.evaluate(() => (window as unknown as BrWindow).__br!.match!.seed);
  await page.screenshot({ path: path.join(OUT_DIR, 'reload-rejoin-before.png') });

  await page.reload();
  await page.waitForFunction(() => (window as unknown as BrWindow).__br?.director !== undefined, { timeout: 60_000 });
  // Back in it: not the menu, not the room screen, and the same run in the ROM.
  await expect(page.locator('#lobby-rows')).toHaveCount(0);
  await expect(page.locator('#room-start')).toHaveCount(0);
  const after = await where(page);
  expect(after.phase).toBe(BR_PHASE_SAFARI);
  expect(after.seat).toBe(before.seat);
  expect({ map: after.map, x: after.x, y: after.y }).toEqual({ map: before.map, x: before.x, y: before.y });
  expect(await page.evaluate(() => (window as unknown as BrWindow).__br!.match!)).toMatchObject({ active: true, seed });
  // ...and the match still running from here: the bots walk again.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __br: { botCount(): number } }).__br.botCount()), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(OUT_DIR, 'reload-rejoin-after.png') });
});

test('a reload after the hold lands on the menu with WATCH', async ({ page }) => {
  test.setTimeout(180_000);
  await startMatch(page);
  // The page writes its record as it goes; age it past the relay's hold on the way out.
  await page.evaluate(() =>
    window.addEventListener('pagehide', () => {
      const raw = sessionStorage.getItem('hbr-resume');
      if (!raw) return;
      const rec = JSON.parse(raw) as { at: number };
      rec.at -= 120_000;
      sessionStorage.setItem('hbr-resume', JSON.stringify(rec));
    }),
  );
  await page.reload();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#lobby-note')).toContainText('you left your match');
  await expect(page.locator('#lobby-rows button').first()).toContainText('WATCH');
  await expect(page.locator('#room-roster')).toHaveCount(0);
  expect(new URL(page.url()).hash).not.toMatch(/host|join/);
  await page.screenshot({ path: path.join(OUT_DIR, 'reload-left-after.png') });

  // ...and once said, it is said: the next reload is an ordinary one.
  await page.reload();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#lobby-note')).not.toContainText('you left your match');
  await expect(page.locator('#lobby-rows button', { hasText: 'WATCH' })).toHaveCount(0);
});

test('a guest reloads and is back in, and the host never counted it out', async ({ browser }) => {
  test.setTimeout(240_000);
  const rom = romHashParam();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&fast&seed=20261020&testmon&rom=${rom}`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 60_000 });
    const code = ((await host.locator('#room-code').textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');
    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&fast&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as BrWindow).__br !== undefined, { timeout: 60_000 });
    await startWith(host, 2);
    await expect(guest.locator('#match-strip')).toContainText(/SAFE: /, { timeout: 120_000 });
    const before = await where(guest);

    await guest.reload();
    await expect(guest.locator('#match-strip')).toContainText(/SAFE: /, { timeout: 60_000 });
    await expect(guest.locator('#lobby-rows')).toHaveCount(0);
    const after = await where(guest);
    expect(after.phase).toBe(before.phase);
    expect(after.seat).toBe(before.seat);
    expect({ map: after.map, x: after.x, y: after.y }).toEqual({ map: before.map, x: before.x, y: before.y });
    expect(await guest.evaluate(() => (window as unknown as BrWindow).__br!.director)).toBeUndefined();
    // The host held the seat through the reload and has it back: still in the match.
    await host.waitForTimeout(5_000);
    const out = await host.evaluate(() => [...((window as unknown as { __br: { match: { out: Set<number> } } }).__br.match.out)]);
    expect(out).not.toContain(before.seat);
  } finally {
    await guestCtx.close();
    await hostCtx.close().catch(() => {});
  }
});
