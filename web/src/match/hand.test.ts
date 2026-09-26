import { describe, expect, it } from 'vitest';
import { World, type WorldMap } from '../bots/world';
import type { LandingCell } from './director';
import { cellKey, handJson, handProblems, rectCells, splitHand, walksTo, withoutVetoes, type HandRow } from './hand';

// Hand-built maps, as bots/world.test.ts builds them: a failure points at one cell rather
// than at Hoenn. Classes: 0 ground, 1 wall, 2 water, 3 a south-facing ledge, 9 a tree to
// cut. Heights are one hex digit a cell.
function grid(rows: string[], radix = 10): string {
  const cells = rows.join('').split('').map((c) => parseInt(c, radix));
  const tokens: string[] = [];
  for (let i = 0; i < cells.length; ) {
    let n = 1;
    while (i + n < cells.length && cells[i + n] === cells[i]) n++;
    tokens.push(`${n}x${cells[i]}`);
    i += n;
  }
  return tokens.join(';');
}

// A town. Its top-left two cells are a plateau at height 4 with no stair down, which a
// class-only flood walks straight onto; the right-hand column is walled off into a pocket;
// the bottom row is a pond and a tree to cut.
//
//   4 4 . # .
//   . . . # .
//   . . . # .
//   . . . ~ T
const TOWN: WorldMap = {
  id: 'TOWN', group: 0, num: 1, w: 5, h: 4, section: 'S', outdoor: true,
  grid: grid(['00010', '00010', '00010', '00029']),
  elev: grid(['44333', '33333', '33333', '33313'], 16),
  seams: [],
};
// A column with a ledge: from the top you jump it into a pit at height 4 you cannot climb
// back out of (a jump never asks the height; a step does).
const PIT: WorldMap = {
  id: 'PIT', group: 0, num: 2, w: 1, h: 3, section: 'S', outdoor: true,
  grid: grid(['0', '3', '0']),
  elev: grid(['3', '3', '4'], 16),
  seams: [],
};
const HOUSE: WorldMap = { ...TOWN, id: 'HOUSE', num: 3, outdoor: false };
const world = new World([TOWN, PIT, HOUSE]);
const maps = new Map([TOWN, PIT, HOUSE].map((m) => [m.id, m]));
const on = (flags: Uint8Array, m: WorldMap) =>
  [...flags].flatMap((f, i) => (f ? [`${i % m.w},${Math.floor(i / m.w)}`] : []));

describe('walksTo: where a drop can walk off to a cell the drop already deals', () => {
  it('keeps a plateau with no stair out, which a flood over the classes alone lets in', () => {
    const flags = walksTo(world, TOWN, [{ x: 2, y: 2 }]);
    expect(on(flags, TOWN)).toEqual(['2,0', '0,1', '1,1', '2,1', '0,2', '1,2', '2,2', '0,3', '1,3', '2,3']);
  });

  it('keeps out a walled-in pocket, and the pond, and the tree', () => {
    const flags = walksTo(world, TOWN, [{ x: 0, y: 3 }]);
    expect(flags[0 * TOWN.w + 4]).toBe(0);
    expect(flags[3 * TOWN.w + 3]).toBe(0);
    expect(flags[3 * TOWN.w + 4]).toBe(0);
  });

  it('runs towards the cells, not away from them: a pit you can jump into is not a way out', () => {
    // From the top the ledge drops you into the pit, so a flood OUT from the top reaches
    // it; nothing in the pit reaches the top.
    expect(on(walksTo(world, PIT, [{ x: 0, y: 0 }]), PIT)).toEqual(['0,0', '0,1']);
    // The other way round, everything up top gets down into it.
    expect(on(walksTo(world, PIT, [{ x: 0, y: 2 }]), PIT)).toEqual(['0,0', '0,1', '0,2']);
  });
});

