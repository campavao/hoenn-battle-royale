import { describe, expect, it } from 'vitest';
import { BAG_LEN, arrived, rekey } from './carry';

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
