import { describe, expect, it } from 'vitest';
import worldJs from '../../../relay/world.js?raw';
import { boardView, cleanBoard, fetchBoard, listed } from './leaderboard';
import { PLAYER_KEY, exportCareer, importCareer, playerId, playerKey } from './career';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

const P = (id: string, name: string, rating: number, skin = 0) => ({ id: id.repeat(12), name, skin, rating, played: 3, wins: 1, best: 1 });

describe('the LEADERBOARD key (#397)', () => {
  it('is made once, kept, and goes with a career file', () => {
    const store = memory();
    const key = playerKey(store);
    expect(key).toMatch(PLAYER_KEY);
    expect(playerKey(store)).toBe(key);
    const other = memory();
    expect(importCareer(exportCareer(store), other)?.key).toBe(key);
    expect(playerKey(other)).toBe(key);
  });

  it('hashes to the id the relay logs (relay/world.js playerId)', async () => {
    // sha256("hbr-player:" + key), its first twelve hex digits, as Node's crypto makes it.
    expect(await playerId('ab'.repeat(16))).toBe('ea95686516d4');
    // ...and the relay's is that same hash.
    expect(worldJs).toContain('createHash("sha256").update(`hbr-player:${key}`).digest("hex").slice(0, 12)');
  });
});

describe('the LEADERBOARD list', () => {
  const entry = (place: number, mine = false) => ({ place, name: `T${place}`, skin: 0, rating: 1000 - place, played: 1, wins: 0, mine });
  it('shows the first that fit, and you in the last row when you are further down', () => {
    const all = Array.from({ length: 20 }, (_, i) => entry(i + 4, i === 15));
    expect(listed(all, 4)).toEqual({ shown: [all[0], all[1], all[2], all[15]], gap: true });
    expect(listed(all.slice(0, 3), 4)).toEqual({ shown: all.slice(0, 3), gap: false });
    expect(listed(all.map((e) => ({ ...e, mine: false })), 4).gap).toBe(false);
    expect(listed(all, 0).shown).toEqual([]);
  });
});

describe('the LEADERBOARD screen', () => {
  it('keeps only well-formed rows, best first', () => {
    const b = cleanBoard({ matches: 4, players: [P('a', 'ALICE', 990, 5), { id: 'zz', name: 'X', rating: 5000 }, P('b', '<b>', 1040, 99), P('c', 'CY', 1010)] })!;
    expect(b.players.map((p) => p.name)).toEqual(['', 'CY', 'ALICE']);
    // A sprite past the wardrobe is BRENDAN's, not a hole in the podium.
    expect(b.players.map((p) => p.skin)).toEqual([0, 0, 5]);
    expect(cleanBoard({ nope: 1 })).toBeNull();
  });

  it('says where you are, and shares a place on a tie', () => {
    const board = cleanBoard({ matches: 3, players: [P('a', 'ALICE', 1040), P('b', 'BOB', 1040), P('c', 'CY', 920, 7)] })!;
    const v = boardView(board, 'c'.repeat(12));
    expect(v.entries.map((e) => `${e.place}. ${e.name} ${e.rating}`)).toEqual(['1. ALICE 1040', '1. BOB 1040', '3. CY 920']);
    expect(v.entries[2]).toMatchObject({ mine: true, skin: 7 });
    expect(v.note).toBe('You are 3rd of 3, rated 920.');
    expect(boardView(board, null).note).toMatch(/another person/);
  });

  it('says so while it reads, when it cannot, and when nobody is on it', async () => {
    expect(boardView('loading', null).note).toMatch(/Reading/);
    expect(boardView(null, null).note).toMatch(/could not be read/);
    expect(boardView({ matches: 0, players: [] }, null).note).toMatch(/Nobody is on it yet/);
    expect(await fetchBoard((async () => { throw new Error('offline'); }) as typeof fetch)).toBeNull();
    expect(await fetchBoard((async () => new Response('nope', { status: 500 })) as typeof fetch)).toBeNull();
    expect(await fetchBoard((async () => new Response('nope', { status: 404 })) as typeof fetch)).toEqual({ matches: 0, players: [] });
    const ok = await fetchBoard((async () => new Response(JSON.stringify({ matches: 1, players: [P('a', 'ALICE', 1016)] }))) as typeof fetch);
    expect(ok?.players[0].name).toBe('ALICE');
  });
});
