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
import worldData from '../data/world.json';
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

/** The real world, off web/src/data/world.json. */
export const HOENN = new WorldIndex((worldData as { maps: WorldMap[] }).maps);
