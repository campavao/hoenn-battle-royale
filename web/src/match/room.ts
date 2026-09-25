// The room, before the match (POK-241).
//
// Kanto's room screen: the roster, the host's few controls, and START. The relay owns
// the room -- MAX, OPEN, the passcode, the lock -- and broadcasts a roster whenever any
// of it changes, so this is not state so much as a reading of the last roster plus who
// we are.
//
// Away from the DOM for the same reason the lobby's rows are: what wants a test is
// "does FILL say how many bots", "is START refused with nobody in the room", "does a
// guest see the host's settings and not the host's buttons".
import type { RosterEvent } from '../net/relay';
import type { RoomMode } from '../hash';
import { onPromotion, type MatchSnapshot } from './lifecycle';

/** What MAX cycles through. Kanto's ladder, and the same one the relay clamps to: the
 *  humans are capped by the relay (16, the roster's `max`) and everything above that
 *  is bot seats (the roster's `seats`, which is what MAX shows and FILL counts to). */
export const MAX_STEPS = [2, 4, 6, 8, 12, 16, 20, 26, 30];

export interface RoomView {
  code: string;
  /** Are we the host? Only the host has controls. */
  isHost: boolean;
  /** Names in seat order, ours marked. */
  members: { seat: number; name: string; isMe: boolean; spectating: boolean }[];
  /** Trainers, not spectators -- what "N/MAX" counts. */
  players: number;
  max: number;
  open: boolean;
  pass: boolean;
  /** FILL is on: bots take the seats nobody has. */
  fillOn: boolean;
  /** Bots the host would deal at START to make the room up to MAX. */
  fill: number;
}

export function roomView(roster: RosterEvent, mySeat: number, fillOn: boolean): RoomView {
  const members = roster.members.map((m) => ({
    seat: m.id,
    name: m.name || `P${m.id}`,
    isMe: m.id === mySeat,
    spectating: m.spectate === true,
  }));
  const players = members.filter((m) => !m.spectating).length;
  // The seats the host asked for, not the humans the relay clamps them to: reading
  // `max` held MAX at 16 and dealt no room more than sixteen (POK-330 #29). An older
  // relay sends no `seats`, and its `max` is all there is.
  const max = roster.seats ?? roster.max;
  return {
    code: roster.code,
    isHost: roster.host === mySeat,
    members,
    players,
    max,
    open: roster.open,
    pass: roster.pass,
    fillOn,
    fill: botFillFor(roster, players, fillOn), // what START deals: the same rule
  };
}

/** The FILL control: how many bots START would deal, or OFF. What the host set, not what
 *  it comes to -- a room full to MAX with FILL on read FILL OFF, and pressing it to turn
 *  FILL "on" turned it off. */
export function fillLabel(view: Pick<RoomView, 'fillOn' | 'fill'>): string {
  return view.fillOn ? `FILL ${view.fill}` : 'FILL OFF';
}

/** The next MAX up the ladder, wrapping -- one control, one button. */
export function nextMax(max: number): number {
  const i = MAX_STEPS.indexOf(max);
  return i < 0 ? MAX_STEPS[0] : MAX_STEPS[(i + 1) % MAX_STEPS.length];
}

/** The door's three states, as one cycling control: listed, unlisted, passcoded. */
export type Door = 'open' | 'private' | 'pass';

export function doorOf(view: { open: boolean; pass: boolean }): Door {
  if (view.pass) return 'pass';
  return view.open ? 'open' : 'private';
}

export function nextDoor(door: Door): Door {
  return door === 'open' ? 'private' : door === 'private' ? 'pass' : 'open';
}

/** Can the host start? A match needs somebody in it -- with FILL off and nobody else
 *  here, START would deal a one-trainer battle royale. */
export function canStart(view: RoomView): boolean {
  return view.isHost && dealable(view.players, view.fill);
}

/** Would a deal of these make a match anybody can win? Two in it at least, bots counted:
 *  a director whose field starts at one never declares a winner. Kanto's canStart
 *  (POK-197), which refuses every way in -- START, the countdown, the buzzer -- and not
 *  only the button: with FILL off, a quick room of one counts itself down to exactly
 *  that match. */
export function dealable(humans: number, bots: number): boolean {
  return humans + bots >= 2;
}

/** The one line under the roster: what pressing START would actually make. */
export function startNote(view: RoomView): string {
  if (!view.isHost) return 'Waiting for the host to start.';
  const total = view.players + view.fill;
  if (total < 2) return 'Nobody to play against. Turn FILL on, or wait for somebody.';
  const bots = view.fill > 0 ? ` and ${view.fill} bot${view.fill === 1 ? '' : 's'}` : '';
  return `START: ${view.players} trainer${view.players === 1 ? '' : 's'}${bots}.`;
}

