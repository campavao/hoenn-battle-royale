// Loot on the ground (POK-232). See include/br/br_loot.h for the model.
#include "global.h"
#include "main.h"
#include "overworld.h"
#include "fieldmap.h"
#include "event_object_movement.h"
#include "constants/event_objects.h"
#include "constants/event_object_movement.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "pokemon.h"
#include "money.h"
#include "data.h"
#include "event_object_lock.h"
#include "script.h"
#include "string_util.h"
#include "sound.h"
#include "script_pokemon_util.h"
#include "constants/songs.h"
#include "constants/items.h"
#include "constants/trainers.h"
#include "constants/pokemon.h"
#include "br/br_catch.h"
#include "br/br_spectate.h"
#include "br/br_hud.h"
#include "field_player_avatar.h"
#include "constants/species.h"
#include "constants/maps.h"
#include "constants/map_event_ids.h"
#include "constants/characters.h"
#include "br/br_ghosts.h"
#include "br/br_levels.h"
#include "item.h"
#include "br/br_loot.h"
#include "br/br_gym.h"
#include "br/br_field.h"

EWRAM_DATA struct BrLoot gBrLoot = {0};
EWRAM_DATA struct BrDespawned gBrDespawned[BR_MAX_DESPAWN] = {0};
// A full spill is six rows, a bag and its contents -- past one slot's 59 bytes.
STATIC_ASSERT(BR_CAP_SPILL >= 4 + PARTY_SIZE * 9 + 1 + 6 + 1 + 8 * 3 + 4 + 1 + PLAYER_NAME_LENGTH, BrSpillCapHoldsAFullSpill)
static EWRAM_DATA u8 sSpillBuf[BR_CAP_SPILL] = {0};
static EWRAM_DATA struct BrAssembler sSpillAsm = {0};
// A trainer's key keeps its party index above an 11-bit id, and the Zone's balls and the
// chest sit at 0x8F00 and 0x8E00 in the same space: party index 1, ids 0x700 and 0x600.
STATIC_ASSERT(TRAINERS_COUNT <= 0x600, BrTrainerLootKeysClearOfTheZoneAndChest)
STATIC_ASSERT((PARTY_SIZE - 1) << 11 < BR_LOOT_KEY_NOBODY, BrTrainerLootKeysFitSixteenBits)

static bool8 OnCurrentMap(const struct BrLootItem *it)
{
    return it->mapGroup == gSaveBlock1Ptr->location.mapGroup
        && it->mapNum == gSaveBlock1Ptr->location.mapNum;
}

static u8 LocalId(const struct BrLootItem *it)
{
    return (u8)(BR_LOOT_LOCAL_ID_BASE + (it - gBrLoot.items));
}

// The object still ours? A map load wipes the table under us, and the local id is the
// proof -- the same rule the ghosts live by.
static struct ObjectEvent *LootObject(struct BrLootItem *it)
{
    struct ObjectEvent *obj;

    if (it->objId == BR_NO_OBJ)
        return NULL;
    obj = &gObjectEvents[it->objId];
    if (!obj->active || obj->localId != LocalId(it))
    {
        it->objId = BR_NO_OBJ;
        return NULL;
    }
    return obj;
}

static void Despawn(struct BrLootItem *it)
{
    struct ObjectEvent *obj = LootObject(it);

    if (obj != NULL)
        RemoveObjectEventByLocalIdAndMap(obj->localId, obj->mapNum, obj->mapGroup);
    it->objId = BR_NO_OBJ;
}

static void Spawn(struct BrLootItem *it)
{
    // Birch's bag is the one bag-shaped object event Emerald has; a team is balls.
    u8 gfx = it->kind == BR_LOOT_BAG ? OBJ_EVENT_GFX_BIRCHS_BAG : OBJ_EVENT_GFX_ITEM_BALL;
    u8 id = SpawnSpecialObjectEventParameterized(gfx, MOVEMENT_TYPE_NONE, LocalId(it),
                                                 it->x, it->y, MapGridGetElevationAt(it->x, it->y));

    if (id >= OBJECT_EVENTS_COUNT)
        return;
    it->objId = id;
}

// On this map and inside the box the engine keeps objects in (POK-330 #48).
static bool8 InView(const struct BrLootItem *it)
{
    return it->kind != BR_LOOT_NONE && OnCurrentMap(it) && BrField_InObjectView(it->x, it->y);
}

u8 BrLoot_Wanted(void)
{
    u8 i, n = 0;

    for (i = 0; i < BR_MAX_LOOT; i++)
        if (InView(&gBrLoot.items[i]))
            n++;
    return n;
}

// The pieces in view that get an object, as a bit a row: all of them when there is
// room, else the `limit` nearest the middle of the view, the lower row first on a tie.
static u8 Keep(u8 limit)
{
    u8 i, j, nearer, keep = 0;
    u16 d, e;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (!InView(&gBrLoot.items[i]))
            continue;
        d = BrField_ViewDistance(gBrLoot.items[i].x, gBrLoot.items[i].y);
        for (j = 0, nearer = 0; j < BR_MAX_LOOT && nearer < limit; j++)
        {
            if (j == i || !InView(&gBrLoot.items[j]))
                continue;
            e = BrField_ViewDistance(gBrLoot.items[j].x, gBrLoot.items[j].y);
            if (e < d || (e == d && j < i))
                nearer++;
        }
        if (nearer < limit)
            keep |= 1 << i;
    }
    return keep;
}

