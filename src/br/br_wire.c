// Slot framing helpers (POK-217). See include/br/br_wire_c.h.
#include "global.h"
#include "constants/map_groups.h"
#include "constants/moves.h"
#include "constants/pokemon.h"
#include "constants/species.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"
#include "br/br_rom_limits.h"
#include "br/br_version.h"

// The wire table is part of the protocol (POK-331 #21): a new shape needs a new
// BR_PROTOCOL, and its hash pinned beside it in br_version.h.
STATIC_ASSERT(BR_WIRE_HASH == BR_PROTOCOL_WIRE_HASH, BumpBrProtocolForANewWireTable)

// How many maps each group has. Nothing else in C knows: gMapGroups is an array of
// pointer arrays with no counts beside them.
static const u8 sMapGroupSizes[] = BR_MAP_GROUP_SIZES;
STATIC_ASSERT(ARRAY_COUNT(sMapGroupSizes) == MAP_GROUPS_COUNT, BrMapGroupSizesCoverEveryGroup)

u16 BrWire_ReadU16(const u8 *p)
{
    return (u16)(p[0] | (p[1] << 8));
}

void BrWire_WriteU16(u8 *p, u16 v)
{
    p[0] = v & 0xFF;
    p[1] = v >> 8;
}

bool8 BrWire_Send(u8 type, const u8 *data, u8 len)
{
    u8 buf[BR_SLOT_PAYLOAD_MAX];
    u8 i;

    if (len > BR_FRAME_DATA_MAX)
        return FALSE;
    BrWire_WriteU16(buf, len);
    buf[2] = 0;
    for (i = 0; i < len; i++)
        buf[BR_FRAME_HDR + i] = data[i];
    return BrMailbox_Push(type, buf, BR_FRAME_HDR + len);
}

bool8 BrWire_SendLarge(u8 type, const u8 *data, u16 len)
{
    u8 buf[BR_SLOT_PAYLOAD_MAX];
    u16 sent = 0, slots = 1, i;
    u8 seq = 1;

    if (len > BR_FRAME_DATA_MAX)
        slots += (len - BR_FRAME_DATA_MAX + (BR_SLOT_PAYLOAD_MAX - 1) - 1) / (BR_SLOT_PAYLOAD_MAX - 1);
    if ((u16)(gBrMailbox.outHead - gBrMailbox.outTail) + slots > BR_RING_SLOTS)
        return FALSE;
    // First slot.
    BrWire_WriteU16(buf, len);
    buf[2] = 0;
    for (i = 0; i < BR_FRAME_DATA_MAX && sent < len; i++, sent++)
        buf[BR_FRAME_HDR + i] = data[sent];
    BrMailbox_Push(type, buf, BR_FRAME_HDR + i);
    // Continuations: seq, then data.
    while (sent < len)
    {
        buf[0] = seq++;
        for (i = 0; i < BR_SLOT_PAYLOAD_MAX - 1 && sent < len; i++, sent++)
            buf[1 + i] = data[sent];
        BrMailbox_Push(type | BR_MSG_CONT, buf, 1 + i);
    }
    return TRUE;
}

bool8 BrWire_Assemble(struct BrAssembler *as, u8 baseType, bool8 isCont, const u8 *payload, u8 len)
{
    u16 i, n;
    const u8 *src;

    if (!isCont && len >= BR_FRAME_HDR && payload[2] == 0)
    {
        // First slot: totalLen, seq 0, data.
        as->total = BrWire_ReadU16(payload);
        if (as->total > as->cap)
        {
            as->type = 0;
            return FALSE;
        }
        as->type = baseType;
        as->got = 0;
        as->nextSeq = 1;
        src = payload + BR_FRAME_HDR;
        n = len - BR_FRAME_HDR;
    }
    else if (isCont && as->type == baseType && len >= 1 && payload[0] == as->nextSeq)
    {
        // Continuation: seq, data.
        as->nextSeq++;
        src = payload + 1;
        n = len - 1;
    }
    else
    {
        as->type = 0; // gap, stray continuation, or a different message: start over
        return FALSE;
    }
    if (n > as->total - as->got)
        n = as->total - as->got;
    for (i = 0; i < n; i++)
        as->buf[as->got + i] = src[i];
    as->got += n;
    if (as->got >= as->total)
    {
        as->type = 0;
        return TRUE;
    }
    return FALSE;
}

// What a bad frame reads as: a zero-length message whose data is one zero byte.
static const u8 sNoData[1] = {0};

u8 BrWire_Unframe(const u8 *payload, u8 len, const u8 **data)
{
    u16 total;

    // A bad frame is a message of no bytes, not an error code. It was 0xFF, and every
    // handler but the ticker's checks `n < K` -- which 0xFF passes -- and then read
    // through a *data this never set: the stack's leftovers, which in practice was the
    // last message the same handler took, taken twice (POK-330 #27).
    *data = sNoData;
    if (len < BR_FRAME_HDR)
        return 0;
    total = BrWire_ReadU16(payload);
    if (payload[2] != 0 || total > BR_FRAME_DATA_MAX || total > len - BR_FRAME_HDR)
        return 0;
    *data = payload + BR_FRAME_HDR;
    return (u8)total;
}

u16 BrWire_Species(u16 species)
{
    if (species >= NUM_SPECIES || (species >= SPECIES_OLD_UNOWN_B && species <= SPECIES_OLD_UNOWN_Z))
        return SPECIES_NONE;
    return species;
}

u16 BrWire_Move(u16 move)
{
    return move < MOVES_COUNT ? move : MOVE_NONE;
}

u8 BrWire_Level(u8 level)
{
    return level > MAX_LEVEL ? MAX_LEVEL : level;
}

bool8 BrWire_MapOk(u8 mapGroup, u8 mapNum)
{
    return mapGroup < MAP_GROUPS_COUNT && mapNum < sMapGroupSizes[mapGroup];
}
