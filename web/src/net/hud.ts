// The page's half of the overworld HUD (include/br/br_hud.h's own comment names this
// file: "mirrored in web/src/net/hud.ts"). `gBrHud` is almost entirely the ROM's --
// this only writes the fields the header marks "PAGE WRITES": how many
// trainers are left, the Safari/ring countdown, the FOG! flash and the eye. Nothing
// here reads the struct back; the ROM owns every other field (br_hud.h).

export const HUD = {
  OFF_LEFT: 0x00, // u8: trainers still in the match
  OFF_FLASH_FOG: 0x01, // u8: write 1, the ROM clears it after a 60-frame flash
  OFF_CLOCK_SECS: 0x02, // u16: seconds; the ROM counts it down once per 60 frames
  OFF_EYES: 0x0f, // u8: how many spectators are watching this trainer
  OFF_NO_CORNER: 0x17a, // u8: HUD_PAGE -- what the page draws of the corner itself
  OFF_NO_BATTLE_BOX: 0x17b, // u8: 1 while the page draws the battle's menus itself (a phone)
} as const;

