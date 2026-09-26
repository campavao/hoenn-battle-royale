import { describe, expect, it } from 'vitest';
import { devLand, devPace, parseRoomHash, ROOM_HASH_KEYS, withoutRoom, withRoom } from './hash';

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

// POK-327: the play-a-match e2e sets its own opening and fog, and where it lands.
describe('the dev flags a test plays a match with', () => {
  it('reads the pace: #fast, and #safari / #fog over it or alone', () => {
    expect(devPace('#solo')).toBeUndefined();
    expect(devPace('#solo&fast')).toEqual({ safariSecs: 25, fogSecs: 15 });
    expect(devPace('#solo&fast&safari=60')).toEqual({ safariSecs: 60, fogSecs: 15 });
    expect(devPace('#solo&fog=20')).toEqual({ fogSecs: 20 });
    // Nothing that is not a whole number of seconds: a typo is the room's own pace.
    expect(devPace('#solo&safari=0&fog=x')).toBeUndefined();
    expect(devPace('#solo&fast&safari=1.5')).toEqual({ safariSecs: 25, fogSecs: 15 });
  });

  it('reads the landing cell by map id', () => {
    expect(devLand('#solo&land=MAP_ROUTE102,36,16')).toEqual({ id: 'MAP_ROUTE102', x: 36, y: 16 });
    expect(devLand('#solo')).toBeUndefined();
    expect(devLand('#solo&land=ROUTE102,36,16')).toBeUndefined();
    expect(devLand('#solo&land=MAP_ROUTE102,36')).toBeUndefined();
  });
});
