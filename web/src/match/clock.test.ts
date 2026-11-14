import { describe, expect, it } from 'vitest';
import { mulberry32, RING_RADII, nextRingRadius } from './clock';

describe('nextRingRadius', () => {
  it('is the radius the ring shrinks to after each phase, and none after the last', () => {
    expect(RING_RADII.map((_, i) => nextRingRadius(i))).toEqual([15, 9, 7, 5, 3, 2, 0, -1, undefined]);
  });
});

describe('mulberry32 picked up where it left off (HBR-20)', () => {
  it('draws on as the one it was taken from', () => {
    const a = mulberry32(42);
    for (let i = 0; i < 17; i++) a();
    const b = mulberry32(0, a.state());
    expect([b(), b(), b()]).toEqual([a(), a(), a()]);
  });
});
