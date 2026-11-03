// POK-384 on the real ROM: a fight in SOOTOPOLIS while its story is live starts in the seed's weather,
// from the fight's first moment, though the hidden ROM stands in Littleroot. Staged at the legendary:
// the room's side is weather.test.ts's.
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const tap = async (page: Page, k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };

for (const [seed, mon, mask, name] of [[6, 404, 7, 'KYOGRE in the rain'], [7, 405, 0x60, 'GROUDON in the drought'], [6, 404, 0, 'with no story in the city, no weather']] as const) {
  test(`${name}: the fight starts in it (seed ${seed})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=900&seed=${seed}`);
    await page.locator('#intro-go').click({ timeout: 90_000 });
    await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
    await page.waitForTimeout(3000);
    // Somebody to fight with, out of the DAY CARE's chest, as the rung's spec does.
    await page.evaluate(() => { const s = (window as any).__spike, a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
    await page.waitForTimeout(800);
    await tap(page, 'z'); await page.waitForTimeout(3000);
    await tap(page, 'z'); await page.waitForTimeout(1200);
    await tap(page, 'Enter'); await page.waitForTimeout(2000);
    for (let i = 0; i < 10 && (await page.evaluate(() => (window as any).__spike.swapping)); i++) { await tap(page, 'x'); await page.waitForTimeout(1500); }
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as any).__spike.rom.partyCount())).toBeGreaterThan(0);
    // The story down in the city, and me a step from its legendary.
    await page.evaluate(([mon, story]) => {
      const s = (window as any).__spike, room = s.link.room, a = room.actor(s.link.me);
      const KEY = (1 << 21) + 3 * 16;
      room.spills.set(KEY, { key: KEY, map: 'MAP_SOOTOPOLIS_CITY', x: 31, y: 34, name: '', legend: true, bag: { items: [], money: 0, mons: [{ species: mon, level: 15 }] } });
      if (story) room.events.push({ n: 3, key: KEY, map: 'MAP_SOOTOPOLIS_CITY', x: 31, y: 34, species: mon, story: 'sootopolis', place: 'SOOTOPOLIS CITY' });
      a.m = { ...a.m, spot: { map: 'MAP_SOOTOPOLIS_CITY', x: 31, y: 33 }, facing: 1 };
      a.calm = 0;
    }, [mon, mask] as const);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => { const s = (window as any).__spike; return s.link.room.weatherAt(s.link.room.actor(s.link.me).m.spot); })).toBe(!mask ? 0 : seed & 1 ? 12 : 13);
    // As the room's A at it does (Room.move): off the ground for the fight, and the page told.
    await page.evaluate((mon) => {
      const s = (window as any).__spike, room = s.link.room, a = room.actor(s.link.me);
      const KEY = (1 << 21) + 3 * 16;
      room.picked.set(KEY, a.id);
      a.battling = true;
      s.startFor({ type: 'legend', tick: room.tick, id: a.id, key: KEY, species: mon, level: 15 });
    }, mon);
    expect(await page.evaluate(() => !!(window as any).__spike.battle)).toBe(true);
    // gBattleWeather: B_WEATHER_RAIN (bits 0-2) or B_WEATHER_SUN (bits 5-6), once the switch-in has run.
    if (mask) await page.waitForFunction((mask) => ((window as any).__spike.rom.battleWeather() & mask) !== 0, mask, { timeout: 60_000 });
    else {
      await page.waitForTimeout(20_000);
      expect(await page.evaluate(() => (window as any).__spike.rom.battleWeather())).toBe(0);
    }
    console.log(`${name}: gBattleWeather`, await page.evaluate(() => (window as any).__spike.rom.battleWeather()));
    await page.screenshot({ path: test.info().outputPath(`weather-${seed}.png`) });
  });
}
