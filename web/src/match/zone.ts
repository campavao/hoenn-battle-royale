// The Zone's catch pool, read out of the ROM (POK-296).
//
// Kanto: "bots draft their first Pokemon from the same zone pool", which is what makes a
// match's theme carry past the opening -- a WATER match is still a WATER match when a
// fallen bot's team is lying on Route 110 in the fourth ring.
//
// The pool is dealt inside the ROM off the match seed (src/br/br_zone.c) and every ROM in
// the room deals the same one, so the page does not mirror the deal: it reads the twelve
// species where the ROM put them. The address comes from br-symbols.json like every
// other; the offsets inside `struct BrZone` are pinned against br_zone.h by zone.test.ts.

/** `struct BrZone` in include/br/br_zone.h. */
export const BR_ZONE = {
  OFF_DEALT_FOR: 0,
  OFF_SPECIES: 4,
  SLOTS: 12,
} as const;

/** The twelve species this match's Zone holds, or none: no symbol (an older patch), or a
 *  pool that has not been dealt for this seed yet. Empty is the caller's cue to fall back
 *  to what it did before there was a theme. */
export function readZonePool(
  read: (addr: number, bits: 8 | 16 | 32) => number,
  base: number | undefined,
  seed: number,
): number[] {
  if (base === undefined || seed === 0) return [];
  if (read(base + BR_ZONE.OFF_DEALT_FOR, 32) >>> 0 !== seed >>> 0) return [];
  const out: number[] = [];
  for (let i = 0; i < BR_ZONE.SLOTS; i++) {
    const species = read(base + BR_ZONE.OFF_SPECIES + 2 * i, 16);
    if (species !== 0) out.push(species);
  }
  return out;
}
