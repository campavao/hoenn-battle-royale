// The in-match sheet (POK-320): what the page's HTML drawer was, drawn. Over the game on
// a phone, beside it on a desktop, and with the drawer's ids in its mirror.
import { describe, expect, it, vi } from 'vitest';
import { cycleWatch, watchStepKey, sheetScreen, sheetSeats, type RoomSeat, type SheetModel } from './screens';
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
    strip: 'SAFE: PETALBURG · 5 left · 0:42',
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
    onFeedback: vi.fn(),
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

describe('watchStepKey', () => {
  it('turns left and right into PREV and NEXT while out and following somebody', () => {
    expect(watchStepKey('right', true, 4, true)).toBe(1);
    expect(watchStepKey('left', true, 4, true)).toBe(-1);
    expect(watchStepKey('up', true, 4, true), 'up and down stay the game\'s').toBeNull();
    expect(watchStepKey('a', true, 4, true)).toBeNull();
    expect(watchStepKey('right', false, 4, true), 'still in the match: we walk').toBeNull();
    expect(watchStepKey('right', true, null, true), 'out, following nobody: we walk').toBeNull();
    expect(watchStepKey('right', true, 4, false), 'a menu or the summary screen keeps its D-pad').toBeNull();
  });
});

describe('the sheet', () => {
  // 10-20 play-test #22 (HBR-55): the seats jumped ~40 px as the legendary's line came
  // and went. Once the chips' box has had a row, it keeps it.
  it('keeps the seats where they were when a chip goes', () => {
    let m = model({ chips: ['WATTSON has the legendary'] });
    const screen = sheetScreen(() => m);
    const seatY = () => screen.paint(fakeCanvas().canvas, 480).widgets.filter((w) => w.parent === 'match-roster')[0].rect.y;
    const withChip = seatY();
    m = model({ chips: [] });
    expect(seatY()).toBe(withChip);
    m = model({ chips: ['WATTSON has the legendary'] });
    expect(seatY()).toBe(withChip);
  });

  it("keeps the drawer's ids: the room's line, the strip, the seats, LEAVE and the settings", () => {
    const { painted, byId } = paint(model());
    const containers = (painted.containers ?? []).map((c) => c.id);
    expect(containers).toEqual(expect.arrayContaining(['drawer', 'match-roster', 'match-card', 'room-note', 'spectate-strip', 'settings']));
    expect(byId('room-code')?.text).toBe('Room ABCDEF');
    expect(byId('match-strip')?.text).toMatch(/SAFE: PETALBURG/);
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

  it('LEAVE asks first: STAY puts it back, LEAVE again goes (POK-382)', () => {
    const first = model();
    paint(first).byId('match-leave')!.onPress!();
    expect(first.onLeave).toHaveBeenCalled();
    const asking = model({ leaveAsk: true, onStay: vi.fn(), onLeaveSure: vi.fn() });
    const { byId, painted } = paint(asking);
    expect(byId('match-leave'), 'the first LEAVE gives way to the question').toBeUndefined();
    expect(painted.widgets.find((w) => w.text === 'Leave the match?')).toBeDefined();
    byId('match-stay')!.onPress!();
    expect(asking.onStay).toHaveBeenCalled();
    byId('match-leave-sure')!.onPress!();
    expect(asking.onLeaveSure).toHaveBeenCalled();
  });

  it('LEAVE goes when canLeave is false', () => {
    expect(paint(model({ canLeave: false })).byId('match-leave')).toBeUndefined();
  });

  it("opens a trainer's card on a tap, with KICK for the host", () => {
    const m = model({ card: { seat: 2, skin: 4, lines: [{ label: 'TRAINER', value: 'P2' }], canKick: true } });
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

  it('offers SPECTATE on the card of somebody you could follow, and not otherwise (POK-342)', () => {
    const onWatchSeat = vi.fn();
    const card = { seat: 5, skin: 4, lines: [{ label: 'TRAINER', value: 'MAY' }], canKick: false };
    const watch = paint(model({ card: { ...card, canWatch: true }, onWatchSeat })).painted.widgets.find((w) => w.cls === 'card-watch');
    expect(watch?.text).toBe('SPECTATE');
    watch!.onPress!();
    expect(onWatchSeat).toHaveBeenCalledWith(5);
    expect(paint(model({ card, onWatchSeat })).painted.widgets.find((w) => w.cls === 'card-watch')).toBeUndefined();
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
