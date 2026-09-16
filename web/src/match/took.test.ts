import { describe, expect, it } from 'vitest';
import { Loot } from './loot';
import { took } from './ticker';

// POK-268: the watcher's own page says what the trainer it is following picked up.
// The two halves that can be tested without a browser are "does the table know what
// was under that key" and "does the line read like a line".
describe('what the trainer you are watching took', () => {
  it('names the Pokemon in a ball, and the bag as a bag', () => {
    const loot = new Loot();
    loot.note({
      t: 'spill',
      seat: 3,
      map: { group: 0, num: 16 },
      // 286 is POOCHYENA in the bots' own pool -- the ROM's internal species ids, not
      // National Dex numbers -- so the page has a name for it. 1 is not in the pool,
      // and is the other half of this test.
      mons: [
        { key: 0x0301, x: 5, y: 5, species: 286, level: 12 },
        { key: 0x0303, x: 7, y: 5, species: 1, level: 12 },
      ],
      bag: { key: 0x0302, x: 6, y: 5, money: 500 },
    });
    expect(loot.describe(0x0301)).toBe('A POOCHYENA');
    // And one the page has no name for reads as a Pokemon rather than as a number.
    expect(loot.describe(0x0303)).toBe('A POKéMON');
    expect(loot.describe(0x0302)).toBe('A BAG');
  });

  it('says nothing about a key this page never saw land', () => {
    expect(new Loot().describe(0x4242)).toBeNull();
  });

  it('reads as a line', () => {
    expect(took(3, 'BRENDAN', 'A POOCHYENA')?.text).toBe('BRENDAN TOOK A POOCHYENA');
  });
});
