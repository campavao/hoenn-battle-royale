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
 *  humans are capped by the relay (16) and everything above that is bot seats. */
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
  return {
    code: roster.code,
    isHost: roster.host === mySeat,
    members,
    players,
    max: roster.max,
    open: roster.open,
    pass: roster.pass,
    fill: fillOn ? Math.max(0, roster.max - players) : 0,
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
