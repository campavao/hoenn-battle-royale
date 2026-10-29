import { describe, expect, it } from 'vitest';
import { BAG_AT, BAG_LEN, arrived, rekey, spillOf, teamOf, withMoney } from './carry';

describe('rekey', () => {
  it('carries money, coins and pocket counts from one key to another, and nothing else', () => {
    const k1 = 0x89abcdef, k2 = 0x13572468;
    const plain = new Uint8Array(BAG_LEN);
    const v = new DataView(plain.buffer);
    v.setUint32(0, 3000, true); // money
    v.setUint16(4, 77, true); // coins
    v.setUint16(6, 0x1234, true); // the registered item
    v.setUint16(8, 13, true); v.setUint16(10, 5, true); // a PC slot: not keyed
    const balls = 0x650 - 0x490;
    v.setUint16(balls, 4, true); v.setUint16(balls + 2, 5, true); // POKé BALL x5
    const keyed = (k: number) => {
      const b = plain.slice();
      const d = new DataView(b.buffer);
      d.setUint32(0, d.getUint32(0, true) ^ k, true);
      d.setUint16(4, d.getUint16(4, true) ^ (k & 0xffff), true);
      for (let at = 0x560 - 0x490; at < BAG_LEN; at += 4) d.setUint16(at + 2, d.getUint16(at + 2, true) ^ (k & 0xffff), true);
      return b;
    };
    const out = rekey(keyed(k1), k1, k2);
    expect([...out]).toEqual([...keyed(k2)]);
    const d = new DataView(out.buffer);
    expect((d.getUint32(0, true) ^ k2) >>> 0).toBe(3000);
    expect(d.getUint16(4, true) ^ (k2 & 0xffff)).toBe(77);
    expect(d.getUint16(6, true)).toBe(0x1234);
    expect([d.getUint16(8, true), d.getUint16(10, true)]).toEqual([13, 5]);
    expect([d.getUint16(balls, true), d.getUint16(balls + 2, true) ^ (k2 & 0xffff)]).toEqual([4, 5]);
  });

  it('is a copy, and the same key changes nothing', () => {
    const b = new Uint8Array(BAG_LEN).map((_, i) => i * 7);
    const out = rekey(b, 5, 5);
    expect(out).not.toBe(b);
    expect([...out]).toEqual([...b]);
  });
});

describe('arrived', () => {
  const bag = (key: number, money: number, slots: [number, number, number][]) => {
    const b = new Uint8Array(BAG_LEN);
    const v = new DataView(b.buffer);
    v.setUint32(0, (money ^ key) >>> 0, true);
    for (const [at, id, n] of slots) { v.setUint16(at - 0x490, id, true); v.setUint16(at - 0x490 + 2, n ^ (key & 0xffff), true); }
    return { bag: b, key };
  };
  it('reads what went in as the ROM filed it, and money made', () => {
    const k = 0x5a5a1234;
    const before = bag(k, 3000, [[0x650, 4, 5]]);
    expect(arrived(before, bag(k, 3000, [[0x650, 4, 11]]))).toEqual({ items: [{ id: 4, n: 6 }], money: 0 });
    expect(arrived(before, bag(k, 3000, [[0x560, 19, 1], [0x650, 4, 5]]))).toEqual({ items: [{ id: 19, n: 1 }], money: 0 });
    expect(arrived(before, bag(k, 8000, [[0x650, 4, 5]]))).toEqual({ items: [], money: 5000 });
    expect(arrived(before, before)).toEqual({ items: [], money: 0 });
  });
});

describe('spillOf', () => {
  it('reads the items, balls and berries pockets and the money; not key items or machines', () => {
    const key = 0x1234abcd;
    const bag = new Uint8Array(BAG_LEN);
    const v = new DataView(bag.buffer);
    const slot = (at: number, id: number, n: number) => { v.setUint16(at - BAG_AT, id, true); v.setUint16(at - BAG_AT + 2, n ^ (key & 0xffff), true); };
    v.setUint32(0, (5000 ^ key) >>> 0, true);
    slot(0x560, 13, 2); // POTION
    slot(0x5d8, 261, 1); // a key item
    slot(0x650, 4, 6); // POKé BALL
    slot(0x690, 289, 1); // TM01
    slot(0x790 + 4, 133, 3); // a berry, second slot
    expect(spillOf(bag, key)).toEqual({ items: [{ id: 13, n: 2 }, { id: 4, n: 6 }, { id: 133, n: 3 }], money: 5000 });
    expect(spillOf(withMoney(bag, key, 1200), key).money).toBe(6200);
    expect(spillOf(withMoney(bag, key, 2e6), key).money).toBe(999999);
  });
});

describe('teamOf', () => {
  it('reads each mon\'s species out of its encrypted growth substruct, and its level', () => {
    // two mons: personality 0 (growth first) and 7 (AGME: growth second), species 277 and 25
    const party = new Uint8Array(600);
    const v = new DataView(party.buffer);
    const put = (i: number, personality: number, otId: number, species: number, level: number) => {
      const at = i * 100, key = (personality ^ otId) >>> 0;
      v.setUint32(at, personality, true);
      v.setUint32(at + 4, otId, true);
      const g = at + 32 + 12 * (personality % 24 === 7 ? 1 : 0);
      for (let w = 0; w < 12; w += 4) v.setUint32(g + w, key, true); // all zero under the key
      v.setUint32(g, (species ^ key) >>> 0, true);
      party[at + 84] = level;
    };
    put(0, 0, 0x12345678, 277, 5);
    put(1, 7, 0xdeadbeef, 25, 12);
    expect(teamOf(party, 2)).toEqual([{ species: 277, level: 5 }, { species: 25, level: 12 }]);
    expect(teamOf(party, 1)).toHaveLength(1);
  });
});
