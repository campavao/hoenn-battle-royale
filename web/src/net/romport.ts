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
//     that seat's queued place/step/face go. Past POSITIONAL_CAP, the oldest step or face
//     a later one of the same seat has made moot goes; a moot `place` takes the step
//     after it into itself rather than going, since only a place carries the skin.
//   - busy/clock say a seat's state outright, and the ROM only stores it: a newer one for
//     the same seat makes the queued one moot, and it goes (POK-331 #18).
//   - Everything else (ring, out, challenge, result, start, bt, ...) is an event: never
//     dropped, never reordered.
//   - A link block (`bt`) goes in only once the ROM has read the one before it. The ROM
//     hands a block to the battle through gBlockRecvBuffer, which the battle empties once
//     a frame (TryReceiveLinkBattleData, at VBlank), so two read in one BrNet_Tick are one
//     block lost -- and the link waiting on it for good. A slow battle frame runs the main
//     loop over two, and the page, which flushes at each frame's end, put the next block
//     in before the ROM had read the last.
import { MAILBOX, type Mailbox } from './mailbox';
import { BR_CONT_FLAG, BR_MSG, crossesToRom, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './slots';
import type { Msg, PlaceMsg, StepMsg } from './wire';

/** Messages that only say where a seat stands or faces. The next one for the same seat
 *  says it again, which is what makes them safe to let go. */
const POSITIONAL = new Set<string>(['place', 'step', 'face']);

/** Messages that are a seat's whole state rather than something that happened to it: a
 *  `busy`'s kind and a `clock`'s seconds left, which the ROM just stores (br_ghosts.c's
 *  HandleBusy, br_match.c's HandleClock). A tab back from the background used to hand the
 *  ROM every `clock` of the minutes it missed, in order, ahead of what came after them. */
const ABSOLUTE = new Set<string>(['busy', 'clock']);

/** How much movement may wait for the ROM: one ring's worth, which it gets through in
 *  four frames (16 a frame), and room for every seat's latest word twice over. */
export const POSITIONAL_CAP = MAILBOX.RING_SLOTS;

interface Queued {
  msg: Msg;
  /** A place/step/face. */
  move: boolean;
  /** Whose, for a place/step/face or a busy/clock; -1 otherwise. */
  seat: number;
  slots: BinarySlot[];
  /** Carries a whole position (step and place do; face is only which way). */
  fix: boolean;
}

export interface RomPortStats {
  /** Messages handed to the ROM's in-ring. */
  pushed: number;
  /** Messages let go because a newer one for the same seat said all they did: movement
   *  under a `place`, a `busy` or `clock` under the next. */
  coalesced: number;
  /** Positional messages let go past POSITIONAL_CAP. */
  capped: number;
  /** Messages let go because the ROM they were for is starting over (clear()). */
  cleared: number;
}

export class RomPort {
  private queue: Queued[] = [];
  private positional = 0;
  private pushedCount = 0;
  private coalescedCount = 0;
  private cappedCount = 0;
  private clearedCount = 0;
  /** Slots pushed since the last `bt`, while its slots may still be unread in the ring;
   *  null when none is. */
  private sinceBlock: number | null = null;

  constructor(
    readonly mailbox: Mailbox,
    private readonly positionalCap: number = POSITIONAL_CAP,
  ) {}

  get stats(): RomPortStats {
    return { pushed: this.pushedCount, coalesced: this.coalescedCount, capped: this.cappedCount, cleared: this.clearedCount };
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
    const absolute = ABSOLUTE.has(msg.t);
    const seat = move || absolute ? (msg as { seat: number }).seat : -1;
    if (msg.t === 'place') this.supersede(seat);
    if (absolute) this.restate(msg.t, seat);
    this.queue.push({ msg, move, seat, slots, fix: msg.t === 'place' || msg.t === 'step' });
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
      if (next.msg.t === 'bt' && this.blockUnread()) break;
      for (const slot of next.slots) this.mailbox.push(slot.type, slot.payload);
      if (next.msg.t === 'bt') this.sinceBlock = 0;
      else if (this.sinceBlock !== null) this.sinceBlock += next.slots.length;
      this.queue.shift();
      if (next.move) this.positional--;
      n++;
    }
    this.pushedCount += n;
    return n;
  }

  /** Lets go of everything still queued, because the ROM it was for is about to start
   *  over (PLAY AGAIN, POK-331 #18): the last match's movement, ticker lines and ring are
   *  nothing to a ROM booting into Littleroot for the next one, and it drew the last
   *  match's ghosts there. The reboot empties the ring too, so no block is left unread.
   *  Returns how many went. */
  clear(): number {
    const gone = this.queue.length;
    this.queue = [];
    this.positional = 0;
    this.sinceBlock = null;
    this.clearedCount += gone;
    return gone;
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

  /** The last `bt` is still in the ring: more is pending than went in after it. A ROM
   *  that has rebooted has an empty ring, and has read everything. */
  private blockUnread(): boolean {
    if (this.sinceBlock === null) return false;
    if (this.mailbox.pending() > this.sinceBlock) return true;
    this.sinceBlock = null;
    return false;
  }

  /** A `place` says where the seat is: whatever of its movement is still queued is moot. */
  private supersede(seat: number): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => !(q.move && q.seat === seat));
    const gone = before - this.queue.length;
    this.positional -= gone;
    this.coalescedCount += gone;
  }

  /** A seat's `busy` or `clock` says its state outright: the one of the same queued before
   *  it says only what was true then. It goes, and this one takes its turn at the back,
   *  so the ROM never learns a state ahead of anything that came before it. */
  private restate(t: string, seat: number): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => !(q.msg.t === t && q.seat === seat));
    this.coalescedCount += before - this.queue.length;
  }

  /** One positional message over the cap goes. First the oldest step or face that a later
   *  message of the same seat has made moot: a step by a later step or place, a face by any
   *  of those or a later face. A `place` is never just dropped: it alone carries the skin,
   *  and a ROM that has not drawn the seat yet draws it from a step as skin 0 until its
   *  next place, which can be a map away. A moot place takes the step after it into
   *  itself instead. With nothing moot, the oldest step or face goes. */
  private trim(): void {
    const lastFix = new Map<number, number>();
    const lastMove = new Map<number, number>();
    this.queue.forEach((q, i) => {
      if (!q.move) return;
      lastMove.set(q.seat, i);
      if (q.fix) lastFix.set(q.seat, i);
    });
    const moot = (q: Queued, i: number) => ((q.fix ? lastFix : lastMove).get(q.seat) ?? -1) > i;
    let victim = -1;
    let place = -1;
    let oldest = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (!q.move) continue;
      if (q.msg.t === 'place') {
        if (place < 0 && moot(q, i)) place = i;
        continue;
      }
      if (oldest < 0) oldest = i;
      if (moot(q, i)) {
        victim = i;
        break;
      }
    }
    if (victim < 0 && place >= 0) {
      // Nothing of that seat sits between its place and the step that made it moot: it
      // would have been moot itself, and gone first.
      victim = this.queue.findIndex((q, i) => i > place && q.fix && q.seat === this.queue[place].seat);
      const was = this.queue[place].msg as PlaceMsg;
      const to = this.queue[victim].msg as StepMsg;
      const folded: PlaceMsg = { ...was, map: to.map, x: to.x, y: to.y, f: to.d };
      this.queue[place] = { ...this.queue[place], msg: folded, slots: packSlot(folded) };
    }
    if (victim < 0) victim = oldest >= 0 ? oldest : this.queue.findIndex((q) => q.move);
    this.queue.splice(victim, 1);
    this.positional--;
    this.cappedCount++;
  }
}
