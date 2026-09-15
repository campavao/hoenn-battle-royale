// Slot framing helpers (POK-217). See include/br/br_wire_c.h.
#include "global.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"
#include "br/br_wire_c.h"

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

u8 BrWire_Unframe(const u8 *payload, u8 len, const u8 **data)
{
    u16 total;

    if (len < BR_FRAME_HDR)
        return 0xFF;
    total = BrWire_ReadU16(payload);
    if (payload[2] != 0 || total > BR_FRAME_DATA_MAX || total > len - BR_FRAME_HDR)
        return 0xFF;
    *data = payload + BR_FRAME_HDR;
    return (u8)total;
}