static struct BrLootItem *Find(u16 key)
{
    u8 i;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (gBrLoot.items[i].kind != BR_LOOT_NONE && gBrLoot.items[i].key == key)
            return &gBrLoot.items[i];
    }
    return NULL;
}

static struct BrLootItem *FreeSlot(void)
{
    u8 i;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (gBrLoot.items[i].kind == BR_LOOT_NONE)
            return &gBrLoot.items[i];
    }
    return NULL;
}

static void Drop(struct BrLootItem *it)
{
    Despawn(it);
    it->kind = BR_LOOT_NONE;
    it->key = 0;
}

static void Add(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 species, u8 level, u8 kind,
                u32 money)
{
    struct BrLootItem *it = Find(key);

    if (it == NULL)
        it = FreeSlot();
    if (it == NULL)
        return; // the ground is full; the page will resend on the next map load
    Despawn(it);
    it->key = key;
    it->mapGroup = mapGroup;
    it->mapNum = mapNum;
    it->x = x;
    it->y = y;
    it->species = species;
    it->level = level;
    it->kind = kind;
    it->money = money;
    it->objId = BR_NO_OBJ;
}

void BrLoot_AddItem(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 item)
{
    Add(key, mapGroup, mapNum, x, y, item, 0, BR_LOOT_ITEM, 0);
}

void BrLoot_AddMon(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 species, u8 level)
{
    Add(key, mapGroup, mapNum, x, y, species, level, BR_LOOT_MON, 0);
}

void BrLoot_DropKey(u16 key)
{
    struct BrLootItem *it = Find(key);

    if (it != NULL)
        Drop(it);
}

// SPILL: seat, map, count, then count 9-byte rows (key, x, y, species, level), then a
// bag flag and, if set, the bag's own key and cell. The bag's contents are the picker's
// business and are not kept here.
static void ParseSpill(const u8 *d, u16 n)
{
    u8 mapGroup, mapNum, count, i;
    u16 off;

    if (n < 4)
        return;
    mapGroup = d[1];
    mapNum = d[2];
    count = d[3];
    if (count > PARTY_SIZE)
        return;
    if ((u16)(4 + 9 * count) > n)
        return;
    for (i = 0; i < count; i++)
    {
        const u8 *row = d + 4 + 9 * i;
        u16 species = BrWire_Species(BrWire_ReadU16(row + 6));

        // A ball of a species the ROM has no mon for stays off the ground: its name is
        // what the held line and TOOK copy into a 42-byte line, and its CreateMon is what
        // taking it runs (POK-330 #43). The rest of the spill still lands.
        if (species == SPECIES_NONE)
            continue;
        Add(BrWire_ReadU16(row), mapGroup, mapNum, (s16)BrWire_ReadU16(row + 2),
            (s16)BrWire_ReadU16(row + 4), species, BrWire_Level(row[8]), BR_LOOT_MON, 0);
    }
    off = 4 + 9 * count;
    if (off < n && d[off] != 0 && (u16)(off + 7) <= n)
    {
        u32 money = 0;
        // off is the bag flag; its key and cell are the six bytes after it, so the
        // item count is at off+7. It was read at off+8 -- the low byte of the money
        // itself -- so `at` ran hundreds of bytes past the end, the guard below caught
        // it, and every bag on the ground was worth the fallback: FOUND 0.
        u16 cash = off + 7;

        // itemCount rows of (id u16, n u8) then the money; the rows are the pickup's
        // business, the money is what the bag is worth to whoever gets there first.
        if (cash < n)
        {
            u16 at = cash + 1 + 3 * d[cash];

            if ((u16)(at + 4) <= n)
                money = d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | ((u32)d[at + 3] << 24);
        }
        Add(BrWire_ReadU16(d + off + 1), mapGroup, mapNum, (s16)BrWire_ReadU16(d + off + 3),
            (s16)BrWire_ReadU16(d + off + 5), 0, 0, BR_LOOT_BAG, money);
    }
}

// The bag Take() last sent the pickup for, kept until its GIVE arrives: the key and the
// cell anything that does not fit goes back to. kind BR_LOOT_NONE when there is none.
static EWRAM_DATA struct BrLootItem sGivenBag = {0};
// [seat, map, 0 mons, bag, key, x, y, itemCount, 8 * (id, n), money, nameLen]:
// BrLoot_SpillOwn's bag with nobody's name on it and the cash already taken.
#define BR_GIVE_BACK_MAX (4 + 1 + 6 + 1 + 8 * 3 + 4 + 1)
// A give-back the out ring had no room for, held until it has (POK-331 #6). It lands on
// our own ground only as it goes out: the page records a bag from its SPILL, so a bag
// that was here and never sent was one the next taker got no GIVE for.
static EWRAM_DATA u8 sGiveBack[BR_GIVE_BACK_MAX] = {0};
static EWRAM_DATA u8 sGiveBackLen = 0;

// Out to the room first, then onto our own ground, as every spill is. FALSE when the ring
// is full: the held give-back stays held.
static bool8 SendGiveBack(void)
{
    if (!BrWire_SendLarge(BR_MSG_SPILL, sGiveBack, sGiveBackLen))
        return FALSE;
    ParseSpill(sGiveBack, sGiveBackLen);
    sGiveBackLen = 0;
    return TRUE;
}

static const u8 sText_NoRoom[] = _("NO ROOM FOR IT");
static const u8 sText_NoRoomRest[] = _("NO ROOM FOR THE REST");
// Defined with Take(): the FOUND line, and under it the NO ROOM one.
static void SayBag(u32 money, bool8 full);

