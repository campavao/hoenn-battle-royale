// The fog clears Hoenn's own trainers off a map it has taken (POK-299).
//
// Kanto's rule (lib/fog.lua, Fog.tickMaps; main.lua, BR:tickNpcFog): every map with a
// static trainer on it keeps a fog clock of its own, running only while the map is
// outside the ring. It ticks at the same TICK_SECONDS a player's does and the map dies
// at TICKS_TO_KILL -- the same grace, so a trainer just past the edge is not vaporised
// the moment the ring moves. A map the ring re-admits before the end is reprieved (the
// centre can move between phases); the dead stay dead. When a map dies, every trainer on
// it leaves every ROM in the room -- `npcout`, the message a beaten trainer already
// crosses as -- and the ticker gets one line for the whole sweep.
//
// Why: the world becomes a record of the match, and the PvE the survivors compete over
// shrinks as the map does. Without this the ring was tiny and the trainers inside it
// were the same ones that were there at the drop, while everything the fog took was
// still fully stocked and unreachable.
//
// Host only, like the bots: one page runs the clock and everybody hears the result.
// The trainer list is tools/br/export-trainers.py's, read off pret's own map scripts.
import type { RegionSection } from './director';
import { sectionInside, type RingCircle } from './ring';

/** Fog.TICK_SECONDS and Fog.TICKS_TO_KILL: forty seconds outside, then gone. */
export const NPC_FOG_TICK_MS = 4000;
export const NPC_FOG_TICKS_TO_KILL = 10;

interface MapClock {
  ticks: number;
  last: number;
  dead: boolean;
}

export class NpcFog {
  private readonly clocks = new Map<string, MapClock>();

  constructor(
    /** { mapId: [localId, ...] } -- web/src/data/trainers.json. */
    private readonly trainers: Record<string, number[]>,
    private readonly sectionOf: (mapId: string) => RegionSection | undefined,
  ) {}

  /** The trainers still standing on this map, as `npcout` names them. */
  trainersOn(mapId: string): number[] {
    return this.clocks.get(mapId)?.dead ? [] : (this.trainers[mapId] ?? []);
  }

  /** Advance every map's clock against the ring as it is now. Returns the maps whose
   *  clock ran out on THIS call -- each one once, ever. No ring yet means no fog. */
  tick(now: number, ring: RingCircle | undefined): string[] {
    const died: string[] = [];
    if (!ring) return died;
    for (const mapId of Object.keys(this.trainers)) {
      const clock = this.clocks.get(mapId);
      if (clock?.dead) continue;
      if (sectionInside(this.sectionOf(mapId), ring)) {
        if (clock) this.clocks.delete(mapId); // reprieved: the clock starts over next time
      } else if (!clock) {
        this.clocks.set(mapId, { ticks: 0, last: now, dead: false });
      } else if (now - clock.last >= NPC_FOG_TICK_MS) {
        clock.last = now;
        clock.ticks++;
        if (clock.ticks >= NPC_FOG_TICKS_TO_KILL) {
          clock.dead = true;
          died.push(mapId);
        }
      }
    }
    return died;
  }
}
