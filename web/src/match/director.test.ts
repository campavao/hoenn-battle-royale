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
    // POK-307: a section the reachability flood left with nothing, which is what seven
    // of Hoenn's real towns look like -- every ordinary cell across water and marked off.
    { id: 'MAP_GAMMA', group: 0, num: 4, section: 'SEC_GAMMA', outdoor: true },
    // ...and one with no buildings either, which only a cave or an underwater route is.
    { id: 'MAP_DELTA', group: 0, num: 5, section: 'SEC_DELTA', outdoor: true },
  ],
  landing: [
    ...Array.from({ length: 40 }, (_, i) => ({ map: 'MAP_ALPHA', x: i, y: 0 })),
    ...Array.from({ length: 40 }, (_, i) => ({ map: 'MAP_BETA', x: i, y: 1 })),
    // an indoor map's cells must never be dealt or used as a ring centre
    { map: 'MAP_INDOOR', x: 5, y: 5 },
  ],
  // Ranked as landing-reach.ts ranks them: 0 centre, 1 mart, 2 gym, 3 any other door.
  doorsteps: [
    { map: 'MAP_GAMMA', x: 7, y: 7, door: 0 },
    { map: 'MAP_GAMMA', x: 8, y: 8, door: 1 },
    { map: 'MAP_GAMMA', x: 9, y: 9, door: 3 },
  ],
  sections: {
    SEC_ALPHA: { x: 0, y: 0, w: 2, h: 2, name: 'ALPHA', num: 1 },
    SEC_BETA: { x: 10, y: 10, w: 4, h: 4, name: 'BETA', num: 2 },
    SEC_GAMMA: { x: 11, y: 10, w: 1, h: 1, name: 'GAMMA', num: 3 },
    SEC_DELTA: { x: 12, y: 10, w: 1, h: 1, name: 'DELTA', num: 4 },
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

describe('picking up a match in progress (POK-252)', () => {
  it('does not deal anything again -- everybody already has a start', () => {
    const { director, sent } = harness([0, 1, 2], 42, { safariSecs: 60, fogSecs: 30 });
    director.resume({ ringPhase: 2, centre: { sx: 4, sy: 11 }, secsLeftInPhase: 12 });
    expect(sent.some((m) => m.t === 'start'), 'no second start').toBe(false);
    expect(director.state.phase).toBe('ring');
  });

  it('carries on from the phase it was handed, not from the first one', () => {
    const { director, sent, advance } = harness([0, 1, 2], 42, { safariSecs: 60, fogSecs: 30 });
    director.resume({ ringPhase: 3, centre: { sx: 4, sy: 11, place: 'ROUTE 110' }, secsLeftInPhase: 5 });
    // Five seconds left of phase 3, so nothing yet...
    advance(4_000);
    expect(sent.filter((m) => m.t === 'ring')).toHaveLength(0);
    // ...and then phase 4, rather than starting the ring over at 1.
    advance(2_000);
    const rings = sent.filter((m) => m.t === 'ring') as RingMsg[];
    expect(rings).toHaveLength(1);
    expect(rings[0].phase).toBe(4);
    // Same centre the old host chose: the fog does not move house mid-match.
    expect(rings[0].sx).toBe(4);
    expect(rings[0].sy).toBe(11);
  });

  it('keeps the dead dead, so N LEFT does not jump back up', () => {
    const { director } = harness([0, 1, 2, 3], 42, { safariSecs: 60, fogSecs: 30 });
    director.resume({ ringPhase: 1, centre: { sx: 4, sy: 11 }, secsLeftInPhase: 30, out: [2, 3] });
    expect(director.state.alive).toBe(2);
  });

  it('can be handed the opening instead, and finishes it', () => {
    const { director, sent, advance } = harness([0, 1], 42, { safariSecs: 60, fogSecs: 30 });
    director.resume({ ringPhase: 0, secsLeftInPhase: 3 });
    expect(director.state.phase).toBe('safari');
    advance(4_000);
    expect(sent.some((m) => m.t === 'ring'), 'the fog starts on time').toBe(true);
  });

  it('still ends the match it inherited', () => {
    const { director, sent, fireOut } = harness([0, 1], 42, { safariSecs: 60, fogSecs: 30 });
    director.resume({ ringPhase: 1, centre: { sx: 4, sy: 11 }, secsLeftInPhase: 20 });
    fireOut(1);
    const win = sent.find((m) => m.t === 'win') as WinMsg | undefined;
    expect(win?.seat).toBe(0);
  });
});


// POK-307. Cam picked Fortree City from the drop and landed on Route 117, forty maps
// away, behind the Day Care's fence. The fallback for a section with nothing standable
// in it was ANYWHERE IN HOENN -- and seven of the towns the picker offers are in that
// state, because the reachability flood walks and most of eastern Hoenn is across water.
describe('where a pick actually lands you (POK-307)', () => {
  const seats = [0, 1, 2, 3];

  it('lands in the section that was picked', () => {
    const { director } = harness(seats, 99);
    const land = director.landFor(0, 2);
    expect(land.map).toEqual({ group: 0, num: 2 }); // MAP_BETA, SEC_BETA
  });

  it('falls back to a doorstep IN THAT SECTION, not to another one', () => {
    const { director } = harness(seats, 99);
    const land = director.landFor(0, 3);
    expect(land.map).toEqual({ group: 0, num: 4 }); // MAP_GAMMA, and nowhere else
  });

  it('takes the nicest doorstep first, and a different one for the next trainer', () => {
    const { director } = harness(seats, 99);
    // A ranked list is walked in order rather than sampled: the CENTRE, then the MART.
    expect(director.landFor(0, 3)).toMatchObject({ x: 7, y: 7 });
    expect(director.landFor(1, 3)).toMatchObject({ x: 8, y: 8 });
    expect(director.landFor(2, 3)).toMatchObject({ x: 9, y: 9 });
  });

  it('gives the same seat the same section however many picked it', () => {
    const { director } = harness(seats, 7);
    for (const seat of seats) expect(director.landFor(seat, 3).map).toEqual({ group: 0, num: 4 });
  });

  it('never deals two trainers the same cell', () => {
    const { director } = harness(seats, 4242);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const l = director.landFor(i, 2);
      const key = `${l.map.num}:${l.x}:${l.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('a section with no cells and no buildings goes to the NEAREST section, not a random one', () => {
    const { director } = harness(seats, 99);
    // SEC_DELTA is at (12,10); SEC_BETA's centre is nearer than SEC_ALPHA's (0,0).
    const land = director.landFor(0, 4);
    expect(land.map).toEqual({ group: 0, num: 2 });
  });

  it('a section nobody has heard of still lands somewhere real', () => {
    const { director } = harness(seats, 99);
    const land = director.landFor(0, 255);
    expect([1, 2]).toContain(land.map.num);
  });
});

describe('hand-painted drop cells (POK-314)', () => {
  const painted: DirectorWorld = {
    ...world,
    hand: [
      { map: 'MAP_GAMMA', x: 1, y: 1 }, // a town the flood left with only doorsteps
      { map: 'MAP_GAMMA', x: 2, y: 2 },
      { map: 'MAP_ALPHA', x: 30, y: 30 }, // and one with plenty of ordinary cells
    ],
  };
  const make = (seed: number) =>
    new Director({ seats: [0, 1, 2], seed, world: painted, send: () => {}, now: () => 0, onOut: () => () => {} });

  it('beat doorsteps: a painted town drops on the painted cells, not the doors', () => {
    const d = make(99);
    const cells = [0, 1, 2].map((s) => d.landFor(s, 3));
    for (const c of cells) expect(c.map).toEqual({ group: 0, num: 4 });
    for (const c of cells) expect([1, 2]).toContain(c.x);
  });

  it('beat ordinary cells: a section with any painted cell deals only from them', () => {
    const d = make(7);
    for (let i = 0; i < 10; i++) expect(d.landFor(i, 1)).toMatchObject({ x: 30, y: 30 });
  });

  it('are sampled, not walked in click order', () => {
    // Over many seeds the first drop in GAMMA lands on both painted cells.
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => make(i * 31 + 1).landFor(0, 3).x));
    expect(firsts).toEqual(new Set([1, 2]));
  });

  it('leave an unpainted section exactly as it was', () => {
    const d = make(99);
    expect(d.landFor(0, 2).map).toEqual({ group: 0, num: 2 }); // BETA's ordinary cells
  });
});
