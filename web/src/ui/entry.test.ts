// The drawn entry (POK-320): what replaced prompt() for a name, a room code and a
// passcode. Typed into here the way a thumb, a D-pad and a keyboard type into it.
import { describe, expect, it, vi } from 'vitest';
import {
  CODE_ENTRY,
  NAME_ENTRY,
  PASS_ENTRY,
  deleteChar,
  entryComplete,
  entryScreen,
  entryText,
  layoutKeys,
  moveCursor,
  newEntry,
  scrub,
  typeChar,
  type EntryModel,
} from './entry';
import { fakeCanvas } from './fakecanvas';
import { CODE_ALPHABET } from '../match/lobby';

const typeAll = (s: ReturnType<typeof newEntry>, text: string) => {
  for (const ch of text) typeChar(s, ch);
};

describe('the entry, as data', () => {
  it('types into the slot under the cursor and moves on, uppercased', () => {
    const s = newEntry(NAME_ENTRY);
    typeAll(s, 'may');
    expect(entryText(s)).toBe('MAY');
    expect(s.pos).toBe(3);
  });

  it('keeps a name to its seven letters: the eighth is refused, not written over the seventh', () => {
    const s = newEntry(NAME_ENTRY);
    typeAll(s, 'wallyfromthegym');
    expect(entryText(s)).toBe('WALLYFR');
    expect(typeChar(s, 'Z')).toBe(false);
  });

  it('types a code in its own alphabet only: 0, O, 1, I and L never go in', () => {
    const s = newEntry(CODE_ENTRY);
    for (const ch of '0O1IL') expect(typeChar(s, ch), ch).toBe(false);
    expect(entryText(s)).toBe('');
    typeAll(s, 'abc234');
    expect(entryText(s)).toBe('ABC234');
    expect(entryComplete(s)).toBe(true);
  });

  it('takes a code only whole, and a name at any length', () => {
    const code = newEntry(CODE_ENTRY);
    typeAll(code, 'ABC23');
    expect(entryComplete(code), 'five of six').toBe(false);
    const pass = newEntry(PASS_ENTRY);
    typeAll(pass, 'WXYZ');
    expect(entryComplete(pass)).toBe(true);
    const name = newEntry(NAME_ENTRY);
    expect(entryComplete(name), 'nothing typed').toBe(false);
    typeAll(name, 'AB');
    expect(entryComplete(name)).toBe(true);
  });

  it('DEL is a backspace: the letter before an empty slot, or the one under the cursor', () => {
    const s = newEntry(NAME_ENTRY, 'CAM');
    expect(s.pos, 'the cursor starts after what is there').toBe(3);
    deleteChar(s);
    expect(entryText(s)).toBe('CA');
    moveCursor(s, -1);
    moveCursor(s, -1);
    deleteChar(s);
    expect(entryText(s), 'a hole in the middle reads as a space').toBe('A');
    const full = newEntry(PASS_ENTRY, 'ABCD');
    deleteChar(full);
    expect(entryText(full)).toBe('ABC');
  });

  it("scrubs Kanto's way: up the alphabet from an empty slot, round the ends, never past a slot", () => {
    const s = newEntry(CODE_ENTRY);
    scrub(s, 1);
    expect(s.slots[0]).toBe(CODE_ALPHABET[0]);
    scrub(s, -1);
    expect(s.slots[0], 'round the bottom').toBe(CODE_ALPHABET[CODE_ALPHABET.length - 1]);
    moveCursor(s, -1);
    expect(s.pos).toBe(0);
    for (let i = 0; i < 10; i++) moveCursor(s, 1);
    expect(s.pos).toBe(CODE_ENTRY.length - 1);
  });

  it('lays the keys out ten a row, with a name’s SPACE after them', () => {
    const code = layoutKeys(100, CODE_ENTRY);
    expect(code.keys.map((k) => k.ch).join('')).toBe(CODE_ALPHABET);
    expect(code.keys[10].rect).toEqual({ x: 20, y: 124, w: 20, h: 16 });
    const name = layoutKeys(100, NAME_ENTRY);
    const space = name.keys.find((k) => k.ch === ' ')!;
    expect(space.rect.w, 'the rest of the last row').toBe(4 * 20);
    for (const k of name.keys) {
      expect(k.rect.x).toBeGreaterThanOrEqual(name.frame.x + 8);
      expect(k.rect.x + k.rect.w).toBeLessThanOrEqual(name.frame.x + name.frame.w - 8);
    }
  });
});

