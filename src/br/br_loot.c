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
#include "event_data.h"
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
#include "party_menu.h"
#include "br/br_balls.h"
#include "br/br_patch.h"
#include "br/br_event.h"
#include "br/br_story.h"
#include "br/br_items.h"
#include "br/br_loot.h"
#include "br/br_legend.h"
#include "br/br_gym.h"
#include "br/br_field.h"
#include "br/br_match.h"
#include "br/br_moves.h"
#include "br/br_netlink.h"
#include "br/br_duel.h"
#include "task.h"
#include "window.h"
#include "menu.h"
#include "text_window.h"
#include "text.h"
#include "palette.h"

// The spoils box's frame: the HUD's own copy of the standard frame, in the palette
// nothing on the field loads over -- the peek box's (br_spectate.c).
#define BR_SPOILS_FRAME 0x214
#define BR_SPOILS_FRAME_PALETTE 13

EWRAM_DATA struct BrLoot gBrLoot = {0};
EWRAM_DATA struct BrDespawned gBrDespawned[BR_MAX_DESPAWN] = {0};
// A full spill is six rows, a bag and its contents -- past one slot's 59 bytes.
STATIC_ASSERT(BR_CAP_SPILL >= 4 + PARTY_SIZE * 9 + 1 + 6 + 1 + 8 * 3 + 4 + 1 + PLAYER_NAME_LENGTH, BrSpillCapHoldsAFullSpill)
static EWRAM_DATA u8 sSpillBuf[BR_CAP_SPILL] = {0};
static EWRAM_DATA struct BrAssembler sSpillAsm = {0};
// A trainer's key keeps its party index above an 11-bit id, and the Zone's balls, the
// chest, the house caches and whoever is home sit at 0x8F00, 0x8E00, 0x8D00 and 0x8C00 in
// the same space: party index 1, ids 0x700, 0x600, 0x500 and 0x400.
STATIC_ASSERT(TRAINERS_COUNT <= 0x400, BrTrainerLootKeysClearOfTheZoneChestAndHouses)
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

// Off the field -- a PICKUP or a SPILL heard in a battle -- the object is held, not
// removed under a battle sprite's feet (BrField_RemoveObject, POK-328).
static void Despawn(struct BrLootItem *it)
{
    struct ObjectEvent *obj = LootObject(it);

    if (obj != NULL)
        BrField_RemoveObject(obj->localId, obj->mapNum, obj->mapGroup);
    it->objId = BR_NO_OBJ;
}

// A bag with one thing in it and no money is that thing on the ground: a TM somebody's
// mon forgot (BrLoot_DropItem). It travels as a bag, so the page keeps it and hands it
// over like any other, and it is drawn and named as the ball it is.
static bool8 OneThing(const struct BrLootItem *it)
{
    return it->kind == BR_LOOT_BAG && it->species != ITEM_NONE;
}

// Who stands for a gift, by its key's low two bits (field-ghosts.ts draws the same).
static const u8 sGiftGfx[] = {
    OBJ_EVENT_GFX_OLD_MAN,
    OBJ_EVENT_GFX_OLD_WOMAN,
    OBJ_EVENT_GFX_EXPERT_M,
    OBJ_EVENT_GFX_POKEFAN_F,
};

static void Spawn(struct BrLootItem *it)
{
    // Birch's bag is the one bag-shaped object event Emerald has; a team is balls.
    u8 gfx = it->kind == BR_LOOT_BAG && !OneThing(it) ? OBJ_EVENT_GFX_BIRCHS_BAG : OBJ_EVENT_GFX_ITEM_BALL;
    u8 movement = MOVEMENT_TYPE_NONE;
    u8 person = BrStory_Person(it);
    u8 legend = BrLegend_Gfx(it);
    u8 id;

    if (BR_LOOT_IS_GIFT(it->key) || BR_LOOT_IS_HOME(it->key))
    {
        gfx = sGiftGfx[it->key % ARRAY_COUNT(sGiftGfx)];
        movement = MOVEMENT_TYPE_FACE_DOWN;
    }
    else if (person != 0)
    {
        gfx = person;
        movement = MOVEMENT_TYPE_FACE_DOWN;
    }
    else if (legend != 0)
    {
        gfx = legend; // stood there to be fought, not lying there to be taken (br_legend.h)
        movement = MOVEMENT_TYPE_FACE_DOWN;
    }
    id = SpawnSpecialObjectEventParameterized(gfx, movement, LocalId(it),
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

// A full table made room for nothing (2026-10-13 play-test: "I beat someone and they
// don't drop their stuff"). The eight rows outlive the map they were for -- a ball left
// behind on the last route keeps its row until somebody walks back -- so a fight on a
// new map could find every row taken by pieces nobody here can see, and its spill was
// thrown away. A row on another map goes first: the page holds the whole match's ground
// and hands that map's pieces back when we arrive on it (match/loot.ts). Then, on this
// map, the piece farthest from the view, as long as it is farther than the new one --
// what lands by you is what you came for.
//
// Never the DAY CARE chest, a Zone ball or a house's cache or person: every ROM deals
// those from the seed and the page never sends them, so a row of theirs let go is gone
// until somebody walks back in -- forever, for the first two.
static bool8 Resent(u16 key)
{
    return key != BR_LOOT_KEY_CHEST && (key & 0xFF00) != BR_LOOT_KEY_ZONE_ITEM(0)
        && (key & 0xFF00) != BR_LOOT_KEY_CACHE(0) && !BR_LOOT_IS_HOME(key);
}

static struct BrLootItem *Evict(u8 mapGroup, u8 mapNum, s16 x, s16 y)
{
    struct BrLootItem *far = NULL;
    u16 d, farD;
    u8 i;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (!OnCurrentMap(&gBrLoot.items[i]) && Resent(gBrLoot.items[i].key))
        {
            Drop(&gBrLoot.items[i]);
            return &gBrLoot.items[i];
        }
    }
    if (mapGroup != gSaveBlock1Ptr->location.mapGroup || mapNum != gSaveBlock1Ptr->location.mapNum)
        return NULL; // a piece for somewhere else never moves one we can see
    farD = BrField_ViewDistance(x, y);
    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (!Resent(gBrLoot.items[i].key))
            continue;
        d = BrField_ViewDistance(gBrLoot.items[i].x, gBrLoot.items[i].y);
        if (d > farD)
        {
            farD = d;
            far = &gBrLoot.items[i];
        }
    }
    if (far != NULL)
        Drop(far);
    return far;
}

