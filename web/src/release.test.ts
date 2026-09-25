import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMismatch, loadCheckedRelease, loadRelease, releaseUrls } from './release';
import { sha1Hex } from './rom/emerald';
import swSource from '../public/sw.js?raw';

const INFO = {
  patch: 3,
  protocol: 11,
  shell: 'abc123',
  romSha1: 'f3ae088181bf583e55daf962a92bb46f4f1d07b7',
  commit: 'deadbeef',
  builtAt: '2026-09-15T00:00:00Z',
};
const SYMBOLS_RAW = { gBrMailbox: '0x02024000', gSaveBlock1Ptr: '0x03005d90' };
const BPS_BYTES = new Uint8Array([0x42, 0x50, 0x53, 0x31, 1, 2, 3]);

function ok(body: unknown, binary = false) {
  return {
    ok: true,
    json: async () => body,
    arrayBuffer: async () => (binary ? (body as Uint8Array).buffer : new ArrayBuffer(0)),
  } as Response;
}
const notFound = { ok: false } as Response;

describe('loadRelease', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the full release when all three files are published', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('br-version.json')) return ok(INFO);
      if (url.includes('hoenn-br.bps')) return ok(BPS_BYTES, true);
      if (url.includes('br-symbols.json')) return ok(SYMBOLS_RAW);
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    const state = await loadRelease();
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') throw new Error('unreachable');
    expect(state.info).toEqual(INFO);
    expect(state.patch).toEqual(BPS_BYTES);
    expect(state.symbols.get('gBrMailbox')).toBe(0x02024000);
    expect(state.symbols.get('gSaveBlock1Ptr')).toBe(0x03005d90);
  });

  it('reports unpublished when br-version.json is missing', async () => {
    globalThis.fetch = vi.fn(async () => notFound) as typeof fetch;
    const state = await loadRelease();
    expect(state).toEqual({ status: 'unpublished', reason: 'no patch published yet' });
  });

  it('reports unpublished when the version exists but the patch file does not', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('br-version.json')) return ok(INFO);
      return notFound;
    }) as typeof fetch;

    const state = await loadRelease();
    expect(state.status).toBe('unpublished');
  });

  it('reports unpublished when the symbol table is missing', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('br-version.json')) return ok(INFO);
      if (url.includes('hoenn-br.bps')) return ok(BPS_BYTES, true);
      return notFound;
    }) as typeof fetch;

    const state = await loadRelease();
    expect(state.status).toBe('unpublished');
  });

  it('fetches the patch and the symbols by the sha1 the version names (POK-330 #23)', async () => {
    const asked: Array<[string, RequestCache | undefined]> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      asked.push([url, init?.cache]);
      if (url.includes('br-version.json')) return ok(INFO);
      if (url.includes('hoenn-br.bps')) return ok(BPS_BYTES, true);
      return ok({ ...SYMBOLS_RAW, romSha1: INFO.romSha1 });
    }) as typeof fetch;

    const state = await loadRelease();
    if (state.status !== 'ready') throw new Error('not ready');
    expect(asked).toEqual([
      ['/patch/br-version.json', 'no-cache'], // revalidated every time: the root of trust
      [`/patch/hoenn-br.bps?v=${INFO.romSha1}`, undefined],
      [`/patch/br-symbols.json?v=${INFO.romSha1}`, undefined],
    ]);
    // The stamp is the table's build, not an address.
    expect(state.symbolsFor).toBe(INFO.romSha1);
    expect(state.symbols.has('romSha1')).toBe(false);
    expect(releaseUrls({ romSha1: '' })).toEqual({ patch: '/patch/hoenn-br.bps', symbols: '/patch/br-symbols.json' });
  });
});

