import { describe, expect, it } from 'vitest';
import { encodeGen3 } from '../text/gen3';
import { battleId, battleSeats, CACHE_MAX_BYTES, EYE_WINDOW_MS, nameBstart, PEEK_INTERVAL_MS, romReplaying, Spectate } from './spectate';
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

describe("a proxy duel's bstart (POK-300)", () => {
  it('is named after the two bots, low seat first, seven characters and an EOS', () => {
    const data = new Array(40).fill(0);
    const msg = nameBstart({ t: 'bstart', battle: 3 | (9 << 8), data }, (s) => (s === 3 ? 'courtney' : 'Max'));
    expect(msg.data.slice(0, 8)).toEqual(data.slice(0, 8)); // the seed and flags are untouched
    expect(msg.data.slice(8, 16)).toEqual([...encodeGen3('COURTNE'), 0xff]);
    expect(msg.data.slice(16, 24)).toEqual([...encodeGen3('MAX'), 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(msg.data.slice(24)).toEqual(data.slice(24));
    expect(data[8]).toBe(0); // and the original was not written on
  });
});

// POK-330 #10. Every peek brought the whole fight again, and the ROM appends every turn it
// is handed, so a watcher's replay read a1 a2 a3 a1 a2 a3 a4: a fight that never happened.
describe('the fight so far, handed over once (POK-330 #10)', () => {
  const FIGHTER = 2;
  const FOE = 5;
  const WATCHER = 9;
  const battle = battleId(FIGHTER, FOE);
  const turnOf = (n: number): Msg => ({ t: 'turn', battle, data: [0, 1, n] });

  /** A watcher's ROM as br_spectate.c has it: a `bstart` starts a replay only when none is
   *  running and only from the field (ParseBstart), and a `turn` is appended to the replay
   *  it belongs to, whatever it says (ParseTurn keeps no count). */
  class Rom {
    watching: number | null = null;
    inMenu = false;
    turns: number[] = [];
    take(msg: Msg): void {
      if (msg.t === 'bstart' && this.watching === null && !this.inMenu) this.watching = msg.battle;
      if (msg.t === 'turn' && msg.battle === this.watching) this.turns.push(msg.data[2]);
    }
    /** The replay reached the fight's end -- the last mon on a side fainted -- and let
     *  go, back to the field. */
    over(): void {
      this.watching = null;
    }
  }

  /** The fighter's page, the watcher's page and ROM, and the relay between them. `heard`
   *  says whether the watcher is in the room for the fight's broadcasts yet. */
  function room(heard: boolean) {
    const fighter = new Spectate();
    const watcher = new Spectate();
    const rom = new Rom();
    let now = 0;
    const deliver = (msg: Msg) => {
      if (watcher.wantsFromRelay(msg)) rom.take(msg);
    };
    const say = (msg: Msg) => {
      fighter.noteOutgoing(msg);
      if (heard) deliver(msg);
    };
    const join = () => {
      heard = true;
    };
    // The watcher's pump: a peek when one is due, answered by the fighter's page.
    const peek = (romHas: number | null | undefined = rom.watching) => {
      const ask = watcher.duePeek(WATCHER, now, romHas);
      if (ask?.t === 'peek') for (const part of fighter.streamFor(ask.target, ask.have)) deliver(part);
      now += PEEK_INTERVAL_MS;
    };
    return { rom, watcher, say, peek, join, follow: (seat: number) => watcher.follow(seat).forEach((m) => rom.take(m)) };
  }

  it('a watcher who walks in mid-fight is handed it once, and then only the live turns', () => {
    const { rom, say, peek, join, follow } = room(false);
    say({ t: 'bstart', battle, data: [1, 2, 3] });
    say(turnOf(1));
    say(turnOf(2));
    join();
    follow(FIGHTER); // nothing cached: it was not in the room for any of that
    peek(); // ...so the first peek brings the fight from the top
    expect(rom.turns).toEqual([1, 2]);
    say(turnOf(3));
    peek(null); // the ROM has not read the bstart off the ring yet: the page's word stands
    say(turnOf(4));
    peek();
    peek();
    expect(rom.turns).toEqual([1, 2, 3, 4]);
  });

  it('a player who goes out and watches from the cache is not handed it a second time', () => {
    const { rom, say, peek, follow } = room(true);
    say({ t: 'bstart', battle, data: [1, 2, 3] });
    say(turnOf(1));
    say(turnOf(2));
    follow(FIGHTER); // autoWatch: the cached fight goes straight to the ROM
    peek(null); // at once, before the ROM has read any of it
    say(turnOf(3));
    peek();
    expect(rom.turns).toEqual([1, 2, 3]);
  });

  it('asks again for a fight its ROM refused, and gets it once', () => {
    const { rom, say, peek, follow } = room(true);
    say({ t: 'bstart', battle, data: [1, 2, 3] });
    say(turnOf(1));
    rom.inMenu = true; // the bstart lands with the START menu open
    follow(FIGHTER);
    peek(null);
    rom.inMenu = false;
    say(turnOf(2)); // lost too: the ROM is not replaying anything to add it to
    expect(rom.turns).toEqual([]);
    peek(); // the ROM says it holds nothing: the fight again, from the top
    say(turnOf(3));
    peek();
    expect(rom.turns).toEqual([1, 2, 3]);
  });

  // A replay is a turn behind the fight, and a faint that ends it ends the replay seconds
  // before the fighters' own link winds down and says RESULT. The ROM saying "watching
  // nothing" then was taken for a ROM that never got the fight: the fighter handed it
  // over again, and the watcher saw the fight it had just watched start from the top.
  it('does not hand a fight back to a ROM that played it to the end', () => {
    const { rom, say, peek, follow } = room(true);
    say({ t: 'bstart', battle, data: [1, 2, 3] });
    say(turnOf(1));
    follow(FIGHTER);
    peek();
    say(turnOf(2));
    peek();
    rom.over();
    peek();
    peek();
    expect(rom.watching).toBeNull();
    expect(rom.turns).toEqual([1, 2]);
  });

  it('watches the same two seats fight again once the first fight has a RESULT', () => {
    const { rom, watcher, say, peek, follow } = room(true);
    say({ t: 'bstart', battle, data: [1, 2, 3] });
    say(turnOf(1));
    follow(FIGHTER);
    peek();
    rom.over();
    peek();
    say({ t: 'result', seat: FIGHTER, outcome: 'win' });
    watcher.noteResult(FIGHTER); // the page's own onMessage, for a RESULT off the relay
    peek();
    say({ t: 'bstart', battle, data: [1, 2, 3] }); // a rematch: the same pair, the same id
    say(turnOf(7));
    peek();
    expect(rom.watching).toBe(battle);
    expect(rom.turns).toEqual([1, 7]);
  });

  // A background tab runs no frames and its peeks keep firing: RAM said "watching nothing"
  // on every other one, the fight came again each time, and the ROM appended every copy.
  it('is handed the fight once however many peeks a background tab makes', () => {
    const fighter = new Spectate();
    const watcher = new Spectate();
    const rom = new Rom();
    const queue: Msg[] = []; // the RomPort, which only a frame empties
    const port = { get queued() { return queue.length; }, mailbox: { pending: () => 0 } };
    const frame = () => queue.splice(0).forEach((m) => rom.take(m));
    let now = 0;
    const peek = () => {
      const ask = watcher.duePeek(WATCHER, now, romReplaying(port, () => rom.watching));
      if (ask?.t === 'peek') {
        for (const part of fighter.streamFor(ask.target, ask.have)) if (watcher.wantsFromRelay(part)) queue.push(part);
      }
      now += PEEK_INTERVAL_MS;
    };
    fighter.noteOutgoing({ t: 'bstart', battle, data: [1, 2, 3] });
    fighter.noteOutgoing(turnOf(1));
    fighter.noteOutgoing(turnOf(2));
    watcher.follow(FIGHTER).forEach((m) => queue.push(m));
    for (let i = 0; i < 6; i++) peek(); // in the background: no frames
    frame(); // back
    peek();
    frame();
    expect(rom.turns).toEqual([1, 2]);
  });

  it('believes RAM once the ROM has read everything it was handed', () => {
    const idle = { queued: 0, mailbox: { pending: () => 0 } };
    expect(romReplaying(idle, () => battle)).toBe(battle);
    expect(romReplaying(idle, () => null)).toBeNull();
    expect(romReplaying({ ...idle, queued: 1 }, () => null)).toBeUndefined();
    expect(romReplaying({ queued: 0, mailbox: { pending: () => 3 } }, () => null)).toBeUndefined();
  });

  it('says what it holds only when it holds something', () => {
    const s = new Spectate();
    s.follow(FIGHTER);
    expect(s.duePeek(WATCHER, 0, null)).toEqual({ t: 'peek', seat: WATCHER, target: FIGHTER });
    s.wantsFromRelay({ t: 'bstart', battle, data: [1] });
    expect(s.duePeek(WATCHER, PEEK_INTERVAL_MS, null)).toEqual({ t: 'peek', seat: WATCHER, target: FIGHTER, have: battle });
    // A page with no RAM to read goes by what it handed over.
    expect(s.duePeek(WATCHER, 2 * PEEK_INTERVAL_MS)).toMatchObject({ have: battle });
  });
});
