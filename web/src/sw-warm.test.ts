import { describe, expect, it } from 'vitest';
import { warm, warmList } from './sw-warm';
import appSource from './app.ts?raw';

describe('what a first visit hands the service worker (POK-246)', () => {
  const origin = 'https://hoenn.example';

  it('asks again for each same-origin file the page loaded, once, query and all', () => {
    const names = [
      `${origin}/assets/main-abc.js`,
      `${origin}/emu/mgba.js`,
      `${origin}/emu/mgba.wasm`,
      `${origin}/emu/mgba.js`, // the pthread workers load it again
      `${origin}/patch/hoenn-br.bps?v=7da772`,
      `${origin}/ui/font-normal.png`,
      'wss://relay.example/room', // the relay is not ours
      'https://fonts.example/x.woff2',
    ];
    expect(warmList(names.map((name) => ({ name, workerStart: 0 })), origin)).toEqual([
      '/assets/main-abc.js',
      '/emu/mgba.js',
      '/emu/mgba.wasm',
      '/patch/hoenn-br.bps?v=7da772',
      '/ui/font-normal.png',
    ]);
  });

  it('leaves alone what already came through a worker', () => {
    expect(warmList([{ name: `${origin}/a.js`, workerStart: 12.5 }, { name: `${origin}/b.js`, workerStart: 0 }, { name: `${origin}/c.js` }], origin)).toEqual(['/b.js', '/c.js']);
  });

  it('fetches them one at a time and gets past one that fails', async () => {
    const asked: string[] = [];
    const got = await warm(['/a.js', '/gone.png', '/b.js'], async (path) => {
      asked.push(path);
      if (path === '/gone.png') throw new Error('offline');
    });
    expect(asked).toEqual(['/a.js', '/gone.png', '/b.js']);
    expect(got).toBe(2);
  });

  it('is done when the worker takes control of the page, not on every load', () => {
    // The warm is the controllerchange listener's, set up before register(): a page that
    // loaded under a worker already fetched everything through it.
    const from = appSource.indexOf('const hand = ');
    const to = appSource.indexOf("register('/sw.js')");
    expect(from, 'the hand-over').toBeGreaterThan(0);
    expect(to, 'set up before the worker is registered').toBeGreaterThan(from);
    const wiring = appSource.slice(from, to);
    expect(wiring).toContain('warm(warmList(');
    expect(wiring).toContain("addEventListener(\n      'controllerchange'");
    // ...and what was still loading then, as it lands.
    expect(wiring).toContain("observe({ type: 'resource' })");
  });
});
