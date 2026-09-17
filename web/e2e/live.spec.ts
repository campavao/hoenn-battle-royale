// The deployed site, against the real thing: can a player bring their own retail Emerald
// and get battle royale out of it?
//
// Every other spec runs the dev server, where `import.meta.env.DEV` is true and two
// things are different from what a player gets: the shell will run a pre-patched local
// build instead of patching (app.ts's DEV branch), and there is no service worker. So the
// production path -- fetch the BPS, apply it in a worker, boot the result -- has never
// been exercised anywhere but here.
//
// Opt-in, because it goes over the internet and depends on a deploy being up:
//   HBR_LIVE_URL=https://hoenn-battle-royale.vercel.app \
//   HBR_BASE_ROM="/path/to/Pokemon - Emerald Version (U).gba" \
//   npx playwright test e2e/live.spec.ts
import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const site = process.env.HBR_LIVE_URL ?? '';
const baseRom = process.env.HBR_BASE_ROM ?? '';

test.beforeAll(() => {
  test.skip(
    !site || !baseRom || !fs.existsSync(baseRom),
    'set HBR_LIVE_URL to a deployed site and HBR_BASE_ROM to a retail Emerald (U) ROM',
  );
});

test('the deployed site patches a stock ROM in the browser', async ({ page }) => {
  test.setTimeout(180_000);

  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('pageerror', (e) => failed.push(`pageerror: ${e.message}`));

  await page.goto(`${site}/#solo`, { waitUntil: 'domcontentloaded' });
  // Picked as early as the page allows, ON PURPOSE. `#screen-importing` is the default
  // screen -- no `hidden` in index.html -- so the picker is live from the first paint,
  // while the change listener is not attached until runImportScreen runs, which is after
  // `await Emulator.create()`: five pthread workers and a 1.8 MB wasm core. Over a slow
  // line that gap is seconds, a change event fired inside it lands on nothing, and the
  // shell waits for ever for a file it was already given. That is what the first live
  // test of the deployed site hit, and it reads exactly like a shell that cannot patch.
  //
  // runImportScreen reads `input.files` when it attaches now, so an early pick is taken.
  // Setting the file at the first possible moment is what pins that.
  await page.waitForSelector('#rom-input', { timeout: 60_000 });
  await page.setInputFiles('#rom-input', baseRom);

  // The version line is the patcher's own verdict. `unpatched` means it gave up and
  // started the ROM as it came -- vanilla Emerald with a battle royale label over it,
  // which is exactly what the site served before there was a BPS on it at all.
  const version = page.locator('#version');
  await expect(version).not.toHaveText('—', { timeout: 120_000 });
  await expect(version).not.toContainText('unpatched', { timeout: 120_000 });
  await expect(version).toContainText('patch', { timeout: 120_000 });

  // And it got past the patching screen into the game.
  await expect(page.locator('#screen-playing')).toBeVisible({ timeout: 120_000 });

  // A production build registers a service worker and the dev server never does, so this
  // is the only place a worker that throws on install would ever show up.
  expect(failed, 'nothing failed to load').toEqual([]);
  // eslint-disable-next-line no-console
  console.log('version line:', await version.textContent());
});
