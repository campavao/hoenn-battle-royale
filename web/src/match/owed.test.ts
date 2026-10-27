import { describe, expect, it } from 'vitest';
import { OwedTeam, readTeam, teamSpill } from './owed';
import { Loot } from './loot';
import { World } from '../bots/world';
import type { Msg } from '../net/wire';

const MAP = { group: 0, num: 9 };
const ME = 2;
const WINNER = 7;

function owed(inRoom: Set<number>, opponent: number | null = WINNER) {
  return new OwedTeam({ mySeat: () => ME, opponent: () => opponent, inRoom: (seat) => inRoom.has(seat) });
}

/** What our ROM says on losing a link fight: the RESULT, then the whiteout's drop with
 *  the bag only (BrLoot_TeamTaken). */
const LOST: Msg = { t: 'result', seat: ME, outcome: 'lose' };
const BAG_ONLY: Msg = { t: 'spill', seat: ME, map: MAP, mons: [], bag: { key: (ME << 8) | 0xff, x: 10, y: 10, items: [], money: 500, name: 'CAM' } };
const SPOILS: Msg = { t: 'spill', seat: WINNER, map: MAP, mons: [{ key: ME << 8, x: 11, y: 10, species: 277, level: 5 }] };
const WINNER_OUT: Msg = { t: 'out', seat: WINNER };

describe('a beaten team its winner never put down (POK-387)', () => {
  it('is ours to drop once the winner is out and gone from the room', () => {
    const o = owed(new Set([ME]));
    expect(o.note(LOST, true)).toBeNull();
    expect(o.note(BAG_ONLY, true)).toBeNull();
    expect(o.note(WINNER_OUT, false)).toBe(WINNER);
    // ...once: a second out (a rejoin says it again) drops nothing more.
    expect(o.note(WINNER_OUT, false)).toBeNull();
  });

  it('is paid by the winner\'s spoils, whenever they land', () => {
    for (const order of [[LOST, BAG_ONLY, SPOILS], [SPOILS, LOST, BAG_ONLY], [LOST, SPOILS, BAG_ONLY]]) {
      const o = owed(new Set([ME]));
      for (const msg of order) o.note(msg, msg.seat === ME);
      expect(o.note(WINNER_OUT, false)).toBeNull();
    }
  });

  it('waits on a winner still in the room: their ROM drops the team itself', () => {
    const o = owed(new Set([ME, WINNER]));
    o.note(LOST, true);
    o.note(BAG_ONLY, true);
    expect(o.note(WINNER_OUT, false)).toBeNull();
  });

  it('owes nothing for a loss to a bot, whose spill carries the team', () => {
    const o = owed(new Set([ME]));
    o.note(LOST, true);
    o.note({ ...BAG_ONLY, mons: [{ key: ME << 8, x: 10, y: 11, species: 277, level: 5 }] }, true);
    expect(o.note(WINNER_OUT, false)).toBeNull();
  });

  it('takes a TM put back on the ground for nothing', () => {
    const o = owed(new Set([ME]));
    o.note({ ...BAG_ONLY, bag: { key: 0x4205, x: 3, y: 3, items: [{ id: 290, n: 1 }], money: 0 } }, true);
    o.note(LOST, true);
    o.note(BAG_ONLY, true);
    expect(o.note(WINNER_OUT, false)).toBe(WINNER);
  });

  it('starts over with the next match', () => {
    const o = owed(new Set([ME]));
    o.note(LOST, true);
    o.note(BAG_ONLY, true);
    o.note({ t: 'start', seed: 1, spawns: [] } as unknown as Msg, false);
    expect(o.note(WINNER_OUT, false)).toBeNull();
  });
});

