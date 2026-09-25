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
import { TouchLayer } from './touch';

class FakeEmu {
  held = 0;
  menu = 0;
  cursor = 0;
  chosen: number | null = null;
  moves = [1, 2, 0, 0];
  private listeners: (() => void)[] = [];
  private wasDown = 0;
  press(k: GbaKey) { this.held |= 1 << KEY_BIT[k]; }
  release(k: GbaKey) { this.held &= ~(1 << KEY_BIT[k]); }
  keys() { return this.held; }
  onFrame(l: () => void) { this.listeners.push(l); return () => {}; }
  read(addr: number, width: 8 | 16 | 32): number {
    if (addr === 0x439) return 0x02; // gMain.inBattle
    if (addr === 1000 + 8) return this.menu; // gBrBattle.menu
    if (addr === 2000 || addr === 3000) return this.cursor;
    if (addr >= 4004 && addr < 4012 && width === 16) return this.moves[(addr - 4004) / 2];
    return 0;
  }
  /** One frame: the page's listener runs, then the "ROM" reads JOY_NEW. */
  frame() {
    for (const l of this.listeners) l();
    const fresh = this.held & ~this.wasDown;
    this.wasDown = this.held;
    if (!this.menu) return;
    if (fresh & (1 << KEY_BIT.right)) this.cursor |= 1;
    if (fresh & (1 << KEY_BIT.left)) this.cursor &= ~1;
    if (fresh & (1 << KEY_BIT.down)) this.cursor |= 2;
    if (fresh & (1 << KEY_BIT.up)) this.cursor &= ~2;
    if (fresh & (1 << KEY_BIT.a)) { this.chosen = this.cursor; this.menu = 0; }
  }
}

function layer(emu: FakeEmu) {
  // No DOM here: the layer only listens on it, and these tests call `tap` directly.
  const canvas = { addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 160 }) } as unknown as HTMLCanvasElement;
  const symbols = new Map([['gMain', 0], ['gBrBattle', 1000], ['gActionSelectionCursor', 2000], ['gMoveSelectionCursor', 3000], ['gBattleBufferA', 4000]]);
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
      case 6004: return 0; // ->location: MAP_LITTLEROOT_TOWN is group 0 ...
      case 6005: return 9; // ... num 9
      case 7016: return this.camera.subX >>> 0; // gFieldCamera.x
      case 7020: return this.camera.subY >>> 0;
      case 8000: return 0; // gBrOwnPos
      case 8001: return 9;
      case 8002: return this.own.x;
      case 8004: return this.own.y;
      case 8006: return this.own.dir;
      default: return 0; // gMain.inBattle among them: not in a battle
    }
  }
  frame() {
    for (const l of this.listeners) l();
  }
}

function fieldLayer(emu: FieldEmu) {
  const canvas = { addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 160 }) } as unknown as HTMLCanvasElement;
  const symbols = new Map([['gMain', 0], ['gSaveBlock1Ptr', 5000], ['gFieldCamera', 7000], ['gBrOwnPos', 8000]]);
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
