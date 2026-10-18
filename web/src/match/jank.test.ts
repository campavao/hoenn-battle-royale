import { describe, expect, it } from 'vitest';
import { JANK_FIELDS, jankMessage, readJank, type JankCounts } from './jank';

const zero = (): JankCounts => Object.fromEntries(JANK_FIELDS.map((f) => [f, 0])) as JankCounts;

describe('jank (POK-376)', () => {
  it('reads gBrJank as eight u16s in its struct order', () => {
    const mem = new Map<number, number>();
    [3, 1, 2, 4, 31, 9, 0, 120].forEach((v, i) => mem.set(0x100 + i * 2, v));
    const read = (a: number, bits: number): number => (bits === 16 ? mem.get(a) ?? 0 : -1);
    expect(readJank(read, 0x100)).toEqual({ snaps: 3, cam: 1, lost: 2, stalls: 4, longest: 31, checks: 9, drifts: 0, watched: 120 });
  });

  it("sends the match's share, longest only when this match set it", () => {
    const start = { ...zero(), snaps: 5, longest: 40, checks: 2, watched: 60 };
    const end = { ...start, snaps: 7, checks: 10, watched: 180 };
    expect(jankMessage('0.3.9', start, end)).toEqual({ type: 'jank', v: '0.3.9', ...zero(), snaps: 2, checks: 8, watched: 120 });
    expect(jankMessage('0.3.9', start, { ...end, longest: 45 })?.longest).toBe(45);
  });

  it('wraps a u16 that rolled over, and says nothing for a quiet match', () => {
    expect(jankMessage('1', { ...zero(), watched: 0xfffe }, { ...zero(), watched: 2 })?.watched).toBe(4);
    expect(jankMessage('1', zero(), zero())).toBeNull();
  });
});
