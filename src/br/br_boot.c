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
#include "pokemon.h"
#include "constants/moves.h"
#include "event_data.h"
#include "pokedex.h"
#include "item.h"
#include "constants/items.h"
#include "constants/flags.h"
#include "constants/vars.h"
#include "br/br_mailbox.h"
#include "br/br_boot.h"
#include "br/br_match.h"
#include "br/br_levels.h"

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

// A contestant is not a ten-year-old leaving home (Kanto's rule, POK-256). Nobody in
// a match is going to earn a badge in sixteen minutes, and everything a badge, an HM or
// a Pokedex entry gates is something the match needs working from the first second:
// the fly map wants every town visited or it draws them all grey, the field moves want
// their badges, and a Pokedex that has never seen a Wurmple stops to say so every time
// one is caught -- mid-match, in a box the player has to press through.
static void GiveTheRunOfHoenn(void)
{
    u16 species;
    u16 flag;

    for (flag = FLAG_BADGE01_GET; flag <= FLAG_BADGE08_GET; flag++)
        FlagSet(flag);
    // Every town and city: this is what CreateFlyDestIcons reads, and an unset flag is
    // a grey dot on the drop's own map.
    for (flag = FLAG_VISITED_LITTLEROOT_TOWN; flag <= FLAG_VISITED_EVER_GRANDE_CITY; flag++)
        FlagSet(flag);
    EnableNationalPokedex();
    for (species = 1; species < NUM_SPECIES; species++)
    {
        u16 dexNum = SpeciesToNationalPokedexNum(species);

        if (dexNum == 0)
            continue;
        GetSetPokedexFlag(dexNum, FLAG_SET_SEEN);
        GetSetPokedexFlag(dexNum, FLAG_SET_CAUGHT);
    }
    for (flag = ITEM_HM01; flag <= ITEM_HM08; flag++)
        AddBagItem(flag, 1);
    // Both bikes, and the shoes -- and in a match the shoes are the default rather than
    // a button you hold (field_player_avatar.c). Sixteen minutes of Hoenn on foot is a
    // lot of Hoenn, and the fog does not wait.
    AddBagItem(ITEM_MACH_BIKE, 1);
    AddBagItem(ITEM_ACRO_BIKE, 1);
    FlagSet(FLAG_RECEIVED_RUNNING_SHOES);
    FlagSet(FLAG_SYS_B_DASH);

    // ...and the story is over before it starts (the play-test walked into May and
    // Professor Birch on Route 101). Everybody in a match is the champion who has been
    // everywhere: FLAG_SYS_GAME_CLEAR is the one the game itself asks, and the state
    // VARs below are what the early maps' scripts branch on -- pushed past every value
    // they compare against, so nothing fires rather than something else firing.
    FlagSet(FLAG_SYS_GAME_CLEAR);
    FlagSet(FLAG_ADVENTURE_STARTED);
    FlagSet(FLAG_SYS_POKEMON_GET);
    FlagSet(FLAG_SYS_USE_FLASH);
    // Not the Pokedex or the PokeNav: the dex entries are set directly above, and the
    // flags only add rows to a menu POK-221 cut down on purpose (and a PokeNav is a
    // trainer's phone ringing mid-match).
    VarSet(VAR_LITTLEROOT_TOWN_STATE, 255);
    VarSet(VAR_LITTLEROOT_HOUSES_STATE_BRENDAN, 255);
    VarSet(VAR_LITTLEROOT_HOUSES_STATE_MAY, 255);
    VarSet(VAR_BIRCH_LAB_STATE, 255);
    VarSet(VAR_BIRCH_STATE, 255);
    VarSet(VAR_ROUTE101_STATE, 255);
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

    GiveTheRunOfHoenn();

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
    if (BR_BOOT_MODE(b->mode) == BR_BOOT_MAP || BR_BOOT_MODE(b->mode) == BR_BOOT_SAFARI)
    {
        if (BR_BOOT_MODE(b->mode) == BR_BOOT_SAFARI)
        {
            // Somewhere in the Zone, dealt -- any of its six areas (POK-256, POK-261).
            u8 area, sx, sy;

            BrMatch_SafariCell(&area, &sx, &sy);
            b->mapGroup = MAP_GROUP(MAP_SAFARI_ZONE_SOUTH);
            b->mapNum = area;
            b->x = sx;
            b->y = sy;
        }
        StartGameAt(b);
        BrLevels_GiveStartingBag();
        if (b->mode & BR_BOOT_FLAG_TESTMON)
            ScriptGiveMon(SPECIES_TREECKO, 5, 0, 0, 0, 0);
        if (b->mode & BR_BOOT_FLAG_TESTFLY)
        {
            // A bird that knows FLY, for the drivers that have to leave the ground.
            // SWELLOW learns it from no level-up table, so the move goes on by hand.
            u16 move = MOVE_FLY;
            u8 slot = CalculatePlayerPartyCount();

            ScriptGiveMon(SPECIES_SWELLOW, 30, 0, 0, 0, 0);
            if (slot < PARTY_SIZE)
                SetMonData(&gPlayerParty[slot], MON_DATA_MOVE4, &move);
        }
        if (BR_BOOT_MODE(b->mode) == BR_BOOT_SAFARI)
            BrMatch_BeginSafari();
    }
    b->mode = BR_BOOT_NONE;
}
