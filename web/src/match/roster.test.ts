import { describe, expect, it } from 'vitest';
import { Roster } from './roster';
import type { RosterEvent } from '../net/relay';
import { PROTOCOL, type Msg } from '../net/wire';

const ROOM: RosterEvent = {
  code: 'ABC123', host: 2, open: true, max: 8, pass: false,
  members: [{ id: 2, name: 'ASH' }, { id: 5, name: 'MISTY' }],
};

describe('Roster', () => {
  it('creates a row per relay member, keyed by relay id as seat', () => {
    const roster = new Roster();
    roster.applyRoster(ROOM);
    expect(roster.all().map((e) => e.seat)).toEqual([2, 5]);
    expect(roster.get(2)?.name).toBe('ASH');
    expect(roster.get(5)?.name).toBe('MISTY');
  });

  it('marks isMe on the seat set by setMySeat, before or after the roster arrives', () => {
    const roster = new Roster();
    roster.setMySeat(5);
    roster.applyRoster(ROOM);
    expect(roster.get(2)?.isMe).toBe(false);
    expect(roster.get(5)?.isMe).toBe(true);
    expect(roster.me()?.name).toBe('MISTY');

    const roster2 = new Roster();
    roster2.applyRoster(ROOM);
    roster2.setMySeat(2);
    expect(roster2.get(2)?.isMe).toBe(true);
    expect(roster2.get(5)?.isMe).toBe(false);
  });

  it('drops rows for members no longer in a later roster event', () => {
    const roster = new Roster();
    roster.applyRoster(ROOM);
    roster.applyRoster({ ...ROOM, members: [{ id: 2, name: 'ASH' }] });
    expect(roster.all().map((e) => e.seat)).toEqual([2]);
  });

  it('applies place to set position, facing, skin and alive', () => {
    const roster = new Roster();
    const place: Msg = {
      t: 'place', v: PROTOCOL, seat: 2, map: { group: 0, num: 9 }, x: 5, y: 8, f: 2,
      st: 'alive', sprite: 'may',
    };
    roster.applyMsg(place);
    const e = roster.get(2)!;
    expect(e).toMatchObject({ seat: 2, skin: 'may', map: { group: 0, num: 9 }, x: 5, y: 8, dir: 2, alive: true });
  });

  it('a place with st out marks the seat not alive', () => {
    const roster = new Roster();
    roster.applyMsg({ t: 'place', v: PROTOCOL, seat: 3, f: 1, st: 'out' });
    expect(roster.get(3)?.alive).toBe(false);
  });

  it('applies step to move a seat and out to eliminate it', () => {
    const roster = new Roster();
    roster.applyMsg({ t: 'step', seat: 5, d: 4, x: 10, y: 11, map: { group: 0, num: 1 } });
    expect(roster.get(5)).toMatchObject({ x: 10, y: 11, dir: 4, map: { group: 0, num: 1 } });
    roster.applyMsg({ t: 'out', seat: 5 });
    expect(roster.get(5)?.alive).toBe(false);
  });

  it('applies face to turn a seat in place without moving it', () => {
    const roster = new Roster();
    roster.applyMsg({ t: 'step', seat: 1, d: 1, x: 3, y: 3, map: { group: 0, num: 1 } });
    roster.applyMsg({ t: 'face', seat: 1, f: 3, map: { group: 0, num: 1 } });
    expect(roster.get(1)).toMatchObject({ x: 3, y: 3, dir: 3 });
  });

  it('onMap filters to seats sharing a map, alive() to seats not out', () => {
    const roster = new Roster();
    roster.applyMsg({ t: 'step', seat: 1, d: 1, x: 0, y: 0, map: { group: 0, num: 1 } });
    roster.applyMsg({ t: 'step', seat: 2, d: 1, x: 0, y: 0, map: { group: 0, num: 2 } });
    roster.applyMsg({ t: 'out', seat: 2 });
    expect(roster.onMap({ group: 0, num: 1 }).map((e) => e.seat)).toEqual([1]);
    expect(roster.alive().map((e) => e.seat)).toEqual([1]);
  });

  it('ignores messages that carry no seat-mirroring meaning', () => {
    const roster = new Roster();
    roster.applyMsg({ t: 'win', seat: 1 });
    expect(roster.all()).toEqual([]);
  });
});

// POK-330 #51. Bots are never relay members, so their rows had no name (P21..P31 in the
// ticker, the results and the saved round) and every relay roster event wiped them.
describe("the match's bots on the roster", () => {
  const BOTS = [
    { seat: 31, name: 'WALLY', skin: 2 },
    { seat: 30, name: 'ROXANNE', skin: 1 },
  ];

  it('have the names they were dealt', () => {
    const roster = new Roster();
    roster.applyMsg({ t: 'step', seat: 31, d: 1, x: 3, y: 3, map: { group: 0, num: 1 } });
    roster.seatBots(BOTS);
    expect(roster.nameOf(31)).toBe('WALLY');
    expect(roster.get(30)).toMatchObject({ name: 'ROXANNE', skin: '1' });
    expect(roster.nameOf(7), 'anybody unnamed is still a seat number').toBe('P7');
  });

  it('survive a relay roster event, which only prunes the people it no longer lists', () => {
    const roster = new Roster();
    roster.applyRoster(ROOM);
    roster.seatBots(BOTS);
    roster.applyMsg({ t: 'out', seat: 30 });
    roster.applyMsg({ t: 'step', seat: 9, d: 1, x: 0, y: 0, map: { group: 0, num: 1 } }); // nobody's
    roster.applyRoster({ ...ROOM, members: [{ id: 2, name: 'ASH' }] });
    expect(roster.all().map((e) => e.seat)).toEqual([2, 30, 31]);
    expect(roster.get(30)?.alive, 'and a bot that went out stays out').toBe(false);
  });

  it('leave with the match, and everybody still here stands up again', () => {
    const roster = new Roster();
    roster.applyRoster(ROOM);
    roster.seatBots(BOTS);
    roster.applyMsg({ t: 'out', seat: 5 });
    roster.endMatch();
    expect(roster.all().map((e) => e.seat)).toEqual([2, 5]);
    expect(roster.get(5)?.alive).toBe(true);
    // ...and the next roster event prunes them like anybody else's row.
    roster.applyMsg({ t: 'step', seat: 31, d: 1, x: 0, y: 0, map: { group: 0, num: 1 } });
    roster.applyRoster(ROOM);
    expect(roster.get(31)).toBeUndefined();
  });
});
