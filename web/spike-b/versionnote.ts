// A room on another patch turned me away (the relay's `no_room` `rom`): the menu's note says who
// is behind the live release and so who reloads -- me, or the room's players (Cam, 11-17: "how
// does 'Reload the page to update' work if I'm on the newer version?"). Two lines at most on the
// main menu (screens.ts noteLines).

/** `mine`: this page's ROM, seven characters; `room`: the room's (`true` from a relay that didn't
 *  say); `latest`: the live release's (release.ts latestRomSeven), null until it is read. */
export function versionNote(code: string, mine: string, room: string | boolean, latest: string | null): string {
  const theirs = typeof room === 'string' ? room.slice(0, 7) : '';
  if (latest && theirs && mine !== theirs) {
    if (mine === latest) return `You have the latest version. Room ${code} is on an older one: its players need to reload.`;
    if (theirs === latest) return `Room ${code} is on a newer version of the game. Reload the page to update.`;
  }
  return `Room ${code} is on another version of the game. Reload the page to update.`;
}
