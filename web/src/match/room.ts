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
    fill: fillOn ? Math.max(0, max - players) : 0,
  };
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
  return view.isHost && view.players + view.fill >= 2;
}

/** The one line under the roster: what pressing START would actually make. */
export function startNote(view: RoomView): string {
  if (!view.isHost) return 'Waiting for the host to start.';
  const total = view.players + view.fill;
  if (total < 2) return 'Nobody to play against. Turn FILL on, or wait for somebody.';
  const bots = view.fill > 0 ? ` and ${view.fill} bot${view.fill === 1 ? '' : 's'}` : '';
  return `START: ${view.players} trainer${view.players === 1 ? '' : 's'}${bots}.`;
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
