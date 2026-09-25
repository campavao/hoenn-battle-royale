// Fetches whatever CI has published for the shell to run (POK-213): the version
// info, the BPS patch itself, and the symbol table the patch's addresses come from
// (per CLAUDE.md: never hard-code an EWRAM address in the shell). Nothing here talks
// to the emulator -- that's app.ts's job, using patch/bps.ts to apply what this loads.
//
// br-version.json is the root of trust (POK-330 #23). It is the one file fetched fresh
// every time; the patch and the symbols are then fetched BY the ROM sha1 it names
// (`?v=<romSha1>`), so a new build is a new URL. The service worker keeps those
// forever and never revalidates them, and a cached copy can no longer be a stale game
// under a fresh version number -- nor can one build's symbols meet another's patch.
// What the patch builds is still checked against the sha1 (loadCheckedRelease): a URL
// can only name the build, not promise it.

import { sha1Hex } from './rom/emerald';

export interface ReleaseInfo {
  patch: number;
  protocol: number;
  shell: string;
  romSha1: string;
  commit: string;
  builtAt: string;
}

export type ReleaseState =
  | {
      status: 'ready';
      info: ReleaseInfo;
      patch: Uint8Array;
      symbols: Map<string, number>;
      /** The ROM sha1 br-symbols.json says it was made for, when it says (tools/br/symbols.py). */
      symbolsFor?: string;
    }
  | { status: 'unpublished'; reason: string };

const VERSION_URL = '/patch/br-version.json';
const PATCH_URL = '/patch/hoenn-br.bps';
const SYMBOLS_URL = '/patch/br-symbols.json';

const UNPUBLISHED_REASON = 'no patch published yet';

/** Where a release's patch and symbols live: named by the ROM they build. The static
 *  host ignores the query; the service worker and the HTTP cache key on it. */
export function releaseUrls(info: Pick<ReleaseInfo, 'romSha1'>): { patch: string; symbols: string } {
  if (!info.romSha1) return { patch: PATCH_URL, symbols: SYMBOLS_URL };
  const v = `?v=${encodeURIComponent(info.romSha1)}`;
  return { patch: PATCH_URL + v, symbols: SYMBOLS_URL + v };
}

// A dev server answers a missing file with index.html; that is "not there" too.
function isHtml(res: Response): boolean {
  const type = typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null;
  return (type ?? '').includes('text/html');
}

// The version is revalidated with the server on every load (a 304 when nothing moved):
// a cached one would pin a player to an old build. The patch and the symbols take the
// default -- their URLs change with the build -- unless a check has just caught a bad
// copy, when `reload` goes past every cache to the network.
const FRESH: RequestInit = { cache: 'no-cache' };
const RELOAD: RequestInit = { cache: 'reload' };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return null; // network error, offline, etc. -- treated the same as "not there"
  }
  if (!res.ok) return null;
  if (isHtml(res)) return null;
  return (await res.json()) as T;
}

async function fetchBytes(url: string, init?: RequestInit): Promise<Uint8Array | null> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  // A dev server answers a missing file with index.html; that is "not there" too.
  if (isHtml(res)) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** Addresses only: the table also carries its build's romSha1, which is not one. */
function parseSymbols(raw: Record<string, string>): { symbols: Map<string, number>; symbolsFor?: string } {
  const symbols = new Map<string, number>();
  for (const [name, hex] of Object.entries(raw)) {
    if (/^0x[0-9a-f]+$/i.test(hex)) symbols.set(name, Number.parseInt(hex, 16));
  }
  return { symbols, symbolsFor: typeof raw.romSha1 === 'string' ? raw.romSha1 : undefined };
}

/** Dev only: the sidecars without a patch, for a ROM that is already patched (a local
 * build). tools/br/dev-patch.sh writes them into web/public/patch/. */
