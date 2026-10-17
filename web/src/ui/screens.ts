// The screens outside the game, drawn Emerald's way (POK-320): the main menu, the
// lobbies list, the trainer's own rows, MY LOOK, and the room with its 2x4 of
// seats -- Kanto's lobby.lua, in Emerald's font and frames.
//
// Each screen is a function of a model the page keeps: paint reads the model, draws,
// and hands the stage what it drew. The layouts (where a seat is, where a row is) are
// plain functions so ui.test.ts can pin them without a canvas.
import { CARD_BADGES, SKINS, SKIN_UNLOCK_WINS, WARDROBE, cardBadges, cardId, cardStars, ordinal, skinUnlocked } from '../match/career';
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
  fitText,
  measure,
  skinSheet,
  wrapText,
} from './emerald';
import type { GbaKey } from '../emu';
import type { Container, DrawnScreen, Painted, Widget } from './stage';

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
  options: { label: string; id: string; onPress: () => void }[] | null;
  card: TrainerCard | null;
  onStart(): void;
  onLeave(): void;
  onSeat(seat: number): void;
  onKick(seat: number): void;
  onCloseCard(): void;
}

/** The room, Kanto's lobby: code on top, the seats, the note, the host's options,
 *  START (the host's) and LEAVE. A trainer's card opens over the seats. */