// GIVE: the page handing over what was in a bag we just took. The line and the money
// are already said by Take(); this is the rest of it arriving a frame later, which is
// what "one press" means when the contents live on the other side of the mailbox.
//
// A stack goes in whole or not at all, and what does not fit stays on the ground for the
// next trainer -- Kanto's rule (lootTakeAll, "The rest won't fit."). The pickup has gone
// out by now, so staying is the bag spilled again, under its own key on its own cell,
// with only the rest in it. AddBagItem's FALSE used to go unread, and a full pocket
// threw the rest away for the whole room (POK-331 #6).
static void HandleGive(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    u8 buf[BR_GIVE_BACK_MAX];
    u8 count, i, left = 0;
    u16 at = 12;

    if (n < 1)
        return;
    count = d[0];
    if (count > 8 || (u16)(1 + 3 * count) > n)
        return;
    for (i = 0; i < count; i++)
    {
        const u8 *row = d + 1 + 3 * i;
        u16 item = BrWire_ReadU16(row);

        if (item == ITEM_NONE || row[2] == 0 || AddBagItem(item, row[2]))
            continue;
        buf[at++] = row[0];
        buf[at++] = row[1];
        buf[at++] = row[2];
        left++;
    }
    if (left == 0)
    {
        sGivenBag.kind = BR_LOOT_NONE;
        return;
    }
    PlaySE(SE_FAILURE);
    if (sGivenBag.kind != BR_LOOT_BAG)
    {
        BrHud_Box(sText_NoRoom); // no bag of ours to put it back in: nothing to point at
        return;
    }
    SayBag(sGivenBag.money, TRUE);
    buf[0] = gBrMySeat;
    buf[1] = sGivenBag.mapGroup;
    buf[2] = sGivenBag.mapNum;
    buf[3] = 0;
    buf[4] = 1;
    BrWire_WriteU16(buf + 5, sGivenBag.key);
    BrWire_WriteU16(buf + 7, (u16)sGivenBag.x);
    BrWire_WriteU16(buf + 9, (u16)sGivenBag.y);
    buf[11] = left;
    buf[at++] = 0; // money: Take() paid it out already
    buf[at++] = 0;
    buf[at++] = 0;
    buf[at++] = 0;
    buf[at++] = 0; // no name: the ROM never kept whose it was
    sGivenBag.kind = BR_LOOT_NONE;
    // One held at a time. The page answers only a PICKUP it read, and BrLoot_Tick sends
    // the held one before TryTake can put a PICKUP in the ring, so a second GIVE finds
    // the first gone; should it not, the first keeps its place and this rest is lost on
    // both sides alike.
    if (sGiveBackLen != 0 && !SendGiveBack())
        return;
    for (i = 0; i < at; i++)
        sGiveBack[i] = buf[i];
    sGiveBackLen = at;
    SendGiveBack();
}

static void HandleSpill(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sSpillAsm, BR_MSG_SPILL, FALSE, payload, len))
        ParseSpill(sSpillAsm.buf, sSpillAsm.total);
}

static void HandleSpillCont(const u8 *payload, u8 len)
{
    if (BrWire_Assemble(&sSpillAsm, BR_MSG_SPILL, TRUE, payload, len))
        ParseSpill(sSpillAsm.buf, sSpillAsm.total);
}

// PICKUP: somebody took it (or part of a bag). A bare key -- no item named -- is the
// whole piece leaving the ground; with an item, the rest is still there.
static void HandlePickup(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    struct BrLootItem *it;

    if (n < 8)
        return;
    it = Find(BrWire_ReadU16(d + 1));
    if (it == NULL)
        return;
    if (d[3] != 0 && it->kind == BR_LOOT_BAG)
        return; // part of a bag went; the bag is still standing there
    Drop(it);
}

struct BrLootItem *BrLoot_At(s16 x, s16 y)
{
    u8 i;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        struct BrLootItem *it = &gBrLoot.items[i];

        if (it->kind != BR_LOOT_NONE && OnCurrentMap(it) && it->x == x && it->y == y)
            return it;
    }
    return NULL;
}

// Where a dropped thing lands: our own cell first, then the ring of cells around it,
// skipping a cell whose collision bit is set and one this spill has already used.
// Only the collision bit, as the eyeline (br_engage.c): water and ledges are open
// ground, so a trainer who goes out at sea still leaves their team behind, and the
// page's match/loot.ts deals a bot's spill by the same rule (POK-330 #67). Loot an
// earlier spill left is not looked at; a new piece can land on top of it. Kanto
// scatters within two tiles; this walks out in the same order every time, which is
// what keeps a spill deterministic for everyone reading the message.
static const s8 sSpillDx[] = { 0, 1, -1, 0,  0, 1, -1,  1, -1, 2, -2,  0,  0 };
static const s8 sSpillDy[] = { 0, 0,  0, 1, -1, 1,  1, -1, -1, 0,  0,  2, -2 };
#define BR_SPILL_CELLS (sizeof(sSpillDx) / sizeof(sSpillDx[0]))

static bool8 CellFree(s16 x, s16 y, const s16 *usedX, const s16 *usedY, u8 used)
{
    u8 i;

    if (MapGridGetCollisionAt(x, y) != 0)
        return FALSE;
    for (i = 0; i < used; i++)
    {
        if (usedX[i] == x && usedY[i] == y)
            return FALSE;
    }
    return TRUE;
}

