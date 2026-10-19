import { describe, expect, it } from 'vitest';
import { mulberry32 } from './clock';
import {
  clusterCells,
  EVENT_CELLS,
  EVENT_GOLD,
  EVENT_PIECES,
  EVENT_RARES,
  eventDrop,
  eventForRing,
  eventKey,
  GOLD,
  isEventKey,
  LEGENDS,
  RARES,
  SUPPLIES,
  TraderClaims,
  homeClaimOf,
  isHomeOrClaim,
  homeKey,
  claimKey,
  claimOf,
  legendClaimKey,
  legendClaimOf,
  traderKey,
} from './events';
import { STORIES } from './story';
import { rungForPhase } from '../bots/party';
import { Loot } from './loot';
import { MAP_OFFSET } from '../net/cells';
import type { EventMsg, SpillMsg } from '../net/wire';

const MAP = { group: 0, num: 16 };
const cells = (n: number) => Array.from({ length: n }, (_, i) => ({ x: 10 + i, y: 20 }));

describe('which rings drop an event', () => {
  it('every other ring from the first shrink, four in all', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(eventForRing)).toEqual([undefined, 0, undefined, 1, undefined, 2, undefined, 3, undefined]);
  });
});

describe('eventDrop', () => {
  const drop = (n: number, k = EVENT_PIECES) =>
    eventDrop(mulberry32(5), { n, phase: 2 * n + 2, seat: 0, mapsec: 31, place: 'ROUTE 116', map: MAP, cells: cells(k) });

  it('says where first, then spills the legendary, the rares, the gold balls and the supplies', () => {
    const msgs = drop(1);
    const event = msgs[0] as EventMsg;
    expect(event).toEqual({ t: 'event', seat: 0, n: 1, mapsec: 31, key: eventKey(1, 0), place: 'ROUTE 116' });
    const spills = msgs.slice(1) as SpillMsg[];
    expect(spills.every((s) => s.t === 'spill' && s.seat === 0 && s.map === MAP)).toBe(true);
    const mons = spills.flatMap((s) => s.mons);
    expect(mons).toHaveLength(1 + EVENT_RARES);
    expect(mons[0].key).toBe(event.key);
    expect(LEGENDS[1]).toContain(mons[0].species);
    expect(mons.slice(1).every((m) => RARES.includes(m.species))).toBe(true);
    expect(new Set(mons.map((m) => m.species)).size).toBe(mons.length);
    expect(mons.every((m) => m.level === rungForPhase(4))).toBe(true);
    const bags = spills.map((s) => s.bag!);
    expect(bags).toHaveLength(EVENT_GOLD + 1);
    for (const b of bags.slice(0, EVENT_GOLD)) {
      expect(b.items).toHaveLength(1);
      expect(b.items[0].n).toBe(1);
      expect(GOLD).toContain(b.items[0].id);
    }
    expect(bags[EVENT_GOLD].items).toEqual(SUPPLIES);
  });

  it('stands a trader on the cell past the pieces, offering a rare the event did not drop', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const msgs = eventDrop(mulberry32(seed), { n: 0, phase: 2, seat: 0, mapsec: 31, map: MAP, cells: cells(EVENT_CELLS) });
      const event = msgs[0] as EventMsg;
      const dropped = (msgs.slice(1) as SpillMsg[]).flatMap((s) => s.mons).map((m) => m.species);
      expect(event.trader).toBeDefined();
      expect(event.trader!.map).toBe(MAP);
      expect({ x: event.trader!.x, y: event.trader!.y }).toEqual({ x: 10 + EVENT_PIECES + MAP_OFFSET, y: 20 + MAP_OFFSET });
      expect(RARES).toContain(event.trader!.species);
      expect(dropped).not.toContain(event.trader!.species);
    }
  });

  it('has no trader when the pieces take every cell', () => {
    expect((drop(0, EVENT_PIECES)[0] as EventMsg).trader).toBeUndefined();
  });

  it('keys every piece in the event space, and puts it on its cell in the ROM space', () => {
    const msgs = drop(2).slice(1) as SpillMsg[];
    const pieces = msgs.flatMap((s) => [...s.mons, ...(s.bag ? [s.bag] : [])]);
    expect(pieces.map((p) => p.key).sort((a, b) => a - b)).toEqual(Array.from({ length: EVENT_PIECES }, (_, i) => eventKey(2, i)));
    expect(pieces.every((p) => isEventKey(p.key))).toBe(true);
    expect(pieces.map((p) => p.x).sort((a, b) => a - b)).toEqual(cells(EVENT_PIECES).map((c) => c.x + 7));
    expect(pieces.every((p) => p.y === 27)).toBe(true);
  });

  it('drops fewer on fewer cells, the supplies first to go and the legendary last', () => {
    const three = drop(0, 3).slice(1) as SpillMsg[];
    expect(three).toHaveLength(1);
    expect(three[0].mons).toHaveLength(3);
    expect(three[0].bag).toBeUndefined();
    expect(drop(3, 1).slice(1)).toEqual([
      { t: 'spill', seat: 0, map: MAP, mons: [{ key: eventKey(3, 0), x: 17, y: 27, species: 406, level: 100 }] },
    ]);
    expect(drop(3, 0)).toHaveLength(1);
  });

  it('is loot like any other: the table holds it and gives it back for the map', () => {
    const loot = new Loot();
    for (const m of drop(0)) loot.note(m);
    expect(loot.size()).toBe(EVENT_PIECES);
    expect(loot.forMap(MAP).flatMap((s) => [...s.mons, ...(s.bag ? [s.bag] : [])])).toHaveLength(EVENT_PIECES);
  });
});

