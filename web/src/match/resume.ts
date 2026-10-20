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
// Not from inside a battle: a savestate from before the fight would be a way out of
// every losing one, so a reload there is a reload out of the match, as before.
// A host's bots come back as the seed dealt them, standing where they were: their brains
// lived in the tab, the same compromise a promoted heir makes (POK-252).
import type { MapRef, Msg, PlaceMsg } from '../net/wire';
import type { MatchSnapshot } from './lifecycle';
import type { TabStore } from './left';
import type { Via } from './session';

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

export type JournalEntry = [msg: Msg, via: Via, wall: number];

export interface ResumeRecord {
  v: 1;
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
  /** Where the host last saw each of its bots, which only the host ever heard. */
  rows: PlaceMsg[];
}

/** Whether a page going away now may come back to its match: a seat still in a running
 *  one, not watching it, and not in a battle -- a savestate from before a fight is a way
 *  out of every losing one, so a reload in one is a reload out of the match. */
export function mayResume(p: {
  seat: number;
  match: Pick<MatchSnapshot, 'active' | 'ended' | 'out'>;
  busy: ReadonlySet<number>;
  watching: boolean;
}): boolean {
  return !p.watching && p.match.active && !p.match.ended && !p.match.out.has(p.seat) && !p.busy.has(p.seat);
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

/** What the books need to be rebuilt from. The fight's own traffic and the room's
 *  chatter are not the match; and of where everybody is, only where our own ROM last was
 *  matters to the books (the loot it was handed for that map), so it is kept apart. */
const SKIPPED = new Set<Msg['t']>([
  'place', 'step', 'face', 'bt', 'bstart', 'turn', 'peek', 'shot', 'ping', 'pong', 'follow', 'card', 'ready', 'away',
]);
/** The books are rebuilt from at most this many, newest kept; past it the record is not
 *  written at all rather than written wrong. */
export const JOURNAL_MAX = 6000;

/** Every message the session books, as it books them, from the match's `start`. */
export class Journal {
  private list: JournalEntry[] = [];
  private lastPlace: JournalEntry | null = null;
  private overflow = false;

  note(msg: Msg, via: Via, wall: number): void {
    if (msg.t === 'start') this.clear();
    if (msg.t === 'place' && via === 'rom') {
      this.lastPlace = [msg, via, wall];
      return;
    }
    if (SKIPPED.has(msg.t)) return;
    // The clock says the same thing every five seconds: only the latest counts.
    if (msg.t === 'clock' && this.list.length > 0 && this.list[this.list.length - 1][0].t === 'clock') this.list.pop();
    if (this.list.length >= JOURNAL_MAX) {
      this.overflow = true;
      return;
    }
    this.list.push([msg, via, wall]);
  }

  clear(): void {
    this.list = [];
    this.lastPlace = null;
    this.overflow = false;
  }

  /** In the order they were booked, our ROM's last `place` at the end; null when there
   *  were too many to keep. */
  entries(): JournalEntry[] | null {
    if (this.overflow) return null;
    return this.lastPlace ? [...this.list, this.lastPlace] : [...this.list];
  }
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
    if (rec.v !== 1 || rec.build !== opts.build) return null;
    const age = opts.now - rec.at;
    if (!(age >= 0 && age < rec.holdMs - RESUME_MARGIN_MS)) return null;
    return { rec, state: fromBase64(state) };
  } catch {
    return null;
  }
}
