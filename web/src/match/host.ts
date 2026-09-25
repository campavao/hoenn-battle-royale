// The page that runs the match (POK-330 #42): its director, its bots, the ticker, the
// answers to a drop and a peek, and the catch-up for somebody who walks in on it.
//
// It lived in wireRoom's closure as seven mutable locals -- the director, the bots, three
// handles on the director's ear, its loop and the departure timers -- and each way out of
// running the match (standing down, a dropped socket, PLAY AGAIN) let go of a different
// share of them (#13). One of these per deal now, and dispose() lets go of all of it.
//
// No page here: the room and our own ROM are a HostLink handed in, and the HUD loop is the
// caller's, so vitest drives it over a fake relay.
import { createHostBots, type BotResume, type HostBots } from '../bots/host';
import type { BotsOptions } from '../bots/brain';
import { voiceFor, type BotVoice } from '../bots/lines';
import { romCell } from '../bots/space';
import { MAP_OFFSET, toRomCells } from '../net/cells';
import type { Lines, Msg, TickerMsg } from '../net/wire';
import { Director, type DirectorOptions, type DirectorWorld } from './director';
import { catchUp, departedSeats, lootOwed, type DealPlan } from './lifecycle';
import { clockLeftAt } from './room';
import type { Roster } from './roster';
import type { MatchSession } from './session';
import * as Ticker from './ticker';

/** Where the host's messages go. The room's reads whichever Bridge the page has now,
 *  never one caught at the deal; solo's has no room at all. */
export interface HostLink {
  /** Our own seat: stamped on the director's messages, and a card for it is a push. */
  readonly seat: number;
  /** The page's roster: the bots' eyeline, and where the room last saw everybody. */
  readonly roster: Roster;
  /** To everybody else in the room. */
  toRoom(msg: Msg): void;
  /** To one seat in it. */
  toSeat(seat: number, msg: Msg): void;
  /** Into our own ROM, through the page's one writer (net/romport.ts). */
  toRom(msg: Msg): void;
  /** ...the same, counted in the Bridge's own stats: the `land` for our own pick. */
  pushToRom(msg: Msg): void;
  /** The room's door (POK-260), with the bots' seats held while it is shut. */
  lock?(locked: boolean, botSeats?: number[]): void;
  /** What a seat said it says in a fight, when it told us (POK-274). */
  linesFor?(seat: number): Lines | undefined;
}

/** Solo's link: nobody at the other end, so the room hears nothing and there is no door
 *  to shut, and everything for our own seat -- a card, a `land` -- goes into our own ROM. */
export function soloLink(roster: Roster, toRom: (msg: Msg) => void): HostLink {
  return { seat: 0, roster, toRoom: () => {}, toSeat: () => {}, toRom, pushToRom: toRom };
}

export interface HostOptions {
  session: MatchSession;
  link: HostLink;
  world: DirectorWorld;
  /** Who the match is dealt to now (seatsFor). */
  seats: number[];
  /** Everybody in the room at the deal. */
  present: readonly number[];
  plan: DealPlan;
  /** How many bots to deal. */
  fill: number;
  /** Seconds of opening the bots spend in the Zone. */
  botSafariSecs: number;
  options?: DirectorOptions['options'];
  zonePool(): number[];
  settle?: BotsOptions['settle'];
  /** The ticker, and our own seat's lines on it. Without it nothing is narrated. */
  narration?: { mine(): BotVoice };
  /** The director's HUD pump; hands back its disposer. */
  startLoop(director: Director): () => void;
  now?(): number;
}

type Departures = { rejoinMs: number; isHost(): boolean; stillHere(seat: number): boolean };

export class HostRole {
  readonly director: Director;
  readonly bots: HostBots;
  readonly seed: number;

