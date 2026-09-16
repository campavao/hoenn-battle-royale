// POK-254: a player's own stock ROM, patched in the tab.
//
// Every other spec loads the fork's own build through `#rom=`, which skips the patcher
// entirely -- so the path a real player takes (import a retail Emerald, get battle
// royale) had never been run end to end. The first play-test walked straight into it:
// a stock ROM booted vanilla Emerald, NEW GAME and all, and the only clue was one word
// in the corner.
//
// Needs a retail Emerald (U) ROM (sha1 f3ae0881...) in $HBR_BASE_ROM, and the BPS the
// page applies: tools/br/dev-patch.sh <map> <that same rom>.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols } from './symbols';

const MAILBOX_MAGIC = 0x4252; // net/mailbox.ts's MAILBOX.MAGIC ('BR')

const baseRom = process.env.HBR_BASE_ROM ?? '';
// ESM: no __dirname (see e2e/symbols.ts).
const bps = path.resolve(import.meta.dirname, '../public/patch/hoenn-br.bps');

test.beforeAll(() => {
  test.skip(
    !baseRom || !fs.existsSync(baseRom) || !fs.existsSync(bps),
    'set HBR_BASE_ROM to a retail Emerald (U) ROM and run tools/br/dev-patch.sh <map> <that rom>',
  );
});

test('a stock Emerald ROM is patched in the browser and boots battle royale', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/#solo');
  await expect(page.locator('#screen-importing')).toBeVisible();
  await page.setInputFiles('#rom-input', baseRom);

  // The version line is the patcher's own verdict: `unpatched` means it gave up and
  // started the ROM as it came, which is the bug this is here to catch.
  await expect(page.locator('#version')).not.toContainText('unpatched', { timeout: 45_000 });
  await expect(page.locator('#version')).toContainText('patch', { timeout: 45_000 });

  // And it really is our ROM running, not a lucky label: the mailbox only exists in a
  // patched build, and only BrMailbox_Init writes that magic.
  await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 30_000 });
  const mailboxBase = loadSymbols().gBrMailbox;
  await page.waitForFunction(
    ([addr, magic]) =>
      (window as unknown as { __hbr: { emu: { read(a: number, w: 8 | 16 | 32): number } } }).__hbr.emu.read(addr, 16) === magic,
    [mailboxBase, MAILBOX_MAGIC],
    { timeout: 30_000 },
  );
});