describe('handProblems: a hand file held to the world it is dealt in', () => {
  const seeds: LandingCell[] = [{ map: 'TOWN', x: 2, y: 2 }, { map: 'PIT', x: 0, y: 0 }];
  const check = (rows: unknown[]) => handProblems(rows, maps, world, seeds);

  it('passes picks on the street and vetoes on anything feet could be on', () => {
    expect(check([
      { map: 'TOWN', x: 0, y: 1 },
      { map: 'TOWN', x: 2, y: 0 },
      { map: 'TOWN', x: 0, y: 0, veto: 1 }, // the plateau: nobody lands there anyway
      { map: 'TOWN', x: 4, y: 3, veto: 1 }, // a tree: somewhere with CUT
    ])).toEqual([]);
  });

  it('refuses a pick nobody can walk off: the plateau, the pocket, the pit', () => {
    expect(check([{ map: 'TOWN', x: 1, y: 0 }, { map: 'TOWN', x: 4, y: 1 }, { map: 'PIT', x: 0, y: 2 }])).toEqual([
      'pick TOWN:1,0: cannot walk from there to any cell the drop deals on its map -- a cliff top, a tree top or a pit',
      'pick TOWN:4,1: cannot walk from there to any cell the drop deals on its map -- a cliff top, a tree top or a pit',
      'pick PIT:0,2: cannot walk from there to any cell the drop deals on its map -- a cliff top, a tree top or a pit',
    ]);
  });

  it('refuses a pick on a wall, the water or a tree to cut, and a veto on a wall', () => {
    expect(check([
      { map: 'TOWN', x: 3, y: 0 },
      { map: 'TOWN', x: 3, y: 3 },
      { map: 'TOWN', x: 4, y: 3 },
      { map: 'TOWN', x: 3, y: 1, veto: 1 },
    ])).toEqual([
      'pick TOWN:3,0: not standable -- a wall, water or a tree to cut',
      'pick TOWN:3,3: not standable -- a wall, water or a tree to cut',
      'pick TOWN:4,3: not standable -- a wall, water or a tree to cut',
      'veto TOWN:3,1: a wall or water, where nobody lands anyway',
    ]);
  });

  it('takes the file\'s own vetoes off what a pick may walk to', () => {
    // The only cell the drop deals on TOWN, vetoed: nothing on TOWN walks out any more.
    expect(check([{ map: 'TOWN', x: 2, y: 2, veto: 1 }, { map: 'TOWN', x: 0, y: 1 }])).toEqual([
      'pick TOWN:0,1: cannot walk from there to any cell the drop deals on its map -- a cliff top, a tree top or a pit',
    ]);
  });

  it('refuses rows that are not rows, maps that are not there, and cells off the map or indoors', () => {
    expect(check([
      { map: 'TOWN', x: 0, y: 1, off: 1 },
      { map: 'TOWN', x: 0, y: 1, veto: true },
      { map: 'TOWN', x: '0', y: 1 },
      { map: 'NOWHERE', x: 0, y: 0 },
      { map: 'HOUSE', x: 0, y: 1 },
      { map: 'TOWN', x: 5, y: 0, veto: 1 },
    ])).toEqual([
      'row 0: {"map":"TOWN","x":0,"y":1,"off":1} is neither {map, x, y} nor {map, x, y, veto: 1}',
      'row 1: {"map":"TOWN","x":0,"y":1,"veto":true} is neither {map, x, y} nor {map, x, y, veto: 1}',
      'row 2: {"map":"TOWN","x":"0","y":1} is neither {map, x, y} nor {map, x, y, veto: 1}',
      'pick NOWHERE:0,0: there is no such map',
      'pick HOUSE:0,1: indoors, where the drop never goes',
      'veto TOWN:5,0: off the 5x4 map',
    ]);
  });

  it('refuses a cell written twice, or picked and vetoed both', () => {
    expect(check([
      { map: 'TOWN', x: 0, y: 1 },
      { map: 'TOWN', x: 0, y: 1 },
      { map: 'TOWN', x: 1, y: 1 },
      { map: 'TOWN', x: 1, y: 1, veto: 1 },
    ])).toEqual(['pick TOWN:0,1: written twice', 'TOWN:1,1: both picked and vetoed']);
  });
});

describe('the vetoes', () => {
  const all: LandingCell[] = [
    { map: 'TOWN', x: 0, y: 1 },
    { map: 'TOWN', x: 1, y: 1 },
    { map: 'TOWN', x: 2, y: 1, off: 1 },
    { map: 'TOWN', x: 2, y: 2, door: 0 },
    { map: 'TOWN', x: 1, y: 2, door: 1 },
  ];

  it('split off the picks', () => {
    const { picks, veto } = splitHand([{ map: 'TOWN', x: 0, y: 1 }, { map: 'TOWN', x: 1, y: 1, veto: 1 }]);
    expect(picks).toEqual([{ map: 'TOWN', x: 0, y: 1 }]);
    expect([...veto]).toEqual(['TOWN:1,1']);
  });

  it('come off both the ordinary cells and the doorsteps, and the flood\'s marks still hold', () => {
    const veto = new Set([cellKey({ map: 'TOWN', x: 1, y: 1 }), cellKey({ map: 'TOWN', x: 2, y: 2 })]);
    expect(withoutVetoes(all, veto)).toEqual({
      landing: [{ map: 'TOWN', x: 0, y: 1 }],
      doorsteps: [{ map: 'TOWN', x: 1, y: 2, door: 1 }],
    });
    expect(withoutVetoes(all, new Set())).toEqual({
      landing: [{ map: 'TOWN', x: 0, y: 1 }, { map: 'TOWN', x: 1, y: 1 }],
      doorsteps: [{ map: 'TOWN', x: 2, y: 2, door: 0 }, { map: 'TOWN', x: 1, y: 2, door: 1 }],
    });
  });
});

describe('the painter\'s pieces', () => {
  it('drags a rectangle from either corner', () => {
    const want = [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }];
    expect(rectCells({ x: 1, y: 2 }, { x: 3, y: 3 })).toEqual(want);
    expect(rectCells({ x: 3, y: 3 }, { x: 1, y: 2 })).toEqual(want);
    expect(rectCells({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });

  it('writes the file sorted, a row a line, and reads it back the same', () => {
    const rows: HandRow[] = [
      { map: 'TOWN', x: 2, y: 1, veto: 1 },
      { map: 'PIT', x: 0, y: 0 },
      { map: 'TOWN', x: 0, y: 1 },
      { map: 'TOWN', x: 1, y: 0 },
    ];
    const text = handJson(rows);
    expect(text).toBe(
      '[\n' +
        '{"map":"PIT","x":0,"y":0},\n' +
        '{"map":"TOWN","x":1,"y":0},\n' +
        '{"map":"TOWN","x":0,"y":1},\n' +
        '{"map":"TOWN","x":2,"y":1,"veto":1}\n' +
        ']\n',
    );
    expect(handJson(JSON.parse(text))).toBe(text);
    expect(handJson([])).toBe('[]\n');
  });
});