  private readonly session: MatchSession;
  private readonly link: HostLink;
  private readonly plan: DealPlan;
  private readonly hostSeat: number;
  private readonly narration?: { mine(): BotVoice };
  private readonly startLoop: (director: Director) => () => void;
  private readonly now: () => number;
  private readonly seen = new Set<number>(); // seats already announced out, so a repeat is quiet
  /** The director's own elimination handler, for `out`s this page makes itself. */
  private localOut: ((seat: number) => void) | null = null;
  /** Announces a seat out of the match to the whole room (POK-271). A seat that closed its
   *  tab has to be eliminated by somebody, and the host is the only client that can:
   *  nobody hears their own messages, so the one who left cannot say it about themselves. */
  private announceOut: ((seat: number) => void) | null = null;
  /** The director's ear on the room: what the Bridge let through, and nothing else. */
  private directorHears: ((m: Msg) => void) | null = null;
  private stopLoop: (() => void) | null = null;
  /** Seats the roster has stopped listing, with the timer that will finish them off
   *  (POK-271). A tab that reconnects inside the grace keeps its place: a blip on
   *  somebody's wifi is not a forfeit, and the relay hands a returning client the seat
   *  it had. The wait is a timer rather than the next roster event, because a
   *  departure is usually the LAST roster event -- nothing else is coming to notice
   *  it on.
   *
   *  The grace is the relay's own seat hold (relay.rejoinMs), so there is one window: it
   *  was ten seconds here against the relay's sixty, and a seat that came back in the
   *  fifty between walked into a match that had already eliminated it (POK-330 #25). */
  private readonly leaving = new Map<number, ReturnType<typeof setTimeout>>();
  private begun = false;

  /** Deals the bots and builds the director, in the order the room has always seen: the
   *  door shut, the bots' places, the door shut on their seats. Never a `start`: that is
   *  begin()'s. */
  constructor(opts: HostOptions) {
    const { session, link, plan, seats } = opts;
    this.session = session;
    this.link = link;
    this.plan = plan;
    this.seed = plan.seed;
    this.hostSeat = link.seat;
    this.narration = opts.narration;
    this.startLoop = opts.startLoop;
    this.now = opts.now ?? (() => performance.now());
    const seed = this.seed;
    // Everybody in the room now was dealt in, or on a takeover has been hearing the match
    // all along: only somebody who arrives, or comes back, needs catching up.
    for (const id of opts.present) session.greeted.add(id);
    // The door shuts when the match starts, wherever the start came from (POK-260).
    // It used to be the START button's job alone, so a match dealt by the ten-second
    // buzzer left the room open -- latecomers walked into a running match as players,
    // and quick play offered it as somewhere to join rather than somewhere to watch.
    link.lock?.(true);
    const resume: BotResume | undefined = plan.resume
      ? {
          ...plan.resume,
          where: (seat: number) => {
            const row = link.roster.all().find((e) => e.seat === seat);
            return row?.map && row.x !== undefined && row.y !== undefined
              ? { map: row.map, ...romCell(row.x, row.y) }
              : undefined;
          },
        }
      : undefined;
    const narrated = opts.narration !== undefined;
    // The host speaks for the bots as well as for the clock: same relay, same in-ring,
    // and its own roster too -- nobody hears their own messages come back, so the host
    // would otherwise be the one client that cannot see the bots it is walking.
    this.bots = createHostBots({
      send: (msg) => {
        // The wire is the ROM's coordinate space (net/cells.ts): every client's ghosts
        // are drawn from it, and a player's own `place` already arrives that way.
        const wire = toRomCells(msg);

        this.hostSays(wire);
        if (wire.t === 'out') this.localOut?.(wire.seat);
      },
      takenSeats: seats,
      seed,
      loot: session.loot,
      players: () => link.roster.all(),
      // A trainer card is for the one player it is a challenge to. The host's own ROM
      // never hears itself over the relay, so its copy is a direct push.
      sendTo: (toSeat, msg) => {
        if (toSeat === link.seat) link.toRom(msg);
        else link.toSeat(toSeat, msg);
      },
      // The kill feed. A duel is the only moment both sides of a fight are known at
      // once -- an `out` on its own cannot say who did it.
      onDuel: narrated
        ? (winner, loser) => {
            this.say(Ticker.beat(winner, this.nameOf(winner), this.nameOf(loser)));
            // And they say something about it (POK-239). Dealt from the seed, so the same
            // bot has the same voice all match on every client that works it out -- unless
            // the seat that just fought is this client's own, in which case it is whatever
            // voice its profile picked (POK-243): the same pipe a bot gets, handed to the
            // one player who actually gets to choose it. Any *other* real player still
            // falls back to the seed, the same as a bot -- their own pick lives only in
            // their own localStorage, and nothing on the wire carries it here yet.
            this.say(Ticker.said(winner, this.nameOf(winner), this.myVoice(winner, seed).win));
            this.say(Ticker.said(loser, this.nameOf(loser), this.myVoice(loser, seed).lose));
          }
        : undefined,
      // Walking up to somebody is the other time a bot has something to say.
      onEngage: narrated
        ? (seat) => this.say(Ticker.said(seat, this.nameOf(seat), this.myVoice(seat, seed).intro))
        : undefined,
      fill: opts.fill,
      resume,
      safariSecs: opts.botSafariSecs,
      zonePool: opts.zonePool,
      busy: (s) => session.busy.has(s),
      sections: opts.world.sections,
      settle: opts.settle,
      now: this.now,
    });
    // Which seats are bots, said once rather than guessed at by everything downstream:
    // the ones walked here, or on a takeover every one the match was dealt, dead or not.
    session.match.botSeats = new Set(resume ? resume.botSeats : this.bots.seats);
    // The bots' seats are spoken for until the match ends: the relay hands a latecomer
    // the lowest id nobody is using, and a bot's seat looks unused to it (POK-330 #6).
    link.lock?.(true, this.bots.seats);
    this.director = new Director({
      // Bots are contestants, not scenery: leaving them out of the seat list makes
      // "N LEFT" a lie and hands the match to whoever outlasts the humans alone.
      // A takeover inherits the field the match was dealt with, not the room as it
      // stands now: people who have already been eliminated are still in it, and
      // resume() is what takes them back out.
      seats: plan.takeOver && session.match.seats.length > 0 ? session.match.seats : [...seats, ...this.bots.seats],
      options: opts.options,
      hostSeat: this.hostSeat,
      seed,
      world: opts.world,
      send: (msg) => this.directorSends(msg),
      now: this.now,
      onOut: (handler) => this.listen(handler),
    });
  }

