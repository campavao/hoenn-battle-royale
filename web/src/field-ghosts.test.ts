import { describe, expect, it } from 'vitest';
import {
  DESPAWN_LOCAL_ID, DESPAWN_MAP_NUM, DESPAWN_SIZE, GFX_BIRCHS_BAG, GFX_ITEM_BALL, HIDDEN_MOVEMENT_TYPES, type Known, LOOT_KIND, LOOT_MAP_NUM, LOOT_SIZE, LOOT_X, LOOT_Y,
  MAP_OFFSET, SEAT_DIR, SEAT_MAP_NUM, SEAT_PRESENT, SEAT_SIZE, SEAT_SKIN, SEAT_X, SEAT_Y, TEMPLATE_SIZE, TPL_FLAG_ID, TPL_GFX, TPL_LOCAL_ID, TPL_MOVEMENT_TYPE, TPL_X,
  TPL_Y, type Template, decodeDespawned, decodeLoot, decodeSeats, decodeTemplates, droppedPeople, initialFacing, inObjectView, objectKey, placePeople, standingFrame,
} from './field-ghosts';
import { lcdOrigin } from './field';
import { SKIN_GFX } from './ui/emerald';

// We stand at pos (20, 20) on map 0:16: grid (27, 27). The box the ROM keeps objects in is
// grid x 18..37, y 20..36 -- a template's own x 11..30, y 13..29.
const MAP = { group: 0, num: 16 };
const POS = { x: 20, y: 20 };
const known = (over: Partial<Known> = {}): Known => ({
  map: MAP,
  pos: POS,
  templates: [],
  flag: () => false,
  facing: () => 1,
  despawned: [],
  seats: [],
  mySeat: 0,
  loot: [],
  live: new Set(),
  ...over,
});
const npc = (over: Partial<Template> = {}): Template => ({ localId: 3, gfx: 7, x: 20, y: 30, movementType: 1, flagId: 0, ...over });
const seat = (n: number, over: Partial<Known['seats'][number]> = {}) =>
  ({ seat: n, present: true, skin: 5, group: MAP.group, num: MAP.num, x: 20 + MAP_OFFSET, y: 31 + MAP_OFFSET, dir: 4, ...over });
const ball = (slot: number, over: Partial<Known['loot'][number]> = {}) =>
  ({ slot, kind: 1, group: MAP.group, num: MAP.num, x: 12 + MAP_OFFSET, y: 10 + MAP_OFFSET, ...over });

