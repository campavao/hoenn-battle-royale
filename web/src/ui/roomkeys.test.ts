import { describe, expect, it } from 'vitest';
import type { RosterEntry } from '../match/roster';
import { drawerKey, drawerLabel, stageKey } from './roomkeys';

function seat(seat: number, over: Partial<RosterEntry> = {}): RosterEntry {
  return { seat, name: `P${seat}`, alive: true, dir: 1, isMe: false, map: { group: 0, num: 1 }, x: 5, y: 5, ...over };
}

const nameOf = (seat: number) => `P${seat}`;

describe('the room keys renderRoom redraws on', () => {
  it('a step, a turn or a door is no reason to rebuild the drawer list', () => {
    // Eight bots walking a match: every step rewrites map, x, y and dir on every seat.
    const before = Array.from({ length: 8 }, (_, i) => seat(i));
    const after = before.map((e, i) => ({ ...e, map: { group: 0, num: 2 + i }, x: 9, y: 11, dir: 4 as const }));
    expect(drawerKey(after, nameOf)).toBe(drawerKey(before, nameOf));
    expect(stageKey(after, nameOf, null)).toBe(stageKey(before, nameOf, null));
  });

  it('the drawer list moves on what its buttons say: who, you, out, and the order', () => {
    const base = [seat(0, { isMe: true }), seat(1)];
    const key = drawerKey(base, nameOf);
    expect(drawerKey([base[0], { ...base[1], alive: false }], nameOf)).not.toBe(key);
    expect(drawerKey([{ ...base[0], isMe: false }, base[1]], nameOf)).not.toBe(key);
    expect(drawerKey(base, (s) => (s === 1 ? 'MAY' : nameOf(s)))).not.toBe(key);
    expect(drawerKey([base[1], base[0]], nameOf)).not.toBe(key);
    expect(drawerKey([base[0]], nameOf)).not.toBe(key);
    // A sprite is not on the list.
    expect(drawerKey([base[0], { ...base[1], skin: 'may' }], nameOf)).toBe(key);
  });

  it('the drawn room moves on a sprite, and on the open card\'s seat walking', () => {
    const base = [seat(0), seat(1)];
    expect(stageKey([base[0], { ...base[1], skin: 'may' }], nameOf, null)).not.toBe(stageKey(base, nameOf, null));
    const moved = [base[0], { ...base[1], map: { group: 0, num: 9 } }];
    expect(stageKey(moved, nameOf, 1)).not.toBe(stageKey(base, nameOf, 1));
    expect(stageKey(moved, nameOf, 0), 'somebody else walking').toBe(stageKey(base, nameOf, 0));
  });

  it("a drawer button's text", () => {
    expect(drawerLabel({ isMe: true, alive: true }, 'CAM')).toBe('CAM (you)');
    expect(drawerLabel({ isMe: false, alive: false }, 'MAY')).toBe('MAY -- OUT');
  });
});