// ---- when a match starts (POK-330 #42) -----------------------------------------------

/** How many the host fills a room to when nothing says otherwise. The room screen's
 *  own FILL control (POK-241) overrides it; Kanto's rooms are never empty, which is the
 *  whole point. */
export const BOT_FILL = 8;

export const AUTO_START_MS = 10_000; // "for now": a room starts 10s after hosting, or once 2+ seats

/** Which rooms start on their own (POK-320, Cam: "if I click an option that isn't quick
 *  play, the game should not start automatically"). Quick play and the daily are
 *  games that are going; a hosted room waits for its host's START. */
export function startsItself(mode: RoomMode): boolean {
  return mode === 'quick' || mode === 'daily';
}

/** How many bots the host fills to (POK-241's FILL), held to what the room has room
 *  for. `seats` is MAX as the host set it; `max` is only the humans (POK-330 #29), and
 *  all an older relay sends. None with FILL off: the room screen has said "FILL OFF" and
 *  drawn no bot seats since POK-241, and START dealt them anyway (POK-331 #8). Kanto's
 *  botsAtStart is the same rule -- its fill target is zero while FILL is off. */
export function botFillFor(roster: Pick<RosterEvent, 'seats' | 'max'> | null, humans: number, fillOn: boolean): number {
  if (!fillOn) return 0;
  return Math.max(0, (roster?.seats ?? roster?.max ?? BOT_FILL) - humans);
}

/** Something that might start a match. Each is a place the page used to decide that for
 *  itself, with its own copy of the rule. */
export type StartTrigger =
  /** We have a seat: the room's first host counts a room that starts itself down. */
  | { t: 'attached' }
  /** The relay has just made us host (POK-252). */
  | { t: 'promoted'; members: number[] }
  /** Host again after our own drop, the match still in this tab (POK-330 #47). */
  | { t: 'host-again'; members: number[] }
  /** A roster event. */
  | { t: 'roster'; members: number[] }
  /** START. `members` is the roster it was drawn with, when there is one. */
  | { t: 'start'; members?: number[] }
  /** A room's countdown ran out. */
  | { t: 'countdown' }
  /** Solo, once the ROM is well into its warp-in. */
  | { t: 'solo' };

export interface StartState {
  mode: RoomMode;
  /** False under the dev `#noauto`, which holds a room that starts itself open. */
  autoStarts: boolean;
  isHost: boolean;
  /** The room screen is down: a match has been dealt. */
  roomStarted: boolean;
  /** A countdown is running already. */
  countingDown: boolean;
  match: Pick<MatchSnapshot, 'active' | 'ended' | 'seed'>;
}

export type StartDecision =
  | { do: 'nothing' }
  | { do: 'count-down' }
  /** Deal a new match to `members`, or to the relay's last roster when absent. */
  | { do: 'deal'; members?: number[] }
  /** Pick up the match in flight from what the wire has said of it. */
  | { do: 'take-over'; members: number[] };

/** The one start policy: whether a match starts now, later, or not at all. Each rule is
 *  the condition its call site wrote out for itself, quirks and all:
 *  - nothing counts down after PLAY AGAIN, so a quick room of one never starts again and
 *    one of two or more deals on its next roster at once;
 *  - `attached` counts down on every attach, a rejoin mid-match included;
 *  - a takeover of a match whose seed was never heard (a watcher's) deals a fresh one.
 *  What the page cannot do anyway -- a director already running, no seat, not the host,
 *  nobody to deal to -- is startDirector's to refuse. */
export function decideStart(trigger: StartTrigger, s: StartState): StartDecision {
  switch (trigger.t) {
    case 'attached':
      return s.isHost && s.autoStarts && startsItself(s.mode) ? { do: 'count-down' } : { do: 'nothing' };
    case 'promoted': {
      // An heir to a room that starts itself (quick play, the daily) before any match
      // counts it down, after the STARTS IN count (POK-320); the room's own first host
      // does that from attach(), which knows it opened the room.
      // Before any match, an heir inherits the room and nothing else: a hosted room still
      // waits for START, now this page's (play-test 2026-09-19: the host switched apps,
      // iOS dropped its socket, and the guest it handed to started the match unasked).
      // After one it is the same, once the grace brings everybody back: a match that has
      // been won is not one to take over (POK-330 #22).
      const next = onPromotion(s.match);
      if (next === 'room') {
        return !s.roomStarted && startsItself(s.mode) && s.autoStarts && !s.countingDown
          ? { do: 'count-down' }
          : { do: 'nothing' };
      }
      if (next === 'take-over') {
        return s.match.seed !== 0
          ? { do: 'take-over', members: trigger.members }
          : { do: 'deal', members: trigger.members };
      }
      return { do: 'nothing' };
    }
    case 'host-again':
      return { do: 'take-over', members: trigger.members };
    case 'roster':
      // The buzzer: a room that starts itself goes once two are in it.
      return trigger.members.length >= 2 && s.autoStarts && startsItself(s.mode)
        ? { do: 'deal', members: trigger.members }
        : { do: 'nothing' };
    case 'start':
      return { do: 'deal', members: trigger.members };
    case 'countdown':
    case 'solo':
      return { do: 'deal' };
  }
}

