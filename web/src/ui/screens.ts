// The screens outside the game, drawn Emerald's way (POK-320): the main menu, the
// lobbies list, the trainer's own rows, the wardrobe, and the room with its 2x4 of
// seats -- Kanto's lobby.lua, in Emerald's font and frames.
//
// Each screen is a function of a model the page keeps: paint reads the model, draws,
// and hands the stage what it drew. The layouts (where a seat is, where a row is) are
// plain functions so ui.test.ts can pin them without a canvas.
import { SKINS, SKIN_UNLOCK_WINS, skinUnlocked } from '../match/career';
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
} from './emerald';
import type { DrawnScreen, Painted, Widget } from './stage';

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
        c.drawText(detail, r.x + r.w - measure(detail), r.y, TEXT_GRAY);
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
  /** Seconds until the room starts itself (quick play, the daily), or null. */
  countdown: number | null;
  /** The host's controls, in the order they are shown; null for a guest. */
  options: { label: string; id: string; onPress: () => void }[] | null;
  card: { seat: number; lines: CardLine[]; canKick: boolean } | null;
  /** The room refused us: the one thing to offer is the way back. */
  fatal: boolean;
  onStart(): void;
  onLeave(): void;
  onBack(): void;
  onSeat(seat: number): void;
  onKick(seat: number): void;
  onCloseCard(): void;
}

/** The room, Kanto's lobby: code on top, the seats, the note, the host's options,
 *  START or LEAVE. A trainer's card opens over the seats. */
