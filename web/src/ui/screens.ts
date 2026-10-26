// The screens outside the game, drawn Emerald's way (POK-320): the main menu, the
// lobbies list, the trainer's own rows, MY LOOK, and the room with its 2x4 of
// seats -- Kanto's lobby.lua, in Emerald's font and frames.
//
// Each screen is a function of a model the page keeps: paint reads the model, draws,
// and hands the stage what it drew. The layouts (where a seat is, where a row is) are
// plain functions so ui.test.ts can pin them without a canvas.
import { CARD_BADGES, SKINS, SKIN_UNLOCK_WINS, WARDROBE, cardBadges, cardStars, ordinal, skinUnlocked } from '../match/career';
import { botSeats, botSkin } from '../bots/roster';
import {
  type EmeraldCanvas,
  type Rect,
  TEXT_BLUE,
  TEXT_DARK,
  TEXT_GRAY,
  TEXT_RED,
  TEXT_WHITE,
  type TextColor,
  WINDOW_FILL,
  fitText,
  measure,
  skinSheet,
  wrapText,
} from './emerald';
import type { GbaKey } from '../emu';
import uiData from '../data/ui.json';
import type { Container, DrawnScreen, Painted, Widget } from './stage';

const ITEM_ICON = uiData.itemIcons as { cell: number; cols: number };

export const ROW_H = 16;
export const SEAT_W = 56;
export const SEAT_H = 48;
export const SEAT_COLS = 4;
export const W = 240;

// ---- pieces ---------------------------------------------------------------------------

export function paintTitle(c: EmeraldCanvas, text: string, y: number): void {
  c.drawTextCentred(text, W / 2, y, TEXT_WHITE);
}

export interface RowSpec {
  label: string;
  detail?: string;
  disabled?: boolean;
  id?: string;
  cls?: string;
  onPress?: () => void;
  /** A colour for the label: red for something locked, blue for you. */
  color?: TextColor;
  /** On a tile (the main menu, HBR-30): a bag icon by item id, or people by sheet. */
  art?: { item?: number; gfx?: number[] };
  /** A red NEW on the tile's corner. */
  badge?: boolean;
}

/** Where the rows of a list go: a frame at `y`, one ROW_H row each inside its border. */
export function layoutRows(y: number, count: number): { frame: Rect; rows: Rect[] } {
  const frame = { x: 0, y, w: W, h: Math.max(2, count) * ROW_H + 16 };
  const rows: Rect[] = [];
  for (let i = 0; i < count; i++) rows.push({ x: 8, y: y + 8 + i * ROW_H, w: W - 16, h: ROW_H });
  return { frame, rows };
}

/** A framed list. The label sits after the cursor's slot, the detail is right-aligned
 *  and gives way to the label when the two would meet. */
export function paintRows(c: EmeraldCanvas, y: number, rows: RowSpec[], parent?: string): { widgets: Widget[]; bottom: number } {
  const lay = layoutRows(y, rows.length);
  c.drawFrame(lay.frame);
  const widgets: Widget[] = [];
  rows.forEach((row, i) => {
    const r = lay.rows[i];
    const color = row.disabled ? TEXT_GRAY : (row.color ?? TEXT_DARK);
    const labelW = c.drawText(fitText(row.label, r.w - 8), r.x + 8, r.y, color);
    if (row.detail) {
      const room = r.w - 8 - labelW - 8;
      if (room > 12) {
        const detail = fitText(row.detail, room);
        // Dark, as the label is: the light gray is a shadow colour, and on the window's
        // white it could not be read at all (POK-332). A disabled row stays faint.
        c.drawText(detail, r.x + r.w - measure(detail), r.y, row.disabled ? TEXT_GRAY : TEXT_DARK);
      }
    }
    widgets.push({
      rect: r,
      text: row.detail ? `${row.label} ${row.detail}` : row.label,
      id: row.id,
      cls: row.cls,
      parent,
      disabled: row.disabled,
      onPress: row.onPress,
      cursor: row.onPress ? { x: r.x, y: r.y + 2 } : null,
    });
  });
  return { widgets, bottom: lay.frame.y + lay.frame.h };
}

export interface ButtonSpec {
  label: string;
  id?: string;
  cls?: string;
  disabled?: boolean;
  onPress: () => void;
  parent?: string;
}

/** The width a button takes: its label plus a tile each side, in whole tiles. */
export function buttonWidth(label: string): number {
  return Math.ceil((measure(label) + 16) / 8) * 8;
}

/** A row of buttons centred at `y`, 24 tall, a tile apart. */
export function layoutButtons(y: number, labels: string[]): Rect[] {
  const widths = labels.map(buttonWidth);
  const total = widths.reduce((a, b) => a + b, 0) + 8 * Math.max(0, labels.length - 1);
  let x = Math.floor((W - total) / 2);
  return widths.map((w) => {
    const r = { x, y, w, h: 24 };
    x += w + 8;
    return r;
  });
}

export function paintButtons(c: EmeraldCanvas, y: number, buttons: ButtonSpec[]): Widget[] {
  const rects = layoutButtons(y, buttons.map((b) => b.label));
  return buttons.map((b, i) => {
    const r = rects[i];
    c.drawFrame(r);
    c.drawTextCentred(b.label, r.x + r.w / 2, r.y + 4, b.disabled ? TEXT_GRAY : TEXT_DARK);
    return {
      rect: r,
      text: b.label,
      id: b.id,
      cls: b.cls,
      parent: b.parent,
      disabled: b.disabled,
      onPress: b.onPress,
      cursor: { x: r.x - 8, y: r.y + 6 },
    };
  });
}

/** A line of small text, centred, for a note under a list. */
export function paintNote(c: EmeraldCanvas, text: string, y: number, color = TEXT_GRAY): Rect {
  const r = { x: 0, y, w: W, h: ROW_H };
  if (text) c.drawTextCentred(fitText(text, W - 8), W / 2, y, color);
  return r;
}

