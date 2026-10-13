import { describe, expect, it } from 'vitest';
import { mulberry32 } from './clock';
import {
  clusterCells,
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
} from './events';
import { rungForPhase } from '../bots/party';
import { Loot } from './loot';
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
