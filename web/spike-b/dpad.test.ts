import { describe, expect, it } from 'vitest';
import { dpadKeys } from './dpad';

describe('dpadKeys', () => {
  it('reads the four arms and the diagonals between them', () => {
    expect(dpadKeys(0, -0.9)).toEqual(['up']);
    expect(dpadKeys(0, 0.9)).toEqual(['down']);
    expect(dpadKeys(-0.9, 0)).toEqual(['left']);
    expect(dpadKeys(0.9, 0)).toEqual(['right']);
    expect(dpadKeys(0.6, -0.6)).toEqual(['up', 'right']);
    expect(dpadKeys(-0.6, 0.6)).toEqual(['down', 'left']);
  });

  it('holds nothing near the middle', () => {
    expect(dpadKeys(0.2, -0.2)).toEqual([]);
  });

  it('takes a thumb a little off the arm as that arm', () => {
    expect(dpadKeys(0.3, -0.9)).toEqual(['up']);
  });
});
