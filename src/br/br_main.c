// Battle royale entry points. AgbMain calls BrInit once at boot, after the engine's
// own managers are up and before the first frame, and BrFrame from the main loop
// every frame. Everything else in src/br/ hangs off the systems these two start.
#include "global.h"
#include "br/br_config.h"
#include "br/br_main.h"
#include "br/br_mailbox.h"
#include "br/br_ghosts.h"
#include "br/br_boot.h"
#include "br/br_ring.h"
#include "br/br_hud.h"
#include "br/br_match.h"
#include "br/br_levels.h"
#include "br/br_catch.h"
#include "br/br_netlink.h"
#include "br/br_engage.h"

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
}

void BrFrame(void)
{
    BrNet_Tick();
    BrBoot_Tick();
    BrGhosts_Tick();
    BrRing_Tick();
    BrHud_Tick();
    BrMatch_Tick();
    BrLevels_Tick();
    BrCatch_Tick();
    BrNetlink_Tick();
    BrEngage_Tick();
}
