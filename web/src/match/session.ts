// One match's books, kept the same way whoever is keeping them (POK-330 #42).
//
// The room and solo each kept their own: the room in wireRoom's closure, solo in
// runSolo's, and each lifecycle step reset a different share of it. The two had
// drifted before anybody noticed -- solo never routed its fights to the bots (#17), the
// host's results never saw its own bots go out (#16), PLAY AGAIN kept half the last
// match (#22). So everything the page learns about the match it is in goes through
// one note(msg, via), and the books are here: the match as anybody can see it, the loot,
// the results, the record, the round's log, who is busy, and the verdict.
//
// No page here: storage, the ROM and the screen are handed in, so vitest drives it.
import { routeToBots } from '../bots/adapt';
import type { Bots } from '../bots/brain';
import type { RosterEvent } from '../net/relay';
import type { Msg, PackedMon, SpillMsg } from '../net/wire';
import { careerLine, recordMatch } from './career';
import { DEFAULT_FOG_SECS } from './director';
import type { EndGrace } from './grace';
import { botRows, freshMatch, noteMatch, type MatchSnapshot } from './lifecycle';
import { MatchLog, saveMatch } from './log';
import { Loot } from './loot';
import { MatchRecord } from './record';
import { Results } from './results';
import type { Roster } from './roster';

/** Where a message came from, which decides what else it does.
 *  - 'page': made here -- our bots, our director, the host speaking for a seat. Booked,
 *    never routed to the bots and never anybody's busy: the page that made it knows.
 *  - 'rom': our own ROM, after the roster has heard it (the Bridge applies it first).
 *  - { from }: the room, as the Bridge handed it over, from the seat that said it. */
export type Via = 'page' | 'rom' | { from: number };

export interface SessionDeps {
  /** Our seat, or null before there is one (a room not yet joined): no verdict then. */
  mySeat(): number | null;
  /** What the round's log calls a seat. */
  nameOf(seat: number): string;
  /** The roster a `start` seats the bots on, by the names the seed gave them. */
  rows(): Roster | null;
  /** The relay's last roster, which a guest reads the bots off. */
  relayRoster(): RosterEvent | null;
  /** This page dealt the match now starting, and has set its bot seats already. */
  dealing(): boolean;
  /** The brain this page walks, when it walks one: read at each note. */
  bots(): Bots | null;
  /** Into our own ROM, and nowhere else. */
  toRom(msg: Msg): void;
  /** The fog for a `start` that names none. Left out, the director's own: solo's, so
   *  its books and its director cannot start from two different fogs. */
  defaultFog?(): number;
  /** Where the career and the saved rounds go: localStorage on the page. */
  store: Pick<Storage, 'getItem' | 'setItem'>;
  grace: EndGrace;
  /** Out of a decided match, once its grace is up. */
  exit(): void;
  now?(): number;
}

/** What the screen does about it. */
export interface SessionView {
  /** A match is on. */
  started?(): void;
  /** Our match was decided: draw the results, with the career line under them. */
  decided(careerLine: string): void;
  /** A team arrived after the results were drawn: the champion's parade (POK-243).
   *  Not optional: solo went without it, and its champion's team was never drawn. */
  partyLate(): void;
}

/** A bag we just took hands its contents over (POK-280).
 *
 *  Kanto's rule is that a fallen trainer's BAG is items AND money, taken whole in one
 *  press. Ours gave the cash and left the items lying there, because the ROM never kept
 *  them: `ParseSpill` skips the item rows on purpose, the loot table has room for eight
 *  pieces on a map and none for what is inside one, and EWRAM has eighty bytes left to
 *  argue with. Bots did not lose out -- `bag.ts` folds a bag on the ground into their own
 *  -- so a player was the only one getting a worse deal than Kanto's.
 *
 *  The page has held the contents for the whole match anyway (match/loot.ts), so it gives
 *  them over: the ROM says the whole piece is leaving the ground, this answers with what
 *  was in it. **Call before loot.note**, which is what deletes the piece.
 *
 *  A `pickup` that names an item is a bot taking one stack out of a bag that stays where
 *  it is (POK-237), not the bag itself; and `bagItems` is undefined for a ball, so a mon
 *  never reaches this. */
export function giveBag(loot: Loot, msg: Msg, push: (m: Msg) => void): void {
  if (msg.t !== 'pickup' || msg.item !== undefined) return;
  const items = loot.bagItems(msg.key);
  if (items && items.length > 0) push({ t: 'give', items });
}

