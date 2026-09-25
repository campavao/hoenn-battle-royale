#ifndef GUARD_BR_MAILBOX_H
#define GUARD_BR_MAILBOX_H

#include "br/br_config.h"
#include "br/br_boot.h"

// The mailbox: the one bridge between the ROM and the page (POK-216).
//
// The GBA has no network. The page polls this struct in EWRAM after every frame,
// takes what the ROM pushed into `out`, and writes what the relay delivered into `in`.
// Two rings of fixed slots, one per direction. Indices count forever (u16, wrap at
// 65536) and are reduced modulo BR_RING_SLOTS to find the slot; head == tail means
// empty, head - tail == BR_RING_SLOTS means full. The producer writes the slot first
// and bumps head last, so a half-written slot is never visible.
//
// Every field has an explicit width and offset because the page reads the layout by
// hand (web/src/net/mailbox.ts mirrors these offsets; a test pins them). Change one
// side, change both, bump BR_PROTOCOL.

// Slot: [0] type, [1] payload length, [2..] payload.
#define BR_SLOT_HDR 2
#define BR_SLOT_PAYLOAD_MAX (BR_SLOT_BYTES - BR_SLOT_HDR)

struct BrMailbox
{
    /* 0x00 */ u16 magic;      // BR_MAGIC once BrMailbox_Init ran
    /* 0x02 */ u16 protocol;   // BR_PROTOCOL
    /* 0x04 */ u16 patch;      // BR_PATCH_VERSION
    /* 0x06 */ u16 size;       // sizeof(struct BrMailbox); the page refuses a mismatch
    /* 0x08 */ u16 outHead;    // ROM -> page ring, ROM bumps
    /* 0x0A */ u16 outTail;    //                   page bumps
    /* 0x0C */ u16 inHead;     // page -> ROM ring, page bumps
    /* 0x0E */ u16 inTail;     //                   ROM bumps
    /* 0x10 */ u32 frame;      // BrNet_Tick count since boot
    /* 0x14 */ u32 dropped;    // out pushes lost to a full ring
    /* 0x18 */ u8 out[BR_RING_SLOTS][BR_SLOT_BYTES];
    /* 0x1018 */ u8 in[BR_RING_SLOTS][BR_SLOT_BYTES];
    /* 0x2018 */ struct BrBoot boot;   // 16 bytes, see br_boot.h
    /* 0x2028 */
};

#define BR_MAILBOX_OFF_OUT 0x18
#define BR_MAILBOX_OFF_IN 0x1018
#define BR_MAILBOX_OFF_BOOT 0x2018
BR_OFFSET(BrMailbox, magic, 0x00)
BR_OFFSET(BrMailbox, protocol, 0x02)
BR_OFFSET(BrMailbox, patch, 0x04)
BR_OFFSET(BrMailbox, size, 0x06)
BR_OFFSET(BrMailbox, outHead, 0x08)
BR_OFFSET(BrMailbox, outTail, 0x0A)
BR_OFFSET(BrMailbox, inHead, 0x0C)
BR_OFFSET(BrMailbox, inTail, 0x0E)
BR_OFFSET(BrMailbox, frame, 0x10)
BR_OFFSET(BrMailbox, dropped, 0x14)
BR_OFFSET(BrMailbox, out, BR_MAILBOX_OFF_OUT)
BR_OFFSET(BrMailbox, in, BR_MAILBOX_OFF_IN)
BR_OFFSET(BrMailbox, boot, BR_MAILBOX_OFF_BOOT)
BR_SIZE(BrMailbox, 0x2028)

extern struct BrMailbox gBrMailbox;

typedef void (*BrNetHandler)(const u8 *payload, u8 len);

void BrMailbox_Init(void);
// Queues a message for the page. Returns FALSE (and counts a drop) when the ring is full.
bool8 BrMailbox_Push(u8 type, const u8 *payload, u8 len);
// Registers the handler for a message type coming from the page. One per type.
void BrNet_On(u8 type, BrNetHandler fn);
// Runs once per frame from the main loop: drains `in` into handlers.
void BrNet_Tick(void);

#endif // GUARD_BR_MAILBOX_H