// gPlayerParty[0] dumped from the ROM by the harness (event-trader's boot): a TREECKO at
// 5, then the LAPRAS the trader swapped in for it, at the same 5 (the harness has no rung).
const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));
const TREECKO = hex(`
  7c b1 00 0b 00 00 f9 b2 ce cc bf bf bd c5 c9 ff d0 63 02 02 bd bb c7 ff 00 00 00 00 2d c7 00 00
  7c b1 f9 b9 7c b1 f9 b9 7c b1 f9 b9 69 b0 f9 b9 fb b1 f9 b9 7c f7 f9 b9 7d b1 d2 b9 7c b1 f9 b9
  5f af f9 b9 7c b1 7c 98 05 b9 bd 8e 7c b1 f9 b9 00 00 00 00 05 ff 14 00 14 00 09 00 08 00 0c 00
  0c 00 0b 00`);
const LAPRAS = hex(`
  52 d9 c4 0d 00 00 f9 b2 c6 bb ca cc bb cd ff 00 00 30 02 02 bd bb c7 ff 00 00 00 00 b3 4f 00 00
  65 d9 10 bf 7d d9 3d bf 4b f1 32 bf 52 d9 b8 9e 21 41 dc 9a 52 d9 3d bf d1 d9 3d bf ce d9 3d bf
  52 9f 3d bf 52 d9 3d bf 52 d9 3d bf 52 d9 3d bf 00 00 00 00 05 ff 1c 00 1c 00 0d 00 0d 00 0b 00
  0d 00 10 00`);

describe('reading our team out of RAM', () => {
  it('decrypts each species and takes the level as it is', () => {
    const party = new Uint8Array(200);
    party.set(TREECKO, 0);
    party.set(LAPRAS, 100);
    expect(readTeam(party, 2)).toEqual([
      { species: 277, level: 5 },
      { species: 131, level: 5 },
    ]);
  });

  it('stops at an empty slot and at the count', () => {
    const party = new Uint8Array(600);
    party.set(TREECKO, 0);
    expect(readTeam(party, 6)).toEqual([{ species: 277, level: 5 }]);
    expect(readTeam(party, 0)).toEqual([]);
  });
});

describe('the team, put down where we stand', () => {
  it('puts the team in our bag, on its cell, under our keys (HBR-82)', () => {
    const world = new World([{ id: 'FIELD', group: 0, num: 9, w: 9, h: 9, section: 'S', outdoor: true, grid: '81x0', seams: [] }]);
    const loot = new Loot();
    // Our bag, dropped a cell east of where we stand (13,12 live = 6,5 on the map).
    loot.note({ t: 'spill', seat: ME, map: MAP, mons: [], bag: { key: (ME << 8) | 0xff, x: 13, y: 12, items: [], money: 1, name: 'CAM' } });
    const spill = teamSpill(ME, [{ species: 277, level: 5 }, { species: 131, level: 9 }], { map: MAP, x: 12, y: 12 }, world, 'FIELD', loot);
    expect(spill).toEqual({
      t: 'spill',
      seat: ME,
      map: MAP,
      mons: [
        { key: ME << 8, x: 13, y: 12, species: 277, level: 5 },
        { key: (ME << 8) | 1, x: 13, y: 12, species: 131, level: 9 },
      ],
    });
  });

  it("with no bag of ours down, stacks on our own cell, off somebody else's piece", () => {
    const world = new World([{ id: 'FIELD', group: 0, num: 9, w: 9, h: 9, section: 'S', outdoor: true, grid: '81x0', seams: [] }]);
    const loot = new Loot();
    expect(teamSpill(ME, [{ species: 277, level: 5 }], { map: MAP, x: 12, y: 12 }, world, 'FIELD', loot)?.mons).toEqual([
      { key: ME << 8, x: 12, y: 12, species: 277, level: 5 },
    ]);
    // A ball of seat 7's on our cell: the ring's next cell, east.
    loot.note({ t: 'spill', seat: 7, map: MAP, mons: [{ key: 7 << 8, x: 12, y: 12, species: 1, level: 5 }] });
    expect(teamSpill(ME, [{ species: 277, level: 5 }], { map: MAP, x: 12, y: 12 }, world, 'FIELD', loot)?.mons[0]).toMatchObject({ x: 13, y: 12 });
    expect(teamSpill(ME, [], { map: MAP, x: 12, y: 12 }, world, 'FIELD', loot)).toBeNull();
  });
});
