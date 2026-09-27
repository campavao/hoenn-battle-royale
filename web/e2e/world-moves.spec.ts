// POK-323: the world past the picture keeps moving while we are in a battle or a menu.
// Cam's play-test: "if there was a bot at the bottom of the screen it should continue
// moving... the rest of the world should keep going." Off the field the ROM walks and draws
// nobody, so the page walks the other seats itself off its roster (web/src/field-ghosts.ts,
// GhostWalkers); on the field it leaves every ghost in the ROM's box to the ROM.
//
// First, solo's own bots are on the page's walkers: runSolo hands the field its roster.
// Then this hands the field a roster of one -- seat 16, which solo never deals -- and puts the
// same seat in the ROM's gBrSeats two tiles east of us, where the ROM gives it an object.
// On the field the ROM's ghost and the page's walker stand on the same pixel, and the page
// draws nothing. With the bag open (START, A: the first row of the Zone's menu with no
// party) the field is off, and the walker is drawn and walks a tile in sixteen frames.
// Back on the field it is the ROM's again.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');
const PORTRAIT = { width: 390, height: 844 };
const BR_PHASE_SAFARI = 1;
/** `struct BrSeat` (include/br/br_ghosts.h), 16 bytes a seat. Solo is seat 0 and its
 *  eight bots count down from 31 (bots/roster.ts dealBots): 31 was a live bot, whose own
 *  rows took the seat back from under this spec. 16 is nobody's. */
const SEAT = 16;
const SEAT_SIZE = 16;
const BR_NO_OBJ = 0xff;
/** BR_STEP_QUEUE (include/br/br_ghosts.h). */
const STEP_QUEUE = 5;
const DIR_SOUTH = 1;
const DIR_EAST = 4;
/** LASS, as the roster names a skin: its index into sSkinGraphics. */
const SKIN = 15;
/** Two tiles east of us: inside the ROM's object box (9 left to 10 right). */
const EAST = 2;

type Sprite = { gfx: number; frame: number; hFlip: boolean; x: number; y: number; hidden: boolean; seat?: number };
type Peek = { onField: boolean; rom: Sprite[]; walkers: Sprite[]; drawn: Sprite[]; seats: number[] };
type Row = { seat: number; name: string; alive: boolean; isMe: boolean; map: { group: number; num: number }; x: number; y: number; dir: number; skin: string };
type Emu = {
  read(addr: number, width: 8 | 16 | 32): number;
  write(addr: number, value: number, width: 8 | 16 | 32): void;
  press(k: string): void;
  release(k: string): void;
  onFrame(fn: () => void): () => void;
};
type W = {
  __hbr: { emu: Emu; field: { setPeople(fn: (() => Row[]) | null): void; peek(): Peek | null } };
  __worldRows?: Row[];
};

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Holds a key for `frames` emulated frames, as a thumb on the pad would. */
async function tap(page: Page, key: string, frames = 4): Promise<void> {
  await page.evaluate(
    ([k, n]) =>
      new Promise<void>((resolve) => {
        const emu = (window as unknown as W).__hbr.emu;
        let left = n;
        emu.press(k);
        const off = emu.onFrame(() => {
          if (--left > 0) return;
          emu.release(k);
          off();
          resolve();
        });
      }),
    [key, frames] as const,
  );
}

const peek = (page: Page) => page.evaluate(() => (window as unknown as W).__hbr.field.peek());
const seatOf = (list: Sprite[] | undefined) => list?.find((s) => s.seat === SEAT);
const place = (s: Sprite | undefined) => (s ? { x: s.x, y: s.y, frame: s.frame, hFlip: s.hFlip, gfx: s.gfx } : null);

