// The machines' moves, against the headers they come from.
import { describe, expect, it } from 'vitest';
import tmsH from '../../include/constants/tms_hms.h?raw';
import movesH from '../../include/constants/moves.h?raw';
import { TMHM_MOVES } from './tmhm';

describe('TMHM_MOVES', () => {
  it("is FOREACH_TMHM's moves, TM01 to HM08, by their ids in moves.h", () => {
    const ids = new Map([...movesH.matchAll(/#define MOVE_(\w+)\s+(\d+)\b/g)].map((m) => [m[1], Number(m[2])]));
    const list = (name: string) => [...(tmsH.split(`#define ${name}(F)`)[1].split(/\n\s*\n/)[0]).matchAll(/F\((\w+)\)/g)].map((m) => ids.get(m[1]));
    expect(TMHM_MOVES).toEqual([...list('FOREACH_TM'), ...list('FOREACH_HM')]);
    expect(TMHM_MOVES[23]).toBe(ids.get('THUNDERBOLT')); // TM24
  });
});
