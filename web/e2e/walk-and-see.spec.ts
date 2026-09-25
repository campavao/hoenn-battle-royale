// POK-220: two Chromium browser CONTEXTS (not tabs in one context -- each context is
// its own IndexedDB, so host and guest each import the ROM fresh, the way two real
// devices would) driving a live host+guest match end to end: host a room, join it,
// walk the guest, and see the guest's own ghost move on the host's ROM.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

// web/package.json sets "type": "module" -- no __dirname in ESM scope.
const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const BR_NO_OBJ = 0xff;
/** BR_PHASE_SAFARI in include/br/br_match.h: the opening, everybody in one place. */
const BR_PHASE_SAFARI = 1;
/** The Zone's six areas are all map group 26 (br_match.c's sSafariCells). */
const SAFARI_GROUP = 26;
/** BrField_InObjectView (src/br/br_field.c): the box the engine keeps objects in, and
 *  the only place a ghost gets one (POK-330 #48) -- from 9 tiles left of the player to
 *  10 right, 7 above to 9 below. */
const VIEW = { left: -9, right: 10, up: -7, down: 9 };
type RamWindow = { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } };
type Row = { seat: number; isMe: boolean; map?: { group: number; num: number }; x?: number; y?: number };
type RosterWindow = { __br: { roster: { all(): Row[] } } };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

// The host's Director starts the match the moment a second seat joins, and that used
// to break this test two ways: the guest was told to walk while the opening was warping
// it into the Safari Zone, and the drop afterwards puts the two of them on different
// maps -- where neither can be the other's ghost, which is the whole assertion.
//
// So the walk happens during the Safari opening, once both ROMs are in it. That is the
// only stretch of a match where everybody is in the same place, which makes it the only
// stretch where "your ghost moved on my screen" is a thing that can be true.
//
// `#nobots` keeps the room to the two of them -- eight bots walking into the guest is
// eight chances for the thing under test to be something else -- and `#fast` runs the
// Safari opening in 25 seconds rather than two minutes.
// `#seed` pins the match (POK-272). The opening deals every seat its own Safari cell off
// the seed and the seat (BrMatch_SafariCell), across all six areas since POK-261 -- and a
// ghost is only spawned on the map its ROM is standing on. With a fresh seed the host and
// the guest were in different areas five times in six, the host's gBrSeats row for the
// guest had no object, and this failed "3/3 in a full run, first try alone" for a month
// while being blamed on a starved browser.
//
// And since POK-330 #48 a ghost gets an object only inside the host's view (VIEW), and
// one area's four cells are spread too far apart for any two of them to be in it: the
// old seed's pair were fifteen rows apart, so the guest's row on the host was right and
// its ghost was, correctly, never drawn. So this seed deals seats 1 and 2 cells 10 and 11
// of the ROM's table, both in the NORTHEAST area -- the host on (21,26), the guest on
// (7,36) -- and the guest walks right seven tiles and up three into the host's view. The
// route was read off the ROM's own map data, not world.json, which knows no elevation
// (Safari North's cliff tops look like open ground to it): one elevation or a crossing
// the whole way, a wall ending the climb whichever of the last two columns the guest
// stops in, and no tall grass, which would roll a wild encounter and end the walk.
// Change the table and re-derive both.
const SAME_AREA_SEED = 1640534095;
const SAFARI_NORTHEAST = 12;
/** Map coords carry MAP_OFFSET 7 in the ROM and on the wire. */
const HOST_CELL = { x: 21 + 7, y: 26 + 7 };
const GUEST_CELL = { x: 7 + 7, y: 36 + 7 };

/** Holds a direction on this page's pad until its own roster row has got to `target`
 *  along the axis it moves, and lets go on that same emulated frame -- the roster row is
 *  what the bridge drained off the ROM earlier in the frame. A round trip per poll would
 *  let go several frames late, and a trainer who runs a tile in eight carries on past. */
async function walkUntil(page: Page, key: 'right' | 'up', target: number): Promise<void> {
  await page.evaluate(
    ([k, t]) =>
      new Promise<void>((resolve, reject) => {
        type W = {
          __hbr: { emu: { onFrame(fn: () => void): () => void; press(k: string): void; release(k: string): void } };
          __br: { roster: { all(): { isMe: boolean; x?: number; y?: number }[] } };
        };
        const w = window as unknown as W;
        const emu = w.__hbr.emu;
        const reached = (): boolean => {
          const me = w.__br.roster.all().find((e) => e.isMe);
          if (me?.x === undefined || me.y === undefined) return false;
          return k === 'right' ? me.x >= t : me.y <= t;
        };
        const deadline = performance.now() + 10_000;
        emu.press(k);
        const off = emu.onFrame(() => {
          const done = reached();
          if (!done && performance.now() < deadline) return;
          emu.release(k);
          off();
          if (done) resolve();
          else {
            const me = w.__br.roster.all().find((e) => e.isMe);
            reject(new Error(`holding ${k} stopped at (${me?.x},${me?.y}), short of ${t}`));
          }
        });
      }),
    [key, target] as const,
  );
}

/** Where this page's own trainer stands once it has stopped: the same row twice, 600 ms
 *  apart, which is a couple of steps even at a walk. */
async function restingAt(page: Page): Promise<{ x: number; y: number }> {
  const own = () => page.evaluate(() => {
    const me = (window as unknown as RosterWindow).__br.roster.all().find((e) => e.isMe);
    return { x: me?.x ?? -1, y: me?.y ?? -1 };
  });
  let before = await own();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(600);
    const now = await own();
    if (now.x === before.x && now.y === before.y) return now;
    before = now;
  }
  throw new Error('the guest never stood still');
}

