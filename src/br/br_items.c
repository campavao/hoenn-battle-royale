// The item rework. See include/br/br_items.h.
#include "global.h"
#include "event_data.h"
#include "item.h"
#include "item_menu.h"
#include "money.h"
#include "party_menu.h"
#include "pokemon.h"
#include "sound.h"
#include "string_util.h"
#include "strings.h"
#include "text.h"
#include "data.h"
#include "constants/items.h"
#include "constants/pokemon.h"
#include "constants/songs.h"
#include "br/br_hud.h"
#include "br/br_balls.h"
#include "br/br_items.h"
#include "br/br_match.h"
#include "br/br_moves.h"

// Vitamin -> the EV it fills. The MON_DATA_*_EV ids are not in the vitamins' order, so a table.
static const u16 sVitamins[][2] =
{
    { ITEM_HP_UP,   MON_DATA_HP_EV },
    { ITEM_PROTEIN, MON_DATA_ATK_EV },
    { ITEM_IRON,    MON_DATA_DEF_EV },
    { ITEM_CARBOS,  MON_DATA_SPEED_EV },
    { ITEM_CALCIUM, MON_DATA_SPATK_EV },
    { ITEM_ZINC,    MON_DATA_SPDEF_EV },
};

static const u8 sText_Hp[] = _("HP");
static const u8 sText_Attack[] = _("ATTACK");
static const u8 sText_Defense[] = _("DEFENSE");
static const u8 sText_Speed[] = _("SPEED");
static const u8 sText_SpAtk[] = _("SP. ATK");
static const u8 sText_SpDef[] = _("SP. DEF");
static const u8 *const sStatNames[] =
{
    sText_Hp, sText_Attack, sText_Defense, sText_Speed, sText_SpAtk, sText_SpDef,
};

// Worth nothing in a match but their price: nobody sells, so carrying one is only a stop
// at a Mart. The POKe DOLL and FLUFFY TAIL stay (the way out of a fight, POK-293), and so
// does the ESCAPE ROPE while there are caves to leave. The REPELs go: nothing is met on a
// step any more, only on a patch you walk onto (br_patch.h).
static const u16 sSellItems[] =
{
    ITEM_NUGGET, ITEM_PEARL, ITEM_BIG_PEARL, ITEM_STARDUST, ITEM_STAR_PIECE,
    ITEM_HEART_SCALE, ITEM_SHOAL_SALT, ITEM_SHOAL_SHELL,
    ITEM_RED_SHARD, ITEM_BLUE_SHARD, ITEM_YELLOW_SHARD, ITEM_GREEN_SHARD,
    ITEM_REPEL, ITEM_SUPER_REPEL, ITEM_MAX_REPEL,
};

// Cures one thing each; a FULL RESTORE cures it and heals too.
static const u16 sStatusHeals[] =
{
    ITEM_ANTIDOTE, ITEM_BURN_HEAL, ITEM_ICE_HEAL, ITEM_AWAKENING, ITEM_PARALYZE_HEAL,
    ITEM_FULL_HEAL, ITEM_LAVA_COOKIE, ITEM_HEAL_POWDER,
    ITEM_BLUE_FLUTE, ITEM_YELLOW_FLUTE, ITEM_RED_FLUTE,
};

// Bring one mon back each, as in pret: a revive was the scarce thing, and a party-wide
// one would be a balance change of its own (Cam's call, not this rework's).
static const u16 sRevives[] =
{
    ITEM_REVIVE, ITEM_MAX_REVIVE, ITEM_REVIVAL_HERB,
};

#define BR_ITEMS_BALLS 6

static const u8 sText_Bang[] = _("! ");
static const u8 sText_Party[] = _("Party ");
static const u8 sText_Maxed[] = _(" maxed");
static const u8 sText_Plus[] = _("! +¥");
static const u8 sText_PartyHealed[] = _("The whole party was treated.{PAUSE_UNTIL_PRESS}");
static const u8 sText_FoundVitamin[] = _("{PLAYER} found {STR_VAR_2}!\nThe whole party's {STR_VAR_1}\lwent to the top.");
static const u8 sText_FoundSome[] = _("{PLAYER} found {STR_VAR_1} {STR_VAR_2}!");
static const u8 sText_FoundSell[] = _("{PLAYER} found {STR_VAR_2}!\nIt fetched ¥{STR_VAR_1}.");
static const u8 sText_FoundTmLeft[] = _("The whole party knows\n{STR_VAR_1}. The TM stays put.");
static const u8 sText_FoundTmHave[] = _("You already have\n{STR_VAR_1}. The TM stays put.");

static bool8 InList(const u16 *list, u8 n, u16 item)
{
    u8 i;

    for (i = 0; i < n; i++)
    {
        if (list[i] == item)
            return TRUE;
    }
    return FALSE;
}

// The row of sVitamins for this item, or -1.
static s8 Vitamin(u16 item)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sVitamins); i++)
    {
        if (sVitamins[i][0] == item)
            return i;
    }
    return -1;
}

