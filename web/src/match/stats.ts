// Play the relay could not otherwise see (POK-243). SOLO VS BOTS never opens a socket
// -- the lobby's own row says so, and `wireRoom`'s early return for `hash.mode ===
// 'solo'` is what makes it true -- so the mode most likely to be somebody's entire
// experience of this mod is invisible to it. Kanto's `lib/stats.lua` carries the same
// count the same way: a local counter, bumped nowhere near a connection, handed over
// on whatever the next real connection turns out to be for.
//
// The relay already answers a `stat` message (relay/server.js's `stat` case, in place
// since before this file existed) -- logged and counted, never acknowledged, so a
// client can send one and forget it. This is only the client half: the counter, the
// opt-out, and the envelope.
//
// localStorage, like career.ts, and for the same reason: one device's own record,
// best effort, never authority for anything.
const KEY = 'hbr:stats';

export interface Stats {
  /** 16 hex characters of nothing in particular -- an install id, not a player one.
   *  Minted the first time there is something to report, not at boot: an install that
   *  never plays solo and never opts into anything never needs one. */
  id?: string;
  /** YYYY-MM-DD, the day this install first had something worth counting. */
  since?: string;
  solo: number;
  off: boolean;
}

const EMPTY: Stats = { solo: 0, off: false };

function sane(value: unknown): Stats {
  if (typeof value !== 'object' || value === null) return { ...EMPTY };
  const raw = value as Record<string, unknown>;
  const solo = typeof raw.solo === 'number' && Number.isFinite(raw.solo) && raw.solo >= 0 ? Math.floor(raw.solo) : 0;
  const stats: Stats = { solo, off: raw.off === true };
  if (typeof raw.id === 'string' && /^[0-9a-f]{1,32}$/.test(raw.id)) stats.id = raw.id;
  if (typeof raw.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.since)) stats.since = raw.since;
  return stats;
}

export function loadStats(store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Stats {
  try {
    const raw = store.getItem(KEY);
    return raw ? sane(JSON.parse(raw)) : { ...EMPTY };
  } catch {
    // A private window, or somebody else's JSON under our key: start clean rather than
    // taking the page down over a count nobody is depending on.
    return { ...EMPTY };
  }
}

function save(stats: Stats, store: Pick<Storage, 'getItem' | 'setItem'>): void {
  try {
    store.setItem(KEY, JSON.stringify(stats));
  } catch {
    // Out of quota or a blocked store: this run's count does not survive the tab.
  }
}

function newId(): string {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    // No Web Crypto (an old test runner, a locked-down embed): good enough for a
    // counter nobody is relying on for identity.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A solo match started. No connection, nothing that could add so much as a
 *  millisecond to the dial-free promise SOLO VS BOTS makes -- a counter bump and a
 *  localStorage write, both already on this thread. Does nothing when opted out,
 *  same as Kanto's own `Stats.recordSolo`. */
export function recordSolo(store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Stats {
  const stats = loadStats(store);
  if (stats.off) return stats;
  stats.solo += 1;
  if (!stats.id) stats.id = newId();
  if (!stats.since) stats.since = today();
  save(stats, store);
  return stats;
}

/** Opts in or out. Flipping it does not erase whatever is already banked -- turning
 *  sharing back on later still reports the solo play that happened while it was off. */
export function setStatsOff(off: boolean, store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Stats {
  const stats = loadStats(store);
  stats.off = off;
  save(stats, store);
  return stats;
}

/** The `stat` envelope for `RelayClient.send`, or null when there is nothing worth a
 *  line in the relay's log: no id yet (nothing has ever been recorded) or the player
 *  said not to. `version` is a short client identifier -- Hoenn has no single "mod
 *  version" string at this call site, so `wireRoom` passes its own protocol number. */
export function statMessage(
  version: string,
  store: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): Record<string, unknown> | null {
  const stats = loadStats(store);
  if (stats.off || !stats.id) return null;
  return { type: 'stat', id: stats.id, v: version, solo: stats.solo, since: stats.since };
}

/** Only once the relay has actually been handed it -- a connection that never opens
 *  keeps the count for next time rather than losing it. */
export function statFlushed(store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Stats {
  const stats = loadStats(store);
  stats.solo = 0;
  save(stats, store);
  return stats;
}
