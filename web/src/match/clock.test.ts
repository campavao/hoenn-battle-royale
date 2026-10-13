import { describe, expect, it } from 'vitest';
import { RING_RADII, ringLabel } from './clock';

describe('ringLabel', () => {
  it('names the ring by its radius and where it closes on', () => {
    expect(ringLabel(28, 'ROUTE 101')).toBe('RING 28 (ROUTE 101)');
    expect(ringLabel(0, 'OLDALE TOWN')).toBe('RING 0 (OLDALE TOWN)');
  });

  it('calls the last ring, -1 "everywhere", the final fog rather than RING -1', () => {
    expect(ringLabel(RING_RADII[RING_RADII.length - 1], 'ROUTE 101')).toBe('FINAL FOG');
  });

  it('says what it does not know', () => {
    expect(ringLabel(undefined, undefined)).toBe('RING ? (?)');
  });
});