export function roomScreen(model: () => RoomModel): DrawnScreen {
  return {
    back() {
      const m = model();
      if (m.card) m.onCloseCard();
      else if (!m.isHost) m.onLeave();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      const containers: Painted['containers'] = [
        { id: 'room-roster', tag: 'ul', cls: 'room-roster' },
        { id: 'room-note-drawn', cls: 'room-note' },
        { id: 'room-controls', cls: 'room-controls', hidden: !m.options || m.started },
        { id: 'trainer-card', cls: 'trainer-card', hidden: !m.card },
      ];
      let y = 4;
      paintTitle(c, fitText(m.status, W - 8), y);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.status, cls: 'room-status', cursor: null });
      y += 20;

      // Four rows at most: MAX reaches 30 now (POK-330 #29), and eight rows of seats
      // push START over the options on a phone. Every human still gets a cell -- the
      // relay seats sixteen -- and the note says how many bots the rest are.
      const lay = layoutSeats(y, Math.max(Math.min(m.max, 4 * SEAT_COLS), m.seats.length));
      c.drawFrame(lay.frame);
      const taken = m.seats.length;
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
          paintPerson(c, cell, (i % 2) + 4, 'BOT', 0.45);
        } else {
          paintPerson(c, cell, i % 2, '- - -', 0.25);
        }
      });
      y = lay.frame.y + lay.frame.h + 2;

      const noteText = m.countdown !== null && !m.started ? `STARTS IN ${m.countdown}` : m.note;
      const noteRect = paintNote(c, m.fatal ? '' : noteText, y, m.countdown !== null ? TEXT_WHITE : TEXT_GRAY);
      if (m.fatal) {
        widgets.push(...paintButtons(c, y, [{ label: 'BACK TO LOBBY', parent: 'room-note-drawn', onPress: m.onBack }]));
        y += 28;
      } else {
        widgets.push({ rect: noteRect, text: noteText, parent: 'room-note-drawn', cursor: null });
        y += ROW_H + 2;
      }

      if (m.options && !m.started) {
        // Two columns of the host's controls, each a small framed button.
        const cols = 2;
        const cw = Math.floor((W - 16) / cols);
        const rows = Math.ceil(m.options.length / cols);
        const frame = { x: 0, y, w: W, h: rows * 20 + 16 };
        c.drawFrame(frame);
        m.options.forEach((o, i) => {
          const r = { x: 8 + (i % cols) * cw + 8, y: y + 8 + Math.floor(i / cols) * 20 + 2, w: cw - 8, h: ROW_H };
          c.drawText(fitText(o.label, r.w - 10), r.x + 8, r.y, TEXT_DARK);
          widgets.push({ rect: r, text: o.label, id: o.id, parent: 'room-controls', onPress: o.onPress, cursor: { x: r.x, y: r.y + 2 } });
        });
        y = frame.y + frame.h + 4;
      }

      if (!m.started && !m.fatal) {
        const buttons: ButtonSpec[] = m.isHost
          ? [{ label: 'START', id: 'room-start', disabled: !m.canStart, onPress: m.onStart }]
          : [{ label: 'LEAVE', id: 'room-leave', cls: 'room-leave', onPress: m.onLeave }];
        widgets.push(...paintButtons(c, Math.min(y, h - 28), buttons));
      }

      if (m.card) {
        const lines = m.card.lines;
        const box = { x: 16, y: lay.frame.y + 8, w: W - 32, h: lines.length * ROW_H + 16 + 28 };
        c.fillRect({ x: 0, y: 0, w: W, h }, '#000', 0.35);
        c.drawFrame(box);
        lines.forEach((line, i) => {
          const text = line.label ? `${line.label}: ${line.value}` : line.value;
          const r = { x: box.x + 8, y: box.y + 8 + i * ROW_H, w: box.w - 16, h: ROW_H };
          c.drawText(fitText(text, r.w), r.x, r.y, line.label ? TEXT_DARK : TEXT_BLUE);
          widgets.push({ rect: r, text, cls: 'card-line', parent: 'trainer-card', cursor: null });
        });
        const seat = m.card.seat;
        const buttons: ButtonSpec[] = [];
        if (m.card.canKick) buttons.push({ label: 'KICK', cls: 'card-kick', parent: 'trainer-card', onPress: () => m.onKick(seat) });
        buttons.push({ label: 'CLOSE', cls: 'card-close', parent: 'trainer-card', onPress: m.onCloseCard });
        widgets.push(...paintButtons(c, box.y + box.h - 28, buttons));
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

// ---- the wardrobe -----------------------------------------------------------------------

export const WARDROBE_COLS = 4;

export function layoutWardrobe(y: number, count: number): { frame: Rect; cells: Rect[] } {
  const rows = Math.ceil(count / WARDROBE_COLS);
  const frame = { x: 0, y, w: W, h: rows * SEAT_H + 16 };
  const cells: Rect[] = [];
  for (let i = 0; i < count; i++) {
    cells.push({
      x: 8 + (i % WARDROBE_COLS) * SEAT_W,
      y: y + 8 + Math.floor(i / WARDROBE_COLS) * SEAT_H,
      w: SEAT_W,
      h: SEAT_H,
    });
  }
  return { frame, cells };
}

export interface WardrobeModel {
  wins: number;
  /** What you wear. */
  worn: number;
  /** What the cursor is on. */
  browsing: number;
  onBrowse(skin: number): void;
  onWear(skin: number): void;
  onBack(): void;
}

/** What the line under the wardrobe says about a skin: yours, wearable, or its price. */
export function wardrobeNote(skin: number, wins: number, worn: number): string {
  if (!skinUnlocked(skin, wins)) {
    const need = SKIN_UNLOCK_WINS[skin] ?? 0;
    return `LOCKED -- ${need} ${need === 1 ? 'win' : 'wins'}`;
  }
  return skin === worn ? 'your sprite' : 'press WEAR';
}

export function wardrobeScreen(model: () => WardrobeModel): DrawnScreen {
  return {
    back() {
      model().onBack();
    },
    paint(c, h): Painted {
      const m = model();
      const widgets: Widget[] = [];
      let y = 4;
      paintTitle(c, 'WARDROBE', y);
      y += 20;
      const lay = layoutWardrobe(y, SKINS.length);
      c.drawFrame(lay.frame);
      lay.cells.forEach((cell, i) => {
        const open = skinUnlocked(i, m.wins);
        const sheet = skinSheet(i);
        if (sheet) c.drawSprite(sheet.gfx, cell.x + Math.floor((cell.w - sheet.w) / 2), cell.y + 4, open ? 1 : 0.3);
        if (i === m.worn) c.drawText('worn', cell.x + Math.floor((cell.w - measure('worn')) / 2), cell.y + 33, TEXT_BLUE);
        else if (!open) c.drawText(`${SKIN_UNLOCK_WINS[i]}W`, cell.x + Math.floor((cell.w - measure(`${SKIN_UNLOCK_WINS[i]}W`)) / 2), cell.y + 33, TEXT_RED);
        widgets.push({
          rect: cell,
          text: `${SKINS[i]}${open ? '' : ' LOCKED'}${i === m.worn ? ' (worn)' : ''}`,
          cls: 'skin',
          parent: 'wardrobe',
          onPress: () => m.onBrowse(i),
          cursor: { x: cell.x + 2, y: cell.y + 10 },
        });
      });
      y = lay.frame.y + lay.frame.h + 2;
      c.drawTextCentred(SKINS[m.browsing] ?? '', W / 2, y, TEXT_WHITE);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: SKINS[m.browsing] ?? '', id: 'wardrobe-name', cursor: null });
      y += ROW_H;
      const note = wardrobeNote(m.browsing, m.wins, m.worn);
      paintNote(c, note, y, skinUnlocked(m.browsing, m.wins) ? TEXT_GRAY : TEXT_RED);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: note, id: 'wardrobe-note', cursor: null });
      y += ROW_H + 4;
      widgets.push(
        ...paintButtons(c, Math.min(y, h - 28), [
          {
            label: 'WEAR',
            id: 'wardrobe-wear',
            disabled: !skinUnlocked(m.browsing, m.wins) || m.browsing === m.worn,
            onPress: () => m.onWear(m.browsing),
          },
          { label: 'BACK', id: 'wardrobe-back', onPress: m.onBack },
        ]),
      );
      return { widgets, containers: [{ id: 'wardrobe', tag: 'ul', cls: 'wardrobe' }] };
    },
  };
}
