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
// The FLAG_HIDE_* sweep below is blanket on purpose -- see GiveTheRunOfHoenn -- but a
// handful of the people it would take away are people a match wants.
static const u16 sKeepVisible[] =
{
    // Mt Chimney's five ordinary trainers: Shelby, Melissa, Sheila, Shirley and Sawyer,
    // who are hidden only while Magma holds the summit. The only flag in the whole block
    // that gates an ordinary trainer on any of the 518 maps a match can use.
    FLAG_HIDE_MT_CHIMNEY_TRAINERS,
    // And the ferry. Cam: "you can keep the harbors open, or at least the one that will
    // take you to Dewford and Mauville" -- Slateport and Lilycove are a boat ride apart
    // and that is worth having. Opening the doors is not enough on its own: the attendant
    // you talk to and the boat you can see are both hide-gated, so the sweep left two
    // harbours you could walk into and do nothing in.
    FLAG_HIDE_LILYCOVE_HARBOR_FERRY_ATTENDANT,
    FLAG_HIDE_LILYCOVE_HARBOR_SSTIDAL,
    FLAG_HIDE_SLATEPORT_CITY_HARBOR_PATRONS,
    FLAG_HIDE_SLATEPORT_CITY_HARBOR_SS_TIDAL,
};

static void GiveTheRunOfHoenn(void)
{
    u16 species;
    u16 flag;
    u16 var;
    u8 k;
    bool8 keep;

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
    // ...and the rest of the region, because the play-test only got as far as Route 101.
    // 0x4050..0x4081 is every town and route progress state in one block, and they are
    // read with goto_if_eq / map_script_2, which want an exact match: 255 matches none of
    // them, so nothing fires rather than something else firing.
    for (var = VAR_LITTLEROOT_TOWN_STATE; var <= VAR_ROUTE134_STATE; var++)
        VarSet(var, 255);
    VarSet(VAR_LITTLEROOT_INTRO_STATE, 255);
    VarSet(VAR_LITTLEROOT_RIVAL_STATE, 255);
    VarSet(VAR_BOARD_BRINEY_BOAT_STATE, 255);
    VarSet(VAR_BRINEY_HOUSE_STATE, 255);
    VarSet(VAR_BRINEY_LOCATION, 255);
    VarSet(VAR_DEVON_CORP_3F_STATE, 255);
    VarSet(VAR_PETALBURG_WOODS_STATE, 255);
    VarSet(VAR_RUSTURF_TUNNEL_STATE, 255);
    VarSet(VAR_SLATEPORT_HARBOR_STATE, 255);
    VarSet(VAR_SLATEPORT_MUSEUM_1F_STATE, 255);
    VarSet(VAR_LILYCOVE_MUSEUM_2F_STATE, 255);
    VarSet(VAR_LILYCOVE_FAN_CLUB_STATE, 255);
    VarSet(VAR_MOSSDEEP_SPACE_CENTER_STATE, 255);
    VarSet(VAR_MOSSDEEP_SPACE_CENTER_STAIR_GUARD_STATE, 255);
    VarSet(VAR_SEAFLOOR_CAVERN_STATE, 255);
    VarSet(VAR_ELITE_4_STATE, 255);
    // 255 is the wrong answer exactly once. PetalburgCity_Gym_EventScript_Norman is a
    // `switch` over cases 2..8 with the Wally tutorial as its body, and a switch that
    // matches nothing falls through to the body: talking to Norman in a match added Wally
    // to the map and warped you out of the ring. 7 is `defeated Norman`, which is also
    // what OnLoad's `call_if_ge 7` wants to unlock the gym's doors.
    VarSet(VAR_PETALBURG_GYM_STATE, 7);

    // Nobody from the story is standing in the world either. FLAG_HIDE_* is what a map
    // reads before it spawns an object, and 0x2BC..0x3B7 is the whole event block with
    // nothing else in it. That is Birch and the Zigzagoon on Route 101 and the starters
    // bag beside them (an A press ran ChooseStarter and warped you to the lab), Wally in
    // Petalburg, Mauville and Verdanturf, Wanda and her boyfriend and the two smashable
    // rocks in Rusturf Tunnel, and every Aqua and Magma grunt in a hideout.
    //
    // sKeepVisible above is the short list of exceptions and why each one is on it.
    for (flag = FLAG_HIDE_ROUTE_101_BIRCH_STARTERS_BAG; flag <= FLAG_HIDE_SS_TIDAL_ROOMS_SNATCH_GIVER; flag++)
    {
        keep = FALSE;
        for (k = 0; k < ARRAY_COUNT(sKeepVisible); k++)
        {
            if (sKeepVisible[k] == flag)
                keep = TRUE;
        }
        if (!keep)
            FlagSet(flag);
    }
    FlagSet(FLAG_HIDE_CONTEST_POKE_BALL);
    // And the tunnel is already open, so Rock Smash in Rusturf is Rock Smash and not a
    // cutscene: TryUpdateRusturfTunnelState (src/field_specials.c) is guarded on nothing
    // but this flag, and it is what reunites the couple.
    FlagSet(FLAG_RUSTURF_TUNNEL_OPENED);
    // And Birch was rescued, which is not a hide flag but reads like one: Littleroot's
    // OnTransition calls SetTwinPos while it is clear, and the twin spends the match
    // standing at (10,1) waiting to turn somebody back from Route 101.
    FlagSet(FLAG_RESCUED_BIRCH);
    // The ferry runs -- Slateport and Lilycove are a boat ride apart and that is worth
    // having -- but the Battle Frontier is not on its menu, and this one var is the
    // whole gate. Every place the Frontier is offered (script_menu.c's two, and
    // SlateportCity_Harbor/scripts.inc:165) asks FLAG_MET_SCOTT_ON_SS_TIDAL, and the
    // only thing that sets it is the scene on the boat -- whose ON_FRAME trigger fires
    // at VAR_SS_TIDAL_SCOTT_STATE 0, which is what it is at boot. Past it: Scott is
    // hidden with the rest of the story, so that scene would have spent a lockall
    // walking an object that is not there.
    VarSet(VAR_SS_TIDAL_SCOTT_STATE, 1);
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