/** A person standing in a cell: the sprite centred at the top, the name under it. */
export function paintPerson(c: EmeraldCanvas, cell: Rect, skin: number, name: string, alpha = 1, color = TEXT_DARK): void {
  const sheet = skinSheet(skin);
  if (sheet) c.drawSprite(sheet.gfx, cell.x + Math.floor((cell.w - sheet.w) / 2), cell.y + 2, alpha);
  const label = fitText(name, cell.w - 2);
  c.drawText(label, cell.x + Math.floor((cell.w - measure(label)) / 2), cell.y + 33, alpha < 1 ? TEXT_GRAY : color);
}

// ---- the seats ------------------------------------------------------------------------

/** Kanto's 2x4 (more rows for a bigger MAX): a frame at `y`, one SEAT_W x SEAT_H cell
 *  per seat inside it, row-major. */
export function layoutSeats(y: number, max: number): { frame: Rect; cells: Rect[] } {
  const rows = Math.max(1, Math.ceil(max / SEAT_COLS));
  const frame = { x: 0, y, w: W, h: rows * SEAT_H + 16 };
  const cells: Rect[] = [];
  for (let i = 0; i < max; i++) {
    cells.push({
      x: 8 + (i % SEAT_COLS) * SEAT_W,
      y: y + 8 + Math.floor(i / SEAT_COLS) * SEAT_H,
      w: SEAT_W,
      h: SEAT_H,
    });
  }
  return { frame, cells };
}

export interface RoomSeat {
  seat: number;
  name: string;
  skin: number;
  isMe: boolean;
  spectating: boolean;
  alive: boolean;
}

export interface CardLine {
  label: string;
  value: string;
}

/** A trainer's card: their sprite, their lines, and what the viewer may do about them --
 *  KICK for the host (POK-241), SPECTATE for somebody out who could follow them
 *  (POK-342). */
export interface TrainerCard {
  seat: number;
  skin: number;
  lines: CardLine[];
  canKick: boolean;
  canWatch?: boolean;
}

export interface RoomModel {
  /** The line at the top: `Room ABCDEF`, or what is happening instead. */
  status: string;
  /** The line under the seats: what START would make, or who we wait for. */
  note: string;
  seats: RoomSeat[];
  max: number;
  /** Bots the host would deal at START, shown in the seats they would take. */
  fill: number;
  isHost: boolean;
  started: boolean;
  canStart: boolean;
  /** START, or READY UP when a press arms the room's count instead (match/room.ts). */
  startLabel: string;
  /** Seconds until the room starts itself (quick play, the daily), or null. */
  countdown: number | null;
  /** The host's controls, in the order they are shown; null for a guest. */
  options: OptionSpec[] | null;
  card: TrainerCard | null;
  onStart(): void;
  onLeave(): void;
  onSeat(seat: number): void;
  onKick(seat: number): void;
  onCloseCard(): void;
  /** Any key or tap on the room: the count to its own start begins again. */
  onTouched?(): void;
}

/** What the room screen puts under its seats: the note, the host's options, and the
 *  START/LEAVE row. Mirrors paintNote, paintOptions and paintButtons' heights; the
 *  POK-375 test in ui.test.ts paints the room and fails if they drift apart. */
function roomBelow(m: RoomModel): number {
  const options = m.options && !m.started ? Math.ceil(m.options.length / OPTION_COLS) * 20 + 16 + 4 : 0;
  return 2 + ROW_H + 2 + options + (m.started ? 0 : 28);
}

/** Rows of seats for the room: one per four seats MAX (or the people in it) asks for,
 *  four at most, and no more than leaves the rest whole on an `h` tall screen. */
export function roomSeatRows(m: RoomModel, h: number, y: number): number {
  const wanted = Math.ceil(Math.max(Math.min(m.max, 4 * SEAT_COLS), m.seats.length) / SEAT_COLS);
  const room = Math.floor((h - y - 16 - roomBelow(m)) / SEAT_H);
  return Math.max(1, Math.min(4, wanted, room));
}

/** The people on one page of the room's seats: all of them when they fit, otherwise
 *  `cells - 1` at a time in the room's own order, the last cell a +N that turns to the
 *  next page (wrapping round), so the host can still reach anybody's card and KICK. */
export function roomPage(seats: readonly RoomSeat[], cells: number, page: number): { shown: readonly RoomSeat[]; more: number } {
  if (seats.length <= cells) return { shown: seats, more: 0 };
  const per = Math.max(1, cells - 1);
  const start = (page % Math.ceil(seats.length / per)) * per;
  const shown = seats.slice(start, start + per);
  return { shown, more: seats.length - shown.length };
}

/** The room, Kanto's lobby: code on top, the seats, the note, the host's options,
 *  START (the host's) and LEAVE. A trainer's card opens over the seats. */
