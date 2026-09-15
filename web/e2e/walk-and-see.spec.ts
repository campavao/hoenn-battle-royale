// POK-220: two Chromium browser CONTEXTS (not tabs in one context -- each context is
// its own IndexedDB, so host and guest each import the ROM fresh, the way two real
// devices would) driving a live host+guest match end to end: host a room, join it,
// walk the guest, and see the guest's own ghost move on the host's ROM.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

// web/package.json sets "type": "module" -- no __dirname in ESM scope.
const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_NO_OBJ = 0xff;

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

// fixme (POK-220/230): host and guest both boot on the same Littleroot tile, so the
// eyeline engage forces a VS screen ~1.2 s after the guest joins, before either can
// walk. Lift once each seat boots on its own tile (or the engage waits for START).
test.fixme("a guest walking right moves 3 tiles on the host's screen", async ({ browser }) => {
  test.setTimeout(60_000);
  const rom = romHashParam();

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();

  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&rom=${rom}`);
    await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });

    const codeEl = host.locator('#room-code');
    await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 30_000 });
    const codeText = (await codeEl.textContent()) ?? '';
    const code = codeText.match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error(`could not parse a room code out of "${codeText}"`);

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });

    // Both seats seated in the host's own roster mirror.
    await host.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__br.roster.all().length === 2,
      { timeout: 30_000 },
    );

    const guestSeat: number = await guest.evaluate(() => (window as unknown as { __br: { bridge: { seat: number } } }).__br.bridge.seat);

    // The guest's own x before it moves -- placed asynchronously by its ROM's first
    // tick, so wait for the field to exist rather than assuming frame 1 already has it.
    await guest.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__br.roster.all().some((e: { isMe: boolean; x?: number }) => e.isMe && e.x !== undefined),
      { timeout: 15_000 },
    );
    const guestStartX: number = await guest.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__br.roster.all().find((e: { isMe: boolean }) => e.isMe).x as number,
    );

    // The mgba core's frame pacing is uneven for about the first second and a half
    // after boot (it is still catching the emulated clock up to wall-clock time), so
    // a `press` issued right at spawn does not translate into a clean number of tile
    // steps per millisecond held -- confirmed empirically: at this point, 700 ms held
    // moves anywhere from 1 to 3 tiles depending on exactly when the hold lands. Once
    // pacing settles, it is reliably 3. Settle first, then walk.
    await guest.waitForTimeout(2_000);

    await guest.evaluate(() => (window as unknown as { __br: { mailbox: { ram: { press(k: string): void } } } }).__br.mailbox.ram.press('right'));
    await guest.waitForTimeout(700);
    await guest.evaluate(() => (window as unknown as { __br: { mailbox: { ram: { release(k: string): void } } } }).__br.mailbox.ram.release('right'));

    const expectedX = guestStartX + 3;

    await host.waitForFunction(
      ([seat, x]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__br.roster.all().some((e: { seat: number; x?: number }) => e.seat === seat && e.x === x),
      [guestSeat, expectedX],
      { timeout: 10_000 },
    );

    // Cross-check the JS-side roster mirror against the host ROM's own gBrSeats -- the
    // ghost the roster claims moved has to actually be the one drawn on screen. This is
    // a second, independent hop (relay message -> host's in-ring -> host ROM's own next
    // tick spawns/steps the ghost), so it can lag the JS-side roster update above by a
    // frame or two: poll gBrSeats directly rather than reading it once.
    const symbols = loadSymbols();
    const seatBase = symbols.gBrSeats + guestSeat * 16;
    await host.waitForFunction(
      ([base, x, noObj]) => {
        const ram = (window as unknown as { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } }).__br.mailbox.ram;
        return ram.read(base + 0, 8) === 1 && ram.read(base + 4, 16) === x && ram.read(base + 9, 8) !== noObj;
      },
      [seatBase, expectedX, BR_NO_OBJ],
      { timeout: 10_000 },
    );

    const [present, x, objId] = await host.evaluate(
      ([base]) => {
        const ram = (window as unknown as { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } }).__br.mailbox.ram;
        return [ram.read(base + 0, 8), ram.read(base + 4, 16), ram.read(base + 9, 8)];
      },
      [seatBase],
    );

    expect(present, 'gBrSeats[guestSeat].present').toBe(1);
    expect(x, 'gBrSeats[guestSeat].x').toBe(expectedX);
    expect(objId, 'gBrSeats[guestSeat].objId (ghost spawned)').not.toBe(BR_NO_OBJ);

    await host.screenshot({ path: path.join(OUT_DIR, 'host.png') });
    await guest.screenshot({ path: path.join(OUT_DIR, 'guest.png') });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
