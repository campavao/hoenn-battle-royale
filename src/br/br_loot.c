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
#include "br/br_ghosts.h"
#include "br/br_loot.h"

EWRAM_DATA struct BrLoot gBrLoot = {0};
// A full spill is six rows, a bag and its contents -- past one slot's 59 bytes.
static EWRAM_DATA u8 sSpillBuf[128] = {0};
static EWRAM_DATA struct BrAssembler sSpillAsm = {0};

static bool8 OverworldRunning(void)
{
    return gMain.callback2 == CB2_Overworld && !gMain.inBattle;
}

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

static void Add(u16 key, u8 mapGroup, u8 mapNum, s16 x, s16 y, u16 species, u8 level, u8 kind)
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
    it->objId = BR_NO_OBJ;
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

        Add(BrWire_ReadU16(row), mapGroup, mapNum, (s16)BrWire_ReadU16(row + 2),
            (s16)BrWire_ReadU16(row + 4), BrWire_ReadU16(row + 6), row[8], BR_LOOT_MON);
    }
    off = 4 + 9 * count;
    if (off < n && d[off] != 0 && (u16)(off + 7) <= n)
    {
        Add(BrWire_ReadU16(d + off + 1), mapGroup, mapNum, (s16)BrWire_ReadU16(d + off + 3),
            (s16)BrWire_ReadU16(d + off + 5), 0, 0, BR_LOOT_BAG);
    }
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

void BrLoot_Init(void)
{
    CpuFill32(0, &gBrLoot, sizeof(gBrLoot));
    sSpillAsm.buf = sSpillBuf;
    sSpillAsm.cap = sizeof(sSpillBuf);
    sSpillAsm.type = 0;
    BrNet_On(BR_MSG_SPILL, HandleSpill);
    BrNet_On(BR_MSG_SPILL | BR_MSG_CONT, HandleSpillCont);
    BrNet_On(BR_MSG_PICKUP, HandlePickup);
}

void BrLoot_Tick(void)
{
    u8 i, count = 0, spawned = 0;

    if (!OverworldRunning())
    {
        for (i = 0; i < BR_MAX_LOOT; i++)
            gBrLoot.items[i].objId = BR_NO_OBJ; // the object table is gone with the map
        gBrLoot.spawned = 0;
        return;
    }
    for (i = 0; i < BR_MAX_LOOT; i++)
    {
        struct BrLootItem *it = &gBrLoot.items[i];

        if (it->kind == BR_LOOT_NONE)
            continue;
        count++;
        if (!OnCurrentMap(it))
        {
            Despawn(it);
            continue;
        }
        if (LootObject(it) == NULL)
            Spawn(it);
        if (it->objId != BR_NO_OBJ)
            spawned++;
    }
    gBrLoot.count = count;
    gBrLoot.spawned = spawned;
}
