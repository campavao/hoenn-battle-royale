import { describe, expect, it } from 'vitest';
import { clampZoom, loadZoom, nextZoom, pickedZoom, saveZoom, wheelSteps, zoomLabel, zoomRange } from './zoom';

const memory = (v: string | null = null) => {
  let held = v;
  return { getItem: () => held, setItem: (_: string, x: string) => { held = x; } };
};

describe('how close the player may choose', () => {
  it('a 1080p window: from its default, far out, to the GBA filling it', () => {
    expect(zoomRange(1920, 1080, 2)).toEqual({ lo: 2, hi: 6 });
  });

  it("a phone: from its default out to what a desktop sees, never past Emerald's own view", () => {
    expect(zoomRange(1170, 2532, 4)).toEqual({ lo: 3, hi: 4 });
    expect(zoomRange(780, 1688, 3)).toEqual({ lo: 2, hi: 3 });
  });

  it('a window whose default is wider than the limit keeps its default', () => {
    expect(zoomRange(3840, 2160, 2)).toEqual({ lo: 2, hi: 13 });
  });

  it('a window too small for the GBA still has its default', () => {
    expect(zoomRange(200, 150, 1)).toEqual({ lo: 1, hi: 1 });
  });
});

describe('the choice', () => {
  const r = { lo: 2, hi: 6 };

  it('is the default until there is one, and stays inside this window', () => {
    expect(pickedZoom(null, 2, r)).toBe(2);
    expect(pickedZoom(4, 2, r)).toBe(4);
    expect(pickedZoom(9, 2, r), 'saved on a bigger window').toBe(6);
    expect(pickedZoom(1, 2, r)).toBe(2);
  });

  it('stops at the ends by key and wheel, and the row wraps', () => {
    expect(clampZoom(7, r)).toBe(6);
    expect(clampZoom(1, r)).toBe(2);
    expect(nextZoom(5, r)).toBe(6);
    expect(nextZoom(6, r)).toBe(2);
  });

  it('reads as a place on the scale, not device pixels', () => {
    expect(zoomLabel(2, r)).toBe('1/5');
    expect(zoomLabel(6, r)).toBe('5/5');
  });

  it('keeps across a reload, and a bad or blocked store is no choice', () => {
    const s = memory();
    expect(loadZoom(s)).toBeNull();
    saveZoom(s, 4);
    expect(loadZoom(s)).toBe(4);
    expect(loadZoom(memory('junk'))).toBeNull();
    expect(loadZoom(memory('0'))).toBeNull();
    expect(loadZoom(memory('2.5'))).toBeNull();
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadZoom(blocked)).toBeNull();
    expect(() => saveZoom(blocked, 4)).not.toThrow();
  });
});

describe('the wheel', () => {
  it('a notch back is one step out, a notch forward one in', () => {
    expect(wheelSteps(0, 100)).toEqual({ steps: -1, rest: 0 });
    expect(wheelSteps(0, -100)).toEqual({ steps: 1, rest: 0 });
  });

  it("a trackpad's small deltas add up to a step", () => {
    const a = wheelSteps(0, 40);
    expect(a.steps).toBe(0);
    const b = wheelSteps(a.rest, 40);
    expect(b.steps).toBe(0);
    const c = wheelSteps(b.rest, 40);
    expect(c.steps).toBe(-1);
    expect(c.rest).toBe(20);
  });
});
