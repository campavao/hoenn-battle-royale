import { describe, expect, it } from 'vitest';
import { boxLines } from './msgbox';

describe('the message box (HBR-99)', () => {
  it("holds a ticker line on one line, as the live window does, and wraps a longer message to two", () => {
    expect(boxLines('Catch what you can! 120s')).toEqual(['Catch what you can! 120s']);
    expect(boxLines('ABCDEFG AND HIJKLMN ARE OUT - 32 LEFT')).toHaveLength(1);
    expect(boxLines('The ITEMFINDER responds! Something is buried north, 12 steps away.')).toEqual([
      'The ITEMFINDER responds! Something is',
      'buried north, 12 steps away.',
    ]);
  });
});