// The next cell out that nothing is standing on, or FALSE when the ring runs out.
static bool8 NextCell(s16 ox, s16 oy, u8 *cell, const s16 *usedX, const s16 *usedY, u8 used,
                      s16 *outX, s16 *outY)
{
    while (*cell < BR_SPILL_CELLS)
    {
        s16 x = ox + sSpillDx[*cell];
        s16 y = oy + sSpillDy[*cell];

        (*cell)++;
        if (CellFree(x, y, usedX, usedY, used))
        {
            *outX = x;
            *outY = y;
            return TRUE;
        }
    }
    return FALSE;
}

// [seat, map, count, count*(key, x, y, species, level), hasBag, bagKey, bagX, bagY,
// itemCount, money, nameLen, name] -- br_wire.h's BR_MSG_SPILL. The bag goes out with
// the money and the name on it; its item list is the pickup ticket's business.
void BrLoot_SpillOwn(void)
{
    u8 buf[96];
    s16 usedX[BR_SPILL_CELLS], usedY[BR_SPILL_CELLS];
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 ox = self->currentCoords.x, oy = self->currentCoords.y;
    u16 len = 0, key;
    u8 count = 0, used = 0, cell = 0, i;
    u32 money;

    buf[len++] = gBrMySeat;
    buf[len++] = gSaveBlock1Ptr->location.mapGroup;
    buf[len++] = gSaveBlock1Ptr->location.mapNum;
    len++; // count, filled in below
    for (i = 0; i < PARTY_SIZE; i++)
    {
        s16 x, y;

        if (GetMonData(&gPlayerParty[i], MON_DATA_SPECIES, NULL) == SPECIES_NONE)
            break;
        if (!NextCell(ox, oy, &cell, usedX, usedY, used, &x, &y))
            break; // nowhere left within reach: the rest of the team stays in its balls
        usedX[used] = x;
        usedY[used] = y;
        used++;
        // The key is ours alone for the match: our seat in the high byte.
        key = BR_LOOT_KEY_OWN(gBrMySeat, count);
        BrWire_WriteU16(buf + len, key);
        BrWire_WriteU16(buf + len + 2, (u16)x);
        BrWire_WriteU16(buf + len + 4, (u16)y);
        BrWire_WriteU16(buf + len + 6, GetMonData(&gPlayerParty[i], MON_DATA_SPECIES, NULL));
        buf[len + 8] = GetMonData(&gPlayerParty[i], MON_DATA_LEVEL, NULL);
        len += 9;
        count++;
    }
    buf[3] = count;
    // The bag, on the next free cell.
    {
        s16 bx, by;

        if (NextCell(ox, oy, &cell, usedX, usedY, used, &bx, &by))
        {
        buf[len++] = 1;
        BrWire_WriteU16(buf + len, BR_LOOT_KEY_BAG(gBrMySeat));
        BrWire_WriteU16(buf + len + 2, (u16)bx);
        BrWire_WriteU16(buf + len + 4, (u16)by);
        len += 6;
        buf[len++] = 0; // itemCount: the bag's contents ride with the pickup
        money = GetMoney(&gSaveBlock1Ptr->money);
        buf[len++] = money & 0xFF;
        buf[len++] = (money >> 8) & 0xFF;
        buf[len++] = (money >> 16) & 0xFF;
        buf[len++] = (money >> 24) & 0xFF;
        for (i = 0; i < PLAYER_NAME_LENGTH && gSaveBlock2Ptr->playerName[i] != EOS; i++)
            ;
        buf[len++] = i;
        {
            u8 j;

            for (j = 0; j < i; j++)
                buf[len++] = gSaveBlock2Ptr->playerName[j];
        }
        }
        else
        {
            buf[len++] = 0;
        }
    }
    BrWire_SendLarge(BR_MSG_SPILL, buf, len);
    // Nobody hears their own message come back off the relay, so put ours down here.
    ParseSpill(buf, len);
}

// ---- taking it ----------------------------------------------------------------

static const u8 sText_Took[] = _("TOOK ");
static const u8 sText_Found[] = _("FOUND ");
static const u8 sText_Bang[] = _("!");

// Tell the room it is gone, and take it off our own ground: nobody hears their own
// message come back.
static void SendPickup(struct BrLootItem *it)
{
    u8 buf[8];

    buf[0] = gBrMySeat;
    BrWire_WriteU16(buf + 1, it->key);
    buf[3] = 0; // no item named: the whole piece is leaving the ground
    buf[4] = 0;
    buf[5] = 0;
    buf[6] = 0;
    buf[7] = it->kind == BR_LOOT_BAG ? 1 : 0;
    BrWire_Send(BR_MSG_PICKUP, buf, 8);
    gBrLoot.taken++;
    Drop(it);
}

// A ball that changed hands finishes the trade the game would have wanted. Kanto's
// rule (BR-24): the four classic trade evolutions go off when somebody else's mon
// reaches you, and your own ball picked back up does not. The item-held ones
// (CLAMPERL, SEADRA) need a held item the ground does not carry, so they stay put.
static u16 TradedInto(u16 species)
{
    switch (species)
    {
    case SPECIES_KADABRA:  return SPECIES_ALAKAZAM;
    case SPECIES_MACHOKE:  return SPECIES_MACHAMP;
    case SPECIES_GRAVELER: return SPECIES_GOLEM;
    case SPECIES_HAUNTER:  return SPECIES_GENGAR;
    default:               return species;
    }
}