export function roomScreen(model: () => RoomModel): DrawnScreen {
  /** Which page of the seats is showing, when the room has more people than cells. */
  let page = 0;
  return {
    touched() {
      model().onTouched?.();
    },
    back() {
      const m = model();
      if (m.card) m.onCloseCard();
      // Not B for the host: a stray B would hand the room to a guest. LEAVE is theirs.
      else if (!m.isHost) m.onLeave();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const containers: Painted['containers'] = [
        { id: 'room-roster', tag: 'ul', cls: 'room-roster' },
        { id: 'room-note', cls: 'room-note' },
        { id: 'room-controls', cls: 'room-controls', hidden: !m.options || m.started },
        { id: 'trainer-card', cls: 'trainer-card', hidden: !m.card },
      ];
      let y = 4;
      paintTitle(c, fitText(m.status, W - 8), y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.status, id: 'room-code', cls: 'room-status', cursor: null });
      y += 20;

      // As many rows of seats as MAX wants and the screen has room for under them: MAX
      // reaches 30 (POK-330 #29), and a fourth row put START on the SAFARI row of a
      // 720 px phone (POK-375). Empty and bot cells go first; the note says how many
      // bots the rest are, and a room with more people than cells says +N.
      const lay = layoutSeats(y, roomSeatRows(m, h, y) * SEAT_COLS);
      c.drawFrame(lay.frame);
      const { shown: seated, more } = roomPage(m.seats, lay.cells.length, page);
      const taken = seated.length;
      // The bots to come, in the clothes they will be dealt (bots/roster.ts botSkin).
      const botsToCome = botSeats(m.fill, m.seats.map((who) => who.seat));
      lay.cells.forEach((cell, i) => {
        const who = seated[i];
        if (more > 0 && i === taken) {
          c.drawTextCentred(`+${more}`, cell.x + cell.w / 2, cell.y + 16, TEXT_GRAY);
          widgets.push({ rect: cell, text: `${more} more`, cls: 'room-more', onPress: () => void page++, cursor: { x: cell.x + 2, y: cell.y + 10 } });
        } else if (who) {
          const alpha = who.spectating ? 0.5 : 1;
          const name = who.alive ? who.name : 'OUT';
          paintPerson(c, cell, who.skin, name, alpha, who.isMe ? TEXT_BLUE : TEXT_DARK);
          widgets.push({
            rect: cell,
            text: `${who.name}${who.isMe ? ' (you)' : ''}${who.alive ? '' : ' -- OUT'}${who.spectating ? ' (watching)' : ''}`,
            cls: 'roster-name',
            parent: 'room-roster',
            onPress: () => m.onSeat(who.seat),
            cursor: { x: cell.x + 2, y: cell.y + 10 },
          });
        } else if (more === 0 && i - taken < m.fill && !m.started) {
          paintPerson(c, cell, botSkin(botsToCome[i - taken] ?? 0), 'BOT', 0.45);
        } else {
          paintPerson(c, cell, i % 2, '- - -', 0.25);
        }
      });
      y = lay.frame.y + lay.frame.h + 2;

      const noteText = m.countdown !== null && !m.started ? `STARTS IN ${m.countdown}` : m.note;
      const noteRect = paintNote(c, noteText, y, m.countdown !== null ? TEXT_WHITE : TEXT_GRAY);
      widgets.push({ rect: noteRect, text: noteText, parent: 'room-note', cursor: null });
      y += ROW_H + 2;

      if (m.options && !m.started) {
        const opts = paintOptions(c, y, m.options, 'room-controls');
        widgets.push(...opts.widgets);
        y = opts.bottom + 4;
      }

      if (!m.started) {
        // LEAVE for the host too (2026-10-07 play-test: every screen has a way back to the
        // menu): the relay hands the room to a guest, or closes it with nobody in it.
        const buttons: ButtonSpec[] = m.isHost
          ? [{ label: m.startLabel, id: 'room-start', disabled: !m.canStart, onPress: m.onStart }]
          : [];
        buttons.push({ label: 'LEAVE', id: 'room-leave', cls: 'room-leave', onPress: m.onLeave });
        widgets.push(...paintButtons(c, Math.min(y, h - 28), buttons));
      }

      if (m.card) {
        return {
          widgets: [...paintCard(c, h, lay.frame.y + 8, m.card, 'trainer-card', { onKick: m.onKick, onClose: m.onCloseCard }), ...underCard(widgets)],
          containers,
        };
      }
      return { widgets, containers };
    },
  };
}

/** What a control looks like beside its words (Cam's 2026-10-14 play-test, POK-345:
 *  "we can also make it more visual"). The words stay, since they are what the control
 *  says when pressed; the picture is the reading at a glance. MAX has none: its seat bar
 *  read as an odd icon (Cam's 2026-10-19 play-test, "I don't think this makes any
 *  sense"), and the seats above it already show who MAX makes room for.
 *  - `toggle`: a switch, on or off.
 *  - `level`: rising bars, `at` of `of` lit: TEXT's pace, or a timer's length, with a
 *    clock in front of a timer's words. */
export type OptionVisual =
  | { kind: 'toggle'; on: boolean }
  | { kind: 'level'; at: number; of: number; clock?: boolean };

export interface OptionSpec {
  label: string;
  id: string;
  onPress: () => void;
  visual?: OptionVisual;
}

const TOGGLE_W = 15;
const LEVEL_STEP = 4;
const CLOCK_W = 7;

/** How wide a control's picture is, in the font's pixels. */
export function visualWidth(v: OptionVisual): number {
  if (v.kind === 'toggle') return TOGGLE_W;
  return v.of * LEVEL_STEP - 1;
}

/** Where a control's pieces go in a text run `w` wide from `x`: the clock, the words,
 *  and the picture against the right edge. The words get what is left, cut to fit. */
export function optionLayout(
  label: string,
  visual: OptionVisual | undefined,
  x: number,
  w: number,
): { clockX: number | null; textX: number; text: string; visualX: number | null } {
  const clock = visual?.kind === 'level' && visual.clock === true;
  const textX = clock ? x + CLOCK_W + 3 : x;
  if (!visual) return { clockX: null, textX, text: fitText(label, w), visualX: null };
  const vw = visualWidth(visual);
  const visualX = x + w - vw;
  return { clockX: clock ? x : null, textX, text: fitText(label, visualX - 4 - textX), visualX };
}

/** A switch: the knob right on blue for on, left on gray for off. */
function paintToggle(c: EmeraldCanvas, x: number, y: number, on: boolean): void {
  const top = y + 4;
  c.fillRect({ x, y: top, w: TOGGLE_W, h: 7 }, on ? TEXT_BLUE.fg : TEXT_GRAY.fg);
  c.fillRect({ x: x + (on ? TOGGLE_W - 6 : 1), y: top + 1, w: 5, h: 5 }, WINDOW_FILL);
}

/** Bars rising left to right, the first `at` lit. */
function paintLevel(c: EmeraldCanvas, x: number, y: number, at: number, of: number): void {
  const base = y + 11;
  for (let i = 0; i < of; i++) {
    const h = 3 + Math.round((i * 5) / Math.max(1, of - 1));
    c.fillRect({ x: x + i * LEVEL_STEP, y: base - h, w: LEVEL_STEP - 1, h }, i < at ? TEXT_BLUE.fg : TEXT_GRAY.fg);
  }
}

