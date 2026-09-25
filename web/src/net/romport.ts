// The page's one writer into the ROM's in-ring, and its one reader of the out-ring
// (POK-330 #44). There used to be three copies of this: the Bridge's queue for what the
// room says, a second queue the host's director and solo pushed through, and solo's own
// drain. Two writers on one ring could put a slot of one `spill` between the slots of
// another, and BrWire_Assemble drops both. None of the copies was bounded, so a tab left
// in the background came back to seconds of stale steps, with every `ring` and `out`
// stuck behind them.
//
// So: one queue, whole messages, and movement that goes stale is let go.
//   - A message goes into the ring whole or not yet: all its slots, only when
//     RING_SLOTS - pending() has room for all of them.
//   - place/step/face are where a seat is. A newer `place` for a seat says all of it, so
//     that seat's queued place/step/face go. Past POSITIONAL_CAP, the oldest movement
//     goes, one a later step or place of the same seat has made moot if there is one.
//   - Everything else (ring, out, challenge, result, start, bt, ...) is an event: never
//     dropped, never reordered.
import { MAILBOX, type Mailbox } from './mailbox';
import { BR_CONT_FLAG, BR_MSG, crossesToRom, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './slots';
import type { Msg } from './wire';

/** Messages that only say where a seat stands or faces. The next one for the same seat
 *  says it again, which is what makes them safe to let go. */
const POSITIONAL = new Set<string>(['place', 'step', 'face']);

/** How much movement may wait for the ROM: one ring's worth, which it gets through in
 *  four frames (16 a frame), and room for every seat's latest word twice over. */
export const POSITIONAL_CAP = MAILBOX.RING_SLOTS;

interface Queued {
  /** A place/step/face, and whose. */
  move: boolean;
  seat: number;
  slots: BinarySlot[];
  /** Carries a whole position (step and place do; face is only which way). */
  fix: boolean;
}

export interface RomPortStats {
  /** Messages handed to the ROM's in-ring. */
  pushed: number;
  /** Positional messages let go because a newer `place` for the same seat came in. */
  coalesced: number;
  /** Positional messages let go past POSITIONAL_CAP. */
  capped: number;
}

export class RomPort {
  private queue: Queued[] = [];
  private positional = 0;
  private pushedCount = 0;
  private coalescedCount = 0;
  private cappedCount = 0;

  constructor(
    readonly mailbox: Mailbox,
    private readonly positionalCap = POSITIONAL_CAP,
  ) {}

  get stats(): RomPortStats {
    return { pushed: this.pushedCount, coalesced: this.coalescedCount, capped: this.cappedCount };
  }

  /** Messages waiting for room in the ring. */
  get queued(): number {
    return this.queue.length;
  }

  /** Queues a message for the ROM. False when it has no binary form (JSON-only, per
   *  docs/WIRE.md), will not pack, or is too big for the ring ever to hold -- which would
   *  wedge everything behind it. */
  push(msg: Msg): boolean {
    if (!crossesToRom(msg.t)) return false;
    let slots: BinarySlot[];
    try {
      slots = packSlot(msg);
    } catch {
      return false;
    }
    if (slots.length > MAILBOX.RING_SLOTS) return false;
    const move = POSITIONAL.has(msg.t);
    const seat = move ? (msg as { seat: number }).seat : -1;
    if (msg.t === 'place') this.supersede(seat);
    this.queue.push({ move, seat, slots, fix: msg.t === 'place' || msg.t === 'step' });
    if (move && ++this.positional > this.positionalCap) this.trim();
    return true;
  }

  /** Pushes queued messages into the ring, oldest first, each one whole: a message that
   *  does not fit yet stops the flush, and waits for the ROM to drain. Call once a frame,
   *  after the ROM is awake -- BrMailbox_Init zeroes the ring. Returns how many went in. */
  flush(): number {
    let n = 0;
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (MAILBOX.RING_SLOTS - this.mailbox.pending() < next.slots.length) break;
      for (const slot of next.slots) this.mailbox.push(slot.type, slot.payload);
      this.queue.shift();
      if (next.move) this.positional--;
      n++;
    }
    this.pushedCount += n;
    return n;
  }

  /** Everything the ROM has sent since the last call, as whole messages: each base slot
   *  with its BR_CONT_FLAG continuations, reassembled and unpacked. The ROM pushes a
   *  message whole (BrWire_SendLarge), so a poll never ends halfway through one. Returns
   *  how many could not be read. A handler that throws costs its own message and not the
   *  rest, which poll() has already taken off the ring; the first throw is rethrown
   *  once they are all handled. */
  drain(handle: (msg: Msg) => void): number {
    const raw = this.mailbox.poll();
    let bad = 0;
    let failed = false;
    let failure: unknown;
    let i = 0;
    while (i < raw.length) {
      const group: BinarySlot[] = [raw[i++]];
      while (i < raw.length && (raw[i].type & BR_CONT_FLAG) !== 0) group.push(raw[i++]);
      let msg: Msg;
      try {
        const whole = reassembleSlots(group);
        // BR_MSG_NONE/ECHO are the mailbox's own wire-up test, with no wire.ts Msg.
        if (whole.type === BR_MSG.NONE || whole.type === BR_MSG.ECHO) continue;
        msg = unpackSlot(whole.type, whole.payload);
      } catch {
        bad++;
        continue;
      }
      try {
        handle(msg);
      } catch (err) {
        if (!failed) failure = err;
        failed = true;
      }
    }
    if (failed) throw failure;
    return bad;
  }

  /** A `place` says where the seat is: whatever of its movement is still queued is moot. */
  private supersede(seat: number): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => !(q.move && q.seat === seat));
    const gone = before - this.queue.length;
    this.positional -= gone;
    this.coalescedCount += gone;
  }

  /** One positional message over the cap goes: the oldest that a later step or place of
   *  the same seat has made moot (both carry where it stands), or else the oldest. */
  private trim(): void {
    const lastFix = new Map<number, number>();
    this.queue.forEach((q, i) => {
      if (q.fix) lastFix.set(q.seat, i);
    });
    let victim = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (!q.move) continue;
      if (victim < 0) victim = i;
      if ((lastFix.get(q.seat) ?? -1) > i) {
        victim = i;
        break;
      }
    }
    this.queue.splice(victim, 1);
    this.positional--;
    this.cappedCount++;
  }
}
