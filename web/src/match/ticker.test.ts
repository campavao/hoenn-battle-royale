import { afterEach, describe, expect, it, vi } from 'vitest';
import zoneSource from '../../../src/br/br_zone.c?raw';
import * as Ticker from './ticker';
import { chest, CHEST_KEY, LINE_MAX, once, opening, out, outs, OutFeed, OUT_BATCH_MS, said, short, won } from './ticker';
import type { TickerMsg } from '../net/wire';

// Worst cases: seven-letter names, and 32 LEFT.
const all = (): (TickerMsg | null)[] => [
  opening(0, 120),
  out(0, 'FLANNERY', 12),
  out(0, 'FLANNERY', 0),
  outs(0, ['FLANNERY'], 31, 'COURTNEY'),
  outs(0, ['FLANNERY', 'COURTNEY'], 32),
  outs(0, ['FLANNERY', 'COURTNEY', 'WALLACE', 'BRENDAN'], 32),
  outs(0, Array.from({ length: 31 }, () => 'WWWWWWWWWW'), 32),
  outs(0, ['FLANNERY', 'COURTNEY'], 0),
  won(0, 'WALLACE'),
  said(0, 'COURTNEY', 'THE FOG IS COMING.'),
  chest(0, 'WWWWWWWWWW'),
];

describe('ticker lines', () => {
  it('all fit the window the ROM draws', () => {
    for (const msg of all()) {
      expect(msg).not.toBeNull();
      expect(msg!.text.length).toBeLessThanOrEqual(LINE_MAX);
    }
  });

  it('cut a name to what Emerald can hold', () => {
    expect(short('COURTNEY')).toBe('COURTNE');
    expect(short('may')).toBe('MAY');
    expect(short('   ')).toBe('TRAINER');
  });

  it('say who beat whom and how many are left, in one line marked a kill (POK-324)', () => {
    const msg = outs(4, ['MAY'], 5, 'BRENDAN')!;
    expect(msg.text).toBe('BRENDAN BEAT MAY - 5 LEFT');
    expect(msg.kind).toBe('kill');
    expect(msg.seat).toBe(4);
  });

  it('count down as people go out', () => {
    expect(out(0, 'WALLY', 7)!.text).toBe('WALLY IS OUT - 7 LEFT');
    expect(out(0, 'WALLY', 0)!.text).toBe('WALLY IS OUT!');
  });

  it('put outs that land together in one line (POK-324)', () => {
    expect(outs(0, ['MAY', 'WALLY'], 9)!.text).toBe('MAY AND WALLY ARE OUT - 9 LEFT');
    expect(outs(0, ['MAY', 'WALLY', 'ROXANNE'], 9)!.text).toBe('MAY AND 2 MORE ARE OUT - 9 LEFT');
    // The kill only names a lone out: in a batch it is one name among several.
    expect(outs(0, ['MAY', 'WALLY'], 9, 'BRENDAN')!.text).toBe('MAY AND WALLY ARE OUT - 9 LEFT');
    expect(outs(0, [], 9)).toBeNull();
  });

  it('do not truncate a long name into nonsense in a two-name line', () => {
    // Both names are cut before the line is built, so the line is never cut mid-word.
    expect(outs(0, ['KLMNOPQRST'], 3, 'ABCDEFGHIJ')!.text).toBe('ABCDEFG BEAT KLMNOPQ - 3 LEFT');
    expect(outs(0, ['ABCDEFGHIJ', 'KLMNOPQRST'], 32)!.text).toBe('ABCDEFG AND KLMNOPQ ARE OUT - 32 LEFT');
  });

  it('say nothing about the fog, the head count at the drop, or the last three (POK-324)', () => {
    // The ROM says the ring, once; the corner says the count; the outs say the rest.
    for (const gone of ['dropped', 'fog', 'fewLeft', 'cleared', 'beat']) expect(Ticker).not.toHaveProperty(gone);
  });
});

