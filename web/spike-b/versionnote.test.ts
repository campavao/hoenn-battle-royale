import { describe, expect, it } from 'vitest';
import { measure } from '../src/ui/emerald';
import { W, noteLines } from '../src/ui/screens';
import { versionNote } from './versionnote';

const fits = (s: string) => {
  const lines = noteLines(s, 2);
  expect(lines.join(' '), 'whole in the menu note').toBe(s);
  for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(W - 8);
};

describe('the note for a room on another patch', () => {
  it('tells the room its players reload when this page is the latest', () => {
    const s = versionNote('5773WK', 'aaaaaaa', 'bbbbbbb', 'aaaaaaa');
    expect(s).toContain('You have the latest version');
    expect(s).toContain('its players need to reload');
    fits(s);
  });

  it('tells me to reload when the room is the latest', () => {
    const s = versionNote('5773WK', 'aaaaaaa', 'bbbbbbb', 'bbbbbbb');
    expect(s).toBe('Room 5773WK is on a newer version of the game. Reload the page to update.');
    fits(s);
  });

  it('says only "another version" when it cannot tell', () => {
    const plain = 'Room 5773WK is on another version of the game. Reload the page to update.';
    expect(versionNote('5773WK', 'aaaaaaa', 'bbbbbbb', null)).toBe(plain);
    expect(versionNote('5773WK', 'aaaaaaa', true, 'aaaaaaa')).toBe(plain);
    expect(versionNote('5773WK', 'aaaaaaa', 'bbbbbbb', 'ccccccc')).toBe(plain);
    fits(plain);
  });
});
