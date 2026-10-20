// The page's half of the overworld HUD (include/br/br_hud.h's own comment names this
// file: "mirrored in web/src/net/hud.ts"). `gBrHud` is almost entirely the ROM's --
// this only writes the fields the header marks "PAGE WRITES": how many
// trainers are left, the Safari/ring countdown, the FOG! flash and the eye. Nothing
// here reads the struct back; the ROM owns every other field (br_hud.h).
import type { RamAccess } from './mailbox';

export const HUD = {
  OFF_LEFT: 0x00, // u8: trainers still in the match
  OFF_FLASH_FOG: 0x01, // u8: write 1, the ROM clears it after a 60-frame flash
  OFF_CLOCK_SECS: 0x02, // u16: seconds; the ROM counts it down once per 60 frames
  OFF_EYES: 0x0f, // u8: how many spectators are watching this trainer
  OFF_NO_CORNER: 0x17a, // u8: HUD_PAGE -- what the page draws of the corner itself
  OFF_NO_BATTLE_BOX: 0x17b, // u8: 1 while the page draws the battle's menus itself (a phone)
} as const;

/** `gBrHud.left` -- alive count, clamped to a byte (BR_MAX_SEATS is well under 256). */
export function writeHudLeft(ram: RamAccess, hudBase: number, alive: number): void {
  ram.write(hudBase + HUD.OFF_LEFT, Math.max(0, Math.min(255, alive)), 8);
}

/** `gBrHud.clockSecs` -- the Safari countdown, then seconds to the next ring move. */
export function writeHudClockSecs(ram: RamAccess, hudBase: number, secs: number): void {
  ram.write(hudBase + HUD.OFF_CLOCK_SECS, Math.max(0, Math.min(0xffff, Math.round(secs))), 16);
}

/** `gBrHud.eyes` -- the corner eye count, how many spectators are on this trainer
 *  (POK-233). The page counts them: a spectator's `follow` never leaves its own page,
 *  so the page's own watcher tally is the only place this number exists. */
export function writeHudEyes(ram: RamAccess, hudBase: number, watchers: number): void {
  ram.write(hudBase + HUD.OFF_EYES, Math.max(0, Math.min(255, watchers)), 8);
}

/** `gBrHud.noCorner`'s values (include/br/br_hud.h BR_HUD_PAGE_*): a phone's page draws
 *  the clock, the count and the place over the field (ui/phonehud.ts), so the ROM shows
 *  neither its corner nor the map's name; a desktop's sheet beside the game says the
 *  count and the clock (Cam's 2026-10-19 play-test: the corner sat on the people round
 *  the player), so only the corner comes off. */
export const HUD_PAGE = { NONE: 0, SIGNS: 1, CORNER: 2 } as const;
export type HudPage = (typeof HUD_PAGE)[keyof typeof HUD_PAGE];

/** `gBrHud.noCorner`, and `noBattleBox` with a phone's: the same page draws the battle's
 *  menus under the picture (ui/battlemenu.ts), so the ROM's FIGHT/BAG and move boxes
 *  stay off it. */
export function writeHudNoCorner(ram: RamAccess, hudBase: number, page: HudPage): void {
  ram.write(hudBase + HUD.OFF_NO_CORNER, page, 8);
  ram.write(hudBase + HUD.OFF_NO_BATTLE_BOX, page === HUD_PAGE.SIGNS ? 1 : 0, 8);
}

/** `struct Pokemon` (include/pokemon.h): 100 bytes, its HP and max HP outside the
 *  encrypted part. */
const MON_SIZE = 100;
const MON_HP = 0x56;
const MON_MAX_HP = 0x58;
/** `struct BoxPokemon`'s flags byte: hasSpecies is bit 1, isEgg bit 2. */
const MON_FLAGS = 0x13;
/** `struct BrRing.outside` (include/br/br_ring.h). */
const RING_OUTSIDE = 5;

/** "HP 26/40" for the first of the party still standing while the fog is on us, as the
 *  ROM's corner says it (br_hud.c LeadHp), or null in the ring. */
export function readFogHp(ram: RamAccess, sym: (name: string) => number | undefined): string | null {
  const ring = sym('gBrRing');
  const party = sym('gPlayerParty');
  const count = sym('gPlayerPartyCount');
  if (ring === undefined || party === undefined || count === undefined || ram.read(ring + RING_OUTSIDE, 8) === 0) return null;
  const n = Math.min(6, ram.read(count, 8));
  for (let i = 0; i < n; i++) {
    const flags = ram.read(party + i * MON_SIZE + MON_FLAGS, 8);
    if ((flags & 2) === 0 || (flags & 4) !== 0) continue; // LeadHp skips no species and eggs
    const hp = ram.read(party + i * MON_SIZE + MON_HP, 16);
    if (hp > 0) return `HP ${hp}/${ram.read(party + i * MON_SIZE + MON_MAX_HP, 16)}`;
  }
  return null;
}

// There is deliberately no flashHudFog() here any more (POK-224). The FOG! flash is
// raised by the ROM itself, in br_ring.c's tick, at the frame the section we are
// standing in leaves the ring -- the page does not know Hoenn's geography and would
// have to be told it to work that out. The field is still marked PAGE WRITES in
// br_hud.h because the ROM clears it the same way either way; an exported page-side
// writer that nothing called only made a later audit conclude the flash was missing.

/** `gBrMySeat` (include/br/br_ghosts.h) -- a separate global, not part of `BrHud`,
 *  but written by the same page-writes-a-few-globals pattern; this client's seat,
 *  from the roster, once the mailbox is awake. */
export function writeMySeat(ram: RamAccess, seatBase: number, seat: number): void {
  ram.write(seatBase, Math.max(0, Math.min(255, seat)), 8);
}

/** `gBrMySkin`: which of `sSkinGraphics` this trainer's ghost is drawn as on everybody
 *  else's screen (POK-243). The ROM puts it on every `place` it sends. */
export function writeMySkin(ram: RamAccess, skinBase: number, skin: number): void {
  ram.write(skinBase, Math.max(0, Math.min(255, skin)), 8);
}
