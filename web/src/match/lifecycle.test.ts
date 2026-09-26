import { describe, expect, it, vi } from 'vitest';
import { botRows, botSeatsOf, catchUp, dealPlan, departedSeats, freshMatch, lootOwed, noteMatch, onAgain, onPromotion, ringClockLeft, seatsFor } from './lifecycle';
import { Loot } from './loot';
import { dealBots } from '../bots/roster';
import type { RosterEvent } from '../net/relay';
import type { Msg, StartMsg } from '../net/wire';

const room = (members: RosterEvent['members']): RosterEvent => ({ code: 'ABC123', host: 0, open: false, max: 8, pass: false, members });

// POK-330 #51: every page names the bots the host dealt, from nothing but the seed.
describe("the bots' names, off the seed", () => {
  const spawns = Array.from({ length: 5 }, (_, i) => ({ mapId: 'MAP_A', map: { group: 0, num: 1 }, x: i, y: 0 }));

  it('are the names the host dealt, whatever cells it dealt them', () => {
    for (const seed of [1, 20260916, 0x7fff_fff0]) {
      for (const humans of [[0], [0, 1, 4], [0, 31]]) {
        const dealt = dealBots(seed, 7, humans, spawns);
        const named = botRows(seed, dealt.map((b) => b.seat));
        expect(named, `seed ${seed}, people ${humans}`).toEqual(dealt.map((b) => ({ seat: b.seat, name: b.name, skin: b.skin })));
      }
    }
  });

  it("a guest reads the bots off a start: every seat no player holds", () => {
    const roster = room([{ id: 0, name: 'CAM' }, { id: 1, name: 'MAY' }, { id: 3, name: 'EYE', spectate: true }]);
    expect(botSeatsOf([0, 1, 31, 30, 29], roster)).toEqual([31, 30, 29]);
  });
});

describe('who has walked out of a running match (POK-271)', () => {
  // One human at seat 0 and bots at 31..25, the shape bots/roster.ts deals.
  const bots = new Set([31, 30, 29, 28, 27, 26, 25]);
  const field = [0, ...bots];

  // POK-330 #4: bots are never relay members, so a watcher walking in made the host
  // count every live bot as gone -- and ten seconds later eliminate them all.
  it('a watcher arriving mid-match takes nobody out', () => {
    const members = [0, 7]; // the host, and the watcher who just joined
    expect(departedSeats(field, bots, members, new Set())).toEqual([]);
  });

  it('a person who is no longer listed is gone', () => {
    const people = [0, 1, 2, ...bots];
    expect(departedSeats(people, bots, [0, 2], new Set())).toEqual([1]);
  });

  it('nor is anybody already out', () => {
    expect(departedSeats([0, 1, 2], new Set(), [0], new Set([1]))).toEqual([2]);
  });
});

// POK-330 #22: PLAY AGAIN never reset the match.
describe('the next match, after PLAY AGAIN', () => {
  it('is dealt to the people the relay lists, never to last match\'s bots on the page\'s roster', () => {
    const roster = room([{ id: 0, name: 'CAM' }, { id: 2, name: 'EYE', spectate: true }]);
    expect(seatsFor(roster), 'from the last roster').toEqual([0]);
    expect(seatsFor(roster, [0, 2, 5]), 'from the event in hand, watchers still out').toEqual([0, 5]);
    expect(seatsFor(null)).toEqual([]);
  });

  it('starts from nothing: no match on, none to take over', () => {
    const match = freshMatch();
    expect(match).toMatchObject({ seed: 0, seats: [], active: false, ended: false });
    expect(match.out.size + match.botSeats.size).toBe(0);
    expect(freshMatch().out, 'and never shares its sets with the last one').not.toBe(match.out);
  });

  it('an heir takes over a match in flight, and only that', () => {
    expect(onPromotion({ active: true, ended: false })).toBe('take-over');
    // Between START presses, or before the first: the room, and its START.
    expect(onPromotion(freshMatch())).toBe('room');
    // A match already won is waiting for its grace to bring everybody back to the room,
    // where START is the heir's. Taking it over restarted its clock and bots on ROMs
    // that had rebooted into Littleroot.
    expect(onPromotion({ active: true, ended: true })).toBe('none');
  });
});

