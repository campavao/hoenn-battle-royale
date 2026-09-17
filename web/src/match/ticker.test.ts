import { describe, expect, it } from 'vitest';
import zoneSource from '../../../src/br/br_zone.c?raw';
import { beat, chest, CHEST_KEY, dropped, fewLeft, fog, LINE_MAX, opening, out, said, short, won } from './ticker';
import type { TickerMsg } from '../net/wire';

const all = (): (TickerMsg | null)[] => [
  opening(0, 120),
  dropped(0, 32),
  fog(0, 1, false),
  fog(0, 8, true),
  beat(0, 'BRENDAN', 'COURTNEY'),
  out(0, 'FLANNERY', 12),
  out(0, 'FLANNERY', 0),
  fewLeft(0, 3),
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

  it('say who beat whom, and mark it a kill', () => {
    const msg = beat(4, 'BRENDAN', 'MAY')!;
    expect(msg.text).toBe('BRENDAN BEAT MAY!');
    expect(msg.kind).toBe('kill');
    expect(msg.seat).toBe(4);
  });

  it('count down as people go out', () => {
    expect(out(0, 'WALLY', 7)!.text).toBe('WALLY IS OUT - 7 LEFT');
    expect(out(0, 'WALLY', 0)!.text).toBe('WALLY IS OUT!');
  });

  it('do not truncate a long name into nonsense in a two-name line', () => {
    // Both names are cut before the line is built, so the line is never cut mid-word.
    expect(beat(0, 'ABCDEFGHIJ', 'KLMNOPQRST')!.text).toBe('ABCDEFG BEAT KLMNOPQ!');
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
