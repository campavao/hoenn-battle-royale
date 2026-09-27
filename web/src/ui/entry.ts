// The drawn entry (POK-320): a name, a room code or a passcode, typed in Emerald's frame
// where the page used to ask with the browser's prompt(). Kanto's CodeEntry
// (src/link/CodeEntry.lua, and lib/entry.lua around it): up and down scrub the letter
// under the cursor, left and right move between slots, A is OK and B is BACK. This is a
// page as well, so there is a grid of keys to tap and a keyboard to type on -- and each
// shape types only its own alphabet, so a room code that could never be real cannot be
// typed at all (POK-240 caught one after the fact).
//
// The state and its moves are plain functions, so entry.test.ts can type into it.
import type { GbaKey } from '../emu';
import { NAME_MAX } from '../match/career';
import { CODE_ALPHABET, CODE_LENGTH } from '../match/lobby';
import { type Rect, TEXT_BLUE, TEXT_DARK, TEXT_GRAY, TEXT_RED, TEXT_WHITE, fitText } from './emerald';
import { ROW_H, W, paintButtons } from './screens';
import type { DrawnScreen, Painted, Widget } from './stage';

export interface EntryShape {
  /** What a slot can hold, in the order up scrubs through it. */
  charset: string;
  length: number;
  /** Fewer letters than slots is an answer (a name); a code is all of its slots. */
  short?: boolean;
}

