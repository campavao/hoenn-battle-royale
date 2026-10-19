// Legendaries you fight (POK-410, src/br/br_legend.c). Cam, 2026-10-18: "getting
// legendaries is a bit too easy, I would like us to use overworld sprites when we can and
// you have to initiate a battle with them".
//
// A legendary the match itself put down -- an event's or a story's, a key in the nobody
// space -- stands as its own overworld sprite, and taking it is a battle: in a player's
// ROM a legendary one, in a bot's brain a long wild fight (bots/brain.ts). One in a fallen
// trainer's team or one released is a ball like any other.

/** BR_LOOT_KEY_NOBODY (include/br/br_loot.h): the match's own pieces. */
const KEY_NOBODY = 0x8000;

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
 *  undefined (br_legend.c's BrLegend_Gfx). */
export function legendGfx(key: number, species: number): number | undefined {
  return key & KEY_NOBODY ? LEGEND_GFX.get(species) : undefined;
}
