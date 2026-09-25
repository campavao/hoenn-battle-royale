// The end-of-match grace on a clock the test holds (POK-330 #42). The room and solo both
// run this one, with their own lengths; these are the room's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EndGrace, type EndGraceOptions } from './grace';

const GRACE = 4_000;
const WIN_MAX = 60_000;
const POLL = 500;

function grace(paradeDone?: () => boolean): EndGrace {
  const opts: EndGraceOptions = { graceMs: GRACE, winMaxMs: WIN_MAX, pollMs: POLL };
  if (paradeDone) opts.paradeDone = paradeDone;
  return new EndGrace(opts);
}

describe('how long a decided match stays up', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes the exit once, when the grace runs out, and stays armed until cancelled', () => {
    const g = grace(() => true);
    const go = vi.fn();
    g.arm(go);
    expect(g.armed).toBe(true);
    vi.advanceTimersByTime(GRACE - 1);
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(go).toHaveBeenCalledTimes(1);
    // onAgain reads this: the exit it took is what cancels it, not the timer running out.
    expect(g.armed).toBe(true);
    vi.advanceTimersByTime(WIN_MAX);
    expect(go).toHaveBeenCalledTimes(1);
    g.cancel();
    expect(g.armed).toBe(false);
  });

  it('holds the champion for the parade, and goes at the first poll after it ends', () => {
    let done = false;
    const g = grace(() => done);
    const go = vi.fn();
    g.arm(go, true);
    vi.advanceTimersByTime(GRACE * 2);
    expect(go).not.toHaveBeenCalled();
    done = true;
    vi.advanceTimersByTime(POLL);
    expect(go).toHaveBeenCalledTimes(1);
    expect(g.armed).toBe(false);
    // The deadline went with it.
    vi.advanceTimersByTime(WIN_MAX);
    expect(go).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes the exit at the deadline when the parade never ends, and keeps polling until cancelled', () => {
    const paradeDone = vi.fn(() => false);
    const g = grace(paradeDone);
    const go = vi.fn();
    g.arm(go, true);
    vi.advanceTimersByTime(WIN_MAX - 1);
    expect(go).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(go).toHaveBeenCalledTimes(1);
    expect(g.armed).toBe(true);
    // The room's exit cancels it on the way out; left alone, the poll is still asking.
    const asked = paradeDone.mock.calls.length;
    vi.advanceTimersByTime(POLL);
    expect(paradeDone.mock.calls.length).toBe(asked + 1);
    g.cancel();
    expect(vi.getTimerCount()).toBe(0);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('gives a win the plain grace on a build with no parade to read', () => {
    const g = grace();
    const go = vi.fn();
    g.arm(go, true);
    vi.advanceTimersByTime(GRACE);
    expect(go).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops a grace already running when armed again, and cancel stops both halves', () => {
    const g = grace(() => false);
    const first = vi.fn();
    const second = vi.fn();
    g.arm(first, true);
    g.arm(second);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(WIN_MAX);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    const third = vi.fn();
    g.arm(third, true);
    expect(vi.getTimerCount()).toBe(2);
    g.cancel();
    expect(g.armed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(WIN_MAX);
    expect(third).not.toHaveBeenCalled();
  });
});