/** A 7x7 clock face at three o'clock, a pixel at a time. */
const CLOCK = ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'];

function paintClock(c: EmeraldCanvas, x: number, y: number): void {
  CLOCK.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === '#') c.fillRect({ x: x + dx, y: y + 4 + dy, w: 1, h: 1 }, TEXT_DARK.fg);
    }
  });
}

const OPTION_COLS = 2;

/** Where control `i` of a box at `y` goes: two columns, the cursor at its left edge and
 *  its words 8 in from that. */
export function optionRect(y: number, i: number): Rect {
  const cw = Math.floor((W - 16) / OPTION_COLS);
  return { x: 8 + (i % OPTION_COLS) * cw + 8, y: y + 8 + Math.floor(i / OPTION_COLS) * 20 + 2, w: cw - 8, h: ROW_H };
}

/** Two columns of small framed controls at `y` -- the host's options, the sheet's
 *  settings -- each in the container `parent`. */
export function paintOptions(
  c: EmeraldCanvas,
  y: number,
  options: OptionSpec[],
  parent: string,
): { widgets: Widget[]; bottom: number } {
  const rows = Math.ceil(options.length / OPTION_COLS);
  const frame = { x: 0, y, w: W, h: rows * 20 + 16 };
  c.drawFrame(frame);
  const widgets = options.map((o, i): Widget => {
    const r = optionRect(y, i);
    const lay = optionLayout(o.label, o.visual, r.x + 8, r.w - 10);
    if (lay.clockX !== null) paintClock(c, lay.clockX, r.y);
    c.drawText(lay.text, lay.textX, r.y, TEXT_DARK);
    if (o.visual && lay.visualX !== null) {
      const v = o.visual;
      if (v.kind === 'toggle') paintToggle(c, lay.visualX, r.y, v.on);
      else paintLevel(c, lay.visualX, r.y, v.at, v.of);
    }
    return { rect: r, text: o.label, id: o.id, parent, onPress: o.onPress, cursor: { x: r.x, y: r.y + 2 } };
  });
  return { widgets, bottom: frame.y + frame.h };
}

/** How big the card draws its trainer: the overworld sheet at twice its size, the
 *  closest thing to a portrait the room has (Cam's 2026-10-14 play-test, POK-343: "can
 *  we just show the hiker here"). */
const CARD_SPRITE_SCALE = 2;

/** A trainer's card over the seats, the screen dimmed under it: their sprite beside their
 *  lines, then SPECTATE for somebody out who could follow them, KICK for the host
 *  (POK-241), CLOSE. `parent` is its container: #trainer-card in the room, #match-card
 *  in a match. */
export function paintCard(
  c: EmeraldCanvas,
  h: number,
  y: number,
  card: TrainerCard,
  parent: string,
  on: { onKick: (seat: number) => void; onWatch?: (seat: number) => void; onClose: () => void },
): Widget[] {
  const widgets: Widget[] = [];
  const lines = card.lines;
  const sheet = skinSheet(card.skin);
  const art = sheet ? { w: sheet.w * CARD_SPRITE_SCALE, h: sheet.h * CARD_SPRITE_SCALE } : { w: 0, h: 0 };
  const body = Math.max(art.h, lines.length * ROW_H);
  const box = { x: 16, y, w: W - 32, h: body + 16 + 28 };
  c.fillRect({ x: 0, y: 0, w: W, h }, '#000', 0.35);
  c.drawFrame(box);
  if (sheet) c.drawSprite(sheet.gfx, box.x + 8, box.y + 8, 1, 0, CARD_SPRITE_SCALE);
  const textX = box.x + 8 + (art.w ? art.w + 8 : 0);
  const textY = box.y + 8 + Math.floor((body - lines.length * ROW_H) / 2);
  lines.forEach((line, i) => {
    const text = line.label ? `${line.label}: ${line.value}` : line.value;
    const r = { x: textX, y: textY + i * ROW_H, w: box.x + box.w - 8 - textX, h: ROW_H };
    c.drawText(fitText(text, r.w), r.x, r.y, line.label ? TEXT_DARK : TEXT_BLUE);
    widgets.push({ rect: r, text, cls: 'card-line', parent, cursor: null });
  });
  const buttons: ButtonSpec[] = [];
  if (card.canWatch && on.onWatch) {
    const watch = on.onWatch;
    buttons.push({ label: 'SPECTATE', cls: 'card-watch', parent, onPress: () => watch(card.seat) });
  }
  if (card.canKick) buttons.push({ label: 'KICK', cls: 'card-kick', parent, onPress: () => on.onKick(card.seat) });
  buttons.push({ label: 'CLOSE', cls: 'card-close', parent, onPress: on.onClose });
  // CLOSE first, so it is where the cursor lands: an A pressed out of habit closes the
  // card rather than kicking somebody.
  const pressable = paintButtons(c, box.y + box.h - 28, buttons);
  widgets.push(pressable[pressable.length - 1], ...pressable.slice(0, -1));
  return widgets;
}

/** The card is modal: what is under it is neither the cursor's (it drew over the card
 *  from the seat behind it) nor a tap's -- a seat tapped under the dim swapped the card
 *  (#41's review). CLOSE is the way back to them. */
function underCard(widgets: Widget[]): Widget[] {
  return widgets.map((w) => ({ ...w, cursor: null, disabled: w.onPress ? true : w.disabled }));
}

// ---- the in-match sheet -----------------------------------------------------------------

