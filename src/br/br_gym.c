// Gym leaders as one-shot bosses (POK-295). See include/br/br_gym.h.
#include "global.h"
#include "data.h"
#include "item.h"
#include "money.h"
#include "sound.h"
#include "string_util.h"
#include "constants/characters.h"
#include "constants/items.h"
#include "constants/opponents.h"
#include "constants/songs.h"
#include "br/br_hud.h"
#include "br/br_gym.h"

#define BR_GYM_PURSE 1000

struct BrBoss
{
    u16 trainerId;
    u16 prize;
};

// The TM each gym already hands out, which is as themed as a prize gets: it is the move
// the leader just used on you.
static const struct BrBoss sBosses[] =
{
    { TRAINER_ROXANNE_1,       ITEM_TM_ROCK_TOMB },
    { TRAINER_BRAWLY_1,        ITEM_TM_BULK_UP },
    { TRAINER_WATTSON_1,       ITEM_TM_SHOCK_WAVE },
    { TRAINER_FLANNERY_1,      ITEM_TM_OVERHEAT },
    { TRAINER_NORMAN_1,        ITEM_TM_FACADE },
    { TRAINER_WINONA_1,        ITEM_TM_AERIAL_ACE },
    { TRAINER_TATE_AND_LIZA_1, ITEM_TM_CALM_MIND },
    { TRAINER_JUAN_1,          ITEM_TM_WATER_PULSE },
};

extern const u8 BR_EventScript_BossBeaten[];

static const u8 sText_Took[] = _("TOOK ");
// 21 after the newline, so the longest prize name (a TM's move, up to 12) still leaves the
// "!" inside the box's 40. "AND 1000 IN PRIZE MONEY!" lost it to WATER PULSE (POK-330 #55).
static const u8 sText_AndPurse[] = _("\nAND 1000 PRIZE MONEY!");

static const struct BrBoss *Find(u16 trainerId)
{
    u8 i;

    for (i = 0; i < ARRAY_COUNT(sBosses); i++)
    {
        if (sBosses[i].trainerId == trainerId)
            return &sBosses[i];
    }
    return NULL;
}

bool8 BrGym_IsBoss(u16 trainerId)
{
    return Find(trainerId) != NULL;
}

const u8 *BrGym_Intro(u16 trainerId, const u8 *speech)
{
    u16 i;

    if (speech == NULL || Find(trainerId) == NULL)
        return speech;
    // A page ends at a \p; a \l only scrolls, and is still the same breath. gStringVar4
    // is a thousand bytes and the field message box reads out of whatever it is handed.
    for (i = 0; i < 999 && speech[i] != EOS && speech[i] != CHAR_PROMPT_CLEAR; i++)
        gStringVar4[i] = speech[i];
    gStringVar4[i] = EOS;
    return gStringVar4;
}

const u8 *BrGym_AfterScript(u16 trainerId, const u8 *script)
{
    return Find(trainerId) != NULL ? BR_EventScript_BossBeaten : script;
}

void BrGym_Beaten(u16 trainerId)
{
    const struct BrBoss *boss = Find(trainerId);
    u8 line[BR_HUD_LINE_MAX + 2];
    const u8 *last = line + ARRAY_COUNT(line) - 1;
    u8 *p;

    if (boss == NULL)
        return;
    AddBagItem(boss->prize, 1);
    AddMoney(&gSaveBlock1Ptr->money, BR_GYM_PURSE);
    // "TOOK ROCK TOMB" / "AND 1000 PRIZE MONEY!" No yen sign: FONT_SMALL has no glyph
    // for it and prints a hash.
    p = BrHud_Append(line, last, sText_Took);
    p = BrHud_Append(p, last, GetItemName(boss->prize));
    BrHud_Append(p, last, sText_AndPurse);
    PlaySE(SE_PIN);
    BrHud_Box(line);
}
