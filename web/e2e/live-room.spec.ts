// Two browsers, one room, on the deployed site and the deployed relay.
//
// live.spec.ts proves one player can bring a stock ROM and get battle royale out of it.
// This proves the other half -- that two of them can find each other -- and it is the
// half nothing else covers in production: match.spec.ts runs two clients beautifully, but
// through `#rom=`, `__br`, `testmon` and `#fast`, every one of which exists only under
// import.meta.env.DEV. A room on the real relay, between two production bundles, had
// never been run.
//
// It stops at START rather than playing a match out: the dev pace flag is DEV-only too,
// so a real match here is sixteen minutes. What is being checked is the joint -- host,
// code, join, both rosters, and the ROM leaving the room screen when the match is dealt.
//
//   HBR_LIVE_URL=https://hoenn-battle-royale.vercel.app \
//   HBR_BASE_ROM="/path/to/Pokemon - Emerald Version (U).gba" \
//   npx playwright test e2e/live-room.spec.ts
import fs from 'node:fs';
import { test, expect, type Page, type Browser } from '@playwright/test';

const site = process.env.HBR_LIVE_URL ?? '';
const baseRom = process.env.HBR_BASE_ROM ?? '';

test.beforeAll(() => {
  test.skip(
    !site || !baseRom || !fs.existsSync(baseRom),
    'set HBR_LIVE_URL to a deployed site and HBR_BASE_ROM to a retail Emerald (U) ROM',
  );
});

/** A production bundle with a patched ROM in it, sitting wherever `hash` puts it. */
async function open(browser: Browser, hash: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // Named E2E on the relay, not CAM: this room lands in the relay's log next to real
  // ones, and tools/br/play-log.mjs leaves out anything an E2E opened or sat in, so the
  // play page does not count the suite as players. A fresh context would otherwise
  // connect under the shell's default name, which is also what a new player gets.
  await page.addInitScript(() => {
    try { localStorage.setItem('hbr:career', JSON.stringify({ matches: 0, wins: 0, name: 'E2E' })); } catch {}
  });
  await page.goto(`${site}/${hash}`, { waitUntil: 'domcontentloaded' });
  // The picker is live before the shell can take a file (see live.spec.ts); the shell
  // reads `input.files` when it attaches, so setting it early is safe and is the point.
  await page.waitForSelector('#rom-input', { timeout: 60_000 });
  await page.setInputFiles('#rom-input', baseRom);
  await expect(page.locator('#version')).toContainText('patch', { timeout: 120_000 });
  return page;
}

test('two browsers meet in a room on the live relay', async ({ browser }) => {
  test.setTimeout(300_000);

  const host = await open(browser, '#host');
  const code = await (async () => {
    const el = host.locator('#room-code');
    await expect(el).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 120_000 });
    return (await el.textContent())!.replace('Room ', '').trim();
  })();

  const before = await host.locator('#room-roster li').count();

  const guest = await open(browser, `#join=${code}`);
  // The relay gave the guest the host's room. A failed join never gets a code at all --
  // it lands on the lobby with an error.
  await expect(guest.locator('#room-code')).toHaveText(`Room ${code}`, { timeout: 120_000 });

  // And both agree on who is in it. Not a count of two: a host's room FILLS with bots in
  // production (`botFill`, and only a DEV `#nobots` turns that off), so the roster is the
  // people plus the bots dealt to make up the numbers. What matters is that the two
  // clients see the SAME room -- the roster is the relay's own word on membership, so
  // agreeing on it is the whole handshake.
  const rosterSize = async (page: Page): Promise<number> => page.locator('#room-roster li').count();
  await expect(async () => {
    const [h, g] = [await rosterSize(host), await rosterSize(guest)];
    expect(h, 'the host sees more than itself').toBeGreaterThan(1);
    expect(g, 'host and guest agree on the roster').toBe(h);
  }).toPass({ timeout: 90_000 });
  // eslint-disable-next-line no-console
  console.log(`roster: host had ${before} alone, now ${await rosterSize(host)}; guest sees ${await rosterSize(guest)}`);

  // And the match deals ITSELF. Nothing is pressed here: `autoStarts()` is
  // `!import.meta.env.DEV || !hash.has('noauto')`, so in production a room with two in it
  // starts on its own and START is only ever a dev convenience. The button going away is
  // the host's director coming up.
  await expect(host.locator('#room-start'), 'the match dealt itself once there were two')
    .toBeHidden({ timeout: 120_000 });

  // Both ROMs are really running it. There is no `__hbr` in a production build, so the
  // check is the screen: two shots of the canvas a few seconds apart have to differ.
  // A ROM that never booted, or one sitting on a black screen waiting for a `land` that
  // never came, is perfectly still -- which is the failure this is here to catch.
  for (const [who, page] of [['host', host], ['guest', guest]] as const) {
    const canvas = page.locator('#canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      const a = await canvas.screenshot();
      await page.waitForTimeout(3_000);
      const b = await canvas.screenshot();
      expect(Buffer.compare(a, b), `${who}'s game is moving`).not.toBe(0);
    }).toPass({ timeout: 120_000 });
    // Written to e2e/out/ as well as attached: a picture of two live clients in one
    // match is the thing somebody actually wants to look at after a release.
    await canvas.screenshot({ path: `e2e/out/live-${who}.png` });
    await test.info().attach(`${who}-in-the-match.png`, {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  }
});
