// The main menu's note in two lines when it needs them (Cam, 11-16: "Room 5773WK is on another
// version of the g…"), and one line everywhere else, as before.
import { describe, expect, it } from 'vitest';
import { measure } from './emerald';
import { W, noteLines } from './screens';

const LONG = 'Room 5773WK is on another version of the game. Reload the page to update.';

describe('a note', () => {
  it('is one line, cut to fit, where only one fits', () => {
    const [line, ...rest] = noteLines(LONG);
    expect(rest).toEqual([]);
    expect(line.endsWith('…')).toBe(true);
    expect(measure(line)).toBeLessThanOrEqual(W - 8);
  });

  it('is two lines on the main menu, whole when it fits in two', () => {
    const lines = noteLines(LONG, 2);
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe(LONG);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(W - 8);
  });

  it('keeps a short one on one line, and the last of a longer one cut to fit', () => {
    expect(noteLines('No open rooms', 2)).toEqual(['No open rooms']);
    const long = noteLines(`${LONG} ${LONG}`, 2);
    expect(long).toHaveLength(2);
    expect(long[1].endsWith('…')).toBe(true);
    expect(noteLines('', 2)).toEqual([]);
  });
});