static void Add(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 species, u8 level, u8 kind,
                u32 money)
{
    struct BrLootItem *it = Find(key);

    if (it == NULL)
        it = FreeSlot();
    if (it == NULL)
        it = Evict(mapGroup, mapNum, x, y);
    if (it == NULL)
        return; // eight nearer pieces here already; the page resends on the next map load
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
    it->noRoom = FALSE;
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
        BrEvent_NoteBack(BrWire_ReadU16(row)); // a legendary nobody caught is down again
    }
    off = 4 + 9 * count;
    if (off < n && d[off] != 0 && (u16)(off + 7) <= n)
    {
        u32 money = 0;
        u16 one = ITEM_NONE;
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
            {
                money = d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | ((u32)d[at + 3] << 24);
                // One stack of one, and nothing else: drawn as that item (OneThing).
                if (money == 0 && d[cash] == 1 && d[cash + 3] == 1)
                    one = BrWire_ReadU16(d + cash + 1);
            }
        }
        Add(BrWire_ReadU16(d + off + 1), mapGroup, mapNum, (s16)BrWire_ReadU16(d + off + 3),
            (s16)BrWire_ReadU16(d + off + 5), one, 0, BR_LOOT_BAG, money);
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
    u8 i;

    if (!BrWire_SendLarge(BR_MSG_SPILL, sGiveBack, sGiveBackLen))
        return FALSE;
    ParseSpill(sGiveBack, sGiveBackLen);
    // Only what our pockets could not hold is in it, so A here would only say NO ROOM
    // again: we walk over it (BrLoot_Solid). Anybody else's ROM finds it solid, and theirs.
    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (gBrLoot.items[i].kind == BR_LOOT_BAG && gBrLoot.items[i].key == BrWire_ReadU16(sGiveBack + 5))
            gBrLoot.items[i].noRoom = TRUE;
    }
    sGiveBackLen = 0;
    return TRUE;
}

static const u8 sText_NoRoom[] = _("No room for it");
static const u8 sText_NoRoomRest[] = _("No room for the rest");
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
    if (OneThing(&sGivenBag))
        BrHud_Box(sText_NoRoom); // it goes back down as it was
    else
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
static bool8 HomeClaimAnswered(u16 key, u8 seat);

