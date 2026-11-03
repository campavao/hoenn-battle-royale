import { describe, expect, it } from 'vitest';
import { FirstMenuNet, LostNet, NET_LIMITS } from './stuck';

describe('FirstMenuNet', () => {
  it('waits out a minute, then fires with no menu', () => {
    const n = new FirstMenuNet();
    expect(n.tick(0, 0, false)).toBe('wait');
    expect(n.tick(59_999, 3600, false)).toBe('wait');
    expect(n.tick(60_000, 3600, false)).toBe('fire');
  });

  it('is off for good once a menu has been up, even if it closes and a minute goes by', () => {
    const n = new FirstMenuNet();
    expect(n.tick(7_000, 430, true)).toBe('off');
    expect(n.tick(200_000, 12_000, false)).toBe('off');
    expect(n.seen).toBe(true);
  });

  it('does not cut a slow page that has run few frames, until the hard limit', () => {
    const n = new FirstMenuNet();
    // 5 frames a second for a minute: 300 frames, a long way short of the intro twice over.
    expect(n.tick(60_000, 300, false)).toBe('wait');
    expect(n.tick(120_000, 600, false)).toBe('wait');
    expect(n.tick(NET_LIMITS.ms * 6, 1799, false)).toBe('fire');
  });

  it('cuts a page that ran its frames at once', () => {
    const n = new FirstMenuNet();
    expect(n.tick(60_000, NET_LIMITS.frames, false)).toBe('fire');
    expect(n.tick(60_000, NET_LIMITS.frames - 1, false)).toBe('wait');
  });

  it('takes the limits it is given (a spec shortens them)', () => {
    const n = new FirstMenuNet();
    const l = { ms: 4000, frames: 60, hardMs: 9000 };
    expect(n.tick(3999, 600, false, l)).toBe('wait');
    expect(n.tick(4000, 600, false, l)).toBe('fire');
  });

  it('a menu on the same tick as the limit is a fight that got going', () => {
    expect(new FirstMenuNet().tick(70_000, 5000, true)).toBe('off');
  });
});

describe('LostNet', () => {
  it('counts a minute from the first time the page is lost', () => {
    const n = new LostNet();
    expect(n.tick(10_000, true)).toBe('wait');
    expect(n.tick(69_999, true)).toBe('wait');
    expect(n.tick(70_000, true)).toBe('fire');
  });

  it('starts over when the page is occupied again', () => {
    const n = new LostNet();
    n.tick(0, true);
    n.tick(50_000, false);
    expect(n.waitingSince).toBe(-1);
    expect(n.tick(55_000, true)).toBe('wait');
    expect(n.tick(114_999, true)).toBe('wait');
    expect(n.tick(115_000, true)).toBe('fire');
  });

  it('is off while the room does not say I fight', () => {
    expect(new LostNet().tick(1e9, false)).toBe('off');
  });
});
