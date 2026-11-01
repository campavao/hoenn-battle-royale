// What the room painter (rooms-page.ts) knows without a screen: which cells of a room can
// hold an item ball or a person, and the file it hands back. rooms.json has one of each for
// a room, from br_balls.c's sRooms; tools/br/apply-room-paint.py writes a painting back
// there, so the live match and spike B stay on one table.
import type { World, WorldMap } from '../src/bots/world';

/** A row of rooms.json. */
export type RoomRow = [map: string, cacheX: number, cacheY: number, house: boolean, cache: boolean, personX: number, personY: number, trader: boolean];

/** A room as painted: `item` null for no ball in it. */
export interface Painted { item: [number, number] | null; person: [number, number] }

/** The room as the table has it. */
export function asTabled(row: RoomRow): Painted {
  return { item: row[4] ? [row[1], row[2]] : null, person: [row[5], row[6]] };
}

const key = (x: number, y: number) => `${x},${y}`;

/** The cells a trainer can stand on, walking in from the room's doors. */
export function standable(world: World, m: WorldMap): Set<string> {
  const seen = new Set<string>();
  const queue: { x: number; y: number }[] = [];
  const walk = (x: number, y: number) => {
    for (const n of world.neighbours({ map: m.id, x, y })) {
      if (n.to.map !== m.id || seen.has(key(n.to.x, n.to.y))) continue;
      seen.add(key(n.to.x, n.to.y));
      queue.push(n.to);
    }
  };
  for (const w of m.warps ?? []) walk(w.x, w.y);
  while (queue.length) { const at = queue.pop()!; walk(at.x, at.y); }
  return seen;
}

/** Where a ball or a person can go: on the floor, or on a table or behind a counter with
 *  somewhere to stand beside it to press A. Never on a door, and never out of reach. */
export function placeable(m: WorldMap, stand: ReadonlySet<string>, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
  if ((m.warps ?? []).some((w) => w.x === x && w.y === y)) return false;
  return stand.has(key(x, y)) || [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => stand.has(key(x + dx, y + dy)));
}

const same = (a: Painted, b: Painted) => a.person[0] === b.person[0] && a.person[1] === b.person[1] &&
  (a.item === null ? b.item === null : b.item !== null && a.item[0] === b.item[0] && a.item[1] === b.item[1]);

/** The paintings that differ from the table, by map, in the table's order: what is sent. */
export function changed(rows: readonly RoomRow[], paint: ReadonlyMap<string, Painted>): Record<string, Painted> {
  const out: Record<string, Painted> = {};
  for (const row of rows) {
    const p = paint.get(row[0]);
    if (p && !same(p, asTabled(row))) out[row[0]] = p;
  }
  return out;
}

/** A saved draft, read back: anything that is not a painting of a known room is dropped. */
export function fromDraft(text: string | null, rows: readonly RoomRow[]): Map<string, Painted> {
  const out = new Map<string, Painted>();
  if (!text) return out;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return out; }
  if (!raw || typeof raw !== 'object') return out;
  const known = new Set(rows.map((r) => r[0]));
  const cell = (c: unknown): c is [number, number] => Array.isArray(c) && c.length === 2 && c.every(Number.isInteger);
  for (const [map, p] of Object.entries(raw as Record<string, Painted>)) {
    if (known.has(map) && p && cell(p.person) && (p.item === null || cell(p.item))) out.set(map, { item: p.item, person: p.person });
  }
  return out;
}