// POK-330 #9: the host's `again` rides right behind its `win`, and every guest took it as
// the exit -- rebooting before anybody had read a result, and in the middle of a guest
// champion's Hall of Fame.
describe("the host's `again`", () => {
  const inMatch = { active: true, ended: false };
  const won = { active: true, ended: true };

  it('does not cut short a grace that seeing the win already started', () => {
    expect(onAgain({ running: false, match: won, graceArmed: true })).toBe('ignore');
    expect(onAgain({ running: false, match: won, graceArmed: false }), 'a champion waiting on the parade').toBe('ignore');
  });

  it('starts the grace on a page whose socket blinked over the win', () => {
    expect(onAgain({ running: false, match: inMatch, graceArmed: false })).toBe('grace');
  });

  it('means nothing to the host that sent it, or to a page already back in the room', () => {
    expect(onAgain({ running: true, match: inMatch, graceArmed: false })).toBe('ignore');
    expect(onAgain({ running: false, match: freshMatch(), graceArmed: false })).toBe('ignore');
  });
});

// POK-330 #25: a seat back from a blip is a late arrival. The relay held it, but nobody told
// it what happened while it was gone -- its own elimination above all.
describe('catching a seat up on the match', () => {
  const ring = { phase: 2, sx: 3, sy: -1, r: 4, place: 'ROUTE 104' };

  it('says where the fog is, how long it has, and who is out, in the order they went', () => {
    expect(catchUp(1, { ring, clockLeft: 42, placements: [30, 7, 31] })).toEqual([
      { t: 'ring', seat: 1, ...ring },
      { t: 'clock', seat: 1, left: 42 },
      { t: 'out', seat: 30 },
      { t: 'out', seat: 7 },
      { t: 'out', seat: 31 },
    ]);
  });

  it('still names the fallen before the fog has moved', () => {
    expect(catchUp(1, { clockLeft: 90, placements: [7] })).toEqual([{ t: 'out', seat: 7 }]);
  });

  // POK-331 #4: and the trainers beaten while it was gone, which its ROM still has standing.
  it('hands over the trainers beaten, after who is out', () => {
    const beaten = [
      { t: 'npcout', seat: 7, map: { group: 0, num: 17 }, localId: 3 },
      { t: 'npcout', seat: 1, map: { group: 0, num: 16 }, localId: 2 },
    ] as const;
    expect(catchUp(1, { clockLeft: 90, placements: [7] }, beaten)).toEqual([{ t: 'out', seat: 7 }, ...beaten]);
  });
});

// The ROM sends a `place` only on a map change, a warp, a ledge or the first frame after a
// menu or a battle. A player back from a blip who kept walking the same route sent only
// steps, and never got the loot lying on it.
describe('the loot a seat back from a blip is owed', () => {
  const ROUTE = { group: 0, num: 16 };
  const table = () => {
    const loot = new Loot();
    loot.note({ t: 'spill', seat: 9, map: ROUTE, mons: [{ key: 9 * 16 + 1, x: 3, y: 4, species: 252, level: 5 }] });
    return loot;
  };
  const step = (seat: number, map = ROUTE): Msg => ({ t: 'step', seat, d: 1, x: 3, y: 5, map });

  it('is paid on its first step, not only on a place', () => {
    const loot = table();
    const owed = new Set([7]);
    expect(lootOwed(owed, step(7), 7, (m) => loot.forMap(m))).toMatchObject({ t: 'spill', seat: 9, map: ROUTE });
    expect(owed.has(7)).toBe(false);
    expect(lootOwed(owed, step(7), 7, (m) => loot.forMap(m))).toBeNull(); // once
  });

  it('is paid on a place that says where it is, and waits out one that does not', () => {
    const loot = table();
    const owed = new Set([7]);
    const lobby: Msg = { t: 'place', v: 1, seat: 7, f: 1, st: 'alive' };
    expect(lootOwed(owed, lobby, 7, (m) => loot.forMap(m))).toBeNull();
    expect(owed.has(7)).toBe(true);
    const there: Msg = { ...lobby, map: ROUTE, x: 3, y: 5 } as Msg;
    expect(lootOwed(owed, there, 7, (m) => loot.forMap(m))?.map).toEqual(ROUTE);
  });

  it("is nobody else's to collect, and nothing for a seat that is owed nothing", () => {
    const loot = table();
    const owed = new Set([7]);
    expect(lootOwed(owed, step(30), 1, (m) => loot.forMap(m))).toBeNull(); // the host walking a bot
    expect(lootOwed(owed, step(8), 8, (m) => loot.forMap(m))).toBeNull();
    expect(owed.has(7)).toBe(true);
  });
});

