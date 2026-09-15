// Fetches whatever CI has published for the shell to run (POK-213): the version
// info, the BPS patch itself, and the symbol table the patch's addresses come from
// (per CLAUDE.md: never hard-code an EWRAM address in the shell). Nothing here talks
// to the emulator -- that's app.ts's job, using patch/bps.ts to apply what this loads.

export interface ReleaseInfo {
  patch: number;
  protocol: number;
  shell: string;
  romSha1: string;
  commit: string;
  builtAt: string;
}

export type ReleaseState =
  | { status: 'ready'; info: ReleaseInfo; patch: Uint8Array; symbols: Map<string, number> }
  | { status: 'unpublished'; reason: string };

const VERSION_URL = '/patch/br-version.json';
const PATCH_URL = '/patch/hoenn-br.bps';
const SYMBOLS_URL = '/patch/br-symbols.json';

const UNPUBLISHED_REASON = 'no patch published yet';

async function fetchJson<T>(url: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null; // network error, offline, etc. -- treated the same as "not there"
  }
  if (!res.ok) return null;
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return null;
  return (await res.json()) as T;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  // A dev server answers a missing file with index.html; that is "not there" too.
  if ((res.headers.get('content-type') ?? '').includes('text/html')) return null;
  return new Uint8Array(await res.arrayBuffer());
}

function parseSymbols(raw: Record<string, string>): Map<string, number> {
  const symbols = new Map<string, number>();
  for (const [name, hex] of Object.entries(raw)) symbols.set(name, Number.parseInt(hex, 16));
  return symbols;
}

/** Dev only: the sidecars without a patch, for a ROM that is already patched (a local
 * build). tools/br/dev-patch.sh writes them into web/public/patch/. */
export async function loadSidecars(): Promise<{ info: ReleaseInfo; symbols: Map<string, number> } | null> {
  const [info, rawSymbols] = await Promise.all([fetchJson<ReleaseInfo>(VERSION_URL), fetchJson<Record<string, string>>(SYMBOLS_URL)]);
  if (!info || !rawSymbols) return null;
  return { info, symbols: parseSymbols(rawSymbols) };
}

/** Loads the release triple, or a clear "nothing published yet" state -- never throws
 * on a missing file, since that's the normal state before CI's first release. */
export async function loadRelease(): Promise<ReleaseState> {
  const info = await fetchJson<ReleaseInfo>(VERSION_URL);
  if (!info) return { status: 'unpublished', reason: UNPUBLISHED_REASON };

  const [patch, rawSymbols] = await Promise.all([fetchBytes(PATCH_URL), fetchJson<Record<string, string>>(SYMBOLS_URL)]);
  if (!patch || !rawSymbols) return { status: 'unpublished', reason: UNPUBLISHED_REASON };

  return { status: 'ready', info, patch, symbols: parseSymbols(rawSymbols) };
}