/** Emerald's name field, as cleanName keeps it: letters, digits and a space, seven. */
export const NAME_ENTRY: EntryShape = { charset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ', length: NAME_MAX, short: true };
/** The relay's own codes: its alphabet, its length. */
export const CODE_ENTRY: EntryShape = { charset: CODE_ALPHABET, length: CODE_LENGTH };
/** Kanto's Entry.PASS: four of the code's own characters, enough to keep strangers out
 *  and short enough to read out once. The relay takes one to eight (relay/clean.js). */
export const PASS_ENTRY: EntryShape = { charset: CODE_ALPHABET, length: 4 };

export interface EntryState {
  readonly shape: EntryShape;
  /** A letter per slot, or null for an empty one. */
  slots: (string | null)[];
  /** The slot under the cursor -- or `length`, past the last one, once typing has
   *  filled them all: a letter more is refused there rather than written over the last. */
  pos: number;
}

/** An entry, holding `text` already (a name to change): what the shape holds of it. */
export function newEntry(shape: EntryShape, text = ''): EntryState {
  const slots = Array.from({ length: shape.length }, (_, i): string | null => {
    const ch = text.charAt(i).toUpperCase();
    return ch !== '' && shape.charset.includes(ch) ? ch : null;
  });
  // The cursor after what is there, where a caret would be.
  const empty = slots.findIndex((c) => c === null);
  return { shape, slots, pos: empty < 0 ? shape.length : empty };
}

/** Up and down: the next or the previous letter in the slot, round the end. */
export function scrub(s: EntryState, dir: 1 | -1): void {
  s.pos = Math.min(s.pos, s.shape.length - 1);
  const set = s.shape.charset;
  const at = s.slots[s.pos];
  const i = at === null ? (dir > 0 ? -1 : 0) : set.indexOf(at);
  s.slots[s.pos] = set[(i + dir + set.length) % set.length];
}

/** Left and right: the next slot, never past either end. */
export function moveCursor(s: EntryState, dir: 1 | -1): void {
  s.pos = Math.max(0, Math.min(s.shape.length - 1, s.pos + dir));
}

/** A letter typed or tapped, into the slot under the cursor, which moves on. False, and
 *  nothing changes, for one the shape does not hold -- or once every slot is typed: a
 *  fifteen-letter name is its first seven, as Emerald's name field keeps it. */
export function typeChar(s: EntryState, raw: string): boolean {
  const ch = raw.toUpperCase();
  if (ch.length !== 1 || !s.shape.charset.includes(ch) || s.pos >= s.shape.length) return false;
  s.slots[s.pos] = ch;
  s.pos++;
  return true;
}

/** DEL: the letter under the cursor, or the one before it when the cursor is on an
 *  empty slot -- a backspace. */
export function deleteChar(s: EntryState): void {
  if (s.pos >= s.shape.length) s.pos = s.shape.length - 1;
  else if (s.slots[s.pos] === null && s.pos > 0) s.pos--;
  s.slots[s.pos] = null;
}

/** What was typed, a hole read as a space, the ends trimmed. */
export function entryText(s: EntryState): string {
  return s.slots
    .map((c) => c ?? ' ')
    .join('')
    .trim();
}

/** Whether OK takes it: something typed, and a code every one of its slots. */
export function entryComplete(s: EntryState): boolean {
  const text = entryText(s);
  if (!text) return false;
  return s.shape.short === true || (text.length === s.shape.length && !text.includes(' '));
}

// ---- the layout ----------------------------------------------------------------------

export const SLOT_W = 16;
export const KEY_COLS = 10;
export const KEY_W = 20;
export const KEY_H = 16;

/** The slots, centred in a frame at `y`. */
export function layoutSlots(y: number, length: number): { frame: Rect; slots: Rect[] } {
  const x0 = Math.floor((W - length * SLOT_W) / 2);
  const slots = Array.from({ length }, (_, i) => ({ x: x0 + i * SLOT_W, y: y + 8, w: SLOT_W, h: 24 }));
  return { frame: { x: 0, y, w: W, h: 40 }, slots };
}

/** The keys: the shape's alphabet in rows of ten in a frame at `y`, and a name's space
 *  as a wide SPACE key after the rest. */
export function layoutKeys(y: number, shape: EntryShape): { frame: Rect; keys: { ch: string; rect: Rect }[] } {
  const chars = [...shape.charset].filter((c) => c !== ' ');
  const at = (i: number, span = 1): Rect => ({
    x: 20 + (i % KEY_COLS) * KEY_W,
    y: y + 8 + Math.floor(i / KEY_COLS) * KEY_H,
    w: span * KEY_W,
    h: KEY_H,
  });
  const keys = chars.map((ch, i) => ({ ch, rect: at(i) }));
  let used = chars.length;
  if (shape.charset.includes(' ')) {
    // The rest of the last row, or a row of its own when that is less than three keys.
    const left = KEY_COLS - (used % KEY_COLS);
    const start = left < 3 ? used + left : used;
    const span = left < 3 ? KEY_COLS : left;
    keys.push({ ch: ' ', rect: at(start, span) });
    used = start + span;
  }
  const rows = Math.ceil(used / KEY_COLS);
  return { frame: { x: 12, y, w: W - 24, h: rows * KEY_H + 16 }, keys };
}

export interface EntryModel {
  title: string;
  state: EntryState;
  /** What was wrong with the last one (WRONG PASSCODE) in red, or a word of help. */
  note?: string;
  noteIsError?: boolean;
  onDone(text: string): void;
  onBack(): void;
}

/** The entry screen: the title, the slots, a line for what went wrong, the keys, and
 *  DEL / OK / BACK. The D-pad scrubs (Kanto's way), a tap types, and so does a keyboard
 *  (Stage.char): a Z typed is a Z, not the A button. */
export function entryScreen(model: () => EntryModel): DrawnScreen {
  const ok = (): void => {
    const m = model();
    if (entryComplete(m.state)) m.onDone(entryText(m.state));
  };
  return {
    back() {
      model().onBack();
    },
    key(k: GbaKey): boolean {
      const s = model().state;
      if (k === 'up') scrub(s, 1);
      else if (k === 'down') scrub(s, -1);
      else if (k === 'left') moveCursor(s, -1);
      else if (k === 'right') moveCursor(s, 1);
      else if (k === 'a' || k === 'start') ok();
      else if (k === 'b') model().onBack();
      else if (k === 'select') deleteChar(s);
      return true;
    },
    char(key: string): boolean {
      const m = model();
      // Shift is SELECT on the game's keyboard map, which here is DEL: a capital typed
      // with it would take a letter away before it put one in.
      if (key === 'Shift') return true;
      if (key === 'Backspace' || key === 'Delete') deleteChar(m.state);
      else if (key === 'Enter') ok();
      else if (key === 'Escape') m.onBack();
      // A letter this shape does not hold is swallowed all the same: it is not a key
      // the game under the entry should hear either.
      else if (key.length === 1) typeChar(m.state, key);
      else return false;
      return true;
    },
    paint(c, h): Painted {
      const m = model();
      const s = m.state;
      const widgets: Widget[] = [];
      let y = 4;
      c.drawTextCentred(fitText(m.title, W - 8), W / 2, y, TEXT_WHITE);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: m.title, id: 'entry-title', cursor: null });
      y += 20;

      const slots = layoutSlots(y, s.shape.length);
      c.drawFrame(slots.frame);
      widgets.push({ rect: slots.frame, text: entryText(s), id: 'entry-text', cursor: null });
      slots.slots.forEach((r, i) => {
        const ch = s.slots[i];
        if (ch && ch !== ' ') c.drawTextCentred(ch, r.x + r.w / 2, r.y + 2, TEXT_DARK);
        const here = i === s.pos;
        c.fillRect({ x: r.x + 2, y: r.y + 18, w: r.w - 4, h: here ? 2 : 1 }, here ? TEXT_BLUE.fg : TEXT_GRAY.fg);
        widgets.push({
          rect: r,
          text: ch ?? '-',
          cls: 'entry-slot',
          parent: 'entry-slots',
          onPress: () => {
            s.pos = i;
          },
          cursor: null,
        });
      });
      y = slots.frame.y + slots.frame.h + 2;

      const note = m.note ?? '';
      if (note) c.drawTextCentred(fitText(note, W - 8), W / 2, y, m.noteIsError ? TEXT_RED : TEXT_WHITE);
      widgets.push({ rect: { x: 0, y, w: W, h: ROW_H }, text: note, id: 'entry-note', cursor: null });
      y += ROW_H + 2;

      const keys = layoutKeys(y, s.shape);
      c.drawFrame(keys.frame);
      for (const k of keys.keys) {
        const label = k.ch === ' ' ? 'SPACE' : k.ch;
        c.drawTextCentred(label, k.rect.x + k.rect.w / 2, k.rect.y, TEXT_DARK);
        widgets.push({
          rect: k.rect,
          text: label,
          id: `entry-key-${k.ch === ' ' ? 'space' : k.ch}`,
          parent: 'entry-keys',
          onPress: () => {
            typeChar(s, k.ch);
          },
          cursor: null,
        });
      }
      y = keys.frame.y + keys.frame.h + 4;

      const by = Math.min(y, h - 44);
      widgets.push(
        ...paintButtons(c, by, [
          { label: 'DEL', id: 'entry-del', onPress: () => deleteChar(s) },
          { label: 'OK', id: 'entry-ok', disabled: !entryComplete(s), onPress: ok },
          { label: 'BACK', id: 'entry-back', onPress: () => m.onBack() },
        ]).map((w) => ({ ...w, cursor: null })),
      );
      c.drawTextCentred('UP/DOWN: LETTER  A: OK  B: BACK', W / 2, by + 28, TEXT_GRAY);
      return { widgets, containers: [{ id: 'entry-slots' }, { id: 'entry-keys' }] };
    },
  };
}
