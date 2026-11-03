import { describe, expect, it } from 'vitest';
import { boxLines, keptOf, revealed } from './msgbox';

describe('the message box (HBR-99)', () => {
  it("keeps what it has printed when the words go on from it, as the rod's dots do", () => {
    expect(keptOf(['· ·'], 3, ['· · ·'])).toBe(3);
    expect(keptOf(['· · ·'], 2, ['· · ·', 'Oh! A bite!'])).toBe(2);
    expect(keptOf(['· · ·', 'Oh! A bite!'], 16, ['Not even a nibble…'])).toBe(0);
    expect(keptOf([], 0, ['Anything'])).toBe(0);
  });

  it("holds a ticker line on one line, as the live window does, and wraps a longer message to two", () => {
    expect(boxLines('Catch what you can! 120s')).toEqual(['Catch what you can! 120s']);
    expect(boxLines('ABCDEFG AND HIJKLMN ARE OUT - 32 LEFT')).toHaveLength(1);
    expect(boxLines('The ITEMFINDER responds! Something is buried north, 12 steps away.')).toEqual([
      'The ITEMFINDER responds! Something is',
      'buried north, 12 steps away.',
    ]);
  });
  it('prints a character at a time, the second line after the first', () => {
    expect(revealed(['Here,', 'take'], 0)).toEqual(['', '']);
    expect(revealed(['Here,', 'take'], 3)).toEqual(['Her', '']);
    expect(revealed(['Here,', 'take'], 7)).toEqual(['Here,', 'ta']);
    expect(revealed(['Here,', 'take'], 99)).toEqual(['Here,', 'take']);
  });
  it('a line break starts the second line', () => {
    expect(boxLines('· · · ·\nOh! A bite!')).toEqual(['· · · ·', 'Oh! A bite!']);
  });
});