  /** Starts the match, once: a `start` for everybody, or on a takeover the match the wire
   *  already said, picked up where it stands. Then the director's own loop. */
  begin(): void {
    if (this.begun) return;
    this.begun = true;
    const { director, plan } = this;
    const match = this.session.match;
    if (plan.takeOver) {
      // The old host's tab went away and the relay handed us the room (POK-252).
      // Everybody already has a `start`, a drop and a ring, so dealing again would
      // restart the match under them: pick up what the wire already said instead.
      director.resume({
        ringPhase: match.ringPhase,
        centre: match.centre,
        // counted off since it was heard or kept: a host back from a drop is that much
        // further on, as every guest's ROM is
        secsLeftInPhase: clockLeftAt(match, this.now()),
        out: [...match.out, ...plan.gone],
        // The old host's list of dealt cells left with it. What `start` dealt, and where
        // everybody stands now (a `land` is unicast, so a trainer who dropped and has not
        // moved is only known by their `place`), back out of the ROM's space.
        dealt: [
          ...match.spawns,
          ...this.link.roster.all().flatMap((e) =>
            e.map && e.x !== undefined && e.y !== undefined ? [{ map: e.map, x: e.x - MAP_OFFSET, y: e.y - MAP_OFFSET }] : [],
          ),
        ],
      });
      // And the room is told about the ones who walked out, so every roster agrees
      // with the count this page is now keeping.
      for (const seat of plan.gone) this.hostSays({ t: 'out', seat });
      this.say(Ticker.said(this.hostSeat, this.nameOf(this.hostSeat), 'I HAVE THE CLOCK.'));
    } else {
      director.start();
    }
    this.stopLoop = this.startLoop(director);
  }

  /** What the page heard, after the books have: our own ROM's messages, or the room's
   *  from the seat that said them. */
  hear(msg: Msg, via: 'rom' | { from: number }): void {
    if (via === 'rom') {
      // Our own ROM's pick never comes back over the relay either.
      if (msg.t === 'pick') this.link.pushToRom({ t: 'land', ...this.director.landFor(msg.seat, msg.section) });
      // Our own ROM saying we are out. Nobody hears their own messages come back over
      // the relay, so without this the director never counts this client's own
      // elimination and the match it is running cannot reach a winner.
      if (msg.t === 'out') this.localOut?.(msg.seat);
      return;
    }
    const { from } = via;
    this.directorHears?.(msg);
    // The drop (POK-223): a trainer chose a section, the host deals them a cell
    // inside it that nobody else has. Only the host answers -- everyone hears the
    // `pick`, and two answers would put two trainers on two different tiles.
    if (msg.t === 'pick') {
      const land = this.director.landFor(msg.seat, msg.section);
      if (msg.seat === this.link.seat) this.link.pushToRom({ t: 'land', ...land });
      else this.link.toSeat(msg.seat, { t: 'land', ...land });
    }
    // A seat the host has just caught up on the match learns what is lying where it
    // stands, once its first `place` or `step` has said where that is (POK-330 #25).
    const standing = lootOwed(this.session.owedLoot, msg, from, (map) => this.session.loot.forMap(map));
    if (standing) this.link.toSeat(from, standing);
    if (msg.t === 'peek' && msg.target !== this.link.seat) {
      // A bot has no ROM to answer for it, so the host that walks it does.
      const party = this.bots.partyFor(msg.target);
      if (party) this.link.toSeat(msg.seat, party);
    } else if (msg.t === 'out') {
      this.bots.bots.remove(msg.seat); // a bot that is out stops being walked around
    }
  }

