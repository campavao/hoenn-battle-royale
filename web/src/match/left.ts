// A reload in the middle of a match (POK-433, Cam's 10-19 play-test: "it doesn't look
// like reload puts me back in the same game. Do we know why that is?").
//
// The match lives in this tab: the ROM's RAM is the player's whole run, and on the host
// the director and every bot are this page's too. The relay holds the seat for a minute
// (POK-284), so inside that minute the tab goes back in from what it wrote down on its
// way out (match/resume.ts, HBR-20). This note is the other half: that the tab was in a
// match at all. A reload that finds it and cannot go back -- past the minute, from inside
// a battle, a store that would not take the savestate -- goes to the menu and says the
// match was left, with WATCH, rather than following the URL into a room screen "Waiting
// for the host to start" with fifteen grey BOTs.

const KEY = 'hbr-in-match';

export type TabStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

/** The tab's own store, or null where the browser refuses one (a private window). */
function tabStore(): TabStore {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The match in `code` is on in this tab. */
export function noteInMatch(code: string | undefined, store: TabStore = tabStore()): void {
  try {
    store?.setItem(KEY, code ?? '');
  } catch {
    // a full or refused store: a reload simply rejoins the room, as it always did
  }
}

/** The match is over, or the tab left it on purpose. */
export function noteOutOfMatch(store: TabStore = tabStore()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // as above
  }
}

/** The room this page load is a reload out of a match in ('' when the tab never knew
 *  its code), or null for any other load. Forgotten as it answers: the next reload is an
 *  ordinary one. The caller holds the code to the URL's, so a link to another room in
 *  the same tab is not taken for one. */
export function reloadedMidMatch(store: TabStore = tabStore()): string | null {
  let was: string | null = null;
  try {
    was = store?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
  noteOutOfMatch(store);
  return was;
}

/** What the menu says after it (Cam: overlay lines in mixed case). */
export const LEFT_MATCH_NOTE = 'The page reloaded, so you left your match.';
