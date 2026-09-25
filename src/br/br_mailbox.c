// The mailbox rings and the per-frame drain (POK-216). See include/br/br_mailbox.h.
#include "global.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"

EWRAM_DATA struct BrMailbox gBrMailbox = {0};
// One row for first slots, one for continuations (type | BR_MSG_CONT), BR_MSG_COUNT wide.
// It was a flat [256] -- a kilobyte of mostly NULL pointers, in an EWRAM that had eighty
// bytes left (POK-330 #21). The flat table was also the only thing that made any u8 type
// safe to index with, so the range check in BrNet_On and BrNet_Tick is load-bearing now.
static EWRAM_DATA BrNetHandler sHandlers[2][BR_MSG_COUNT] = {0};
STATIC_ASSERT(BR_MSG_LAST < BR_MSG_COUNT, BrMsgTypesFitTheHandlerTable)

// How many inbound messages one frame may consume. Keeps a burst from the relay from
// stalling a frame; the rest wait a frame, which is what they would do anyway.
#define BR_DRAIN_PER_FRAME 16

static void HandleEcho(const u8 *payload, u8 len)
{
    BrMailbox_Push(BR_MSG_ECHO, payload, len);
}

// The handler slot for a slot type, or NULL for a type no table row can hold.
static BrNetHandler *HandlerFor(u8 type)
{
    u8 base = type & ~BR_MSG_CONT;

    if (base >= BR_MSG_COUNT)
        return NULL;
    return &sHandlers[(type & BR_MSG_CONT) ? 1 : 0][base];
}

void BrMailbox_Init(void)
{
    CpuFill32(0, sHandlers, sizeof(sHandlers));
    CpuFill32(0, &gBrMailbox, sizeof(gBrMailbox));
    gBrMailbox.protocol = BR_PROTOCOL;
    gBrMailbox.patch = BR_PATCH_VERSION;
    gBrMailbox.size = sizeof(struct BrMailbox);
    BrNet_On(BR_MSG_ECHO, HandleEcho);
    // Magic last: the page treats it as "the rest is valid".
    gBrMailbox.magic = BR_MAGIC;
}

bool8 BrMailbox_Push(u8 type, const u8 *payload, u8 len)
{
    u8 *slot;
    u8 i;

    if ((u16)(gBrMailbox.outHead - gBrMailbox.outTail) >= BR_RING_SLOTS)
    {
        gBrMailbox.dropped++;
        return FALSE;
    }
    if (len > BR_SLOT_PAYLOAD_MAX)
        len = BR_SLOT_PAYLOAD_MAX;
    slot = gBrMailbox.out[gBrMailbox.outHead % BR_RING_SLOTS];
    slot[0] = type;
    slot[1] = len;
    for (i = 0; i < len; i++)
        slot[BR_SLOT_HDR + i] = payload[i];
    gBrMailbox.outHead++;
    return TRUE;
}

void BrNet_On(u8 type, BrNetHandler fn)
{
    BrNetHandler *slot = HandlerFor(type);

    if (slot != NULL)
        *slot = fn;
}

void BrNet_Tick(void)
{
    u8 budget = BR_DRAIN_PER_FRAME;

    gBrMailbox.frame++;
    while (gBrMailbox.inTail != gBrMailbox.inHead && budget-- > 0)
    {
        const u8 *slot = gBrMailbox.in[gBrMailbox.inTail % BR_RING_SLOTS];
        u8 type = slot[0];
        u8 len = slot[1];
        BrNetHandler *fn = HandlerFor(type);

        if (len > BR_SLOT_PAYLOAD_MAX)
            len = BR_SLOT_PAYLOAD_MAX;
        if (fn != NULL && *fn != NULL)
            (*fn)(slot + BR_SLOT_HDR, len);
        gBrMailbox.inTail++;
    }
}
