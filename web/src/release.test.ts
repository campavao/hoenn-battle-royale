import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRelease } from './release';

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
});