describe('clusterCells', () => {
  const at = (x: number, y: number, num = 16) => ({ map: { group: 0, num }, x, y });

  it('is the nearest free cells on the same map, the anchor first', () => {
    const pool = [at(5, 5), at(9, 9), at(5, 6), at(6, 5), at(5, 5, 17), at(4, 5), at(5, 7)];
    const taken = (c: { x: number; y: number }) => c.x === 4 && c.y === 5;
    expect(clusterCells(pool, at(5, 5), 4, taken)).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
    ]);
  });

  it('stops eight tiles out', () => {
    expect(clusterCells([at(0, 0), at(8, 0), at(9, 0)], at(0, 0), 7, () => false)).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }]);
  });
});

describe('a trade asks the host first (POK-392)', () => {
  it("his claim key is past every piece's, and below his own", () => {
    // A piece's index is its cell's: the event's own and every story's stay under 14.
    expect(Math.max(EVENT_CELLS, ...STORIES.map((st) => st.cells.length))).toBeLessThanOrEqual(14);
    expect([claimKey(2), traderKey(2)]).toEqual([0xb02e, 0xb02f]);
    expect([claimOf(0xb02e), claimOf(0xb02f), claimOf(0xb020), claimOf(0xc00e)]).toEqual([2, undefined, undefined, undefined]);
  });

  it('the first ask for a trader still standing is the trade; every later one hears who got him', () => {
    let standing = true;
    const claims = new TraderClaims(() => standing);
    expect(claims.answer({ t: 'pickup', seat: 3, key: claimKey(1) })).toEqual({ reply: { t: 'pickup', seat: 3, key: traderKey(1) }, granted: true });
    standing = false; // the books heard the trade
    expect(claims.answer({ t: 'pickup', seat: 5, key: claimKey(1) })).toEqual({ reply: { t: 'pickup', seat: 3, key: traderKey(1) }, granted: false });
    expect(claims.answer({ t: 'pickup', seat: 3, key: traderKey(1) }), 'only an ask is answered').toBeNull();
    expect(claims.answer({ t: 'pickup', seat: 3, key: claimKey(1), item: 4 }), 'an item out of a bag is not an ask').toBeNull();
  });

  // POK-410: a legendary is asked for before its battle, and a lost battle puts it back.
  it('a legendary goes to the first ask while it stands, and to the next one once it is back', () => {
    const ground = new Set([eventKey(1, 0)]);
    const claims = new TraderClaims(() => false, (key) => ground.has(key));
    expect(legendClaimKey(eventKey(1, 0))).toBe(0xb810);
    expect([legendClaimOf(0xb810), legendClaimOf(eventKey(1, 0)), legendClaimOf(claimKey(1))]).toEqual([eventKey(1, 0), undefined, undefined]);
    const ask = (seat: number) => claims.answer({ t: 'pickup', seat, key: legendClaimKey(eventKey(1, 0)) });
    expect(ask(4)).toEqual({ reply: { t: 'pickup', seat: 4, key: eventKey(1, 0) }, granted: true });
    ground.delete(eventKey(1, 0)); // the books heard the yes
    expect(ask(2), 'the second trainer at it: a no, naming somebody else').toEqual({ reply: { t: 'pickup', seat: 0, key: eventKey(1, 0) }, granted: false });
    expect(ask(0)?.reply.seat, "never the asker's own seat").toBe(1);
    ground.add(eventKey(1, 0)); // seat 4 ran: its SPILL put it back
    expect(ask(2)?.granted).toBe(true);
  });

  it("a trade nobody asked for is the one a later ask hears of; a new match forgets them all", () => {
    const claims = new TraderClaims(() => false);
    expect(claims.answer({ t: 'pickup', seat: 5, key: claimKey(0) }), 'gone, and nobody known to have him: still a no').toEqual({
      reply: { t: 'pickup', seat: 0, key: traderKey(0) },
      granted: false,
    });
    expect(claims.answer({ t: 'pickup', seat: 0, key: claimKey(0) })?.reply.seat, "never the asker's own seat").toBe(1);
    claims.note({ t: 'pickup', seat: 7, key: traderKey(0) });
    claims.note({ t: 'pickup', seat: 8, key: traderKey(0) });
    expect(claims.answer({ t: 'pickup', seat: 5, key: claimKey(0) })?.reply.seat, 'the first trade is the one').toBe(7);
    claims.note({ t: 'start', seed: 1, spawns: [] });
    expect(claims.answer({ t: 'pickup', seat: 5, key: claimKey(0) })?.reply.seat).toBe(0);
  });
});

