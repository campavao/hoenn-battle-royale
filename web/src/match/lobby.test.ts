import { describe, expect, it } from 'vitest';
import { countdown, emptyNote, fixedRows, roomRows } from './lobby';
import type { RoomListing } from '../net/relay';

const room = (over: Partial<RoomListing> = {}): RoomListing => ({
  code: 'ABC123', host: 'BRENDAN', players: 3, seats: 8, pass: false, ...over,
});

describe('the fixed rows', () => {
  it('always offer solo, socket or no socket', () => {
    const offline = fixedRows(false);
    const solo = offline.find((r) => r.action.kind === 'solo')!;
    expect(solo.disabled).toBeFalsy();
    for (const r of offline.filter((x) => x.action.kind !== 'solo')) expect(r.disabled).toBe(true);
  });

  it('open up once the relay is there', () => {
    for (const r of fixedRows(true)) expect(r.disabled).toBeFalsy();
  });
});

describe('the room rows', () => {
  it('show how full a room is, and its padlock', () => {
    expect(roomRows([room()])[0].detail).toBe('3/8');
    expect(roomRows([room({ pass: true })])[0].detail).toContain('🔒');
  });

  it('show a full room without letting you press it', () => {
    const [row] = roomRows([room({ players: 8 })]);
    expect(row.disabled).toBe(true);
    expect(row.detail).toContain('FULL');
  });

  it('name the host, falling back to the code', () => {
    expect(roomRows([room()])[0].label).toBe('BRENDAN');
    expect(roomRows([room({ host: '' })])[0].label).toBe('ABC123');
  });

  it('turn the daily into its own row with a countdown', () => {
    const [row] = roomRows([room({ daily: true, host: 'DAILY', secs: 754, players: 2 })]);
    expect(row.label).toBe('DAILY GAME');
    expect(row.detail).toBe('starts in 12:34 · 2 waiting');
    expect(row.action.kind).toBe('daily');
    expect(row.disabled).toBeFalsy();
  });
});

describe('the empty list', () => {
  it('says what to do about it either way', () => {
    expect(emptyNote(true)).toContain('QUICK PLAY');
    expect(emptyNote(false)).toContain('SOLO');
  });
});

describe('the countdown', () => {
  it('is mm:ss and never negative', () => {
    expect(countdown(0)).toBe('0:00');
    expect(countdown(65)).toBe('1:05');
    expect(countdown(-4)).toBe('0:00');
  });
});
