import { describe, expect, it } from 'vitest';
import { Director, type DirectorWorld } from './director';
import type { ClockMsg, Msg, RingMsg, StartMsg, WinMsg } from '../net/wire';

// A small synthetic world -- not the real regionmap.json/landing.json/world.json,
// which would make the deal/ring math untestable (thousands of cells, real Hoenn
// section names). Two outdoor sections, 40 distinct landing cells each, one indoor
// map that must never be dealt from.
const world: DirectorWorld = {
  maps: [
    { id: 'MAP_ALPHA', group: 0, num: 1, section: 'SEC_ALPHA', outdoor: true },
    { id: 'MAP_BETA', group: 0, num: 2, section: 'SEC_BETA', outdoor: true },
    { id: 'MAP_INDOOR', group: 0, num: 3, section: 'SEC_ALPHA', outdoor: false },
  ],
  landing: [
    ...Array.from({ length: 40 }, (_, i) => ({ map: 'MAP_ALPHA', x: i, y: 0 })),
    ...Array.from({ length: 40 }, (_, i) => ({ map: 'MAP_BETA', x: i, y: 1 })),
    // an indoor map's cells must never be dealt or used as a ring centre
    { map: 'MAP_INDOOR', x: 5, y: 5 },
  ],
  sections: {
    SEC_ALPHA: { x: 0, y: 0, w: 2, h: 2, name: 'ALPHA' },
    SEC_BETA: { x: 10, y: 10, w: 4, h: 4, name: 'BETA' },
  },
};

/** A fake clock plus a recording `send` -- every test advances `t` by hand and
 *  calls `director.tick()`, exactly the contract `tick`'s own doc comment states. */
function harness(seats: number[], seed: number, options?: { safariSecs?: number; fogSecs?: number }) {
  let t = 0;
  const sent: Msg[] = [];
  let outHandler: ((seat: number) => void) | undefined;
  const director = new Director({
    seats,
    seed,
    options,
    world,
    send: (m) => sent.push(m),
    now: () => t,
    onOut: (h) => {
      outHandler = h;
      return () => {
        outHandler = undefined;
      };
    },
  });
  return {
    director,
    sent,
    advance: (ms: number) => {
      t += ms;
      director.tick();
    },
    fireOut: (seat: number) => outHandler?.(seat),
  };
}

describe('Director dealing (POK-223)', () => {
  it('deals one distinct landing cell per seat, drawn from the outdoor sections', () => {
    const seats = Array.from({ length: 30 }, (_, i) => i);
    const h = harness(seats, 42);
    h.director.start();

    const start = h.sent.find((m) => m.t === 'start') as StartMsg;
    expect(start.spawns).toHaveLength(30);

    const keys = new Set(start.spawns.map((s) => `${s.map.group}:${s.map.num}:${s.x}:${s.y}`));
    expect(keys.size).toBe(30); // all distinct

    for (const s of start.spawns) {
      expect([1, 2]).toContain(s.map.num); // never MAP_INDOOR (num 3)
    }
  });

  it('is reproducible from the same seed', () => {
    const seats = [0, 1, 2, 3, 4];
    const a = harness(seats, 123);
    const b = harness(seats, 123);
    a.director.start();
    b.director.start();
    expect((a.sent[0] as StartMsg).spawns).toEqual((b.sent[0] as StartMsg).spawns);
  });
});

describe('Director Safari clock (POK-222)', () => {
  it('ticks the countdown down every 5s and ends at 0', () => {
    const h = harness([0, 1], 1, { safariSecs: 20, fogSecs: 30 });
    h.director.start();
    for (let i = 0; i < 4; i++) h.advance(5000);

    const clocks = h.sent.filter((m) => m.t === 'clock') as ClockMsg[];
    expect(clocks.map((c) => c.left)).toEqual([15, 10, 5, 0]);
  });

  it('does not tick early, and catches up if tick() is called late', () => {
    const h = harness([0, 1], 1, { safariSecs: 20, fogSecs: 30 });
    h.director.start();
    h.advance(4999);
    expect(h.sent.filter((m) => m.t === 'clock')).toHaveLength(0);
    h.advance(9999); // now at 14998ms total: two 5s steps have come due at once
    expect((h.sent.filter((m) => m.t === 'clock') as ClockMsg[]).map((c) => c.left)).toEqual([15, 10]);
  });
});

describe('Director ring (POK-224)', () => {
  it('advances through the radius table every fogSecs, ending at -1, around one fixed centre', () => {
    const h = harness([0, 1], 7, { safariSecs: 5, fogSecs: 10 });
    h.director.start();
    h.advance(5000); // safari ends here; ring phase 1 (r=15) fires immediately
    for (let i = 0; i < 8; i++) h.advance(10000);

    const rings = h.sent.filter((m) => m.t === 'ring') as RingMsg[];
    expect(rings.map((r) => r.r)).toEqual([15, 9, 7, 5, 3, 2, 0, -1]);
    expect(rings.map((r) => r.phase)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const centres = new Set(rings.map((r) => `${r.sx},${r.sy}`));
    expect(centres.size).toBe(1); // shrinks in place, never recentres

    const before = rings.length;
    h.advance(10000);
    expect(h.sent.filter((m) => m.t === 'ring')).toHaveLength(before); // stops at "everywhere"
  });
});

describe('Director elimination and the winner (POK-228)', () => {
  it('keeps elimination order and declares the last seat standing the winner', () => {
    const h = harness([0, 1, 2], 3);
    h.director.start();

    h.fireOut(1);
    h.fireOut(2);

    const win = h.sent.find((m) => m.t === 'win') as WinMsg;
    expect(win.seat).toBe(0);
    expect(h.director.state.placements).toEqual([1, 2]);
    expect(h.director.state.phase).toBe('ended');
    expect(h.director.state.alive).toBe(1);
  });

  it('ignores a repeated or unknown out for the same seat', () => {
    const h = harness([0, 1, 2], 3);
    h.director.start();
    h.fireOut(1);
    h.fireOut(1); // already out
    h.fireOut(9); // not in this match
    expect(h.director.state.placements).toEqual([1]);
    expect(h.director.state.phase).toBe('safari'); // 2 still alive, not decided
  });
});

describe('Director in solo (one seat)', () => {
  it('emits start, then clocks, then rings, and never wins itself out', () => {
    const h = harness([0], 9, { safariSecs: 10, fogSecs: 10 });
    h.director.start();
    for (let i = 0; i < 4; i++) h.advance(5000);

    expect(h.sent[0].t).toBe('start');
    expect(h.sent.slice(1).map((m) => m.t)).toEqual(['clock', 'clock', 'ring', 'ring']);
    expect(h.sent.some((m) => m.t === 'win')).toBe(false);
  });
});
