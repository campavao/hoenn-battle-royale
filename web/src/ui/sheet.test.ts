// The in-match sheet (POK-320): what the page's HTML drawer was, drawn. Over the game on
// a phone, beside it on a desktop, and with the drawer's ids in its mirror.
import { describe, expect, it, vi } from 'vitest';
import { cycleWatch, sheetScreen, sheetSeats, type RoomSeat, type SheetModel } from './screens';
import { fakeCanvas } from './fakecanvas';

const seat = (n: number, over: Partial<RoomSeat> = {}): RoomSeat => ({
  seat: n,
  name: `P${n}`,
  skin: 0,
  isMe: false,
  spectating: false,
  alive: true,
  ...over,
});

function model(over: Partial<SheetModel> = {}): SheetModel {
  return {
    look: 'overlay',
    status: 'Room ABCDEF',
    strip: 'RING 2 (PETALBURG) · 5 left · 0:42',
    note: '',
    seats: [seat(1, { isMe: true }), seat(2), seat(3, { alive: false })],
    card: null,
    watch: null,
    canLeave: true,
    muted: false,
    remapping: false,
    remapLine: '',
    help: ['Tap the map to walk there,', 'or tap a move to use it.'],
    version: 'rom abc1234',
    onSeat: vi.fn(),
    onKick: vi.fn(),
    onCloseCard: vi.fn(),
    onWatch: vi.fn(),
    onStopWatch: vi.fn(),
    onLeave: vi.fn(),
    onClose: vi.fn(),
    onMute: vi.fn(),
    onRemap: vi.fn(),
    onResetPad: vi.fn(),
    onForget: vi.fn(),
    ...over,
  };
}

function paint(m: SheetModel, h = 480) {
  const { canvas, fills } = fakeCanvas();
  const painted = sheetScreen(() => m).paint(canvas, h);
  const byId = (id: string) => painted.widgets.find((w) => w.id === id);
  return { painted, byId, fills };
}

describe('the seats the sheet has room for', () => {
  it('puts you first, then who is still in, and counts the rest when they do not fit', () => {
    const all = [seat(1), seat(2, { alive: false }), seat(3, { isMe: true }), seat(4), seat(5)];
    expect(sheetSeats(all, 8).shown.map((s) => s.seat)).toEqual([3, 1, 4, 5, 2]);
    const tight = sheetSeats(all, 4);
    expect(tight.shown.map((s) => s.seat)).toEqual([3, 1, 4]);
    expect(tight.more).toBe(2);
  });
});

describe('WATCH, once you are out', () => {
  it('steps round the living from whoever it is on, and starts at an end', () => {
    expect(cycleWatch([4, 7, 9], null, 1)).toBe(4);
    expect(cycleWatch([4, 7, 9], null, -1)).toBe(9);
    expect(cycleWatch([4, 7, 9], 9, 1)).toBe(4);
    expect(cycleWatch([4, 7, 9], 4, -1)).toBe(9);
    expect(cycleWatch([4, 7, 9], 5, 1), 'the one watched has gone out').toBe(4);
    expect(cycleWatch([], 4, 1)).toBeNull();
  });
});

