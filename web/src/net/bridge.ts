// The bridge (POK-219/220): ties the emulator's mailbox to the relay, both ways,
// every frame.
//
//   ROM out-ring --poll--> reassemble --> unpackSlot --> stamp our seat -->
//     roster.applyMsg --> relay.to(opponent, msg) or relay.all(msg)
//
//   relay 'recv' --> decode --> roster.applyMsg --> packSlot --> queue -->
//     mailbox.push (one slot/frame budget; retried next frame while the ring is full)
//
// `all` vs `to`: everything the ROM emits is a broadcast (place/step/face/out/
// pickup/spill/faint/result, ...) EXCEPT the two messages that are inherently a
// private exchange between two seats -- `challenge` (carries its own `opponent`)
// and `bt` (a raw link-block exchange, which does not name a target itself, so the
// bridge remembers the opponent from the `challenge` that started the fight).
//
// `echo`/`BR_MSG_NONE` never reach the relay: they exist for the mailbox's own
// wire-up test (slots.ts's comment on BR_MSG.ECHO) and have no `wire.ts` Msg
// counterpart to forward.
import { Mailbox, type RamAccess, type RawMessage } from './mailbox';
import { BR_CONT_FLAG, BR_MSG, crossesToRom, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './slots';
import { decode, PROTOCOL, type Msg } from './wire';
import { Roster } from '../match/roster';
import { RelayClient, type RecvEvent } from './relay';

/** What Bridge needs from the emulator: bus-addressed RAM access, plus a per-frame
 *  callback. emu/index.ts's Emulator satisfies this directly; tests hand in a fake
 *  RamAccess over a plain Uint8Array with a manual frame() to fire the callback. */
export interface EmulatorLike extends RamAccess {
  onFrame(listener: () => void): () => void;
}

export interface BridgeStats {
  frames: number;
  /** Messages pushed into the ROM's in-ring (relay -> ROM). */
  in: number;
  /** Messages read off the ROM's out-ring (ROM -> relay). */
  out: number;
  /** Messages discarded: bad JSON/binary, an unknown type, or a validation failure.
   *  Does not count a full ring's queue-and-retry -- that is delayed, not lost. */
  drops: number;
  /** mailbox.pending(): how many queued pushes the ROM still has not drained. */
  pending: number;
}

export interface BridgeOptions {
  emu: EmulatorLike;
  /** Bus address of gBrMailbox, from br-symbols.json (release.ts's symbols map). */
  mailboxBase: number;
  relay: RelayClient;
  /** This client's seat -- the relay's own room-member id (net/relay.ts, docs/WIRE.md). */
  seat: number;
  protocol?: number;
}

function msgSeat(msg: Msg): number | undefined {
  return 'seat' in msg ? (msg as { seat?: number }).seat : undefined;
}

export class Bridge {
  readonly mailbox: Mailbox;
  readonly roster = new Roster();
  readonly relay: RelayClient;
  readonly seat: number;

  private readonly protocol: number;
  private opponentSeat: number | null = null;
  /** An extra gate on relay -> ROM, set by the page (match/spectate.ts). A ROM handed
   *  a `bstart` starts replaying a fight, and `bstart`/`turn` are broadcasts, so a
   *  client that did not ask to watch must not be handed one. Unset, everything that
   *  crosses passes. */
  private romFilter: ((msg: Msg) => boolean) | null = null;
  /** Called with everything our own ROM sends, after the seat stamp. The page's own
   *  spectate cache needs it: a fighter never sees its own messages come back over the
   *  relay (the echo guard below drops them), and it is the one that has to hand a
   *  late watcher the fight so far. */
  private outObserver: ((msg: Msg) => void) | null = null;
  /** Slots waiting for room in the ROM's in-ring, in send order. */
  private outQueue: BinarySlot[] = [];
  private framesCount = 0;
  private inCount = 0;
  private outCount = 0;
  private dropCount = 0;
  private readonly unsubs: (() => void)[] = [];

  constructor(opts: BridgeOptions) {
    this.mailbox = new Mailbox(opts.emu, opts.mailboxBase);
    this.relay = opts.relay;
    this.seat = opts.seat;
    this.protocol = opts.protocol ?? PROTOCOL;
    this.roster.setMySeat(opts.seat);

    this.unsubs.push(opts.emu.onFrame(() => this.onFrame()));
    this.unsubs.push(this.relay.on('recv', (ev) => this.onRelayRecv(ev)));
    this.unsubs.push(this.relay.on('roster', (ev) => this.roster.applyRoster(ev)));

    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      (window as unknown as { __br?: unknown }).__br = { bridge: this, roster: this.roster, mailbox: this.mailbox };
    }
  }

  /** Stops listening to the emulator and the relay. */
  dispose(): void {
    for (const unsub of this.unsubs.splice(0)) unsub();
  }

  /** Throws unless the ROM's mailbox is awake and speaking this protocol. Call once
   *  after boot, per mailbox.ts's own contract. */
  assertCompatible(): void {
    this.mailbox.assertCompatible(this.protocol);
  }

  get stats(): BridgeStats {
    return { frames: this.framesCount, in: this.inCount, out: this.outCount, drops: this.dropCount, pending: this.mailbox.pending() };
  }

  private onFrame(): void {
    this.framesCount++;
    if (!this.mailbox.isAwake()) return; // BrMailbox_Init has not run yet
    this.flushOutQueue();
    const raw = this.mailbox.poll();
    if (raw.length) this.handleFromRom(raw);
  }

  /** Pushes as many queued slots as the ROM's in-ring has room for, in order --
   *  stops (rather than skipping ahead) the moment one is refused, so a message's
   *  own slots are never pushed out of order. */
  private flushOutQueue(): void {
    while (this.outQueue.length > 0) {
      const slot = this.outQueue[0];
      if (!this.mailbox.push(slot.type, slot.payload)) return; // ring full; retry next frame
      this.outQueue.shift();
      this.inCount++;
    }
  }

  /** Splits one poll() batch back into per-message slot groups (a base-type slot
   *  followed by zero or more BR_CONT_FLAG continuations) and handles each. */
  private handleFromRom(raw: RawMessage[]): void {
    let i = 0;
    while (i < raw.length) {
      const group: BinarySlot[] = [raw[i]];
      i++;
      while (i < raw.length && (raw[i].type & BR_CONT_FLAG) !== 0) {
        group.push(raw[i]);
        i++;
      }
      this.handleGroupFromRom(group);
    }
  }

  private handleGroupFromRom(group: BinarySlot[]): void {
    let reassembled: BinarySlot;
    try {
      reassembled = reassembleSlots(group);
    } catch {
      this.dropCount++;
      return;
    }
    // BR_MSG_NONE/ECHO have no wire.ts Msg and must never reach the relay.
    if (reassembled.type === BR_MSG.NONE || reassembled.type === BR_MSG.ECHO) return;

    let msg: Msg;
    try {
      msg = unpackSlot(reassembled.type, reassembled.payload);
    } catch {
      this.dropCount++;
      return;
    }
    this.outCount++;

    const stamped = { ...msg, seat: this.seat } as Msg;
    this.noteChallenge(stamped);
    this.roster.applyMsg(stamped);

    this.outObserver?.(stamped);

    const target = this.targetSeat(stamped);
    if (target !== undefined) this.relay.to(target, stamped);
    else this.relay.all(stamped);
  }

  private onRelayRecv(ev: RecvEvent): void {
    let msg: Msg;
    try {
      msg = decode(JSON.stringify(ev.m));
    } catch {
      this.dropCount++;
      return;
    }
    if (msgSeat(msg) === this.seat) return; // our own message, echoed back

    this.noteChallenge(msg);
    this.roster.applyMsg(msg);
    if (!crossesToRom(msg.t)) return; // JSON-only (accept/decline/win/ready/...): nothing to push
    if (this.romFilter && !this.romFilter(msg)) return;

    let slots: BinarySlot[];
    try {
      slots = packSlot(msg);
    } catch {
      this.dropCount++;
      return;
    }
    this.outQueue.push(...slots);
  }

  setRomFilter(fn: ((msg: Msg) => boolean) | null): void {
    this.romFilter = fn;
  }

  setOutObserver(fn: ((msg: Msg) => void) | null): void {
    this.outObserver = fn;
  }

  /** Hands a message straight to this ROM without it ever touching the relay: the
   *  spectator's own `follow`, which is a page's word to its own ROM (docs/WIRE.md). */
  pushToRom(msg: Msg): void {
    if (!crossesToRom(msg.t)) return;
    try {
      this.outQueue.push(...packSlot(msg));
    } catch {
      this.dropCount++;
    }
  }

  /** Remembers who we are fighting, so a later `bt` (which does not itself name a
   *  seat) knows where to route. */
  private noteChallenge(msg: Msg): void {
    if (msg.t !== 'challenge') return;
    this.opponentSeat = msg.seat === this.seat ? msg.opponent : msg.seat;
  }

  private targetSeat(msg: Msg): number | undefined {
    if (msg.t === 'challenge') return msg.opponent;
    if (msg.t === 'bt') return this.opponentSeat ?? undefined;
    return undefined;
  }
}