export interface SheetModel {
  /** Over the game on a phone, with BACK TO GAME; beside it on a desktop, always there. */
  look: 'dock' | 'overlay';
  /** The room's line (Room ABCDEF, Reconnecting…), or SOLO VS BOTS. */
  status: string;
  /** SAFARI / SAFE: PLACE · 8 left · 1:23, while a match is on. */
  strip: string | null;
  /** The chip under it, in the fog's red, one line each (Cam's 2026-10-19 play-test):
   *  where the legendary is or who has it (match/legends.ts), and the lead's HP while
   *  the fog is on us -- which the ROM's corner said, until a desktop took the corner off
   *  the map for sitting on the people round the player. Empty, no chip. */
  chips?: string[];
  note: string;
  seats: RoomSeat[];
  card: TrainerCard | null;
  /** Who you are watching, once you are out; null while you are in the match. */
  watch: { name: string | null } | null;
  canLeave: boolean;
  muted: boolean;
  remapping: boolean;
  /** The remap wizard's question, or what it did. */
  remapLine: string;
  /** The keys (or what a pad is doing) on a desktop; how to tap on a phone. */
  help: string[];
  version: string;
  onSeat(seat: number): void;
  onKick(seat: number): void;
  onCloseCard(): void;
  onWatch(dir: 1 | -1): void;
  /** SPECTATE on a card: follow that seat. */
  onWatchSeat?(seat: number): void;
  onStopWatch(): void;
  onLeave(): void;
  /** After LEAVE, the sheet asks "Leave the match?" with STAY and LEAVE (POK-382). */
  leaveAsk?: boolean;
  onStay?(): void;
  onLeaveSure?(): void;
  onClose(): void;
  onMute(): void;
  onRemap(): void;
  onResetPad(): void;
  onForget(): void;
  /** FEEDBACK: a note to the developers (POK-428). */
  onFeedback(): void;
  /** A phone's see-through D-pad and A/B (ui/padprefs.ts): MOVE PAD to drag and fade
   *  them, HIDE PAD to walk by tapping alone. Absent where there is no touch pad. */
  pad?: { hidden: boolean; onMove(): void; onToggle(): void };
}

/** The sheet's settings, MOVE PAD and HIDE PAD among them on a phone, and FEEDBACK. */
function settingsOf(m: SheetModel): OptionSpec[] {
  const rows = [
    { label: m.muted ? 'UNMUTE' : 'MUTE', id: 'mute', onPress: m.onMute },
    { label: m.remapping ? 'CANCEL REMAP' : 'REMAP PAD', id: 'remap', onPress: m.onRemap },
    { label: 'RESET PAD', id: 'remap-reset', onPress: m.onResetPad },
    { label: 'FORGET ROM', id: 'forget-rom', onPress: m.onForget },
  ];
  if (m.pad) {
    rows.push({ label: 'MOVE PAD', id: 'pad-move', onPress: m.pad.onMove });
    rows.push({ label: m.pad.hidden ? 'SHOW PAD' : 'HIDE PAD', id: 'pad-hide', onPress: m.pad.onToggle });
  }
  rows.push({ label: 'FEEDBACK', id: 'feedback', onPress: m.onFeedback });
  return rows;
}

/** The seats the sheet has room for, you first and then whoever is still in: all of them
 *  when they fit, else the first `cells - 1` and a count of the rest in the last cell. */
export function sheetSeats(seats: readonly RoomSeat[], cells: number): { shown: RoomSeat[]; more: number } {
  const order = [...seats].sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.alive) - Number(a.alive));
  if (order.length <= cells) return { shown: order, more: 0 };
  const shown = order.slice(0, Math.max(0, cells - 1));
  return { shown, more: order.length - shown.length };
}

/** Who WATCH moves to next, round the living, from whoever it is on (none: the first, or
 *  the last going back). Null with nobody left to watch. */
export function cycleWatch(alive: readonly number[], on: number | null, dir: 1 | -1): number | null {
  if (alive.length === 0) return null;
  const at = on === null ? -1 : alive.indexOf(on);
  if (at < 0) return dir > 0 ? alive[0] : alive[alive.length - 1];
  return alive[(at + dir + alive.length) % alive.length];
}

/** The D-pad while we watch (Cam's 2026-10-14 phone play-test): left and right are PREV
 *  and NEXT. Only while out and following somebody -- following locks our own trainer, so
 *  the keys did nothing there -- and on the overworld: the start menu's party and summary
 *  screens use left and right themselves. */
export function watchStepKey(key: GbaKey, out: boolean, on: number | null, onField: boolean): 1 | -1 | null {
  if (!out || on === null || !onField) return null;
  return key === 'right' ? 1 : key === 'left' ? -1 : null;
}

/** The note under the seats: the question while LEAVE asks, else the model's. */
function sheetNote(m: SheetModel): string {
  return m.canLeave && m.leaveAsk ? 'Leave the match?' : m.note;
}

/** How tall everything under the seats is, so the seats take what is left. */
function sheetBelow(m: SheetModel): number {
  return (
    (sheetNote(m) ? ROW_H + 2 : 0) +
    (m.watch ? ROW_H + 28 : 0) +
    (sheetActions(m).length > 0 ? 28 : 0) +
    Math.ceil(settingsOf(m).length / 2) * 20 + 16 + 4 + // the settings
    (m.remapLine ? ROW_H : 0) +
    m.help.length * ROW_H +
    versionLines(m.version).length * ROW_H
  );
}

/** LEAVE for whoever may, and BACK TO GAME over the game. A first LEAVE asks: STAY, or
 *  LEAVE again to go. */
function sheetActions(m: SheetModel): ButtonSpec[] {
  const actions: ButtonSpec[] = [];
  if (m.canLeave && m.leaveAsk && m.onStay && m.onLeaveSure) {
    actions.push({ label: 'STAY', id: 'match-stay', onPress: m.onStay });
    actions.push({ label: 'LEAVE', id: 'match-leave-sure', cls: 'room-leave', onPress: m.onLeaveSure });
    return actions;
  }
  if (m.canLeave) actions.push({ label: 'LEAVE', id: 'match-leave', cls: 'room-leave', onPress: m.onLeave });
  if (m.look === 'overlay') actions.push({ label: 'BACK TO GAME', id: 'drawer-close', onPress: m.onClose });
  return actions;
}

