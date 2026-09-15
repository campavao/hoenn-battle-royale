// The page's end of the mailbox (POK-216). Mirrors include/br/br_mailbox.h byte for
// byte: the offsets below are the struct's, and a test pins them. Change one side,
// change both, bump BR_PROTOCOL.
//
// Two rings of fixed 64-byte slots. Indices are u16 counters that wrap at 65536 and
// are reduced modulo the slot count; head == tail is empty. The producer writes the
// slot then bumps head, so the consumer never sees a half-written slot. `out` is the
// ROM's ring (we bump outTail); `in` is ours (we bump inHead).

export const MAILBOX = {
  MAGIC: 0x4252,
  RING_SLOTS: 64,
  SLOT_BYTES: 64,
  SLOT_HDR: 2,
  PAYLOAD_MAX: 62,
  OFF_MAGIC: 0x00,
  OFF_PROTOCOL: 0x02,
  OFF_PATCH: 0x04,
  OFF_SIZE: 0x06,
  OFF_OUT_HEAD: 0x08,
  OFF_OUT_TAIL: 0x0a,
  OFF_IN_HEAD: 0x0c,
  OFF_IN_TAIL: 0x0e,
  OFF_FRAME: 0x10,
  OFF_DROPPED: 0x14,
  OFF_OUT: 0x18,
  OFF_IN: 0x1018,
  OFF_BOOT: 0x2018,
  BOOT_BYTES: 16,
  SIZE: 0x2028,
} as const;

/** What the mailbox needs from the emulator: bus-addressed RAM access. */
export interface RamAccess {
  read(addr: number, width: 8 | 16 | 32): number;
  write(addr: number, value: number, width: 8 | 16 | 32): void;
  bytes(addr: number, len: number): Uint8Array;
}

export interface RawMessage {
  type: number;
  payload: Uint8Array;
}

export interface MailboxHeader {
  magic: number;
  protocol: number;
  patch: number;
  size: number;
  frame: number;
  dropped: number;
}

export class MailboxError extends Error {}

export class Mailbox {
  /** Messages the page could not queue because the ROM had not drained `in`. */
  droppedOut = 0;

  constructor(
    private readonly ram: RamAccess,
    /** Bus address of gBrMailbox, from br-symbols.json. */
    readonly base: number,
  ) {}

  /** True once BrMailbox_Init has run in the ROM. */
  isAwake(): boolean {
    return this.ram.read(this.base + MAILBOX.OFF_MAGIC, 16) === MAILBOX.MAGIC;
  }

  header(): MailboxHeader {
    return {
      magic: this.ram.read(this.base + MAILBOX.OFF_MAGIC, 16),
      protocol: this.ram.read(this.base + MAILBOX.OFF_PROTOCOL, 16),
      patch: this.ram.read(this.base + MAILBOX.OFF_PATCH, 16),
      size: this.ram.read(this.base + MAILBOX.OFF_SIZE, 16),
      frame: this.ram.read(this.base + MAILBOX.OFF_FRAME, 32),
      dropped: this.ram.read(this.base + MAILBOX.OFF_DROPPED, 32),
    };
  }

  /**
   * Throws unless the ROM's mailbox is awake and laid out the way this code expects.
   * Call once after boot before trusting anything else.
   */
  assertCompatible(expectedProtocol: number): void {
    const h = this.header();
    if (h.magic !== MAILBOX.MAGIC) throw new MailboxError(`mailbox not awake (magic 0x${h.magic.toString(16)})`);
    if (h.size !== MAILBOX.SIZE) throw new MailboxError(`mailbox size ${h.size}, page expects ${MAILBOX.SIZE}`);
    if (h.protocol !== expectedProtocol) throw new MailboxError(`ROM protocol ${h.protocol}, page expects ${expectedProtocol}`);
  }

  /** Takes everything the ROM pushed since the last poll. */
  poll(): RawMessage[] {
    const head = this.ram.read(this.base + MAILBOX.OFF_OUT_HEAD, 16);
    let tail = this.ram.read(this.base + MAILBOX.OFF_OUT_TAIL, 16);
    const out: RawMessage[] = [];
    while (tail !== head) {
      const slot = this.base + MAILBOX.OFF_OUT + (tail % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
      const type = this.ram.read(slot, 8);
      const len = Math.min(this.ram.read(slot + 1, 8), MAILBOX.PAYLOAD_MAX);
      // Copy: the slot is reused as soon as we bump the tail.
      out.push({ type, payload: this.ram.bytes(slot + MAILBOX.SLOT_HDR, len).slice() });
      tail = (tail + 1) & 0xffff;
    }
    if (out.length) this.ram.write(this.base + MAILBOX.OFF_OUT_TAIL, tail, 16);
    return out;
  }

  /** Queues a message for the ROM. False when its ring is full (it drains 16 a frame). */
  push(type: number, payload: Uint8Array | number[] = []): boolean {
    if (payload.length > MAILBOX.PAYLOAD_MAX) throw new MailboxError(`payload ${payload.length} > ${MAILBOX.PAYLOAD_MAX}`);
    const head = this.ram.read(this.base + MAILBOX.OFF_IN_HEAD, 16);
    const tail = this.ram.read(this.base + MAILBOX.OFF_IN_TAIL, 16);
    if (((head - tail) & 0xffff) >= MAILBOX.RING_SLOTS) {
      this.droppedOut++;
      return false;
    }
    const slot = this.base + MAILBOX.OFF_IN + (head % MAILBOX.RING_SLOTS) * MAILBOX.SLOT_BYTES;
    this.ram.write(slot, type, 8);
    this.ram.write(slot + 1, payload.length, 8);
    this.ram.bytes(slot + MAILBOX.SLOT_HDR, payload.length).set(payload);
    // Head last, after the bytes: the ROM reads head to decide the slot is valid.
    this.ram.write(this.base + MAILBOX.OFF_IN_HEAD, (head + 1) & 0xffff, 16);
    return true;
  }

  /** How many messages the ROM still has to drain. */
  pending(): number {
    const head = this.ram.read(this.base + MAILBOX.OFF_IN_HEAD, 16);
    const tail = this.ram.read(this.base + MAILBOX.OFF_IN_TAIL, 16);
    return (head - tail) & 0xffff;
  }
}
