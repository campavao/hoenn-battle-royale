import { describe, expect, it } from 'vitest';
import { loadStats, recordSolo, setStatsOff, statFlushed, statMessage } from './stats';

/** A localStorage that lives for one test. */
function store() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('a solo match', () => {
  it('bumps the counter and mints an id and a date the first time', () => {
    const s = store();
    expect(loadStats(s).solo).toBe(0);
    const stats = recordSolo(s);
    expect(stats.solo).toBe(1);
    expect(stats.id).toMatch(/^[0-9a-f]{16}$/);
    expect(stats.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps the same id and date across matches, and only the count moves', () => {
    const s = store();
    const first = recordSolo(s);
    const second = recordSolo(s);
    expect(second.solo).toBe(2);
    expect(second.id).toBe(first.id);
    expect(second.since).toBe(first.since);
  });

  it('does nothing when opted out', () => {
    const s = store();
    setStatsOff(true, s);
    recordSolo(s);
    expect(loadStats(s).solo).toBe(0);
    expect(loadStats(s).id).toBeUndefined();
  });
});

describe('the opt-out', () => {
  it('does not erase what is already banked when turned on again', () => {
    const s = store();
    recordSolo(s);
    recordSolo(s);
    setStatsOff(true, s);
    setStatsOff(false, s);
    expect(loadStats(s).solo).toBe(2);
  });
});

describe('the stat envelope', () => {
  it('is null with nothing to report, or when opted out', () => {
    const s = store();
    expect(statMessage('1', s)).toBeNull();
    recordSolo(s);
    setStatsOff(true, s);
    expect(statMessage('1', s)).toBeNull();
  });

  it('carries the id, the version, the count and the date once there is something to say', () => {
    const s = store();
    const { id, since } = recordSolo(s);
    expect(statMessage('7', s)).toEqual({ type: 'stat', id, v: '7', solo: 1, since });
  });
});

describe('flushing', () => {
  it('clears the count but keeps the id and the date', () => {
    const s = store();
    const before = recordSolo(s);
    const after = statFlushed(s);
    expect(after.solo).toBe(0);
    expect(after.id).toBe(before.id);
    expect(after.since).toBe(before.since);
  });
});

describe('a store holding nonsense', () => {
  it('reads back clean rather than taking the page down', () => {
    const s = store();
    s.setItem('hbr:stats', '{"solo":-3,"id":"not hex","since":"whenever","off":"yes"}');
    const stats = loadStats(s);
    expect(stats.solo).toBe(0);
    expect(stats.id).toBeUndefined();
    expect(stats.since).toBeUndefined();
    expect(stats.off).toBe(false); // "off" isn't literal `true`, so it reads as on
  });

  it('survives a blocked store rather than throwing', () => {
    const blocked = {
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('nope');
      },
    };
    expect(loadStats(blocked).solo).toBe(0);
    expect(() => recordSolo(blocked)).not.toThrow();
  });
});
