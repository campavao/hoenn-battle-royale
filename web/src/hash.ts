// The room in the URL (POK-240/260): which door a page came in by, kept in the hash so a
// reload rejoins it and a link can be shared. Pure functions over the hash string, so the
// round trip that matters -- in by a door, back out to the lobby -- can be pinned without
// a browser (POK-330 #62). app.ts reads and writes `location` around them.

/** Every key that names a way into a room. One list, because two copies of it that both
 *  forgot `watch` is how BACK TO LOBBY from a `#watch=` link reloaded straight back into
 *  the room it was leaving. */
export const ROOM_HASH_KEYS = ['host', 'join', 'quick', 'solo', 'daily', 'watch'] as const;

export type RoomMode = (typeof ROOM_HASH_KEYS)[number];

export interface RoomHash {
  mode: RoomMode;
  code?: string;
}

function paramsOf(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ''));
}

/** `a=&b` rather than URLSearchParams' `a=&b=`: a door with no value is a bare key. */
function textOf(params: URLSearchParams): string {
  return params.toString().replace(/=(?=&|$)/g, '');
}

/** `#host` hosts a room, `#join=CODE` joins one, `#quick` takes whatever game is going,
 *  and `#solo` plays alone and opens no socket at all (Kanto's rule, project CLAUDE.md).
 *  No door at all is the lobby, which is a choice between those. */
export function parseRoomHash(hash: string): RoomHash | null {
  const params = paramsOf(hash);
  if (params.has('solo')) return { mode: 'solo' };
  if (params.has('host')) return { mode: 'host' };
  if (params.has('quick')) return { mode: 'quick' };
  if (params.has('daily')) return { mode: 'daily' };
  // `watch=CODE` is a seat-less door into a room (POK-260): the mode has always been
  // in the type and in the join, and nothing ever produced it, so the one deep link a
  // spectator could use fell through to the lobby.
  const watch = params.get('watch');
  if (watch && /^[A-Za-z0-9]+$/.test(watch)) return { mode: 'watch', code: watch.toUpperCase() };
  const code = params.get('join');
  return code && /^[A-Za-z0-9]+$/.test(code) ? { mode: 'join', code: code.toUpperCase() } : null;
}

/** The same hash through a different door: every other door out, this one in, and
 *  whatever else was there (the dev flags, `rom=`) left alone. No leading `#`. */
export function withRoom(hash: string, key: RoomMode, value?: string): string {
  const params = paramsOf(hash);
  for (const k of ROOM_HASH_KEYS) params.delete(k);
  params.set(key, value ?? '');
  return textOf(params);
}

/** The same hash with no door in it, which is the lobby. No leading `#`. */
export function withoutRoom(hash: string): string {
  const params = paramsOf(hash);
  for (const k of ROOM_HASH_KEYS) params.delete(k);
  return textOf(params);
}

// ---- dev flags (the page reads these in DEV only) ----------------------------------------

/** A whole number of seconds, or undefined for anything else. */
function secs(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  const n = raw === null || raw === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** The dev pace. `#fast` is a 25-second opening and 15-second fog phases, so a whole
 *  match can be looked at in three minutes; `#safari=N` and `#fog=N` set either one
 *  on its own, over `#fast` or without it (POK-327: a test that plays the opening
 *  needs time to walk into the grass and throw before the buzzer). Undefined when the
 *  hash asks for no pace at all, which is the room's own. */
export function devPace(hash: string): { safariSecs?: number; fogSecs?: number } | undefined {
  const params = paramsOf(hash);
  const fast = params.has('fast');
  const safari = secs(params, 'safari');
  const fog = secs(params, 'fog');
  if (!fast && safari === undefined && fog === undefined) return undefined;
  const pace: { safariSecs?: number; fogSecs?: number } = fast ? { safariSecs: 25, fogSecs: 15 } : {};
  if (safari !== undefined) pace.safariSecs = safari;
  if (fog !== undefined) pace.fogSecs = fog;
  return pace;
}

/** `#land=MAP_ID,x,y`: where our own drop lands, whatever section was picked, in the
 *  map's own coordinates (a `land` is map data, net/cells.ts). A test that meets a
 *  particular route trainer has to be put in front of them (POK-327). */
export function devLand(hash: string): { id: string; x: number; y: number } | undefined {
  const m = /^(MAP_[A-Z0-9_]+),(\d+),(\d+)$/.exec(paramsOf(hash).get('land') ?? '');
  return m ? { id: m[1], x: Number(m[2]), y: Number(m[3]) } : undefined;
}