describe("the people past the ROM's box (POK-318)", () => {
  it('a map person just past the box stands at their home tile, facing the way their movement type starts', () => {
    const facing = (mt: number) => (mt === 8 ? 3 : 1);
    expect(droppedPeople(known({ templates: [npc({ movementType: 8 })], facing }))).toEqual([{ gfx: 7, dir: 3, x: 20, y: 30 }]);
  });

  it('the box is the ROM\'s to the tile, on all four sides', () => {
    const drawn = (x: number, y: number) => droppedPeople(known({ templates: [npc({ x, y })] })).length === 1;
    expect([drawn(20, 29), drawn(20, 30)], 'below: 9 rows is the ROM\'s, 10 is ours').toEqual([false, true]);
    expect([drawn(20, 13), drawn(20, 12)], 'above: 7 and 8').toEqual([false, true]);
    expect([drawn(11, 20), drawn(10, 20)], 'left: 9 and 10').toEqual([false, true]);
    expect([drawn(30, 20), drawn(31, 20)], 'right: 10 and 11').toEqual([false, true]);
    expect(inObjectView(POS, 18, 20)).toBe(true);
    expect(inObjectView(POS, 37, 36)).toBe(true);
    expect(inObjectView(POS, 17, 20)).toBe(false);
  });

  it('inside the box a person the ROM holds no object for is one it chose not to show', () => {
    // Hidden, despawned or short of a slot: the page never second-guesses it there.
    expect(droppedPeople(known({ templates: [npc({ y: 25 })] }))).toEqual([]);
    expect(droppedPeople(known({ seats: [seat(2, { y: 25 + MAP_OFFSET })] }))).toEqual([]);
    expect(droppedPeople(known({ loot: [ball(0, { y: 25 + MAP_OFFSET })] }))).toEqual([]);
  });

  it('never twice: a template the ROM has an object for is its, and the same local id on the last map is somebody else', () => {
    expect(droppedPeople(known({ templates: [npc()], live: new Set([objectKey(3, MAP.num, MAP.group)]) }))).toEqual([]);
    // Across a seam the last map's people stay live under their old map.
    expect(droppedPeople(known({ templates: [npc()], live: new Set([objectKey(3, 15, 0)]) }))).toHaveLength(1);
  });

  it('nobody a hide flag, a beaten trainer or a movement type keeps off the map', () => {
    const set = new Set([0x2a0]);
    const flag = (id: number) => set.has(id) || id === 0;
    expect(droppedPeople(known({ templates: [npc({ flagId: 0x2a0 })], flag }))).toEqual([]);
    expect(droppedPeople(known({ templates: [npc({ flagId: 0x2a1 })], flag })), 'a flag not set').toHaveLength(1);
    expect(droppedPeople(known({ templates: [npc({ flagId: 0 })], flag })), 'flag 0 is no flag').toHaveLength(1);
    expect(droppedPeople(known({ templates: [npc({ flagId: 0x4001 })] })), 'a special flag the page cannot read').toEqual([]);
    expect(droppedPeople(known({ templates: [npc()], despawned: [{ group: 0, num: 16, localId: 3 }] })), 'beaten').toEqual([]);
    expect(droppedPeople(known({ templates: [npc()], despawned: [{ group: 0, num: 15, localId: 3 }] })), 'beaten on another map').toHaveLength(1);
    for (const mt of HIDDEN_MOVEMENT_TYPES) expect(droppedPeople(known({ templates: [npc({ movementType: mt })] })), `movement type ${mt}`).toEqual([]);
    expect(droppedPeople(known({ templates: [npc({ localId: 0 })] })), 'an empty row').toEqual([]);
  });

  it("a ghost past the box stands at its roster cell in its skin, and only another seat's, present, on this map", () => {
    expect(droppedPeople(known({ seats: [seat(2)] }))).toEqual([{ gfx: SKIN_GFX[5], dir: 4, x: 20, y: 31 }]);
    expect(droppedPeople(known({ seats: [seat(2, { present: false })] })), 'absent or out').toEqual([]);
    expect(droppedPeople(known({ seats: [seat(2)], mySeat: 2 })), 'our own').toEqual([]);
    expect(droppedPeople(known({ seats: [seat(2, { num: 15 })] })), 'another map').toEqual([]);
    expect(droppedPeople(known({ seats: [seat(2)], live: new Set([objectKey(0xc8 + 2, MAP.num, MAP.group)]) })), 'its own object').toEqual([]);
    expect(droppedPeople(known({ seats: [seat(2, { skin: 99 })] }))[0].gfx, "a skin the ROM does not know is the first, as Spawn clamps").toBe(SKIN_GFX[0]);
  });

  it('the loot past the box: a bag is the bag and the rest are balls', () => {
    expect(droppedPeople(known({ loot: [ball(0, { kind: 2 }), ball(1, { kind: 1 }), ball(2, { kind: 3 })] })).map((p) => p.gfx)).toEqual([GFX_BIRCHS_BAG, GFX_ITEM_BALL, GFX_ITEM_BALL]);
    expect(droppedPeople(known({ loot: [ball(0)] }))[0]).toMatchObject({ x: 12, y: 10 });
    expect(droppedPeople(known({ loot: [ball(0, { kind: 0 }), ball(1, { num: 15 })] })), 'an empty row, another map').toEqual([]);
    expect(droppedPeople(known({ loot: [ball(4)], live: new Set([objectKey(0xc0 + 4, MAP.num, MAP.group)]) })), 'its own object').toEqual([]);
  });

  // Cam's trainer, 2026-09-18: "If I'm down far enough he's gone, up high enough he's
  // present." Walked down twenty rows away from him, he is the ROM's while he is in its
  // box and the page's past it: exactly one of the two, every step of the way.
  it('walking away from a trainer, exactly one of the ROM and the page has him at every step', () => {
    const trainer = npc({ y: 22 });
    for (let y = 18; y <= 42; y++) {
      const rom = inObjectView({ x: 20, y }, trainer.x + MAP_OFFSET, trainer.y + MAP_OFFSET);
      const live = new Set(rom ? [objectKey(trainer.localId, MAP.num, MAP.group)] : []);
      const page = droppedPeople(known({ pos: { x: 20, y }, templates: [trainer], live })).length;
      expect(Number(rom) + page, `standing at row ${y}`).toBe(1);
    }
  });
});

