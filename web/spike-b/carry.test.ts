import { describe, expect, it } from 'vitest';
import { BAG_AT, BAG_LEN, arrived, fameTeam, fieldOf, healed, rekey, spillOf, tallySince, teamOf, withMoney } from './carry';
import HMS from '../src/data/hms.json';

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

describe('fameTeam', () => {
  it('reads the nickname, moves, HP, shininess, personality and OT id the hall of fame shows', () => {
    const party = new Uint8Array(600);
    const v = new DataView(party.buffer);
    // personality 0: GAEM, growth then attacks; 0x0102 ^ 0x0304 is not under 8, not shiny
    const key = 0x01020304;
    v.setUint32(0, 0, true);
    v.setUint32(4, key, true);
    for (let w = 0; w < 48; w += 4) v.setUint32(32 + w, key, true);
    v.setUint32(32, (252 ^ key) >>> 0, true); // Treecko
    v.setUint32(44, ((1 | (43 << 16)) ^ key) >>> 0, true); // POUND, LEER
    party.set([0xce, 0xbb, 0xc7, 0xd3, 0xff], 8); // TAMY
    party[84] = 9;
    v.setUint16(86, 20, true);
    v.setUint16(88, 27, true);
    expect(fameTeam(party, 1)).toEqual([{ species: 252, nickname: 'TAMY', level: 9, hp: 20, maxHp: 27, shiny: false, moves: [{ id: 1 }, { id: 43 }], personality: 0, otId: key }]);
    expect(fameTeam(party, 0)).toEqual([]);
  });
});

describe('healed', () => {
  const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
    'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];
  /** One mon as the game keeps it: substructs in personality's order, summed, encrypted. */
  function mon(personality: number, otId: number, moves: number[], pp: number[], bonuses: number): Uint8Array {
    const b = new Uint8Array(100);
    const v = new DataView(b.buffer);
    v.setUint32(0, personality, true);
    v.setUint32(4, otId, true);
    const plain = new DataView(new ArrayBuffer(48));
    const order = ORDERS[personality % 24];
    const g = 12 * order.indexOf('G'), a = 12 * order.indexOf('A');
    plain.setUint16(g, 25, true); // PIKACHU
    plain.setUint8(g + 8, bonuses);
    moves.forEach((m, i) => plain.setUint16(a + i * 2, m, true));
    pp.forEach((p, i) => plain.setUint8(a + 8 + i, p));
    let sum = 0;
    for (let h = 0; h < 24; h++) sum = (sum + plain.getUint16(h * 2, true)) & 0xffff;
    v.setUint16(28, sum, true);
    const key = (personality ^ otId) >>> 0;
    for (let w = 0; w < 12; w++) v.setUint32(32 + w * 4, (plain.getUint32(w * 4, true) ^ key) >>> 0, true);
    v.setUint32(80, 8, true); // poisoned
    b[84] = 30;
    v.setUint16(86, 2, true);
    v.setUint16(88, 40, true);
    return b;
  }
  const PP: Record<number, number> = { 33: 35, 45: 40, 98: 30 };

  it("puts back HP, status and every move's PP, PP UPs counted, and keeps the checksum", () => {
    for (const personality of [0x12345678, 0x00000017, 0xfedcba98]) {
      const party = new Uint8Array(600);
      party.set(mon(personality, 0x0badf00d, [33, 45, 98, 0], [3, 0, 12, 0], 0b11_00_01), 0);
      const want = mon(personality, 0x0badf00d, [33, 45, 98, 0], [35 + 7, 40, 30 + 18, 0], 0b11_00_01);
      const out = healed(party, 1, (m) => PP[m]);
      const v = new DataView(want.buffer);
      v.setUint32(80, 0, true);
      v.setUint16(86, 40, true);
      expect([...out.slice(0, 100)]).toEqual([...want]);
      expect(teamOf(out, 1)).toEqual([{ species: 25, level: 30 }]);
    }
  });

  it("reads what the team could do on the field: a move it knows, or an HM its species could learn", () => {
    const can = (hm: keyof typeof HMS) => ((parseInt(HMS[hm].substr((25 >> 3) * 2, 2), 16) >> (25 & 7)) & 1) === 1;
    const party = new Uint8Array(600);
    party.set(mon(0x12345678, 0x0badf00d, [33, 45, 98, 0], [1, 1, 1, 0], 0), 0);
    const base = (can('cut') ? 1 : 0) | (can('strength') ? 2 : 0) | (can('surf') ? 4 : 0) | (can('dive') ? 8 : 0);
    expect(fieldOf(party, 1)).toBe(base);
    party.set(mon(0x12345678, 0x0badf00d, [33, 57, 15, 70], [1, 1, 1, 1], 0), 0); // SURF, CUT, STRENGTH
    expect(fieldOf(party, 1)).toBe(7 | (can('dive') ? 8 : 0));
    party.set(mon(0x12345678, 0x0badf00d, [291, 57, 15, 70], [1, 1, 1, 1], 0), 0); // DIVE (HM08) too
    expect(fieldOf(party, 1)).toBe(15);
    expect(fieldOf(party, 0)).toBe(0);
  });

  it('leaves an empty slot and the bytes past the count alone, and is a copy', () => {
    const party = new Uint8Array(600).map((_, i) => (i >= 100 ? i & 0xff : 0));
    const out = healed(party, 1, () => 10);
    expect(out).not.toBe(party);
    expect([...out]).toEqual([...party]);
  });
});

describe('tallySince', () => {
  it("is the round's own counts: the ROM's since the round began, and the page's steps", () => {
    const from = { steps: 0, won: 2, caught: 1, items: 0, mons: { 277: 5 }, moves: { 1: 5 } };
    const now = { steps: 0, won: 5, caught: 1, items: 0, mons: { 277: 9, 280: 2 }, moves: { 1: 5, 33: 6 } };
    expect(tallySince(from, now, 40)).toEqual({ won: 3, caught: 0, items: 0, steps: 40, trainers: 0, duelsWon: 0, took: 0, mons: { 277: 4, 280: 2 }, moves: { 33: 6 } });
    expect(tallySince(null, null, 7)).toMatchObject({ won: 0, steps: 7, mons: {} });
  });
});