/** The version line in at most two lines: its last part, the rom, is the one a report
 *  needs, and cutting it to fit one line cut exactly that. */
export function versionLines(version: string): string[] {
  return wrapText(version, W - 8).slice(0, 2);
}

/** The in-match sheet (POK-320), where the page's HTML drawer was: the room's line and
 *  the strip, everybody in it as their sprite (a tap opens the card, with KICK for the
 *  host), who you watch once you are out, LEAVE, the settings, and the version. The
 *  mirror keeps the drawer's ids: #drawer, #room-code, #match-strip, #match-roster,
 *  #match-card, #room-note, #spectate-strip, #match-leave, #drawer-close, #mute,
 *  #remap, #remap-reset, #forget-rom, #remap-line. */
export function sheetScreen(model: () => SheetModel): DrawnScreen {
  return {
    look: () => model().look,
    back() {
      const m = model();
      if (m.card) m.onCloseCard();
      else m.onClose();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const containers: Container[] = [
        { id: 'drawer', cls: 'drawer' },
        { id: 'match-roster', tag: 'ul', cls: 'room-roster' },
        { id: 'room-note', cls: 'room-note' },
        { id: 'spectate-strip', cls: 'spectate-strip', hidden: !m.watch },
        { id: 'settings', cls: 'settings' },
        { id: 'match-card', cls: 'trainer-card', hidden: !m.card },
      ];
      // Over the game, the game dimmed: it is still running under the sheet.
      if (m.look === 'overlay') c.fillRect({ x: -c.origin, y: 0, w: c.width, h }, '#000', 0.6);
      let y = 4;
      paintTitle(c, fitText(m.status, W - 8), y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.status, id: 'room-code', cls: 'room-status', cursor: null });
      y += ROW_H;
      if (m.strip !== null) {
        paintTitle(c, fitText(m.strip, W - 8), y);
        widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.strip, id: 'match-strip', cls: 'room-code', cursor: null });
        y += ROW_H;
      }
      const chips = m.chips ?? [];
      if (chips.length > 0) {
        const frame = { x: 0, y: y + 2, w: W, h: chips.length * ROW_H + 8 };
        c.drawFrame(frame);
        chips.forEach((chip, i) => {
          const at = frame.y + 4 + i * ROW_H;
          c.drawTextCentred(fitText(chip, W - 16), W / 2, at, TEXT_RED);
          widgets.push({ rect: { x: 0, y: at, w: W, h: ROW_H }, text: chip, id: `match-chip-${i}`, cls: 'room-code', cursor: null });
        });
        y = frame.y + frame.h;
      }
      y += 4;

      // As many rows of seats as there are seats, and as the rest leaves room for: a
      // desktop's dock is short, and a room of thirty does not fit in four.
      const room = Math.floor((h - y - sheetBelow(m) - 18) / SEAT_H);
      const rows = Math.max(1, Math.min(4, room, Math.ceil(m.seats.length / SEAT_COLS)));
      const lay = layoutSeats(y, rows * SEAT_COLS);
      const { shown, more } = sheetSeats(m.seats, lay.cells.length);
      c.drawFrame(lay.frame);
      shown.forEach((who, i) => {
        const cell = lay.cells[i];
        paintPerson(c, cell, who.skin, who.alive ? who.name : 'OUT', who.alive && !who.spectating ? 1 : 0.5, who.isMe ? TEXT_BLUE : TEXT_DARK);
        widgets.push({
          rect: cell,
          text: `${who.name}${who.isMe ? ' (you)' : ''}${who.alive ? '' : ' -- OUT'}${who.spectating ? ' (watching)' : ''}`,
          cls: 'roster-name',
          parent: 'match-roster',
          onPress: () => m.onSeat(who.seat),
          cursor: { x: cell.x + 2, y: cell.y + 10 },
        });
      });
      if (more > 0) {
        const cell = lay.cells[shown.length];
        c.drawTextCentred(`+${more}`, cell.x + cell.w / 2, cell.y + 16, TEXT_GRAY);
        widgets.push({ rect: cell, text: `${more} more`, cursor: null });
      }
      y = lay.frame.y + lay.frame.h + 2;

      const note = sheetNote(m);
      if (note) {
        const r = paintNote(c, note, y);
        widgets.push({ rect: r, text: note, parent: 'room-note', cursor: null });
        y += ROW_H + 2;
      }

      if (m.watch) {
        const line = `WATCHING ${m.watch.name ?? 'NOBODY'}`;
        c.drawTextCentred(fitText(line, W - 8), W / 2, y, TEXT_WHITE);
        widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: line, id: 'spectate-name', parent: 'spectate-strip', cursor: null });
        y += ROW_H;
        const buttons: ButtonSpec[] = [
          { label: 'PREV', id: 'spectate-prev', parent: 'spectate-strip', onPress: () => m.onWatch(-1) },
          { label: 'NEXT', id: 'spectate-next', parent: 'spectate-strip', onPress: () => m.onWatch(1) },
        ];
        if (m.watch.name !== null) buttons.push({ label: 'STOP', id: 'spectate-stop', parent: 'spectate-strip', onPress: m.onStopWatch });
        widgets.push(...paintButtons(c, y, buttons));
        y += 28;
      }

      const actions = sheetActions(m);
      if (actions.length > 0) {
        widgets.push(...paintButtons(c, y, actions));
        y += 28;
      }

      const settings = paintOptions(c, y, settingsOf(m), 'settings');
      widgets.push(...settings.widgets);
      y = settings.bottom + 4;

      if (m.remapLine) {
        c.drawTextCentred(fitText(m.remapLine, W - 8), W / 2, y, TEXT_WHITE);
        widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.remapLine, id: 'remap-line', cls: 'keys-note', cursor: null });
        y += ROW_H;
      }
      if (m.help.length > 0) {
        const top = y;
        for (const line of m.help) {
          c.drawTextCentred(fitText(line, W - 8), W / 2, y, TEXT_GRAY);
          y += ROW_H;
        }
        widgets.push({ rect: { x: 0, y: top, w: W, h: y - top }, text: m.help.join(' '), cls: 'keys', cursor: null });
      }
      const version = versionLines(m.version);
      const vy = Math.max(y, h - version.length * ROW_H);
      version.forEach((line, i) => c.drawTextCentred(line, W / 2, vy + i * ROW_H, TEXT_GRAY));
      widgets.push({ rect: { x: 0, y: vy, w: W, h: version.length * ROW_H }, text: m.version, cls: 'version', cursor: null });

      if (m.card) {
        const card = paintCard(c, h, lay.frame.y + 8, m.card, 'match-card', { onKick: m.onKick, onWatch: m.onWatchSeat, onClose: m.onCloseCard });
        return { widgets: [...card, ...underCard(widgets)], containers };
      }
      return { widgets, containers };
    },
  };
}

