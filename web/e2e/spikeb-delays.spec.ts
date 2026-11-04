// Cam, 11-04: "I click nose pass, select, bit of a delay, flashes, and then nose pass goes out", and
// "selected an item, selected the Pokemon, and we fully waited like five seconds". From a click on the
// windows to the picture moving: a switch, a medicine on one of them, who goes out after a faint, and
// a ball. The ROM's own BAG and party behind the windows run at HURRY_SPEED, and nothing else does:
// "a quick speed up there as the ball catches", "little speed ups during some moves".
//
// What took how long depends on the machine, so the times are printed and the checks are on what
// does not: when the speed changes, what the picture does, and who got what.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { key } from './spike';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

async function withTeam(page: Page, fog = 900): Promise<void> {
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=0&fog=${fog}&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  await page.waitForTimeout(4000);
  const tap = async (k: string) => { await key(page, k, true); await page.waitForTimeout(90); await key(page, k, false); };
  await spike(page, (s) => { const a = s.link.room.actor(s.link.me); a.m = { ...a.m, spot: { map: 'MAP_ROUTE117_POKEMON_DAY_CARE', x: 5, y: 6 }, facing: 2 }; a.calm = 0; });
  await page.waitForTimeout(800);
  const party = () => spike(page, (s) => s.rom.partyCount());
  for (let i = 0; i < 40 && !(await party()); i++) {
    if (await page.locator('.bm-slot').first().isVisible()) {
      await page.locator('.bm-slot').first().click();
      await page.waitForTimeout(1500);
    } else if (!(await spike(page, (s) => s.swapping))) {
      await tap('z');
      await page.waitForTimeout(800);
    } else await page.waitForTimeout(500);
  }
  expect(await party(), 'a mon out of the chest').toBeGreaterThan(0);
  await expect.poll(() => spike(page, (s) => s.swapping), { timeout: 30_000 }).toBe(false);
  await spike(page, (s) => s.rom.fillParty());
}

