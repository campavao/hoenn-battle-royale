import { describe, expect, it } from 'vitest';
import { JankMeter, STALL_MS } from './jank';

const at = (x: number, y: number, m: unknown = 'mover', warp = false, id = 1) => ({ id, x, y, m, warp });

describe('the jank meter', () => {
  it('a walk is no snap, a jump is, and the camera has its own count', () => {
    const j = new JankMeter();
    j.look([at(5, 5), at(9, 9, 'b', false, 2)], 1, 0);
    j.look([at(6, 5), at(9, 9, 'b', false, 2)], 1, 0);
    j.look([at(7, 5), at(40, 9, 'b', false, 2)], 1, 0);
    expect(j.counts()).toMatchObject({ snaps: 1, cam: 0 });
    j.look([at(30, 30), at(40, 9, 'b', false, 2)], 1, 0);
    expect(j.counts()).toMatchObject({ snaps: 2, cam: 1 });
  });

  it('a warp, or a Room that moved them on purpose (a new mover), is no snap', () => {
    const j = new JankMeter();
    j.look([at(5, 5)], 1, 0);
    j.look([at(500, 5, 'mover', true)], 1, 0);
    j.look([at(5, 500, 'flew')], 1, 0);
    expect(j.counts().snaps).toBe(0);
  });

  it('a resync that jumps them is counted, new movers and all', () => {
    const j = new JankMeter();
    j.look([at(5, 5)], 1, 0);
    j.look([at(25, 5, 'loaded')], 1, 1);
    expect(j.counts()).toMatchObject({ snaps: 1, cam: 1, lost: 1 });
    // Nobody moved far on the next one: one resync, one snap.
    j.look([at(26, 5, 'loaded')], 1, 1);
    expect(j.counts()).toMatchObject({ snaps: 1, lost: 1 });
  });

  it('counts a Room that stands still for a page that can see it, and the longest', () => {
    const j = new JankMeter();
    j.clock(1, 0, false);
    j.clock(2, 16, false);
    j.clock(3, 16 + STALL_MS - 1, false);
    expect(j.counts().stalls).toBe(0);
    j.clock(3, 3000, false);
    j.clock(4, 3400, false);
    expect(j.counts()).toMatchObject({ stalls: 1, longest: 3 });
  });

  it('waives a hidden page its gap', () => {
    const j = new JankMeter();
    j.clock(1, 0, false);
    j.clock(1, 60_000, true);
    j.clock(2, 60_016, false);
    expect(j.counts().stalls).toBe(0);
  });

  it('adds up what was watched, in whole seconds', () => {
    const j = new JankMeter();
    for (let i = 0; i < 100; i++) j.watching(16);
    expect(j.counts().watched).toBe(1);
  });
});
