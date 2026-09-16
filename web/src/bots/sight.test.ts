import { describe, expect, it } from 'vitest';
import { eitherSees, sees, SIGHT_RANGE } from './sight';
import { World, type WorldMap } from './world';

function grid(rows: string[]): string {
  const cells = rows.join('').split('').map(Number);
  const tokens: string[] = [];
  for (let i = 0; i < cells.length; ) {
    let n = 1;
    while (i + n < cells.length && cells[i + n] === cells[i]) n++;
    tokens.push(`${n}x${cells[i]}`);
    i += n;
  }
  return tokens.join(';');
}

// A 9x3 hall with one pillar at (4, 1) -- long enough to run out of range in, and
// blocked exactly once so the wall rule has something to stop at.
const HALL: WorldMap = {
  id: 'HALL', group: 0, num: 1, w: 9, h: 3, section: 'S', outdoor: true,
  grid: grid(['000000000', '000010000', '000000000']),
  seams: [],
};
const world = new World([HALL]);

describe('the eyeline', () => {
  it('reaches exactly BR_SIGHT_RANGE cells and no further', () => {
    const from = { map: 'HALL', x: 0, y: 0, dir: 4 as const };
    expect(sees(world, from, SIGHT_RANGE, 0)).toBe(true);
    expect(sees(world, from, SIGHT_RANGE + 1, 0)).toBe(false);
  });

  it('does not see through a wall', () => {
    // Along row 1 the pillar at x=4 stops the look before x=6.
    expect(sees(world, { map: 'HALL', x: 1, y: 1, dir: 4 }, 6, 1)).toBe(false);
    // The same distance one row up is clear.
    expect(sees(world, { map: 'HALL', x: 1, y: 0, dir: 4 }, 6, 0)).toBe(true);
  });

  it('only looks the way it is facing', () => {
    expect(sees(world, { map: 'HALL', x: 4, y: 0, dir: 3 }, 2, 0)).toBe(true);
    expect(sees(world, { map: 'HALL', x: 4, y: 0, dir: 4 }, 2, 0)).toBe(false);
  });

  it('is either of them seeing the other, and never across a map', () => {
    const a = { map: 'HALL', x: 0, y: 0, dir: 4 as const };
    const b = { map: 'HALL', x: 3, y: 0, dir: 4 as const }; // looking away
    expect(eitherSees(world, a, b)).toBe(true);
    expect(eitherSees(world, { ...a, map: 'ELSEWHERE' }, b)).toBe(false);
  });
});