// Whose ball it was. A player's key carries their seat in the high byte -- under the
// FREED bit, for one they released -- and a beaten Hoenn trainer's has the top bit set
// and belongs to nobody. Comparing the whole high byte missed the FREED bit, so taking
// back your own released KADABRA evolved it (POK-330 #28).
static bool8 WasOurs(u16 key)
{
    return (key & BR_LOOT_KEY_NOBODY) == 0 && BR_LOOT_KEY_SEAT(key) == gBrMySeat;
}

// Defined below, with the rest of the held line; Take() is above it because it is the
// pickup's own business and this is only the label coming off.
static void DropHeldLine(void);

// "FOUND 1200!" when a bag is taken, and the same again with NO ROOM FOR THE REST under
// it once its GIVE has found a pocket full (HandleGive).
static void SayBag(u32 money, bool8 full)
{
    u8 line[BR_HUD_LINE_MAX + 2];
    u8 *p;

    p = StringCopy(line, sText_Found);
    p = ConvertIntToDecimalStringN(p, money, STR_CONV_MODE_LEFT_ALIGN, 7);
    p = StringCopy(p, sText_Bang);
    if (full)
    {
        *p++ = CHAR_NEWLINE;
        StringCopy(p, sText_NoRoomRest);
    }
    BrHud_Box(line);
}

static void Take(struct BrLootItem *it)
{
    u8 line[BR_HUD_LINE_MAX + 2];
    const u8 *last = line + ARRAY_COUNT(line) - 1;
    struct Pokemon mon;
    u16 species;
    u8 *p;

    DropHeldLine(); // it is about to say what was taken; the held name has done its job
    if (it->kind == BR_LOOT_BAG)
    {
        if (it->money != 0)
            AddMoney(&gSaveBlock1Ptr->money, it->money);
        SayBag(it->money, FALSE);
        PlaySE(SE_PIN);
        sGivenBag = *it; // where its GIVE puts back what does not fit
        SendPickup(it);
        return;
    }
    if (it->kind == BR_LOOT_ITEM)
    {
        // A dealt item ball (POK-261). One press, like everything else on the ground --
        // unless its pocket is full, and then it stays where it lies for somebody with
        // room. The pickup used to go out first and AddBagItem's FALSE was never read, so
        // a full pocket threw the ball away for the whole room (POK-330 #55).
        if (!CheckBagHasSpace(it->species, 1))
        {
            PlaySE(SE_FAILURE);
            BrHud_Box(sText_NoRoom);
            return;
        }
        AddBagItem(it->species, 1);
        p = BrHud_Append(line, last, sText_Found);
        p = BrHud_Append(p, last, GetItemName(it->species));
        BrHud_Append(p, last, sText_Bang);
        PlaySE(SE_PIN);
        BrHud_Box(line);
        SendPickup(it);
        return;
    }
    // A ball: the mon inside goes to the party, evolving on the way if it just changed
    // hands. A full party goes through the catch ticket's own release flow -- the same
    // question, asked once, in one place (POK-227).
    species = WasOurs(it->key) ? it->species : TradedInto(it->species);
    // A ball dropped by somebody carries the level they were at, which is the record of
    // the match the ground is for. A ball the match itself put down carries 0 and means
    // the rung: the DAY CARE's chest (POK-306) has been on that floor since the drop.
    CreateMon(&mon, species, it->level != 0 ? it->level : BrLevels_WildLevel(),
              USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0);
    p = BrHud_Append(line, last, sText_Took);
    p = BrHud_Append(p, last, gSpeciesNames[species]);
    BrHud_Append(p, last, sText_Bang);
    PlaySE(SE_PIN);
    BrHud_Box(line);
    // The ball stays on the ground until the mon inside is really kept. Parking it and
    // taking it in the same breath meant cancelling the release screen destroyed both --
    // and nothing ever leaves the match (POK-294). BrCatch_Apply claims the key when a
    // slot is chosen; a cancel leaves the piece exactly where it was.
    if (!BrCatch_TryParkFrom(&mon, it->key))
    {
        GiveMonToPlayer(&mon);
        SendPickup(it);
    }
    BrSpectate_SendParty();
}

// The piece A would take: the cell we FACE first, then the one we stand on. Kanto asks in
// that order (main.lua:6547-6549) and it is the right one -- standing on a pile while
// facing another is a choice, and the one you are looking at is the one you mean.
static struct BrLootItem *PieceInReach(void)
{
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 x = self->currentCoords.x + (s16)gDirectionToVectors[self->facingDirection].x;
    s16 y = self->currentCoords.y + (s16)gDirectionToVectors[self->facingDirection].y;
    struct BrLootItem *it = BrLoot_At(x, y);

    return it != NULL ? it : BrLoot_At(self->currentCoords.x, self->currentCoords.y);
}

static EWRAM_DATA u16 sHeldKey = BR_HELD_NONE;

static const u8 sText_ABag[] = _("A BAG");

// Stop naming a piece: nothing in reach, the piece was taken, or the overworld is gone.
static void DropHeldLine(void)
{
    if (sHeldKey == BR_HELD_NONE)
        return;
    sHeldKey = BR_HELD_NONE;
    BrHud_Release();
}

