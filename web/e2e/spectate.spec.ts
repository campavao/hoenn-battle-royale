// POK-233 part 6: three browser contexts -- two fighting, one watching. The fight is
// real (a netlink link battle over the relay), the watch is real (a BATTLE_TYPE_RECORDED
// built from the challenger's own bstart and driven by its turn stream), and the only
// thing this test fakes is the click: it calls the page's own `watch()` rather than the
// strip, which only appears once a player is out.
//
// The watcher joins AFTER the duel has started on purpose: that is the case the page's
// cache exists for (a bstart is sent once), and it also keeps the watcher out of the
// eyeline -- two seats already in a battle report themselves busy, so the engage leaves
// the newcomer alone.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

const BATTLE_TYPE_RECORDED = 0x0100_0000; // include/constants/battle.h

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** `ram.read` through the page's own bridge handle, as the other specs do. */
type RamWindow = { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } };

test('an eliminated player watches a live fight on the real battle screen', async ({ browser }) => {
  test.setTimeout(150_000);
  const rom = romHashParam();
  const symbols = loadSymbols();

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const watchCtx = await browser.newContext();

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

    // The eyeline is a match rule -- it does not fire in the lobby -- so put both seats
    // in the match rather than waiting out a Safari opening. gBrMatch.phase is what the
    // director's START would set; everything downstream of it is the real thing.
    const inMatch = async (p: typeof host) =>
      p.evaluate(
        (addr) => (window as unknown as { __br: { mailbox: { ram: { write(a: number, v: number, w: 8 | 16 | 32): void } } } }).__br.mailbox.ram.write(addr, 2, 8),
        symbols.gBrMatch,
      );
    await inMatch(host);
    await inMatch(guest);

    // Both seats boot on the same Littleroot tile, so the host's netlink opens within a
    // second or two of that.
    await host.waitForFunction(
      (addr) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === 1,
      symbols.gBrNetlink,
      { timeout: 40_000 },
    );
    const hostSeat: number = await host.evaluate(() => (window as unknown as { __br: { bridge: { seat: number } } }).__br.bridge.seat);

    // Now the watcher, mid-fight.
    const watcher = await watchCtx.newPage();
    await watcher.goto(`/#join=${code}&testmon&rom=${rom}`);
    await watcher.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
    await watcher.waitForFunction(
      (addr) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 16) === 0x4252,
      symbols.gBrMailbox,
      { timeout: 30_000 },
    );

    // Eliminated: the strip -- and the watch -- is what being out is for, and a real
    // elimination is a whole match away. The roster is the page's own mirror, so
    // telling it we are out is the same state a real `out` would leave behind.
    await watcher.evaluate(() => {
      const d = (window as unknown as { __br: { bridge: { seat: number }; roster: { applyMsg(m: unknown): void } } }).__br;
      d.roster.applyMsg({ t: 'out', seat: d.bridge.seat });
    });
    await watcher.evaluate(
      (seat) => (window as unknown as { __br: { watch(s: number | null): void } }).__br.watch(seat),
      hostSeat,
    );

    // gBrSpectate.watching, then the battle itself: the page held the bstart, handed it
    // over with every turn since, and the ROM built the recorded battle from it.
    await watcher.waitForFunction(
      (addr) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr + 5, 8) === 1,
      symbols.gBrSpectate,
      { timeout: 20_000 },
    );
    await watcher.waitForFunction(
      ([addr, flag]) => ((window as unknown as RamWindow).__br.mailbox.ram.read(addr, 32) & flag) !== 0,
      [symbols.gBattleTypeFlags, BATTLE_TYPE_RECORDED],
      { timeout: 30_000 },
    );

    // And it stays: a replay that ran out of stream waits a turn behind rather than
    // quitting, so it is still the same battle seconds later (Kanto's spectator-freeze
    // bug, POK-2026-09-14, was exactly this going the other way).
    await watcher.waitForTimeout(5_000);
    const [flags, watching] = await watcher.evaluate(
      ([flagsAddr, specAddr]) => {
        const ram = (window as unknown as RamWindow).__br.mailbox.ram;
        return [ram.read(flagsAddr, 32), ram.read(specAddr + 5, 8)];
      },
      [symbols.gBattleTypeFlags, symbols.gBrSpectate],
    );
    expect(flags & BATTLE_TYPE_RECORDED, 'still a recorded battle').not.toBe(0);
    expect(watching, 'gBrSpectate.watching').toBe(1);

    await watcher.screenshot({ path: path.join(OUT_DIR, 'spectator.png') });
    await host.screenshot({ path: path.join(OUT_DIR, 'fighter.png') });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await watchCtx.close();
  }
});
