// Battle royale entry points. AgbMain calls BrInit once at boot, after the engine's
// own managers are up and before the first frame, and BrFrame from the main loop
// every frame. Everything else in src/br/ hangs off the systems these two start.
#include "global.h"
#include "br/br_config.h"
#include "br/br_main.h"
#include "br/br_mailbox.h"
#include "br/br_wire_c.h"
#include "br/br_ghosts.h"
#include "br/br_boot.h"
#include "br/br_ring.h"
#include "br/br_hud.h"
#include "br/br_match.h"
#include "br/br_levels.h"
#include "br/br_catch.h"
#include "br/br_netlink.h"
#include "br/br_engage.h"
#include "br/br_battle.h"
#include "br/br_bot.h"
#include "br/br_duel.h"
#include "br/br_loot.h"
#include "br/br_spectate.h"
#include "br/br_pick.h"
#include "br/br_map.h"
#include "br/br_zone.h"
#include "br/br_field.h"

// Readable from the ROM image itself, so a tool can tell which patch it holds without
// running it: `strings pokeemerald.gba | grep HOENN-BR`.
const u8 gBrVersionString[] = "HOENN-BR patch " BR_STRINGIFY(BR_PATCH_VERSION) " protocol " BR_STRINGIFY(BR_PROTOCOL);

void BrInit(void)
{
    BrMailbox_Init();
    BrGhosts_Init();
    BrRing_Init();
    BrHud_Init();
    BrMatch_Init();
    BrLevels_Init();
    BrCatch_Init();
    BrNetlink_Init();
    BrEngage_Init();
    BrBattle_Init();
    BrLoot_Init();
    BrBot_Init();
    BrDuel_Init();
    BrSpectate_Init();
    BrPick_Init();
    BrMap_Init();
    BrZone_Init();
}

// Everything allocated a moment ago is now unowned memory that will be handed out
// again, and a pointer kept into it writes into somebody else's allocation. A module
// that keeps an Alloc past the frame it was made in adds its reset here (C-STYLE.md).
void BrHeapReset(void)
{
    BrSpectate_HeapReset();
    BrBot_HeapReset();
    BrDuel_HeapReset();
    BrMatch_HeapReset();
}

EWRAM_DATA u8 gBrMidFrame = 0;

void BrFrame(void)
{
    gBrMidFrame = 1;
    BrWire_FlushHeld(); // what a full ring held back goes before anything newer
    BrNet_Tick();
    // What the messages asked off a map while it could not be touched goes now, before
    // a ghost or a ball respawns under the same local id (POK-328).
    BrField_RemoveHeld();
    BrBoot_Tick();
    BrGhosts_Tick();
    BrLoot_Tick();
    BrBot_Tick();
    BrDuel_Tick();
    BrRing_Tick();
    BrHud_Tick();
    BrMatch_Tick();
    BrLevels_Tick();
    BrCatch_Tick();
    BrNetlink_Tick();
    BrBattle_TickStall();
    BrBattle_TickSeeThrough();
    BrEngage_Tick();
    BrSpectate_Tick();
    BrPick_Tick();
}

void BrFrameEnd(void)
{
    gBrMidFrame = 0;
}
