// The Hall of Fame for everybody still in the match (POK-417).
#include "global.h"
#include "main.h"
#include "malloc.h"
#include "menu.h"
#include "palette.h"
#include "pokemon.h"
#include "script.h"
#include "text.h"
#include "window.h"
#include "string_util.h"
#include "strings.h"
#include "hall_of_fame.h"
#include "international_string_util.h"
#include "constants/characters.h"
#include "br/br_skin.h"
#include "br/br_field.h"
#include "br/br_ghosts.h"
#include "br/br_hof.h"
#include "br/br_mailbox.h"
#include "br/br_match.h"
#include "br/br_spectate.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"

// IWRAM, not EWRAM: EWRAM is down to its last bytes (tools/br/ram-headroom.py), and none
// of this outlives a boot. The party itself is on the heap for the parade's length.
static u8 sSeat;                  // the champion a FAME named, until its parade is over
static bool8 sPending;             // ...and it waits for a quiet field
static u8 sName[PLAYER_NAME_LENGTH + 1];
static struct Pokemon *sParty;     // their team, while the parade is on

static void HandleFame(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    u8 i, nameLen;

    // Our own seat is the parade br_match.c runs off the RESULT; a second one of it
    // here would play it twice.
    // Nor in the lobby: a FAME that came late, after the page let go of the match,
    // is last match's.
    if (n < 2 || d[0] >= BR_MAX_SEATS || d[0] == gBrMySeat || sParty != NULL || gBrMatch.phase == BR_PHASE_NONE)
        return;
    nameLen = d[1];
    if (nameLen > PLAYER_NAME_LENGTH || 2 + nameLen > n)
        nameLen = 0;
    for (i = 0; i < nameLen; i++)
        sName[i] = d[2 + i];
    sName[nameLen] = EOS;
    sSeat = d[0];
    sPending = TRUE;
}

void BrHof_Init(void)
{
    sSeat = BR_NO_SEAT;
    sPending = FALSE;
    sParty = NULL;
    BrNet_On(BR_MSG_FAME, HandleFame);
}

void BrHof_Tick(void)
{
    u8 count;

    // The field, quiet: not a warp, not a fade, not a box with a script behind it, and
    // not the replay of the fight that decided it, which the page waits out first too.
    if (!sPending || !BrField_OverworldRunning() || ScriptContext_IsEnabled() || gPaletteFade.active
     || gBrSpectate.watching || BrMatch_WinPending())
        return;
    sPending = FALSE;
    sParty = AllocZeroed(PARTY_SIZE * sizeof(struct Pokemon));
    count = sParty != NULL ? BrSpectate_PartyOf(sSeat, sParty) : 0;
    if (count == 0)
    {
        // No team to parade -- the rows the page sent were somebody else's, or the heap
        // that held them went with a battle. Said done at once: the page is holding the
        // results for a parade that is not coming.
        BrHof_Done();
        gBrMatch.phase = BR_PHASE_DONE;
        return;
    }
    gBrMatch.phase = BR_PHASE_WIN;
    // The Hall of Fame frees every window: the peek box goes first, not under it.
    BrSpectate_ClosePeek();
    SetMainCallback2(CB2_DoHallOfFameScreenDontSaveData);
}

struct Pokemon *BrHof_Party(void)
{
    return sParty != NULL ? sParty : gPlayerParty;
}

const u8 *BrHof_Name(void)
{
    return sParty != NULL ? sName : gSaveBlock2Ptr->playerName;
}

u16 BrHof_TrainerPic(u16 pic)
{
    if (sParty == NULL)
        return BrSkin_MyPic(pic);
    if (!gBrSeats[sSeat].present)
        return pic;
    return BrSkin_Pic(gBrSeats[sSeat].skin, pic);
}

// Hall of Fame's own box, one row high: NAME and the name.
static const struct WindowTemplate sPlayerWindow = { 0, 2, 2, 14, 2, 14, 1 };

const struct WindowTemplate *BrHof_PlayerWindow(void)
{
    return &sPlayerWindow;
}

void BrHof_PrintPlayer(u8 windowId, const u8 *colors)
{
    const u8 *name = BrHof_Name();

    FillWindowPixelBuffer(windowId, PIXEL_FILL(1));
    PutWindowTilemap(windowId);
    DrawStdFrameWithCustomTileAndPalette(windowId, FALSE, 0x21D, 0xD);
    AddTextPrinterParameterized3(windowId, FONT_NORMAL, 0, 1, colors, TEXT_SKIP_DRAW, gText_Name);
    AddTextPrinterParameterized3(windowId, FONT_NORMAL, GetStringRightAlignXOffset(FONT_NORMAL, name, 0x70), 1,
                                 colors, TEXT_SKIP_DRAW, name);
    CopyWindowToVram(windowId, COPYWIN_FULL);
}

// Four seconds on LEAGUE CHAMPION! before a watcher's parade lets go.
#define BR_HOF_LET_GO_FRAMES 240

bool8 BrHof_LetGo(u16 frames)
{
    return sParty != NULL && frames >= BR_HOF_LET_GO_FRAMES;
}

void BrHof_Done(void)
{
    TRY_FREE_AND_SET_NULL(sParty);
    sSeat = BR_NO_SEAT;
}