  /** Who is gone, off the relay's members: a timer each, and whoever is still gone when it
   *  runs out is out of the match. Back, or out anyway, and the timer stops. */
  watchDepartures(members: readonly number[], o: Departures): void {
    const match = this.session.match;
    // Never the bots (POK-330 #4): no roster lists them, so every roster event used to
    // count every bot still standing as gone, and ten seconds later they all were.
    const gone = new Set(departedSeats(match.seats, match.botSeats, members, match.out));
    // Back, or out anyway: whatever was counting them down stops.
    for (const [seat, timer] of this.leaving) {
      if (gone.has(seat)) continue;
      clearTimeout(timer);
      this.leaving.delete(seat);
    }
    for (const seat of gone) {
      if (this.leaving.has(seat)) continue;
      this.leaving.set(
        seat,
        setTimeout(() => {
          this.leaving.delete(seat);
          // Still gone, still in the match, and we are still the one running it.
          if (!o.isHost() || match.out.has(seat)) return;
          if (o.stillHere(seat)) return;
          console.info(`[room] seat ${seat} left the match`);
          this.announceOut?.(seat);
        }, o.rejoinMs),
      );
    }
  }

  /** Catches up whoever in `members` has not been yet, and forgets whoever has left, so a
   *  seat back from a blip is caught up again (POK-330 #25). Not once the match is won. */
  greet(members: readonly number[]): void {
    const state = this.director.state;
    if (state.phase === 'ended') return;
    const { greeted, owedLoot } = this.session;
    const here = new Set(members);
    for (const seat of [...greeted]) {
      if (here.has(seat)) continue;
      greeted.delete(seat);
      owedLoot.delete(seat);
    }
    for (const id of members) {
      if (id === this.link.seat || greeted.has(id)) continue;
      greeted.add(id);
      owedLoot.add(id);
      for (const msg of catchUp(this.link.seat, state)) this.link.toSeat(id, msg);
    }
  }

  botCount(): number {
    return this.bots.bots.count();
  }

  /** Everything that makes this page the one running the match, let go of at once
   *  (POK-330 #13): the director's `out` subscription, its loop, the bots' pump and the
   *  departure timers. The seats greeted are the session's, and the door is the room's. */
  dispose(): void {
    this.director.stop(); // lets go of its `out` subscription, and localOut/announceOut with it
    this.stopLoop?.();
    this.stopLoop = null;
    this.bots.dispose();
    this.localOut = null;
    this.announceOut = null;
    for (const timer of this.leaving.values()) clearTimeout(timer);
    this.leaving.clear();
  }

  // ---- the ticker ----------------------------------------------------------------------
  // The ROM has drawn the window since POK-226 and nothing had ever sent it a line, so a
  // match was silent: people vanished, the fog closed, somebody won, and the only way to
  // know was to be watching the right corner. The host narrates, because the host is the
  // one client that knows the whole match.

  private nameOf(seat: number): string {
    return this.link.roster.nameOf(seat);
  }

  private say(msg: TickerMsg | null): void {
    if (!msg || !this.narration) return;
    this.link.toRoom(msg);
    this.link.toRom(msg);
  }

  /** The seed's voice for anyone, except this client's own seat, which speaks with
   *  whatever its profile picked (POK-243) -- see the onDuel/onEngage callbacks. */
  private myVoice(seat: number, matchSeed: number): BotVoice {
    if (seat === this.link.seat && this.narration) return this.narration.mine();
    // What they actually picked, if their challenge told us (POK-274). A bot never
    // sends one, so a bot keeps the lines the seed deals it -- which is what makes a
    // room of bots sound like a room of people in the first place.
    const heard = this.link.linesFor?.(seat);
    if (!heard) return voiceFor(matchSeed, seat);
    const dealt = voiceFor(matchSeed, seat);
    return {
      intro: heard.intro ?? dealt.intro,
      win: heard.win ?? dealt.win,
      lose: heard.lose ?? dealt.lose,
    };
  }

