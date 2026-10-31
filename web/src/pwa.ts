// The site as an app (POK-246): the service worker that keeps it on the device, and the
// storage it asks to keep. Both pages call these: the game (spike-b/main.ts) and, until it
// goes, the classic one (app.ts).

import { warm, warmList } from './sw-warm';

/** Registers the service worker (POK-246), so a second visit works with no network and
 *  the site can be added to a home screen. Production only: in dev it would cache the
 *  dev server's own modules and fight HMR for the rest of the afternoon. */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  // After load, so it never competes with the shell and the wasm core for the network
  // on a first visit -- which is the visit that decides whether anybody comes back.
  window.addEventListener('load', () => {
    // A worker newly in control of this page has seen none of what it loaded -- that all
    // came before the worker existed -- so it is asked for again, through it (sw-warm.ts):
    // one visit then leaves the whole shell on the device, not just the page. A page
    // that loaded under a worker already fetched everything through it. Each path once:
    // the warm's own fetches are entries too (sw-warm.ts, the Safari loop).
    const asked = new Set<string>();
    const hand = (entries: PerformanceEntryList) =>
      void warm(warmList(entries as PerformanceResourceTiming[], location.origin, asked), (path) => fetch(path));
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        hand(performance.getEntriesByType('resource'));
        try {
          new PerformanceObserver((list) => hand(list.getEntries())).observe({ type: 'resource' });
        } catch {
          /* no observer: what was loading then is cached on the next visit instead */
        }
      },
      { once: true },
    );
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // A blocked worker (private mode, an http:// origin, a policy) costs offline and
      // nothing else, so it is worth a line in the console and not a word on screen.
      console.info('[pwa] no service worker:', err);
    });
  });
}

/** Asks the browser to keep what we store (POK-246). The whole premise is "import your
 *  ROM once", and without this Safari evicts an origin's storage after about a week of
 *  not being opened -- which would mean finding the .gba again. The prompt, where there
 *  is one, is only shown to somebody who has already installed or engaged with the
 *  site, so asking is not a thing a first-time visitor sees. */
export async function askToKeepStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    // Refused or unsupported: the ROM is still in IndexedDB, just evictable.
  }
}
