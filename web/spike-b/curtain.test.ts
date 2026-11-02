import { describe, expect, it } from 'vitest';
import { curtainRise, curtainSize, HOLD_MS, RISE_PER_FRAME } from './curtain';

describe('the curtain', () => {
  it('is whole pixels, its 160 rows fitting the height', () => {
    expect(curtainSize(1920, 1080)).toEqual({ scale: 6, cols: 320, rows: 180 });
    expect(curtainSize(390, 844)).toEqual({ scale: 5, cols: 78, rows: 169 });
    expect(curtainSize(800, 120)).toEqual({ scale: 1, cols: 800, rows: 120 });
  });

  it("hangs, then goes up at the contest's 7 pixels a frame", () => {
    expect(curtainRise(0)).toBe(0);
    expect(curtainRise(HOLD_MS)).toBe(0);
    expect(curtainRise(HOLD_MS + 1000)).toBeCloseTo(60 * RISE_PER_FRAME);
  });

  it('is gone in under a second on any window', () => {
    const { rows } = curtainSize(1920, 1080);
    expect(curtainRise(1000)).toBeGreaterThanOrEqual(rows);
  });
});