test("a guest walking right moves on the host's screen", async ({ browser }) => {
  test.setTimeout(120_000);
  const rom = romHashParam();

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();

  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&nobots&fast&testmon&seed=${SAME_AREA_SEED}&rom=${rom}`);
    await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });

    const codeEl = host.locator('#room-code');
    await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 30_000 });
    const codeText = (await codeEl.textContent()) ?? '';
    const code = codeText.match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error(`could not parse a room code out of "${codeText}"`);

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&nobots&fast&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
    await startWith(host, 2);

    // Both seats seated in the host's own roster mirror.
    await host.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__br.roster.all().length === 2,
      { timeout: 30_000 },
    );

    const guestSeat: number = await guest.evaluate(() => (window as unknown as { __br: { bridge: { seat: number } } }).__br.bridge.seat);

    // Into the opening first: walking while the warp into it is happening is walking
    // while something else is moving you.
    const symbols = loadSymbols();
    const phaseAddr = symbols.gBrMatch;
    for (const page of [host, guest]) {
      await page.waitForFunction(
        // The page has no access to this file's scope: both values go over as args.
        ([addr, phase]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === phase,
        [phaseAddr, BR_PHASE_SAFARI],
        { timeout: 60_000 },
      );
    }

    // And each one's own position, placed by its ROM's first tick inside the Zone. A row
    // from before the opening (the room's Littleroot) is not it.
    const inZone = async (page: Page) => {
      await page.waitForFunction(
        (group) => (window as unknown as RosterWindow).__br.roster.all().some((e) => e.isMe && e.map?.group === group && e.x !== undefined),
        SAFARI_GROUP,
        { timeout: 15_000 },
      );
      return page.evaluate(() => (window as unknown as RosterWindow).__br.roster.all().find((e) => e.isMe)!);
    };
    const hostRow = await inZone(host);
    const guestRow = await inZone(guest);
    expect({ map: hostRow.map, x: hostRow.x, y: hostRow.y }, 'the seed deals the host its cell').toEqual({ map: { group: SAFARI_GROUP, num: SAFARI_NORTHEAST }, ...HOST_CELL });
    expect({ map: guestRow.map, x: guestRow.x, y: guestRow.y }, 'the seed deals the guest its cell').toEqual({ map: { group: SAFARI_GROUP, num: SAFARI_NORTHEAST }, ...GUEST_CELL });

    // The mgba core's frame pacing is uneven for about the first second and a half
    // after boot (it is still catching the emulated clock up to wall-clock time). Settle
    // first, then walk -- and then ask the guest where it actually stopped rather than
    // predicting it: what this test is about is that whatever the guest did arrives on
    // the host as a ghost standing there, not how many tiles a held button is worth.
    await guest.waitForTimeout(2_000);

    // Right, to within seven columns of the host, and up to within seven rows of it.
    await walkUntil(guest, 'right', HOST_CELL.x - 7);
    await walkUntil(guest, 'up', HOST_CELL.y + 7);
    const expected = await restingAt(guest);
    expect(expected.x, 'the guest walked east').toBeGreaterThan(GUEST_CELL.x);
    expect(expected.y, 'the guest walked north').toBeLessThan(GUEST_CELL.y);
    const dx = expected.x - HOST_CELL.x;
    const dy = expected.y - HOST_CELL.y;
    expect(dx >= VIEW.left && dx <= VIEW.right && dy >= VIEW.up && dy <= VIEW.down, `the guest (${dx},${dy}) from the host is in its view`).toBe(true);

    await host.waitForFunction(
      ([seat, x, y]) => (window as unknown as RosterWindow).__br.roster.all().some((e) => e.seat === seat && e.x === x && e.y === y),
      [guestSeat, expected.x, expected.y],
      { timeout: 10_000 },
    );

    // Cross-check the JS-side roster mirror against the host ROM's own gBrSeats -- the
    // ghost the roster claims moved has to actually be the one drawn on screen. This is
    // a second, independent hop (relay message -> host's in-ring -> host ROM's own next
    // tick spawns/steps the ghost), so it can lag the JS-side roster update above by a
    // frame or two: poll gBrSeats directly rather than reading it once.
    const seatBase = symbols.gBrSeats + guestSeat * 16;
    await host.waitForFunction(
      ([base, x, y, noObj]) => {
        const ram = (window as unknown as RamWindow).__br.mailbox.ram;
        return ram.read(base + 0, 8) === 1 && ram.read(base + 4, 16) === x && ram.read(base + 6, 16) === y && ram.read(base + 9, 8) !== noObj;
      },
      [seatBase, expected.x, expected.y, BR_NO_OBJ],
      { timeout: 10_000 },
    );

    const [present, x, y, objId] = await host.evaluate(
      ([base]) => {
        const ram = (window as unknown as RamWindow).__br.mailbox.ram;
        return [ram.read(base + 0, 8), ram.read(base + 4, 16), ram.read(base + 6, 16), ram.read(base + 9, 8)];
      },
      [seatBase],
    );

    expect(present, 'gBrSeats[guestSeat].present').toBe(1);
    expect(x, 'gBrSeats[guestSeat].x').toBe(expected.x);
    expect(y, 'gBrSeats[guestSeat].y').toBe(expected.y);
    expect(objId, 'gBrSeats[guestSeat].objId (ghost spawned)').not.toBe(BR_NO_OBJ);

    await host.screenshot({ path: path.join(OUT_DIR, 'host.png') });
    await guest.screenshot({ path: path.join(OUT_DIR, 'guest.png') });
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
