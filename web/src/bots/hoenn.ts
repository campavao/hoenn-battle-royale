// world.json, indexed once (POK-331 #20).
//
// The page used to index the same file four times over: FieldView kept a map by
// group:num and by id, TouchLayer built a World of its own and a group:num -> id table,
// app.ts found a card's map with a linear scan of all 518, and every match's bots built
// another World -- 315,000 cells decoded again -- each time a match dealt them. This is
// the one index, and every one of those reads it.
//
// The World in it is built the first time something walks, not on import: the picture
// only ever asks which map it is on, and a spectator's tab never walks at all. It is
// shared by whatever walks -- the bots and a tap -- which is safe because nothing in it
// changes once built but its caches of fixed answers, and a search runs to the end
// before the next one starts (bots/path.ts keeps its bookkeeping per World).
//
// The file itself is fetched on demand (the audit's leftover e). Its 440 KB were over half
// an 800 KB main script that had to arrive and parse before the page showed anything; it
// is a chunk of its own now, asked for as the page starts and kept by the service worker
// apart from the code, so a release that moves no map does not send it again.
// match/landing.ts's worldReady() is the one wait, and nothing reads HOENN before it.
import type { MapRef } from '../net/wire';
import { World, type WorldMap } from './world';

export class WorldIndex {
  readonly maps: WorldMap[];
  /** A map by its world.json id, which is what the bots and landing.json speak. */
  readonly byId: ReadonlyMap<string, WorldMap>;
  /** A map by `${group}:${num}`, which is what the ROM and the wire speak. */
  readonly byRef: ReadonlyMap<string, WorldMap>;
  private walked: World | null = null;

  constructor(maps: WorldMap[]) {
    this.maps = maps;
    this.byId = new Map(maps.map((m) => [m.id, m]));
    this.byRef = new Map(maps.map((m) => [`${m.group}:${m.num}`, m]));
  }

  /** world.json's id for a wire map, or undefined for one it does not have. */
  idOf(ref: MapRef): string | undefined {
    return this.byRef.get(`${ref.group}:${ref.num}`)?.id;
  }

  /** The wire's name for a map id. */
  refOf(id: string): MapRef | undefined {
    const m = this.byId.get(id);
    return m && { group: m.group, num: m.num };
  }

  /** The graph to walk on: built on the first ask, then the same one every time. */
  get world(): World {
    this.walked ??= new World(this.maps);
    return this.walked;
  }
}

/** What a table is until its file is in: every read throws and says why, rather than
 *  answering from an empty world nobody would notice was empty. */
export function notYet<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(`${name} was read before worldReady(): the world data is fetched on demand`);
    },
  });
}

/** The real world, off web/src/data/world.json -- once loadHoenn() has fetched it. */
export let HOENN: WorldIndex = notYet('HOENN');

let loading: Promise<WorldIndex> | undefined;

/** Fetches world.json, once, and makes HOENN the index of it. */
export function loadHoenn(): Promise<WorldIndex> {
  loading ??= import('../data/world.json').then(
    (m) => (HOENN = new WorldIndex((m.default as { maps: WorldMap[] }).maps)),
  );
  return loading;
}
