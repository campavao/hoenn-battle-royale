// The bridge (POK-219/220): ties the emulator's mailbox to the relay, both ways,
// every frame.
//
//   ROM out-ring --poll--> reassemble --> unpackSlot --> stamp our seat -->
//     roster.applyMsg --> relay.to(opponent, msg) or relay.all(msg)
//
//   relay 'recv' --> decode --> trust (net/trust.ts) --> roster.applyMsg --> RomPort
//     (net/romport.ts: whole messages into the in-ring as it has room, stale movement let
//     go) --> onMessage(msg, from), the page's one stream of what the room said
//
// `all` vs `to`: everything the ROM emits is a broadcast (place/step/face/out/
// pickup/spill/faint/result/challenge, ...) EXCEPT `bt`, a raw link-block exchange
// between two seats, which does not name a target itself: the bridge remembers the
// opponent from the `challenge` that started the fight, and a block with no opponent
// known goes nowhere.
//
// `echo`/`BR_MSG_NONE` never reach the relay: they exist for the mailbox's own
// wire-up test (slots.ts's comment on BR_MSG.ECHO) and have no `wire.ts` Msg
// counterpart to forward.
import { Mailbox, type RamAccess } from './mailbox';
import { closeAsSilent, readNetlink, type LinkState } from './netlink';
import { RomPort } from './romport';
import { crossesToRom } from './slots';
import { decode, type BlockMsg, type ChallengeMsg, type Lines, PROTOCOL, type Msg, type PickMsg } from './wire';
import { Roster } from '../match/roster';
import { RelayClient, type RecvEvent, type RosterEvent } from './relay';
import { admits } from './trust';

/** What Bridge needs from the emulator: bus-addressed RAM access, plus a per-frame
 *  callback. emu/index.ts's Emulator satisfies this directly; tests hand in a fake
 *  RamAccess over a plain Uint8Array with a manual frame() to fire the callback. */
export interface EmulatorLike extends RamAccess {
  onFrame(listener: () => void): () => void;
}

export interface BridgeStats {
  frames: number;
  /** Messages this Bridge pushed into the ROM's in-ring: whatever went through the
   *  port while it was the one pumping it, the host's director's included. */
  in: number;
  /** Messages read off the ROM's out-ring (ROM -> relay). */
  out: number;
  /** Messages discarded: bad JSON/binary, an unknown type, or a validation failure.
   *  Does not count a full ring's queue-and-retry -- that is delayed, not lost -- nor
   *  stale movement the port let go (rom.stats). */
  drops: number;
  /** Messages that decoded but came from somebody with no right to send them
   *  (net/trust.ts), and link blocks from anybody but the seat we are fighting. */
  refused: number;
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
  /** The fight the last Bridge was in, when this one replaces it mid-match (carry()). */
  carry?: LinkCarry;
  /** The page's one writer into this ROM's in-ring (POK-330 #44), when it outlives the
   *  Bridge: a rejoin builds a new Bridge over the same ROM, and the host's director
   *  pushes through the same port. Unset, the Bridge makes its own. */
  rom?: RomPort;
  /** br-symbols.json. gBrNetlink is the ROM's own word on the fight it is in, which the
   *  page follows (POK-331 #5) and ends a quiet fight through (#3); gBattleOutcome says
   *  whether the engine has decided one. Unset, the page goes by the messages it has
   *  seen, and a quiet fight waits for the ROM's own ways out. */
  symbols?: ReadonlyMap<string, number>;
  /** Whether our own tab is hidden. Unset, the document's. */
  hidden?: () => boolean;
}

/** What a link battle needs to outlive the Bridge it started under (POK-330 #20, #7). A
 *  rejoin after a socket blip builds a new Bridge while the ROM is still mid-fight, and a
 *  fresh one knew no opponent: every block after that went to the whole room, feeding
 *  itself into every other pair's fight. */
export interface LinkCarry {
  opponentSeat: number | null;
  heardLines: Map<number, Lines>;
  sent: BlockMsg[];
  lastRecvSeq: number;
  fighting: boolean;
  fight: number | null;
  /** ...and the drop's `pick`, while no `land` has answered it (POK-331 #4). */
  pick?: PickMsg | null;
}

/** How many of our own last blocks are kept to say again. The link is lockstep -- one
 *  block each way, then the next -- so what a blip can lose is the last one or two. */
export const BLOCKS_KEPT = 4;