export function roomScreen(model: () => RoomModel): DrawnScreen {
  return {
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

      // Four rows at most: MAX reaches 30 now (POK-330 #29), and eight rows of seats
      // push START over the options on a phone. Every human still gets a cell -- the
      // relay seats sixteen -- and the note says how many bots the rest are.
      const lay = layoutSeats(y, Math.max(Math.min(m.max, 4 * SEAT_COLS), m.seats.length));
      c.drawFrame(lay.frame);
      const taken = m.seats.length;
      // The bots to come, in the clothes they will be dealt (bots/roster.ts botSkin).
      const botsToCome = botSeats(m.fill, m.seats.map((who) => who.seat));
      lay.cells.forEach((cell, i) => {
        const who = m.seats[i];
        if (who) {
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
        } else if (i - taken < m.fill && !m.started) {
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

/** Two columns of small framed controls at `y` -- the host's options, the sheet's
 *  settings -- each in the container `parent`. */
export function paintOptions(
  c: EmeraldCanvas,
  y: number,
  options: { label: string; id: string; onPress: () => void }[],
  parent: string,
): { widgets: Widget[]; bottom: number } {
  const cols = 2;
  const cw = Math.floor((W - 16) / cols);
  const rows = Math.ceil(options.length / cols);
  const frame = { x: 0, y, w: W, h: rows * 20 + 16 };
  c.drawFrame(frame);
  const widgets = options.map((o, i): Widget => {
    const r = { x: 8 + (i % cols) * cw + 8, y: y + 8 + Math.floor(i / cols) * 20 + 2, w: cw - 8, h: ROW_H };
    c.drawText(fitText(o.label, r.w - 10), r.x + 8, r.y, TEXT_DARK);
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
  onClose(): void;
  onMute(): void;
  onRemap(): void;
  onResetPad(): void;
  onForget(): void;
  /** A phone's see-through stick and A/B (ui/padprefs.ts): MOVE PAD to drag and fade
   *  them, HIDE PAD to walk by tapping alone. Absent where there is no touch pad. */
  pad?: { hidden: boolean; onMove(): void; onToggle(): void };
}

/** The sheet's settings, MOVE PAD and HIDE PAD among them on a phone. */
function settingsOf(m: SheetModel): { label: string; id: string; onPress: () => void }[] {
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

/** How tall everything under the seats is, so the seats take what is left. */
function sheetBelow(m: SheetModel): number {
  return (
    (m.note ? ROW_H + 2 : 0) +
    (m.watch ? ROW_H + 28 : 0) +
    (sheetActions(m).length > 0 ? 28 : 0) +
    Math.ceil(settingsOf(m).length / 2) * 20 + 16 + 4 + // the settings
    (m.remapLine ? ROW_H : 0) +
    m.help.length * ROW_H +
    versionLines(m.version).length * ROW_H
  );
}

/** LEAVE for whoever may, and BACK TO GAME over the game. */
function sheetActions(m: SheetModel): ButtonSpec[] {
  const actions: ButtonSpec[] = [];
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

      if (m.note) {
        const r = paintNote(c, m.note, y);
        widgets.push({ rect: r, text: m.note, parent: 'room-note', cursor: null });
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
  trainer?: { name: string; skin: number; record: string; onPress: () => void };
  buttons?: ButtonSpec[];
  onBack?: () => void;
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
      let y = 4;
      paintTitle(c, m.title, y);
      y += 20;
      const list = paintRows(c, y, m.rows, m.rowsId);
      widgets.push(...list.widgets);
      y = list.bottom + 2;
      const noteRect = paintNote(c, m.note, y);
      widgets.push({ rect: noteRect, text: m.note, id: m.noteId, cursor: null });
      y += ROW_H + 2;
      if (m.trainer) {
        const t = m.trainer;
        const box = { x: 0, y, w: W, h: 48 };
        c.drawFrame(box);
        const sheet = skinSheet(t.skin);
        if (sheet) c.drawSprite(sheet.gfx, 16, y + 8);
        c.drawText(fitText(t.name, W - 56), 40, y + 8, TEXT_BLUE);
        c.drawText(fitText(t.record, W - 56), 40, y + 24, TEXT_GRAY);
        widgets.push({
          rect: box,
          text: `${t.name} ${t.record}`,
          id: 'lobby-trainer',
          onPress: t.onPress,
          cursor: { x: 4, y: y + 18 },
        });
        y += 52;
      }
      if (m.buttons?.length) widgets.push(...paintButtons(c, Math.min(y, h - 28), m.buttons));
      return { widgets, containers };
    },
  };
}

// ---- the trainer card ---------------------------------------------------------------------

/** Emerald's TRAINER CARD, as src/trainer_card.c draws its front: 240x160, with every
 *  place below in its pixels (the text window's own x/y plus its one-tile margin). */
export const CARD_W = 240;
export const CARD_H = 160;
const CARD_VALUE_RIGHT = 136; // the MONEY / POKéDEX / TIME values' right edge
const CARD_FIELDS_Y = [65, 81, 97];
const CARD_PIC = { x: 160, y: 40, w: 64, h: 64 };

export interface CardFace {
  name: string;
  skin: number;
  wins: number;
  played: number;
  /** The best placing, 1 = first; undefined until a match has been finished. */
  best?: number;
}

/** The card's three fields where Emerald's MONEY, POKéDEX and TIME go. */
export function cardFields(face: CardFace): CardLine[] {
  return [
    { label: 'WINS', value: String(face.wins) },
    { label: 'PLAYED', value: String(face.played) },
    { label: 'BEST', value: face.best === undefined ? '---' : ordinal(face.best) },
  ];
}

/** Which of trainer-card.png's rows a card wears: its star count's colour, a girl's
 *  background for an odd skin (career.ts: even is male, odd is female). */
export function cardRow(face: CardFace): number {
  return cardStars(face.wins) * 2 + (face.skin % 2);
}

/** The card itself at `y`: the art, the stars and badges the wins have earned, the
 *  portrait, the name and the three fields. NAME and the portrait are pressable -- your
 *  name, and MY LOOK -- in `parent`, before anything else in it. */
export function paintTrainerCard(
  c: EmeraldCanvas,
  y: number,
  face: CardFace,
  parent: string,
  on: { onName: () => void; onSkin: () => void },
): Widget[] {
  // Nothing on the card before the card: text over the bare page, and the art popping in
  // under it, read as broken. The canvas paints again when it lands. If it never does, a
  // plain window takes its place: NAME and the portrait are the only ways to your name
  // and MY LOOK from here, so they are pressable either way (#48's review).
  const art = c.drawUiPicture('trainer-card.png', 0, cardRow(face) * CARD_H, CARD_W, CARD_H, 0, y);
  if (art === 'missing') c.drawFrame({ x: 0, y, w: CARD_W, h: CARD_H });
  const fields = cardFields(face);
  const badges = cardBadges(face.wins);
  if (art !== 'loading') {
    // DrawStarsAndBadgesOnCard: the stars from tile (15, 7), the badges from (4, 15) three
    // tiles apart. card-badges.png is the eight badges and then the star.
    const stars = cardStars(face.wins);
    for (let i = 0; i < stars; i++) c.drawUiPicture('card-badges.png', 128, 0, 8, 8, 120 + i * 8, y + 56);
    for (let i = 0; i < badges; i++) c.drawUiPicture('card-badges.png', i * 16, 0, 16, 16, 32 + i * 24, y + 120);
    c.drawUiPicture('trainer-pics.png', face.skin * CARD_PIC.w, 0, CARD_PIC.w, CARD_PIC.h, CARD_PIC.x, y + CARD_PIC.y);

    const id = `IDNo.${cardId(face.name)}`;
    c.drawText(id, 128 + Math.floor((96 - measure(id)) / 2), y + 17, TEXT_DARK);
    c.drawText(`NAME: ${face.name}`, 24, y + 41, TEXT_DARK);
    fields.forEach((f, i) => {
      c.drawText(f.label, 24, y + CARD_FIELDS_Y[i], TEXT_DARK);
      c.drawText(f.value, CARD_VALUE_RIGHT - measure(f.value), y + CARD_FIELDS_Y[i], TEXT_DARK);
    });
  }

  const stats = `${fields.map((f) => `${f.label} ${f.value}`).join(' ')} BADGES ${badges}/${CARD_BADGES}`;
  return [
    {
      rect: { x: 16, y: y + 40, w: 120, h: ROW_H },
      text: `${face.name} your name`,
      id: 'trainer-name',
      parent,
      onPress: on.onName,
      // Left of the card's own row marker, which the cursor drawn over it turned into a box.
      cursor: { x: 12, y: y + 43 },
    },
    {
      rect: { x: CARD_PIC.x - 8, y: y + CARD_PIC.y, w: CARD_PIC.w + 16, h: CARD_PIC.h },
      text: `${SKINS[face.skin] ?? ''} your sprite`,
      id: 'trainer-skin',
      parent,
      onPress: on.onSkin,
      cursor: { x: CARD_PIC.x - 8, y: y + CARD_PIC.y + 28 },
    },
    { rect: { x: 16, y: y + 64, w: 120, h: 3 * ROW_H }, text: stats, id: 'trainer-record', cursor: null },
  ];
}

export interface TrainerModel {
  face: CardFace;
  /** The rows under the card: your lines and the settings. */
  rows: RowSpec[];
  note: string;
  onName(): void;
  onSkin(): void;
  onBack(): void;
}

/** TRAINER (POK-335): the card on top where the title would be -- it says TRAINER CARD
 *  itself -- the rows under it, the note, BACK. The card and the rows share
 *  #trainer-rows, the card's two first. */
export function trainerScreen(model: () => TrainerModel): DrawnScreen {
  return {
    back() {
      model().onBack();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets = paintTrainerCard(c, 0, m.face, 'trainer-rows', { onName: m.onName, onSkin: m.onSkin });
      let y = CARD_H + 2;
      const list = paintRows(c, y, m.rows, 'trainer-rows');
      widgets.push(...list.widgets);
      y = list.bottom;
      const noteRect = paintNote(c, m.note, y);
      widgets.push({ rect: noteRect, text: m.note, id: 'trainer-note', cursor: null });
      y += ROW_H;
      widgets.push(...paintButtons(c, Math.min(y, h - 28), [{ label: 'BACK', id: 'trainer-back', onPress: m.onBack }]));
      return { widgets, containers: [{ id: 'trainer-rows', tag: 'ul', cls: 'lobby-rows' }] };
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

// ---- MY LOOK: your sprite and your lines ------------------------------------------------

/** One screen for how you come across (Cam's 2026-10-14 play-test, POK-337): your battle
 *  picture large, the sprites in a strip you turn left and right, and your three lines,
 *  each in Emerald's own dialogue box, turned one at a time. Where the wardrobe was a
 *  grid and the lines a list, you meet them one by one: "I would rather people kind of
 *  discover them". */
export const LOOK_PIC_FRAME: Rect = { x: 8, y: 2, w: 80, h: 80 };
export const LOOK_STRIP: Rect = { x: 0, y: 84, w: W, h: 56 };
/** How many sprites the strip shows: the one you are on, one before it, two after. */
export const LOOK_CELLS = 4;
export const LOOK_CELL = { w: 48, h: 40 };
/** A dialogue box: Emerald's own two lines, the width of the screen. */
export const LOOK_BOX_H = 48;
export const LOOK_BOXES_Y = LOOK_STRIP.y + LOOK_STRIP.h + 2;

export type LineSlot = 'intro' | 'win' | 'lose';
export const LINE_SLOTS: readonly LineSlot[] = ['intro', 'win', 'lose'];
export const SLOT_TITLES: Record<LineSlot, string> = { intro: 'WALKING UP', win: 'WHEN YOU WIN', lose: 'WHEN YOU LOSE' };

/** The skin `by` places along the wardrobe from `skin`, round the ends. */
export function stepSkin(skin: number, by: number): number {
  const n = WARDROBE.length;
  const at = Math.max(0, WARDROBE.indexOf(skin));
  return WARDROBE[(((at + by) % n) + n) % n];
}

/** The strip's sprites, left to right: the one before `skin`, `skin`, and the ones after. */
export function lookStrip(skin: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOOK_CELLS; i++) out.push(stepSkin(skin, i - 1));
  return out;
}

/** What the line beside the picture says about a skin: yours, or its price. */
export function lookNote(skin: number, wins: number, worn: number): string {
  if (!skinUnlocked(skin, wins)) {
    const need = SKIN_UNLOCK_WINS[skin] ?? 0;
    return `LOCKED -- ${need} ${need === 1 ? 'win' : 'wins'}`;
  }
  return skin === worn ? 'your sprite' : '';
}

export interface LookModel {
  wins: number;
  /** What you wear. */
  worn: number;
  /** What the strip is on: what you wear, or a locked one you are looking at. */
  browsing: number;
  lines: readonly string[];
  /** Each slot's line, an index into `lines`. */
  picked: Record<LineSlot, number>;
  /** The strip moved to `skin`: wear it if it is yours to. */
  onBrowse(skin: number): void;
  onLine(slot: LineSlot, index: number): void;
  onBack(): void;
}

export function lookScreen(model: () => LookModel): DrawnScreen {
  const browse = (by: number) => {
    const m = model();
    m.onBrowse(stepSkin(m.browsing, by));
  };
  const turn = (slot: LineSlot, by: number) => {
    const m = model();
    const n = m.lines.length;
    m.onLine(slot, (((m.picked[slot] + by) % n) + n) % n);
  };
  return {
    back() {
      model().onBack();
    },
    key(k, on) {
      // Left and right turn the row the cursor is on; up and down go between the rows.
      if (k !== 'left' && k !== 'right') return false;
      const by = k === 'left' ? -1 : 1;
      if (on?.id === 'look-sprite') browse(by);
      else {
        const slot = LINE_SLOTS.find((s) => on?.id === `look-${s}`);
        if (!slot) return false;
        turn(slot, by);
      }
      return true;
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const open = skinUnlocked(m.browsing, m.wins);

      // The battle picture, in a window, the way the card frames it. Looking only.
      c.drawFrame(LOOK_PIC_FRAME);
      c.drawUiPicture('trainer-pics.png', m.browsing * CARD_PIC.w, 0, CARD_PIC.w, CARD_PIC.h, LOOK_PIC_FRAME.x + 8, LOOK_PIC_FRAME.y + 8);
      const right = LOOK_PIC_FRAME.x + LOOK_PIC_FRAME.w;
      const mid = Math.round((right + W) / 2);
      c.drawTextCentred('MY LOOK', mid, 10, TEXT_WHITE);
      const name = SKINS[m.browsing] ?? '';
      c.drawTextCentred(name, mid, 34, TEXT_WHITE);
      widgets.push({ rect: { x: right, y: 34, w: W - right, h: ROW_H }, text: name, id: 'look-name', cursor: null });
      const note = lookNote(m.browsing, m.wins, m.worn);
      if (note) c.drawTextCentred(note, mid, 50, open ? TEXT_GRAY : TEXT_RED);
      widgets.push({ rect: { x: right, y: 50, w: W - right, h: ROW_H }, text: note, id: 'look-note', cursor: null });

      // The strip: the one you are on second from the left, lit; a locked one faded.
      c.drawFrame(LOOK_STRIP);
      const cy = LOOK_STRIP.y + 8;
      const arrowY = cy + Math.floor(LOOK_CELL.h / 2) - 5;
      c.drawCursor(LOOK_STRIP.x + 10, arrowY, TEXT_DARK, true);
      c.drawCursor(LOOK_STRIP.x + LOOK_STRIP.w - 14, arrowY);
      widgets.push(
        { rect: { x: 0, y: cy, w: 24, h: LOOK_CELL.h }, text: 'previous sprite', id: 'look-prev', onPress: () => browse(-1), cursor: null },
        { rect: { x: W - 24, y: cy, w: 24, h: LOOK_CELL.h }, text: 'next sprite', id: 'look-next', onPress: () => browse(1), cursor: null },
      );
      lookStrip(m.browsing).forEach((skin, slot) => {
        const cell = { x: 24 + slot * LOOK_CELL.w, y: cy, w: LOOK_CELL.w, h: LOOK_CELL.h };
        const mine = skinUnlocked(skin, m.wins);
        if (slot === 1) c.fillRect({ x: cell.x + 4, y: cell.y, w: cell.w - 8, h: cell.h }, TEXT_BLUE.shadow);
        const sheet = skinSheet(skin);
        if (sheet) c.drawSprite(sheet.gfx, cell.x + Math.floor((cell.w - sheet.w) / 2), cell.y + Math.floor((cell.h - sheet.h) / 2), mine ? 1 : 0.3);
        widgets.push({
          rect: cell,
          text: `${SKINS[skin]}${mine ? '' : ' LOCKED'}${skin === m.worn ? ' (worn)' : ''}`,
          id: slot === 1 ? 'look-sprite' : undefined,
          cls: 'skin',
          parent: 'look-sprites',
          onPress: () => m.onBrowse(skin),
          // Only the lit one takes the cursor: left and right move the strip under it.
          cursor: slot === 1 ? { x: cell.x + 6, y: cell.y + 14 } : null,
        });
      });

      // The three lines, each said in a dialogue box: what it is for, then the line.
      LINE_SLOTS.forEach((slot, i) => {
        const y = LOOK_BOXES_Y + i * LOOK_BOX_H;
        c.drawMessageBox({ x: 0, y, w: W, h: LOOK_BOX_H });
        const line = m.lines[m.picked[slot]] ?? '';
        c.drawText(SLOT_TITLES[slot], 16, y + 9, TEXT_BLUE);
        c.drawText(line, 16, y + 25, TEXT_DARK);
        c.drawCursor(W - 14, y + 25, TEXT_GRAY);
        widgets.push(
          { rect: { x: 0, y, w: 24, h: LOOK_BOX_H }, text: `${SLOT_TITLES[slot]} back`, id: `look-${slot}-prev`, onPress: () => turn(slot, -1), cursor: null },
          {
            rect: { x: 24, y, w: W - 48, h: LOOK_BOX_H },
            text: `${SLOT_TITLES[slot]}: ${line}`,
            id: `look-${slot}`,
            onPress: () => turn(slot, 1),
            cursor: { x: 8, y: y + 9 },
          },
          { rect: { x: W - 24, y, w: 24, h: LOOK_BOX_H }, text: `${SLOT_TITLES[slot]} next`, id: `look-${slot}-next`, onPress: () => turn(slot, 1), cursor: null },
        );
      });

      const y = LOOK_BOXES_Y + LINE_SLOTS.length * LOOK_BOX_H + 2;
      widgets.push(...paintButtons(c, Math.min(y, h - 28), [{ label: 'BACK', id: 'look-back', onPress: m.onBack }]));
      return { widgets, containers: [{ id: 'look-sprites', tag: 'ul', cls: 'look-sprites' }] };
    },
  };
}
