import { describe, expect, it } from 'vitest';
import { mulberry32 } from './clock';
import { GOLD } from './events';
import { isScatterKey, scatterDrop, scatterItem, SCATTER_TABLE } from './scatter';
import type { SpillMsg } from '../net/wire';

describe('items lying about (POK-354)', () => {
  it('are one-item bags on scatter keys, where they were dealt', () => {
    const spots = [
      { map: { group: 0, num: 16 }, x: 3, y: 4 },
      { map: { group: 0, num: 16 }, x: 9, y: 2 },
    ];
    const msgs = scatterDrop(mulberry32(5), 2, spots) as SpillMsg[];
    expect(msgs.map((m) => m.bag!.key)).toEqual([0xd000, 0xd001]);
    expect(msgs.every((m) => isScatterKey(m.bag!.key) && m.mons.length === 0 && m.seat === 2)).toBe(true);
    expect(msgs.map((m) => [m.bag!.x, m.bag!.y])).toEqual([[10, 11], [16, 9]]); // MAP_OFFSET on
    expect(msgs.every((m) => m.bag!.items.length === 1 && m.bag!.items[0].n === 1 && m.bag!.money === 0)).toBe(true);
  });

  it('come off the table, and a machine is never a gold one', () => {
    const rng = mulberry32(11);
    const ids = new Set(SCATTER_TABLE.flatMap((r) => (r.id === 'tm' ? [] : [r.id])));
    let tms = 0;
    for (let i = 0; i < 2000; i++) {
      const item = scatterItem(rng);
      if (item >= 289 && item < 339) {
        tms++;
        expect(GOLD).not.toContain(item);
      } else expect(ids.has(item)).toBe(true);
    }
    expect(tms).toBeGreaterThan(100); // 3 in 31
    expect(isScatterKey(0xc000)).toBe(false); // a gift-giver's
    expect(isScatterKey(0xb000)).toBe(false); // an event's
  });
});
