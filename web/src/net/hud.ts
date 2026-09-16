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
  OFF_EYES: 0x1a, // u8: how many spectators are watching this trainer
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

/** Arms the one-shot FOG! flash (br_hud.h: the ROM clears this itself). Not called
 *  from app.ts today -- the director doesn't yet distinguish "the ring just moved"
 *  from "seconds ticked by" at the call site -- but kept alongside its two siblings
 *  since it is the same PAGE WRITES field and a follow-up ticket will want it. */
export function flashHudFog(ram: RamAccess, hudBase: number): void {
  ram.write(hudBase + HUD.OFF_FLASH_FOG, 1, 8);
}

/** `gBrMySeat` (include/br/br_ghosts.h) -- a separate global, not part of `BrHud`,
 *  but written by the same page-writes-a-few-globals pattern; this client's seat,
 *  from the roster, once the mailbox is awake. */
export function writeMySeat(ram: RamAccess, seatBase: number, seat: number): void {
  ram.write(seatBase, Math.max(0, Math.min(255, seat)), 8);
}
