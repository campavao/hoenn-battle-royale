#ifndef GUARD_BR_WIRE_C_H
#define GUARD_BR_WIRE_C_H

// The ROM's end of the slot framing described in br_wire.h (POK-217): every message's
// first slot opens with totalLen (u16 LE) and seq (u8, 0), then the data. Single-slot
// messages are the common case and the only one these helpers handle; bt/party
// reassembly lives with the code that needs it.

#define BR_FRAME_HDR 3
#define BR_FRAME_DATA_MAX (BR_SLOT_PAYLOAD_MAX - BR_FRAME_HDR)

// Sends one message that fits a single slot. Returns FALSE if it did not fit or the
// ring was full.
bool8 BrWire_Send(u8 type, const u8 *data, u8 len);
// Sends a message of any size up to the assembler's reach: the first slot carries
// the header and 59 bytes, continuation slots (type | BR_MSG_CONT) 61 more each.
// All or nothing: FALSE (and nothing pushed) when the ring lacks the room.
bool8 BrWire_SendLarge(u8 type, const u8 *data, u16 len);
// Unframes a single-slot payload: points *data at the message bytes and returns their
// length, or 0xFF when the frame is a continuation or claims more than one slot.
u8 BrWire_Unframe(const u8 *payload, u8 len, const u8 **data);

// Multi-slot reassembly: feed every slot of a type (and its type | BR_MSG_CONT)
// through BrWire_Assemble; it returns TRUE on the slot that completes a message, with
// the bytes in buf[0..total). A seq gap or an oversize message resets the assembler.
struct BrAssembler
{
    u8 *buf;
    u16 cap;
    u16 total;
    u16 got;
    u8 type;    // the base type being assembled, 0 when idle
    u8 nextSeq;
};
// isCont: the slot arrived on type | BR_MSG_CONT (register a handler for that type too).
bool8 BrWire_Assemble(struct BrAssembler *as, u8 baseType, bool8 isCont, const u8 *payload, u8 len);

// Little-endian helpers on byte buffers (agbcc has no packed structs to lean on).
u16 BrWire_ReadU16(const u8 *p);
void BrWire_WriteU16(u8 *p, u16 v);

#endif // GUARD_BR_WIRE_C_H
