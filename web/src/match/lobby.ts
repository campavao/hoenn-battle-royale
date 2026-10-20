// The lobby's rows (POK-240).
//
// Kanto had one lobby screen and every way into a match was a row on it. Hoenn's is a
// page rather than a drawn room, but the rows are the same rows and they mean the same
// things -- so this is the list, as data: what to show, what it says underneath, and
// what pressing it does.
//
// Kept away from the DOM on purpose. What belongs in a test is "does the daily row
// appear half an hour out", "does a full room stop being joinable", "does the passcode
// padlock show" -- not which element got which class.
import type { RoomListing } from '../net/relay';
import { SKINS } from './career';

/** The relay's own code alphabet (server.js `CODE_ALPHABET`, ported from Kanto's
 *  `CodeEntry.CHARSET`): no `0`/`O`, `1`/`I`/`L` -- the characters that look alike
 *  at a glance, dropped so a code never asks anyone to guess which one they were
 *  shown. `CODE_LENGTH` matches the relay's own; a code is never shorter or longer. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

/** Whether `code` could be a real room code -- right length, right alphabet. Used to
 *  reject a mistyped JOIN BY CODE before it ever reaches the relay, rather than
 *  waiting on a `not_found` for a code that could never have been issued. */
export function isRoomCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export type LobbyAction =
  | { kind: 'solo' }
  | { kind: 'quick' }
  | { kind: 'host' }
  | { kind: 'code' }
  | { kind: 'daily' }
  // The list of open rooms is its own screen now (POK-320).
  | { kind: 'lobbies' }
  | { kind: 'name' }
  | { kind: 'skin' }
  // Your sprite and your three lines (POK-337): three picks out of one pool (POK-283).
  | { kind: 'look' }
  // Your lifetime stats (POK-416).
  | { kind: 'mystats' }
  | { kind: 'stats' }
  | { kind: 'seethrough' }
  | { kind: 'career' }
  // A note to the developers (POK-428).
  | { kind: 'feedback' }
  // A match in six panels (POK-429).
  | { kind: 'howto' }
  | { kind: 'join'; code: string; pass: boolean }
  | { kind: 'watch'; code: string };

export interface LobbyRow {
  /** What the row says on the left. */
  label: string;
  /** What it says on the right, if anything: a count, a countdown, a padlock. */
  detail?: string;
  action: LobbyAction;
  /** A row that is shown but cannot be pressed (a full room, a locked one). */
  disabled?: boolean;
  /** What the cursor knows the row by. The label and detail can change under it (a
   *  toggle saying its new value), and a cursor kept by what the row said went back to
   *  the top on every press (POK-333). */
  id?: string;
}

/** mm:ss for a countdown, as the daily row shows it. */
export function countdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The relay as the lobby knows it: still opening its first socket, up, or down (it
 *  closed, never opened in time, or this tab may not play online at all). */
export type Link = 'connecting' | 'up' | 'down';

/** The fixed rows, always in this order. Down, QUICK PLAY is a game against bots, which
 *  never opens a socket (the Kanto rule). */
export function fixedRows(
  link: Link | boolean,
  profile?: Profile,
): LobbyRow[] {
  return [...(profile ? profileRows(profile) : []), ...playRows(link)];
}

export interface Profile {
    name: string;
    skin: string;
    /** What the sprite row says under it -- 'your sprite', or how many wins the next
     *  one takes once the wardrobe is not already full (POK-243). */
    skinNote?: string;
    /** Whether play is being shared with the relay's own count -- undefined reads as
     *  "shared", the same default `stats.ts`'s `off` field defaults to. */
    statsOn?: boolean;
    /** The battle over the map (an experiment, 2026-10-05 play-test). */
    seeThrough?: boolean;
}

/** Who you are (POK-243): the trainer's own rows, on their own screen since POK-320. */
export function profileRows(profile: Profile): LobbyRow[] {
  const rows: LobbyRow[] = [
    { label: profile.name, detail: 'your name', action: { kind: 'name' as const } },
    { label: profile.skin, detail: profile.skinNote ?? 'your sprite', action: { kind: 'skin' as const } },
    // Your sprite and your three lines on one screen (Cam's 2026-10-14 play-test, POK-337:
    // "combine it with the sprite screen... show them as the dialogue boxes themselves").
    { label: 'MY LOOK', detail: 'sprite and lines', action: { kind: 'look' as const } },
    // Cam: "record and show stats... and save that for global profile" (POK-416).
    { label: 'MY STATS', detail: 'every match so far', action: { kind: 'mystats' as const } },
    // Named for what they do (Cam's 2026-10-14 play-test, POK-334: "this is like debug
    // info", "Battle BG... doesn't make any sense"). The first is the anonymous play
    // count stats.ts hands the relay; the second, where a battle is drawn.
    { label: 'SEND PLAY COUNT', detail: profile.statsOn === false ? 'OFF' : 'ON', action: { kind: 'stats' as const } },
    {
      label: 'BATTLE BACKDROP',
      detail: profile.seeThrough ? 'OVER MAP' : 'CLASSIC',
      action: { kind: 'seethrough' as const },
    },
    // Kanto's career is a file on disk somebody can copy to another machine;
    // localStorage cannot be copied at all, so it needs a door (POK-243).
    { label: 'MY CAREER', detail: 'save or load a file', action: { kind: 'career' as const } },
  ];
  return rows.map((r) => ({ ...r, id: `trainer-${r.action.kind}` }));
}

