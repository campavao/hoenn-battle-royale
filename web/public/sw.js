// Offline, and a patch you notice (POK-246).
//
// Not a precache: there is no generated file list here on purpose. The shell's assets
// are hashed by the build, the wasm core is two big files, and the patch is whatever
// CI last cut -- a manifest of all that is a thing to keep in sync, and the behaviour
// we actually want is simpler. Cache what the page asks for as it asks for it; after
// one visit the shell, the core and the patch are all on the device, and solo play
// (which opens no socket anyway) works with no network at all.
//
// Which rule a request gets is the whole design (POK-330 #23). Before it, only the
// version file was fetched fresh and everything else was served from the cache and
// revalidated behind the page's back: the first load after every release ran the old
// page and the old ROM under the new version number, a later one could pair one
// build's symbols with another's patch, and the 10 MB patch came down again on every
// load. Now:
//
//   - pages (navigations) and `br-version.json`: network first, the cache only when
//     offline. The version file is how the page learns what to run, so it and the page
//     that reads it are never older than the server's.
//   - `/patch/*?v=<romSha1>`: the patch and symbols, named by the build they are for.
//     Cache first and never revalidated -- a new build is a new URL -- except when the
//     page asks with `cache: 'reload'`, which it does when a copy failed its check. One
//     copy per file is kept; the one it replaces goes.
//   - `/assets/*`: the build's hashed files. Cache first, never revalidated; the ones no
//     longer reachable from the current page are pruned.
//   - `/emu/*`: the core, a js/wasm pair that must match. Network first, so both come
//     from the same deploy: the HTTP cache makes that a 304 when nothing moved.
//   - anything else of ours (map stills, sprites, icons): cache first, revalidated in
//     the background.
//
// Cross-origin isolation survives this. A cached Response carries the headers it was
// stored with, and those came from a server that sets COOP/COEP (vercel.json), so
// replaying one keeps SharedArrayBuffer working. Nothing here synthesises a Response.
//
// The ROM itself is never touched: it lives in IndexedDB, put there by the player, and
// the Cache API never sees it.
const CACHE = 'hbr-v2'; // v1 kept a patch per URL for ever; activate drops it

const VERSION_PATH = '/patch/br-version.json';

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
  const path = url.pathname;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event, request, { page: true }));
  } else if (path === VERSION_PATH) {
    event.respondWith(networkFirst(event, request));
  } else if (path.startsWith('/patch/')) {
    // No `v`: an old page, or a dev file. Never cached -- a fixed name is exactly what
    // let a stale patch pass for a fresh one.
    event.respondWith(url.searchParams.has('v') ? immutable(event, request, { onePerPath: true }) : networkOnly(request));
  } else if (path.startsWith('/assets/')) {
    event.respondWith(immutable(event, request));
  } else if (path.startsWith('/emu/')) {
    event.respondWith(networkFirst(event, request));
  } else {
    event.respondWith(cacheFirst(event, request));
  }
});

/** A whole, plain 200: a 206 range response is a fragment (caching one would hand back
 *  a piece of the wasm as if it were the whole thing), and a redirected page cannot
 *  answer a navigation. */
function storable(response) {
  return response.ok && response.status === 200 && !response.redirected;
}

async function put(request, response) {
  const cache = await caches.open(CACHE);
  // The same bytes again (a 304 the HTTP cache answered) need not be written again.
  const etag = response.headers.get('etag');
  if (etag) {
    const had = await cache.match(request);
    if (had && had.headers.get('etag') === etag) return;
  }
  await cache.put(request, response);
}

async function networkFirst(event, request, { page = false } = {}) {
  try {
    const response = await fetch(request);
    if (storable(response)) {
      const copy = response.clone();
      event.waitUntil(
        (async () => {
          await put(request, copy.clone());
          if (page && new URL(request.url).pathname === '/') await pruneAssets(await copy.text());
        })(),
      );
    }
    return response;
  } catch (err) {
    // Offline: the last one we saw is better than nothing, and the page handles a
    // version it cannot reach. A page asked for with a query is still the page.
    const cached = await caches.match(request, { ignoreSearch: page });
    if (cached) return cached;
    throw err;
  }
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

/** A URL whose content never changes: served from the cache without asking, unless the
 *  page asks past every cache (`cache: 'reload'`) because a copy failed its check. */
async function immutable(event, request, { onePerPath = false } = {}) {
  if (request.cache !== 'reload') {
    const cached = await caches.match(request);
    if (cached) return cached;
  }
  const response = await fetch(request);
  if (storable(response)) {
    const copy = response.clone();
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        await cache.put(request, copy);
        if (!onePerPath) return;
        // The build this one replaces: nothing will ask for it by this name again.
        const here = new URL(request.url);
        for (const key of await cache.keys()) {
          const old = new URL(key.url);
          if (old.pathname === here.pathname && old.search !== here.search) await cache.delete(key);
        }
      })(),
    );
  }
  return response;
}

async function cacheFirst(event, request) {
  const cached = await caches.match(request);
  if (cached) {
    // Freshen it for next time, but do not make this load wait on the network.
    event.waitUntil(revalidate(request));
    return cached;
  }
  const response = await fetch(request);
  if (storable(response)) event.waitUntil(put(request, response.clone()));
  return response;
}

async function revalidate(request) {
  try {
    const response = await fetch(request);
    if (storable(response)) await put(request, response);
  } catch {
    // Offline, or the file is gone: the cached copy stands.
  }
}

/** Every /assets/ name a page or script mentions. */
function assetRefs(text) {
  return text.match(/\/assets\/[A-Za-z0-9_.-]+/g) ?? [];
}

/** Drops the hashed files of builds gone by: everything under /assets/ that neither the
 *  page nor a script it loads (the patch worker is only named in main's) mentions. A
 *  script not cached yet is not read -- a new build's arrive after its page -- which
 *  can cost a file the next load fetches again, never a file this one still needs. */
async function pruneAssets(html) {
  const cache = await caches.open(CACHE);
  const keep = new Set(assetRefs(html));
  for (const ref of [...keep]) {
    if (!ref.endsWith('.js')) continue;
    const script = await cache.match(ref);
    if (script) for (const inner of assetRefs(await script.text())) keep.add(inner);
  }
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname;
    if (path.startsWith('/assets/') && !keep.has(path)) await cache.delete(key);
  }
}
