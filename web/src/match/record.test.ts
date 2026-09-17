import { describe, expect, it } from 'vitest';
import { MatchRecord, recordLines } from './record';
import type { Msg } from '../net/wire';

const ring = (phase: number): Msg => ({ t: 'ring', seat: 0, phase, sx: 0, sy: 0, r: 4 });
const npcout = (seat: number, localId: number): Msg => ({
  t: 'npcout',
  seat,
  map: { group: 0, num: 16 },
  localId,
});
const pickup = (seat: number, key: number, item?: number): Msg => ({ t: 'pickup', seat, key, item });
const duel = (seatA: number, seatB: number, winner: number): Msg => ({
  t: 'dresult',
  seatA,
  seatB,
  winner,
  a: [],
  b: [],
});

function feed(rec: MatchRecord, msgs: Msg[]): void {
  for (const m of msgs) rec.note(m);
}

describe('the record card', () => {
  it('counts the rings you were still standing at, and stops counting when you are not', () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [ring(1), ring(2), ring(3), { t: 'out', seat: 5 }, ring(4), ring(5)]);
    expect(rec.forSeat(5).rings).toBe(3);
    // Seat 2 never went out, so the fog's latest move is theirs.
    expect(rec.forSeat(2).rings).toBe(5);
  });

  it('does not backdate a record on a second out for the same seat', () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [ring(2), { t: 'out', seat: 5 }, ring(6), { t: 'out', seat: 5 }]);
    expect(rec.forSeat(5).rings).toBe(2);
  });

  it('ignores a ring the host re-sends', () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [ring(4), ring(4), ring(3)]);
    expect(rec.forSeat(1).rings).toBe(4);
  });

  it("counts Hoenn's own trainers against whoever beat them", () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [npcout(1, 4), npcout(1, 7), npcout(2, 9)]);
    expect(rec.forSeat(1).trainers).toBe(2);
    expect(rec.forSeat(2).trainers).toBe(1);
  });

  it("does not count the fog's sweep as anybody's win (POK-299)", () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [{ ...npcout(1, 4), fog: true } as Msg, npcout(1, 7)]);
    expect(rec.forSeat(1).trainers).toBe(1);
  });

  it('counts a duel for both sides and the win for one of them', () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [duel(1, 2, 0), duel(1, 3, 1), duel(1, 4, 2)]);
    const one = rec.forSeat(1);
    expect(one.duels).toBe(3);
    expect(one.duelsWon).toBe(1);
    expect(rec.forSeat(3).duelsWon).toBe(1);
    // A draw is fought by both and won by neither.
    expect(rec.forSeat(4).duels).toBe(1);
    expect(rec.forSeat(4).duelsWon).toBe(0);
  });

  it('counts a bag leaving the ground once, not once per item in it', () => {
    const rec = new MatchRecord();
    rec.start();
    // Three stacks raided out of a bag that stays put (POK-237), then the bag itself.
    feed(rec, [pickup(1, 0x0302, 13), pickup(1, 0x0302, 19), pickup(1, 0x0302, 4), pickup(1, 0x0302)]);
    expect(rec.forSeat(1).took).toBe(1);
  });

  it('gives a seat that did nothing a record of doing nothing', () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [ring(2), npcout(9, 1)]);
    expect(rec.forSeat(3)).toEqual({ rings: 2, trainers: 0, duels: 0, duelsWon: 0, took: 0 });
  });

  it('forgets the last match when a new one starts', () => {
    const rec = new MatchRecord();
    rec.start();
    feed(rec, [ring(5), npcout(1, 2), pickup(1, 0x0101)]);
    rec.start();
    expect(rec.forSeat(1)).toEqual({ rings: 0, trainers: 0, duels: 0, duelsWon: 0, took: 0 });
  });
});

describe('the lines it draws', () => {
  it('always says how many rings, even none', () => {
    expect(recordLines({ rings: 0, trainers: 0, duels: 0, duelsWon: 0, took: 0 })).toEqual([
      { label: 'RINGS', value: '0' },
    ]);
  });

  it('leaves out what did not happen, and counts one piece as a piece', () => {
    const lines = recordLines({ rings: 6, trainers: 3, duels: 0, duelsWon: 0, took: 1 });
    expect(lines.map((l) => l.label)).toEqual(['RINGS', 'TRAINERS', 'TOOK']);
    expect(lines[2].value).toBe('1 piece');
  });

  it('says a duel record as won-of-fought', () => {
    const lines = recordLines({ rings: 2, trainers: 0, duels: 4, duelsWon: 3, took: 2 });
    expect(lines.find((l) => l.label === 'DUELS')?.value).toBe('3 of 4');
    expect(lines.find((l) => l.label === 'TOOK')?.value).toBe('2 pieces');
  });
});
