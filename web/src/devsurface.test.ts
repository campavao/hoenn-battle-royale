// The page's dev surface, held to what the e2e reads off it (POK-330 #42).
//
// The specs drive a match through `window.__br` and `window.__hbr`, which the page writes
// by hand, in DEV only, from wherever the thing lives -- a closure in app.ts, a Bridge.
// Pulling the match out of app.ts moves those things, and a field a spec reads that the
// page no longer writes fails as a timeout minutes into an e2e run, far from the move.
// This fails at once, and names the field.
import { describe, expect, it } from 'vitest';
import appSource from './app.ts?raw';
import bridgeSource from './net/bridge.ts?raw';

const specs = import.meta.glob<string>('../e2e/*.spec.ts', { query: '?raw', import: 'default', eager: true });

/** Every field of `__br` the page writes, and so every one a spec may read. */
const FIELDS = ['bridge', 'roster', 'mailbox', 'director', 'botCount', 'match', 'watch', 'spectate', 'controls'];

/** What the specs read: `__br.x` and `__br?.x`, and `br.x` off a local copy of it. The
 *  lookbehind keeps out `hoenn-br.bps`, the patch's file name. */
function fieldsRead(of: RegExp): Set<string> {
  const read = new Set<string>();
  for (const source of Object.values(specs)) for (const m of source.matchAll(of)) read.add(m[1]);
  return read;
}
const brRead = new Set([...fieldsRead(/__br\??\.(\w+)/g), ...fieldsRead(/(?<![\w-])br\??\.(\w+)/g)]);

/** What the page writes: `dev.x =` in app.ts, and the object bridge.ts sets `__br` to. */
const bridgeObject = /__br = \{([^}]*)\}/.exec(bridgeSource)?.[1] ?? '';
const brWritten = new Set([
  ...Array.from(appSource.matchAll(/\bdev\.(\w+) =/g), (m) => m[1]),
  ...Array.from(bridgeObject.matchAll(/(\w+):/g), (m) => m[1]),
]);

describe('the e2e dev surface', () => {
  it('finds the specs and what they read', () => {
    // A glob or a regex that silently matched nothing would make the rest vacuous.
    expect(Object.keys(specs).length).toBeGreaterThan(10);
    expect(brRead.size).toBeGreaterThan(5);
  });

  it('every field of __br a spec reads is one the page has', () => {
    expect([...brRead].filter((f) => !FIELDS.includes(f))).toEqual([]);
  });

  it('the page writes every one of them', () => {
    expect(FIELDS.filter((f) => !brWritten.has(f))).toEqual([]);
  });

  it('__hbr is the emulator, which is all a spec reads of it', () => {
    expect([...fieldsRead(/__hbr\??\.(\w+)/g)]).toEqual(['emu']);
    expect(appSource).toMatch(/__hbr = \{ emu \}/);
  });
});
