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
// Unframes a single-slot payload: points *data at the message bytes and returns their
// length, or 0xFF when the frame is a continuation or claims more than one slot.
u8 BrWire_Unframe(const u8 *payload, u8 len, const u8 **data);

// Little-endian helpers on byte buffers (agbcc has no packed structs to lean on).
u16 BrWire_ReadU16(const u8 *p);
void BrWire_WriteU16(u8 *p, u16 v);

#endif // GUARD_BR_WIRE_C_H