// ---- the main menu ----------------------------------------------------------------------

export interface MenuModel {
  title: string;
  rows: RowSpec[];
  /** The rows' container id, for the mirror. */
  rowsId?: string;
  note: string;
  noteId?: string;
  /** Who you are, on a strip under the rows; pressing it opens the trainer's rows. */
  trainer?: { name: string; skin: number; onPress: () => void };
  buttons?: ButtonSpec[];
  onBack?: () => void;
  /** The rows as tiles, two to a line under a wide first one (HBR-30). */
  tiles?: boolean;
  /** Drawn first, under everything: the main menu's pan over Hoenn. */
  backdrop?: (c: EmeraldCanvas, h: number) => void;
}

const TILE_GAP = 4;
const WIDE_H = 44;
const TILE_H = 62;
/** Room between two people on a tile (Cam, 2026-10-20: "some padding between sprites"). */
const SPRITE_STEP = 28;
const TILE_MIN_H = 36;
const BADGE = { w: 28, h: 13 };

/** Where the tiles go from `y`: the first across the screen, the rest two to a line, an
 *  odd last one across. Lower than TILE_H when that many lines would not fit in `room`. */
export function layoutTiles(y: number, count: number, room = Infinity): Rect[] {
  const out: Rect[] = [];
  const half = (W - TILE_GAP) / 2;
  const lines = Math.ceil((count - 1) / 2);
  const tileH = lines ? Math.max(TILE_MIN_H, Math.min(TILE_H, Math.floor((room - WIDE_H - TILE_GAP) / lines) - TILE_GAP)) : TILE_H;
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      out.push({ x: 0, y, w: W, h: WIDE_H });
      y += WIDE_H + TILE_GAP;
    } else if (i % 2 === 1 && i === count - 1) {
      out.push({ x: 0, y, w: W, h: tileH });
    } else {
      out.push({ x: i % 2 === 1 ? 0 : half + TILE_GAP, y, w: half, h: tileH });
      if (i % 2 === 0) y += tileH + TILE_GAP;
    }
  }
  return out;
}

function paintTiles(c: EmeraldCanvas, y: number, rows: RowSpec[], room: number, parent?: string): { widgets: Widget[]; bottom: number } {
  const rects = layoutTiles(y, rows.length, room);
  const widgets = rows.map((row, i): Widget => {
    const r = rects[i];
    const alpha = row.disabled ? 0.4 : 1;
    c.drawFrame(r);
    const tall = r.h >= 52 && r.w < W;
    const across = r.w === W;
    // A low half tile has room for one person beside its words.
    const gfx = (row.art?.gfx ?? []).slice(0, tall || across ? undefined : 1);
    const item = row.art?.item;
    const n = ITEM_ICON.cell;
    // A tall tile has its picture over its words. Any other has the words in its middle:
    // across the screen, its people either side of them; lower, its picture before them.
    const artW = item !== undefined ? n : (gfx.length - 1) * SPRITE_STEP + 16;
    const beside = !tall && !across && (item !== undefined || gfx.length > 0) ? artW + 4 : 0;
    // A picture beside the words leaves them the tile's inside, borders aside.
    const label = fitText(row.label, r.w - (beside ? 12 : 16) - beside);
    const lw = measure(label);
    const ly = tall ? r.y + r.h - 24 : r.y + Math.floor((r.h - ROW_H) / 2) - 2;
    const lx = Math.round(r.x + beside + (r.w - beside - lw) / 2);
    c.drawText(label, lx, ly, row.disabled ? TEXT_GRAY : TEXT_DARK);
    const artX = tall || across ? Math.round(r.x + (r.w - artW) / 2) : lx - beside;
    const midY = (h: number) => Math.round(r.y + (r.h - h) / 2);
    if (item !== undefined) {
      const iy = tall ? r.y + 6 : midY(n);
      const ix = across && !tall ? r.x + 16 : artX;
      c.drawUiPicture('items.png', (item % ITEM_ICON.cols) * n, Math.floor(item / ITEM_ICON.cols) * n, n, n, ix, iy, alpha);
    } else if (across) {
      // Either side of the words, close in, so the three read as one centred group
      // (Cam: "quick play text and sprites are center aligned").
      gfx.forEach((g, k) => c.drawSprite(g, k === 0 ? lx - 16 - 12 : lx + lw + 12, midY(32), alpha));
    } else {
      gfx.forEach((g, k) => c.drawSprite(g, artX + k * SPRITE_STEP, tall ? r.y + 4 : midY(32), alpha));
    }
    if (row.badge) {
      const b = { x: r.x + r.w - BADGE.w - 6, y: tall ? r.y + 6 : r.y - TILE_GAP, ...BADGE };
      // On a low tile the NEW is a sticker over its top edge, clear of the words.
      c.fillRect(b, '#e03030');
      c.drawText('NEW', b.x + Math.floor((b.w - measure('NEW')) / 2), b.y - 2, TEXT_WHITE);
    }
    return {
      rect: r,
      text: row.label,
      id: row.id,
      cls: row.cls,
      parent,
      disabled: row.disabled,
      onPress: row.onPress,
      cursor: row.onPress ? { x: (beside ? artX : across && gfx.length ? lx - 28 : lx) - 10, y: ly + 2 } : null,
    };
  });
  const last = rects[rects.length - 1];
  return { widgets, bottom: last ? last.y + last.h : y };
}

