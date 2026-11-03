import { describe, expect, it } from 'vitest';
import { curtainFall, curtainLines, curtainRise, curtainSize, HOLD_BOX_MS, HOLD_MS, RISE_PER_FRAME } from './curtain';

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

  it('hangs longer with a box to read', () => {
    expect(curtainRise(HOLD_BOX_MS, HOLD_BOX_MS)).toBe(0);
    expect(curtainRise(HOLD_MS + 1000, HOLD_BOX_MS)).toBe(0);
  });

  it('comes down at the pace it goes up, and stops', () => {
    expect(curtainFall(0, 160)).toBe(0);
    expect(curtainFall(1000, 500)).toBeCloseTo(60 * RISE_PER_FRAME);
    expect(curtainFall(60_000, 160)).toBe(160);
  });

  it('says how many are playing, the same line on every page of a room', () => {
    expect(curtainLines(1, 7)[0]).toBe('1 TRAINER');
    expect(curtainLines(30, 7)[0]).toBe('30 TRAINERS');
    expect(curtainLines(30, 7)).toEqual(curtainLines(30, 7));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => curtainLines(30, seed)[1])).size).toBeGreaterThan(1);
  });

  it('is gone in under a second on any window', () => {
    const { rows } = curtainSize(1920, 1080);
    expect(curtainRise(1000)).toBeGreaterThanOrEqual(rows);
  });
});
