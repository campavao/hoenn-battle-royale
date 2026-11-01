// A play-test as data: the last ten minutes of what the world link did, in memory, for
// tools/br/replay.ts to run again frame by frame instead of a narrated video to be
// reconstructed from (Cam, 2026-11-01). The world is deterministic lockstep (shared/room.ts),
// so a room as it was plus every frame's inputs is the match.
//
// What the file holds: the Room's state, each frame's record, my keys, the battle messages
// (SpMsg), errors, frame-time spikes, the version line and the marks. What it never holds:
// the ROM, a save, the relay's rejoin key, a passcode. SpMsg's bytes are the party and
// action bytes every battle already sends over the relay (wire.ts), not the game's data.
//
// Nothing here touches the page until watchPage, so net.ts can import it under vitest.

import type { Room, RoomState } from './shared/room';
import type { SpMsg, WireFrame } from './shared/wire';

export const FORMAT = 'hoenn-playtest-1';
/** How much it keeps: from a Room state at most this old (and up to SNAPSHOT_MS older). */
export const RECORD_MS = 10 * 60_000;
/** A Room state this often, so the ring can lose its head and still run. */
export const SNAPSHOT_MS = 60_000;
/** A gap between drawn frames worth a line. */
export const SPIKE_MS = 50;
/** Marks outlive the ring (they are few): the file says one fell before its window. */
const MARKS_MAX = 200;
const TEXT_MAX = 800;
/** Past this, the file is gzipped. */
const GZIP_OVER = 1 << 20;

/** The log's entries; `t` is ms on the recorder's clock. */
export type Entry =
  /** A match: its Room as it starts (or as it is, joining late). */
  | { k: 'start'; t: number; mode: 'solo' | 'online'; me: number; h: number; state: RoomState }
  /** The Room now, so the log can begin here once the ring has lost what came before. */
  | { k: 'snap'; t: number; h: number; state: RoomState }
  /** The relay sent the Room again (a resync): this page loaded it. */
  | { k: 'state'; t: number; h: number; state: RoomState }
  /** One frame played, as the link played it; `h` the Room's hash after it, `q` the frames
   *  still in the page's buffer (online). */
  | { k: 'f'; t: number; h: number; q?: number; f: WireFrame }
  /** My keys changed to `b`. */
  | { k: 'in'; t: number; b: number }
  /** A battle message: `in` from the relay, `out` from my ROM (`as`: a bots' fight I judge). */
  | { k: 'sp'; t: number; dir: 'in' | 'out'; from?: number; as?: number; m: SpMsg }
  /** The link gave up on the frames in hand: `gap` the next was not the next, `desync` the
   *  relay's hash `want` was not mine, `behind` too far back to play through. */
  | { k: 'net'; t: number; what: 'gap' | 'desync' | 'behind'; tick: number; want?: number; got?: number }
  | { k: 'err'; t: number; what: 'console' | 'error' | 'rejection'; msg: string }
  | { k: 'spike'; t: number; ms: number }
  | { k: 'vis'; t: number; hidden: boolean };

/** A moment the player marked, and where the camera was. */
export interface Mark {
  n: number;
  t: number;
  /** The room's frame when it was marked, and whose camera. */
  tick: number;
  via: 'key' | 'eye';
  map: string;
  x: number;
  y: number;
}

export interface PageVersion {
  line: string;
  romSha1: string;
  world: string;
}

export interface Playtest {
  format: string;
  /** Date.now() when the file was saved, and when `t` was 0. */
  saved: number;
  origin: number;
  version: PageVersion | null;
  device?: string;
  marks: Mark[];
  log: Entry[];
}

export class Recorder {
  /** The clock (a test's own, under vitest). */
  now: () => number = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
  /** Serialised as they happen: a Room's state goes on changing, a string does not, and
   *  36000 short strings are lighter than the objects. `at[i]` is log[i]'s time. */
  private log: string[] = [];
  private at: number[] = [];
  /** The log's indices a replay can start from (start, snap, state), oldest first. */
  private anchors: number[] = [];
  private marks: Mark[] = [];
  private version: PageVersion | null = null;
  private lastSnap = 0;
  private lastBits = -1;
  private lastTick = 0;
  private pushes = 0;

  private stamp(): number {
    return Math.round(this.now());
  }

  private push(e: Entry, anchor = false): void {
    if (anchor) this.anchors.push(this.log.length);
    this.log.push(JSON.stringify(e));
    this.at.push(e.t);
    if ((++this.pushes & 255) === 0) this.trim();
  }

  /** Drops what is older than RECORD_MS, back to the last state a replay can start from. */
  private trim(): void {
    const horizon = this.stamp() - RECORD_MS;
    if (!this.at.length || this.at[0] >= horizon) return;
    let cut = 0;
    for (const i of this.anchors) {
      if (this.at[i] > horizon) break;
      cut = i;
    }
    // No newer state yet: only what came before the first state can go (no frame did).
    if (!cut) {
      const stop = this.anchors[0] ?? this.log.length;
      while (cut < stop && this.at[cut] < horizon) cut++;
    }
    if (!cut) return;
    this.log.splice(0, cut);
    this.at.splice(0, cut);
    this.anchors = this.anchors.filter((i) => i >= cut).map((i) => i - cut);
  }