describe('what a release builds (POK-330 #23)', () => {
  it('buildMismatch names the ROM and the symbol table that are not the release', () => {
    const sha = INFO.romSha1;
    expect(buildMismatch(INFO, sha)).toBeNull();
    expect(buildMismatch(INFO, sha, sha)).toBeNull();
    expect(buildMismatch({ romSha1: '' }, 'anything')).toBeNull(); // nothing to check against
    expect(buildMismatch(INFO, '0123456789abcdef')).toBe('this tab built rom 0123456, and the current release is f3ae088');
    expect(buildMismatch(INFO, sha, 'aaaaaaaaaa')).toBe('the symbol table is for rom aaaaaaa, and the current release is f3ae088');
  });

  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** A server whose cached copies are an older build's (unless `cached: 'fresh'`):
   *  `reload` gets the real thing, the old one again, or nothing at all. The patch's
   *  one byte says which ROM it builds. */
  async function serve(
    opts: { cached?: 'fresh' | 'old'; reload?: 'fresh' | 'old' | 'offline'; oldSymbols?: boolean } = {},
  ) {
    const good = new Uint8Array([1, 2, 3, 4]);
    const old = new Uint8Array([9, 9]);
    const info = { ...INFO, romSha1: await sha1Hex(good) };
    const reloads: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const reload = init?.cache === 'reload';
      if (reload) {
        reloads.push(url);
        if (opts.reload === 'offline') throw new TypeError('offline');
      }
      const fresh = reload ? (opts.reload ?? 'fresh') === 'fresh' : opts.cached === 'fresh';
      if (url.includes('br-version.json')) return ok(info);
      if (url.includes('hoenn-br.bps')) return ok(new Uint8Array([fresh ? 1 : 0]), true);
      const stamp = opts.oldSymbols && !fresh ? 'feedfacefeedface' : info.romSha1;
      return ok({ ...SYMBOLS_RAW, romSha1: stamp });
    }) as typeof fetch;
    const apply = vi.fn(async (patch: Uint8Array) => (patch[0] === 1 ? good : old));
    return { good, old, reloads, apply };
  }

  it('a copy that builds the named ROM is used as it is', async () => {
    const { good, apply, reloads } = await serve({ cached: 'fresh' });
    const r = await loadCheckedRelease(apply);
    if (r.status !== 'ready') throw new Error('not ready');
    expect(r.rom).toBe(good);
    expect(r.stale).toBeNull();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(reloads).toEqual([]);
  });

  it('a stale copy is fetched again past every cache, and the fresh one is used', async () => {
    const { good, reloads, apply } = await serve();
    const r = await loadCheckedRelease(apply);
    if (r.status !== 'ready') throw new Error('not ready');
    expect(r.rom).toBe(good);
    expect(r.stale).toBeNull();
    expect(reloads.map((u) => u.split('?')[0])).toEqual(['/patch/hoenn-br.bps', '/patch/br-symbols.json']);
  });

  it('a symbol table from another build is refetched too, even when the ROM is right', async () => {
    const { good, reloads } = await serve({ oldSymbols: true });
    const r = await loadCheckedRelease(async () => good);
    if (r.status !== 'ready') throw new Error('not ready');
    expect(r.stale).toBeNull();
    expect(reloads).toHaveLength(2);
  });

  it('still wrong from the network: the result says why, so rooms can refuse it', async () => {
    const { old, apply } = await serve({ reload: 'old' });
    const r = await loadCheckedRelease(apply);
    if (r.status !== 'ready') throw new Error('not ready');
    expect(r.rom).toBe(old);
    expect(r.stale).toMatch(/^this tab built rom [0-9a-f]{7}, and the current release is [0-9a-f]{7}$/);
  });

  it('offline, the stale copy is kept and flagged rather than lost', async () => {
    const { old, apply } = await serve({ reload: 'offline' });
    const r = await loadCheckedRelease(apply);
    if (r.status !== 'ready') throw new Error('not ready');
    expect(r.rom).toBe(old);
    expect(r.stale).not.toBeNull();
  });

  it('a copy that will not even apply is fetched again before anything fails', async () => {
    const { good } = await serve();
    const apply = vi.fn(async (patch: Uint8Array) => {
      if (patch[0] !== 1) throw new Error('source crc mismatch');
      return good;
    });
    const r = await loadCheckedRelease(apply);
    if (r.status !== 'ready') throw new Error('not ready');
    expect(r.rom).toBe(good);
    expect(r.stale).toBeNull();
  });
});

// ---- the service worker (web/public/sw.js), run against fake caches and network ------

const ORIGIN = 'https://hbr.test';
type FakeRequest = { url: string; method: string; mode: string; cache: string };