async function intoBattle(page: Page): Promise<void> {
  await spike(page, (s) => {
    const room = s.link.room, a = room.actor(s.link.me);
    const q = room.patchesOn('MAP_ROUTE117').find((q: any) => !room.isTaken(q.key) && room.stepFor(a)({ map: 'MAP_ROUTE117', x: q.x - 1, y: q.y }, 4));
    const spot = { map: 'MAP_ROUTE117', x: q.x - 1, y: q.y };
    a.m = { ...a.m, spot, prev: spot, facing: 4, moveDir: 4, action: null, px: 0, py: 0 };
  });
  await page.waitForTimeout(1000);
  await key(page, 'ArrowRight', true); await page.waitForTimeout(150); await key(page, 'ArrowRight', false);
  await page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

type Pic = { t: number; luma: number; changed: number; keyed: number; shown: boolean; url?: string };
type Stage = { t: number; rom: number; cb: string };
type Speed = { t: number; x: number; outcome: number };
type Probe = { pics: Pic[]; stages: Stage[]; clicked: number; speeds: Speed[] };

/** Every picture the player saw and every screen the ROM went through, from the next click on. */
function arm(page: Page): Promise<void> {
  return page.evaluate(() => {
    const s = (window as any).__spike, emu = s.rom.emu, sym = s.art.sym as (n: string) => number;
    const canvas = document.getElementById('gba-key') as HTMLCanvasElement;
    const c2d = canvas.getContext('2d', { willReadFrequently: true })!;
    const menu = document.getElementById('battle-menu')!;
    const main = sym('gMain');
    const names: [string, number][] = ['BattleMainCB2', 'CB2_BagMenuRun', 'CB2_SetUpReshowBattleScreenAfterMenu2', 'ReshowBattleScreenAfterMenu'].map((n) => [n, sym(n)] as [string, number]);
    const cbName = (cb: number) => names.find(([, a]) => a !== undefined && !Number.isNaN(a) && ((a ^ cb) & ~1) === 0)?.[0] ?? `0x${(cb >>> 0).toString(16)}`;
    const romFrame = () => emu.read(main + 0x24, 32) as number;
    const p: Probe = { pics: [], stages: [], clicked: 0, speeds: [] };
    (window as any).__probe = p;
    const clock = () => performance.now() - p.clicked;
    const clicked = () => { if (!p.clicked) p.clicked = performance.now(); };
    addEventListener('click', clicked, { capture: true });
    const setSpeed = emu.setSpeed.bind(emu);
    emu.setSpeed = (x: number) => { if (p.clicked) p.speeds.push({ t: clock(), x, outcome: emu.read(sym('gBattleOutcome'), 8) }); setSpeed(x); };
    let was = 0;
    const off = emu.onFrame(() => {
      if (!p.clicked) return;
      const cb = emu.read(main + 4, 32);
      if (cb !== was) { was = cb; p.stages.push({ t: clock(), rom: romFrame(), cb: cbName(cb) }); }
    });
    let last: Uint8ClampedArray | null = null;
    let stopped = false;
    let urls = 0;
    const paint = () => {
      if (stopped) return;
      requestAnimationFrame(paint);
      const d = c2d.getImageData(0, 0, 240, 160).data;
      let luma = 0, changed = 0, keyed = 0;
      for (let i = 0; i < d.length; i += 4) {
        luma += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        if (!d[i + 3]) keyed++;
        if (last && (last[i] !== d[i] || last[i + 1] !== d[i + 1] || last[i + 2] !== d[i + 2] || last[i + 3] !== d[i + 3])) changed++;
      }
      if (p.clicked && (changed || !p.pics.length)) p.pics.push({ t: clock(), luma: Math.round(luma / 38400), changed, keyed, shown: !menu.hidden, ...(urls++ < 8 ? { url: canvas.toDataURL() } : {}) });
      last = d;
    };
    requestAnimationFrame(paint);
    (window as any).__probeOff = () => { stopped = true; off(); emu.setSpeed = setSpeed; removeEventListener('click', clicked, { capture: true }); return p; };
  });
}

/** The times, and the two things that hold on any machine: at speed from the click to the battle's
 *  return and not after, and no picture that is not the battle's on the way back. */
async function report(page: Page, name: string): Promise<void> {
  const p = await page.evaluate(() => (window as any).__probeOff() as Probe);
  const dir = process.env.HBR_DELAYS_OUT;
  // The first picture after the click: the prompt coming off the box, and then the fight going on.
  const pics = p.pics.filter((x) => x.changed > 0);
  const moved = pics.find((x) => x.changed > 0 && x.t > 50) ?? pics[0];
  const back = p.stages.find((x, i) => i > 0 && x.cb === 'BattleMainCB2');
  const start = p.stages[0];
  // One picture darker than those either side: with the bases and the box up, and no mon on them, it
  // is the battle's first frames shown before they were drawn. Cam's "flashes".
  const dips = p.pics.filter((x, i) => i > 0 && i + 1 < p.pics.length && (x.keyed < 240 * 160 / 8 || x.luma < Math.min(p.pics[i - 1].luma, p.pics[i + 1].luma) - 10));
  const line = {
    name,
    promptOffMs: Math.round(pics[0]?.t ?? -1),
    pictureMovesMs: Math.round(moved?.t ?? -1),
    romBackMs: Math.round(back?.t ?? -1),
    romFrames: back && start ? back.rom - start.rom : -1,
    stages: p.stages.map((x) => `${Math.round(x.t)}ms f${x.rom - (start?.rom ?? 0)} ${x.cb}`),
    speeds: p.speeds.map((x) => `${Math.round(x.t)}ms x${x.x}${x.outcome ? ' over' : ''}`),
    dips: dips.map((x) => `${Math.round(x.t)}ms luma ${x.luma} keyed ${x.keyed}`),
  };
  console.log(JSON.stringify(line));
  if (dir) {
    mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    writeFileSync(`${dir}/${name}-${stamp}.json`, JSON.stringify({ ...line, pics: p.pics.map((x) => ({ ...x, url: undefined })) }));
    p.pics.forEach((x, i) => { if (x.url) writeFileSync(`${dir}/${name}-${stamp}-${i}-${Math.round(x.t)}ms.png`, Buffer.from(x.url.split(',')[1], 'base64')); });
  }
  expect.soft(line.dips, `${name}: every picture is the battle's`).toEqual([]);
  const fast = p.speeds.filter((x) => !x.outcome);
  expect.soft(fast.map((x) => x.x), `${name}: fast from the click, then one steady speed`).toEqual([8, 1]);
  expect.soft(fast[0]?.t ?? 999, `${name}: fast from the click`).toBeLessThan(100);
}

const leadIndex = (page: Page) => spike(page, (s) => s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16));
const desk = { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } };
const hpOf = (page: Page, slot: number) => page.evaluate((slot) => { const s = (window as any).__spike; return s.rom.emu.read(s.art.sym('gPlayerParty') + slot * 100 + 86, 16) as number; }, slot);
const windowsBack = (page: Page) => page.waitForFunction(() => (window as any).__spike.battleMenu?.isShown, undefined, { timeout: 40_000 });
/** Who is at `slot` on the page's list, as `readParty` has them. */
const speciesOnList = (page: Page, slot: number) => page.evaluate((slot) => (window as any).__spike.battleMenu.deps.firstMoves.readParty()[slot].species as number, slot);

