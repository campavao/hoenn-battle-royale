// Legendaries you fight (POK-410, src/br/br_legend.c). Cam, 2026-10-18: "getting
// legendaries is a bit too easy, I would like us to use overworld sprites when we can and
// you have to initiate a battle with them".
//
// A legendary the match itself put down -- an event's or a story's, a key in the nobody
// space -- stands as its own overworld sprite, and taking it is a battle: in a player's
// ROM a legendary one, in a bot's brain a long wild fight (bots/brain.ts). One in a fallen
// trainer's team or one released is a ball like any other.

import type { EventMsg, Msg } from '../net/wire';
import { isEventKey } from './events';
import { short } from './ticker';

/** `sLegends` in br_legend.c: species -> the graphics id it stands as. parity.test.ts pins
 *  it to the C. */
export const LEGEND_GFX: ReadonlyMap<number, number> = new Map([
  [401, 200], // REGIROCK
  [402, 201], // REGICE
  [403, 202], // REGISTEEL
  [407, 187], // LATIAS
  [408, 188], // LATIOS
  [404, 197], // KYOGRE, surfacing
  [405, 198], // GROUDON, surfacing
  [406, 41], // RAYQUAZA, coiled on its pillar
  [410, 232], // DEOXYS
  [151, 229], // MEW
  [249, 237], // LUGIA
  [250, 238], // HO-OH
]);

/** The sprite a piece on the ground stands as when it is a legendary to fight, else
 *  undefined (br_legend.c's BrLegend_Gfx: an event's key only). Not a trader holding one he
 *  was given (Cam, 2026-10-23: a legendary trades like any mon): the ROM draws him as himself. */
export function legendGfx(key: number, species: number): number | undefined {
  return isEventKey(key) ? LEGEND_GFX.get(species) : undefined;
}

/** The legendary chip beside the game (Cam's 2026-10-19 play-test: "because of how noisy
 *  the bottom is, I've trained myself not to look at it, which means I don't even know
 *  where the legendary is"). The ticker says it once; this keeps saying it: where the
 *  newest one stands, or who took it, until the next. An event's piece is a legendary
 *  when it stands as one (LEGEND_GFX), which the page learns off its own loot table
 *  while the piece is down, so a rare find never gets a chip. */
export class LegendWatch {
  /** Event key -> its species, once seen on the ground. */
  private readonly species = new Map<number, number>();
  /** Key -> the seat whose PICKUP took it last: the one fighting it, then keeping it. */
  private readonly took = new Map<number, number>();

  note(msg: Msg): void {
    if (msg.t === 'start') {
      this.species.clear();
      this.took.clear();
    } else if (msg.t === 'pickup') this.took.set(msg.key, msg.seat);
    // Out, their team spills under a key of its own: nobody "has it" any more.
    else if (msg.t === 'out') for (const [key, seat] of this.took) if (seat === msg.seat) this.took.delete(key);
  }

  /** The chip's words, or null with no legendary in the match yet. */
  chip(events: readonly EventMsg[], ground: { mon(key: number): { species: number } | undefined }, nameOf: (seat: number) => string): string | null {
    for (const e of [...events].sort((a, b) => b.n - a.n)) {
      const down = ground.mon(e.key);
      if (down) this.species.set(e.key, down.species);
      const species = this.species.get(e.key);
      if (species === undefined || !LEGEND_GFX.has(species)) continue;
      if (down) return e.place ? `Legendary at ${e.place.toUpperCase()}` : 'Legendary on the map';
      const seat = this.took.get(e.key);
      if (seat !== undefined) return `${short(nameOf(seat))} has the legendary`;
    }
    return null;
  }
}