describe('the entry screen', () => {
  const screenOf = (state = newEntry(PASS_ENTRY), note?: string) => {
    const model: EntryModel = { title: 'PASSCODE', state, note, noteIsError: note !== undefined, onDone: vi.fn(), onBack: vi.fn() };
    return { model, screen: entryScreen(() => model) };
  };

  it('a keyboard types letters, and a Z is a Z, not the A button', () => {
    const { model, screen } = screenOf();
    for (const key of ['z', 'x', 'a', 's']) expect(screen.char!(key), key).toBe(true);
    expect(entryText(model.state)).toBe('ZXAS');
    expect(model.onDone).not.toHaveBeenCalled();
  });

  it('Enter is OK once the code is whole, Backspace is DEL, Escape is BACK, Shift is nothing', () => {
    const { model, screen } = screenOf();
    screen.char!('A');
    screen.char!('Enter');
    expect(model.onDone, 'one letter of four').not.toHaveBeenCalled();
    screen.char!('Shift');
    expect(entryText(model.state), 'Shift is SELECT on the game map, and SELECT deletes').toBe('A');
    for (const k of 'BCD') screen.char!(k);
    screen.char!('Backspace');
    screen.char!('E');
    screen.char!('Enter');
    expect(model.onDone).toHaveBeenCalledWith('ABCE');
    screen.char!('Escape');
    expect(model.onBack).toHaveBeenCalled();
    expect(screen.char!('ArrowUp'), 'arrows go on to the D-pad').toBe(false);
  });

  it('the D-pad scrubs and moves, A confirms, B backs out', () => {
    const { model, screen } = screenOf();
    for (let i = 0; i < 4; i++) {
      screen.key!('up');
      screen.key!('right');
    }
    screen.key!('a');
    expect(model.onDone).toHaveBeenCalledWith(CODE_ALPHABET[0].repeat(4));
    screen.key!('b');
    expect(model.onBack).toHaveBeenCalled();
  });

  it('draws the mirror a test and a tap find: the text, every key, DEL, OK and BACK', () => {
    const { model, screen } = screenOf(newEntry(PASS_ENTRY, 'AB'), 'WRONG PASSCODE');
    const { canvas, texts } = fakeCanvas();
    const painted = screen.paint(canvas, 320);
    const ids = painted.widgets.map((w) => w.id).filter(Boolean);
    expect(ids).toEqual(expect.arrayContaining(['entry-text', 'entry-note', 'entry-ok', 'entry-back', 'entry-del', 'entry-key-A']));
    expect(ids.filter((id) => id!.startsWith('entry-key-'))).toHaveLength(CODE_ALPHABET.length);
    expect(ids, 'a key the code cannot hold is not on the grid').not.toContain('entry-key-O');
    expect(painted.widgets.find((w) => w.id === 'entry-text')!.text).toBe('AB');
    expect(painted.widgets.find((w) => w.id === 'entry-ok')!.disabled, 'two of four').toBe(true);
    expect(texts.some((t) => t.text === 'WRONG PASSCODE')).toBe(true);
    // A tap on a key types it.
    painted.widgets.find((w) => w.id === 'entry-key-C')!.onPress!();
    expect(entryText(model.state)).toBe('ABC');
    // Nothing on it takes the stage's own cursor: the entry has the keys itself.
    expect(painted.widgets.every((w) => w.cursor === null)).toBe(true);
  });
});
