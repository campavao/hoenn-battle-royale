import { describe, expect, it } from 'vitest';
import { RING_RADII, nextRingRadius, ringLabel } from './clock';

describe('ringLabel', () => {
  it('names where the ring closes on as the safe place (POK-359)', () => {
    expect(ringLabel(28, 'ROUTE 101')).toBe('SAFE: ROUTE 101');
    expect(ringLabel(0, 'OLDALE TOWN')).toBe('SAFE: OLDALE TOWN');
  });

  it('calls the last ring, -1 "everywhere", the final fog rather than RING -1', () => {
    expect(ringLabel(RING_RADII[RING_RADII.length - 1], 'ROUTE 101')).toBe('FINAL FOG');
  });

  it('is just the fog while the ring names nowhere: the first ring, before it closes', () => {
    expect(ringLabel(28, undefined)).toBe('FOG');
    expect(ringLabel(undefined, undefined)).toBe('FOG');
  });
});

describe('nextRingRadius', () => {
  it('is the radius the ring shrinks to after each phase, and none after the last', () => {
    expect(RING_RADII.map((_, i) => nextRingRadius(i))).toEqual([15, 9, 7, 5, 3, 2, 0, -1, undefined]);
  });
});