// POK-330 #42: the arithmetic of a deal and of a takeover, out of app.ts's startDirector.
describe('dealing, and taking over', () => {
  const seeded = () => Object.assign(freshMatch(), { seed: 7, seats: [1, 2, 31, 30, 29], active: true });

  it('a fresh match has no bots to deal again and nobody gone, and draws a new seed', () => {
    const fresh = vi.fn(() => 42);
    expect(dealPlan(freshMatch(), [1, 2], 1, false, fresh)).toEqual({ takeOver: false, seed: 42, botSeats: [], humanSeats: [], gone: [] });
    expect(fresh).toHaveBeenCalledOnce();
  });

  it('a takeover keeps the seed and the bots it dealt, and counts out whoever has left', () => {
    const match = seeded();
    match.out.add(30);
    const fresh = vi.fn(() => 42);
    const plan = dealPlan(match, [2], 2, true, fresh);
    expect(plan).toMatchObject({ takeOver: true, seed: 7, botSeats: [31, 30, 29], humanSeats: [1, 2], gone: [1] });
    expect(plan.resume).toEqual({ botSeats: [31, 30, 29], humanSeats: [1, 2], out: new Set([30, 1]) });
    expect(fresh).not.toHaveBeenCalled();
  });

  it('quirk kept: a takeover of a match with no seed deals a fresh one, with nothing to resume', () => {
    const plan = dealPlan({ ...seeded(), seed: 0 }, [2], 2, true, () => 42);
    expect(plan.seed).toBe(42);
    expect(plan.resume).toBeUndefined();
  });

  it('a deal that is not a takeover draws a new seed over a match that had one', () => {
    expect(dealPlan(seeded(), [1, 2], 1, false, () => 42)).toMatchObject({ seed: 42, gone: [], resume: undefined });
  });
});

// POK-330 #42: app.ts's noteResult kept the snapshot by hand; this is that reducer.
describe('the match as the page hears it', () => {
  const start = (over: Partial<StartMsg> = {}): StartMsg => ({
    t: 'start',
    seed: 99,
    spawns: [0, 1, 31, 30].map((seat, i) => ({ seat, map: { group: 0, num: 1 }, x: i, y: 0 })),
    ...over,
  });
  const guest = { dealing: false, roster: room([{ id: 0, name: 'CAM' }, { id: 1, name: 'MAY' }]), defaultFog: 120 };

  it('a start fills in the object it is given, whatever the last match left in it', () => {
    const match = freshMatch();
    Object.assign(match, { ringPhase: 3, ringR: 5, centre: { sx: 1, sy: 1 }, ended: true, active: true });
    match.out.add(1);
    noteMatch(match, 60, start(), 1000, guest);
    expect(match).toMatchObject({ seed: 99, seats: [0, 1, 31, 30], ringPhase: 0, ringR: 0, centre: undefined, active: true, ended: false });
    expect(match.spawns[2]).toEqual({ map: { group: 0, num: 1 }, x: 2, y: 0 });
    expect(match.out.size).toBe(0);
  });

  it('a guest reads the bots off the room; the page that dealt them keeps its own', () => {
    const match = freshMatch();
    noteMatch(match, 60, start(), 0, guest);
    expect([...match.botSeats]).toEqual([31, 30]);
    const dealt = new Set([31, 30, 29]);
    match.botSeats = dealt;
    noteMatch(match, 60, start(), 0, { ...guest, dealing: true });
    expect(match.botSeats).toBe(dealt);
  });

  it("keeps the start's fog, or the room's when it names none", () => {
    expect(noteMatch(freshMatch(), 60, start({ fog: 30 }), 0, guest)).toBe(30);
    expect(noteMatch(freshMatch(), 60, start(), 0, guest)).toBe(120);
    expect(noteMatch(freshMatch(), 60, { t: 'clock', seat: 1, left: 9 }, 0, guest), 'anything else keeps it').toBe(60);
  });

  it('a ring moves the fog and puts the whole phase on the clock', () => {
    const match = freshMatch();
    noteMatch(match, 45, { t: 'ring', seat: 1, phase: 2, sx: 3, sy: -1, r: 9, place: 'ROUTE 104' }, 5000, guest);
    expect(match).toMatchObject({
      ringPhase: 2,
      centre: { sx: 3, sy: -1, place: 'ROUTE 104' },
      ringR: 9,
      clockLeft: ringClockLeft(2, 45),
      clockAt: 5000,
      active: true,
    });
  });

  it('a clock sets the time left, an out adds the seat, and a win ends it', () => {
    const match = freshMatch();
    noteMatch(match, 60, { t: 'clock', seat: 1, left: 42 }, 7000, guest);
    expect(match).toMatchObject({ clockLeft: 42, clockAt: 7000, active: true, ended: false });
    noteMatch(match, 60, { t: 'out', seat: 30 }, 0, guest);
    expect([...match.out]).toEqual([30]);
    noteMatch(match, 60, { t: 'win', seat: 1 }, 0, guest);
    expect(match.ended).toBe(true);
  });
});