/** Who is in a battle or a menu right now, off the ROMs' own `busy` (POK-230). The
 *  eyeline needs it: a bot does not challenge somebody already fighting. */
export function noteBusy(busy: Set<number>, msg: Msg): void {
  if (msg.t === 'busy') {
    if (msg.kind === 'battle') busy.add(msg.seat);
    else busy.delete(msg.seat);
  } else if (msg.t === 'out') {
    busy.delete(msg.seat);
  }
}

export class MatchSession {
  /** Everything a promoted client needs to pick the match up (POK-252). One object for
   *  the page's whole life -- the e2e reads it -- so a new match fills it in again. */
  readonly match: MatchSnapshot = freshMatch();
  readonly results = new Results();
  /** What each seat did in the match, for the card under the parade (POK-303). */
  readonly record = new MatchRecord();
  readonly log = new MatchLog();
  /** The last team each seat was seen carrying, from any `party` that crossed the page.
   *  Kept for one thing (POK-243): the champion's own ROM sends its party as the parade
   *  starts, and the results screen is the shell's half of that parade. A `party` is
   *  otherwise an answer to a spectator's peek and belongs to whoever asked. Solo keeps
   *  them too (POK-331 #26): Kanto's solo is the room with nobody else in it, and a solo
   *  champion's parade has the same team under it as a room's. */
  readonly parties = new Map<number, PackedMon[]>();
  /** Who is in a battle or a menu (noteBusy). */
  readonly busy = new Set<number>();
  /** Seats the host has already caught up on the running match. A seat that leaves is
   *  taken off it, so coming back is a late arrival like any other (POK-330 #25). */
  readonly greeted = new Set<number>();
  /** Seats caught up on everything but the loot where they stand, which waits for their
   *  first `place` to say where that is. */
  readonly owedLoot = new Set<number>();
  readonly grace: EndGrace;

  // The ROM only holds the loot for the map it is standing on, and forgets it on the way
  // out; the page holds the match's whole table and hands back the piece that matters
  // every time our own trainer arrives somewhere (POK-232). Renewed by endMatch: last
  // match's unclaimed pieces were pushed back into the rebooted ROM, and bots walked to them.
  private lootTable = new Loot();
  private lootMap: string | null = null;
  /** The match's fog phase, from its `start`: what a `ring` puts on the clock. A watcher
   *  who walked in late never heard one, and has the default the director would use. */
  private fogSecs: number;
  private field = 0;
  private booked = false;
  private readonly now: () => number;

  constructor(
    private readonly deps: SessionDeps,
    private readonly view: SessionView,
  ) {
    this.grace = deps.grace;
    this.fogSecs = this.defaultFog();
    this.now = () => (deps.now ? deps.now() : performance.now());
  }

  private defaultFog(): number {
    return this.deps.defaultFog?.() ?? DEFAULT_FOG_SECS;
  }

  get loot(): Loot {
    return this.lootTable;
  }

  get fog(): number {
    return this.fogSecs;
  }

  /** How many seats the match started with: what a placement is "of". */
  get fieldSize(): number {
    return this.field;
  }

  /** Our match has been decided and its results drawn. */
  get recorded(): boolean {
    return this.booked;
  }

