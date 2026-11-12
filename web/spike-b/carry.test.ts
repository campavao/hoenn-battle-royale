import { describe, expect, it } from 'vitest';
import { arrived, BAG_AT, BAG_LEN, beatenBy, drainFavourites, emptyFavourites, fameTeam, fieldOf, healed, hpAt, hpTaken, joinedSlot, withHp, partySettled, partyWhole, rekey, spentLine, spillOf, spillShows, tallySince, teamMembers, teamOf, withFavourites, withHeld, withMoney, withMove } from './carry';
import { favourite, TALLY_BYTES } from '../src/match/tally';
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

// Cam, 11-11: a mon let go keeps the health it had, whoever takes it back. The ROM makes a
// ball's mon fresh (br_loot.c MakeTaken), at full HP; the page puts the HP back.
describe('the HP one of ours left the party with', () => {
  const party = (rows: [personality: number, hp: number, maxHp: number][]) => {
    const p = new Uint8Array(600);
    const v = new DataView(p.buffer);
    rows.forEach(([personality, hp, maxHp], i) => {
      v.setUint32(i * 100, personality, true);
      v.setUint16(i * 100 + 86, hp, true);
      v.setUint16(i * 100 + 88, maxHp, true);
    });
    return p;
  };
  it('is read off its slot before the ROM overwrites it', () => {
    const p = party([[1, 40, 40], [2, 7, 33], [3, 0, 28]]);
    expect(hpAt(p, 1)).toEqual({ hp: 7, maxHp: 33 });
    expect(hpAt(p, 2)).toEqual({ hp: 0, maxHp: 28 });
  });
  it('is the same number on the same most, the same share on another; 0 stays 0, hurt never comes back full', () => {
    expect(hpTaken({ hp: 7, maxHp: 33 }, 33)).toBe(7);
    expect(hpTaken({ hp: 0, maxHp: 28 }, 28)).toBe(0);
    expect(hpTaken({ hp: 0, maxHp: 28 }, 60)).toBe(0);
    // made again from its ball, its IVs are the ball's, or the rung lifted it: its share
    expect(hpTaken({ hp: 10, maxHp: 40 }, 80)).toBe(20);
    expect(hpTaken({ hp: 1, maxHp: 200 }, 20)).toBe(1);
    expect(hpTaken({ hp: 39, maxHp: 40 }, 41)).toBe(40);
    expect(hpTaken({ hp: 199, maxHp: 200 }, 20)).toBe(19);
    // full, or nothing said (an old page's ball, a beaten trainer's): left as the ROM made it
    expect(hpTaken({ hp: 33, maxHp: 33 }, 35)).toBeNull();
    expect(hpTaken({}, 35)).toBeNull();
    expect(hpTaken({ hp: 3 }, 35)).toBeNull();
    expect(hpTaken({ hp: 3, maxHp: 0 }, 35)).toBeNull();
  });
  it('goes on the one that joined, found by the personality the party did not have', () => {
    const before = party([[1, 40, 40], [2, 7, 33], [3, 0, 28]]);
    // the swap's: 2 went down, 9 came up and the party closed ranks
    const after = party([[1, 40, 40], [3, 0, 28], [9, 33, 33]]);
    expect(joinedSlot(before, 3, after, 3)).toBe(2);
    const fresh = party([[1, 40, 40], [9, 33, 33], [3, 0, 28]]);
    expect(joinedSlot(before, 3, fresh, 3), 'by personality, wherever it is').toBe(1);
    // Two off the same place on the screen are the same personality (MakeTaken's seed): the last
    // slot, where MovePicked puts what came across (the e2e's second TREECKO).
    const again = party([[1, 40, 40], [3, 0, 28], [2, 33, 33]]);
    expect(joinedSlot(before, 3, again, 3)).toBe(2);
    expect(joinedSlot(before, 3, again, 0)).toBe(-1);
    const out = withHp(after, 2, 7);
    expect(hpAt(out, 2)).toEqual({ hp: 7, maxHp: 33 });
    expect(hpAt(after, 2), 'a copy').toEqual({ hp: 33, maxHp: 33 });
    expect([...out.subarray(0, 200)]).toEqual([...after.subarray(0, 200)]);
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
  it('and what the room saw of the round, from its fallen: Cam, 11-04, BEATEN 4 and TRAINERS BEATEN 0', () => {
    const fallen = [
      { by: 'CAM', bot: true }, { by: 'CAM', bot: true }, { by: 'CAM' }, { by: 'MAY', bot: true }, { by: '', bot: true }, { by: 'CAM', bot: true, wild: true },
    ];
    expect(beatenBy(fallen, 'CAM')).toEqual({ trainers: 3, duelsWon: 1 });
    expect(tallySince(null, null, 0, { ...beatenBy(fallen, 'CAM'), took: 5 })).toMatchObject({ trainers: 3, duelsWon: 1, took: 5 });
    expect(beatenBy(fallen, ''), 'the fog is nobody').toEqual({ trainers: 0, duelsWon: 0 });
  });
});

describe('the favourites past what the ROM has room for', () => {
  /** gBrTally (br_tally.h) with these in its tables: 6 species at +8 and +36, 8 moves at +20 and +42. */
  const table = (mons: [number, number][], moves: [number, number][]) => {
    const u = new Uint8Array(TALLY_BYTES), v = new DataView(u.buffer);
    v.setUint16(2, 3, true); // won: not the tables', and stays
    mons.forEach(([id, n], i) => { v.setUint16(8 + i * 2, id, true); u[36 + i] = n; });
    moves.forEach(([id, n], i) => { v.setUint16(20 + i * 2, id, true); u[42 + i] = n; });
    return u;
  };

  // Cam, 11-04: "FAVORITE NOSEPASS, TOP MOVE TACKLE. It doesn't feel true": BrTally_Move keeps the
  // first eight moves and six species it meets, on a page's whole boot, and drops the rest.
  it('each battle goes into the page\'s own count and the ROM\'s tables start again, so no move is ever dropped', () => {
    const sum = emptyFavourites();
    const early = table([[299, 30]], [[33, 30], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]]);
    const left = drainFavourites(early, sum);
    expect(left).not.toBe(early);
    expect(early[36], 'what was read is not written on').toBe(30);
    expect([...left.slice(8)].every((b) => b === 0), 'empty for the next battle').toBe(true);
    expect(left[2], 'and the rest of the tally goes on').toBe(3);
    // Four more battles of a mon and a move the full tables had no room for.
    for (let i = 0; i < 4; i++) drainFavourites(table([[183, 10]], [[94, 10]]), sum);
    expect(sum).toEqual({ mons: { 299: 30, 183: 40 }, moves: { 33: 30, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 94: 40 } });
    expect(favourite(sum.mons)).toBe(183);
    expect(favourite(sum.moves)).toBe(94);
  });

  it('the counts as the page says them: what was drained and what the last battle has not yet', () => {
    const sum = { mons: { 299: 30 }, moves: { 33: 30 } };
    const t = withFavourites({ steps: 0, won: 1, caught: 0, items: 0, mons: { 299: 2, 183: 4 }, moves: { 94: 4 } }, sum);
    expect(t).toMatchObject({ won: 1, mons: { 299: 32, 183: 4 }, moves: { 33: 30, 94: 4 } });
    expect(sum.mons[299], 'not added to itself').toBe(30);
  });
});

describe('partyWhole', () => {
  it('passes a mon whose block adds up, and fails one caught decrypted in place (a BAD EGG, Cam 11-01)', () => {
    const party = new Uint8Array(600);
    const v = new DataView(party.buffer);
    v.setUint32(0, 0x12345678, true);
    v.setUint32(4, 0x9abcdef0, true);
    const key = (0x12345678 ^ 0x9abcdef0) >>> 0;
    const plain = new Uint16Array(24);
    plain[0] = 331;
    plain[7] = 42;
    v.setUint16(28, plain.reduce((a, b) => (a + b) & 0xffff, 0), true);
    for (let w = 0; w < 12; w++) v.setUint32(32 + w * 4, ((plain[w * 2] | (plain[w * 2 + 1] << 16)) ^ key) >>> 0, true);
    expect(partyWhole(party, 1)).toBe(true);
    // Mid-edit: the same block with its encryption off.
    for (let w = 0; w < 12; w++) v.setUint32(32 + w * 4, (v.getUint32(32 + w * 4, true) ^ key) >>> 0, true);
    expect(partyWhole(party, 1)).toBe(false);
    // Past the count is not looked at, and an empty slot adds up to nothing.
    expect(partyWhole(party, 0)).toBe(true);
    expect(partyWhole(new Uint8Array(600), 6)).toBe(true);
    // Settled: whole, and as it was a frame ago. The ROM counting up (a short count and the
    // next mon half done) is a different frame from the next; a team that really is short of
    // what lies past its count is the same, and must not wait.
    const half = party.slice();
    for (let w = 0; w < 12; w++) v.setUint32(32 + w * 4, (v.getUint32(32 + w * 4, true) ^ key) >>> 0, true);
    const whole = party.slice();
    expect(partySettled(null, whole, 1), 'nothing to compare with').toBe(false);
    expect(partySettled({ party: half, count: 0 }, whole, 1), 'it moved').toBe(false);
    expect(partySettled({ party: whole, count: 0 }, whole, 1), 'the count moved').toBe(false);
    expect(partySettled({ party: half, count: 1 }, half, 1), 'still halfway').toBe(false);
    expect(partySettled({ party: whole, count: 1 }, whole, 1)).toBe(true);
    expect(partySettled({ party: whole, count: 0 }, whole, 0), 'a short count that stays').toBe(true);
  });
});

describe('what one of them holds', () => {
  /** One mon: personality 0 (order GAEM), OT id 0x1234, a checksum that adds up. */
  const one = () => {
    const party = new Uint8Array(600);
    const v = new DataView(party.buffer);
    v.setUint32(4, 0x1234, true);
    const key = 0x1234;
    const plain = new Uint32Array(12);
    plain[0] = 25 | (13 << 16);
    let sum = 0;
    plain.forEach((x, w) => {
      v.setUint32(32 + w * 4, (x ^ key) >>> 0, true);
      sum = (sum + (x & 0xffff) + (x >>> 16)) & 0xffff;
    });
    v.setUint16(28, sum, true);
    return party;
  };
  it('changes it and keeps the checksum whole', () => {
    const had = one();
    expect(partyWhole(had, 1)).toBe(true);
    expect(teamMembers(had, 1, () => 'X')[0].item).toBe(13);
    const taken = withHeld(had, 0, 0);
    expect(teamMembers(taken, 1, () => 'X')[0].item).toBe(0);
    expect(teamMembers(taken, 1, () => 'X')[0].species).toBe(25);
    expect(partyWhole(taken, 1)).toBe(true);
    const given = withHeld(taken, 0, 500);
    expect(teamMembers(given, 1, () => 'X')[0].item).toBe(500);
    expect(partyWhole(given, 1)).toBe(true);
  });
  it('reads the calculated stats and the nature off the same bytes', () => {
    const had = one();
    const v = new DataView(had.buffer, had.byteOffset, had.byteLength);
    [90, 92, 94, 96, 98].forEach((at, i) => v.setUint16(at, 100 + i, true));
    const m = teamMembers(had, 1, () => 'X')[0];
    expect(m.stats).toEqual({ attack: 100, defense: 101, speed: 102, spAttack: 103, spDefense: 104 });
    expect(m.nature).toBe(v.getUint32(0, true) % 25);
  });
  it('leaves the party it was given alone', () => {
    const had = one();
    withHeld(had, 0, 0);
    expect(teamMembers(had, 1, () => 'X')[0].item).toBe(13);
  });
  it('teaches a move into a slot: its PP full, that slot only, and the checksum whole', () => {
    const had = one();
    const was = teamMembers(had, 1, () => 'X')[0];
    for (const moveSlot of [0, 1, 2, 3]) {
      const next = withMove(had, 0, moveSlot, 200 + moveSlot, 15 + moveSlot);
      expect(partyWhole(next, 1), `slot ${moveSlot}`).toBe(true);
      const m = teamMembers(next, 1, () => 'X')[0];
      const moves = m.moves;
      const got = moves.find((x) => x.id === 200 + moveSlot)!;
      expect(got.pp).toBe(15 + moveSlot);
      expect(m.species).toBe(was.species);
      expect(m.item).toBe(was.item);
      expect((m.ppBonuses >> (moveSlot * 2)) & 3).toBe(0);
    }
    expect(teamMembers(had, 1, () => 'X')[0], 'the party it was given alone').toEqual(was);
  });
});

describe('somebody who has given it away', () => {
  it('says somebody took it, or that you did', () => {
    expect(spentLine({ by: 2 }, 1)).toBe('Sorry, somebody took it.');
    expect(spentLine({ by: 0 }, 1)).toBe('Sorry, somebody took it.');
    expect(spentLine({ by: 1 }, 1)).toBe("That's all I had. Take care of it!");
    expect(spentLine({ by: 2, busy: 'WALLY' }, 1)).toBe('WALLY is fighting me for it.');
    expect(spentLine({ by: 0, beaten: 'WALLY' }, 1)).toBe('WALLY already beat me.');
    expect(spentLine({ by: 0, beaten: '' }, 1)).toBe('You already beat me.');
  });
});

describe('a piece on the ground while it is taken up', () => {
  it('a bag I have open stays, nobody else\'s does', () => {
    expect(spillShows({}, undefined, 1, false)).toBe(true);
    expect(spillShows({}, 1, 1, true)).toBe(true);
    // Taken to the last: the room still has it as mine, and it's gone.
    expect(spillShows({}, 1, 1, false)).toBe(false);
    expect(spillShows({}, 2, 1, false)).toBe(false);
  });
  it('a legendary I am fighting does not stand there too', () => {
    expect(spillShows({ legend: true }, 1, 1, true)).toBe(false);
  });
  it('a person stays, whoever took what they held', () => {
    expect(spillShows({ person: {} }, undefined, 1, true)).toBe(true);
    expect(spillShows({ person: {} }, 1, 1, true)).toBe(true);
    expect(spillShows({ person: {} }, 2, 1, true)).toBe(true);
  });
});
