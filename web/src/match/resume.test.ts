import { describe, expect, it } from 'vitest';
import type { Msg } from '../net/wire';
import type { TabStore } from './left';
import { freshMatch } from './lifecycle';
import {
  fromBase64,
  Journal,
  JOURNAL_MAX,
  mayResume,
  packMatch,
  RESUME_MARGIN_MS,
  saveResume,
  takeResume,
  toBase64,
  unpackMatch,
  type ResumeRecord,
} from './resume';

function memory(): TabStore & { size(): number } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    size: () => m.size,
  };
}

const record = (at: number, build = 'abc'): ResumeRecord => ({
  v: 1,
  code: 'XDGUWY',
  token: 't0k',
  seat: 3,
  host: false,
  at,
  holdMs: 60_000,
  build,
  opts: { name: 'CAM' },
  match: packMatch(freshMatch(), 0, at),
  journal: [],
  rows: [],
});

describe('takeResume (HBR-20)', () => {
  it('a reload inside the hold comes back, once', () => {
    const store = memory();
    expect(saveResume(record(1_000), new Uint8Array([1, 2, 255]), store)).toBe(true);
    const back = takeResume({ build: 'abc', now: 21_000 }, store);
    expect(back?.rec.seat).toBe(3);
    expect([...back!.state]).toEqual([1, 2, 255]);
    expect(takeResume({ build: 'abc', now: 21_000 }, store)).toBeNull();
    expect(store.size()).toBe(0);
  });
  it('not once the relay has stopped holding the seat', () => {
    const store = memory();
    saveResume(record(0), new Uint8Array([1]), store);
    expect(takeResume({ build: 'abc', now: 60_000 - RESUME_MARGIN_MS }, store)).toBeNull();
  });
  it("not into another build's ROM", () => {
    const store = memory();
    saveResume(record(0), new Uint8Array([1]), store);
    expect(takeResume({ build: 'def', now: 1 }, store)).toBeNull();
  });
  it('a store that will not take it leaves nothing behind', () => {
    const full: TabStore = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(saveResume(record(0), new Uint8Array([1]), full)).toBe(false);
    expect(saveResume(record(0), new Uint8Array([1]), null)).toBe(false);
  });
});

describe('packMatch / unpackMatch', () => {
  it('the match comes back as it stood, its clock counted on across the reload', () => {
    const m = freshMatch();
    m.seed = 77;
    m.seats = [1, 2, 9];
    m.botSeats = new Set([9]);
    m.out = new Set([2]);
    m.ringPhase = 3;
    m.clockLeft = 90;
    m.clockAt = 5_000; // 1 s before the pack, by the old page's clock
    m.active = true;
    const saved = JSON.parse(JSON.stringify(packMatch(m, 6_000, 100_000)));
    const into = freshMatch();
    unpackMatch(into, saved, 200, 104_000); // 4 s later, a new page's clock
    expect(into.seed).toBe(77);
    expect([...into.botSeats]).toEqual([9]);
    expect([...into.out]).toEqual([2]);
    expect(into.active).toBe(true);
    expect(into.clockLeft).toBe(90);
    expect(into.clockAt).toBe(200 - 5_000); // the clock read 5 s ago
  });
});

describe('Journal', () => {
  const ring: Msg = { t: 'ring', phase: 1 } as unknown as Msg;
  const clock = (left: number): Msg => ({ t: 'clock', left } as unknown as Msg);
  const place = (seat: number): Msg => ({ t: 'place', v: 3, seat, f: 1, st: 'alive' });
  it('keeps the match from its start, the latest clock, and our own last place at the end', () => {
    const j = new Journal();
    j.note(ring, 'page', 1);
    j.note({ t: 'start' } as unknown as Msg, { from: 1 }, 2);
    j.note(ring, { from: 1 }, 3);
    j.note(clock(100), { from: 1 }, 4);
    j.note(clock(95), { from: 1 }, 5);
    j.note(place(4), 'rom', 6);
    j.note(place(7), { from: 7 }, 7);
    j.note({ t: 'bt', seat: 4, seq: 1, data: [] } as unknown as Msg, 'rom', 8);
    const kinds = j.entries()!.map(([m, , wall]) => `${m.t}@${wall}`);
    expect(kinds).toEqual(['start@2', 'ring@3', 'clock@5', 'place@6']);
  });
  it('too much to keep is nothing kept', () => {
    const j = new Journal();
    for (let i = 0; i <= JOURNAL_MAX; i++) j.note(ring, 'page', i);
    expect(j.entries()).toBeNull();
    j.note({ t: 'start' } as unknown as Msg, 'page', 0);
    expect(j.entries()).toHaveLength(1);
  });
});

describe('base64', () => {
  it('round-trips a savestate-sized buffer', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xff);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('mayResume', () => {
  const running = () => ({ ...freshMatch(), active: true });
  it('a seat still in a running match, on the field', () => {
    expect(mayResume({ seat: 2, match: running(), busy: new Set(), watching: false })).toBe(true);
  });
  it('never from a battle: the savestate would be a way out of it', () => {
    expect(mayResume({ seat: 2, match: running(), busy: new Set([2]), watching: false })).toBe(false);
  });
  it('not once out, watching, decided, or before the match', () => {
    expect(mayResume({ seat: 2, match: { ...running(), out: new Set([2]) }, busy: new Set(), watching: false })).toBe(false);
    expect(mayResume({ seat: 2, match: running(), busy: new Set(), watching: true })).toBe(false);
    expect(mayResume({ seat: 2, match: { ...running(), ended: true }, busy: new Set(), watching: false })).toBe(false);
    expect(mayResume({ seat: 2, match: freshMatch(), busy: new Set(), watching: false })).toBe(false);
  });
});