  /** Everything that decides a placement crosses the page one way or another: our own
   *  ROM's messages on the way up, everybody else's on the way in, and whatever the page
   *  makes itself. In this order:
   *   1. our own ROM taking a whole bag: its contents go back (giveBag, before the loot);
   *   2. the loot table;
   *   3. the match (noteMatch); on a `start`, the bots on the roster by name, before the
   *      log below takes its names (POK-330 #51), and the screen told;
   *   4. a `party`, kept, and the results drawn again if they are up already;
   *   5. on a `start`, the results, the record and the verdict begin again;
   *   6. the results, the record and the round's log (POK-248);
   *   7. the first `win` we hear: the round saved, the career counted, the results drawn,
   *      the ROM told who won, and the grace armed;
   *   8. anything the page did not make itself: who is busy;
   *   9. ...and a fight with one of our bots, to the brain, with whose ROM said it. */
  note(msg: Msg, via: Via): void {
    const now = this.now();
    if (via === 'rom') giveBag(this.lootTable, msg, (m) => this.deps.toRom(m));
    this.lootTable.note(msg); // a bot taking a ball takes it off this page's table too
    // The match, as anybody in the room can see it.
    this.fogSecs = noteMatch(this.match, this.fogSecs, msg, now, {
      dealing: this.deps.dealing(),
      roster: this.deps.relayRoster(),
      defaultFog: this.defaultFog(),
    });
    if (msg.t === 'start') {
      // The bots go on the roster by the names the seed gave them, which every page can
      // work out (POK-330 #51) -- before the log below takes its names.
      this.deps.rows()?.seatBots(botRows(msg.seed, this.match.botSeats));
      this.view.started?.();
    }
    if (msg.t === 'party') {
      this.parties.set(msg.seat, msg.mons);
      // The champion's own party arrives after the `win` that put the results on
      // screen -- their ROM sends it as the parade starts (POK-243) -- so the panel
      // is drawn again rather than waiting for a team that came too late.
      if (this.booked) this.view.partyLate();
    }
    if (msg.t === 'start') {
      this.field = msg.spawns.length;
      this.results.start(this.field, now);
      this.record.start();
      this.booked = false;
    }
    this.results.note(msg, now);
    this.record.note(msg);
    // ...and the round is written down as it happens (POK-248). The same messages
    // placement is derived from, kept in a shape the round can be read back from.
    this.log.note(msg, now, (seat) => this.deps.nameOf(seat));
    const me = this.deps.mySeat();
    if (msg.t === 'win' && me !== null && !this.booked) this.decide(msg.seat, me, now);
    if (via === 'page') return;
    noteBusy(this.busy, msg);
    // A bot's fight runs in whoever fought it, and what that ROM reports goes to the
    // brain: our own ROM's under our seat, the room's under the seat that sent it.
    const bots = this.deps.bots();
    const from = via === 'rom' ? me : via.from;
    if (bots && from !== null) routeToBots(bots, msg, from);
  }

  private decide(winner: number | undefined, me: number, now: number): void {
    this.booked = true;
    const round = this.log.current(now);
    if (round) saveMatch(round, this.deps.store);
    const mine = this.results.forSeat(me, now);
    this.view.decided(careerLine(recordMatch(mine.placement, this.deps.store)));
    // And the ROM is told who won (POK-243's parade, POK-281). `win` is a page-side
    // verdict with no codec, so it has never crossed to any ROM: the Hall of Fame has
    // been reachable only by a driver poking the RESULT slot by hand, which is exactly
    // why nobody ever saw it. One push serves the whole room -- the winner's own ROM
    // matches the seat and runs the parade, and everybody else's ends a replay of a
    // fight whose fighter has just taken the match (BrSpectate_OnResult).
    // A `win` with no seat is a draw -- nobody to crown, and nothing to end a replay on.
    if (winner !== undefined) this.deps.toRom({ t: 'result', seat: winner, outcome: 'win' });
    // "If the game is over I should be kicked back to the main menu." Nothing took
    // anybody out of a finished match: the page drew the results panel over a ROM that
    // went on walking Hoenn. Kanto's shape (main.lua, END_GRACE_SECONDS): everybody reads
    // the result for a moment, then one funnel takes them all out. Won, it waits for the
    // Hall of Fame rather than a timer.
    this.deps.grace.arm(() => this.deps.exit(), winner === me);
  }

  /** The loot standing where our own trainer has just arrived, once per map (POK-232).
   *  Our own `place` is how the page learns we changed maps -- there is no separate "I
   *  have arrived" message, and this one is already on the wire four times a second. */
  standingLoot(msg: Msg): SpillMsg | null {
    if (msg.t !== 'place' || !msg.map) return null;
    const key = `${msg.map.group}:${msg.map.num}`;
    if (key === this.lootMap) return null;
    this.lootMap = key;
    return this.lootTable.forMap(msg.map);
  }

  /** Forgets the last match before the ROM starts over (POK-330 #22): what the room heard
   *  of it, its loot, who was busy in it and who had been caught up on it. The results,
   *  the record and the log stay up until the next `start`, and so does the verdict: a
   *  champion's party can still land while the ROM reboots. */
  endMatch(): void {
    Object.assign(this.match, freshMatch());
    this.lootTable = new Loot();
    this.lootMap = null;
    this.busy.clear();
    this.greeted.clear();
    this.owedLoot.clear();
  }

  /** ...and the verdict, once it has: last match's champion is not this match's, and the
   *  parade reads by seat (POK-243) -- a seat that wins twice would otherwise be shown
   *  the team it had the first time, and one that never sends a `party` would be shown
   *  somebody else's. */
  forgetResult(): void {
    this.booked = false;
    this.parties.clear();
  }
}
