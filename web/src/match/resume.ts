// Back into the match after a reload (HBR-20, Cam 2026-10-20: "They should be able to
// rejoin back within a minute. After that they are out with the WATCH option.").
//
// A reload throws away the two things a match lives in: the ROM's RAM (the player's whole
// run) and this page's books (match/session.ts), and on the host the director and its
// bots too. The relay keeps the seat for a minute (POK-284), and the host keeps a seat
// that went quiet for as long (POK-330 #25), so the only thing missing is the tab's own
// half. The page writes it down as it goes away -- a savestate of the ROM, the session's
// messages, the match as any page in the room sees it -- in sessionStorage, which a
// reload keeps and nothing else does, and the reloaded page loads it back and asks for
// its seat with the relay's token, the way a socket that blinked does.
//
// Not from inside a fight, wild or linked, nor the walk-up into one: a savestate from
// before the fight would be a way out of every losing one, so a reload there is a reload
// out of the match, as before.
// A host's tab writes down the match it runs too (match/host.ts HostSnap): the clock, the
// bots with the teams and bags they had, their fights. Cam: a match against bots should
// wait a minute "before reseting the game completely".
import type { MapRef } from '../net/wire';
export { HOST_SNAP } from './hostsnap';
import type { HostSnap } from './hostsnap';
import type { JournalEntry } from './journal';
import type { MatchSnapshot } from './lifecycle';
import type { TabStore } from './left';

const KEY = 'hbr-resume';
const STATE_KEY = 'hbr-resume-state';

/** How far inside the relay's hold a reload must land: the socket and the boot take a
 *  few seconds, and a seat asked for after the hold ran out is refused anyway. */
export const RESUME_MARGIN_MS = 5_000;

/** The match as MatchSnapshot holds it, in a shape JSON keeps: sets as lists, and the
 *  clock's moment as wall time, since performance.now() starts over with the page. */
export interface SavedMatch {
  seed: number;
  seats: number[];
  spawns: { map: MapRef; x: number; y: number }[];
  botSeats: number[];
  ringPhase: number;
  centre?: { sx: number; sy: number; place?: string };
  ringR: number;
  clockLeft: number;
  clockWall: number;
  out: number[];
  active: boolean;
  ended: boolean;
}

export interface ResumeRecord {
  v: 2;
  code: string;
  token: string;
  seat: number;
  /** This page was running the match: it asks for the room back as its host. */
  host: boolean;
  /** Date.now() as the page went. */
  at: number;
  /** How long the relay said it holds a dropped seat. */
  holdMs: number;
  /** The build that wrote it: a savestate is only good for the ROM that made it. */
  build: string;
  opts: { name: string; skin?: string; pass?: string; patch?: string; protocol?: number };
  match: SavedMatch;
  journal: JournalEntry[];
  /** The match this page was running, when it was the host. */
  hosting?: HostSnap;
}

/** Whether a page going away now may come back to its match: a seat still in a running
 *  one, not watching it, and not in a fight or on its way into one (`busy` from the room,
 *  `fighting` read off our own ROM and its handshake) -- a savestate from before a fight
 *  is a way out of every losing one, so a reload in one is a reload out of the match. */
export function mayResume(p: {
  seat: number;
  match: Pick<MatchSnapshot, 'active' | 'ended' | 'out'>;
  busy: ReadonlySet<number>;
  watching: boolean;
  fighting: boolean;
}): boolean {
  return !p.watching && !p.fighting && p.match.active && !p.match.ended && !p.match.out.has(p.seat) && !p.busy.has(p.seat);
}

/** Which build a record belongs to: the patch when there is one, else the wire. */
export function buildId(patch: string | undefined, protocol: number | undefined): string {
  return patch ?? `p${protocol ?? '?'}`;
}

export function packMatch(m: MatchSnapshot, perfNow: number, wallNow: number): SavedMatch {
  return {
    seed: m.seed,
    seats: [...m.seats],
    spawns: m.spawns.map((s) => ({ ...s })),
    botSeats: [...m.botSeats],
    ringPhase: m.ringPhase,
    centre: m.centre ? { ...m.centre } : undefined,
    ringR: m.ringR,
    clockLeft: m.clockLeft,
    clockWall: wallNow - (perfNow - m.clockAt),
    out: [...m.out],
    active: m.active,
    ended: m.ended,
  };
}

/** Puts a saved match back into the page's one MatchSnapshot (it is never replaced:
 *  the e2e and every closure hold that object). */
export function unpackMatch(into: MatchSnapshot, saved: SavedMatch, perfNow: number, wallNow: number): void {
  into.seed = saved.seed;
  into.seats = [...saved.seats];
  into.spawns = saved.spawns.map((s) => ({ ...s }));
  into.botSeats = new Set(saved.botSeats);
  into.ringPhase = saved.ringPhase;
  into.centre = saved.centre ? { ...saved.centre } : undefined;
  into.ringR = saved.ringR;
  into.clockLeft = saved.clockLeft;
  into.clockAt = perfNow - (wallNow - saved.clockWall);
  into.out = new Set(saved.out);
  into.active = saved.active;
  into.ended = saved.ended;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function tabStore(): TabStore {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** What the page hands over as it goes. */
export interface Leaving extends Omit<ResumeRecord, 'v' | 'at' | 'match'> {
  match: MatchSnapshot;
  snapshot(): Uint8Array | null;
}

/** The record, written: false when the ROM would not give a state or the store would
 *  not take it. */
export function writeOnLeaving(p: Leaving, perfNow: number, wallNow: number, store: TabStore = tabStore()): boolean {
  const state = p.snapshot();
  if (!state) return false;
  const { snapshot: _snapshot, ...rest } = p;
  return saveResume({ ...rest, v: 2, at: wallNow, match: packMatch(p.match, perfNow, wallNow) }, state, store);
}

/** Written as the page goes. False when the store would not take it (full, refused):
 *  then nothing is left behind, and the reload is one out of the match. */
export function saveResume(rec: ResumeRecord, state: Uint8Array, store: TabStore = tabStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(STATE_KEY, toBase64(state));
    store.setItem(KEY, JSON.stringify(rec));
    return true;
  } catch {
    dropResume(store);
    return false;
  }
}

export function dropResume(store: TabStore = tabStore()): void {
  try {
    store?.removeItem(KEY);
    store?.removeItem(STATE_KEY);
  } catch {
    // nothing to drop
  }
}

/** The record this load can rejoin with, or null: none, unreadable, another build's, or
 *  too old for the relay to still be holding the seat. Forgotten as it answers, so a
 *  second reload is never a rejoin into a match this one already rejoined. */
export function takeResume(
  opts: { build: string; now: number },
  store: TabStore = tabStore(),
): { rec: ResumeRecord; state: Uint8Array } | null {
  let raw: string | null = null;
  let state: string | null = null;
  try {
    raw = store?.getItem(KEY) ?? null;
    state = store?.getItem(STATE_KEY) ?? null;
  } catch {
    return null;
  }
  dropResume(store);
  if (!raw || !state) return null;
  try {
    const rec = JSON.parse(raw) as ResumeRecord;
    if (rec.v !== 2 || rec.build !== opts.build) return null;
    const age = opts.now - rec.at;
    if (!(age >= 0 && age < rec.holdMs - RESUME_MARGIN_MS)) return null;
    return { rec, state: fromBase64(state) };
  } catch {
    return null;
  }
}
