// A reload in the middle of a match (POK-433). The match is the tab's -- its ROM and, for
// a host, its director and bots -- so a reload cannot put you back in it. What it must
// not do is what it did in Cam's 10-19 play-test: follow the URL back into the room, to
// a screen "Waiting for the host to start" with a roster of grey BOTs. It goes to the
// menu and says the match was left (match/left.ts).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_PHASE_SAFARI = 1;
type RamWindow = { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root`);
});

test('a reload mid-match lands on the menu with a line, not in the room', async ({ page }) => {
  test.setTimeout(150_000);
  const phase = loadSymbols().gBrMatch;
  await page.goto(`/#host&fast&seed=20261019&testmon&rom=${romHashParam()}`);
  await page.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
  // One human and the bots: START is the host's, enabled once the fill is on.
  const start = page.locator('#room-start');
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.click();
  await page.waitForFunction(
    ([addr, want]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === want,
    [phase, BR_PHASE_SAFARI],
    { timeout: 60_000 },
  );
  await page.screenshot({ path: path.join(OUT_DIR, 'reload-left-before.png') });
  expect(new URL(page.url()).hash).toMatch(/host|join/);

  await page.reload();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#lobby-note')).toContainText('you left your match');
  await expect(page.locator('#room-roster')).toHaveCount(0);
  expect(new URL(page.url()).hash).not.toMatch(/host|join/);
  await page.screenshot({ path: path.join(OUT_DIR, 'reload-left-after.png') });

  // ...and once said, it is said: the next reload is an ordinary one.
  await page.reload();
  await expect(page.locator('#lobby-rows button', { hasText: 'QUICK PLAY' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#lobby-note')).not.toContainText('you left your match');
});