// ---- a door that will not open -----------------------------------------------------

/** The seat a new room gives the member who opens it: relay/server.js hands out the
 *  lowest free id, and in a new room that is 1. */
export const OPENER_SEAT = 1;

/** Refusals that leave nothing to do in this room: the page offers the lobby. */
const DEAD_ENDS = ['locked', 'full', 'not_found', 'removed', 'passcode', 'server_full', 'version'];

/** What the page does with the relay's `room_error` (POK-330 #47). A rejoin refused
 *  because the room is gone -- a relay restart, or a seat hold that ran out -- is not a
 *  dead end for the page that was running the match: the match lives in its tab, so it
 *  hosts a new room and carries on there. Only from the opener's seat, which is the one
 *  the new room will give it back; from any other it would come back as somebody else,
 *  mid-match. That branch was written once and never ran, because the refusal went
 *  straight to the dead end. */
export function onRefused(
  reason: string,
  page: { rejoining: boolean; wasHost: boolean; seat: number | null },
): 'rehost' | 'dead-end' | 'status' {
  if (reason === 'not_found' && page.rejoining && page.wasHost && page.seat === OPENER_SEAT) return 'rehost';
  return DEAD_ENDS.includes(reason) ? 'dead-end' : 'status';
}

// ---- the clock a match is picked up from ---------------------------------------------

/** The seconds left in the running phase at `now`: the last clock this page heard or
 *  kept, counted off since it arrived. What a guest's strip draws, and what a director
 *  resumes from -- a host back after a 40-second drop is 40 seconds further on. */
export function clockLeftAt(clock: { clockLeft: number; clockAt: number }, now: number): number {
  const gone = Math.floor(Math.max(0, now - clock.clockAt) / 1000);
  return Math.max(0, clock.clockLeft - gone);
}

// ---- match options (POK-241) --------------------------------------------------------

/** Text speed as the ROM numbers it (OPTIONS_TEXT_SPEED_* in constants/global.h), in
 *  the order a host cycles them. The wire carries the same three (wire.ts's `Pace`). */
export const TEXT_SPEEDS: { label: string; value: 1 | 3 | 5 }[] = [
  { label: 'SLOW', value: 1 },
  { label: 'MID', value: 3 },
  { label: 'FAST', value: 5 },
];

export function nextTextSpeed(value: 1 | 3 | 5): 1 | 3 | 5 {
  const i = TEXT_SPEEDS.findIndex((s) => s.value === value);
  return TEXT_SPEEDS[(i + 1) % TEXT_SPEEDS.length].value;
}

export function textSpeedLabel(value: 1 | 3 | 5): string {
  return TEXT_SPEEDS.find((s) => s.value === value)?.label ?? 'MID';
}

/** How long a ring phase lasts. Six of these is most of a match's length, so this is
 *  the dial that says "quick game" or "a proper one". */
export const FOG_STEPS = [30, 60, 90, 120, 180];

/** How long the opening lasts (POK-241). Zero is Kanto's own escape hatch: no Safari
 *  at all, straight to a dealt drop, which is the setting for people who have played
 *  six in a row and want the match rather than the catching. */
export const SAFARI_STEPS = [0, 60, 120, 180];

export function nextSafari(secs: number): number {
  const i = SAFARI_STEPS.indexOf(secs);
  return i < 0 ? SAFARI_STEPS[0] : SAFARI_STEPS[(i + 1) % SAFARI_STEPS.length];
}

export function safariLabel(secs: number): string {
  return secs === 0 ? 'NO SAFARI' : `SAFARI ${secs}s`;
}

export function nextFog(secs: number): number {
  const i = FOG_STEPS.indexOf(secs);
  return i < 0 ? FOG_STEPS[0] : FOG_STEPS[(i + 1) % FOG_STEPS.length];
}
