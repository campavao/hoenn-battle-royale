// Offline, and a patch you notice (POK-246).
//
// Not a precache: there is no generated file list here on purpose. The shell's assets
// are hashed by the build, the wasm core is two big files, and the patch is whatever
// CI last cut -- a manifest of all that is a thing to keep in sync, and the behaviour
// we actually want is simpler. Cache what the page asks for as it asks for it; after
// one visit the shell, the core and the patch are all on the device, and solo play
// (which opens no socket anyway) works with no network at all.
//
// Two rules, and the second one is the important one:
//
//   - `br-version.json` is network-first. It is how the page learns a new patch exists,
//     so a cached one would pin somebody to an old build forever -- and a room refuses
//     a peer on a different patch (POK-244), so that is not a small thing.
//   - everything else same-origin is cache-first, revalidated in the background.
//
// Cross-origin isolation survives this. A cached Response carries the headers it was
// stored with, and those came from a server that sets COOP/COEP (vercel.json), so
// replaying one keeps SharedArrayBuffer working. Nothing here synthesises a Response.
//
// The ROM itself is never touched: it lives in IndexedDB, put there by the player, and
// the Cache API never sees it.
const CACHE = 'hbr-v1';

/** Never cached: the page must see the real answer or it cannot know it is out of date. */
const ALWAYS_NETWORK = ['/patch/br-version.json'];

/** The one thing runtime caching cannot reach on its own. The navigation that loads the
 *  page happens BEFORE this worker controls anything, so `/` is never a fetch we see --
 *  and the next navigation is the offline one. Everything else the page asks for goes
 *  through us and caches itself. */
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // One at a time and forgiving: a single 404 in `addAll` throws the whole install
      // away, and an icon that did not ship is not a reason to have no offline at all.
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            await cache.add(new Request(path, { cache: 'reload' }));
          } catch {
            // Not there, or not reachable: runtime caching still covers it later.
          }
        }),
      );
      // Take over as soon as ready rather than waiting for every tab to close: a shell
      // update nobody can get to is not an update.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the relay, and anything else, is not ours
  if (ALWAYS_NETWORK.some((path) => url.pathname.endsWith(path))) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    // Offline: the last one we saw is better than nothing, and the page handles a
    // version it cannot reach.
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Freshen it for next time, but do not make this load wait on the network.
    revalidate(request);
    return cached;
  }
  const response = await fetch(request);
  // Only full 200s: a 206 range response is a fragment, and caching one would hand
  // back a piece of the wasm as if it were the whole thing.
  if (response.ok && response.status === 200) {
    (await caches.open(CACHE)).put(request, response.clone());
  }
  return response;
}

function revalidate(request) {
  fetch(request)
    .then(async (response) => {
      if (response.ok && response.status === 200) {
        (await caches.open(CACHE)).put(request, response.clone());
      }
    })
    .catch(() => {
      // Offline, or the file is gone: the cached copy stands.
    });
}
