// A whole match, start to winner (POK-222/223/224/228).
//
// Every other spec checks a piece. This one checks that the pieces are joined up, which
// is the failure the drivers are structurally unable to see: each of them boots into
// the phase it wants and pokes the state it needs, so all 35 of them passed while a
// real room sat in Littleroot forever because START never began the opening.
//
// One host, one guest, bots filling the rest, at `#quick` pace: a 25-second opening and
// ring phases of fifteen seconds, off a `#seed` fixed so the match is the same one every
// time -- the drop, the ring, every bot's team and every duel come off that seed, and a
// five-minute test that is a different match each run is a coin flip, not a check. The assertions follow a match in order -- the opening
// starts, the drop lands, the ring closes, somebody wins -- so a failure says which
// joint came apart rather than just "no winner".
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

const __dirname = import.meta.dirname;
const OUT_DIR = path.resolve(__dirname, 'out');

const BR_PHASE_SAFARI = 1;
const BR_PHASE_PLAY = 2;
type RamWindow = { __br: { mailbox: { ram: { read(addr: number, width: 8 | 16 | 32): number } } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrWindow = { __br: any };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a match runs from the opening to a winner', async ({ browser }) => {
  test.setTimeout(360_000);
  const rom = romHashParam();
  const symbols = loadSymbols();
  const phase = symbols.gBrMatch;
  const ringBase = symbols.gBrRing;

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  try {
    const host = await hostCtx.newPage();
    await host.goto(`/#host&quick&seed=20260916&testmon&rom=${rom}`);
    await host.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });
    const codeEl = host.locator('#room-code');
    await expect(codeEl).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 30_000 });
    const code = ((await codeEl.textContent()) ?? '').match(/Room ([A-Z0-9]{6})/)?.[1];
    if (!code) throw new Error('could not parse a room code');

    const guest = await guestCtx.newPage();
    await guest.goto(`/#join=${code}&quick&seed=20260916&testmon&rom=${rom}`);
    await guest.waitForFunction(() => (window as unknown as { __br?: unknown }).__br !== undefined, { timeout: 30_000 });

    // 1. The opening. A second seat starts the match, and both ROMs walk into the Zone.
    for (const page of [host, guest]) {
      await page.waitForFunction(
        ([addr, want]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === want,
        [phase, BR_PHASE_SAFARI],
        { timeout: 60_000 },
      );
    }
    await host.screenshot({ path: path.join(OUT_DIR, 'match-safari.png') });

    // 2. The drop. The opening's clock runs out and everybody is warped to a cell of
    //    their own -- which is also the first moment the bots are anywhere real.
    for (const page of [host, guest]) {
      await page.waitForFunction(
        ([addr, want]) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === want,
        [phase, BR_PHASE_PLAY],
        { timeout: 90_000 },
      );
    }
    // 2b. The picker. The opening ends by putting the Hoenn map in front of you
    //     (POK-223) -- every section selectable, twenty seconds to choose. Press A, so
    //     the path a player actually takes is the one under test rather than the
    //     timeout that carries an idle tab.
    const pickBase = symbols.gBrPick;
    for (const page of [host, guest]) {
      await page.waitForFunction(
        (addr) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === 1,
        pickBase,
        { timeout: 30_000 },
      );
    }
    await host.screenshot({ path: path.join(OUT_DIR, 'match-pick.png') });
    // Tap until it takes: the map fades in over about a second, and a press that lands
    // during the fade is a press the input loop never sees.
    const tapA = async (page: typeof host) =>
      page.evaluate(() => {
        const ram = (window as unknown as { __br: { mailbox: { ram: { press(k: string): void; release(k: string): void } } } }).__br.mailbox.ram;
        ram.press('a');
        setTimeout(() => ram.release('a'), 100);
      });
    const picked = async (page: typeof host) =>
      page.evaluate((addr) => (window as unknown as RamWindow).__br.mailbox.ram.read(addr, 8) === 0, pickBase);
    for (let i = 0; i < 30; i++) {
      const done = await Promise.all([host, guest].map(picked));
      if (done.every(Boolean)) break;
      for (const page of [host, guest]) if (!(await picked(page))) await tapA(page);
      await host.waitForTimeout(500);
    }
    for (const page of [host, guest]) {
      expect(await picked(page), 'the drop was taken from the map').toBe(true);
    }
    await host.screenshot({ path: path.join(OUT_DIR, 'match-drop.png') });

    // 3. The ring. gBrRing.active is the ROM having been told where the fog is.
    await host.waitForFunction(
      (base) => (window as unknown as RamWindow).__br.mailbox.ram.read(base, 8) === 1,
      ringBase,
      { timeout: 90_000 },
    );

    // 4. A winner. Nothing but the fog needs to do the eliminating -- bots bleed in it
    //    the way the ROM bleeds a player -- so this is the check that a match can end
    //    on its own, which is the one thing a battle royale has to be able to do.
    const winner = await host.waitForFunction(
      () => {
        const d = (window as unknown as BrWindow).__br.director;
        const s = d?.state;
        return s && s.phase === 'ended' ? { winner: s.winner ?? null } : null;
      },
      undefined,
      { timeout: 240_000, polling: 1000 },
    );
    const result = (await winner.jsonValue()) as { winner: number | null };
    await host.screenshot({ path: path.join(OUT_DIR, 'match-end.png') });
    expect(result, 'the match ended').toBeTruthy();
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
