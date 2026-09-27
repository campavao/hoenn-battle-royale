// A match played the way a player plays one (POK-327). Cam, 2026-09-18: "our test suite
// should try and simulate an actual game as close as we can. A lot of our tests right now
// are just smoke tests." The four bugs his video hit in its first minutes -- the map
// flashing white around a catch, the band left on the drop map, the picture squashed after
// a battle in Firefox, a beaten trainer drawn over the field -- were all on the screen, and
// no spec ever looked at the screen through a battle.
//
// So this one plays solo from the boot, at the keyboard: into the grass, a wild battle and
// a Safari ball thrown, the drop map and a pick, a route trainer talked to and beaten, the
// fog's bleed, the results. A screenshot at every step, the layout checked at every step,
// and a recorder in the page (play.ts) holding the picture to its invariants frame by
// frame through the whole match. It runs in Chromium and in Firefox (the play-firefox
// project), where the video was.
//
// The match is pinned so every run is the same one:
//   - `#seed` deals the opening's cell and everything after it. SEED puts seat 0 on cell
//     21 of br_match.c's sSafariCells, SAFARI ZONE SOUTHEAST (15,14), tall grass on every
//     side. The ring's centre off it (ROUTE 118) leaves Route 102 outside from its fourth
//     phase, so the bleed comes early, and its bots meet in the last rings, so the proxy's
//     second core boots while the recorder is watching (the squish's cause).
//   - `#land` puts the drop three tiles right of YOUNGSTER CALVIN's column on Route 102
//     (data/maps/Route102/map.json: (33,14), facing down, one POOCHYENA). A match's
//     trainers fight only when talked to (trainer_see.c, POK-259), so the walk ends under
//     him and A starts it.
//   - `#safari=60` leaves time to walk into the grass and throw before the buzzer, and
//     `#fog=20` has CALVIN beaten well before the fourth phase. Once in about twenty
//     runs (Firefox, where the walk is slower) the fight with him never ended, with the
//     fog's sweep having taken two of Route 102's trainers during it (gBrLoot.gone 2).
//     br_loot.c Despawn_Trainer removed the object mid-battle, and RemoveObjectEvent
//     destroyed gSprites[its old overworld id] -- a battle sprite by then: the foe's
//     healthbox at Route 102's action menu. The ROM now holds an object asked off the
//     map until the field is back (BrField_RemoveObject; npcout-in-battle.txt), which is
//     POK-328's lead; the drivers that swept a fight never hung, so a fight that never
//     ends here still fails with its state.
//   - `#testmon`: a TREECKO at the boot, so an opening that catches nothing still has a
//     party at the buzzer (an empty one is an elimination).
// Every fight is rigged once it is under way (play.ts's `rig`), so it ends the same way
// every run: the Safari foe at 1 HP; CALVIN at 1 HP, poisoned and harmless, with our own
// mon kept full, and beaten with the first move; any other -- a bot that walks up to us,
// a wild one in Route 102's grass -- called for us, as the drivers call theirs.
// Change the cell table, the ring or the bots and re-derive the seed.
import { test, expect, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';
import {
  assertLog,
  battleState,
  BATTLE_TYPE_SAFARI,
  edgeBlack,
  expectClean,
  expectLayout,
  rig,
  ram,
  shooter,
  startRecorder,
  tap,
  type Ram,
} from './play';

const SEED = 5376;
const SAFARI_SE = '26:13';
const ROUTE_102 = '0:17';
const LAND = { x: 36, y: 16 };
/** The tile under CALVIN, facing him. */
const UNDER_CALVIN = { x: 33, y: 15 };
const BR_PHASE_SAFARI = 1;

test.describe.configure({ retries: 1 });
// A five-minute match read every quarter second makes a trace of about a gigabyte that
// the viewer will not open; the shots, the recorder's trails and the step say more.
test.use({ trace: 'off' });

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

/** Waits for the ROM to say so, reading it every `everyMs`. */
async function until(page: Page, sym: Record<string, number>, what: string, ok: (r: Ram) => boolean, timeoutMs: number, everyMs = 250): Promise<Ram> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await ram(page, sym);
    if (ok(r)) return r;
    if (Date.now() > end) throw new Error(`${what}: not by ${timeoutMs} ms (${JSON.stringify(r)})`);
    await page.waitForTimeout(everyMs);
  }
}

/** A battle, played to its end: A through every box and menu -- FIGHT and the first move,
 *  or BALL in the Safari -- rigged once it is under way (play.ts's `rig`). `shot` sees
 *  the fight every `every` presses, and the battle that never ends. Returns once the
 *  overworld is back. */
