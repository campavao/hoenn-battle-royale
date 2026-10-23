// The D-pad flips who an eliminated player watches (Cam's 2026-10-14 phone play-test:
// "when spectating I should be able to hit left and right on the dpad to easily swap
// between who I am spectating"). Following somebody locks our own trainer, so left and
// right meant nothing there; now they are the sheet's PREV and NEXT.
//
// Three seats in a match, nobody fighting: the watcher goes out (the page's roster, as
// spectate.spec.ts does it) and follows the host, then presses RIGHT and LEFT. The
// follow is the ROM's (gBrSpectate.follow, +8), and the game never hears the keys.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

type Dev = {
  __br: {
    bridge: { seat: number };
    roster: { applyMsg(m: unknown): void };
    spectate: { watchingSeat(): number | null };
    watch(s: number | null): void;
    mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number; write(a: number, v: number, w: 8 | 16 | 32): void } };
  };
};

test('left and right on the D-pad flip who an eliminated player watches', async ({ browser }) => {
  test.setTimeout(180_000);
  const rom = romHashParam();
  const symbols = loadSymbols();
  const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    const ready = async (p: Page) => {
      await p.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
      await p.waitForFunction((addr) => (window as unknown as Dev).__br.mailbox.ram.read(addr, 16) === 0x4252, symbols.gBrMailbox, { timeout: 30_000 });
    };
    const host = await ctxs[0].newPage();
    await host.goto(`/#host&noauto&nobots&testmon&rom=${rom}`);
    await ready(host);
    const codeEl = host.locator('#room-code');
    await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 30_000 });
    const code = ((await codeEl.textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');
    const guest = await ctxs[1].newPage();
    await guest.goto(`/#join=${code}&noauto&nobots&testmon&rom=${rom}`);
    await ready(guest);
    const watcher = await ctxs[2].newPage();
    await watcher.goto(`/#join=${code}&noauto&nobots&testmon&rom=${rom}`);
    await ready(watcher);

    const seatOf = (p: Page) => p.evaluate(() => (window as unknown as Dev).__br.bridge.seat);
    const hostSeat = await seatOf(host);
    const guestSeat = await seatOf(guest);
    const follow = () => watcher.evaluate((addr) => (window as unknown as Dev).__br.mailbox.ram.read(addr + 8, 8), symbols.gBrSpectate);
    const watching = () => watcher.evaluate(() => (window as unknown as Dev).__br.spectate.watchingSeat());

    // START: the room screen goes, and the keys are the game's -- then out, and on the host.
    await host.locator('#room-start').click();
    await watcher.waitForSelector('body.in-match', { timeout: 60_000 });
    await watcher.waitForTimeout(3000);
    await watcher.evaluate(() => {
      const d = (window as unknown as Dev).__br;
      d.roster.applyMsg({ t: 'out', seat: d.bridge.seat });
    });
    await watcher.evaluate((seat) => (window as unknown as Dev).__br.watch(seat), hostSeat);
    await expect.poll(follow, { timeout: 15_000, message: 'following the host' }).toBe(hostSeat);
    // Following them cuts straight to their map (HBR-42): a press while that map loads is
    // nobody's, as it is on a phone, so the thumb goes down once the field is back.
    const onField = () => watcher.evaluate(([main, cb2]) => ((window as unknown as Dev).__br.mailbox.ram.read(main + 4, 32) & ~1) === cb2, [symbols.gMain, symbols.CB2_Overworld & ~1]);
    await expect.poll(onField, { timeout: 15_000, message: 'back on the field' }).toBe(true);

    // RIGHT: the next one still in. Held for a while, as a thumb does: one step, not one a repeat.
    await watcher.keyboard.down('ArrowRight');
    await watcher.waitForTimeout(800);
    await watcher.keyboard.up('ArrowRight');
    await expect.poll(watching, { message: 'RIGHT is NEXT' }).toBe(guestSeat);
    await expect.poll(follow, { timeout: 15_000, message: "and the ROM's camera went with it" }).toBe(guestSeat);
    await watcher.waitForTimeout(1000); // the cut onto their map
    await watcher.screenshot({ path: path.join(OUT_DIR, 'spectate-dpad-right.png') });

    // LEFT: back round.
    await watcher.keyboard.press('ArrowLeft');
    await expect.poll(watching, { message: 'LEFT is PREV' }).toBe(hostSeat);
    await expect.poll(follow, { timeout: 15_000 }).toBe(hostSeat);

    // ...and UP is still the game's: nobody new is followed.
    await watcher.keyboard.press('ArrowUp');
    await watcher.waitForTimeout(500);
    expect(await watching()).toBe(hostSeat);
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
  }
});
