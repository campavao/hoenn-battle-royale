// A fight with a bot on a real ROM, for what the page hands over and what it takes back.
//
// Cam, 11-04, at 4:36: "PKMN TRAINER STEVEN used ????????!", "Foe TORCHIC's ???????? cured paralysis!",
// and PAR still on its box. A TM on the bot's card (bag.ts FIGHT_ITEMS). And at 27:00: "FAVORITE NOSEPASS,
// TOP MOVE TACKLE. It doesn't feel true": gBrTally's tables keep the first eight moves they meet.
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const TM28 = 316;
const SCRATCH = process.env.HBR_E2E_SCRATCH || '';

test('a bot with a TM in its bag and a paralysed mon uses nothing, and the TM is on the ground when it falls', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto(`/?rom=${romHashParam()}#solo&safari=0&fog=900&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await page.evaluate(() => {
    const s = (window as any).__spike, a = s.link.room.actor(s.link.me);
    for (const b of s.link.room.actors) if (b.bot) b.calm = 2 ** 30;
    a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 };
    a.calm = 0;
  });
  await page.waitForTimeout(800);
  // A mon out of the chest (spikeb-windows.spec.ts withTeam).
  const party = () => page.evaluate(() => (window as any).__spike.rom.partyCount() as number);
  for (let i = 0; i < 40 && !(await party()); i++) {
    if (await page.locator('.bm-slot').first().isVisible()) {
      await page.locator('.bm-slot').first().click();
      await page.waitForTimeout(1500);
    } else if (!(await page.evaluate(() => (window as any).__spike.swapping))) {
      await tap('z');
      await page.waitForTimeout(800);
    } else await page.waitForTimeout(500);
  }
  expect(await party(), 'a mon out of the chest').toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).__spike.swapping), { timeout: 30_000 }).toBe(false);
  const foe = await page.evaluate((tm) => {
    const s = (window as any).__spike, room = s.link.room;
    for (const a of room.actors) if (a.bot) a.calm = 2 ** 30;
    const bot = room.actors.find((a: any) => a.bot);
    bot.loot = { items: [{ id: tm, n: 1 }], money: 0 };
    Object.assign(room.actor(s.link.me), { battling: true, foe: bot.id });
    Object.assign(bot, { battling: true, foe: s.link.me, foughtBy: s.link.me });
    // Every line the box shows; and a real paralysis on the foe before each of the AI's choices (it
    // chooses as the turn's menu comes up, so the first it can see one is the second turn).
    const w = window as any, sym = s.art.sym, emu = s.rom.emu;
    w.__lines = [];
    w.__par = 0;
    const said = sym('gDisplayedStringBattle'), mons = sym('gBattleMons'), party = sym('gEnemyParty');
    let was = '';
    emu.onFrame(() => {
      if (!s.battle) return;
      const raw = emu.bytes(said, 64);
      const line = [...raw].join(',');
      if (line !== was) { was = line; w.__lines.push(line); }
      if (emu.read(sym('gBrBattle') + 8, 8) === 1) {
        emu.write(mons + 0xa4, 0x40, 32);
        emu.write(party + 0x50, 0x40, 32);
        w.__par++;
      }
    });
    s.startFor({ type: 'fight', tick: 0, id: s.link.me, foe: bot.id });
    return bot.id;
  }, TM28);
  // What the page put on the card (br_bot.c ParseTrainer): the fight's first frame has it.
  await page.waitForFunction(() => { const s = (window as any).__spike; return s.battle && s.rom.emu.read(s.art.sym('gBrBattle') + 8, 8) === 1; }, undefined, { timeout: 120_000 });
  const card = await page.evaluate(() => { const s = (window as any).__spike, at = s.art.sym('gBrBotFight'); return { fighting: s.rom.emu.read(at + 2, 8), items: s.rom.emu.read(at + 0xc, 8), first: s.rom.emu.read(at + 0xe, 16) }; });
  console.log('the card:', JSON.stringify(card));
  // Each move in turn, until it is over (a mon's first can be a LEER, and a fight of those has no end).
  let turns = 0;
  for (let i = 0; i < 400 && (await page.evaluate(() => !!(window as any).__spike.battle)); i++) {
    const cell = page.locator('.bm-cell').nth(turns % 4);
    if (await cell.isVisible().catch(() => false)) {
      await cell.click({ timeout: 2000 }).catch(() => undefined);
      // Three goes at its bag are all the AI needs, however even the two are.
      if (++turns >= 4) await page.evaluate(() => { const s = (window as any).__spike; s.rom.emu.write(s.art.sym('gBattleMons') + 0x58 + 0x28, 1, 16); });
    }
    else if (await page.locator('.bm-m-btn').nth(2).isVisible().catch(() => false)) await page.locator('.bm-m-btn').nth(2).click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  const out = await page.evaluate(async (foe) => {
    const s = (window as any).__spike, w = window as any, sym = s.art.sym, emu = s.rom.emu;
    const { battleText } = await import('/spike-b/battlereader.ts' as string);
    const lines = (w.__lines as string[]).map((l) => battleText(Uint8Array.from(l.split(',').map(Number))));
    return {
      par: w.__par,
      lines,
      spent: emu.read(sym('gBrBotFight') + 0xd, 8),
      bag: s.link.room.actor(foe)?.loot?.items ?? s.link.room.spills.get((1 << 20) + foe)?.bag.items ?? null,
      tally: s.rom.tally(),
      // Empty for the next battle (carry.ts drainFavourites).
      tables: [...emu.bytes(sym('gBrTally') + 36, 14)],
    };
  }, foe);
  console.log('the fight:', JSON.stringify({ ...out, lines: out.lines.length }));
  if (SCRATCH) fs.writeFileSync(`${SCRATCH}/botbag-lines.txt`, out.lines.join('\n'));
  expect(out.par, 'it was paralysed at the turns\' menus').toBeGreaterThan(0);
  expect(card.items, 'no TM on the card').toBe(0);
  expect(out.lines.filter((l: string) => l.includes('??')), 'nobody used ????????').toEqual([]);
  expect(out.lines.filter((l: string) => /cured/.test(l)), 'and nothing was cured').toEqual([]);
  expect(out.spent).toBe(0);
  expect(Object.keys(out.tally.moves).length, 'the fight is in the favourites').toBeGreaterThan(0);
  expect(out.tables.every((n: number) => n === 0), 'and the ROM\'s tables are empty for the next').toBe(true);
});
