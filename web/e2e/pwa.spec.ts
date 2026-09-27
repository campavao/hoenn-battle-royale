// Installable, and offline after one visit (POK-246).
//
// Runs against the built site rather than the dev server, because that is the thing
// that ships: the worker is registered in production only (in dev it would cache the
// dev server's own modules and fight HMR), so a test against `npm run dev` would be
// testing nothing.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const __dirname = import.meta.dirname;
const DIST = path.resolve(__dirname, '../dist');

test.beforeAll(() => {
  test.skip(!fs.existsSync(path.join(DIST, 'index.html')), 'no dist/ -- run `npm run build` first');
});

test('the built site is installable', async () => {
  // The manifest is a file, not a behaviour, so read it as one rather than booting a
  // browser to look at it.
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8')) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    icons: { src: string; purpose?: string }[];
  };
  expect(manifest.name).toContain('Hoenn');
  // A launcher shows the short name; over about a dozen characters it is truncated.
  expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  // One ordinary icon and one maskable: without the maskable one, Android crops the
  // square and takes the corners off.
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    expect(fs.existsSync(path.join(DIST, icon.src.replace(/^\//, ''))), `${icon.src} shipped`).toBe(true);
  }

  // And the page points at it.
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  expect(html).toContain('rel="manifest"');
  expect(html).toContain('theme-color');
});

test('the worker caches what it should and never the version file', async () => {
  const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
  // The one rule that matters: a cached br-version.json would pin somebody to an old
  // patch forever, and a room refuses a peer on a different one (POK-244).
  expect(sw).toContain('br-version.json');
  expect(sw).toContain('networkFirst');
  // Cross-origin requests (the relay) are left alone entirely.
  expect(sw).toContain('url.origin !== self.location.origin');
  // And a partial response is never stored as if it were the whole file.
  expect(sw).toContain('response.status === 200');
});

// The built site, served by `vite preview` on its own port (playwright.config.ts) with
// the same COOP/COEP headers production sends.
const PREVIEW = 'http://localhost:5175';

test('after one visit the shell comes back with the network gone', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const said: string[] = [];
    page.on('console', (m) => said.push(m.text()));
    await page.goto(`${PREVIEW}/`);
    // The import screen is the shell being up; the ROM is the player's and we have not
    // given it one, which is exactly the state a first visit is in.
    await expect(page.locator('#screen-importing')).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });

    // ...and everything that visit ran on is kept, the core too -- all of it fetched
    // before the worker existed, and handed to it once it took over (sw-warm.ts).
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const kept = async (p: string) => (await caches.match(p, { ignoreVary: true })) !== undefined;
            return (await kept('/emu/mgba.js')) && (await kept('/emu/mgba.wasm'));
          }),
        { timeout: 30_000, message: 'the core is on the device' },
      )
      .toBe(true);

    // Now take the network away entirely and come back.
    await ctx.setOffline(true);
    said.length = 0;
    await page.reload();
    await expect(page.locator('#screen-importing')).toBeVisible({ timeout: 30_000 });
    // Not an error page: the real shell, with its own import screen -- drawn on the
    // stage once the core is up (POK-320), so it gets the core's time.
    await expect(page.locator('#dropzone')).toBeVisible({ timeout: 30_000 });
    // And the core came up behind it: offline, a core that could not be fetched said so.
    await page.waitForTimeout(3_000);
    expect(said.filter((line) => /startup failed|Aborted\(/.test(line)), 'the core booted offline').toEqual([]);
  } finally {
    await ctx.setOffline(false);
    await ctx.close();
  }
});
