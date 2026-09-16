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
  | { kind: 'name' }
  | { kind: 'skin' }
  | { kind: 'voice' }
  | { kind: 'stats' }
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
}

/** mm:ss for a countdown, as the daily row shows it. */
export function countdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The fixed rows, always in this order. `online` is false before the socket is up --
 *  SOLO VS BOTS still works, because solo never opens one (the Kanto rule). */
export function fixedRows(
  online: boolean,
  profile?: {
    name: string;
    skin: string;
    /** What the sprite row says under it -- 'your sprite', or how many wins the next
     *  one takes once the wardrobe is not already full (POK-243). */
    skinNote?: string;
    /** A preview of the chosen voice (POK-243) -- what the win line says, so cycling
     *  is picking something rather than picking a number. */
    voice?: string;
    /** Whether play is being shared with the relay's own count -- undefined reads as
     *  "shared", the same default `stats.ts`'s `off` field defaults to. */
    statsOn?: boolean;
    record?: string;
  },
): LobbyRow[] {
  return [
    // Who you are, first: a room full of people called CAM is nobody's idea of a
    // lobby, and the name is what the ROM is told too (POK-243).
    ...(profile
      ? [
          { label: profile.name, detail: profile.record ?? 'your name', action: { kind: 'name' as const } },
          { label: profile.skin, detail: profile.skinNote ?? 'your sprite', action: { kind: 'skin' as const } },
          { label: 'MY VOICE', detail: profile.voice ?? 'what you say', action: { kind: 'voice' as const } },
          {
            label: 'PLAY STATS',
            detail: profile.statsOn === false ? 'not shared' : 'shared',
            action: { kind: 'stats' as const },
          },
        ]
      : []),
    { label: 'SOLO VS BOTS', detail: 'no socket, ever', action: { kind: 'solo' } },
    { label: 'QUICK PLAY', detail: online ? 'a game right now' : 'offline', action: { kind: 'quick' }, disabled: !online },
    { label: 'HOST A ROOM', action: { kind: 'host' }, disabled: !online },
    { label: 'JOIN BY CODE', action: { kind: 'code' }, disabled: !online },
  ];
}

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
    const full = room.players >= room.seats;
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
    : 'Not connected. SOLO VS BOTS works without a socket.';
}
