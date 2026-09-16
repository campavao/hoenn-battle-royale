import { describe, expect, it } from 'vitest';
import { Loot } from './loot';
import type { MapRef, SpillMsg } from '../net/wire';

const LITTLEROOT: MapRef = { group: 0, num: 9 };
const ROUTE101: MapRef = { group: 0, num: 16 };

function spill(seat: number, map: MapRef, keys: number[], bagKey?: number): SpillMsg {
  const msg: SpillMsg = {
    t: 'spill',
    seat,
    map,
    mons: keys.map((key, i) => ({ key, x: 10 + i, y: 12, species: 277, level: 5 })),
  };
  if (bagKey !== undefined) msg.bag = { key: bagKey, x: 9, y: 12, items: [], money: 1200, name: 'CAM' };
  return msg;
}

describe('the match-wide loot table', () => {
  it('holds what a spill dropped and hands it back for that map', () => {
    const loot = new Loot();
    loot.note(spill(1, LITTLEROOT, [0x0100, 0x0101], 0x01ff));
    expect(loot.size()).toBe(3);
    const back = loot.forMap(LITTLEROOT);
    expect(back?.mons.map((m) => m.key)).toEqual([0x0100, 0x0101]);
    expect(back?.bag?.key).toBe(0x01ff);
    expect(back?.seat).toBe(1);
  });

  it('says nothing about a map with nothing on it', () => {
    const loot = new Loot();
    loot.note(spill(1, LITTLEROOT, [0x0100]));
    expect(loot.forMap(ROUTE101)).toBeNull();
  });

  it('forgets a piece somebody picked up', () => {
    const loot = new Loot();
    loot.note(spill(1, LITTLEROOT, [0x0100, 0x0101]));
    loot.note({ t: 'pickup', seat: 2, key: 0x0100 });
    expect(loot.size()).toBe(1);
    expect(loot.forMap(LITTLEROOT)?.mons.map((m) => m.key)).toEqual([0x0101]);
  });

  it('keeps the bag when only part of it was taken', () => {
    const loot = new Loot();
    loot.note(spill(1, LITTLEROOT, [], 0x01ff));
    loot.note({ t: 'pickup', seat: 2, key: 0x01ff, item: 13, n: 1 });
    expect(loot.size()).toBe(1);
    expect(loot.forMap(LITTLEROOT)?.bag?.key).toBe(0x01ff);
  });

  it('re-reading the same spill replaces rather than doubles it', () => {
    const loot = new Loot();
    loot.note(spill(1, LITTLEROOT, [0x0100]));
    loot.note(spill(1, LITTLEROOT, [0x0100]));
    expect(loot.size()).toBe(1);
  });

  it('speaks for one seat at a time, the one with the most down', () => {
    const loot = new Loot();
    loot.note(spill(1, LITTLEROOT, [0x0100]));
    loot.note(spill(2, LITTLEROOT, [0x0200, 0x0201]));
    const back = loot.forMap(LITTLEROOT);
    expect(back?.seat).toBe(2);
    expect(back?.mons).toHaveLength(2);
  });

  it('never hands the ROM more mons than a spill can carry', () => {
    const loot = new Loot();
    loot.note(spill(1, LITTLEROOT, [1, 2, 3, 4, 5, 6, 7, 8]));
    expect(loot.forMap(LITTLEROOT)?.mons).toHaveLength(6);
  });
});
