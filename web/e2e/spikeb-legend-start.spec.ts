// Cam's 11-11 recording: A at KYOGRE in OLDALE TOWN, the legendary gone off the ground, and no
// battle -- the console said "spike: no battle" twice, the hidden ROM on its overworld. Every
// legendary the match stands, fought from the page's own A: its battle comes up.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const tap = async (page: Page, k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };

// web/src/match/legends.ts's species, as the ROM numbers them.
for (const [mon, name] of [[404, 'KYOGRE'], [405, 'GROUDON'], [406, 'RAYQUAZA'], [407, 'LATIAS'], [401, 'REGIROCK']] as const) {
  test(`${name}: A at it starts its battle`, async ({ page }) => {
    test.setTimeout(240_000);
    const warned: string[] = [];
    page.on('console', (m) => {
      if (/no battle/.test(m.text())) warned.push(m.text());
      if (/legend A again/.test(m.text())) console.log(`${name}: ${m.text()}`);
    });
    await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=6`);
    await page.locator('#intro-go').click({ timeout: 90_000 });
    await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
    await page.waitForTimeout(3000);
    // Somebody to fight with, out of the DAY CARE's chest.
    await page.evaluate(() => { const s = (window as any).__spike, a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
    await page.waitForTimeout(800);
    for (let i = 0; i < 40 && !(await page.evaluate(() => (window as any).__spike.rom.partyCount())); i++) {
      if (await page.locator('.bm-slot').first().isVisible()) { await page.locator('.bm-slot').first().click(); await page.waitForTimeout(1500); }
      else if (!(await page.evaluate(() => (window as any).__spike.swapping))) { await tap(page, 'z'); await page.waitForTimeout(1200); }
      else await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).__spike.rom.partyCount())).toBeGreaterThan(0);
    // Where Cam met it: OLDALE TOWN, beside the MART.
    await page.evaluate((mon) => {
      const s = (window as any).__spike, room = s.link.room, a = room.actor(s.link.me);
      const KEY = (1 << 21) + 3 * 16;
      room.spills.set(KEY, { key: KEY, map: 'MAP_OLDALE_TOWN', x: 13, y: 7, name: '', legend: true, bag: { items: [], money: 0, mons: [{ species: mon, level: 30 }] } });
      a.m = { ...a.m, spot: { map: 'MAP_OLDALE_TOWN', x: 13, y: 8 }, facing: 1 };
      a.calm = 0;
      room.picked.set(KEY, a.id);
      a.battling = true;
      s.startFor({ type: 'legend', tick: room.tick, id: a.id, key: KEY, species: mon, level: 30 });
    }, mon);
    // The battle's own loop running in the hidden ROM, and the page showing it.
    await page.waitForFunction(() => (window as any).__spike.rom.inBattle?.() ?? !!(window as any).__spike.battle?.shown, undefined, { timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(15_000);
    await page.screenshot({ path: test.info().outputPath(`legend-${name}.png`) });
    expect(warned, 'the page never gave up on the battle').toEqual([]);
  });
}