static void MaxPartyEv(u8 row)
{
    u8 ev = MAX_PER_STAT_EVS;
    u8 i;

    for (i = 0; i < PARTY_SIZE; i++)
    {
        struct Pokemon *mon = &gPlayerParty[i];

        if (GetMonData(mon, MON_DATA_SPECIES, NULL) == SPECIES_NONE
         || GetMonData(mon, MON_DATA_IS_EGG, NULL))
            continue;
        SetMonData(mon, sVitamins[row][1], &ev);
        CalculateMonStats(mon);
    }
}

static u32 SellPrice(u16 item, u16 count)
{
    return (u32)(GetItemPrice(item) / 2) * count;
}

// The rule itself, for every way an item arrives: a vitamin or a sell item is used up
// (BR_ITEMS_USED, and `text`, when not NULL, says how in one line), a status heal turns
// into a FULL RESTORE, a ball other than the MASTER BALL into a ROYALE BALL. Six balls
// for one is the ground's rule alone (BrItems_Pickup). `dry` says what would happen and
// does none of it (BrItems_Fits).
static u8 Apply(u16 *item, u16 count, u8 *text, bool8 dry)
{
    s8 row;
    u32 money;
    u8 *p;

    if (gBrMatch.phase == BR_PHASE_NONE)
        return BR_ITEMS_TO_BAG;
    row = Vitamin(*item);
    if (row >= 0)
    {
        if (dry)
            return BR_ITEMS_USED;
        MaxPartyEv(row);
        if (text != NULL)
        {
            p = StringCopy(text, GetItemName(*item));
            p = StringCopy(p, sText_Bang);
            p = StringCopy(p, sText_Party);
            p = StringCopy(p, sStatNames[row]);
            StringCopy(p, sText_Maxed);
        }
        return BR_ITEMS_USED;
    }
    if (InList(sSellItems, ARRAY_COUNT(sSellItems), *item))
    {
        if (dry)
            return BR_ITEMS_USED;
        money = SellPrice(*item, count);
        AddMoney(&gSaveBlock1Ptr->money, money);
        if (text != NULL)
        {
            p = StringCopy(text, GetItemName(*item));
            p = StringCopy(p, sText_Plus);
            ConvertIntToDecimalStringN(p, money, STR_CONV_MODE_LEFT_ALIGN, 7);
        }
        return BR_ITEMS_USED;
    }
    if (InList(sStatusHeals, ARRAY_COUNT(sStatusHeals), *item))
        *item = ITEM_FULL_RESTORE;
    if (GetItemPocket(*item) == POCKET_POKE_BALLS && *item != ITEM_MASTER_BALL)
        *item = BR_ITEM_ROYALE_BALL;
    return BR_ITEMS_TO_BAG;
}

static u8 Pickup(u16 *item, u16 *count, u8 *text, bool8 dry)
{
    if (Apply(item, *count, text, dry) == BR_ITEMS_USED)
        return BR_ITEMS_USED;
    if (gBrMatch.phase != BR_PHASE_NONE && *item == BR_ITEM_ROYALE_BALL)
        *count = BR_ITEMS_BALLS;
    return BR_ITEMS_TO_BAG;
}

u8 BrItems_Pickup(u16 *item, u16 *count, u8 *text)
{
    return Pickup(item, count, text, FALSE);
}

bool8 BrItems_Fits(u16 item)
{
    u16 count = 1;

    if (Pickup(&item, &count, NULL, TRUE) == BR_ITEMS_USED)
        return TRUE; // used where it lies: nothing goes in the bag
    return CheckBagHasSpace(item, count);
}

bool8 BrItems_Arrive(u16 *item, u16 count)
{
    u8 line[BR_HUD_LINE_MAX + 2];

    // Nothing the player is shown said so (a mon's held item TAKEn, a spilled bag's
    // GIVE): the ticker does.
    if (Apply(item, count, line, FALSE) != BR_ITEMS_USED)
        return FALSE;
    BrHud_Say(line);
    return TRUE;
}

// What Found makes of a map's item, for the scripts' VAR_RESULT.
#define FOUND_TO_SCRIPT 0 // pret's script goes on with *item, *count
#define FOUND_USED      1 // used, sold or bagged as a pile here
#define FOUND_LEFT      2 // a TM nobody here can learn: left where it lies