  setVersion(v: PageVersion): void {
    this.version = v;
  }

  /** A match's Room, before its first frame. */
  start(mode: 'solo' | 'online', me: number, room: Room): void {
    const t = this.stamp();
    this.lastSnap = t;
    this.lastTick = room.tick;
    this.lastBits = -1;
    this.push({ k: 'start', t, mode, me, h: room.hash(), state: room.state() }, true);
  }

  /** The relay's Room, loaded over this page's. */
  resynced(room: Room): void {
    const t = this.stamp();
    this.lastSnap = t;
    this.lastTick = room.tick;
    this.push({ k: 'state', t, h: room.hash(), state: room.state() }, true);
  }

  /** One frame played, after the Room stepped it. */
  frame(f: WireFrame, room: Room, q?: number): void {
    const t = this.stamp();
    this.lastTick = room.tick;
    this.push({ k: 'f', t, h: room.hash(), ...(q ? { q } : {}), f });
    if (t - this.lastSnap >= SNAPSHOT_MS) {
      this.lastSnap = t;
      this.push({ k: 'snap', t, h: room.hash(), state: room.state() }, true);
    }
  }

  keys(bits: number): void {
    if (bits === this.lastBits) return;
    this.lastBits = bits;
    this.push({ k: 'in', t: this.stamp(), b: bits });
  }

  sp(dir: 'in' | 'out', m: SpMsg, who: { from?: number; as?: number } = {}): void {
    this.push({ k: 'sp', t: this.stamp(), dir, ...who, m });
  }

  net(what: 'gap' | 'desync' | 'behind', tick: number, want?: number, got?: number): void {
    this.push({ k: 'net', t: this.stamp(), what, tick, ...(want === undefined ? {} : { want, got }) });
  }

  error(what: 'console' | 'error' | 'rejection', msg: string): void {
    this.push({ k: 'err', t: this.stamp(), what, msg: msg.slice(0, TEXT_MAX) });
  }

  spike(ms: number): void {
    this.push({ k: 'spike', t: this.stamp(), ms: Math.round(ms) });
  }

  visibility(hidden: boolean): void {
    this.push({ k: 'vis', t: this.stamp(), hidden });
  }

  /** This moment, for the replay to print what was around it. Returns its number. */
  mark(via: 'key' | 'eye', where: { map: string; x: number; y: number }): number {
    const n = (this.marks.at(-1)?.n ?? 0) + 1;
    this.marks.push({ n, t: this.stamp(), tick: this.lastTick, via, map: where.map, x: where.x, y: where.y });
    if (this.marks.length > MARKS_MAX) this.marks.shift();
    return n;
  }

  get markCount(): number {
    return this.marks.at(-1)?.n ?? 0;
  }

  /** The whole recording as the file's text. */
  text(device?: string): string {
    this.trim();
    const saved = Date.now();
    const head = { format: FORMAT, saved, origin: Math.round(saved - this.now()), version: this.version, ...(device ? { device } : {}), marks: this.marks };
    return `${JSON.stringify(head).slice(0, -1)},"log":[${this.log.join(',')}]}`;
  }

  clear(): void {
    this.log = [];
    this.at = [];
    this.anchors = [];
    this.marks = [];
    this.lastSnap = 0;
    this.lastBits = -1;
    this.lastTick = 0;
  }
}

/** The page's one recorder: net.ts writes to it, main.ts marks and saves it. */
export const recorder = new Recorder();

const said = (v: unknown): string => {
  if (v instanceof Error) return v.stack ?? String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

/** Console errors, uncaught errors and rejections, and the tab being hidden (no frames
 *  run then, which the log should not read as a stall). */
export function watchPage(rec: Recorder = recorder): void {
  const was = console.error.bind(console);
  console.error = (...args: unknown[]) => { rec.error('console', args.map(said).join(' ')); was(...args); };
  addEventListener('error', (e) => rec.error('error', e.error ? said(e.error) : `${e.message} ${e.filename}:${e.lineno}:${e.colno}`));
  addEventListener('unhandledrejection', (e) => rec.error('rejection', said(e.reason)));
  document.addEventListener('visibilitychange', () => rec.visibility(document.hidden));
}

/** The file's name, sortable, by the local clock a screen recording also shows. */
export function fileName(d: Date, gz: boolean): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `hoenn-playtest-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json${gz ? '.gz' : ''}`;
}

/** Hands the recording to the player: a phone's share sheet when it takes the file, else
 *  a download. Resolves to the file's name. */
export async function saveRecording(rec: Recorder = recorder): Promise<string> {
  const text = rec.text(`${navigator.userAgent} ${innerWidth}x${innerHeight}@${devicePixelRatio}`);
  const gz = text.length > GZIP_OVER && typeof CompressionStream === 'function';
  const blob = gz
    ? await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')), { headers: { 'content-type': 'application/gzip' } }).blob()
    : new Blob([text], { type: 'application/json' });
  const name = fileName(new Date(), gz);
  const file = new File([blob], name, { type: blob.type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return name;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return name;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}