describe('the sheet', () => {
  it("keeps the drawer's ids: the room's line, the strip, the seats, LEAVE and the settings", () => {
    const { painted, byId } = paint(model());
    const containers = (painted.containers ?? []).map((c) => c.id);
    expect(containers).toEqual(expect.arrayContaining(['drawer', 'match-roster', 'match-card', 'room-note', 'spectate-strip', 'settings']));
    expect(byId('room-code')?.text).toBe('Room ABCDEF');
    expect(byId('match-strip')?.text).toMatch(/RING 2/);
    for (const id of ['match-leave', 'drawer-close', 'mute', 'remap', 'remap-reset', 'forget-rom']) expect(byId(id), id).toBeDefined();
    const seats = painted.widgets.filter((w) => w.parent === 'match-roster');
    expect(seats.map((w) => w.text)).toEqual(['P1 (you)', 'P2', 'P3 -- OUT']);
  });

  it('over the game on a phone: dimmed under it, BACK TO GAME, and B puts it away', () => {
    const m = model();
    const { byId, fills } = paint(m);
    expect(fills[0].alpha).toBeGreaterThan(0);
    byId('drawer-close')!.onPress!();
    expect(m.onClose).toHaveBeenCalledTimes(1);
    sheetScreen(() => m).back!();
    expect(m.onClose).toHaveBeenCalledTimes(2);
  });

  it('beside the game on a desktop: no dimming, nothing to go back to, and it fits the short window', () => {
    const m = model({ look: 'dock', help: ['Arrows move  Z: A  X: B  A: L  S: R', 'Enter: START  Shift: SELECT  pads too'] });
    expect(sheetScreen(() => m).look!()).toBe('dock');
    const { painted, byId, fills } = paint(m, 360);
    expect(fills.filter((f) => f.color === '#000')).toEqual([]);
    expect(byId('drawer-close')).toBeUndefined();
    for (const w of painted.widgets) expect(w.rect.y + w.rect.h, w.text).toBeLessThanOrEqual(360);
  });

  it('takes as many rows of seats as there are seats, and no more than there is room for', () => {
    const rows = (m: SheetModel, h: number) => {
      const { painted } = paint(m, h);
      const cells = painted.widgets.filter((w) => w.parent === 'match-roster').map((w) => w.rect.y);
      return new Set(cells).size;
    };
    expect(rows(model(), 480), 'three seats, one row').toBe(1);
    const thirty = Array.from({ length: 30 }, (_, i) => seat(i + 1, { isMe: i === 0 }));
    expect(rows(model({ seats: thirty }), 480)).toBe(4);
    const { painted } = paint(model({ seats: thirty }), 480);
    expect(painted.widgets.find((w) => w.text === '15 more'), 'the rest, counted in the last cell').toBeDefined();
  });

  it('LEAVE goes when canLeave is false', () => {
    expect(paint(model({ canLeave: false })).byId('match-leave')).toBeUndefined();
  });

  it("opens a trainer's card on a tap, with KICK for the host", () => {
    const m = model({ card: { seat: 2, lines: [{ label: 'TRAINER', value: 'P2' }], canKick: true } });
    const { painted } = paint(m);
    painted.widgets.find((w) => w.text === 'P2')!.onPress!();
    expect(m.onSeat).toHaveBeenCalledWith(2);
    const kick = painted.widgets.find((w) => w.cls === 'card-kick');
    expect(kick?.parent).toBe('match-card');
    kick!.onPress!();
    expect(m.onKick).toHaveBeenCalledWith(2);
    // B closes the card before the sheet.
    sheetScreen(() => m).back!();
    expect(m.onCloseCard).toHaveBeenCalled();
    expect(m.onClose).not.toHaveBeenCalled();
  });

  it('once you are out, says who you watch, with PREV, NEXT and STOP', () => {
    const m = model({ watch: { name: 'MAY' } });
    const { byId } = paint(m);
    expect(byId('spectate-name')?.text).toBe('WATCHING MAY');
    byId('spectate-next')!.onPress!();
    byId('spectate-prev')!.onPress!();
    byId('spectate-stop')!.onPress!();
    expect(m.onWatch).toHaveBeenNthCalledWith(1, 1);
    expect(m.onWatch).toHaveBeenNthCalledWith(2, -1);
    expect(m.onStopWatch).toHaveBeenCalled();
    expect(paint(model({ watch: { name: null } })).byId('spectate-stop'), 'nobody to stop watching').toBeUndefined();
  });

  it('says what the remap wizard wants, and what MUTE would do', () => {
    const { byId } = paint(model({ muted: true, remapping: true, remapLine: 'Press the button for A. Esc cancels.' }));
    expect(byId('mute')?.text).toBe('UNMUTE');
    expect(byId('remap')?.text).toBe('CANCEL REMAP');
    expect(byId('remap-line')?.text).toBe('Press the button for A. Esc cancels.');
  });
});
