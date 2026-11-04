// A word that the round button has a dial behind it (Cam, 11-04, of the key items' dial: "we maybe
// need to highlight in the UI that this is a thing"): over the button for a few seconds, on a few
// matches at most, and never again once the dial has been opened. Saved per browser.
const KEY = 'hbr-dial-tip';
/** How many matches it says so in, and how long it stays up each. */
export const DIAL_TIP_SHOWS = 3;
export const DIAL_TIP_MS = 8000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function shown(store: Store): number {
  try { return Number(store.getItem(KEY)) || 0; } catch { return DIAL_TIP_SHOWS; }
}

/** Whether it has anything left to say. Storage out of reach: no, rather than every time. */
export function dialTipDue(store: Store = localStorage): boolean {
  return shown(store) < DIAL_TIP_SHOWS;
}

/** It came up once more. */
export function dialTipShown(store: Store = localStorage): void {
  try { store.setItem(KEY, String(shown(store) + 1)); } catch { /* it says so again next time */ }
}

/** The dial was opened: it knows. */
export function dialKnown(store: Store = localStorage): void {
  try { store.setItem(KEY, String(DIAL_TIP_SHOWS)); } catch { /* as above */ }
}

/** What it says, by what's driving: a finger, a keyboard's `key`, or a pad's trigger. */
export function dialTipWords(input: 'touch' | 'keys' | 'pad', key: string): string {
  if (input === 'touch') return 'Hold for key items';
  return input === 'pad' ? 'Hold right trigger: key items' : `Hold ${key.toUpperCase()} for key items`;
}
