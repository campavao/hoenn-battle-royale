// Skip the intro, start a game, warp (POK-221). See include/br/br_boot.h.
#include "global.h"
#include "main.h"
#include "main_menu.h"
#include "intro.h"
#include "title_screen.h"
#include "new_game.h"
#include "overworld.h"
#include "field_screen_effect.h"
#include "play_time.h"
#include "script.h"
#include "sound.h"
#include "m4a.h"
#include "gpu_regs.h"
#include "palette.h"
#include "constants/characters.h"
#include "constants/maps.h"
#include "constants/species.h"
#include "script_pokemon_util.h"
#include "br/br_mailbox.h"
#include "br/br_boot.h"

static EWRAM_DATA u8 sBooted = 0;

// Only hijack the states that come before a game exists. Once the overworld or a
// battle is running the boot request is stale and stays ignored.
static bool8 PreGame(void)
{
    // The copyright screen is where the save block pointers get set; before that
    // there is nothing to start a game in. After it, the intro movie, title and main
    // menu are all fair game (the intro is a minute long and this skips it).
    if (gSaveBlock1Ptr == NULL || gSaveBlock2Ptr == NULL)
        return FALSE;
    if (gMain.callback2 == CB2_InitCopyrightScreenAfterBootup)
        return FALSE;
    return gMain.callback2 != CB2_Overworld && !gMain.inBattle;
}

static void StartGameAt(const struct BrBoot *b)
{
    u8 i;

    // What the main menu does before Birch's speech, then what CB2_NewGame does,
    // minus the truck.
    // The intro leaves blending, a fade and its VRAM behind; the title screen's own
    // first state clears all of that, and so must we before the map loads into it.
    SetVBlankCallback(NULL);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
    SetGpuReg(REG_OFFSET_BLDY, 0);
    SetGpuReg(REG_OFFSET_DISPCNT, 0);
    DmaFill16(3, 0, (void *)VRAM, VRAM_SIZE);
    DmaFill32(3, 0, (void *)OAM, OAM_SIZE);
    DmaFill16(3, 0, (void *)(PLTT + 2), PLTT_SIZE - 2);
    ResetPaletteFade();

    // (CB2_LoadMap clears the field callbacks itself; a fresh game has no Safari flag.)
    Sav2_ClearSetDefault();
    // Always SET, always fast text: an option would be a lie once the match runs.
    gSaveBlock2Ptr->optionsBattleStyle = OPTIONS_BATTLE_STYLE_SET;
    gSaveBlock2Ptr->optionsTextSpeed = OPTIONS_TEXT_SPEED_FAST;
    m4aMPlayAllStop();
    StopMapMusic();
    NewGameInitData();
    ResetInitialPlayerAvatarState();
    PlayTimeCounter_Start();
    ScriptContext_Init();
    UnlockPlayerFieldControls();

    gSaveBlock2Ptr->playerGender = b->gender == FEMALE ? FEMALE : MALE;
    for (i = 0; i < PLAYER_NAME_LENGTH && b->name[i] != EOS; i++)
        gSaveBlock2Ptr->playerName[i] = b->name[i];
    gSaveBlock2Ptr->playerName[i] = EOS;

    SetWarpDestination(b->mapGroup, b->mapNum, WARP_ID_NONE, b->x, b->y);
    WarpIntoMap();
    gFieldCallback = FieldCB_DefaultWarpExit;
    gFieldCallback2 = NULL;
    gMain.state = 0;
    SetMainCallback2(CB2_LoadMap);
}

void BrBoot_Tick(void)
{
    struct BrBoot *b = &gBrMailbox.boot;

    if (sBooted || b->mode == BR_BOOT_NONE || !PreGame())
        return;
    sBooted = TRUE;
    if (BR_BOOT_MODE(b->mode) == BR_BOOT_MAP)
    {
        StartGameAt(b);
        if (b->mode & BR_BOOT_FLAG_TESTMON)
            ScriptGiveMon(SPECIES_TREECKO, 5, 0, 0, 0, 0);
    }
    b->mode = BR_BOOT_NONE;
}
