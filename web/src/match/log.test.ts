import { describe, expect, it } from 'vitest';
import { KEEP, MatchLog, describeMatch, loadLog, saveMatch, type LoggedMatch } from './log';
import type { Msg } from '../net/wire';

function store(): Pick<Storage, 'getItem' | 'setItem'> & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => void raw.set(k, v),
  };
}

const START: Msg = {
  t: 'start',
  seed: 4242,
  spawns: [
    { seat: 0, map: { group: 0, num: 9 }, x: 5, y: 5 },
    { seat: 1, map: { group: 0, num: 16 }, x: 7, y: 7 },
  ],
};

describe('the match log', () => {
  it('records a round from start to winner', () => {
    const log = new MatchLog();
    const names = (seat: number) => (seat === 0 ? 'CAM' : 'MAY');

    log.note(START, 1_000, names);
    log.note({ t: 'land', seat: 1, map: { group: 0, num: 16 }, x: 12, y: 3 }, 6_000);
    log.note({ t: 'ring', seat: 0, phase: 1, sx: 20, sy: 10, r: 8 }, 61_000);
    log.note({ t: 'botout', seat: 0, target: 1 }, 121_000);
    log.note({ t: 'out', seat: 1 }, 121_500);
    log.note({ t: 'win', seat: 0 }, 122_000);

    const match = log.current(122_000) as LoggedMatch;
    expect(match.seed).toBe(4242);
    expect(match.seats).toBe(2);
    expect(match.roster).toEqual({ 0: 'CAM', 1: 'MAY' });
    expect(match.winner).toBe(0);
    expect(match.ran).toBe(121);
    // Seconds from the start, in the order they happened.
    expect(match.events.map((e) => [e.t, e.at])).toEqual([
      ['drop', 5],
      ['ring', 60],
      ['kill', 120],
      ['out', 121],
      ['win', 121],
    ]);
    // A kill names both sides: the bot at seat 1 went down to seat 0.
    expect(match.events[2]).toMatchObject({ seat: 1, by: 0 });
    // ...and a drop is somewhere, because "where did everybody land" is half of why
    // anyone reads one of these.
    expect(match.events[0]).toMatchObject({ map: '0:16', x: 12, y: 3 });
  });

  it('says nothing before a match has started', () => {
    const log = new MatchLog();
    log.note({ t: 'out', seat: 3 }, 500);
    expect(log.current(500)).toBeNull();
    expect(log.live).toBe(false);
  });

  it('starts a fresh round on the next start', () => {
    const log = new MatchLog();
    log.note(START, 0);
    log.note({ t: 'out', seat: 1 }, 5_000);
    log.note(START, 10_000);
    expect((log.current(10_000) as LoggedMatch).events).toEqual([]);
  });

  it('stops recording after the winner, and ignores a second win', () => {
    const log = new MatchLog();
    log.note(START, 0);
    log.note({ t: 'win', seat: 1 }, 60_000);
    log.note({ t: 'win', seat: 0 }, 61_000);
    log.note({ t: 'out', seat: 0 }, 62_000);

    const match = log.current(62_000) as LoggedMatch;
    expect(match.winner).toBe(1);
    expect(match.events).toHaveLength(1);
  });

  it('keeps the last few rounds, newest first', () => {
    const disk = store();
    for (let i = 0; i < KEEP + 2; i++) {
      saveMatch({ started: i, seed: i, roster: {}, seats: 2, events: [], ran: 60 }, disk);
    }
    const kept = loadLog(disk);
    expect(kept).toHaveLength(KEEP);
    expect(kept[0].seed).toBe(KEEP + 1);
  });

  it('treats an unreadable log as an empty one', () => {
    const disk = store();
    disk.raw.set('hbr:log', '{not json');
    expect(loadLog(disk)).toEqual([]);
    disk.raw.set('hbr:log', '{"seed":1}');
    expect(loadLog(disk)).toEqual([]);
  });

  it('reads back as a line with the seed in it', () => {
    const line = describeMatch({
      started: new Date(2026, 8, 16, 14, 2).getTime(),
      seed: 1234,
      roster: { 3: 'CAM' },
      seats: 8,
      events: [],
      winner: 3,
      ran: 871,
    });
    expect(line).toBe('2026-09-16 14:02 · seed 1234 · 8 seats · 14:31 · CAM won');
  });
});