describe('somebody at home asks the host first too (POK-379)', () => {
  it("his claim key is the 64 above his own, clear of the caches' and the trainers'", () => {
    expect(homeKey(0x3d)).toBe(0x8c3d);
    expect([homeClaimOf(0x8c7d), homeClaimOf(0x8c40), homeClaimOf(0x8c3d), homeClaimOf(0x8d40), homeClaimOf(0x8b40)]).toEqual([0x3d, 0, undefined, undefined, undefined]);
  });

  it('the first ask is his; a later one, or one after a give nobody asked for, hears who got him', () => {
    const claims = new TraderClaims(() => false);
    expect(claims.answer({ t: 'pickup', seat: 4, key: 0x8c61 })).toEqual({ reply: { t: 'pickup', seat: 4, key: 0x8c21 }, granted: true });
    expect(claims.answer({ t: 'pickup', seat: 2, key: 0x8c61 })).toEqual({ reply: { t: 'pickup', seat: 4, key: 0x8c21 }, granted: false });
    expect(claims.answer({ t: 'pickup', seat: 4, key: 0x8c61 }), 'the winner asking again (a full party said no) is his still').toEqual({
      reply: { t: 'pickup', seat: 4, key: 0x8c21 },
      granted: false,
    });
    claims.note({ t: 'pickup', seat: 6, key: 0x8c05 });
    expect(claims.answer({ t: 'pickup', seat: 2, key: 0x8c45 })?.reply.seat).toBe(6);
    expect(claims.answer({ t: 'pickup', seat: 2, key: 0x8c21 }), 'only an ask is answered').toBeNull();
  });
  it("a big floor's trader (POK-413) is the byte's upper half, and asked for the same way", () => {
    expect(homeKey(0x80 | 0x12)).toBe(0x8c92);
    expect([homeClaimOf(0x8cd2), homeClaimOf(0x8cc0), homeClaimOf(0x8c92), homeClaimOf(0x8d92)]).toEqual([0x92, 0x80, undefined, undefined]);
    expect([isHomeOrClaim(0x8c92), isHomeOrClaim(0x8cd2), isHomeOrClaim(0x8d5a), isHomeOrClaim(0x8bff)]).toEqual([true, true, false, false]);
    const claims = new TraderClaims(() => false);
    expect(claims.answer({ t: 'pickup', seat: 3, key: 0x8cd2 })).toEqual({ reply: { t: 'pickup', seat: 3, key: 0x8c92 }, granted: true });
    claims.note({ t: 'pickup', seat: 5, key: 0x8c86 });
    expect(claims.answer({ t: 'pickup', seat: 3, key: 0x8cc6 })?.reply).toEqual({ t: 'pickup', seat: 5, key: 0x8c86 });
  });
});
