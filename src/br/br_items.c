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
#include "constants/items.h"
#include "constants/songs.h"
#include "br/br_hud.h"
#include "br/br_balls.h"
#include "br/br_items.h"
#include "br/br_match.h"

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
// do the REPELs and the ESCAPE ROPE while there are step encounters and caves to leave.
static const u16 sSellItems[] =
{
    ITEM_NUGGET, ITEM_PEARL, ITEM_BIG_PEARL, ITEM_STARDUST, ITEM_STAR_PIECE,
    ITEM_HEART_SCALE, ITEM_SHOAL_SALT, ITEM_SHOAL_SHELL,
    ITEM_RED_SHARD, ITEM_BLUE_SHARD, ITEM_YELLOW_SHARD, ITEM_GREEN_SHARD,
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
static const u8 sText_Party[] = _("PARTY ");
static const u8 sText_Maxed[] = _(" MAXED");
static const u8 sText_Plus[] = _("! +¥");
static const u8 sText_PartyHealed[] = _("The whole party was treated.{PAUSE_UNTIL_PRESS}");
static const u8 sText_FoundVitamin[] = _("{PLAYER} found {STR_VAR_2}!\nThe whole party's {STR_VAR_1}\lwent to the top.");
static const u8 sText_FoundSome[] = _("{PLAYER} found {STR_VAR_1} {STR_VAR_2}!");
static const u8 sText_FoundSell[] = _("{PLAYER} found {STR_VAR_2}!\nIt fetched ¥{STR_VAR_1}.");

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
// into a FULL RESTORE. The ball rule is the ground's alone (BrItems_Pickup).
static u8 Apply(u16 *item, u16 count, u8 *text)
{
    s8 row;
    u32 money;
    u8 *p;

    if (gBrMatch.phase == BR_PHASE_NONE)
        return BR_ITEMS_TO_BAG;
    row = Vitamin(*item);
    if (row >= 0)
    {
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
    return BR_ITEMS_TO_BAG;
}

u8 BrItems_Pickup(u16 *item, u16 *count, u8 *text)
{
    if (Apply(item, *count, text) == BR_ITEMS_USED)
        return BR_ITEMS_USED;
    if (gBrMatch.phase != BR_PHASE_NONE
     && GetItemPocket(*item) == POCKET_POKE_BALLS && *item != ITEM_MASTER_BALL)
        *count = BR_ITEMS_BALLS;
    return BR_ITEMS_TO_BAG;
}

bool8 BrItems_Arrive(u16 *item, u16 count)
{
    u8 line[BR_HUD_LINE_MAX + 2];

    // Nothing the player is shown said so (a mon's held item TAKEn, a spilled bag's
    // GIVE): the ticker does.
    if (Apply(item, count, line) != BR_ITEMS_USED)
        return FALSE;
    BrHud_Say(line);
    return TRUE;
}

// A map's item, seen or hidden: TRUE when it was used, or a pile bagged, here, and
// gStringVar4 says so; else *item and *count are what goes on to pret's script.
static bool8 Found(u16 *item, u16 *count)
{
    u16 was = *item;
    s8 row = Vitamin(was);

    if (BrItems_Pickup(item, count, NULL) == BR_ITEMS_TO_BAG)
    {
        // pret's lines say "found one", so a pile is taken and said here; with no room
        // the script goes on to pret's own "the BAG is full".
        if (*count > 1 && AddBagItem(*item, *count))
        {
            ConvertIntToDecimalStringN(gStringVar1, *count, STR_CONV_MODE_LEFT_ALIGN, 2);
            CopyItemNameHandlePlural(*item, gStringVar2, *count);
            StringExpandPlaceholders(gStringVar4, sText_FoundSome);
            return TRUE;
        }
        return FALSE;
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
    return TRUE;
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
