import { describe, expect, it } from 'vitest';
import { battleId, battleSeats, CACHE_MAX_BYTES, EYE_WINDOW_MS, PEEK_INTERVAL_MS, Spectate } from './spectate';
import type { Msg } from '../net/wire';

const bstart = (battle: number): Msg => ({ t: 'bstart', battle, data: [1, 2, 3] });
const turn = (battle: number): Msg => ({ t: 'turn', battle, data: [0, 1, 0] });

describe('battle ids', () => {
  it('packs the seat pair low then high, either way round', () => {
    expect(battleId(1, 4)).toBe(battleId(4, 1));
    expect(battleSeats(battleId(1, 4))).toEqual([1, 4]);
  });
});

describe('the relay -> ROM gate', () => {
  it('drops a fight nobody asked to watch', () => {
    const s = new Spectate();
    expect(s.wantsFromRelay(bstart(battleId(1, 2)))).toBe(false);
    expect(s.wantsFromRelay(turn(battleId(1, 2)))).toBe(false);
  });

  it('passes the fight the watched seat is in, and its turns after', () => {
    const s = new Spectate();
    s.follow(2);
    expect(s.wantsFromRelay(bstart(battleId(1, 2)))).toBe(true);
    expect(s.wantsFromRelay(turn(battleId(1, 2)))).toBe(true);
    expect(s.watchingBattle()).toBe(battleId(1, 2));
  });

  it('drops somebody else\'s fight while watching one', () => {
    const s = new Spectate();
    s.follow(2);
    s.wantsFromRelay(bstart(battleId(1, 2)));
    expect(s.wantsFromRelay(bstart(battleId(3, 4)))).toBe(false);
    expect(s.wantsFromRelay(turn(battleId(3, 4)))).toBe(false);
  });

  it('forgets the fight when it ends, so the next one can start', () => {
    const s = new Spectate();
    s.follow(2);
    s.wantsFromRelay(bstart(battleId(1, 2)));
    s.noteResult(2);
    expect(s.watchingBattle()).toBeNull();
    expect(s.wantsFromRelay(bstart(battleId(2, 5)))).toBe(true);
  });

  it('forgets the fight when the watch moves to another seat', () => {
    const s = new Spectate();
    s.follow(2);
    s.wantsFromRelay(bstart(battleId(1, 2)));
    s.follow(7);
    expect(s.watchingBattle()).toBeNull();
    expect(s.wantsFromRelay(turn(battleId(1, 2)))).toBe(false);
  });

  it('hands a late watcher the fight from the top', () => {
    const s = new Spectate();
    // Not watching anyone: the stream is dropped, but remembered.
    expect(s.wantsFromRelay(bstart(battleId(1, 2)))).toBe(false);
    expect(s.wantsFromRelay(turn(battleId(1, 2)))).toBe(false);
    expect(s.wantsFromRelay(turn(battleId(1, 2)))).toBe(false);
    const out = s.follow(2);
    expect(out.map((m) => m.t)).toEqual(['follow', 'bstart', 'turn', 'turn']);
    expect(s.watchingBattle()).toBe(battleId(1, 2));
  });

  it('has nothing to hand over once the fight is done', () => {
    const s = new Spectate();
    s.wantsFromRelay(bstart(battleId(1, 2)));
    s.noteResult(1);
    expect(s.follow(2).map((m) => m.t)).toEqual(['follow']);
  });

  it('stops holding a fight that outgrows the cache', () => {
    const s = new Spectate();
    const battle = battleId(1, 2);
    s.wantsFromRelay(bstart(battle));
    const big: Msg = { t: 'turn', battle, data: new Array(CACHE_MAX_BYTES + 1).fill(0) };
    s.wantsFromRelay(big);
    expect(s.follow(2).map((m) => m.t)).toEqual(['follow']);
  });

  it('never takes a follow off the wire', () => {
    const s = new Spectate();
    s.follow(2);
    expect(s.wantsFromRelay({ t: 'follow', seat: 2 })).toBe(false);
  });

  it('takes a party only from the seat being watched', () => {
    const s = new Spectate();
    expect(s.wantsFromRelay({ t: 'party', seat: 3, mons: [] })).toBe(false);
    s.follow(3);
    expect(s.wantsFromRelay({ t: 'party', seat: 3, mons: [] })).toBe(true);
    expect(s.wantsFromRelay({ t: 'party', seat: 4, mons: [] })).toBe(false);
  });

  it('passes everything else untouched', () => {
    const s = new Spectate();
    expect(s.wantsFromRelay({ t: 'out', seat: 1 })).toBe(true);
  });
});

describe('the peek timer', () => {
  it('asks once per interval, and only while watching', () => {
    const s = new Spectate();
    expect(s.duePeek(0, 1000)).toBeNull();
    s.follow(4);
    expect(s.duePeek(0, 1000)).toEqual({ t: 'peek', seat: 0, target: 4 });
    expect(s.duePeek(0, 1000 + PEEK_INTERVAL_MS - 1)).toBeNull();
    expect(s.duePeek(0, 1000 + PEEK_INTERVAL_MS)).toEqual({ t: 'peek', seat: 0, target: 4 });
  });

  it('asks again at once after switching seats', () => {
    const s = new Spectate();
    s.follow(4);
    s.duePeek(0, 1000);
    s.follow(5);
    expect(s.duePeek(0, 1100)).toEqual({ t: 'peek', seat: 0, target: 5 });
  });
});

describe('the eye', () => {
  it('counts distinct recent peekers', () => {
    const s = new Spectate();
    s.notePeek(1, 1000);
    s.notePeek(2, 1000);
    s.notePeek(1, 1500);
    expect(s.eyes(1500)).toBe(2);
  });

  it('forgets a spectator who stopped asking', () => {
    const s = new Spectate();
    s.notePeek(1, 1000);
    expect(s.eyes(1000 + EYE_WINDOW_MS)).toBe(1);
    expect(s.eyes(1001 + EYE_WINDOW_MS)).toBe(0);
  });
});