export async function loadSidecars(): Promise<{ info: ReleaseInfo; symbols: Map<string, number> } | null> {
  const [info, rawSymbols] = await Promise.all([
    fetchJson<ReleaseInfo>(VERSION_URL, FRESH),
    fetchJson<Record<string, string>>(SYMBOLS_URL, FRESH),
  ]);
  if (!info || !rawSymbols) return null;
  return { info, symbols: parseSymbols(rawSymbols).symbols };
}

/** Loads the release triple, or a clear "nothing published yet" state -- never throws
 * on a missing file, since that's the normal state before CI's first release.
 * `reload` fetches the patch and the symbols past every cache. */
export async function loadRelease(opts: { reload?: boolean } = {}): Promise<ReleaseState> {
  const info = await fetchJson<ReleaseInfo>(VERSION_URL, FRESH);
  if (!info) return { status: 'unpublished', reason: UNPUBLISHED_REASON };

  const urls = releaseUrls(info);
  const init = opts.reload ? RELOAD : undefined;
  const [patch, rawSymbols] = await Promise.all([fetchBytes(urls.patch, init), fetchJson<Record<string, string>>(urls.symbols, init)]);
  if (!patch || !rawSymbols) {
    // Named but not reachable: offline before this build's patch ever came down.
    const reason = info.romSha1 ? `patch ${info.romSha1.slice(0, 7)} could not be downloaded` : UNPUBLISHED_REASON;
    return { status: 'unpublished', reason };
  }

  return { status: 'ready', info, patch, ...parseSymbols(rawSymbols) };
}

/** Why what a release built is not the build br-version.json names -- or null when it
 *  is, or when the version file names no sha1 to check against. */
export function buildMismatch(info: Pick<ReleaseInfo, 'romSha1'>, builtSha1: string, symbolsFor?: string): string | null {
  const want = info.romSha1 ?? '';
  if (!want) return null;
  if (builtSha1 !== want) return `this tab built rom ${builtSha1.slice(0, 7)}, and the current release is ${want.slice(0, 7)}`;
  if (symbolsFor !== undefined && symbolsFor !== want) {
    return `the symbol table is for rom ${symbolsFor.slice(0, 7)}, and the current release is ${want.slice(0, 7)}`;
  }
  return null;
}

export type CheckedRelease =
  | { status: 'unpublished'; reason: string }
  | {
      status: 'ready';
      info: ReleaseInfo;
      /** The patched ROM. */
      rom: Uint8Array;
      symbols: Map<string, number>;
      /** Set when even a fetch past every cache did not build the named ROM: why. */
      stale: string | null;
    };

/** Loads the release and applies it with `apply`, then checks the result is the ROM
 *  br-version.json names. A copy that is not -- a cache that outlived its build, a
 *  deploy landing between two fetches -- is fetched once more straight from the
 *  network. If that still does not match, the result says why in `stale`: fine for
 *  solo, not for a room, where both sides must run the same build. */
export async function loadCheckedRelease(apply: (patch: Uint8Array) => Promise<Uint8Array>): Promise<CheckedRelease> {
  const first = await loadRelease();
  if (first.status !== 'ready') return first;
  const build = async (r: Extract<ReleaseState, { status: 'ready' }>) => {
    const rom = await apply(r.patch);
    return { r, rom, stale: buildMismatch(r.info, await sha1Hex(rom), r.symbolsFor) };
  };

  let got: Awaited<ReturnType<typeof build>> | null = null;
  let failure: unknown = null;
  try {
    got = await build(first);
  } catch (err) {
    failure = err; // a copy that will not even apply is as stale as one that builds the wrong ROM
  }
  if (!got || got.stale) {
    const again = await loadRelease({ reload: true });
    if (again.status === 'ready') {
      try {
        // The fresh copy wins even when it is still wrong: it is the one the server has.
        got = await build(again);
      } catch (err) {
        if (!got) throw err;
      }
    }
  }
  if (!got) throw failure;
  return { status: 'ready', info: got.r.info, rom: got.rom, symbols: got.r.symbols, stale: got.stale };
}