// What the ticker says about the piece in front of you (POK-289). Kanto's rule, from its
// README: "face a piece (or stand on it) and the ticker in the top-left corner names it --
// the Pokemon with its party icon, or whose bag it is -- and A takes it."
//
// BrHud_Hold and BrHud_Release have been built and called by nothing since the HUD went
// in, so the only thing a pile ever said was the 90-frame box AFTER you pressed A. You
// walked into a dead trainer's spill and could not tell a NUGGET from a MASTER BALL from
// somebody's SWAMPERT until you had already taken one -- and with a full party, taking
// one is a decision you cannot undo.
//
// Only when the piece in reach CHANGES: BrHud_Hold re-dirties the ticker on every call,
// and saying the same thing sixty times a second would redraw it sixty times a second.
//
// A bag says "A BAG" rather than whose it is. The name is on the wire and the page keeps
// it (match/loot.ts); the ROM's loot row does not, and eight names is sixty-four bytes of
// an EWRAM budget with about seventy left in it.
static void HoldLineForReach(void)
{
    struct BrLootItem *it = PieceInReach();
    u8 line[BR_HUD_LINE_MAX + 2];

    if (it == NULL)
    {
        DropHeldLine();
        return;
    }
    if (it->key == sHeldKey)
        return;
    sHeldKey = it->key;
    if (it->kind == BR_LOOT_BAG)
        StringCopy(line, sText_ABag);
    else if (it->kind == BR_LOOT_ITEM)
        StringCopy(line, GetItemName(it->species));
    else
        StringCopy(line, gSpeciesNames[it->species]);
    BrHud_Hold(line);
}

// A on the cell we stand on or the one we face. The loot has no script of its own --
// it is spawned, not placed by a map -- so the A-press is read here rather than
// through the field's own interaction path.
static void TryTake(void)
{
    struct BrLootItem *it;

    if (!JOY_NEW(A_BUTTON) || ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return;
    it = PieceInReach();
    if (it != NULL)
        Take(it);
}

// ---- Hoenn's own trainers -------------------------------------------------------

// Take the sprite off the map now, and keep taking it off every time the map comes
// back. Emerald only remembers that a beaten trainer will not fight again; Kanto's
// rule is that they are gone.
static void Despawn_Trainer(u8 mapGroup, u8 mapNum, u8 localId)
{
    u8 id = GetObjectEventIdByLocalIdAndMap(localId, mapNum, mapGroup);

    if (id < OBJECT_EVENTS_COUNT)
    {
        RemoveObjectEventByLocalIdAndMap(localId, mapNum, mapGroup);
        gBrLoot.gone++;
    }
}

// Where the ring writes next once every slot is taken.
static EWRAM_DATA u8 sDespawnNext = 0;

static void RememberDespawned(u8 mapGroup, u8 mapNum, u8 localId)
{
    u8 i;

    for (i = 0; i < BR_MAX_DESPAWN; i++)
    {
        if (gBrDespawned[i].localId == localId && gBrDespawned[i].mapNum == mapNum
         && gBrDespawned[i].mapGroup == mapGroup)
            return;
    }
    for (i = 0; i < BR_MAX_DESPAWN; i++)
    {
        if (gBrDespawned[i].localId == 0)
        {
            gBrDespawned[i].mapGroup = mapGroup;
            gBrDespawned[i].mapNum = mapNum;
            gBrDespawned[i].localId = localId;
            return;
        }
    }
    // Full. Since POK-287 this table holds the whole ROOM's beaten trainers rather than
    // only ours, and a twelve-player match beats far more than sixteen of them -- so
    // running out is now the normal case rather than the strange one, and which entry
    // goes matters. Overwrite the oldest: the newest sixteen are the ones on routes
    // somebody has just cleared, which is where anybody is about to be standing. It used
    // to silently drop the NEW one, which is the same size of table with the worse half
    // of it kept.
    gBrDespawned[sDespawnNext].mapGroup = mapGroup;
    gBrDespawned[sDespawnNext].mapNum = mapNum;
    gBrDespawned[sDespawnNext].localId = localId;
    sDespawnNext = (u8)((sDespawnNext + 1) % BR_MAX_DESPAWN);
}

// NPCOUT: somebody else beat one of Hoenn's own trainers, so the sprite goes away here
// too (POK-287). Nobody hears their own message come back, so this only ever runs on a
// peer -- the beater despawned it inline in BrLoot_TrainerBeaten.
static void HandleNpcOut(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);

    if (n < 4 || d[3] == 0)
        return;
    // BR_NO_SEAT: the fog took them, nobody did (POK-299). The map is outside the ring,
    // so whoever is standing on it is bleeding and leaving -- the sprite goes now, and
    // that is all. Remembering it would cost a slot in a table of sixteen, per trainer,
    // per swept map: a single sweep would push out every trainer anybody had beaten.
    if (d[0] == BR_NO_SEAT)
    {
        Despawn_Trainer(d[1], d[2], d[3]);
        return;
    }
    // Remembered first: the sweep is what hides it when we walk onto that map later, and
    // Despawn_Trainer only does anything if we are standing on it right now.
    RememberDespawned(d[1], d[2], d[3]);
    Despawn_Trainer(d[1], d[2], d[3]);
}

// ...and the ones a match never has at all. br_boot.c's story sweep clears the event
// block by setting every FLAG_HIDE_ in it (POK-298), which only reaches NPCs that have
// such a flag. The DAY CARE lady does not have one -- she is furniture to Emerald, always
// there -- and with her door open (POK-306) she is an offer to take a Pokemon off you
// mid-match and hand it back after the last ring. ROM, not EWRAM.
static const struct BrDespawned sNotInAMatch[] =
{
    { MAP_GROUP(MAP_ROUTE117_POKEMON_DAY_CARE), MAP_NUM(MAP_ROUTE117_POKEMON_DAY_CARE), LOCALID_DAYCARE_LADY },
};

