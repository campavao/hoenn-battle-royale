import { describe, expect, it } from 'vitest';
import { PAD_DEFAULT, fadeStep, parsePadPrefs } from './padprefs';

describe("a phone's pad: where it sits, how see-through, whether it is there", () => {
  it('nothing stored, or garbage, is the default', () => {
    expect(parsePadPrefs(null)).toEqual(PAD_DEFAULT);
    expect(parsePadPrefs('{not json')).toEqual(PAD_DEFAULT);
    expect(parsePadPrefs('"a string"')).toEqual(PAD_DEFAULT);
  });

  it('keeps what was stored, each field checked on its own', () => {
    const p = parsePadPrefs(JSON.stringify({ stick: { dx: 12, dy: -40 }, ab: { dx: 'x' }, alpha: 5, hidden: true }));
    expect(p).toEqual({ stick: { dx: 12, dy: -40 }, ab: { dx: 0, dy: 0 }, alpha: 1, hidden: true });
  });

  it('fades in fifths, never past see-through to gone', () => {
    expect(fadeStep(0.6, -1)).toBe(0.4);
    expect(fadeStep(0.2, -1)).toBe(0.2);
    expect(fadeStep(0.8, 1)).toBe(1);
    expect(fadeStep(1, 1)).toBe(1);
  });
});