async function fight(
  page: Page,
  sym: Record<string, number>,
  shot: (name: string) => Promise<void>,
  opts: { rig: 'weak' | 'won' | 'called'; label: string; every?: number; maxMs?: number },
): Promise<number> {
  const started = Date.now();
  const end = started + (opts.maxMs ?? 90_000);
  for (let i = 0; ; i++) {
    const r = await ram(page, sym);
    if (!r.inBattle && r.onOverworld) return Date.now() - started;
    if (Date.now() > end) {
      await shot(`${opts.label}-stuck`);
      throw new Error(`the battle never ended (${JSON.stringify(r)}; ${await battleState(page, sym)})`);
    }
    if (r.inBattle) await rig(page, sym, opts.rig);
    if (opts.every && i % opts.every === 0) await shot(`${opts.label}-${i}`);
    await tap(page, 'z');
    await page.waitForTimeout(500);
  }
}

test('a solo match, played at the keyboard, looks right the whole way through', async ({ page, browserName }, info) => {
  test.setTimeout(480_000);
  const sym = loadSymbols();
  const shot = shooter(page, browserName);
  const proxyLines: string[] = [];
  const proxyLayouts: Promise<unknown>[] = [];
  // Thrown in the step it happened in, not at the end of the match.
  const proxyClean = async (): Promise<void> => {
    for (const err of await Promise.all(proxyLayouts.splice(0))) if (err) throw err;
  };
  page.on('console', (m) => {
    // The bots' second core booting is what squished the picture (46a362b82): look at
    // the layout the moment it says anything.
    if (m.text().startsWith('[proxy]')) {
      proxyLines.push(m.text());
      proxyLayouts.push(expectLayout(page, {}, `after "${m.text()}"`).then(() => null, (err: unknown) => err));
    }
  });

  await test.step('boot: straight into the Safari opening', async () => {
    await page.goto(`/#solo&safari=60&fog=20&testmon&seed=${SEED}&land=MAP_ROUTE102,${LAND.x},${LAND.y}&rom=${romHashParam()}`);
    await page.waitForFunction(() => (window as unknown as { __hbr?: unknown }).__hbr !== undefined, { timeout: 60_000 });
    await page.waitForSelector('body.in-match', { timeout: 60_000 });
    const r = await until(page, sym, 'in the Zone', (x) => x.phase === BR_PHASE_SAFARI && x.onOverworld && x.map === SAFARI_SE, 30_000);
    // The cell the seed deals (BrMatch_SafariCell): the seed reached the ROM before its boot.
    expect({ x: r.x, y: r.y }).toEqual({ x: 15, y: 14 });
    await startRecorder(page, sym);
    await page.waitForTimeout(1_000);
    await shot('boot');
    await expectLayout(page, { onField: true }, 'boot', sym);
    await expectClean(page, 'boot');
    await proxyClean();
  });

  await test.step('grass: pace until something jumps out', async () => {
    let dir = 'ArrowLeft';
    for (let i = 0; i < 120; i++) {
      const r = await ram(page, sym);
      if (r.inBattle) break;
      await page.keyboard.down(dir);
      await page.waitForTimeout(300);
      await page.keyboard.up(dir);
      dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    }
    const r = await until(page, sym, 'a wild battle', (x) => x.inBattle, 5_000);
    expect(r.battleType & BATTLE_TYPE_SAFARI, 'a Safari battle').toBeTruthy();
    await page.waitForTimeout(1_500);
    await shot('wild');
    await expectClean(page, 'into a wild battle');
    await proxyClean();
  });

  await test.step('throw: a Safari ball, and the picture through the catch', async () => {
    const before = await ram(page, sym);
    // Through the intro to the menu; B advances a box without choosing anything.
    for (let i = 0; i < 5; i++) {
      await tap(page, 'x');
      await page.waitForTimeout(400);
    }
    await expectLayout(page, { onField: false }, 'the wild battle');
    const edges = await edgeBlack(page);
    expect(edges.left, 'no black bar down the left of the battle').toBeLessThan(0.9);
    expect(edges.right, 'no black bar down the right of the battle').toBeLessThan(0.9);
    await shot('menu');
    // A on BALL, then A through whatever it says, shooting the throw.
    await fight(page, sym, shot, { rig: 'weak', label: 'throw', every: 1, maxMs: 45_000 });
    const after = await ram(page, sym);
    expect(after.balls, 'a ball was thrown').toBeLessThan(before.balls);
    await page.waitForTimeout(1_000);
    await shot('back-on-the-field');
    await expectLayout(page, { onField: true }, 'after the catch', sym);
    await expectClean(page, 'the throw');
    await proxyClean();
  });

  await test.step('drop: the map at the buzzer, a pick, and the landing', async () => {
    // The opening runs out at 60 s. Anything that walks up to us meanwhile is fought.
    await until(page, sym, 'the drop map', (x) => x.pick || x.inBattle, 75_000, 500);
    if ((await ram(page, sym)).inBattle) await fight(page, sym, shot, { rig: 'called', label: 'fight' });
    await until(page, sym, 'the drop map', (x) => x.pick, 30_000);
    await page.waitForTimeout(1_000);
    await shot('drop-map');
    await expectLayout(page, { onField: false }, 'the drop map');
    // A takes the section under the cursor, once the map is taking presses.
    for (let i = 0; i < 20 && (await ram(page, sym)).pick; i++) {
      await tap(page, 'z');
      await page.waitForTimeout(1_000);
    }
    const r = await until(page, sym, 'landed', (x) => !x.pick && x.onOverworld && x.map === ROUTE_102, 20_000);
    expect({ x: r.x, y: r.y }).toEqual(LAND);
    await page.waitForTimeout(1_500);
    await shot('landed');
    await expectLayout(page, { onField: true }, 'landed', sym);
    await expectClean(page, 'the drop');
    await proxyClean();
  });

  await test.step('trainer: walk up to CALVIN, talk, and beat him', async () => {
    for (let i = 0; i < 40; i++) {
      const r = await ram(page, sym);
      if (r.inBattle) await fight(page, sym, shot, { rig: 'called', label: 'fight' });
      if (r.x === UNDER_CALVIN.x && r.y === UNDER_CALVIN.y) break;
      const key = r.x > UNDER_CALVIN.x ? 'ArrowLeft' : r.x < UNDER_CALVIN.x ? 'ArrowRight' : r.y > UNDER_CALVIN.y ? 'ArrowUp' : 'ArrowDown';
      await tap(page, key, 120);
      await page.waitForTimeout(250);
    }
    const under = await ram(page, sym);
    expect({ x: under.x, y: under.y }, 'under CALVIN').toEqual(UNDER_CALVIN);
    await tap(page, 'ArrowUp');
    await shot('face-to-face');
    const gone = under.gone;
    for (let i = 0; i < 12 && !(await ram(page, sym)).inBattle; i++) {
      await tap(page, 'z');
      await page.waitForTimeout(400);
    }
    await until(page, sym, 'the trainer battle', (x) => x.inBattle, 10_000);
    // The whole battle, back to the field: a trainer battle that never hands the field
    // back is POK-328's class of bug.
    const took = await fight(page, sym, shot, { rig: 'won', label: 'trainer', every: 4, maxMs: 60_000 });
    expect(took, 'back on the field within a minute').toBeLessThan(60_000);
    // Out through the defeat speech on B: A on the tile in front is a pickup.
    for (let i = 0; i < 6; i++) {
      await tap(page, 'x');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1_000);
    const after = await ram(page, sym);
    expect(after.gone, 'CALVIN is gone from the map').toBeGreaterThan(gone);
    await shot('trainer-beaten');
    await expectLayout(page, { onField: true }, 'after the trainer', sym);
    await expectClean(page, 'the trainer');
    await proxyClean();
  });

  await test.step('bleed: the fog takes its bites, and the box shakes', async () => {
    const end = Date.now() + 150_000;
    for (;;) {
      const r = await ram(page, sym);
      const log = await expectClean(page, 'waiting for the bleed');
      if (r.inBattle) await fight(page, sym, shot, { rig: 'called', label: 'fight' });
      else if (log.seen.shake > 0 && log.damage > 0) break;
      if (Date.now() > end) throw new Error(`no bleed by 150 s: ${JSON.stringify({ r, seen: log.seen, damage: log.damage })}`);
      await page.waitForTimeout(500);
    }
    await shot('bleed');
    await expectLayout(page, {}, 'in the fog');
    await expectClean(page, 'the bleed');
    await proxyClean();
  });

  await test.step('results', async () => {
    const end = Date.now() + 200_000;
    while (!(await page.locator('#results-panel').isVisible())) {
      const r = await ram(page, sym);
      if (r.inBattle) await fight(page, sym, shot, { rig: 'called', label: 'fight' });
      if (Date.now() > end) throw new Error('no results by 200 s');
      await page.waitForTimeout(500);
    }
    await expect(page.locator('#results-line')).toContainText(`seed ${SEED}`);
    await shot('results');
  });

  await proxyClean();
  const log = await assertLog(page);
  console.log(`[play] ${info.project.name}: ${log.samples} samples, seen ${JSON.stringify(log.seen)}, damage ${log.damage}, longest black ${log.longestBlack}, proxy ${proxyLines.length}`);
  expect(log.seen.pick, 'the recorder saw the drop map').toBeGreaterThan(0);
  expect(log.seen.battle, 'and battles').toBeGreaterThan(0);
  expect(log.seen.shake, 'and the bleed shake').toBeGreaterThan(0);
});
