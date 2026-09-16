// POK-236: the host fills the room with bots, and everybody else sees them as ghosts.
// Two contexts, because a bot only exists once a match has a host running a director --
// and the point of the test is the guest, which is told about bots the same way it is
// told about people, and cannot tell the difference.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const SEAT_STRIDE = 16; // sizeof(struct BrSeat), include/br/br_ghosts.h
const TOP_SEAT = 31; // BR_MAX_SEATS - 1, where the bot roster starts counting down

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

type RamWindow = { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } };

test('the host fills the room with bots and the guest sees them walking', async ({ browser }) => {
  test.setTimeout(150_000);
  const rom = romHashParam();
  const symbols = loadSymbols();

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&testmon&rom=${rom}`);
    await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
    const codeEl = host.locator('#room-code');
    await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 30_000 });
    const code = ((await codeEl.textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });

    // Two members is what starts the host's director, and the bots come with it.
    // The guest's own roster is the thing under test: it learns about a bot from the
    // same `place` a person sends, so the count is people plus bots.
    await guest.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__br.roster.all().length >= 6,
      { timeout: 40_000 },
    );

    // And the guest's ROM has them on its roster too -- gBrSeats, where the ghosts come
    // from. Bots count down from the top seat, so 31 is the first one dealt.
    const seatBase = symbols.gBrSeats + TOP_SEAT * SEAT_STRIDE;
    await guest.waitForFunction(
      (base) => (window as unknown as RamWindow).__br.mailbox.ram.read(base, 8) === 1,
      seatBase,
      { timeout: 20_000 },
    );

    // Walking, not standing: a bot's cell changes within a few seconds of the drop.
    const firstX = await guest.evaluate(
      (base) => (window as unknown as RamWindow).__br.mailbox.ram.read(base + 4, 16),
      seatBase,
    );
    const firstY = await guest.evaluate(
      (base) => (window as unknown as RamWindow).__br.mailbox.ram.read(base + 6, 16),
      seatBase,
    );
    await guest.waitForFunction(
      ([base, x, y]) => {
        const ram = (window as unknown as RamWindow).__br.mailbox.ram;
        return ram.read(base + 4, 16) !== x || ram.read(base + 6, 16) !== y;
      },
      [seatBase, firstX, firstY],
      { timeout: 20_000 },
    );

    await guest.screenshot({ path: path.join(OUT_DIR, 'bots-guest.png') });
  } finally {
    // A throw here (two mgba cores crashing a renderer, see playwright.config.ts) would
    // otherwise skip every close after it, leaking a context -- and its live relay
    // connection and its live wasm core -- for the rest of the worker's browser instance.
    await hostCtx.close().catch(() => {});
    await guestCtx.close().catch(() => {});
  }
});