/** The ways into a match; the daily gets a row of its own when the relay is offering one.
 *  Nothing on their right (Cam, 2026-10-19, POK-430: "let's drop the text on the right.
 *  Just keep it the options, no fluff"): a row that cannot be pressed yet is grayed, and
 *  the note under them says when the relay is not there. */
export function playRows(link: Link | boolean, daily?: RoomListing): LobbyRow[] {
  const state: Link = link === true ? 'up' : link === false ? 'down' : link;
  const online = state === 'up';
  const quick: LobbyRow =
    state === 'up'
      ? { label: 'QUICK PLAY', action: { kind: 'quick' } }
      : state === 'down'
        ? { label: 'QUICK PLAY', action: { kind: 'solo' } }
        // Not yet either: a press on a cold load is not a quiet game against bots (#41's
        // review). It waits for the socket to open, close, or run out of time.
        : { label: 'QUICK PLAY', action: { kind: 'quick' }, disabled: true };
  const rows: LobbyRow[] = [
    // SOLO VS BOTS is not a row any more (Cam, 2026-10-14, POK-341: "quick play to me
    // feels actually more like a natural flow"). Offline, QUICK PLAY is that game: the
    // bots, and no socket.
    quick,
    { label: 'HOST A ROOM', action: { kind: 'host' }, disabled: !online },
    { label: 'LOBBIES', action: { kind: 'lobbies' }, disabled: !online },
    { label: 'JOIN BY CODE', action: { kind: 'code' }, disabled: !online },
    ...(daily
      ? [{ label: 'DAILY GAME', action: { kind: 'daily' as const } }]
      : []),
  ];
  return rows.map((r) => ({ ...r, id: `lobby-${r.label.toLowerCase().replace(/ /g, '-')}` }));
}

/** Under the ways into a match, whatever the relay is doing: a note that cannot be sent
 *  says so on its own screen, and the row being there says where to find it (POK-428). */
export const FEEDBACK_ROW: LobbyRow = {
  label: 'SEND FEEDBACK',
  action: { kind: 'feedback' },
  id: 'lobby-feedback',
};

/** Over SEND FEEDBACK: how a match goes, in a few panels (POK-429). */
export const HOWTO_ROW: LobbyRow = {
  label: 'HOW TO PLAY',
  action: { kind: 'howto' },
  id: 'lobby-howto',
};

/** One row per open room, plus the daily's own at the top when the relay offers it.
 *  A room with no seats left is shown and not pressable -- knowing a game is full is
 *  worth more than not knowing it is there. */
export function roomRows(rooms: RoomListing[]): LobbyRow[] {
  return rooms.map((room) => {
    if (room.daily) {
      return {
        label: 'DAILY GAME',
        detail: `starts in ${countdown(room.secs ?? 0)}${room.players > 0 ? ` · ${room.players} waiting` : ''}`,
        action: { kind: 'daily' },
      };
    }
    // The relay's answer when it gives one: it runs the door, which counts watchers
    // and ids as well, so trainers over seats called a shut door open (POK-330 #29).
    const full = room.full ?? room.players >= room.seats;
    const bits: string[] = [];
    // The host's own sprite (Kanto's `browse.lua` draws its walk frame beside the
    // name; a plain-TS row says the same thing in words). `skin` is the numeric
    // index `careerSkin()` sends, so an unrecognised one is dropped rather than
    // shown as a stray digit -- SOLO's four sprites are the only ones there are.
    const skinName = room.skin !== undefined ? SKINS[Number(room.skin)] : undefined;
    if (skinName) bits.push(skinName);
    bits.push(`${room.players}/${room.seats}`);
    if (room.pass) bits.push('🔒');
    if (full) bits.push('FULL');
    return {
      label: room.host || room.code,
      detail: bits.join(' · '),
      action: { kind: 'join', code: room.code, pass: room.pass },
      disabled: full,
    };
  });
}

/** What the page says when the list is empty -- which it usually is, and saying so
 *  plainly beats an empty box that looks broken. */
export function emptyNote(online: boolean): string {
  return online
    ? 'No open rooms. QUICK PLAY hosts one and fills it with bots.'
    : 'Not connected. QUICK PLAY is a game against bots.';
}