static void HandlePickup(const u8 *payload, u8 len)
{
    const u8 *d;
    u8 n = BrWire_Unframe(payload, len, &d);
    struct BrLootItem *it;

    if (n < 8 || HomeClaimAnswered(BrWire_ReadU16(d + 1), d[0]))
        return;
    // A house's cache is gone for us too, though we are nowhere near it.
    BrBalls_NoteTaken(BrWire_ReadU16(d + 1));
    BrPatch_NoteTaken(BrWire_ReadU16(d + 1)); // ...and a patch somebody's battle started on
    BrEvent_NoteTaken(BrWire_ReadU16(d + 1), d[0]); // ...and an event's legendary, for its mark
    BrLegend_NoteTaken(BrWire_ReadU16(d + 1), d[0]); // ...and one we are fighting too
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
// page's match/loot.ts deals a bot's spill by the collision rule too (POK-330 #67). A
// cell that already has a piece on it is skipped, here and in the page's spillCells
// (POK-388): BrLoot_At answers with the first row on a cell, so a ball dropped on another
// was a ball nobody could see or take until the one on top was gone. Kanto scatters within two tiles. The cells go out in the message,
// so nobody reading it has to walk the ring again.
static const s8 sSpillDx[] = { 0, 1, -1, 0,  0, 1, -1,  1, -1, 2, -2,  0,  0 };
static const s8 sSpillDy[] = { 0, 0,  0, 1, -1, 1,  1, -1, -1, 0,  0,  2, -2 };
#define BR_SPILL_CELLS (sizeof(sSpillDx) / sizeof(sSpillDx[0]))

// A warp's own cell: a piece is solid now (BrLoot_Solid), and one on a doorstep or a
// cave mouth would stand in the way in. The page's spillCells skips them too.
static bool8 OnWarp(s16 x, s16 y)
{
    u8 i;

    for (i = 0; i < gMapHeader.events->warpCount; i++)
    {
        if (gMapHeader.events->warps[i].x + MAP_OFFSET == x && gMapHeader.events->warps[i].y + MAP_OFFSET == y)
            return TRUE;
    }
    return FALSE;
}

static bool8 CellFree(s16 x, s16 y, const s16 *usedX, const s16 *usedY, u8 used)
{
    u8 i;

    if (MapGridGetCollisionAt(x, y) != 0 || BrLoot_At(x, y) != NULL || OnWarp(x, y))
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

// A winner's spoils, round the winner: the diagonals before the cells beside them, so the
// balls are solid without boxing them in. Six fill the four corners and two sides, and
// leave the other two open. (One mon released or one TM forgotten goes beside you as it
// always has: one piece cannot box you in, and a full party walks over a ball anyway.)
// sSpillDx's index for each, in the order they are tried.
static const u8 sAround[] = { 5, 6, 7, 8, 1, 2, 3, 4, 9, 10, 11, 12 };

static bool8 NextCellAround(s16 ox, s16 oy, u8 *i, const s16 *usedX, const s16 *usedY, u8 used,
                            s16 *outX, s16 *outY)
{
    while (*i < ARRAY_COUNT(sAround))
    {
        s16 x = ox + sSpillDx[sAround[*i]];
        s16 y = oy + sSpillDy[sAround[*i]];

        (*i)++;
        if (CellFree(x, y, usedX, usedY, used))
        {
            *outX = x;
            *outY = y;
            return TRUE;
        }
    }
    return FALSE;
}

// BrLoot_TeamTaken's flag: the next SpillOwn leaves the team out.
static EWRAM_DATA bool8 sTeamTaken = FALSE;

void BrLoot_TeamTaken(bool8 taken)
{
    sTeamTaken = taken;
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
    // Beaten in a link fight, the team is the winner's to put down (BrLoot_WonFrom):
    // only the bag is ours to drop.
    for (i = 0; i < PARTY_SIZE && !sTeamTaken; i++)
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

static const u8 sText_Took[] = _("Took ");
static const u8 sText_Found[] = _("Found ");
static const u8 sText_Gift[] = _("A gift: ");
static const u8 sText_Bang[] = _("!");
static const u8 sText_NobodyLearns[] = _("All know ");
static const u8 sText_HaveTm[] = _("Already have ");
static const u8 sText_TradedAlready[] = _("He has already traded");

// A town's gift-giver says a line before he hands it over (Cam's 2026-10-14 play-test,
// POK-355: "I would like them to talk a little bit before they give you the gift"). One
// of these by the gift's key, then BR_EventScript_Gift's "received" with the fanfare.
static const u8 sText_GiftLine0[] = _("You look like you could use this.\nGo on, it's yours!");
static const u8 sText_GiftLine1[] = _("I won't be needing this anymore.\nPlease, take it!");
static const u8 sText_GiftLine2[] = _("That fog is coming, you know.\nHere, this might help.");
static const u8 sText_GiftLine3[] = _("A TRAINER should never go without\nsomething handy. Take this!");
static const u8 *const sGiftLines[] = {
    sText_GiftLine0,
    sText_GiftLine1,
    sText_GiftLine2,
    sText_GiftLine3,
};
// ...and somebody at home giving a Pokemon (POK-379).
static const u8 sText_HomeLine0[] = _("This one wants to see the world.\nWould you take it with you?");
static const u8 sText_HomeLine1[] = _("I'm too old for battles now.\nPlease, raise this one for me!");
static const u8 *const sHomeLines[] = {
    sText_HomeLine0,
    sText_HomeLine1,
};

extern const u8 BR_EventScript_Gift[];
extern const u8 BR_EventScript_HomeTrader[];

// The gift BR_EventScript_Gift is talking about, 0 for none: its hand-over is Take() again,
// from BrLoot_GiftTake, and this tells that Take() the line has been said. The trader
// BR_EventScript_HomeTrader is with, too, for BrLoot_HomeTrade.
static EWRAM_DATA u16 sGiftKey = 0;

// Tell the room it is gone, and take it off our own ground: nobody hears their own
// message come back. A full ring holds the PICKUP until there is room (Take() asks
// first): dropped, the room kept a piece on its ground that was in our bag.
#define BR_PICKUP_LEN 8
static void SendPickup(struct BrLootItem *it)
{
    u8 buf[BR_PICKUP_LEN];

    buf[0] = gBrMySeat;
    BrWire_WriteU16(buf + 1, it->key);
    buf[3] = 0; // no item named: the whole piece is leaving the ground
    buf[4] = 0;
    buf[5] = 0;
    buf[6] = 0;
    buf[7] = it->kind == BR_LOOT_BAG ? 1 : 0;
    BrWire_SendOrHold(BR_MSG_PICKUP, buf, BR_PICKUP_LEN);
    BrBalls_NoteTaken(it->key);
    BrEvent_NoteTaken(it->key, gBrMySeat);
    gBrLoot.taken++;
    Drop(it);
}

// Something that is not a row of ours left the ground here -- a patch of grass a battle
// started on (br_patch.c): the same PICKUP, so every ROM and page takes it the same way.
void BrLoot_SendTaken(u16 key)
{
    u8 buf[BR_PICKUP_LEN];

    buf[0] = gBrMySeat;
    BrWire_WriteU16(buf + 1, key);
    buf[3] = 0;
    buf[4] = 0;
    buf[5] = 0;
    buf[6] = 0;
    buf[7] = 0;
    BrWire_SendOrHold(BR_MSG_PICKUP, buf, BR_PICKUP_LEN);
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
// Below too, beside BrLoot_HomeTrade.
static void TalkTrade(struct BrLootItem *it);

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
    u16 item;
    u16 count;
    u8 *p;

    // Nothing leaves the ground without its PICKUP on the way: with the ring full and the
    // hold full too, the press does nothing and the piece is there for the next one.
    if (!BrWire_CanHold(BR_PICKUP_LEN))
        return;
    if (!BrStory_Hands(it))
        return; // STERN wants his SCANNER first, and has said so
    // A gift's key is only ever this press's while its script runs (BrLoot_GiftTake): one
    // a map load or a battle cut off mid-line would make the next press on that giver a
    // silent one, taken with no talk and no box.
    if (sGiftKey != 0 && !ScriptContext_IsEnabled())
        sGiftKey = 0;
    // A trader at home is never just taken: he asks first, and the swap is BrLoot_HomeTrade.
    if (BrBalls_Trades(it->key))
    {
        if (it->objId != BR_NO_OBJ)
        {
            DropHeldLine();
            TalkTrade(it);
        }
        return;
    }
    if (((BR_LOOT_IS_GIFT(it->key) && OneThing(it)) || BR_LOOT_IS_HOME(it->key))
        && sGiftKey != it->key && it->objId != BR_NO_OBJ)
    {
        // Talk first: he turns to us, says his line, and the script hands it over.
        sGiftKey = it->key;
        if (BR_LOOT_IS_HOME(it->key))
            StringCopy(gStringVar4, sHomeLines[it->key % ARRAY_COUNT(sHomeLines)]);
        else
            StringCopy(gStringVar4, sGiftLines[it->key % ARRAY_COUNT(sGiftLines)]);
        gSelectedObjectEvent = it->objId;
        gSpecialVar_LastTalked = gObjectEvents[it->objId].localId;
        ScriptContext_SetupScript(BR_EventScript_Gift);
        return;
    }
    // A TM nobody here can use, or a second copy, stays where it lies for somebody who can
    // (one each: the coordinator's default, 2026-10-14, Cam can overrule); one we take
    // goes straight to the teach screen (br_moves.h), below.
    if ((it->kind == BR_LOOT_ITEM || OneThing(it)) && BrMoves_IsTm(it->species))
    {
        if (CheckBagHasItem(it->species, 1) || !BrMoves_Teachable(it->species))
        {
            p = BrHud_Append(line, last, CheckBagHasItem(it->species, 1) ? sText_HaveTm : sText_NobodyLearns);
            BrHud_Append(p, last, gMoveNames[ItemIdToBattleMoveId(it->species)]);
            PlaySE(SE_FAILURE);
            BrHud_Box(line);
            return;
        }
    }
    DropHeldLine(); // it is about to say what was taken; the held name has done its job
    if (it->kind == BR_LOOT_BAG)
    {
        if (it->money != 0)
            AddMoney(&gSaveBlock1Ptr->money, it->money);
        if (OneThing(it) && sGiftKey == it->key)
        {
            // The script says it, "received" with the fanfare: no box over the message.
            StringCopy(gStringVar2, GetItemName(it->species));
        }
        else if (OneThing(it))
        {
            // What it is, not what it was worth: it arrives with the GIVE.
            p = BrHud_Append(line, last, BR_LOOT_IS_GIFT(it->key) || BrStory_Person(it) ? sText_Gift : sText_Found);
            p = BrHud_Append(p, last, GetItemName(it->species));
            BrHud_Append(p, last, sText_Bang);
            BrHud_Box(line);
        }
        else
        {
            SayBag(it->money, FALSE);
        }
        if (sGiftKey != it->key)
            PlaySE(SE_PIN);
        sGivenBag = *it; // where its GIVE puts back what does not fit
        if (OneThing(it) && BrMoves_IsTm(it->species))
            BrMoves_TeachSoon(it->species); // once its GIVE has bagged it; a bounced GIVE times out
        SendPickup(it);
        return;
    }
    if (it->kind == BR_LOOT_ITEM)
    {
        // A dealt item ball (POK-261). One press, like everything else on the ground --
        // unless its pocket is full, and then it stays where it lies for somebody with
        // room. The pickup used to go out first and AddBagItem's FALSE was never read, so
        // a full pocket threw the ball away for the whole room (POK-330 #55).
        // A vitamin or a sell item is used on the spot, a ball is six, a status heal a
        // FULL RESTORE (the item rework, br_items.h).
        item = it->species;
        count = 1;
        if (BrItems_Pickup(&item, &count, line) == BR_ITEMS_USED)
        {
            PlaySE(SE_PIN);
            BrHud_Box(line);
            SendPickup(it);
            return;
        }
        if (!CheckBagHasSpace(item, count))
        {
            PlaySE(SE_FAILURE);
            BrHud_Box(sText_NoRoom);
            return;
        }
        if (BrMoves_IsTm(item))
            BrMoves_TeachSoon(item);
        AddBagItem(item, count);
        p = BrHud_Append(line, last, sText_Found);
        if (count > 1)
        {
            p = ConvertIntToDecimalStringN(p, count, STR_CONV_MODE_LEFT_ALIGN, 2);
            *p++ = CHAR_SPACE;
            *p = EOS;
        }
        // "6 POKe BALLS", the way Std_FindItem's line says a pile.
        CopyItemNameHandlePlural(item, gStringVar2, count);
        p = BrHud_Append(p, last, gStringVar2);
        BrHud_Append(p, last, sText_Bang);
        PlaySE(SE_PIN);
        BrHud_Box(line);
        SendPickup(it);
        return;
    }
    // A legendary the match put down is fought, not taken: its cry and its battle, and
    // only a catch keeps it (br_legend.h).
    if (BrLegend_Gfx(it) != 0)
    {
        BrLegend_Challenge(it);
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
    BrLevels_Settle(&mon); // a ZUBAT taken at 50 is a CROBAT, and says so
    species = GetMonData(&mon, MON_DATA_SPECIES, NULL);
    if (sGiftKey == it->key)
    {
        // Somebody at home's, and the script says it with the fanfare.
        StringCopy(gStringVar2, gSpeciesNames[species]);
    }
    else
    {
        p = BrHud_Append(line, last, BrStory_Person(it) ? sText_Gift : sText_Took);
        p = BrHud_Append(p, last, gSpeciesNames[species]);
        BrHud_Append(p, last, sText_Bang);
        PlaySE(SE_PIN);
        BrHud_Box(line);
    }
    // The ball stays on the ground until the mon inside is really kept. Parking it and
    // taking it in the same breath meant cancelling the release screen destroyed both --
    // and nothing ever leaves the match (POK-294). BrCatch_Apply claims the key when a
    // slot is chosen; a cancel leaves the piece exactly where it was.
    if (!BrCatch_TryParkFrom(&mon, it->key))
    {
        GiveMonToPlayer(&mon);
        SendPickup(it);
    }
    else if (sGiftKey == it->key)
    {
        sGiftKey = BR_HELD_NONE; // not ours yet: the release screen asks first (GiftTake)
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
    if (OneThing(it))
        StringCopy(line, GetItemName(it->species));
    else if (it->kind == BR_LOOT_BAG)
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
//
// And the press is the piece's alone: Kanto's "A takes it", nothing more. BrFrame runs
// before the field reads its keys, and the field's own A went on past a ball's object
// (GetInteractedObjectEventScript has no script for it) to the tile's bg event, its
// metatile, the water: a ball on a hidden item took the item too, one spilled on the
// water beside the shore asked about SURF, and standing on one we still talked to
// whoever we faced (loot-press-alone.txt). So it is taken out of this frame's keys,
// whatever Take makes of it -- a full ring or a full pocket leaves the piece lying and
// the press spent. A ghost is not reached here: A goes past it, as a step does.
static void TryTake(void)
{
    struct BrLootItem *it;

    if (!JOY_NEW(A_BUTTON) || ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return;
    it = PieceInReach();
    if (it == NULL)
        return;
    gMain.newKeys &= ~A_BUTTON;
    gMain.newAndRepeatedKeys &= ~A_BUTTON;
    Take(it);
}

// Solid when A would take it (Cam, 2026-10-18: "let's make all items collidable. I hate
// walking thru things I can pick up or people I can talk to"). A person always is: he
// talks, whatever he then says. A ball or a bag is solid while it is yours for a press,
// so you face it and take it, and the press is what clears the way. One A cannot take --
// a TM you have or nobody here learns, a pocket with no room, a piece a gate's boss
// still guards, a ball for a full party -- is walked over as before: the drop deals
// balls onto any open cell, a cave's one-wide passage included, and a ball nobody can
// lift there would wall it off for good.
bool8 BrLoot_Solid(u8 localId)
{
    const struct BrLootItem *it;

    if (localId < BR_LOOT_LOCAL_ID_BASE || localId >= BR_LOOT_LOCAL_ID_BASE + BR_MAX_LOOT)
        return FALSE;
    it = &gBrLoot.items[localId - BR_LOOT_LOCAL_ID_BASE];
    if (it->kind == BR_LOOT_NONE)
        return FALSE;
    if (BR_LOOT_IS_GIFT(it->key) || BR_LOOT_IS_HOME(it->key) || BrStory_Person(it))
        return TRUE;
    // A room's cache sits where floors.py put it, never in the way (br_balls.c), so it
    // walls nothing off: solid whatever A would make of it. A TM you already carry was
    // walked through there (Cam's 10-19 play-test, #21: "I'm able to walk through this
    // Poke Ball").
    if ((it->key & 0xFF00) == BR_LOOT_KEY_CACHE(0))
        return TRUE;
    if (BrStory_Guarded(it))
        return FALSE;
    if ((it->kind == BR_LOOT_ITEM || OneThing(it)) && BrMoves_IsTm(it->species))
        return !CheckBagHasItem(it->species, 1) && BrMoves_Teachable(it->species);
    if (it->kind == BR_LOOT_ITEM || OneThing(it))
        return BrItems_Fits(it->species);
    // A bag's contents are the page's, so the ROM learns a full pocket only from the GIVE:
    // what came back is ours to walk over (SendGiveBack).
    if (it->noRoom)
        return FALSE;
    // A legendary is a battle, whatever the party holds (BrLegend_Challenge).
    if (BrLegend_Gfx(it) != 0)
        return TRUE;
    // A full party takes a ball only by giving one up, and the one given up lands beside
    // you too: walls round a winner who said B to the spoils.
    if (it->kind == BR_LOOT_MON)
        return CalculatePlayerPartyCount() < PARTY_SIZE;
    return TRUE;
}

bool8 BrLoot_TakeKey(u16 key)
{
    u8 i;

    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        if (gBrLoot.items[i].kind != BR_LOOT_NONE && gBrLoot.items[i].key == key && OnCurrentMap(&gBrLoot.items[i]))
        {
            Take(&gBrLoot.items[i]);
            return TRUE;
        }
    }
    return FALSE;
}

// BR_EventScript_Gift, his line said: hand it over. VAR_RESULT FALSE when it is gone
// already (somebody else's A got there while he talked), and the script says nothing more.
void BrLoot_GiftTake(void)
{
    u16 key = sGiftKey;
    bool8 mon = key != 0 && BR_LOOT_IS_HOME(key);

    gSpecialVar_Result = key != 0 && BrWire_CanHold(BR_PICKUP_LEN) && BrLoot_TakeKey(key);
    // A full party parks it, and the release screen comes once the script is done: no
    // "received" for one that a cancel there leaves with him.
    if (gSpecialVar_Result && sGiftKey == BR_HELD_NONE)
        gSpecialVar_Result = 3;
    else if (!gSpecialVar_Result)
        PlaySE(SE_FAILURE);
    else if (mon)
        gSpecialVar_Result = 2;
    sGiftKey = 0;
}

// His Pokemon as it would come to us now: the rung settles it, so a TREECKO offered at 40
// is the SCEPTILE we would get, and he says so.
static void HomeOffered(struct Pokemon *mon, u16 species)
{
    CreateMon(mon, species, BrLevels_WildLevel(), USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0);
    BrLevels_Settle(mon);
}

// A on somebody at home who trades: he turns to us and names what he has. The event
// trader's question (br_event.c), and BrLoot_HomeTrade is the answer.
static void TalkTrade(struct BrLootItem *it)
{
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    struct Pokemon mon;

    sGiftKey = it->key;
    ObjectEventTurn(&gObjectEvents[it->objId], GetOppositeDirection(self->facingDirection));
    HomeOffered(&mon, it->species);
    StringCopy(gStringVar1, gSpeciesNames[GetMonData(&mon, MON_DATA_SPECIES, NULL)]);
    ScriptContext_SetupScript(BR_EventScript_HomeTrader);
}

void BrLoot_HomeTrade(void)
{
    struct BrLootItem *it = sGiftKey != 0 ? Find(sGiftKey) : NULL;
    u16 slot = gSpecialVar_0x8004;
    struct Pokemon mon;

    sGiftKey = 0;
    if (slot >= PARTY_SIZE || GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES, NULL) == SPECIES_NONE)
        return; // nobody chosen
    // Somebody else got to him while we were choosing.
    if (it == NULL || !OnCurrentMap(it))
    {
        PlaySE(SE_FAILURE);
        BrHud_Box(sText_TradedAlready);
        return;
    }
    // The ring has no room to tell the room he traded: nothing happens, as a full ring's
    // press on a ball does (Take).
    if (!BrWire_CanHold(BR_PICKUP_LEN))
    {
        PlaySE(SE_FAILURE);
        return;
    }
    // A trade, so one that evolves on the way over does (TradedInto).
    HomeOffered(&mon, TradedInto(it->species));
    if (BrEvent_Swap(slot, &mon))
        SendPickup(it);
}

// One Pokemon a house (POK-379, the event trader's POK-392). Two trainers at him at once
// both found him standing and were both given his Pokemon, so we ask first: our PICKUP of
// his claim key goes to the host, whose page answers the first ask with the PICKUP of his
// own key naming the asker, and a later one with that PICKUP naming whoever got him. That
// one takes his row (HandlePickup), and the script's GiftTake or HomeTrade says he has
// gone; ours lets the script go on to them with his row still standing, and they send his
// key as ever. The wait is a task's, its data his key; no host in BR_CLAIM_FRAMES (a
// driver with no page behind it) goes ahead the old way.
#define tKey     data[0]
#define tTimer   data[1]
#define tGranted data[2]

static void Task_HomeClaim(u8 taskId)
{
    s16 *data = gTasks[taskId].data;

    if (!tGranted && Find(tKey) != NULL && ++tTimer < BR_CLAIM_FRAMES)
        return;
    DestroyTask(taskId);
    ScriptContext_Enable();
}

void BrLoot_HomeClaim(void)
{
    struct BrLootItem *it = sGiftKey != 0 && BR_LOOT_IS_HOME(sGiftKey) ? Find(sGiftKey) : NULL;
    u16 slot = gSpecialVar_0x8004;
    u8 taskId;
    s16 *data;

    gSpecialVar_Result = FALSE;
    if (it == NULL || !OnCurrentMap(it) || !BrWire_CanHold(BR_PICKUP_LEN))
        return;
    // Asked only for a trade HomeTrade will make: a cancel or a fainted one never uses him up.
    if (BrBalls_Trades(it->key)
        && (slot >= PARTY_SIZE || GetMonData(&gPlayerParty[slot], MON_DATA_SPECIES, NULL) == SPECIES_NONE
            || GetMonData(&gPlayerParty[slot], MON_DATA_HP, NULL) == 0))
        return;
    taskId = CreateTask(Task_HomeClaim, 80);
    if (taskId == TASK_NONE)
        return;
    data = gTasks[taskId].data;
    tKey = it->key;
    tTimer = 0;
    tGranted = FALSE;
    BrLoot_SendTaken(BR_LOOT_KEY_HOME_CLAIM(it->key - BR_LOOT_KEY_HOME(0)));
    gSpecialVar_Result = TRUE;
}

// The host's PICKUP of his key naming us, while we wait on him: ours. His row stays for
// GiftTake or HomeTrade, and he is not taken for the house either (a full party's cancel
// leaves him to us, and the host answers our next ask the same way).
static bool8 HomeClaimAnswered(u16 key, u8 seat)
{
    u8 taskId = FindTaskIdByFunc(Task_HomeClaim);

    if (taskId == TASK_NONE || seat != gBrMySeat || (u16)gTasks[taskId].tKey != key)
        return FALSE;
    gTasks[taskId].tGranted = TRUE;
    return TRUE;
}

#undef tKey
#undef tTimer
#undef tGranted

// ---- Hoenn's own trainers -------------------------------------------------------

// Take the sprite off the map now, and keep taking it off every time the map comes
// back. Emerald only remembers that a beaten trainer will not fight again; Kanto's
// rule is that they are gone.
//
// "Now" is the field's now (POK-328): an NPCOUT heard in a battle -- the fog's sweep of
// the map we are fighting on, or a peer who beat somebody on it -- holds the trainer in
// the object table until the field is back, rather than destroying a battle sprite by
// the trainer's old sprite number. Held, the one we are fighting is still there when the
// battle ends, so BrLoot_TrainerBeaten still finds where to drop their team.
static void Despawn_Trainer(u8 mapGroup, u8 mapNum, u8 localId)
{
    if (BrField_RemoveObject(localId, mapNum, mapGroup))
        gBrLoot.gone++;
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
    BrGym_NoteOut(d[1], d[2], d[3]);
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
    if (BrStory_IsGate(trainerId))
        return; // the object is the story's piece, and the story's reward is his drop
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
        BrWire_SendOrHold(BR_MSG_NPCOUT, out, 4);
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

// One item down beside us, for anybody: a TM a mon of ours just forgot (BrMoves_Forgetting).
// A bag of one, with no money and no name, so it goes everywhere a bag goes -- the page
// keeps it for whoever walks in later and hands it over when somebody takes it -- and
// every ROM draws it as the ball it is (OneThing). Beside us for the reason a released mon
// is: the A press that taught the move is still down. With nowhere free in reach it is
// dropped where we stand rather than lost: nothing leaves a match.
void BrLoot_DropItem(u16 item)
{
    u8 buf[4 + 1 + 6 + 1 + 3 + 4 + 1];
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    s16 usedX[BR_SPILL_CELLS], usedY[BR_SPILL_CELLS];
    u8 len = 0, cell = 1;
    s16 x, y;

    if (item == ITEM_NONE)
        return;
    if (!NextCell(self->currentCoords.x, self->currentCoords.y, &cell, usedX, usedY, 0, &x, &y))
    {
        x = self->currentCoords.x;
        y = self->currentCoords.y;
    }
    buf[len++] = gBrMySeat;
    buf[len++] = gSaveBlock1Ptr->location.mapGroup;
    buf[len++] = gSaveBlock1Ptr->location.mapNum;
    buf[len++] = 0; // no mons
    buf[len++] = 1; // a bag
    // The released-mon space and its counter (POK-294): minted here, ours alone.
    BrWire_WriteU16(buf + len, BR_LOOT_KEY_RELEASED(gBrMySeat, gBrLoot.freed));
    BrWire_WriteU16(buf + len + 2, (u16)x);
    BrWire_WriteU16(buf + len + 4, (u16)y);
    len += 6;
    gBrLoot.freed++;
    buf[len++] = 1; // one stack
    BrWire_WriteU16(buf + len, item);
    buf[len + 2] = 1;
    len += 3;
    buf[len++] = 0; // no money
    buf[len++] = 0;
    buf[len++] = 0;
    buf[len++] = 0;
    buf[len++] = 0; // no name
    BrWire_SendLarge(BR_MSG_SPILL, buf, len);
    ParseSpill(buf, len);
}

u16 BrLoot_ItemFor(u8 localId)
{
    const struct BrLootItem *it;

    if (localId < BR_LOOT_LOCAL_ID_BASE || localId >= BR_LOOT_LOCAL_ID_BASE + BR_MAX_LOOT)
        return ITEM_NONE;
    it = &gBrLoot.items[localId - BR_LOOT_LOCAL_ID_BASE];
    if (it->kind == BR_LOOT_ITEM || OneThing(it))
        return it->species;
    return ITEM_NONE;
}

// ---- the spoils -----------------------------------------------------------------
//
// 2026-10-13 play-test: "still often that I beat someone and they don't drop their stuff.
// Maybe it's dropping somewhere else? Ideally you should get a menu to select what you
// want to take and the rest drops around you." The loser's ROM dropped its team where IT
// stood, and its idea of where that was, and the winner's, and the host's for a bot, were
// three different things; a full table on the winner's side dropped the spill outright.
//
// So the winner drops the team, from the party the fight just showed it, on the cells
// round its own feet, and asks which one to take. B leaves them all lying there for
// anybody. The loser's ROM drops only its bag (BrLoot_TeamTaken), and so does the host
// page for a bot a ROM beat (bots/brain.ts). The keys are the loser's own,
// BR_LOOT_KEY_OWN(loser, i) -- the ones its ROM or its host would have minted -- so a
// stray second spill of the same team lands on these rows rather than beside them.
#define BR_SPOILS_NONE 0
#define BR_SPOILS_DROP 1 // won: the team still to put down
#define BR_SPOILS_ASK 2  // down: the menu still to open
// Long enough to read six names; short enough that a menu nobody answers is not a place
// to stand still in a shrinking ring.
#define BR_SPOILS_FRAMES (15 * 60)
// Presses the box ignores once it is up (Task_Spoils).
#define BR_SPOILS_DEAF_FRAMES 20

static EWRAM_DATA u8 sSpoilsState = BR_SPOILS_NONE;
static EWRAM_DATA u8 sSpoilsSeat = 0;
static EWRAM_DATA u8 sSpoilsCount = 0;
static EWRAM_DATA u8 sSpoilsLevel[PARTY_SIZE] = {0};
static EWRAM_DATA u16 sSpoilsSpecies[PARTY_SIZE] = {0};

void BrLoot_WonFrom(u8 seat)
{
    u16 species;
    u8 i;

    sSpoilsState = BR_SPOILS_NONE;
    sSpoilsCount = 0;
    // The proxy instance fights two bots for the host; their spoils are the host's.
    if (BrDuel_IsProxy() || seat >= BR_MAX_SEATS)
        return;
    for (i = 0; i < PARTY_SIZE; i++)
    {
        species = GetMonData(&gEnemyParty[i], MON_DATA_SPECIES, NULL);
        if (species == SPECIES_NONE || species >= NUM_SPECIES)
            break;
        sSpoilsSpecies[i] = species;
        sSpoilsLevel[i] = GetMonData(&gEnemyParty[i], MON_DATA_LEVEL, NULL);
    }
    sSpoilsCount = i;
    sSpoilsSeat = seat;
    if (i != 0)
        sSpoilsState = BR_SPOILS_DROP;
}

// Round our own feet, one cell out (BrLoot_Released's reason: a ball under us is taken
// by an A that was meant for something else), and never on the loser's own cell, where
// their bag is about to land.
static void DropSpoils(void)
{
    u8 buf[4 + PARTY_SIZE * 9 + 1];
    s16 usedX[BR_SPILL_CELLS], usedY[BR_SPILL_CELLS];
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    const struct BrSeat *loser = &gBrSeats[sSpoilsSeat];
    u16 len = 0;
    u8 count = 0, used = 0, cell = 0, i;
    s16 x, y;

    if (loser->mapGroup == gSaveBlock1Ptr->location.mapGroup
     && loser->mapNum == gSaveBlock1Ptr->location.mapNum)
    {
        usedX[0] = loser->x;
        usedY[0] = loser->y;
        used = 1;
    }
    buf[len++] = gBrMySeat; // who is saying so: the relay only takes a spill as our own
    buf[len++] = gSaveBlock1Ptr->location.mapGroup;
    buf[len++] = gSaveBlock1Ptr->location.mapNum;
    len++; // count, below
    for (i = 0; i < sSpoilsCount; i++)
    {
        if (!NextCellAround(self->currentCoords.x, self->currentCoords.y, &cell, usedX, usedY, used, &x, &y))
            break; // boxed in: the rest stay in their balls, as a spill of our own would
        usedX[used] = x;
        usedY[used] = y;
        used++;
        BrWire_WriteU16(buf + len, BR_LOOT_KEY_OWN(sSpoilsSeat, i));
        BrWire_WriteU16(buf + len + 2, (u16)x);
        BrWire_WriteU16(buf + len + 4, (u16)y);
        BrWire_WriteU16(buf + len + 6, sSpoilsSpecies[i]);
        buf[len + 8] = sSpoilsLevel[i];
        len += 9;
        count++;
    }
    buf[3] = count;
    buf[len++] = 0; // no bag: that is the loser's to drop
    if (!BrWire_SendLarge(BR_MSG_SPILL, buf, len))
        return; // the ring is full: the next frame tries again
    ParseSpill(buf, len);
    sSpoilsCount = count;
    sSpoilsState = count != 0 ? BR_SPOILS_ASK : BR_SPOILS_NONE;
}

#define tWin data[0]
#define tTimer data[1]
#define tKey(i) data[2 + (i)]

static const u8 sText_TakeOne[] = _("Take one");

static void CloseSpoils(u8 taskId)
{
    s16 *data = gTasks[taskId].data;

    // Gone with the field: its teardown freed the window, and the id may be the next
    // screen's by now -- removing it would take that one's window (and BG0's map).
    if (!BrField_OverworldRunning())
    {
        DestroyTask(taskId);
        return;
    }
    ClearStdWindowAndFrameToTransparent(tWin, TRUE);
    RemoveWindow(tWin);
    DestroyTask(taskId);
    // A script or a warp that started under the box took the same lock, and lets go of
    // it itself when it is done: letting go here would free the trainer in the middle.
    if (!ScriptContext_IsEnabled() && !BrField_Leaving())
        UnlockPlayerFieldControls();
}

static void Task_Spoils(u8 taskId)
{
    s16 *data = gTasks[taskId].data;
    struct BrLootItem *it;
    s8 pick;
    u16 key;

    // A challenge is not something a menu holds off (POK-230), nor is the parade, the
    // ring does not wait, and the field going away takes the window with it.
    if (!BrField_OverworldRunning() || gBrMatch.phase != BR_PHASE_PLAY || BrMatch_WinPending()
     || gBrNetlink.pendingPeer != 0xFF || ScriptContext_IsEnabled() || BrField_Leaving()
     || ++tTimer > BR_SPOILS_FRAMES)
    {
        CloseSpoils(taskId);
        return;
    }
    // The box opens the moment the field is back, under thumbs still mashing A (or B)
    // through "defeated" and the prize: a press that was meant for the text would take
    // the first ball, or leave them all, unread. A third of a second to see it first.
    if (tTimer < BR_SPOILS_DEAF_FRAMES)
        return;
    pick = Menu_ProcessInputNoWrap();
    if (pick == MENU_NOTHING_CHOSEN)
        return;
    key = pick == MENU_B_PRESSED ? BR_HELD_NONE : (u16)tKey(pick);
    CloseSpoils(taskId);
    if (key == BR_HELD_NONE)
        return;
    // Somebody else's A, or a full table on our side, can have got there first.
    it = Find(key);
    // ...and a full out ring leaves Take() nothing to do: it says so, where a press on
    // the field would simply be pressed again.
    if (it == NULL || !BrWire_CanHold(BR_PICKUP_LEN))
    {
        PlaySE(SE_FAILURE);
        return;
    }
    Take(it); // the press, with everything it asks: a full party's release included
}

// Whatever of ours is still on the ground, in party order, in a box on the left: a name
// a line, the way the field's own multichoice lists them. No levels: the rung is the same
// for everybody, and the box stays narrow enough to clear the HUD's corner.
static void AskSpoils(void)
{
    struct WindowTemplate t = { 0, 1, 2, 11, 2, 15, 0x008 };
    struct BrLootItem *it;
    s16 *data;
    u8 taskId, n = 0, i;
    u16 keys[PARTY_SIZE];

    if (!BrField_OverworldRunning() || ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked()
     || BrField_Leaving() || gBrNetlink.pendingPeer != 0xFF)
        return; // not yet: a fade, a script, a challenge on the way
    sSpoilsState = BR_SPOILS_NONE;
    if (gBrMatch.phase != BR_PHASE_PLAY || BrMatch_WinPending())
        return; // they lie there; we are out, or that was the last fight
    for (i = 0; i < sSpoilsCount; i++)
    {
        it = Find(BR_LOOT_KEY_OWN(sSpoilsSeat, i));
        if (it != NULL && it->kind == BR_LOOT_MON)
            keys[n++] = it->key;
    }
    if (n == 0)
        return;
    t.height = 2 + 2 * n;
    taskId = CreateTask(Task_Spoils, 80);
    data = gTasks[taskId].data;
    tWin = AddWindow(&t);
    if (tWin == WINDOW_NONE)
    {
        DestroyTask(taskId);
        return;
    }
    tTimer = 0;
    LockPlayerFieldControls();
    LoadUserWindowBorderGfxOnBg(0, BR_SPOILS_FRAME, BG_PLTT_ID(BR_SPOILS_FRAME_PALETTE));
    DrawStdFrameWithCustomTileAndPalette(tWin, FALSE, BR_SPOILS_FRAME, BR_SPOILS_FRAME_PALETTE);
    FillWindowPixelBuffer(tWin, PIXEL_FILL(TEXT_COLOR_WHITE));
    AddTextPrinterParameterized(tWin, FONT_NORMAL, sText_TakeOne, 0, 1, TEXT_SKIP_DRAW, NULL);
    for (i = 0; i < n; i++)
    {
        tKey(i) = (s16)keys[i];
        AddTextPrinterParameterized(tWin, FONT_NORMAL, gSpeciesNames[Find(keys[i])->species], 8,
                                    17 + 16 * i, TEXT_SKIP_DRAW, NULL);
    }
    InitMenuNormal(tWin, FONT_NORMAL, 0, 17, 16, n, 0);
    CopyWindowToVram(tWin, COPYWIN_FULL);
}

#undef tWin
#undef tTimer
#undef tKey

static void TickSpoils(void)
{
    if (sSpoilsState == BR_SPOILS_NONE || !BrField_OverworldRunning())
        return;
    if (sSpoilsState == BR_SPOILS_DROP)
        DropSpoils();
    else
        AskSpoils();
}

void BrLoot_Init(void)
{
    u8 i;

    CpuFill32(0, &gBrLoot, sizeof(gBrLoot));
    // Nothing is spawned. The off-field tick used to say so on the first frame of the
    // boot; it keeps the ids now, so the zeros would name slot 0 until a row was used.
    for (i = 0; i < BR_MAX_LOOT; i++)
        gBrLoot.items[i].objId = BR_NO_OBJ;
    CpuFill32(0, gBrDespawned, sizeof(gBrDespawned));
    BrGym_Init();
    sGivenBag.kind = BR_LOOT_NONE;
    sGiveBackLen = 0;
    sSpoilsState = BR_SPOILS_NONE;
    sTeamTaken = FALSE;
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
        // The objects are kept track of. A map load does take the table with it, and
        // LootObject's local-id check lets go of those; a battle does not, and forgetting
        // them there left every piece in view drawn by an object nothing owned -- one
        // Spawn could not replace (the local id was taken) and a pickup could not remove.
        gBrLoot.spawned = 0;
        DropHeldLine(); // a battle is not the place to still be naming a ball
        return;
    }
    BrBalls_Tick(); // this house's cache, if we just walked into one
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
    TickSpoils();
    HoldLineForReach();
    TryTake();
}
