import { describe, expect, it } from 'vitest';
import { endsOn, matchEnd } from './ending';
import type { Results } from './shared/room';

// SINBAD (3) won; CAM (1) went out first, a bot (2) second. WATCHER (9) came in after the
// fog closed, so is not an entrant: the 11-21 phone that ended on the field.
const res: Results = {
  round: 0,
  entrants: [[1, 'CAM'], [2, 'BOT'], [3, 'SINBAD']],
  fallen: [{ id: 1, name: 'CAM', by: 'SINBAD', at: 600 + 60 * 90 }, { id: 2, name: 'BOT', by: 'SINBAD', bot: true, at: 600 + 60 * 200 }],
  winner: 3,
  wonAt: 600 + 60 * 200,
};

describe('a match ends on the results for everybody in the room (Cam, 11-21)', () => {
  it('in a room, the results; only ?solo keeps the panel over the field', () => {
    expect(endsOn(true)).toBe('results');
    expect(endsOn(false)).toBe('panel');
  });

  it('a watcher who never played: the standings, no place or time of their own', () => {
    const end = matchEnd(res, 9, 600 + 60 * 201, 600);
    expect(end.played).toBe(false);
    expect(end.placement).toBeUndefined();
    expect(end.survived).toBeUndefined();
    expect(end.placed).toEqual([{ seat: 3, placement: 1 }, { seat: 2, placement: 2 }, { seat: 1, placement: 3 }]);
  });

  it('a trainer who was out and watching: their place and how long they lasted', () => {
    const end = matchEnd(res, 1, 600 + 60 * 201, 600);
    expect(end.played).toBe(true);
    expect(end.placement).toBe(3);
    expect(end.survived).toBe(90);
  });

  it('the champion: first, lasting to the win', () => {
    const end = matchEnd(res, 3, 600 + 60 * 201, 600);
    expect(end).toMatchObject({ played: true, placement: 1, survived: 200 });
  });
});

describe('the menu has LAST MATCH once a match has ended on the page', () => {
  it('after the ways in, before LEADERBOARD; not before any match', async () => {
    const { mainMenuRows } = await import('./lobby');
    const before = mainMenuRows('up', null).map((r) => r.id);
    expect(before).not.toContain('lobby-last-match');
    const after = mainMenuRows('up', null, true).map((r) => r.id);
    expect(after.indexOf('lobby-last-match')).toBe(after.indexOf('lobby-leaderboard') - 1);
    expect(after.indexOf('lobby-last-match')).toBeGreaterThan(after.indexOf('lobby-join-by-code'));
  });
});
