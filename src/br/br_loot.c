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
#include "constants/pokemon.h"
#include "br/br_catch.h"
#include "br/br_spectate.h"
#include "br/br_hud.h"
#include "field_player_avatar.h"
#include "constants/species.h"
#include "constants/characters.h"
#include "br/br_ghosts.h"
#include "item.h"
#include "br/br_loot.h"

EWRAM_DATA struct BrLoot gBrLoot = {0};
EWRAM_DATA struct BrDespawned gBrDespawned[BR_MAX_DESPAWN] = {0};
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
            (s16)BrWire_ReadU16(row + 4), BrWire_ReadU16(row + 6), row[8], BR_LOOT_MON, 0);
    }
    off = 4 + 9 * count;
    if (off < n && d[off] != 0 && (u16)(off + 7) <= n)
    {
        u32 money = 0;
        u16 cash = off + 8; // past the bag's key and cell, over its item count

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
// skipping anything impassable or already holding loot. Kanto scatters within two
// tiles; this walks out in the same order every time, which is what keeps a spill
// deterministic for everyone reading the message.
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
        key = (u16)((gBrMySeat << 8) | count);
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
        BrWire_WriteU16(buf + len, (u16)((gBrMySeat << 8) | 0xFF));
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
static const u8 sText_NoRoom[] = _("NO ROOM FOR IT");
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

// Whose ball it was. A player's key carries their seat in the high byte; a beaten
// Hoenn trainer's has the top bit set and belongs to nobody.
static bool8 WasOurs(u16 key)
{
    return (key & 0x8000) == 0 && (u8)(key >> 8) == gBrMySeat;
}

static void Take(struct BrLootItem *it)
{
    u8 line[BR_HUD_LINE_MAX + 2];
    struct Pokemon mon;
    u16 species;
    u8 *p;

    if (it->kind == BR_LOOT_BAG)
    {
        if (it->money != 0)
            AddMoney(&gSaveBlock1Ptr->money, it->money);
        p = StringCopy(line, sText_Found);
        p = ConvertIntToDecimalStringN(p, it->money, STR_CONV_MODE_LEFT_ALIGN, 7);
        StringCopy(p, sText_Bang);
        PlaySE(SE_PIN);
        BrHud_Box(line);
        SendPickup(it);
        return;
    }
    if (it->kind == BR_LOOT_ITEM)
    {
        // A dealt item ball (POK-261). One press, like everything else on the ground.
        p = StringCopy(line, sText_Found);
        p = StringCopy(p, GetItemName(it->species));
        StringCopy(p, sText_Bang);
        PlaySE(SE_PIN);
        BrHud_Box(line);
        SendPickup(it);
        AddBagItem(it->species, 1);
        return;
    }
    // A ball: the mon inside goes to the party, evolving on the way if it just changed
    // hands. A full party goes through the catch ticket's own release flow -- the same
    // question, asked once, in one place (POK-227).
    species = WasOurs(it->key) ? it->species : TradedInto(it->species);
    CreateMon(&mon, species, it->level, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0);
    p = StringCopy(line, sText_Took);
    p = StringCopy(p, gSpeciesNames[species]);
    StringCopy(p, sText_Bang);
    PlaySE(SE_PIN);
    BrHud_Box(line);
    SendPickup(it);
    // Off the ground either way: parked, the release script asks who gives way next
    // frame, and cancelling there loses it -- which is the rule a catch already plays by.
    if (!BrCatch_TryPark(&mon))
        GiveMonToPlayer(&mon);
    BrSpectate_SendParty();
}

// A on the cell we stand on or the one we face. The loot has no script of its own --
// it is spawned, not placed by a map -- so the A-press is read here rather than
// through the field's own interaction path.
static void TryTake(void)
{
    struct ObjectEvent *self = &gObjectEvents[gPlayerAvatar.objectEventId];
    struct BrLootItem *it;
    s16 x, y;

    if (!JOY_NEW(A_BUTTON) || ScriptContext_IsEnabled() || ArePlayerFieldControlsLocked())
        return;
    it = BrLoot_At(self->currentCoords.x, self->currentCoords.y);
    if (it == NULL)
    {
        x = self->currentCoords.x + (s16)gDirectionToVectors[self->facingDirection].x;
        y = self->currentCoords.y + (s16)gDirectionToVectors[self->facingDirection].y;
        it = BrLoot_At(x, y);
    }
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
    // Full: the oldest one comes back. Sixteen beaten trainers on one match's worth of
    // maps is already more than Kanto sees, and the alternative is EWRAM we do not have.
}

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
}

void BrLoot_TrainerBeaten(u16 trainerId, u8 localId)
{
    u8 buf[16];
    u8 group = gSaveBlock1Ptr->location.mapGroup;
    u8 num = gSaveBlock1Ptr->location.mapNum;
    u8 id = GetObjectEventIdByLocalIdAndMap(localId, num, group);
    const struct TrainerMonNoItemDefaultMoves *mon;
    u16 len = 0, key;
    s16 x, y;

    if (localId == 0 || id >= OBJECT_EVENTS_COUNT)
        return;
    if (gTrainers[trainerId].partySize == 0)
        return;
    x = gObjectEvents[id].currentCoords.x;
    y = gObjectEvents[id].currentCoords.y;
    // Every party shape starts with the same three fields, so the plainest one reads
    // the first mon of any of them.
    mon = gTrainers[trainerId].party.NoItemDefaultMoves;
    // A trainer id is unique for the game, so it is the key: they are beaten once.
    key = (u16)(0x8000 | trainerId);

    buf[len++] = gBrMySeat; // the beater speaks for it; an NPC has no seat of its own
    buf[len++] = group;
    buf[len++] = num;
    buf[len++] = 1;
    BrWire_WriteU16(buf + len, key);
    BrWire_WriteU16(buf + len + 2, (u16)x);
    BrWire_WriteU16(buf + len + 4, (u16)y);
    BrWire_WriteU16(buf + len + 6, mon->species);
    buf[len + 8] = mon->lvl;
    len += 9;
    buf[len++] = 0; // no bag: a route trainer's pockets are the game's, not ours
    BrWire_SendLarge(BR_MSG_SPILL, buf, len);
    ParseSpill(buf, len);

    RememberDespawned(group, num, localId);
    Despawn_Trainer(group, num, localId);
}

void BrLoot_Init(void)
{
    CpuFill32(0, &gBrLoot, sizeof(gBrLoot));
    CpuFill32(0, gBrDespawned, sizeof(gBrDespawned));
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
    DespawnForThisMap();
    TryTake();
}
