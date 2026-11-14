import { describe, expect, it } from 'vitest';
import { shiftCells } from './cells';
import type { Msg } from './wire';

describe('the seven tiles between the two maps', () => {

  it('hands back anything with no cell in it, unchanged and the same object', () => {
    const out = { t: 'out', seat: 4 } as unknown as Msg;
    expect(shiftCells(out, 7)).toBe(out);
  });
});
