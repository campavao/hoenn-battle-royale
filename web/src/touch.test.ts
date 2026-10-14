import { describe, expect, it } from 'vitest';
import { MENU_ACTION, MENU_MOVE, MENU_SAFARI, menuSlot, onPicture, toGbaPixel } from './touch';

describe('a tap becomes a GBA pixel', () => {
  it('maps the picture one to one at scale', () => {
    const rect = { left: 0, top: 100, width: 480, height: 320 };
    expect(toGbaPixel(rect, 0, 100)).toEqual({ x: 0, y: 0 });
    expect(toGbaPixel(rect, 240, 260)).toEqual({ x: 120, y: 80 });
    expect(toGbaPixel(rect, 479, 419)).toEqual({ x: 239.5, y: 159.5 });
  });

  it('with a band past the LCD (POK-319) the tap is measured from the LCD inside the canvas', () => {
    // A 256x256 canvas at 2x with the LCD at (0, 40): its top-left is 80 CSS px down.
    const rect = { left: 0, top: 100, width: 512, height: 512 };
    const band = { left: 0, top: 40, right: 16, bottom: 56 };
    expect(toGbaPixel(rect, 0, 180, band)).toEqual({ x: 0, y: 0 });
    expect(toGbaPixel(rect, 240, 340, band)).toEqual({ x: 120, y: 80 });
    expect(toGbaPixel(rect, 0, 100, band), 'the band above is the field').toEqual({ x: 0, y: -40 });
  });

  it('past the picture the numbers keep going: that is the field around it', () => {
    const rect = { left: 0, top: 200, width: 390, height: 260 };
    const above = toGbaPixel(rect, 195, 100)!;
    expect(above.x).toBeCloseTo(120);
    expect(above.y).toBeCloseTo((-100 / 260) * 160);
    expect(onPicture(above.x, above.y)).toBe(false);
    expect(onPicture(120, 80)).toBe(true);
    expect(onPicture(240, 80)).toBe(false);
  });

  it('a box with no size is no tap', () => {
    expect(toGbaPixel({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull();
  });
});

describe('a tap in a battle picks a quadrant', () => {
  it('the action menu is the right half of the bottom box', () => {
    expect(menuSlot(MENU_ACTION, 140, 128)).toBe(0); // FIGHT
    expect(menuSlot(MENU_ACTION, 200, 128)).toBe(1); // BAG
    expect(menuSlot(MENU_ACTION, 140, 148)).toBe(2); // POKeMON
    expect(menuSlot(MENU_ACTION, 200, 148)).toBe(3); // RUN
    expect(menuSlot(MENU_ACTION, 60, 140), 'the "what will X do" text').toBe(-1);
    expect(menuSlot(MENU_ACTION, 200, 60), 'the field').toBe(-1);
  });

  it('the Safari menu is laid out the same', () => {
    expect(menuSlot(MENU_SAFARI, 140, 128)).toBe(0); // BALL
    expect(menuSlot(MENU_SAFARI, 200, 148)).toBe(3); // RUN
  });

  it('the moves are the left two thirds; PP and type are not a choice', () => {
    expect(menuSlot(MENU_MOVE, 20, 128)).toBe(0);
    expect(menuSlot(MENU_MOVE, 100, 128)).toBe(1);
    expect(menuSlot(MENU_MOVE, 20, 150)).toBe(2);
    expect(menuSlot(MENU_MOVE, 100, 150)).toBe(3);
    expect(menuSlot(MENU_MOVE, 200, 140)).toBe(-1);
  });

  it('no menu, no choice', () => {
    expect(menuSlot(0, 140, 128)).toBe(-1);
  });
});

// ---- the cursor walk, against a fake ROM ---------------------------------------------
//
// A battle the page cannot reach in an e2e, so the ROM is played here: the menu byte,
// a cursor that flips a bit on each new press of a direction (the way the handlers
// do), and an A that closes the menu. What is under test is the sequencing -- one
// axis at a time, an edge per press, A only once the cursor is where the tap was.

import { KEY_BIT, type GbaKey } from './emu';
import { START_BR_MAP, START_POKEMON, TouchLayer, startMenuTable } from './touch';

class FakeEmu {
  held = 0;
  menu = 0;
  cursor = 0;
  chosen: number | null = null;
  moves = [1, 2, 0, 0];
  /** The slot a step may not land on (gNumberOfMovesToChoose), none by default. */
  refuse = 4;
  /** The local battler: gBattlerPositions says who is PLAYER_LEFT. */
  local = 0;
  private listeners: (() => void)[] = [];
  private wasDown = 0;
  press(k: GbaKey) { this.held |= 1 << KEY_BIT[k]; }
  release(k: GbaKey) { this.held &= ~(1 << KEY_BIT[k]); }
  keys() { return this.held; }
  onFrame(l: () => void) { this.listeners.push(l); return () => {}; }
  read(addr: number, width: 8 | 16 | 32): number {
    if (addr === 0x439) return 0x02; // gMain.inBattle
    if (addr === 1000 + 8) return this.menu; // gBrBattle.menu
    if (addr >= 5000 && addr < 5004) return addr - 5000 === this.local ? 0 : 1; // gBattlerPositions
    if (addr === 2000 + this.local || addr === 3000 + this.local) return this.cursor;
    const row = 4004 + this.local * 0x200;
    if (addr >= row && addr < row + 8 && width === 16) return this.moves[(addr - row) / 2];
    return 0;
  }
  /** One frame: the page's listener runs, then the "ROM" reads JOY_NEW. */
  frame() {
    for (const l of this.listeners) l();
    const fresh = this.held & ~this.wasDown;
    this.wasDown = this.held;
    if (!this.menu) return;
    if (fresh & (1 << KEY_BIT.right) && (this.cursor | 1) < this.refuse) this.cursor |= 1;
    if (fresh & (1 << KEY_BIT.left)) this.cursor &= ~1;
    if (fresh & (1 << KEY_BIT.down) && (this.cursor | 2) < this.refuse) this.cursor |= 2;
    if (fresh & (1 << KEY_BIT.up)) this.cursor &= ~2;
    if (fresh & (1 << KEY_BIT.a)) { this.chosen = this.cursor; this.menu = 0; }
  }
}

function layer(emu: FakeEmu) {
  // No DOM here: the layer only listens on it, and these tests call `tap` directly.
  const canvas = { addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 160 }) } as unknown as HTMLCanvasElement;
  const symbols = new Map([['gMain', 0], ['gBrBattle', 1000], ['gActionSelectionCursor', 2000], ['gMoveSelectionCursor', 3000], ['gBattleBufferA', 4000], ['gBattlerPositions', 5000]]);
  const t = new TouchLayer({ emu: emu as never, canvas, symbols });
  t.attach();
  return { t, tap: (x: number, y: number) => (t as unknown as { tap(x: number, y: number): void }).tap(x, y) };
}

describe('a tap on a battle menu walks the cursor there and presses A', () => {
  it('RUN from FIGHT: right, then down, then A', () => {
    const emu = new FakeEmu();
    emu.menu = MENU_ACTION;
    const { tap } = layer(emu);
    tap(200, 148);
    for (let i = 0; i < 40 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(3);
    for (let i = 0; i < 6; i++) emu.frame(); // the A is let go a couple of frames on
    expect(emu.held, 'nothing left held').toBe(0);
  });

  it('a move: the second one, and never an empty slot', () => {
    const emu = new FakeEmu();
    emu.menu = MENU_MOVE;
    const { tap } = layer(emu);
    tap(100, 150); // slot 3, empty
    for (let i = 0; i < 20; i++) emu.frame();
    expect(emu.chosen).toBeNull();
    tap(100, 128); // slot 1
    for (let i = 0; i < 40 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(1);
  });

  it('the thumb wins: a key the page did not press cancels the walk', () => {
    const emu = new FakeEmu();
    emu.menu = MENU_ACTION;
    const { tap } = layer(emu);
    tap(200, 148);
    emu.frame();
    emu.press('b');
    for (let i = 0; i < 40; i++) emu.frame();
    expect(emu.chosen).toBeNull();
    expect(emu.held & ~(1 << KEY_BIT.b), 'the page let go of its own key').toBe(0);
  });

  it("the page's menu: FIGHT, then the move once the move menu is up", () => {
    const emu = new FakeEmu();
    emu.menu = MENU_ACTION;
    const { t } = layer(emu);
    t.chooseBattle(MENU_ACTION, 0, 1);
    for (let i = 0; i < 40 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen, 'FIGHT').toBe(0);
    // The move menu comes up a while later, its cursor where it was left.
    for (let i = 0; i < 12; i++) emu.frame();
    emu.chosen = null;
    emu.cursor = 0;
    emu.menu = MENU_MOVE;
    for (let i = 0; i < 40 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen, 'the second move').toBe(1);
  });

  it('three moves: from the third to the second goes up first (RIGHT there is refused)', () => {
    const emu = new FakeEmu();
    emu.menu = MENU_MOVE;
    emu.moves = [1, 2, 3, 0];
    emu.cursor = 2;
    emu.refuse = 3;
    const { t } = layer(emu);
    t.chooseBattle(MENU_MOVE, 1);
    for (let i = 0; i < 40 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(1);
  });

  it('a move asked for while the move menu is still coming waits for it', () => {
    const emu = new FakeEmu();
    emu.menu = 0;
    const { t } = layer(emu);
    t.chooseBattle(MENU_MOVE, 1);
    for (let i = 0; i < 10; i++) emu.frame();
    expect(emu.chosen).toBeNull();
    emu.menu = MENU_MOVE;
    for (let i = 0; i < 40 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(1);
    // and no menu at all is never a choice
    emu.chosen = null;
    emu.menu = 0;
    t.chooseBattle(0, 1);
    for (let i = 0; i < 20; i++) emu.frame();
    expect(emu.held).toBe(0);
  });

  it("on the challenged side of a link battle the cursor is battler 1's", () => {
    const emu = new FakeEmu();
    emu.menu = MENU_ACTION;
    emu.local = 1;
    const { t } = layer(emu);
    t.chooseBattle(MENU_ACTION, 3);
    for (let i = 0; i < 40 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(3);
  });

  it('FIGHT tapped straight after BACK: the B goes down, then FIGHT once the action menu is up', () => {
    const emu = new FakeEmu();
    emu.menu = MENU_MOVE;
    const { t } = layer(emu);
    t.tapKey('b');
    t.chooseBattle(MENU_ACTION, 0, 1);
    let pressedB = false;
    for (let i = 0; i < 60 && emu.chosen === null; i++) {
      emu.frame();
      if (emu.held & (1 << KEY_BIT.b)) pressedB = true;
      // the ROM's byte goes back to the action menu a few frames after the B
      if (pressedB && emu.menu === MENU_MOVE && i > 6) emu.menu = MENU_ACTION;
    }
    expect(pressedB).toBe(true);
    expect(emu.chosen, 'FIGHT').toBe(0);
  });

  it("a choice for a menu that never comes up is let go; B is one tap", () => {
    const emu = new FakeEmu();
    emu.menu = MENU_MOVE;
    const { t } = layer(emu);
    t.chooseBattle(MENU_ACTION, 3);
    for (let i = 0; i < 120; i++) emu.frame();
    expect(emu.chosen).toBeNull();
    expect(emu.held).toBe(0);
    const seen: number[] = [];
    t.tapKey('b');
    for (let i = 0; i < 8; i++) {
      emu.frame();
      seen.push(emu.held);
    }
    expect(seen.filter((h) => h === 1 << KEY_BIT.b).length).toBeGreaterThan(0);
    expect(emu.held).toBe(0);
  });

  it('a menu that closes under the tap is left alone', () => {
    const emu = new FakeEmu();
    emu.menu = MENU_ACTION;
    const { tap } = layer(emu);
    tap(200, 128);
    emu.menu = 0;
    for (let i = 0; i < 40; i++) emu.frame();
    expect(emu.chosen).toBeNull();
    expect(emu.held).toBe(0);
  });
});

// ---- a tap in the field, against a fake ROM ------------------------------------------
//
// Littleroot at (10, 10), where every tile round about is open ground. What is under
// test is which tile a pixel is: field.ts measured the pos tile at picture (112, 72) at
// rest, and mid-step the picture runs up to a tile behind the pos, which has already
// moved (field.test.ts has both).

class FieldEmu {
  held = 0;
  pressed: GbaKey[] = [];
  camera = { x: 10, y: 10, subX: 0, subY: 0 };
  /** gBrOwnPos: object-event coordinates, MAP_OFFSET on. */
  own = { x: 17, y: 17, dir: 1 };
  /** The map, in the save block's location and gBrOwnPos alike: Littleroot. */
  map = { group: 0, num: 9 };
  /** The player's object, gObjectEvents[0]: its currentElevation. */
  elevation = 3;
  private listeners: (() => void)[] = [];
  press(k: GbaKey) {
    this.held |= 1 << KEY_BIT[k];
    this.pressed.push(k);
  }
  release(k: GbaKey) { this.held &= ~(1 << KEY_BIT[k]); }
  keys() { return this.held; }
  onFrame(l: () => void) { this.listeners.push(l); return () => {}; }
  read(addr: number): number {
    switch (addr) {
      case 5000: return 6000; // gSaveBlock1Ptr
      case 6000: return this.camera.x & 0xffff; // ->pos
      case 6002: return this.camera.y & 0xffff;
      case 6004: return this.map.group; // ->location
      case 6005: return this.map.num;
      case 7016: return this.camera.subX >>> 0; // gFieldCamera.x
      case 7020: return this.camera.subY >>> 0;
      case 8000: return this.map.group; // gBrOwnPos
      case 8001: return this.map.num;
      case 8002: return this.own.x;
      case 8004: return this.own.y;
      case 8006: return this.own.dir;
      case 9000: return 1; // gObjectEvents[0]: active ...
      case 9002: return 1; // ... and the player
      case 9011: return this.elevation;
      default: return 0; // gMain.inBattle among them: not in a battle
    }
  }
  frame() {
    for (const l of this.listeners) l();
  }
}

function fieldLayer(emu: FieldEmu) {
  const canvas = { addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 160 }) } as unknown as HTMLCanvasElement;
  const symbols = new Map([['gMain', 0], ['gSaveBlock1Ptr', 5000], ['gFieldCamera', 7000], ['gBrOwnPos', 8000], ['gObjectEvents', 9000]]);
  const t = new TouchLayer({ emu: emu as never, canvas, symbols });
  t.attach();
  return (x: number, y: number) => (t as unknown as { tap(x: number, y: number): void }).tap(x, y);
}

describe('a tap in the field is the tile the picture shows there (POK-330 #34)', () => {
  it('y 74 is our own tile: the pos tile is 72..87 down the picture, not 80..95', () => {
    const emu = new FieldEmu();
    const tap = fieldLayer(emu);
    tap(120, 74);
    for (let i = 0; i < 10; i++) emu.frame();
    expect(emu.pressed, 'nothing to walk to').toEqual([]);
  });

  it('y 90 is the tile south of us, and a walk there starts', () => {
    const emu = new FieldEmu();
    const tap = fieldLayer(emu);
    tap(120, 90);
    emu.frame();
    expect(emu.pressed).toEqual(['down']);
  });

  it('mid-step the pixel is on the tile the picture is still showing', () => {
    // A step south, four pixels in: the pos (and our own tile) is already 11, and the
    // picture is 12 px short of it. y 97 was the tile south of the one we stand on at
    // rest; here it is the one we are stepping onto.
    const emu = new FieldEmu();
    emu.camera = { x: 10, y: 11, subX: 0, subY: 4 };
    emu.own = { x: 17, y: 18, dir: 1 };
    const tap = fieldLayer(emu);
    tap(120, 97);
    for (let i = 0; i < 10; i++) emu.frame();
    expect(emu.pressed).toEqual([]);

    const atRest = new FieldEmu();
    fieldLayer(atRest)(120, 97);
    atRest.frame();
    expect(atRest.pressed).toEqual(['down']);
  });

  it("the picture on screen is last frame's camera, and a tap is on what it shows", () => {
    const emu = new FieldEmu();
    const tap = fieldLayer(emu);
    emu.frame();
    emu.frame(); // at rest, and on screen
    // The step south starts: the struct moves this frame, the picture next frame.
    emu.camera = { x: 10, y: 11, subX: 0, subY: 4 };
    emu.own = { x: 17, y: 18, dir: 1 };
    emu.frame();
    // On the picture still up, y 101 is tile 11 -- the one we are stepping onto. The
    // struct's camera would put it on 12, a tile past us.
    tap(120, 101);
    for (let i = 0; i < 10; i++) emu.frame();
    expect(emu.pressed).toEqual([]);
  });
});

describe('a tap on a bridge walks at the level we stand at (POK-331 #2 review)', () => {
  // Route 110 (26, 15): the cycling road runs north-south over it at height 4, the path
  // east-west under it at 3. The tile west of us is the path's: a step from the path,
  // and from the road a cliff face the ROM refuses -- the road goes round.
  function tapWest(elevation: number): GbaKey[] {
    const emu = new FieldEmu();
    emu.map = { group: 0, num: 25 }; // MAP_ROUTE110
    emu.camera = { x: 26, y: 15, subX: 0, subY: 0 };
    emu.own = { x: 26 + 7, y: 15 + 7, dir: 1 };
    emu.elevation = elevation;
    fieldLayer(emu)(104, 80);
    emu.frame();
    return emu.pressed;
  }

  it('on the road, round by the road', () => {
    expect(tapWest(4)).toEqual(['up']);
  });

  it('on the path, straight there', () => {
    expect(tapWest(3)).toEqual(['left']);
  });
});

// ---- a button for a start-menu row, against a fake ROM -------------------------------
//
// The rows the ROM built (POKeMON, BAG, MAP, the card, EXIT), a cursor that remembers
// where it was last left and wraps, and a handler that takes keys only once its task has
// drawn the menu. gBrStartMenu is a const table in the ROM, so the page reads it there.

class StartEmu {
  held = 0;
  open = false;
  ready = 0;
  cursor = 3;
  rows = [1, 2, 13, 4, 7];
  chosen: number | null = null;
  closed = false;
  /** The handler left in gMenuCallback from the last time the menu was up. */
  stale = false;
  /** The player's own registered item. */
  registered = 0;
  written = new Map<number, number>();
  private listeners: (() => void)[] = [];
  private wasDown = 0;
  press(k: GbaKey) { this.held |= 1 << KEY_BIT[k]; }
  release(k: GbaKey) { this.held &= ~(1 << KEY_BIT[k]); }
  keys() { return this.held; }
  onFrame(l: () => void) { this.listeners.push(l); return () => {}; }
  write(addr: number, v: number) { this.written.set(addr, v); }
  read(addr: number): number {
    switch (addr) {
      case 0x5000: return (this.open && this.ready <= 0) || this.stale ? 0x08001001 : 0x08002001; // gMenuCallback
      case 0x6000: return this.cursor;
      case 0x6001: return this.rows.length;
      case 0x7000: return 0x9000; // gSaveBlock1Ptr
      case 0x9000 + 0x496: return this.written.get(addr) ?? this.registered; // registeredItem
    }
    if (addr >= 0x6010 && addr < 0x6010 + this.rows.length) return this.rows[addr - 0x6010];
    return 0;
  }
  frame() {
    for (const l of this.listeners) l();
    const fresh = this.held & ~this.wasDown;
    this.wasDown = this.held;
    if (!this.open) {
      if (fresh & (1 << KEY_BIT.start)) { this.open = true; this.ready = 8; }
      return;
    }
    if (this.ready-- > 0) return;
    const n = this.rows.length;
    if (fresh & (1 << KEY_BIT.down)) this.cursor = (this.cursor + 1) % n;
    if (fresh & (1 << KEY_BIT.up)) this.cursor = (this.cursor + n - 1) % n;
    if (fresh & (1 << KEY_BIT.a)) { this.chosen = this.rows[this.cursor]; this.open = false; }
    if (fresh & (1 << KEY_BIT.b)) { this.closed = true; this.open = false; }
  }
}

function startLayer(emu: StartEmu) {
  const canvas = { addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 160 }) } as unknown as HTMLCanvasElement;
  // gBrStartMenu at 0x08000010: cursor, count, rows, the handler.
  const rom = new Uint8Array(0x20);
  const view = new DataView(rom.buffer);
  [0x6000, 0x6001, 0x6010, 0x08001001].forEach((v, i) => view.setUint32(0x10 + i * 4, v, true));
  const symbols = new Map([['gMain', 0x100], ['gBrStartMenu', 0x08000010], ['gMenuCallback', 0x5000], ['gSaveBlock1Ptr', 0x7000]]);
  const t = new TouchLayer({ emu: emu as never, canvas, symbols, rom });
  t.attach();
  return t;
}

describe('PARTY and MAP press START and walk the start menu', () => {
  it('reads where the ROM laid the table out', () => {
    const rom = new Uint8Array(0x20);
    new DataView(rom.buffer).setUint32(0x10, 0x0203760e, true);
    expect(startMenuTable(rom, 0x08000010)?.cursor).toBe(0x0203760e);
    expect(startMenuTable(rom, undefined), 'a ROM from before br_menu.h').toBeNull();
    expect(startMenuTable(null, 0x08000010)).toBeNull();
  });

  it('MAP from a cursor left on the card: up one, then A', () => {
    const emu = new StartEmu();
    const t = startLayer(emu);
    t.openStartRow(START_BR_MAP);
    for (let i = 0; i < 90 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(START_BR_MAP);
  });

  it('POKeMON the short way round: from EXIT, down wraps to the top', () => {
    const emu = new StartEmu();
    emu.cursor = 4;
    const t = startLayer(emu);
    t.openStartRow(START_POKEMON);
    let downs = 0;
    for (let i = 0; i < 90 && emu.chosen === null; i++) {
      const before = emu.cursor;
      emu.frame();
      if (emu.cursor === (before + 1) % emu.rows.length && emu.cursor !== before) downs++;
    }
    expect(emu.chosen).toBe(START_POKEMON);
    expect(downs).toBe(1);
  });

  it('no MAP before the fog: the menu is closed again, nothing chosen', () => {
    const emu = new StartEmu();
    emu.rows = [1, 2, 4, 7];
    const t = startLayer(emu);
    t.openStartRow(START_BR_MAP);
    for (let i = 0; i < 90; i++) emu.frame();
    expect(emu.chosen).toBeNull();
    expect(emu.closed).toBe(true);
  });

  it('SELECT with the item registered first', () => {
    const emu = new StartEmu();
    const t = startLayer(emu);
    t.useOnField(259);
    emu.frame();
    expect(emu.held & (1 << KEY_BIT.select)).not.toBe(0);
    expect(emu.written.get(0x9000 + 0x496)).toBe(259);
    // ...and after it, the player's own registered item is theirs again
    for (let i = 0; i < 30; i++) emu.frame();
    expect(emu.written.get(0x9000 + 0x496)).toBe(0);
  });

  it("two dock presses close together: the player's item still comes back", () => {
    const emu = new StartEmu();
    emu.registered = 7;
    const t = startLayer(emu);
    t.useOnField(259);
    for (let i = 0; i < 8; i++) emu.frame();
    t.useOnField(259);
    for (let i = 0; i < 60; i++) emu.frame();
    expect(emu.written.get(0x9000 + 0x496)).toBe(7);
  });

  it('BIKE with the stick held: SELECT waits for the stick, and the item still comes back', () => {
    const emu = new StartEmu();
    emu.registered = 7;
    const t = startLayer(emu);
    emu.press('left'); // the player's thumb
    t.useOnField(259);
    for (let i = 0; i < 30; i++) emu.frame();
    expect(emu.held & (1 << KEY_BIT.select)).toBe(0);
    expect(emu.written.get(0x9000 + 0x496)).toBeUndefined();
    emu.release('left');
    let selected = false;
    for (let i = 0; i < 5; i++) { emu.frame(); if (emu.held & (1 << KEY_BIT.select)) selected = true; }
    expect(selected).toBe(true);
    // the player walks on straight away: the item comes back regardless
    emu.press('left');
    for (let i = 0; i < 30; i++) emu.frame();
    expect(emu.written.get(0x9000 + 0x496)).toBe(7);
  });

  it('PARTY with the stick held too long: dropped, nothing pressed', () => {
    const emu = new StartEmu();
    const t = startLayer(emu);
    emu.press('up');
    t.openStartRow(START_BR_MAP);
    for (let i = 0; i < 150; i++) emu.frame();
    emu.release('up');
    for (let i = 0; i < 60; i++) emu.frame();
    expect(emu.open).toBe(false);
    expect(emu.chosen).toBeNull();
  });

  it('PARTY with the stick held a moment: START once it is let go', () => {
    const emu = new StartEmu();
    emu.cursor = 2;
    const t = startLayer(emu);
    emu.press('up');
    t.openStartRow(START_BR_MAP);
    for (let i = 0; i < 20; i++) emu.frame();
    emu.release('up');
    for (let i = 0; i < 90 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(START_BR_MAP);
  });

  it("a handler left over from the last menu: it waits out the menu's drawing", () => {
    const emu = new StartEmu();
    emu.stale = true;
    emu.cursor = 2; // already on MAP: the first thing pressed is A
    const t = startLayer(emu);
    t.openStartRow(START_BR_MAP);
    for (let i = 0; i < 90 && emu.chosen === null; i++) emu.frame();
    expect(emu.chosen).toBe(START_BR_MAP);
  });
});
