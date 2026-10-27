// HOW TO PLAY's once-per-device flag (POK-429), apart from the panels themselves: app.ts
// asks it at boot, and the panels come in a chunk of their own.

/** 'due' from a first import until the panels are shown, then '1' for good. In storage,
 *  not memory: a newcomer who came by an invite link meets the menu on a later load. */
export const HOWTO_KEY = 'hbr:howto';

/** A ROM was just imported by hand: somebody new, unless the panels were shown here. */
export function markHowToDue(store: Storage): void {
  try {
    if (store.getItem(HOWTO_KEY) !== '1') store.setItem(HOWTO_KEY, 'due');
  } catch {
    // Storage refused: nobody is offered the panels, and the menu row still has them.
  }
}

/** True once, on the menu after a first import: the panels go up and are not owed again. */
export function takeHowToDue(store: Storage): boolean {
  try {
    if (store.getItem(HOWTO_KEY) !== 'due') return false;
    store.setItem(HOWTO_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Set once somebody has paged to HOW TO PLAY's last panel (HBR-30, Cam: "a 'new'
 *  indicator ... dismisses after opening one time and reading all of it"). */
export const HOWTO_READ_KEY = 'hbr:howto-read';
/** Raised when panels are added, so the NEW comes back for them: '2' brought in
 *  Encounters and Item pickups (HBR-80). */
export const HOWTO_READ = '2';

export function markHowToRead(store: Storage): void {
  try {
    store.setItem(HOWTO_READ_KEY, HOWTO_READ);
  } catch {
    // Storage refused: the NEW stays, which is the safe way round.
  }
}

/** Whether the menu's HOW TO PLAY tile can drop its NEW. */
export function howToRead(store: Storage): boolean {
  try {
    return store.getItem(HOWTO_READ_KEY) === HOWTO_READ;
  } catch {
    return false;
  }
}
