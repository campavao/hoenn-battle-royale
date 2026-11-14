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
import { type MatchSnapshot } from './lifecycle';

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

export function nextDoor(door: Door): Door {
  return door === 'open' ? 'private' : door === 'private' ? 'pass' : 'open';
}

/** What the door control says. The host sees the passcode it set, as Kanto's OPEN: PASS
 *  1234 does (menu.lua), to read it out; a host that took the room over never knew it. */
export function doorLabel(door: Door, pass: string | null): string {
  if (door === 'pass') return pass ? `PASS ${pass}` : 'PASSCODE';
  return door === 'open' ? 'LISTED' : 'UNLISTED';
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

/** The one line under the roster, when it has something the seats do not say: the
 *  seats already show who START deals in (HBR-51). */
export function startNote(view: RoomView): string {
  if (!view.isHost) return 'Waiting for the host to start.';
  if (view.players + view.fill < 2) return 'Nobody to play against. Turn FILL on, or wait for somebody.';
  return '';
}

// ---- when a match starts (POK-330 #42) -----------------------------------------------

/** How many the host fills a room to when nothing says otherwise. The room screen's
 *  own FILL control (POK-241) overrides it; Kanto's rooms are never empty, which is the
 *  whole point. */
export const BOT_FILL = 8;

/** How long a room that starts itself counts (Cam's 2026-10-19 play-test: "quick match
 *  should take like 60 seconds before it starts... right now it feels a little too
 *  automatic and abrupt"). It was 10 s. Any key or tap on the room starts it again
 *  (StartCountdown.bump). */
export const AUTO_START_MS = 60_000;

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
  /** A match has been played in this room and we are back from it: the next one is the
   *  host's to call (Kanto's READY UP, POK-167). This page's, not the room's: one that
   *  came in after the match, or reloaded, has not played. Everybody who has is back on
   *  the heir list ahead of it (they came first), so it inherits only a room none of
   *  them can run, and counts that down as its first lobby. */
  played: boolean;
  match: Pick<MatchSnapshot, 'active' | 'ended' | 'seed'>;
}

export type StartDecision =
  | { do: 'nothing' }
  | { do: 'count-down' }
  /** Deal a new match to `members`, or to the relay's last roster when absent. */
  | { do: 'deal'; members?: number[] }
  /** Pick up the match in flight from what the wire has said of it. */
  | { do: 'take-over'; members: number[] }
  /** Made host of a match this page never heard dealt: hand the room on (can_host false). */
  | { do: 'step-aside' };

/** READY UP (Kanto's POK-167): back in a room that starts itself after a match, START
 *  arms the first lobby's count instead of dealing, and START inside that count deals at
 *  once. Quick play's promise is a game now, and the first lobby keeps it; the match after
 *  it is the one nobody asked for, so the host says when, and the count is everybody
 *  else's window to read their result, check their party, or leave. */
function readiesUp(s: Pick<StartState, 'mode' | 'autoStarts' | 'played' | 'countingDown'>): boolean {
  return s.played && startsItself(s.mode) && s.autoStarts && !s.countingDown;
}

/** What START says: READY UP when a press arms the count rather than dealing. */
export function startLabel(s: Pick<StartState, 'mode' | 'autoStarts' | 'played' | 'countingDown'>): string {
  return readiesUp(s) ? 'READY UP' : 'START';
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

/** How many of a control's level bars are lit for `value` among `steps`: its place in
 *  the ladder, counting from 1, or from 0 for a ladder whose first step is none at all
 *  (SAFARI's 0). A value not on the ladder lights nothing. */
export function levelOf(steps: readonly number[], value: number, firstIsNone = false): { at: number; of: number } {
  const i = steps.indexOf(value);
  if (firstIsNone) return { at: Math.max(0, i), of: steps.length - 1 };
  return { at: i + 1, of: steps.length };
}

export function nextFog(secs: number): number {
  const i = FOG_STEPS.indexOf(secs);
  return i < 0 ? FOG_STEPS[0] : FOG_STEPS[(i + 1) % FOG_STEPS.length];
}
