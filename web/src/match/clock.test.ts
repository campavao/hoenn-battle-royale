import { describe, expect, it } from 'vitest';
import { mulberry32, RING_RADII, nextRingRadius, ringLabel, winLabel } from './clock';

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

describe('winLabel', () => {
  const nameOf = (seat: number) => (seat === 3 ? 'SCOTT' : `P${seat}`);
  it('our own win says so, never our seat number (10-19 play-test #27)', () => {
    expect(winLabel(1, 1, nameOf)).toBe('YOU WIN');
  });
  it("somebody else's names them", () => {
    expect(winLabel(3, 1, nameOf)).toBe('SCOTT WINS');
  });
  it('no seat is a draw, and a watcher with no seat still reads the name', () => {
    expect(winLabel(undefined, 1, nameOf)).toBe('DRAW');
    expect(winLabel(3, null, nameOf)).toBe('SCOTT WINS');
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