/** A fight is the challenge that started it: the challenger's seat and its ROM's nonce
 *  (POK-331 #3). Both pages heard that one challenge, so both name the fight alike. */
export function fightOf(c: ChallengeMsg): number {
  return c.seat * 0x10000 + (c.nonce & 0xffff);
}

/** How long a link battle may go with no block from an opponent still in the room before
 *  the page ends it (POK-331 #3): three minutes of our own frames. A lockstep fight waits
 *  on the other side for one shot clock (br_battle.h's 30 s) and a turn's animations at
 *  most; six of those with nothing is a block lost for good or a ROM stuck over there. */
export const STALL_FRAMES = 3 * 60 * 60;
/** ...and once the opponent's own RESULT says its ROM has left the fight. Ours plays its
 *  own ending out within seconds of theirs, and nothing more is coming. */
export const STALL_AFTER_RESULT_FRAMES = 30 * 60;

function msgSeat(msg: Msg): number | undefined {
  return 'seat' in msg ? (msg as { seat?: number }).seat : undefined;
}

/** Messages whose `seat` names somebody else and must survive the stamp below. A ROM
 *  that fought a bot is the only thing that watched the fight happen, so it reports
 *  what the bot has left (`party`, POK-238) and what it spent out of the bot's bag
 *  (`spent`, POK-237) under the BOT's seat. Stamping our own seat on those threw both
 *  reports away -- the host looked for a walker with our seat, found none, and the bot
 *  walked off whole with a full bag. Every other message a ROM sends is about us. */
const SPEAKS_FOR_ANOTHER = new Set<string>(['party', 'spent']);

export class Bridge {
  readonly mailbox: Mailbox;
  /** Everything into and out of the ROM goes through here, and nothing else writes the
   *  in-ring. */
  readonly rom: RomPort;
  readonly roster = new Roster();
  readonly relay: RelayClient;
  readonly seat: number;

  private readonly protocol: number;
  private readonly ram: RamAccess;
  private readonly netlinkBase: number | undefined;
  private readonly outcomeBase: number | undefined;
  private readonly hidden: () => boolean;
  private opponentSeat: number | null = null;
  /** The fight our blocks are part of (fightOf its challenge), stamped on each one we send
   *  and checked on each one we take: a rejoin says its last few again, and after a new
   *  challenge between the same two seats they are the last fight's (POK-331 #3). */
  private fightId: number | null = null;
  /** The latest challenge between us and each seat, for following the ROM to whichever
   *  one it started (followRom). */
  private readonly fights = new Map<number, number>();
  /** Our frames since the opponent's last block, while nothing else explains the wait. */
  private quietFrames = 0;
  /** The opponent's RESULT for this fight is in: its ROM is out of it. */
  private opponentDone = false;
  /** Our last few blocks of the current fight, for saying again after a gap (#7). */
  private sentBlocks: BlockMsg[] = [];
  /** The last block of the current fight the ROM was handed. The other side says its
   *  last few again after a gap, and the ROM keeps no count of its own: a repeat handed
   *  to it would be read as the next block. */
  private lastRecvSeq = 0;
  /** Our ROM is in a link fight: it has sent or been handed a block since the challenge,
   *  and has not said how it ended. br_netlink.c's HandleChallenge ignores a challenge
   *  while gBrNetlink.active, so this page must too, or one naming us from a third seat
   *  mid-fight points our blocks at them and refuses our real opponent's. Before the
   *  first block it stays down: until then the ROM takes the latest challenge. */
  private fighting = false;
  /** Who the relay lists in the room, from its last roster (net/trust.ts). */
  private members = new Set<number>();
  /** Our opponent dropped off the relay's roster mid-fight: the blocks we sent while it
   *  was gone went nowhere, and are said again when it is back. */
  private opponentAway = false;
  /** Our ROM's `pick` that no `land` has answered (POK-331 #4). The drop waits on a black
   *  screen for the host's cell, and a pick our socket was down for never reached it --
   *  POK-255's black screen. br_pick.c asks once more after five seconds and gives up at
   *  fifteen, both into the same gap; the page asks again when it is back in the room. */
  private pick: PickMsg | null = null;
  /** The host that pick was last put to, and whether the room has lost them since. */
  private pickHost: number | null = null;
  private pickHostAway = false;
  private readonly listeners = new Set<(msg: Msg, from: number) => void>();
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
  /** Our own battle text, put on every challenge we send (POK-274). Kanto sends it with
   *  the challenge itself so "each side holds the other's before the locks"; ours picked
   *  three lines that only the picker could see. Set once, by the page that knows the
   *  career. */
  myLines: Lines | null = null;
  /** ...and what everybody else's challenges have said. */
  private readonly heardLines = new Map<number, Lines>();
  /** Says whether this ROM's own messages reach the room at all. A watcher's do not
   *  (POK-260): it is in the room to look, and a ghost of it walking around Littleroot
   *  is not part of anybody's match. */
  private outFilter: ((msg: Msg) => boolean) | null = null;
  private framesCount = 0;
  private inCount = 0;
  private outCount = 0;
  private dropCount = 0;
  private refusedCount = 0;
  private readonly unsubs: (() => void)[] = [];