// Swept every frame, not once per map load: a map spawns its objects over several
// frames and a sweep timed to the load would run before the sprite it wants is there.
// The cost is two byte compares an entry, and the list is almost always empty.
static void DespawnForThisMap(void)
{
    u8 group = gSaveBlock1Ptr->location.mapGroup;
    u8 num = gSaveBlock1Ptr->location.mapNum;
    u8 i;

    for (i = 0; i < BR_MAX_DESPAWN; i++)
    {
        if (gBrDespawned[i].localId != 0 && gBrDespawned[i].mapGroup == group
         && gBrDespawned[i].mapNum == num)
            Despawn_Trainer(group, num, gBrDespawned[i].localId);
    }
    for (i = 0; i < ARRAY_COUNT(sNotInAMatch); i++)
    {
        if (sNotInAMatch[i].mapGroup == group && sNotInAMatch[i].mapNum == num)
            Despawn_Trainer(group, num, sNotInAMatch[i].localId);
    }
}

// The species and level of party[i], whichever of the four shapes this trainer's party
// is stored in. Every shape starts with the same three fields -- which is why party[0]
// can be read through the plainest pointer, as this used to -- but they have different
// STRIDES, so party[i] cannot.
static void TrainerMonAt(u16 trainerId, u8 i, u16 *species, u8 *lvl)
{
    const struct Trainer *t = &gTrainers[trainerId];
    u8 flags = t->partyFlags;

    // if/else rather than a switch: agbcc (GCC 2.95) calls the switch "unreachable code
    // at beginning of switch statement" and warnings are errors here.
    if (flags == (F_TRAINER_PARTY_CUSTOM_MOVESET | F_TRAINER_PARTY_HELD_ITEM))
    {
        *species = t->party.ItemCustomMoves[i].species;
        *lvl = t->party.ItemCustomMoves[i].lvl;
    }
    else if (flags == F_TRAINER_PARTY_CUSTOM_MOVESET)
    {
        *species = t->party.NoItemCustomMoves[i].species;
        *lvl = t->party.NoItemCustomMoves[i].lvl;
    }
    else if (flags == F_TRAINER_PARTY_HELD_ITEM)
    {
        *species = t->party.ItemDefaultMoves[i].species;
        *lvl = t->party.ItemDefaultMoves[i].lvl;
    }
    else
    {
        *species = t->party.NoItemDefaultMoves[i].species;
        *lvl = t->party.NoItemDefaultMoves[i].lvl;
    }
}

void BrLoot_TrainerBeaten(u16 trainerId, u8 localId)
{
    // Six rows of nine bytes, plus the header and the bag flag. It was sixteen, which is
    // one row: a beaten trainer dropped their lead and kept the rest (POK-291).
    u8 buf[4 + 9 * PARTY_SIZE + 1];
    s16 usedX[BR_SPILL_CELLS], usedY[BR_SPILL_CELLS];
    u8 count = 0, used = 0, cell = 0;
    u8 group = gSaveBlock1Ptr->location.mapGroup;
    u8 num = gSaveBlock1Ptr->location.mapNum;
    u8 id = GetObjectEventIdByLocalIdAndMap(localId, num, group);
    u16 len = 0;
    u8 size = gTrainers[trainerId].partySize;
    s16 ox, oy;
    u8 i;

    // A gym leader pays out before anything else is asked (POK-295): the purse does not
    // depend on there being a sprite to take off the map.
    BrGym_Beaten(trainerId);
    if (localId == 0 || id >= OBJECT_EVENTS_COUNT)
        return;
    if (size == 0)
        return;
    ox = gObjectEvents[id].currentCoords.x;
    oy = gObjectEvents[id].currentCoords.y;

    buf[len++] = gBrMySeat; // the beater speaks for it; an NPC has no seat of its own
    buf[len++] = group;
    buf[len++] = num;
    len++; // count, filled in below

    // Their whole team, not just their lead (POK-291). Kanto's rule, from its README:
    // "Kanto's trainers drop their teams too ... which gives PvE a point beyond levels --
    // and means a route can be picked over." This dropped party[0] and a hard-coded count
    // of 1, so clearing a route was worth about a third of what it is worth there.
    for (i = 0; i < size && i < PARTY_SIZE; i++)
    {
        u16 species;
        u8 lvl;
        s16 x, y;

        if (!NextCell(ox, oy, &cell, usedX, usedY, used, &x, &y))
            break; // nowhere left within reach: the rest of the team stays in its balls
        TrainerMonAt(trainerId, i, &species, &lvl);
        usedX[used] = x;
        usedY[used] = y;
        used++;
        // The top bit says this belongs to nobody. A trainer id is unique for the game
        // and fits in eleven bits (TRAINERS_COUNT is 855), so the party index rides
        // above it and every ball of one team is still its own key -- which matters,
        // because a key is what a pickup names and what Add() overwrites.
        BrWire_WriteU16(buf + len, BR_LOOT_KEY_TRAINER(i, trainerId));
        BrWire_WriteU16(buf + len + 2, (u16)x);
        BrWire_WriteU16(buf + len + 4, (u16)y);
        BrWire_WriteU16(buf + len + 6, species);
        buf[len + 8] = lvl;
        len += 9;
        count++;
    }
    buf[3] = count;
    buf[len++] = 0; // no bag: a route trainer's pockets are the game's, not ours
    BrWire_SendLarge(BR_MSG_SPILL, buf, len);
    ParseSpill(buf, len);

    // And the sprite goes away for everybody, not just here (POK-287). The spill has
    // always been broadcast and the despawn never was, so every other client saw the
    // Poke Balls lying on the ground with the trainer still standing next to them -- and
    // could walk up and fight the same one again. Kanto's rule is that beaten means gone.
    {
        u8 out[4];

        out[0] = gBrMySeat;
        out[1] = group;
        out[2] = num;
        out[3] = localId;
        BrWire_Send(BR_MSG_NPCOUT, out, 4);
    }
    RememberDespawned(group, num, localId);
    Despawn_Trainer(group, num, localId);
}

