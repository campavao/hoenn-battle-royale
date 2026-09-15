// The mailbox rings and the per-frame drain (POK-216). See include/br/br_mailbox.h.
#include "global.h"
#include "br/br_mailbox.h"
#include "br/br_wire.h"

EWRAM_DATA struct BrMailbox gBrMailbox = {0};
static EWRAM_DATA BrNetHandler sHandlers[256] = {0};

// How many inbound messages one frame may consume. Keeps a burst from the relay from
// stalling a frame; the rest wait a frame, which is what they would do anyway.
#define BR_DRAIN_PER_FRAME 16

static void HandleEcho(const u8 *payload, u8 len)
{
    BrMailbox_Push(BR_MSG_ECHO, payload, len);
}

void BrMailbox_Init(void)
{
    u16 i;

    for (i = 0; i < 256; i++)
        sHandlers[i] = NULL;
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
    sHandlers[type] = fn;
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
        BrNetHandler fn = sHandlers[type];

        if (len > BR_SLOT_PAYLOAD_MAX)
            len = BR_SLOT_PAYLOAD_MAX;
        if (fn != NULL)
            fn(slot + BR_SLOT_HDR, len);
        gBrMailbox.inTail++;
    }
}