// Cam's play-test: lines about bots nobody saw, several a minute, and he read none of them.
describe('the outs, as the ticker says them (POK-324)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A field of `alive`, whose director counts an out before the feed settles it. */
  function feed(alive: number) {
    vi.useFakeTimers();
    const lines: string[] = [];
    let left = alive;
    const f = new OutFeed({ say: (m) => void (m && lines.push(m.text)), nameOf: (seat) => `P${seat}`, left: () => left });
    const gone = (seat: number) => {
      f.add(seat);
      left--;
      f.settle();
    };
    return { f, lines, gone };
  }

  it('gathers outs while more than three are left, and says them once the batch is up', () => {
    const { lines, gone } = feed(10);
    gone(1);
    gone(2);
    vi.advanceTimersByTime(OUT_BATCH_MS - 1);
    gone(3);
    expect(lines).toEqual([]);
    vi.advanceTimersByTime(1);
    // The count is the one after all three.
    expect(lines).toEqual(['P1 AND 2 MORE ARE OUT - 7 LEFT']);
    gone(4);
    vi.advanceTimersByTime(OUT_BATCH_MS);
    expect(lines).toEqual(['P1 AND 2 MORE ARE OUT - 7 LEFT', 'P4 IS OUT - 6 LEFT']);
  });

  it('says every out at once from three left, with whatever was gathered', () => {
    const { lines, gone } = feed(5);
    gone(1); // 4 left: gathered
    expect(lines).toEqual([]);
    gone(2); // 3 left: now, and P1 with it
    expect(lines).toEqual(['P1 AND P2 ARE OUT - 3 LEFT']);
    gone(3);
    expect(lines).toEqual(['P1 AND P2 ARE OUT - 3 LEFT', 'P3 IS OUT - 2 LEFT']);
    vi.advanceTimersByTime(OUT_BATCH_MS);
    expect(lines).toHaveLength(2);
  });

  it('names who beat a lone loser, and forgets it once said', () => {
    const { f, lines, gone } = feed(9);
    f.beat(7, 1);
    gone(1);
    vi.advanceTimersByTime(OUT_BATCH_MS);
    expect(lines).toEqual(['P7 BEAT P1 - 8 LEFT']);
    f.beat(7, 2);
    gone(2);
    gone(3);
    vi.advanceTimersByTime(OUT_BATCH_MS);
    expect(lines.at(-1)).toBe('P2 AND P3 ARE OUT - 6 LEFT');
    gone(2);
    vi.advanceTimersByTime(OUT_BATCH_MS);
    expect(lines.at(-1)).toBe('P2 IS OUT - 5 LEFT');
  });

  it('flushes what it has when asked -- the win goes after its out -- and nothing when it is empty', () => {
    const { f, lines, gone } = feed(10);
    gone(1);
    f.flush();
    expect(lines).toEqual(['P1 IS OUT - 9 LEFT']);
    f.flush();
    vi.advanceTimersByTime(OUT_BATCH_MS);
    expect(lines).toHaveLength(1);
  });

  it('lets go without a word, and leaves no timer behind', () => {
    const { f, lines, gone } = feed(10);
    gone(1);
    expect(vi.getTimerCount()).toBe(1);
    f.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(OUT_BATCH_MS);
    f.flush();
    expect(lines).toEqual([]);
  });
});

describe('the page never says the same line twice running (POK-324)', () => {
  it("drops a repeat of the last line, as Kanto's Ticker.push does", () => {
    const sent: string[] = [];
    const say = once((m) => void sent.push(m.text));
    say(won(0, 'MAY'));
    say(won(0, 'MAY'));
    say(null);
    say(opening(0, 5));
    say(won(0, 'MAY'));
    expect(sent).toEqual(['MAY WINS!', 'CATCH WHAT YOU CAN! 5s', 'MAY WINS!']);
  });
});

describe('a trainer speaking', () => {
  it('is their name and their words, marked as chat', () => {
    const msg = said(9, 'COURTNEY', 'FOUND YOU.')!;
    expect(msg.text).toBe('COURTNE: FOUND YOU.');
    expect(msg.kind).toBe('say');
    expect(msg.seat).toBe(9);
  });
});

describe('the DAY CARE chest', () => {
  it('says who got there first', () => {
    expect(chest(3, 'may')!.text).toBe('MAY EMPTIED THE DAY CARE!');
  });

  it('is keyed the way the ROM keys it', () => {
    // The page never sees the chest land, so the key is the only thing the two share.
    const m = /#define BR_CHEST_KEY (0x[0-9A-Fa-f]+)/.exec(zoneSource);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(CHEST_KEY);
  });
});