test('a switch goes through at once, three times over, and each is the one clicked', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  await withTeam(page);
  await intoBattle(page);
  for (const slot of [1, 2, 3]) {
    await page.keyboard.press('q');
    await expect(page.locator('.bm-slot').nth(slot)).toBeVisible();
    const species = await speciesOnList(page, slot);
    await page.locator('.bm-slot').nth(slot).click();
    await expect(page.locator('.bm-member')).toBeVisible();
    await arm(page);
    await page.locator('.bm-m-btn').nth(2).click();
    await expect(page.locator('#battle-menu'), 'the windows go with the click').toBeHidden({ timeout: 300 });
    await windowsBack(page);
    await report(page, `switch${slot}`);
    // The one out is the one clicked, whatever order the ROM has them in now.
    const out = await page.evaluate(() => { const s = (window as any).__spike; return s.rom.emu.read(s.art.sym('gBattleMons'), 16) as number; });
    expect(out, `switch ${slot}: the one clicked is out`).toBe(species);
  }
  await ctx.close();
});

for (const [name, item, hp, maxHp] of [['potion', 13, 1, 0], ['maxpotion', 20, 63, 343]] as const) {
  test(`${name} on a mon goes through at once`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext(desk);
    const page = await ctx.newPage();
    await withTeam(page);
    await spike(page, new Function('s', `return s.startFor({ type: 'bag', tick: 0, id: s.link.me, key: 0x7e0002, name: 'DRAKE', bag: { items: [{ id: ${item}, n: 2 }], money: 0, mons: [{ species: 373, level: 30 }] } })`) as (s: any) => void);
    await page.locator('#bag-panel button').nth(1).click();
    await page.locator('#bag-panel button').first().click();
    await expect(page.locator('#bag-panel')).toBeHidden();
    await intoBattle(page);
    // Cam's at 16:05: 63/343, on a MAX POTION. Written in the battle, as a `carried` write would undo it.
    await page.evaluate(([hp, maxHp]) => {
      const s = (window as any).__spike, at = s.art.sym('gPlayerParty') + 3 * 100;
      if (maxHp) s.rom.emu.write(at + 88, maxHp, 16);
      s.rom.emu.write(at + 86, hp, 16);
    }, [hp, maxHp]);
    await page.keyboard.press('e');
    await expect(page.locator('.bm-bag-head')).toBeVisible();
    const row = await page.evaluate((item) => (window as any).__spike.battleMenu.stacks().findIndex((x: any) => x.item === item), item);
    expect(row).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('z');
    await page.locator('.bm-bag-use').click();
    await expect(page.locator('.bm-slot').nth(3)).not.toHaveAttribute('aria-disabled', 'true');
    await arm(page);
    await page.locator('.bm-slot').nth(3).click();
    await expect(page.locator('#battle-menu'), 'the windows go with the click').toBeHidden({ timeout: 300 });
    await expect.poll(() => hpOf(page, 3), { timeout: 30_000, message: 'the one clicked got it' }).toBeGreaterThan(hp);
    await windowsBack(page);
    await report(page, name);
    await ctx.close();
  });
}

test('one fainted: the one clicked goes out at once', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  await withTeam(page);
  await intoBattle(page);
  await spike(page, (s) => {
    const emu = s.rom.emu, at = s.art.sym('gPlayerParty'), mons = s.art.sym('gBattleMons');
    emu.write(at + 86, 1, 16); emu.write(mons + 0x28, 1, 16); emu.write(at + 100 + 86, 0, 16);
    for (const m of [0x64, 0x66, 0x68, 0x6a]) emu.write(mons + m, 33, 16);
  });
  const asked = () => page.locator('.bm-use-head').isVisible();
  for (let i = 0; i < 60 && !(await asked()); i++) { await page.keyboard.press('z', { delay: 120 }); await page.waitForTimeout(600); }
  await expect(page.locator('.bm-use-head')).toBeVisible();
  await page.waitForTimeout(600);
  await page.locator('.bm-slot').nth(2).click();
  await expect(page.locator('.bm-member')).toBeVisible();
  await arm(page);
  await page.locator('.bm-m-btn').nth(2).click();
  await expect.poll(() => leadIndex(page), { timeout: 30_000 }).toBe(2);
  await windowsBack(page);
  await report(page, 'forced');
  await ctx.close();
});

test('a ball: fast to the throw, then one speed through the catch', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  await withTeam(page);
  await spike(page, (s) => s.rom.give(1, 5));
  await intoBattle(page);
  await page.keyboard.press('e');
  await expect(page.locator('.bm-bag-head')).toBeVisible();
  await spike(page, (s) => { s.battleMenu.showFocus = true; });
  await page.keyboard.press('ArrowRight');
  const row = await spike(page, (s) => s.battleMenu.stacks().findIndex((x: any) => x.item === 1));
  expect(row, 'the MASTER BALL in its pocket').toBeGreaterThanOrEqual(0);
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('z');
  await arm(page);
  await page.locator('.bm-bag-use').click();
  await expect(page.locator('.bm-catch')).toBeVisible({ timeout: 60_000 });
  await report(page, 'ball');
  await ctx.close();
});