  constructor(opts: BridgeOptions) {
    this.rom = opts.rom ?? new RomPort(new Mailbox(opts.emu, opts.mailboxBase));
    this.mailbox = this.rom.mailbox;
    this.relay = opts.relay;
    this.seat = opts.seat;
    this.protocol = opts.protocol ?? PROTOCOL;
    this.ram = opts.emu;
    this.netlinkBase = opts.symbols?.get('gBrNetlink');
    this.outcomeBase = opts.symbols?.get('gBattleOutcome');
    this.hidden = opts.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
    this.roster.setMySeat(opts.seat);
    if (opts.carry) {
      this.opponentSeat = opts.carry.opponentSeat;
      for (const [seat, lines] of opts.carry.heardLines) this.heardLines.set(seat, lines);
      this.sentBlocks = [...opts.carry.sent];
      this.lastRecvSeq = opts.carry.lastRecvSeq;
      this.fighting = opts.carry.fighting;
      this.fightId = opts.carry.fight;
      this.pick = opts.carry.pick ?? null;
    }

    this.unsubs.push(opts.emu.onFrame(() => this.onFrame()));
    this.unsubs.push(this.relay.on('recv', (ev) => this.onRelayRecv(ev)));
    this.unsubs.push(this.relay.on('roster', (ev) => this.onRoster(ev)));

    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      (window as unknown as { __br?: unknown }).__br = { bridge: this, roster: this.roster, mailbox: this.mailbox };
    }
  }

  /** Stops listening to the emulator and the relay, and lets go of every onMessage. */
  dispose(): void {
    for (const unsub of this.unsubs.splice(0)) unsub();
    this.listeners.clear();
  }

  /** Everything the room says to this page, once: decoded, validated, and from somebody
   *  entitled to say it (net/trust.ts), with the relay's `from` -- the sender, which a
   *  peer cannot forge. The page and its director used to take `recv` off the relay
   *  themselves, each decoding `m` again and none of them reading `from` (POK-330 #24).
   *  Released by dispose(), so a rejoin's new Bridge cannot leave a second copy
   *  listening. */
  onMessage(fn: (msg: Msg, from: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The fight in progress, for the Bridge that replaces this one (BridgeOptions.carry). */
  carry(): LinkCarry {
    return {
      opponentSeat: this.opponentSeat,
      heardLines: new Map(this.heardLines),
      sent: [...this.sentBlocks],
      lastRecvSeq: this.lastRecvSeq,
      fighting: this.fighting,
      fight: this.fightId,
      pick: this.pick,
    };
  }

  /** Says our last few blocks of the current fight to the opponent again (#7). The relay
   *  drops what is sent to a seat whose socket is down, and ours go nowhere while ours
   *  is, so one lost block left both ROMs waiting on each other for ever. The other side
   *  drops whatever it already had, by `seq`. */
  resendBlocks(): void {
    if (this.opponentSeat === null) return;
    for (const block of this.sentBlocks) this.relay.to(this.opponentSeat, block);
  }

  /** Asks the room's host for our drop again, if nothing has answered the last ask (POK-331
   *  #4): after our own socket's gap, and whenever the room's host changes or comes back.
   *  Only then, because the host answers every ask and the ROM warps to every `land` it
   *  gets: those are the gaps a first answer cannot have come through (a `land` from a
   *  host that no longer holds the room is refused on the way in). */
  resendPick(): void {
    if (!this.pick) return;
    this.pickHost = this.relay.hostId;
    this.pickHostAway = false;
    this.relay.all(this.pick);
  }

  /** Throws unless the ROM's mailbox is awake and speaking this protocol. Call once
   *  after boot, per mailbox.ts's own contract. */
  assertCompatible(): void {
    this.mailbox.assertCompatible(this.protocol);
  }

  get stats(): BridgeStats {
    return {
      frames: this.framesCount,
      in: this.inCount,
      out: this.outCount,
      drops: this.dropCount,
      refused: this.refusedCount,
      pending: this.mailbox.pending(),
    };
  }

  private onFrame(): void {
    this.framesCount++;
    if (!this.mailbox.isAwake()) return; // BrMailbox_Init has not run yet
    this.followRom();
    this.inCount += this.rom.flush();
    // Not `dropCount += drain(...)`: that reads the count before the handler adds to it.
    const unreadable = this.rom.drain((msg) => this.handleFromRom(msg));
    this.dropCount += unreadable;
    this.watchStall();
  }

  /** One message our ROM sent, on its way to the room. */
  private handleFromRom(msg: Msg): void {
    this.outCount++;

    let stamped = (this.keepsItsSeat(msg) ? msg : { ...msg, seat: this.seat }) as Msg;
    // Our own lines ride out with the challenge (POK-274), which is the only message
    // that reaches the other side before a fight starts.
    if (stamped.t === 'challenge' && this.myLines) stamped = { ...stamped, lines: this.myLines };
    this.noteChallenge(stamped);
    this.roster.applyMsg(stamped);
    // The drop: our pick waits on the host's `land`, and our own next place or step says
    // the ROM has come down, on that cell or on its own after giving up (br_pick.c).
    if (stamped.t === 'pick') {
      this.pick = stamped;
      this.pickHost = this.relay.hostId;
      this.pickHostAway = false;
    } else if (stamped.t === 'place' || stamped.t === 'step') {
      this.pick = null;
    }
    // Our ROM is out of the fight: its RESULT, or -- when the link never got going and
    // the watchdog closed it with no RESULT -- back on the map, which it never is while
    // gBrNetlink.active. Our last blocks are kept all the same: the ROM says RESULT
    // seconds after the final exchange, and the opponent may still be waiting on ours
    // (#7). Their own `result` lets them go, or the next challenge.
    if ((stamped.t === 'result' && stamped.seat === this.seat) || (stamped.t === 'busy' && !stamped.kind)) {
      this.fighting = false;
    }

    this.outObserver?.(stamped);
    // Observed either way -- this page's own spectator, loot and results all read the
    // ROM's messages -- but a watcher's never leave the page.
    if (this.outFilter && !this.outFilter(stamped)) return;

    if (stamped.t === 'bt') {
      // A block is for the one seat we are fighting and nobody else (#20). With no
      // opponent known it used to go to the whole room -- after every rejoin, since a
      // new Bridge knew nobody -- and every other pair's ROM took it as their own
      // opponent's next block.
      if (this.opponentSeat === null) {
        this.dropCount++;
        return;
      }
      this.fighting = true;
      const block: BlockMsg = this.fightId === null ? stamped : { ...stamped, fight: this.fightId };
      this.sentBlocks.push(block);
      if (this.sentBlocks.length > BLOCKS_KEPT) this.sentBlocks.shift();
      this.relay.to(this.opponentSeat, block);
      return;
    }
    // A challenge is broadcast too, not addressed: a bot is not a member of the room, so
    // `to` a bot's seat reached nobody and the host that walks it never heard one of its
    // bots had been challenged (POK-238). br_netlink.c's HandleChallenge ignores one that
    // names neither side.
    this.relay.all(stamped);
  }

  /** Whether a message our ROM sent keeps the seat it wrote, rather than ours. A report
   *  on a fight with a bot (SPEAKS_FOR_ANOTHER) always does; so does the RESULT the ROM
   *  writes under a bot that lost (br_bot.c), which the stamp turned into the player
   *  losing the fight they had just won. */
  private keepsItsSeat(msg: Msg): boolean {
    if (SPEAKS_FOR_ANOTHER.has(msg.t)) return true;
    return msg.t === 'result' && msg.seat !== this.seat && this.roster.isBot(msg.seat);
  }

  private onRelayRecv(ev: RecvEvent): void {
    let msg: Msg;
    try {
      msg = decode(JSON.stringify(ev.m));
    } catch {
      this.dropCount++;
      return;
    }
    const host = this.relay.hostId;
    if (!admits(msg, ev.from, { host, members: this.members })) {
      this.refusedCount++;
      return;
    }
    // Our own message, echoed back. The relay never echoes, and trust holds everybody
    // else to their own seat, so a message naming us that gets this far is the host
    // speaking ABOUT us: `land` answering our `pick` (POK-223), the `out` a seat back
    // from a blip learns it went with (POK-330 #25), the `win` that crowns us, a ticker
    // line, the loot owed where we stand. Dropping those as echoes left a guest who won
    // with no results and no Hall of Fame.
    if (msgSeat(msg) === this.seat && ev.from !== host) return;
    if (msg.t === 'bt' && !this.takesBlock(msg, ev.from)) return;
    // The opponent's ROM has played the fight out, so it has every block of ours it will
    // ever need -- and ours will get none more from it (watchStall).
    if (msg.t === 'result' && msg.seat === this.opponentSeat && ev.from === msg.seat) {
      this.sentBlocks = [];
      this.opponentDone = true;
    }
    // Our drop answered -- or a match begun or ended, and a pick of the last one is
    // nothing to ask the next one's host.
    if ((msg.t === 'land' && msg.seat === this.seat) || msg.t === 'start' || msg.t === 'win') this.pick = null;

    this.noteChallenge(msg);
    this.roster.applyMsg(msg);
    // JSON-only messages (accept/decline/win/ready/...) have nothing to push, and reach
    // the page all the same.
    if (crossesToRom(msg.t) && (!this.romFilter || this.romFilter(msg))) {
      if (!this.rom.push(msg)) this.dropCount++; // the ROM cannot take it; the page still hears it
    }
    for (const fn of [...this.listeners]) fn(msg, ev.from);
  }

  /** A block is taken from the seat we are fighting and nobody else (#20) -- the ROM
   *  delivers whatever it is handed as the other side's next block -- and only once
   *  (#7): the other side says its last few again after a gap. */
  private takesBlock(msg: BlockMsg, from: number): boolean {
    if (this.opponentSeat === null || from !== this.opponentSeat || msg.seat !== this.opponentSeat) {
      this.refusedCount++;
      return false;
    }
    // ...and from this fight: the last one's, said again by a rejoin, would be read as this
    // one's next (POK-331 #3). A block with no fight on it is from a page before that.
    if (msg.fight !== undefined && this.fightId !== null && msg.fight !== this.fightId) {
      this.refusedCount++;
      return false;
    }
    if (msg.seq <= this.lastRecvSeq) return false;
    this.lastRecvSeq = msg.seq;
    this.fighting = true;
    this.quietFrames = 0;
    // A RESULT from them that this block came after was their last fight's, crossing our
    // new challenge on the way: they are in this one.
    this.opponentDone = false;
    return true;
  }

  /** The relay's roster: the room's rows, who is in it for net/trust.ts, and our
   *  opponent coming back from a gap -- when what we said meanwhile is said again. */
  private onRoster(ev: RosterEvent): void {
    this.roster.applyRoster(ev);
    this.members = new Set(ev.members.map((m) => m.id));
    this.repick(ev.host);
    if (this.opponentSeat === null) return;
    const here = this.members.has(this.opponentSeat);
    if (here && this.opponentAway) this.resendBlocks();
    this.opponentAway = !here;
  }

  /** The host our pick went to left the room, or it has a new host: ask whoever holds it
   *  now, once they are here. Not ourselves -- our own ROM's pick is our own director's to
   *  answer, from the ROM, and the ROM gives up on its own. */
  private repick(host: number): void {
    if (!this.pick) return;
    if (this.pickHost !== null && !this.members.has(this.pickHost)) this.pickHostAway = true;
    if (host === this.seat || !this.members.has(host)) return;
    if (host !== this.pickHost || this.pickHostAway) this.resendPick();
  }

  setRomFilter(fn: ((msg: Msg) => boolean) | null): void {
    this.romFilter = fn;
  }

  /** TRUE from `fn` lets this ROM's message out to the room; FALSE keeps it here. */
  setOutFilter(fn: ((msg: Msg) => boolean) | null): void {
    this.outFilter = fn;
  }

  setOutObserver(fn: ((msg: Msg) => void) | null): void {
    this.outObserver = fn;
  }

  /** Hands a message straight to this ROM without it ever touching the relay: the
   *  spectator's own `follow`, which is a page's word to its own ROM (docs/WIRE.md). */
  pushToRom(msg: Msg): void {
    if (msg.t === 'land' && msg.seat === this.seat) this.pick = null; // the host's own drop
    if (!crossesToRom(msg.t)) return;
    if (!this.rom.push(msg)) this.dropCount++;
  }

  /** Remembers who we are fighting, so a later `bt` (which does not itself name a
   *  seat) knows where to route -- and what they say, if they told us (POK-274). */
  private noteChallenge(msg: Msg): void {
    if (msg.t !== 'challenge' && msg.t !== 'accept') return;
    // A challenge is broadcast, so the lines on one are worth keeping whoever it is
    // about: the room hears every duel announced, not just its own.
    if (msg.lines && msg.seat !== this.seat) this.heardLines.set(msg.seat, msg.lines);
    if (msg.t !== 'challenge') return;
    // Challenges are broadcast, so most of them are about two other people: noting one
    // of those would point our own battle traffic at a seat we are not fighting.
    if (msg.seat !== this.seat && msg.opponent !== this.seat) return;
    const them = msg.seat === this.seat ? msg.opponent : msg.seat;
    // Noted even when ignored below: `fighting` can outlast the ROM's link by a few frames
    // (a hello the watchdog closed says so only with its `busy`), and a ROM free by then
    // starts this one, which followRom must name as this one and not their last.
    this.fights.set(them, fightOf(msg));
    // Somebody else's challenge to us while we fight is one our ROM ignores (#20). Our
    // own is never mid-fight: br_engage.c only challenges from the field. The ROM says it
    // is in one from the frame it starts it (POK-331 #5), before this page can have seen
    // a block move.
    if (msg.seat !== this.seat && (this.fighting || this.romLink()?.active)) return;
    this.pointAt(them, fightOf(msg));
  }

  /** A new fight, and a new count: the ROM numbers every fight's blocks from one. */
  private pointAt(seat: number, fight: number | null): void {
    this.opponentSeat = seat;
    this.fightId = fight;
    this.sentBlocks = [];
    this.lastRecvSeq = 0;
    this.opponentAway = false;
    this.fighting = false;
    this.opponentDone = false;
    this.quietFrames = 0;
  }

  /** gBrNetlink, read fresh (POK-331 #5); null with no symbol to read it by. */
  private romLink(): LinkState | null {
    if (this.netlinkBase === undefined || !this.mailbox.isAwake()) return null;
    return readNetlink(this.ram, this.netlinkBase);
  }

  /** Two challenges that land before the ROM runs a frame are taken the other way round:
   *  on the field the ROM starts on the first and ignores the second, where this page
   *  pointed at the latest. Whoever the ROM is linked with is who the blocks are for. */
  private followRom(): void {
    const link = this.romLink();
    if (!link?.active || link.peerSeat === this.opponentSeat) return;
    this.pointAt(link.peerSeat, this.fights.get(link.peerSeat) ?? null);
  }

  /** #7's backstop (POK-331 #3). The ROM's own watchdog covers the hello and a peer that
   *  goes out; a fight whose opponent is still in the room but has stopped sending -- a
   *  block lost past what the resends cover, a ROM stuck over there -- waited on a black
   *  screen for good. Past STALL_FRAMES the page hands the fight to that watchdog, which
   *  closes it as unanswered: forfeited, unwound, and a RESULT out (net/netlink.ts).
   *
   *  Counted in our own frames, so a hidden tab, which runs none, never counts (and is
   *  asked besides); and only while our socket is up, the opponent is in the room, and the
   *  engine has not decided the fight -- an ending is the ROM's to play out. */
  private watchStall(): void {
    const link = this.romLink();
    const quiet =
      link !== null && link.active && link.peerSeat === this.opponentSeat && this.members.has(link.peerSeat) &&
      this.relay.isOpen() && !this.hidden() && !this.decided();
    if (!quiet) {
      this.quietFrames = 0;
      return;
    }
    const limit = this.opponentDone ? STALL_AFTER_RESULT_FRAMES : STALL_FRAMES;
    if (++this.quietFrames < limit) return;
    this.quietFrames = 0;
    console.warn(`[link] no block from seat ${link.peerSeat} in ${limit} frames: closing the fight as unanswered`);
    closeAsSilent(this.ram, this.netlinkBase!);
  }

  /** gBattleOutcome is set: the engine has decided the fight (StartBattle zeroes it). */
  private decided(): boolean {
    return this.outcomeBase !== undefined && this.ram.read(this.outcomeBase, 8) !== 0;
  }

  /** What a seat said when it challenged somebody (POK-274), or undefined if this page
   *  has never heard from them -- a bot never does, so its lines stay the seed's. */
  linesFor(seat: number): Lines | undefined {
    return this.heardLines.get(seat);
  }
}