describe('reading the tables', () => {
  it('templates, seats, loot and the beaten, at their rows, the ones in use', () => {
    const tpl = new Uint8Array(2 * TEMPLATE_SIZE);
    const o = TEMPLATE_SIZE;
    tpl[o + TPL_LOCAL_ID] = 5;
    tpl[o + TPL_GFX] = 0xf0;
    tpl.set([0xfd, 0xff], o + TPL_X);
    tpl.set([0x2c, 0x01], o + TPL_Y);
    tpl[o + TPL_MOVEMENT_TYPE] = 0x4c;
    tpl.set([0x34, 0x12], o + TPL_FLAG_ID);
    expect(decodeTemplates(tpl)).toEqual([{ localId: 5, gfx: 0xf0, x: -3, y: 300, movementType: 0x4c, flagId: 0x1234 }]);

    const seats = new Uint8Array(3 * SEAT_SIZE);
    const s = 2 * SEAT_SIZE;
    seats[s + SEAT_PRESENT] = 1;
    seats[s + SEAT_SKIN] = 4;
    seats[s + SEAT_MAP_NUM] = 9;
    seats.set([0x12, 0x00], s + SEAT_X);
    seats.set([0xff, 0xff], s + SEAT_Y);
    seats[s + SEAT_DIR] = 3;
    expect(decodeSeats(seats)).toEqual([{ seat: 2, present: true, skin: 4, group: 0, num: 9, x: 18, y: -1, dir: 3 }]);

    const loot = new Uint8Array(2 * LOOT_SIZE);
    loot[LOOT_SIZE + LOOT_KIND] = 2;
    loot[LOOT_SIZE + LOOT_MAP_NUM] = 7;
    loot.set([0x10, 0x00], LOOT_SIZE + LOOT_X);
    loot.set([0x11, 0x00], LOOT_SIZE + LOOT_Y);
    expect(decodeLoot(loot)).toEqual([{ slot: 1, kind: 2, group: 0, num: 7, x: 16, y: 17 }]);

    const gone = new Uint8Array(2 * DESPAWN_SIZE);
    gone[DESPAWN_SIZE + DESPAWN_MAP_NUM] = 9;
    gone[DESPAWN_SIZE + DESPAWN_LOCAL_ID] = 1;
    expect(decodeDespawned(gone)).toEqual([{ group: 0, num: 9, localId: 1 }]);
  });

  it('a table the symbols do not have reads as nobody', () => {
    expect([decodeTemplates(new Uint8Array(0)), decodeSeats(new Uint8Array(0)), decodeLoot(new Uint8Array(0)), decodeDespawned(new Uint8Array(0))]).toEqual([[], [], [], []]);
  });
});