test('the other seats walk on past the picture in the bag, and are the ROM\'s again on the field', async ({ browser }) => {
  test.setTimeout(150_000);
  const symbols = loadSymbols();
  const ctx = await browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`/#solo&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: { field?: unknown } }).__hbr?.field !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 30_000 });

    // In the Zone, standing still: the whole two-minute opening ahead.
    await page.waitForFunction(
      ([addr, phase]) => (window as unknown as W).__hbr.emu.read(addr, 8) === phase,
      [symbols.gBrMatch, BR_PHASE_SAFARI],
      { timeout: 60_000 },
    );
    const own = async () => page.evaluate((base) => {
      const emu = (window as unknown as W).__hbr.emu;
      const s16 = (v: number) => (v << 16) >> 16;
      return { group: emu.read(base, 8), num: emu.read(base + 1, 8), x: s16(emu.read(base + 2, 16)), y: s16(emu.read(base + 4, 16)) };
    }, symbols.gBrOwnPos);
    let here = await own();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const now = await own();
      if (now.x === here.x && now.y === here.y && now.group === here.group && now.num === here.num && now.num !== 0) break;
      here = now;
    }
    expect(here.group, 'standing somewhere real').toBeGreaterThan(0);

    // Solo's bots, dealt into the Zone, are walked off solo's own roster, wherever they
    // stand: the field was handed it, not only the rows this spec hands it below.
    await expect.poll(async () => (await peek(page))?.seats.length ?? 0, { timeout: 15_000, message: "solo's roster reached the walkers" }).toBeGreaterThan(0);
    expect((await peek(page))!.seats, 'nobody walks our own seat').not.toContain(0);

    // Seat 16, on the page's roster and in the ROM's, two tiles east, facing south.
    const row: Row = { seat: SEAT, name: 'T', alive: true, isMe: false, map: { group: here.group, num: here.num }, x: here.x + EAST, y: here.y, dir: DIR_SOUTH, skin: String(SKIN) };
    const setRow = (r: Row) => page.evaluate((next) => {
      (window as unknown as W).__worldRows = [next];
    }, r);
    await setRow(row);
    await page.evaluate(() => {
      const w = window as unknown as W;
      w.__hbr.field.setPeople(() => w.__worldRows ?? []);
    });
    const seat = symbols.gBrSeats + SEAT * SEAT_SIZE;
    /** Bytes of the ROM's row for seat 16, by offset into `struct BrSeat`. */
    const pokeSeat = (bytes: [number, number][]) => page.evaluate(([base, b]) => {
      const emu = (window as unknown as W).__hbr.emu;
      for (const [off, v] of b) emu.write(base + off, v, 8);
    }, [seat, bytes] as const);
    // Present, skin, our map, the cell, the facing, and no object yet: a place, spawned on
    // the ROM's next field frame.
    await pokeSeat([
      [0, 1], [1, SKIN], [2, here.group], [3, here.num], [4, row.x & 0xff], [5, (row.x >> 8) & 0xff], [6, here.y & 0xff], [7, (here.y >> 8) & 0xff],
      [8, DIR_SOUTH], [9, BR_NO_OBJ], [10, 0],
    ]);

    // On the field: the ROM has an object for it and draws it, the page's walker stands
    // on the same pixel in the same frame, and the page draws nothing of it.
    await expect.poll(async () => seatOf((await peek(page))?.rom) !== undefined, { timeout: 10_000, message: 'the ROM gave seat 16 an object' }).toBe(true);
    const onField = (await peek(page))!;
    expect(onField.onField).toBe(true);
    expect(place(seatOf(onField.walkers)), 'the walker stands where the ROM does').toEqual(place(seatOf(onField.rom)));
    expect(seatOf(onField.drawn), 'inside the box the ROM draws it, and only the ROM').toBeUndefined();

    // The bag: off the field.
    await tap(page, 'start');
    await page.waitForTimeout(600);
    await tap(page, 'a');
    await expect.poll(async () => (await peek(page))?.onField, { timeout: 10_000, message: 'the bag has the screen' }).toBe(false);
    const still = (await peek(page))!;
    const from = seatOf(still.drawn);
    expect(from, 'off the field the page draws it').toBeDefined();
    expect(from!.hidden, 'under the picture, the bag on top').toBe(false);

    // A step east every 300 ms, as the roster would hear them; the ROM's copy follows
    // (off the field the ROM moves its row and nothing else).
    for (let i = 1; i <= 4; i++) {
      await setRow({ ...row, x: row.x + i, dir: DIR_EAST });
      // What HandleStep does with a step it cannot queue: the cell, the facing, and a
      // queue past full, which DriveGhost snaps from on its next field frame.
      await pokeSeat([[4, (row.x + i) & 0xff], [5, ((row.x + i) >> 8) & 0xff], [8, DIR_EAST], [10, STEP_QUEUE + 1]]);
      await page.waitForTimeout(300);
    }
    await expect.poll(async () => (seatOf((await peek(page))?.drawn)?.x ?? from!.x) - from!.x, { timeout: 3_000, message: 'it walked in the bag' }).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: path.join(OUT_DIR, 'world-moves-bag.png') });
    // At rest four tiles on, facing east.
    await expect.poll(async () => seatOf((await peek(page))?.drawn)?.x, { timeout: 5_000 }).toBe(from!.x + 4 * 16);
    expect(seatOf((await peek(page))!.drawn)).toMatchObject({ hFlip: true, y: from!.y });

    // Out of the bag and back on the field: six tiles east is still inside the box, so
    // it is the ROM's to draw again, on the walker's pixel.
    for (let i = 0; i < 3 && (await peek(page))?.onField === false; i++) {
      await tap(page, 'b');
      await page.waitForTimeout(1_000);
    }
    await expect.poll(async () => (await peek(page))?.onField, { timeout: 10_000, message: 'back on the field' }).toBe(true);
    // The bag hands back to the start menu; B closes it, so nothing is frozen.
    await tap(page, 'b');
    await page.waitForTimeout(500);
    // The ROM snaps its object to its row on its first field frame, facing east.
    await expect.poll(async () => {
      const p = await peek(page);
      return JSON.stringify(place(seatOf(p?.rom))) === JSON.stringify(place(seatOf(p?.walkers))) && seatOf(p?.rom) !== undefined;
    }, { timeout: 10_000, message: "the ROM has it again, on the walker's pixel" }).toBe(true);
    const back = (await peek(page))!;
    expect(seatOf(back.drawn), 'never drawn twice').toBeUndefined();
    expect(seatOf(back.rom)).toMatchObject({ hFlip: true, x: from!.x + 4 * 16 });

    // Out of the match: gone from the page's walkers.
    await setRow({ ...row, alive: false });
    await pokeSeat([[0, 0]]);
    await expect.poll(async () => seatOf((await peek(page))?.walkers), { timeout: 5_000 }).toBeUndefined();
  } finally {
    await ctx.close();
  }
});
