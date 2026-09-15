// POK-220: a single page, no room hash -- proves solo play never opens a socket
// (Kanto's rule, project CLAUDE.md) and that the mailbox comes up and drains its
// boot block even with nobody else in the match.
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const MAILBOX_MAGIC = 0x4252; // net/mailbox.ts's MAILBOX.MAGIC ('BR')
const OFF_BOOT = 0x2018; // net/mailbox.ts's MAILBOX.OFF_BOOT

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('solo boot: local build, no socket, mailbox awake, boot block consumed', async ({ page }) => {
  test.setTimeout(30_000);
  const rom = romHashParam();

  await page.goto(`/#rom=${rom}`);

  await expect(page.locator('#version')).toContainText('local build', { timeout: 30_000 });

  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 15_000 });

  // Solo play opens no socket at all -- app.ts's wireRoom() bails out with no hash,
  // so bridge.ts never constructs a Bridge and __br is never set.
  const hasBr = await page.evaluate(() => (window as unknown as { __br?: unknown }).__br !== undefined);
  expect(hasBr).toBe(false);

  const symbols = loadSymbols();
  const mailboxBase = symbols.gBrMailbox;

  await page.waitForFunction(
    ([addr, magic]) => (window as unknown as { __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number } } }).__hbr.emu.read(addr, 16) === magic,
    [mailboxBase, MAILBOX_MAGIC],
    { timeout: 15_000 },
  );

  // BrMailbox_Init zeroed the boot block's map field once the ROM landed in
  // Littleroot (writeBootBlock() in app.ts, consumed on the ROM side).
  await page.waitForFunction(
    (addr) => (window as unknown as { __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number } } }).__hbr.emu.read(addr, 8) === 0,
    mailboxBase + OFF_BOOT,
    { timeout: 15_000 },
  );
});
