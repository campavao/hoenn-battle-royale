import { describe, expect, it } from 'vitest';
import { Curtain } from './curtain';

const at = (now: number, onField: boolean, inMatch = true) => ({ now, onField, inMatch });

describe('the curtain over a match drop (POK-346)', () => {
  it("holds through a room START's fade out of the town, and lets go back on the field", () => {
    const c = new Curtain(0);
    expect(c.step(at(0, true))).toBe(true); // the town, fading
    expect(c.step(at(16, true))).toBe(true);
    expect(c.step(at(400, false))).toBe(true); // the warp's map load
    expect(c.step(at(900, true))).toBe(false); // the drop map, fading in
    expect(c.step(at(916, false))).toBe(false); // gone for good: a battle later is not ours
  });

  it("holds through solo's copyright screen, before the match is on", () => {
    const c = new Curtain(0);
    expect(c.step(at(0, false, false))).toBe(true);
    expect(c.step(at(300, true, false))).toBe(true); // a field before the match counts for nothing
    expect(c.step(at(600, false, true))).toBe(true);
    expect(c.step(at(1200, true, true))).toBe(false);
  });

  it('gives up on a ROM that never warps', () => {
    const c = new Curtain(0, 1000);
    expect(c.step(at(999, true))).toBe(true);
    expect(c.step(at(1000, true))).toBe(false);
  });
});