describe('where they are drawn, on which frame', () => {
  const origin = lcdOrigin({ x: 20, y: 20, subX: 0, subY: 0 });
  const still = () => ({ frame: 0, hFlip: false });

  it("on our own tile a person's sprite would sit where the ROM puts the player's: centred, feet on the tile's bottom row", () => {
    // BrendanNormal 16x32, ItemBall 16x16, QuintyPlump 32x32.
    const at = (gfx: number) => placePeople([{ gfx, dir: 1, x: 20, y: 20 }], origin, still)[0];
    expect(at(0)).toMatchObject({ x: 112, y: 72 + 16 - 32 });
    expect(at(59)).toMatchObject({ x: 112, y: 72 });
    expect(at(4)).toMatchObject({ x: 104, y: 56 });
    expect(placePeople([{ gfx: 7, dir: 1, x: 20, y: 32 }], origin, still)[0], 'twelve rows down').toMatchObject({ x: 112, y: 56 + 12 * 16, hidden: true });
  });

  it('scroll with the ground mid-step, show the frame they face, and a graphic with no sheet is nobody', () => {
    const mid = lcdOrigin({ x: 20, y: 21, subX: 0, subY: 4 });
    expect(placePeople([{ gfx: 0, dir: 1, x: 20, y: 20 }], mid, still)[0].y).toBe(56 - 16 + 12);
    expect(placePeople([{ gfx: 0, dir: 4, x: 20, y: 20 }], origin, (g, d) => ({ frame: g + d, hFlip: d === 4 }))[0]).toMatchObject({ frame: 4, hFlip: true });
    expect(placePeople([{ gfx: 9999, dir: 1, x: 20, y: 20 }], origin, still)).toEqual([]);
  });

  // A ROM at 0x08000000: gObjectEventGraphicsInfoPointers at +0 (graphics 0 -> info at
  // +0x40), the info's anims at +0x40+0x18 -> +0x60, the four face anims' commands at
  // +0x70..+0x7C: FRAME(0), FRAME(1), FRAME(2), FRAME(2, hFlip). Facings at +0x90.
  const rom = new Uint8Array(0xa0);
  const w32 = (o: number, v: number) => { rom[o] = v & 255; rom[o + 1] = (v >>> 8) & 255; rom[o + 2] = (v >>> 16) & 255; rom[o + 3] = (v >>> 24) & 255; };
  const base = 0x08000000;
  w32(0x00, base + 0x40);
  w32(0x04, base + 0x80);
  w32(0x40 + 0x18, base + 0x60);
  for (let i = 0; i < 4; i++) w32(0x60 + 4 * i, base + 0x70 + 4 * i);
  w32(0x70, (16 << 16) | 0);
  w32(0x74, (16 << 16) | 1);
  w32(0x78, (16 << 16) | 2);
  w32(0x7c, (1 << 22) | (16 << 16) | 2);
  w32(0x80 + 0x18, 0x0a000000); // graphics 1's anims point off the ROM
  rom.set([1, 1, 1, 2, 1], 0x90);

  it("the standing frame is the face anim's first command, East being West mirrored", () => {
    expect([1, 2, 3, 4].map((dir) => standingFrame(rom, base, 0, dir))).toEqual([
      { frame: 0, hFlip: false },
      { frame: 1, hFlip: false },
      { frame: 2, hFlip: false },
      { frame: 2, hFlip: true },
    ]);
    expect(standingFrame(rom, base, 0, 0), 'DIR_NONE faces south').toEqual({ frame: 0, hFlip: false });
  });

  it('without the table, or off the end of the ROM, they stand on the first frame', () => {
    const still0 = { frame: 0, hFlip: false };
    expect(standingFrame(null, base, 0, 4)).toEqual(still0);
    expect(standingFrame(rom, undefined, 0, 4)).toEqual(still0);
    expect(standingFrame(rom, base, 1, 4)).toEqual(still0);
    expect(standingFrame(rom, base, 200, 4)).toEqual(still0);
  });

  it('a template faces the way gInitialMovementTypeFacingDirections says, south without it', () => {
    expect(initialFacing(rom, base + 0x90, 3)).toBe(2);
    expect(initialFacing(rom, base + 0x90, 0)).toBe(1);
    expect(initialFacing(rom, base + 0x90, 0x51), 'no such movement type').toBe(1);
    expect(initialFacing(null, base + 0x90, 3)).toBe(1);
    expect(initialFacing(rom, undefined, 3)).toBe(1);
  });
});
