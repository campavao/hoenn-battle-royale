// What a first visit loaded, asked for again through the service worker (POK-246).
//
// The worker is registered after `load` (app.ts registerServiceWorker), so nothing the
// first visit fetched went through it: after one visit its cache held the page and two
// icons, and with the network gone the page came back as an import screen with no script
// behind it -- the build's modules, the core and the drawn screens' art all missing
// (pwa.spec). Once the worker controls the page, each same-origin file the page has
// loaded is fetched again, through it; sw.js's rules decide whether and how it keeps it.

/** The same-origin files among resource timing `entries` that did not come through a
 *  worker (workerStart 0), once each, as paths with their query -- a patch is named by its
 *  `?v=`. One still loading when the worker took over, the core's wasm among them, is not
 *  an entry until it lands, and came through nobody: the page hands those on as they
 *  land, too. */
export function warmList(entries: readonly { name: string; workerStart?: number }[], origin: string): string[] {
  const out = new Set<string>();
  for (const { name, workerStart } of entries) {
    if ((workerStart ?? 0) > 0) continue; // the worker saw it, and kept it by its rules
    let url: URL;
    try {
      url = new URL(name, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    out.add(url.pathname + url.search);
  }
  return [...out];
}

/** Fetches `paths` one at a time -- the core is a large file, and none of this is urgent
 *  -- and never throws: a file that will not come is simply not kept. Returns how many
 *  answered. */
export async function warm(paths: readonly string[], get: (path: string) => Promise<unknown>): Promise<number> {
  let got = 0;
  for (const path of paths) {
    try {
      await get(path);
      got++;
    } catch {
      /* offline already, or gone: the next visit caches it on its own */
    }
  }
  return got;
}