// A map's item, seen or hidden: FOUND_USED when it was used, or a pile bagged, here, and
// FOUND_LEFT for a TM the whole party already knows, or one already in the bag, gStringVar4 saying which; else *item
// and *count are what goes on to pret's script. A TM it lets go on is taught as soon as
// the script is done (BrMoves_TeachSoon).
static u8 Found(u16 *item, u16 *count)
{
    u16 was = *item;
    s8 row = Vitamin(was);

    if (gBrMatch.phase != BR_PHASE_NONE && BrMoves_IsTm(was))
    {
        // One copy each: a second is left for somebody else.
        if (CheckBagHasItem(was, 1) || !BrMoves_Teachable(was))
        {
            StringCopy(gStringVar1, gMoveNames[ItemIdToBattleMoveId(was)]);
            StringExpandPlaceholders(gStringVar4, CheckBagHasItem(was, 1) ? sText_FoundTmHave : sText_FoundTmLeft);
            return FOUND_LEFT;
        }
        BrMoves_TeachSoon(was);
        return FOUND_TO_SCRIPT;
    }

    if (BrItems_Pickup(item, count, NULL) == BR_ITEMS_TO_BAG)
    {
        // pret's lines say "found one", so a pile is taken and said here; with no room
        // the script goes on to pret's own "the BAG is full".
        if (*count > 1 && AddBagItem(*item, *count))
        {
            ConvertIntToDecimalStringN(gStringVar1, *count, STR_CONV_MODE_LEFT_ALIGN, 2);
            CopyItemNameHandlePlural(*item, gStringVar2, *count);
            StringExpandPlaceholders(gStringVar4, sText_FoundSome);
            return FOUND_USED;
        }
        return FOUND_TO_SCRIPT;
    }
    CopyItemName(was, gStringVar2);
    if (row >= 0)
    {
        StringCopy(gStringVar1, sStatNames[row]);
        StringExpandPlaceholders(gStringVar4, sText_FoundVitamin);
    }
    else
    {
        ConvertIntToDecimalStringN(gStringVar1, SellPrice(was, *count), STR_CONV_MODE_LEFT_ALIGN, 7);
        StringExpandPlaceholders(gStringVar4, sText_FoundSell);
    }
    return FOUND_USED;
}

bool8 BrItems_TmNamedForMove(void)
{
    return gBrMatch.phase != BR_PHASE_NONE;
}

void BrItems_FindItem(void)
{
    // What this ball holds this match: a quarter of them a TM (br_balls.h).
    u16 item = BrBalls_Deal(gSaveBlock1Ptr->location.mapGroup, gSaveBlock1Ptr->location.mapNum,
                            gSpecialVar_LastTalked, gSpecialVar_0x8000);
    u16 count = gSpecialVar_0x8001;

    gSpecialVar_Result = Found(&item, &count);
    gSpecialVar_0x8000 = item;
    gSpecialVar_0x8001 = count;
}

void BrItems_FindHidden(void)
{
    u16 item = gSpecialVar_0x8005;
    u16 count = 1;

    gSpecialVar_Result = Found(&item, &count);
    gSpecialVar_0x8005 = item;
}

bool8 BrItems_HealParty(u8 taskId)
{
    u16 item = gSpecialVar_ItemId;
    bool8 used = FALSE;
    u8 i;

    if (gBrMatch.phase == BR_PHASE_NONE || InList(sRevives, ARRAY_COUNT(sRevives), item))
        return FALSE;
    for (i = 0; i < PARTY_SIZE; i++)
    {
        if (GetMonData(&gPlayerParty[i], MON_DATA_SPECIES, NULL) == SPECIES_NONE
         || GetMonData(&gPlayerParty[i], MON_DATA_IS_EGG, NULL))
            continue;
        // TRUE means it would do nothing for this one.
        if (!ExecuteTableBasedItemEffect(&gPlayerParty[i], item, i, 0))
            used = TRUE;
    }
    if (!used)
    {
        DisplayItemMessage(taskId, FONT_NORMAL, gText_WontHaveEffect, CloseItemMessage);
        return TRUE;
    }
    PlaySE(SE_USE_ITEM);
    RemoveBagItem(item, 1);
    DisplayItemMessage(taskId, FONT_NORMAL, sText_PartyHealed, CloseItemMessage);
    return TRUE;
}

const u8 gBrText_LinkCableDesc[] = _(
    "Evolves a POKéMON\n"
    "that would evolve\n"
    "when traded.");

const u8 gBrText_RoyaleBallDesc[] = _(
    "ULTRA BALL odds,\n"
    "doubled on a\n"
    "battle's first turn.");

const u32 gBrItemIcon_LinkCable[] = INCGFX_U32("graphics/items/icons/br_link_cable.png", ".4bpp.lz");
const u32 gBrItemIconPalette_LinkCable[] = INCGFX_U32("graphics/items/icon_palettes/br_link_cable.pal", ".gbapal.lz");

// pokemon.c's, which no header declares; declared here as daycare.c does.
extern const struct Evolution gEvolutionTable[][EVOS_PER_MON];

u16 BrItems_CableTarget(struct Pokemon *mon, u8 mode)
{
    u16 species = GetMonData(mon, MON_DATA_SPECIES, NULL);
    u16 held = GetMonData(mon, MON_DATA_HELD_ITEM, NULL);
    u16 none = ITEM_NONE;
    u8 i;

    for (i = 0; i < EVOS_PER_MON; i++)
    {
        const struct Evolution *evo = &gEvolutionTable[species][i];

        if (evo->method == EVO_TRADE)
            return evo->targetSpecies;
        if (evo->method == EVO_TRADE_ITEM && evo->param == held)
        {
            if (mode == EVO_MODE_ITEM_USE)
                SetMonData(mon, MON_DATA_HELD_ITEM, &none);
            return evo->targetSpecies;
        }
    }
    return SPECIES_NONE;
}
