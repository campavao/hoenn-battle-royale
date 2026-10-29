import { describe, expect, it } from 'vitest';
import { MusicCue, type Where } from './music';

const at = (w: Partial<Where>): Where => ({ group: 0, num: 16, x: 5, surf: false, bike: false, door: false, ...w });

describe('MusicCue', () => {
  it('starts at once, then fades at 8 over a map edge', () => {
    const c = new MusicCue();
    expect(c.next(at({}))).toEqual({ asked: 1, how: 0, group: 0, num: 16, x: 5 });
    expect(c.next(at({ x: 6 }))).toEqual({ asked: 1, how: 0, group: 0, num: 16, x: 5 });
    expect(c.next(at({ num: 17, x: 0 }))).toEqual({ asked: 1, how: 8, group: 0, num: 17, x: 0 });
  });

  it('keeps the column the map was entered at (ROUTE118 picks its song on entry)', () => {
    const c = new MusicCue();
    c.next(at({ num: 33, x: 10 }));
    expect(c.next(at({ num: 33, x: 40 }))?.x).toBe(10);
  });

  it('fades out for a door and holds that past the landing', () => {
    const c = new MusicCue();
    c.next(at({}));
    expect(c.next(at({ group: 17, num: 0, x: 3, door: true }))).toEqual({ asked: 1, how: 15, group: 17, num: 0, x: 3 });
    expect(c.next(at({ group: 17, num: 0, x: 3 }))?.how).toBe(15);
  });

  it('gets on the bike with a fade, off at once, and crossfades over an edge on it', () => {
    const c = new MusicCue();
    c.next(at({}));
    expect(c.next(at({ bike: true }))).toEqual({ asked: 5, how: 8, group: 0, num: 16, x: 5 });
    expect(c.next(at({ bike: true, num: 17 }))?.how).toBe(0x44);
    expect(c.next(at({ num: 17 }))).toEqual({ asked: 1, how: 0, group: 0, num: 17, x: 5 });
  });

  it('fades to SURF on the water and back off it', () => {
    const c = new MusicCue();
    c.next(at({}));
    expect(c.next(at({ surf: true }))).toEqual({ asked: 3, how: 8, group: 0, num: 16, x: 5 });
    expect(c.next(at({}))?.how).toBe(8);
  });

  it('asks nothing without a trainer, and starts at once after', () => {
    const c = new MusicCue();
    c.next(at({ num: 17 }));
    expect(c.next(null)).toBeNull();
    expect(c.next(at({}))?.how).toBe(0);
  });
});