  /** A message this page makes for the room: out to everybody else, into our own ROM,
   *  and through the same bookkeeping every guest runs on it when it arrives. Nobody
   *  hears their own messages back over the relay, so whatever is not done here never
   *  happens on the host at all -- the results, the record and the round's log never
   *  saw its own bots go out, and its placement was counted against a field that, as
   *  far as they knew, never thinned (POK-330 #16). */
  private hostSays(msg: Msg): void {
    this.link.toRoom(msg);
    this.link.toRom(msg);
    this.link.roster.applyMsg(msg);
    this.session.note(msg, 'page'); // before the director hears an `out`, so its `win` comes after it
  }

  private directorSends(msg: Msg): void {
    // Guests' ROMs act on this over the relay; the host's own ROM would too,
    // eventually, but ring/clock/win carry `seat: hostSeat` and bridge.ts's own
    // echo-guard (msgSeat(msg) === this.seat) drops exactly those coming back
    // over the wire -- so the host's own mailbox needs this direct push, not a
    // round trip through the relay it just sent to. `win` is JSON-only
    // (docs/WIRE.md) and has no slots.ts codec, so it never goes to `rom`.
    this.link.toRoom(msg);
    this.link.toRom(msg); // no-op for `win` -- the port only packs a msg.t crossesToRom() knows
    this.session.note(msg, 'page'); // the host's own `start`/`win` never come back to it over the relay
    // The match is over: the door opens again (POK-258). START locked the room to keep
    // latecomers out of a running match, and leaving it locked is what turned the end
    // of a match into everybody scattering -- a reload could not get back in.
    if (msg.t === 'win') {
      this.link.lock?.(false);
      // And says so: a client that never saw the `win` -- a socket that blinked over the
      // last fight -- still gets taken out of the match. `again` has been defined in the
      // wire since POK-258 and sent by nobody until now. It is the recovery path and not
      // the mechanism: each client's own grace is what actually moves it, so a room of
      // older clients still ends properly.
      this.link.toRoom({ t: 'again', seat: this.link.seat });
    }
    if (msg.t === 'ring') {
      // The first ring IS the buzzer: it is what ends the opening in the ROM
      // (br_match.c reads gBrRing.active), so it is when the bots leave too.
      this.bots.drop();
      this.bots.setRing({ sx: msg.sx, sy: msg.sy, r: msg.r }, msg.phase);
    }
    // The match, narrated. These are the director's own messages on their way out,
    // which is the one place every one of them passes through.
    if (msg.t === 'start') {
      this.say(Ticker.opening(this.hostSeat, msg.safari ?? 0));
      this.say(Ticker.dropped(this.hostSeat, msg.spawns.length));
    } else if (msg.t === 'ring') {
      this.say(Ticker.fog(this.hostSeat, msg.phase, msg.r < 0));
    } else if (msg.t === 'win' && msg.seat !== undefined && msg.seat !== null) {
      this.say(Ticker.won(msg.seat, this.nameOf(msg.seat)));
    }
  }

  /** The director's `onOut`, called by its start() or resume(), and let go of by its
   *  stop() -- which it calls itself on the `win`. */
  private listen(handler: (seat: number) => void): () => void {
    // A bot the fog took is eliminated by this very page, so its `out` never comes
    // back over the relay -- nobody hears their own messages. Without this the
    // host's own bots are immortal and the match cannot end.
    const narrate = (seat: number) => {
      if (this.seen.has(seat)) return;
      this.seen.add(seat);
      const left = Math.max(0, this.director.state.alive - 1);
      this.say(Ticker.out(seat, this.nameOf(seat), left));
      if (left === 3) this.say(Ticker.fewLeft(seat, left));
      handler(seat);
    };
    this.localOut = narrate;
    // ...and the same door for a seat that simply vanished (POK-271): the relay's
    // roster is the authority on who is still here, and a match cannot end while
    // it is waiting on somebody who closed their tab.
    this.announceOut = (seat: number) => {
      if (this.seen.has(seat)) return;
      this.hostSays({ t: 'out', seat }); // our own ROM and results never hear it over the relay
      narrate(seat);
    };
    // It used to take `recv` off the relay itself and decode each message again,
    // trusting whoever sent it (POK-330 #24); it hears what the Bridge let through.
    this.directorHears = (m) => {
      if (m.t === 'out') narrate(m.seat);
    };
    return () => {
      this.localOut = null;
      this.announceOut = null;
      this.directorHears = null;
    };
  }
}
