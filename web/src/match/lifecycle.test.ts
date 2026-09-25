import { describe, expect, it } from 'vitest';
import { botRows, botSeatsOf, departedSeats, freshMatch, onAgain, onPromotion, seatsFor } from './lifecycle';
import { dealBots } from '../bots/roster';
import type { RosterEvent } from '../net/relay';

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