class FakeCache {
  entries = new Map<string, Response>();
  private key(r: string | { url: string }): string {
    return typeof r === 'string' ? new URL(r, ORIGIN).href : r.url;
  }
  async match(r: string | { url: string }, opts?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    const k = this.key(r);
    const hit = this.entries.get(k) ?? (opts?.ignoreSearch ? [...this.entries].find(([e]) => e.split('?')[0] === k.split('?')[0])?.[1] : undefined);
    return hit?.clone();
  }
  async put(r: string | { url: string }, res: Response): Promise<void> {
    this.entries.set(this.key(r), res);
  }
  async delete(r: string | { url: string }): Promise<boolean> {
    return this.entries.delete(this.key(r));
  }
  async keys(): Promise<Array<{ url: string }>> {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  paths(): string[] {
    return [...this.entries.keys()].map((u) => u.slice(ORIGIN.length)).sort();
  }
}

/** sw.js with a network that serves `files` (path+search -> body) unless `offline`. */
function runWorker(files: Record<string, string>) {
  const cache = new FakeCache();
  const net = { offline: false, asked: [] as string[] };
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL('/sw.js', ORIGIN),
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
  };
  const caches = {
    open: async () => cache,
    match: (r: string | { url: string }, o?: { ignoreSearch?: boolean }) => cache.match(r, o),
  };
  const fetch = async (req: FakeRequest) => {
    const u = new URL(req.url);
    net.asked.push(u.pathname + u.search);
    if (net.offline) throw new TypeError('Failed to fetch');
    const body = files[u.pathname + u.search] ?? files[u.pathname];
    return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 });
  };
  new Function('self', 'caches', 'fetch', swSource)(self, caches, fetch);

  /** One fetch through the worker; null when it leaves the request alone. */
  async function get(path: string, init: { mode?: string; cache?: string; method?: string } = {}): Promise<string | null> {
    const request: FakeRequest = {
      url: /^https?:/.test(path) ? path : ORIGIN + path,
      method: init.method ?? 'GET',
      mode: init.mode ?? 'cors',
      cache: init.cache ?? 'default',
    };
    let responded: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.fetch({ request, respondWith: (p: Promise<Response>) => void (responded = p), waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    if (!responded) return null;
    const res: Response = await responded;
    for (let i = 0; i < waits.length; i++) await waits[i];
    return res.text();
  }
  return { get, cache, net };
}

describe('the service worker (POK-330 #23)', () => {
  it('keeps a patch named by its build for good, without asking the network again', async () => {
    const sw = runWorker({ '/patch/hoenn-br.bps': 'BPS-A' });
    expect(await sw.get('/patch/hoenn-br.bps?v=aaa')).toBe('BPS-A');
    expect(await sw.get('/patch/hoenn-br.bps?v=aaa')).toBe('BPS-A');
    expect(await sw.get('/patch/hoenn-br.bps?v=aaa')).toBe('BPS-A');
    expect(sw.net.asked).toEqual(['/patch/hoenn-br.bps?v=aaa']); // one 10 MB download, not one a load
  });

  it('a new build is a new URL, and the copy it replaces goes', async () => {
    const files = { '/patch/hoenn-br.bps': 'BPS-A' };
    const sw = runWorker(files);
    await sw.get('/patch/hoenn-br.bps?v=aaa');
    files['/patch/hoenn-br.bps'] = 'BPS-B';
    expect(await sw.get('/patch/hoenn-br.bps?v=bbb')).toBe('BPS-B');
    expect(sw.cache.paths()).toEqual(['/patch/hoenn-br.bps?v=bbb']);
  });

  it('a page that caught a bad copy gets past the cache with cache: reload', async () => {
    const files = { '/patch/br-symbols.json': 'OLD' };
    const sw = runWorker(files);
    await sw.get('/patch/br-symbols.json?v=aaa');
    files['/patch/br-symbols.json'] = 'NEW';
    expect(await sw.get('/patch/br-symbols.json?v=aaa')).toBe('OLD');
    expect(await sw.get('/patch/br-symbols.json?v=aaa', { cache: 'reload' })).toBe('NEW');
    expect(await sw.get('/patch/br-symbols.json?v=aaa')).toBe('NEW');
  });

  it('the version file and the page come from the network, and from the cache only offline', async () => {
    const files: Record<string, string> = { '/patch/br-version.json': 'v1', '/': '<html>one</html>' };
    const sw = runWorker(files);
    expect(await sw.get('/patch/br-version.json')).toBe('v1');
    expect(await sw.get('/', { mode: 'navigate' })).toBe('<html>one</html>');
    files['/patch/br-version.json'] = 'v2';
    files['/'] = '<html>two</html>';
    expect(await sw.get('/patch/br-version.json')).toBe('v2');
    expect(await sw.get('/', { mode: 'navigate' })).toBe('<html>two</html>'); // not one load behind
    sw.net.offline = true;
    expect(await sw.get('/patch/br-version.json')).toBe('v2');
    expect(await sw.get('/?x=1', { mode: 'navigate' })).toBe('<html>two</html>');
  });

  it('a patch with no build in its URL is never cached', async () => {
    const sw = runWorker({ '/patch/hoenn-br.bps': 'BPS' });
    expect(await sw.get('/patch/hoenn-br.bps')).toBe('BPS');
    expect(await sw.get('/patch/hoenn-br.bps')).toBe('BPS');
    expect(sw.net.asked).toHaveLength(2);
    expect(sw.cache.paths()).toEqual([]);
  });

  it('the core comes from the network as a pair, and from the cache offline', async () => {
    const files = { '/emu/mgba.js': 'glue-1', '/emu/mgba.wasm': 'wasm-1' };
    const sw = runWorker(files);
    await sw.get('/emu/mgba.js');
    await sw.get('/emu/mgba.wasm');
    files['/emu/mgba.js'] = 'glue-2';
    files['/emu/mgba.wasm'] = 'wasm-2';
    expect(await sw.get('/emu/mgba.js')).toBe('glue-2');
    expect(await sw.get('/emu/mgba.wasm')).toBe('wasm-2');
    sw.net.offline = true;
    expect(await sw.get('/emu/mgba.wasm')).toBe('wasm-2');
  });

  it('hashed assets are served from the cache, and an old build\'s are pruned', async () => {
    const files: Record<string, string> = {
      '/': '<script type="module" src="/assets/main-OLD.js"></script>',
      '/assets/main-OLD.js': 'new Worker(new URL("/assets/bps.worker-OLD.js", import.meta.url))',
      '/assets/bps.worker-OLD.js': 'old worker',
    };
    const sw = runWorker(files);
    await sw.get('/', { mode: 'navigate' });
    await sw.get('/assets/main-OLD.js');
    await sw.get('/assets/bps.worker-OLD.js');
    expect(await sw.get('/assets/main-OLD.js')).toBe(files['/assets/main-OLD.js']);
    expect(sw.net.asked.filter((p) => p.startsWith('/assets/'))).toHaveLength(2); // never revalidated

    // A deploy: a new page naming new scripts.
    files['/'] = '<script type="module" src="/assets/main-NEW.js"></script>';
    files['/assets/main-NEW.js'] = 'new Worker(new URL("/assets/bps.worker-NEW.js", import.meta.url))';
    files['/assets/bps.worker-NEW.js'] = 'new worker';
    await sw.get('/', { mode: 'navigate' });
    await sw.get('/assets/main-NEW.js');
    await sw.get('/assets/bps.worker-NEW.js');
    expect(sw.cache.paths().filter((p) => p.startsWith('/assets/'))).toEqual(['/assets/bps.worker-NEW.js', '/assets/main-NEW.js']);

    // And the next load keeps the worker main names, though the page never does.
    await sw.get('/', { mode: 'navigate' });
    expect(sw.cache.paths().filter((p) => p.startsWith('/assets/'))).toEqual(['/assets/bps.worker-NEW.js', '/assets/main-NEW.js']);
  });

  it('everything else is served from the cache and freshened behind it', async () => {
    const files = { '/field-maps/A.png': 'still-1' };
    const sw = runWorker(files);
    expect(await sw.get('/field-maps/A.png')).toBe('still-1');
    files['/field-maps/A.png'] = 'still-2';
    expect(await sw.get('/field-maps/A.png')).toBe('still-1');
    expect(await sw.get('/field-maps/A.png')).toBe('still-2');
  });

  it('leaves the relay and anything not GET alone', async () => {
    const sw = runWorker({});
    expect(await sw.get('https://relay.example/rooms')).toBeNull();
    expect(await sw.get('/patch/br-version.json', { method: 'POST' })).toBeNull();
    expect(sw.net.asked).toEqual([]);
  });
});
