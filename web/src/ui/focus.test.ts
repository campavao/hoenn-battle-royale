import { describe, expect, it } from 'vitest';
import { nextFocus } from './focus';

const box = (x: number, y: number, w = 10, h = 10) => ({ x, y, w, h });

describe('moving the focus', () => {
  // Moves in a 2 x 2, with PARTY, BAG and RUN down the right.
  const desk = [box(0, 0), box(20, 0), box(0, 20), box(20, 20), box(40, -5), box(40, 10), box(40, 25)];
  // The same on a phone: PARTY, BAG and RUN in a row under them.
  const phone = [box(0, 0), box(20, 0), box(0, 20), box(20, 20), box(0, 40), box(15, 40), box(30, 40)];

  it('goes the way pressed on either layout', () => {
    expect(nextFocus(desk, 0, 'right')).toBe(1);
    expect(nextFocus(desk, 0, 'down')).toBe(2);
    expect(nextFocus(desk, 1, 'right')).toBe(4);
    expect(nextFocus(desk, 3, 'right')).toBe(6);
    expect(nextFocus(phone, 2, 'down')).toBe(4);
    expect(nextFocus(phone, 3, 'down')).toBe(5);
    expect(nextFocus(phone, 4, 'right')).toBe(5);
  });

  it('stays put at an edge', () => {
    expect(nextFocus(desk, 0, 'left')).toBe(0);
    expect(nextFocus(phone, 0, 'up')).toBe(0);
    expect(nextFocus(phone, 6, 'right')).toBe(6);
  });

  it('starts on the first when nothing has the focus, and copes with nothing to focus', () => {
    expect(nextFocus(desk, -1, 'down')).toBe(0);
    expect(nextFocus([], -1, 'down')).toBe(-1);
  });
});
