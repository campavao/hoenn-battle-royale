// Battle royale entry point. AgbMain calls BrInit once at boot, after the engine's own
// managers are up and before the first frame. Everything else in src/br/ hangs off the
// systems this file starts.
#include "global.h"
#include "br/br_config.h"
#include "br/br_main.h"

// Sits at the front of our EWRAM so a shell that reads BR_MAGIC here knows the patch
// booted. The full mailbox (POK-216) replaces this with struct BrMailbox.
EWRAM_DATA u16 gBrMagic = 0;
EWRAM_DATA u16 gBrPatchVersion = 0;

// Readable from the ROM image itself, so a tool can tell which patch it holds without
// running it: `strings pokeemerald.gba | grep HOENN-BR`.
const u8 gBrVersionString[] = "HOENN-BR patch " BR_STRINGIFY(BR_PATCH_VERSION) " protocol " BR_STRINGIFY(BR_PROTOCOL);

void BrInit(void)
{
    gBrMagic = BR_MAGIC;
    gBrPatchVersion = BR_PATCH_VERSION;
}
