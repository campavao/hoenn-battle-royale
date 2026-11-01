// A recording (recorder.ts) run again: its Room loaded, each frame played as a mirror plays
// it (shared/host.ts `play`), and the hash after each one held against the one the page
// had. tools/br/replay.ts is this with a file and a printout.

import { play } from './shared/host';
import type { Room, RoomEvent } from './shared/room';
import { FORMAT, type Entry, type Mark, type Playtest } from './recorder';

/** A frame whose hash came out other than the page's. */
export interface Mismatch { t: number; tick: number; want: number; got: number }

/** One line of what happened, when. */
export interface Moment { t: number; tick: number; text: string }

export interface MarkAt {
  mark: Mark;
  /** My trainer as the replay has them at the mark; null if off the map or before the log. */
  mine: { map: string; x: number; y: number } | null;
  /** False when the ring had lost this moment by the time the file was saved. */
  inLog: boolean;
  around: Moment[];
}

export interface Replayed {
  /** Matches begun in the log, frames played, and those whose hash was checked and held. */
  matches: number;
  frames: number;
  held: number;
  /** Every frame that differed; the first is the one to read (the rest follow from it). */
  mismatches: Mismatch[];
  /** States the log carries that the run reached by itself, and those it did not. */
  statesHeld: number;
  statesLost: number;
  moments: Moment[];
  marks: MarkAt[];
}

/** room.ts's KEY_*, bit by bit. */
const KEY_NAMES = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'B', 'A', 'SELECT'];

/** A keys mask as a thumb's words. */
export function bitsText(b: number): string {
  return KEY_NAMES.filter((_, i) => b & (1 << i)).join('+') || 'none';
}

function eventText(e: RoomEvent): string {
  const { type, id, tick: _tick, ...rest } = e;
  return `${type} ${id} ${JSON.stringify(rest)}`;
}

export function parseFile(text: string): Playtest {
  const file = JSON.parse(text) as Playtest;
  if (file.format !== FORMAT) throw new Error(`not a recording this replay reads: format ${String(file.format)}, want ${FORMAT}`);
  return file;
}

/** Runs the log. `make` builds an empty Room for a seed, as the page does. `aroundMs`:
 *  how far either side of a mark its moments reach. */
export function replay(file: Playtest, make: (seed: number) => Room, aroundMs = 5000): Replayed {
  const out: Replayed = { matches: 0, frames: 0, held: 0, mismatches: [], statesHeld: 0, statesLost: 0, moments: [], marks: [] };
  let room = null as Room | null;
  let me = 0;
  let spot: { map: string; x: number; y: number } | null = null;
  const pending = [...file.marks].sort((a, b) => a.t - b.t);
  const first = file.log[0]?.t ?? Infinity;
  const say = (t: number, text: string) => out.moments.push({ t, tick: room?.tick ?? 0, text });
  const atMark = (t: number) => {
    while (pending.length && pending[0].t <= t) {
      const mark = pending.shift()!;
      out.marks.push({ mark, mine: spot, inLog: mark.t >= first, around: [] });
    }
  };
  const load = (e: Extract<Entry, { state: unknown }>) => {
    room = make(e.state.seed);
    room.load(e.state);
    if (room.hash() !== e.h) out.statesLost += 1;
    else out.statesHeld += 1;
  };
  for (const e of file.log) {
    atMark(e.t);
    switch (e.k) {
      case 'start':
        out.matches += 1;
        me = e.me;
        load(e);
        spot = room!.actor(me)?.m.spot ?? null;
        say(e.t, `match starts: seed ${e.state.seed}, ${e.mode}, I am ${e.me}, ${e.state.actors.length} on the map`);
        break;
      case 'state':
        load(e);
        say(e.t, 'the relay sent the room again');
        break;
      case 'snap':
        // The log's first entry when the ring has lost the rest; else only a check.
        if (!room) load(e);
        else if (room.hash() === e.h) out.statesHeld += 1;
        else out.statesLost += 1;
        break;
      case 'f': {
        if (!room) break;
        const events = play(room, e.f);
        out.frames += 1;
        const got = room.hash();
        if (got === e.h) out.held += 1;
        else out.mismatches.push({ t: e.t, tick: room.tick, want: e.h, got });
        for (const c of e.f.cmds ?? []) say(e.t, `command ${JSON.stringify(c)}`);
        for (const ev of events) say(e.t, eventText(ev));
        const now = room.actor(me)?.m.spot ?? null;
        if (now && spot && (now.map !== spot.map || Math.abs(now.x - spot.x) + Math.abs(now.y - spot.y) > 1)) {
          say(e.t, `I jumped from ${spot.map} ${spot.x},${spot.y} to ${now.map} ${now.x},${now.y}`);
        }
        if (!now && spot) say(e.t, `I left the map at ${spot.map} ${spot.x},${spot.y}`);
        spot = now ? { map: now.map, x: now.x, y: now.y } : null;
        break;
      }
      case 'in': say(e.t, `keys ${bitsText(e.b)}`); break;
      case 'sp': say(e.t, `${e.m.t} ${e.dir} battle ${e.m.battle} (${e.m.data.length} bytes)${e.from ? ` from ${e.from}` : ''}${e.as ? ` as ${e.as}` : ''}`); break;
      case 'net': say(e.t, `link: ${e.what} at tick ${e.tick}${e.want === undefined ? '' : ` (relay ${e.want}, page ${e.got})`}`); break;
      case 'err': say(e.t, `${e.what}: ${e.msg}`); break;
      case 'spike': say(e.t, `frame took ${e.ms} ms`); break;
      case 'vis': say(e.t, e.hidden ? 'tab hidden' : 'tab shown'); break;
    }
  }
  atMark(Infinity);
  for (const m of out.marks) m.around = out.moments.filter((x) => Math.abs(x.t - m.mark.t) <= aroundMs);
  return out;
}
