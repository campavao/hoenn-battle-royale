import { describe, expect, it } from 'vitest';
import { botRows, botSeatsOf, catchUp, freshMatch, offersToHost, onPromotion, unheardMatch } from './lifecycle';
import { Loot } from './loot';
import { dealBots } from '../bots/roster';
import type { RosterEvent } from '../net/relay';
import type { EventMsg, PickupMsg, SpillMsg } from '../net/wire';
import { mulberry32 } from './clock';
import { eventDrop, eventKey, homeKey } from './events';

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

// POK-330 #22: PLAY AGAIN never reset the match.
describe('the next match, after PLAY AGAIN', () => {

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

// POK-331 #13 review: a page that walked in on a match -- or whose socket was down for its
// `start` -- has no seed to pick it up from. It offered to run it anyway, so the relay made
// it host, it stood aside (can_host false), and with nobody else the room kept it: no
// clock, no ring, bots standing still, and no `win` ever.
describe('who offers to run the room', () => {
  const inFlight = () => ({ ...freshMatch(), seed: 7, active: true });

  it('a trainer in the match, and not one who is out', () => {
    const match = inFlight();
    expect(offersToHost(match, 1)).toBe(true);
    match.out.add(1);
    expect(offersToHost(match, 1)).toBe(false);
    expect(offersToHost(match, 2), 'somebody else going out is not us').toBe(true);
  });

  it('everybody between matches, and a page that heard the start', () => {
    expect(offersToHost(freshMatch(), 5), 'before any match, or back from one').toBe(true);
    expect(unheardMatch(inFlight())).toBe(false);
    const won = { ...freshMatch(), active: true, ended: true };
    expect(offersToHost(won, 5), 'a match that has been won is nobody\'s to run').toBe(true);
  });
});

// POK-330 #25: a seat back from a blip is a late arrival. The relay held it, but nobody told
// it what happened while it was gone -- its own elimination above all.
describe('catching a seat up on the match', () => {
  const ring = { phase: 2, sx: 3, sy: -1, r: 4, next: 3, place: 'ROUTE 104' };

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

  it('hands over the events: their marks, what of them is still lying anywhere, and a taken legendary as gone', () => {
    const loot = new Loot();
    const msgs = [
      ...eventDrop(mulberry32(1), { n: 0, phase: 2, seat: 1, mapsec: 31, map: { group: 0, num: 16 }, cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }] }),
      ...eventDrop(mulberry32(2), { n: 1, phase: 4, seat: 1, mapsec: 11, map: { group: 0, num: 17 }, cells: [{ x: 5, y: 5 }] }),
    ];
    for (const m of msgs) loot.note(m);
    loot.note({ t: 'spill', seat: 7, map: { group: 0, num: 16 }, mons: [{ key: 0x0700, x: 9, y: 9, species: 1, level: 5 }] });
    loot.note({ t: 'pickup', seat: 3, key: eventKey(1, 0) }); // event 1's legendary is gone
    const events = msgs.filter((m) => m.t === 'event') as EventMsg[];
    const out = catchUp(1, { clockLeft: 90, placements: [] }, [], events, loot);
    expect(out.slice(0, 2)).toEqual(events);
    const spills = out.filter((m) => m.t === 'spill') as SpillMsg[];
    expect(spills.flatMap((s) => s.mons.map((m) => m.key))).toEqual([eventKey(0, 0), eventKey(0, 1)]);
    expect(out.filter((m) => m.t === 'pickup')).toEqual([{ t: 'pickup', seat: 1, key: eventKey(1, 0) }]);
    expect(catchUp(1, { clockLeft: 90, placements: [] }, [], [], loot)).toEqual([]);
    const held = catchUp(1, { clockLeft: 90, placements: [] }, [], events, loot, [], (key) => (key === eventKey(1, 0) ? 3 : undefined));
    expect(held.filter((m) => m.t === 'pickup'), 'the one who took it, not the host').toEqual([{ t: 'pickup', seat: 3, key: eventKey(1, 0) }]);
  });

  // HBR-34: a house's or a floor's trader holds what he was last given only in each ROM,
  // so a seat that walks in late saw his seed Pokemon until the next trade.
  it('hands over what each house and floor trader holds now, after the events', () => {
    const homes: PickupMsg[] = [
      { t: 'pickup', seat: 7, key: homeKey(0x83), item: 252, n: 1 },
      { t: 'pickup', seat: 1, key: homeKey(5) },
    ];
    expect(catchUp(1, { clockLeft: 90, placements: [7] }, [], [], undefined, homes)).toEqual([{ t: 'out', seat: 7 }, ...homes]);
  });
});
