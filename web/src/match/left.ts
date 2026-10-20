// A reload in the middle of a match (POK-433, Cam's 10-19 play-test: "it doesn't look
// like reload puts me back in the same game. Do we know why that is?").
//
// Why it cannot: the match lives in this tab and nowhere else. The ROM's RAM is the
// player's whole run (party, bag, where they stand), and a reload boots a fresh one; on
// the host the director and every bot are this page's too, so the match stops with it.
// The relay holds the seat for a minute (POK-284), which is enough for a socket that
// blinked and not for a page that started over. So the URL's room used to take the
// reloaded tab into the room as if nothing had happened -- "Waiting for the host to
// start", fifteen grey BOTs -- until the player found LEAVE.
//
// What it does instead: the tab notes, for itself (sessionStorage outlives a reload and
// nothing else), that it is in a match, and a reload that finds the note goes to the
// menu and says the match was left.

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
