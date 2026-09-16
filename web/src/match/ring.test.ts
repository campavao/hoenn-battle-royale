import { describe, expect, it } from 'vitest';
import { sectionInside } from './ring';

const TOWN = { x: 4, y: 11, w: 1, h: 1 };
const ROUTE = { x: 5, y: 9, w: 1, h: 3 }; // a tall route, three sections of map high

describe('inside the ring (the same rule as br_ring.c)', () => {
  it('is inside while there is no ring at all', () => {
    expect(sectionInside(TOWN)).toBe(true);
  });

  it('is outside everywhere on the last phase', () => {
    expect(sectionInside(TOWN, { sx: 4, sy: 11, r: -1 })).toBe(false);
  });

  it('measures to the nearest corner of the section, not its middle', () => {
    // The route spans y 9..11; a ring centred at its bottom end contains it even
    // though the section's centre is two away.
    expect(sectionInside(ROUTE, { sx: 5, sy: 11, r: 0 })).toBe(true);
    expect(sectionInside(ROUTE, { sx: 5, sy: 13, r: 1 })).toBe(false);
    expect(sectionInside(ROUTE, { sx: 5, sy: 13, r: 2 })).toBe(true);
  });

  it('is a circle, not a square', () => {
    // (3,3) away is 18 > 16, so a radius of 4 does not reach the diagonal.
    expect(sectionInside(TOWN, { sx: 7, sy: 14, r: 4 })).toBe(false);
    expect(sectionInside(TOWN, { sx: 8, sy: 11, r: 4 })).toBe(true);
  });

  it('counts a place that is not on the region map as outside', () => {
    expect(sectionInside(undefined, { sx: 0, sy: 0, r: 30 })).toBe(false);
  });
});
