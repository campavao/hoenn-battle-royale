import { describe, expect, it } from 'vitest';
import { parseRoomHash, ROOM_HASH_KEYS, withoutRoom, withRoom } from './hash';

describe('the room in the URL', () => {
  it('reads every door', () => {
    expect(parseRoomHash('#host')).toEqual({ mode: 'host' });
    expect(parseRoomHash('#quick&fast')).toEqual({ mode: 'quick' });
    expect(parseRoomHash('#daily')).toEqual({ mode: 'daily' });
    expect(parseRoomHash('#solo')).toEqual({ mode: 'solo' });
    expect(parseRoomHash('#join=abc123')).toEqual({ mode: 'join', code: 'ABC123' });
    expect(parseRoomHash('#watch=abc123')).toEqual({ mode: 'watch', code: 'ABC123' });
    expect(parseRoomHash('#rom=x')).toBeNull();
    expect(parseRoomHash('')).toBeNull();
  });

  // POK-330 #62: the two copies of the key list both left out `watch`, so leaving a room
  // you came into by a watch link reloaded straight back into it.
  it('every door can be left, a watch link included', () => {
    for (const key of ROOM_HASH_KEYS) {
      const inRoom = `#${withRoom('#fast&rom=x', key, key === 'join' || key === 'watch' ? 'ABC123' : undefined)}`;
      expect(parseRoomHash(inRoom), `${key} is a door`).not.toBeNull();
      expect(parseRoomHash(withoutRoom(inRoom)), `leaving by ${key} lands on the lobby`).toBeNull();
    }
    expect(withoutRoom('#watch=ABC123&noauto')).toBe('noauto');
  });

  it('going through a door takes you out of the one you were in, and keeps the rest', () => {
    expect(withRoom('#watch=ABC123&seed=4', 'join', 'ABC123')).toBe('seed=4&join=ABC123');
    expect(withRoom('#join=ABC123&rom=x', 'quick')).toBe('rom=x&quick');
  });
});
