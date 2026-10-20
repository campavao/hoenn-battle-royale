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
