// How smooth a match looked from this page (POK-376): the ROM's gBrJank, read at the
// match's start and again once it is decided, and the difference sent to the relay as
// one `jank` line. Cam asked for spectating to be flawless; this is how we find out
// whether it is, from real matches rather than the drivers.
//
// gBrJank (include/br/br_spectate.h) is eight u16s and only ever counts up, so a
// match's share is the end minus the start, and a page that played three matches
// reports each on its own.

/** gBrJank's fields, in order, each a u16 at twice its index. */
export const JANK_FIELDS = ['snaps', 'cam', 'lost', 'stalls', 'longest', 'checks', 'drifts', 'watched'] as const;
export type JankCounts = Record<(typeof JANK_FIELDS)[number], number>;

export function readJank(read: (addr: number, bits: 8 | 16 | 32) => number, base: number): JankCounts {
  const out = {} as JankCounts;
  JANK_FIELDS.forEach((f, i) => {
    out[f] = read(base + i * 2, 16);
  });
  return out;
}

/** The build a `jank` line names: the ROM's sha1 in seven characters, as the version line
 *  shows it, or the protocol when no patch is running. The relay keeps at most 16 of
 *  [\w.+-] and logs "?" for anything else, and the whole 40-character sha1 made every
 *  line "?" (HBR-63). */
export function jankVersion(patch: string | undefined, protocol: number | undefined): string {
  return patch ? patch.slice(0, 7) : String(protocol ?? '?');
}

export interface JankMsg extends JankCounts {
  type: 'jank';
  v: string;
}

/** gBrJank.longest: the longest wait, not a count. The page zeroes it as a match starts
 *  (JANK_LONGEST), so the match's own is the value at its end. */
export const JANK_LONGEST = 8;

/** The match's share of the counters, `longest` as it stands at the end. A match with
 *  nothing watched and nothing snapped says nothing. */
export function jankMessage(v: string, start: JankCounts, end: JankCounts): JankMsg | null {
  const d = {} as JankCounts;
  for (const f of JANK_FIELDS) d[f] = (end[f] - start[f] + 0x10000) & 0xffff;
  d.longest = end.longest;
  if (JANK_FIELDS.every((f) => d[f] === 0)) return null;
  return { type: 'jank', v, ...d };
}