// A Pokemon let go of to make room lands at your feet (POK-294). See the header.
//
// Minted here rather than by the page, unlike an elimination: a release happens inside a
// script the page never sees, and the mon is gone from the party on the next line.
// BR_LOOT_KEY_FREED keeps the key clear of both other spaces, and the counter only has to
// be unique for one seat for one match -- a party of six, released one at a time, cannot
// come near wrapping a byte.
void BrLoot_ClaimKey(u16 key)
{
    u8 i;

    if (key == BR_HELD_NONE)
        return;
    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (gBrLoot.items[i].kind != BR_LOOT_NONE && gBrLoot.items[i].key == key)
        {
            SendPickup(&gBrLoot.items[i]);
            return;
        }
    }
}

void BrLoot_Released(struct Pokemon *mon)
{
    u8 buf[4 + 9 + 1];
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 usedX[BR_SPILL_CELLS], usedY[BR_SPILL_CELLS];
    u16 species = GetMonData(mon, MON_DATA_SPECIES, NULL);
    u16 len = 0;
    u8 cell = 0;
    s16 x, y;

    if (species == SPECIES_NONE)
        return;
    // Beside you, not under you. NextCell's first offset is the cell you are standing on
    // -- which is where Kanto's "at your feet" would put it -- and a ball there is taken
    // by the same A press that is already being held down, straight back into a party
    // that is still full, which asks you to release again. Starting one cell out keeps
    // the trace without the loop. If nothing within reach is free the mon stays in its
    // ball rather than falling into a wall.
    cell = 1;
    if (!NextCell(self->currentCoords.x, self->currentCoords.y, &cell, usedX, usedY, 0, &x, &y))
        return;

    buf[len++] = gBrMySeat;
    buf[len++] = gSaveBlock1Ptr->location.mapGroup;
    buf[len++] = gSaveBlock1Ptr->location.mapNum;
    buf[len++] = 1; // one mon, no bag
    BrWire_WriteU16(buf + len, BR_LOOT_KEY_RELEASED(gBrMySeat, gBrLoot.freed));
    BrWire_WriteU16(buf + len + 2, (u16)x);
    BrWire_WriteU16(buf + len + 4, (u16)y);
    BrWire_WriteU16(buf + len + 6, species);
    buf[len + 8] = GetMonData(mon, MON_DATA_LEVEL, NULL);
    len += 9;
    buf[len++] = 0;
    gBrLoot.freed++;
    // Out to the room first, then applied here, exactly as a beaten trainer's team is:
    // every ROM spawns the same ball on the same cell from the same message.
    BrWire_SendLarge(BR_MSG_SPILL, buf, len);
    ParseSpill(buf, len);
}

void BrLoot_Init(void)
{
    CpuFill32(0, &gBrLoot, sizeof(gBrLoot));
    CpuFill32(0, gBrDespawned, sizeof(gBrDespawned));
    sGivenBag.kind = BR_LOOT_NONE;
    sGiveBackLen = 0;
    sSpillAsm.buf = sSpillBuf;
    sSpillAsm.cap = sizeof(sSpillBuf);
    sSpillAsm.type = 0;
    BrNet_On(BR_MSG_SPILL, HandleSpill);
    BrNet_On(BR_MSG_SPILL | BR_MSG_CONT, HandleSpillCont);
    BrNet_On(BR_MSG_PICKUP, HandlePickup);
    BrNet_On(BR_MSG_GIVE, HandleGive);
    BrNet_On(BR_MSG_NPCOUT, HandleNpcOut);
}

void BrLoot_Tick(void)
{
    u8 i, count = 0, spawned = 0, ghosts, limit, keep;

    if (sGiveBackLen != 0)
        SendGiveBack(); // before TryTake below can put a PICKUP in front of it
    if (!BrField_OverworldRunning())
    {
        for (i = 0; i < BR_MAX_LOOT; i++)
            gBrLoot.items[i].objId = BR_NO_OBJ; // the object table is gone with the map
        gBrLoot.spawned = 0;
        DropHeldLine(); // a battle is not the place to still be naming a ball
        return;
    }
    BrField_ShareObjects(&ghosts, &limit);
    keep = BrLoot_Wanted() <= limit ? 0xFF : Keep(limit);
    // Out of view, off this map or past the share: let go first, so a nearer piece has
    // the slot this frame (POK-330 #48).
    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        struct BrLootItem *it = &gBrLoot.items[i];

        if (it->kind != BR_LOOT_NONE && !(InView(it) && (keep & (1 << i))))
            Despawn(it);
    }
    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        struct BrLootItem *it = &gBrLoot.items[i];

        if (it->kind == BR_LOOT_NONE)
            continue;
        count++;
        if (InView(it) && (keep & (1 << i)) && LootObject(it) == NULL)
            Spawn(it);
        if (it->objId != BR_NO_OBJ)
            spawned++;
    }
    gBrLoot.count = count;
    gBrLoot.spawned = spawned;
    DespawnForThisMap();
    HoldLineForReach();
    TryTake();
}
