// A loser's spill is the team that was fought (Cam, 11-04: "only one Kadabra, and now there's two").
// MAY had two balls in her fight and her bag held KADABRA, MIGHTYENA, KADABRA: the ring moved on while
// they fought, and a team is one mon longer every two rungs, so the bag was dealt a slot nobody met.
import { describe, expect, it } from 'vitest';
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';
import { KEY_A, LEGEND_FOE, SPILL_KEY, botParty, makeRoom, type Room } from './room';

const MAPS = (worldJson as { maps: WorldMap[] }).maps;
const PATCHES = patchJson as unknown as PatchTable;
const L = 'MAP_LITTLEROOT_TOWN';
const PHASE = 600;

/** Ten frames short of the rung where a team of two gets its third. */
function nearTheTurn(): Room {
  const room = makeRoom(MAPS, PATCHES, 99);
  room.opening = 0;
  room.ringPhase = PHASE;
  room.inFog = () => false;
  room.tick = PHASE * 4 - 10;
  return room;
}

const rung = (room: Room) => room.ring().phase + 1;
const species = (room: Room, id: number) => botParty(room.seed, room.actor(id)!, rung(room)).map((m) => m.species);
const bagOf = (room: Room, id: number) => room.spills.get(SPILL_KEY + id)?.bag.mons?.map((m) => m.species);
const pastTheTurn = (room: Room) => { for (let i = 0; i < 20; i++) room.step(new Map()); expect(room.ring().phase).toBe(4); };

describe('a loser\'s spill', () => {
  /** A at a bot, with the ring about to turn. */
  const fightOf = () => {
    const room = nearTheTurn();
    room.apply({ c: 'join', id: 1, bot: true, name: 'MAY', skin: 1, spot: { map: L, x: 10, y: 12 }, facing: 1 });
    room.apply({ c: 'join', id: 2, bot: false, name: 'A', skin: 0, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.actor(1)!.calm = room.actor(2)!.calm = 0;
    expect(room.step(new Map([[2, [KEY_A]]]))).toMatchObject([{ type: 'fight', id: 2, foe: 1 }]);
    return room;
  };

  it('is the team a trainer fought, though the ring moved on during the fight', () => {
    const room = fightOf();
    const fought = species(room, 1);
    pastTheTurn(room);
    expect(species(room, 1), 'and it stays that team while the fight lasts').toEqual(fought);
    room.apply({ c: 'end', id: 2, won: true });
    expect(bagOf(room, 1)).toEqual(fought);
  });

  it('is the team a bot fought, a bots\' fight that ran into the next rung', () => {
    const room = nearTheTurn();
    room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: L, x: 9, y: 12 }, facing: 4 });
    room.apply({ c: 'join', id: 2, bot: true, name: 'TWO', skin: 5, spot: { map: L, x: 11, y: 12 }, facing: 3 });
    room.apply({ c: 'join', id: 7, bot: false, name: 'A', skin: 0, spot: { map: L, x: 3, y: 3 }, facing: 1 });
    room.actor(1)!.calm = room.actor(2)!.calm = 0;
    room.duelAfter = 0;
    // The walk-up takes longer than ten frames: from the start of the rung before.
    room.tick = PHASE * 3;
    const one = room.actor(1)!;
    for (let i = 0; i < PHASE - 20 && !one.judge; i++) room.step(new Map());
    expect(one.judge).toBe(7);
    expect(rung(room)).toBe(4);
    const fought = species(room, 1), rival = species(room, 2);
    for (let i = 0; i < PHASE && rung(room) < 5; i++) room.step(new Map());
    expect(rung(room)).toBe(5);
    room.apply({ c: 'bots', id: 7, a: 1, b: 2, winner: 2 });
    expect(bagOf(room, 1)).toEqual(fought);
    // The winner walks on, and the ring's rung is its team's again.
    expect(species(room, 2).length).toBeGreaterThan(rival.length);
  });

  it('is the team that lost to a legendary, on the rung it went in on', () => {
    const room = nearTheTurn();
    room.simBots = true;
    room.apply({ c: 'join', id: 1, bot: true, name: 'ONE', skin: 4, spot: { map: L, x: 10, y: 12 }, facing: 1 });
    const a = room.actor(1)!;
    a.loot = { items: [{ id: 4, n: 6 }], money: 0 };
    a.calm = 0;
    const key = 1 << 20;
    room.spills.set(key, { key, map: L, x: 10, y: 11, name: '', legend: true, bag: { items: [], money: 0, mons: [{ species: 404, level: 5 }] } });
    (room as unknown as { botLegend(a: unknown, s: unknown, e: unknown[]): void }).botLegend(a, room.spills.get(key), []);
    expect(a.foe).toBe(LEGEND_FOE);
    const fought = species(room, 1);
    pastTheTurn(room);
    room.apply({ c: 'bots', id: a.judge!, a: 1, b: LEGEND_FOE, winner: LEGEND_FOE });
    expect(bagOf(room, 1)).toEqual(fought);
  });

  it('a fight run from lets the team grow with the ring again', () => {
    const room = fightOf();
    const fought = species(room, 1);
    pastTheTurn(room);
    room.apply({ c: 'end', id: 2, fled: true });
    expect(species(room, 1).length).toBe(fought.length + 1);
  });

  it('a mirror that took the room\'s state mid-fight deals the same team', () => {
    const room = fightOf();
    const fought = species(room, 1);
    pastTheTurn(room);
    const mirror = makeRoom(MAPS, PATCHES, room.seed);
    mirror.load(structuredClone(room.state()));
    expect(species(mirror, 1)).toEqual(fought);
  });
});

describe('a bot\'s team while it walks', () => {
  // Cam, 11-04: "I also think I saw the sprite swap", LATIAS by a KYOGRE label. The label was the
  // legendary on the ground; the LATIAS was PHOEBE's own, come over to fight him.
  it('neither map nor rung deals it anew: who is in it stays, and the rung adds a slot', () => {
    const room = nearTheTurn();
    room.apply({ c: 'join', id: 1, bot: true, name: 'MAY', skin: 1, spot: { map: L, x: 10, y: 12 }, facing: 1 });
    const a = room.actor(1)!;
    const who = (phase: number) => botParty(room.seed, a, phase).map((m) => m.personality);
    const here = who(4);
    a.m.spot = { map: 'MAP_ROUTE117', x: 5, y: 5 };
    expect(who(4), 'the map under it').toEqual(here);
    expect(who(5).slice(0, here.length), 'the next rung').toEqual(here);
    expect(who(5).length).toBe(here.length + 1);
  });
});