/** Who you are, on a strip: pressing it opens the trainer's rows. */
function paintTrainer(c: EmeraldCanvas, y: number, h: number, t: NonNullable<MenuModel['trainer']>, inset = 0): Widget {
  const box = { x: inset, y, w: W - 2 * inset, h };
  c.drawFrame(box);
  const sheet = skinSheet(t.skin);
  const pad = Math.floor((h - 32) / 2);
  if (sheet) c.drawSprite(sheet.gfx, inset + 16, y + pad);
  // The name alone, level with the sprite: the "12 played" line under it read as wins
  // (HBR-51), and the trainer's own rows have the record.
  c.drawText(fitText(t.name, W - 56 - 2 * inset), inset + 40, y + pad + 8, TEXT_BLUE);
  return { rect: box, text: t.name, id: 'lobby-trainer', onPress: t.onPress, cursor: { x: inset + 4, y: y + pad + 10 } };
}

export function menuScreen(model: () => MenuModel): DrawnScreen {
  return {
    back() {
      model().onBack?.();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const containers: Painted['containers'] = [];
      if (m.rowsId) containers.push({ id: m.rowsId, tag: 'ul', cls: 'lobby-rows' });
      m.backdrop?.(c, h);
      let y = 4;
      paintTitle(c, m.title, y);
      y += 20;
      if (m.tiles) {
        // The strip is painted above the tiles but listed after them, so the cursor starts
        // on QUICK PLAY.
        // Room around the card (Cam, 2026-10-20: "some padding around the trainer card").
        const strip = m.trainer ? paintTrainer(c, y + 4, 44, m.trainer) : null;
        y += strip ? 56 : 0;
        const tiles = paintTiles(c, y, m.rows, h - y - (m.note ? 22 : 4), m.rowsId);
        widgets.push(...tiles.widgets);
        if (strip) widgets.push(strip);
        y = tiles.bottom + 2;
        widgets.push({ rect: paintNote(c, m.note, y), text: m.note, id: m.noteId, cursor: null });
        return { widgets, containers };
      }
      const list = paintRows(c, y, m.rows, m.rowsId);
      widgets.push(...list.widgets);
      y = list.bottom + 2;
      const noteRect = paintNote(c, m.note, y);
      widgets.push({ rect: noteRect, text: m.note, id: m.noteId, cursor: null });
      y += ROW_H + 2;
      if (m.trainer) {
        widgets.push(paintTrainer(c, y, 48, m.trainer));
        y += 52;
      }
      if (m.buttons?.length) widgets.push(...paintButtons(c, Math.min(y, h - 28), m.buttons));
      return { widgets, containers };
    },
  };
}

// ---- a notice ----------------------------------------------------------------------------

export interface NoticeLine {
  text: string;
  id?: string;
  cls?: string;
  color?: TextColor;
}

export interface NoticeModel {
  title: string;
  titleId?: string;
  /** Said in one frame, each wrapped to fit; an empty one is left out. */
  lines: NoticeLine[];
  buttons?: ButtonSpec[];
  /** The mirror container the buttons go in, when a test knows them by it. */
  buttonsId?: string;
  containers?: Container[];
  /** A last line at the bottom, small: the version. */
  footer?: string;
  onBack?(): void;
}

/** A title, a few sentences in a frame and the buttons that answer them: the import and
 *  patch screens, a door that will not open, a question with SAVE or LOAD in it. */
export function noticeScreen(model: () => NoticeModel): DrawnScreen {
  return {
    back() {
      model().onBack?.();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const containers: Container[] = [...(m.containers ?? [])];
      if (m.buttonsId) containers.push({ id: m.buttonsId });
      let y = 4;
      paintTitle(c, fitText(m.title, W - 8), y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.title, id: m.titleId, cursor: null });
      y += 20;

      const bottom = h - 28 - (m.footer ? versionLines(m.footer).length * ROW_H : 0);
      // As many rows as the screen has room for: a startup error carries its stack.
      let room = Math.max(1, Math.floor((bottom - y - 20) / ROW_H));
      const blocks = m.lines
        .filter((l) => l.text)
        .map((line) => {
          const rows = wrapText(line.text, W - 24).slice(0, room);
          room = Math.max(0, room - rows.length);
          return { line, rows };
        })
        .filter((b) => b.rows.length > 0);
      const count = blocks.reduce((n, b) => n + b.rows.length, 0);
      if (count > 0) {
        const frame = { x: 0, y, w: W, h: count * ROW_H + 16 };
        c.drawFrame(frame);
        let ly = y + 8;
        for (const b of blocks) {
          const top = ly;
          for (const row of b.rows) {
            c.drawText(row, 12, ly, b.line.color ?? TEXT_DARK);
            ly += ROW_H;
          }
          widgets.push({ rect: { x: 8, y: top, w: W - 16, h: ly - top }, text: b.line.text, id: b.line.id, cls: b.line.cls, cursor: null });
        }
        y = frame.y + frame.h + 4;
      }
      if (m.buttons?.length) {
        widgets.push(...paintButtons(c, Math.min(y, bottom), m.buttons.map((b) => ({ ...b, parent: b.parent ?? m.buttonsId }))));
      }
      if (m.footer) {
        const lines = versionLines(m.footer);
        const fy = h - lines.length * ROW_H;
        lines.forEach((line, i) => c.drawTextCentred(line, W / 2, fy + i * ROW_H, TEXT_GRAY));
        widgets.push({ rect: { x: 0, y: fy, w: W, h: lines.length * ROW_H }, text: m.footer, cls: 'version', cursor: null });
      }
      return { widgets, containers };
    },
  };
}
