import { describe, expect, it } from 'vitest';
import { countdown, emptyNote, fixedRows, isRoomCode, roomRows } from './lobby';
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

  it('names the host\'s sprite, same as the profile row does', () => {
    expect(roomRows([room({ skin: '1' })])[0].detail).toBe('MAY · 3/8');
    // No skin on the listing (an older relay, or one that never set it): the count
    // is still the whole detail, not a blank leading "· ".
    expect(roomRows([room()])[0].detail).toBe('3/8');
    // A skin the four sprites don't cover is dropped rather than shown as a digit.
    expect(roomRows([room({ skin: 'nope' })])[0].detail).toBe('3/8');
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

describe('a room code', () => {
  it('is six characters from the relay\'s own alphabet', () => {
    expect(isRoomCode('7F3KM9')).toBe(true);
  });

  it('rejects the wrong length either way', () => {
    expect(isRoomCode('7F3KM')).toBe(false);
    expect(isRoomCode('7F3KM99')).toBe(false);
    expect(isRoomCode('')).toBe(false);
  });

  it('rejects 0/O/1/I/L -- the relay never issues them, so a code with one in it could not be real', () => {
    for (const bad of ['0F3KM9', 'OF3KM9', '1F3KM9', 'IF3KM9', 'LF3KM9']) {
      expect(isRoomCode(bad)).toBe(false);
    }
  });
});

describe('the countdown', () => {
  it('is mm:ss and never negative', () => {
    expect(countdown(0)).toBe('0:00');
    expect(countdown(65)).toBe('1:05');
    expect(countdown(-4)).toBe('0:00');
  });
});

describe('the profile rows', () => {
  it('are absent until there is a profile to show', () => {
    expect(fixedRows(true).some((r) => r.action.kind === 'name')).toBe(false);
  });

  it('put who you are at the top, above the ways in', () => {
    const rows = fixedRows(true, { name: 'WALLY', skin: 'MAY', record: '3 played' });
    expect(rows[0].label).toBe('WALLY');
    expect(rows[0].detail).toBe('3 played');
    expect(rows[1].label).toBe('MAY');
    expect(rows[4].label).toBe('SOLO VS BOTS');
  });

  it('shows the sprite note when there is one, otherwise the plain default', () => {
    const plain = fixedRows(true, { name: 'WALLY', skin: 'MAY' });
    expect(plain[1].detail).toBe('your sprite');
    const noted = fixedRows(true, { name: 'WALLY', skin: 'MAY', skinNote: 'RIVAL MAY at 3 wins' });
    expect(noted[1].detail).toBe('RIVAL MAY at 3 wins');
  });

  it('previews the chosen voice, or says there is nothing chosen yet', () => {
    const plain = fixedRows(true, { name: 'WALLY', skin: 'MAY' });
    expect(plain[2].label).toBe('MY VOICE');
    expect(plain[2].detail).toBe('what you say');
    const chosen = fixedRows(true, { name: 'WALLY', skin: 'MAY', voice: 'STILL STANDING.' });
    expect(chosen[2].detail).toBe('STILL STANDING.');
  });

  it('reads as shared unless stats were explicitly turned off', () => {
    const shared = fixedRows(true, { name: 'WALLY', skin: 'MAY' });
    expect(shared[3].label).toBe('PLAY STATS');
    expect(shared[3].detail).toBe('shared');
    const off = fixedRows(true, { name: 'WALLY', skin: 'MAY', statsOn: false });
    expect(off[3].detail).toBe('not shared');
  });
});
