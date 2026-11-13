// Cam's 11-08 play-test, against another player: PARTY and a mon went back to "What will ALAKAZAM do?"
// whichever mon was picked; ALAKAZAM was hurt and perhaps badly poisoned. Two real pages and two real
// ROMs in a link battle over the relay's own code, the guest's one mon knowing only TOXIC.
import http from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { giveTeam, type Craft } from './craft';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 4;
const WORLD = `ws://localhost:${PORT}/world`;
const NO_FIGHT = 2 ** 30;
const STATUS1_TOXIC_POISON = 1 << 7;

const NAMES = ['ALAKAZAM', 'AZUMARILL', 'SQUIRT', 'PIKA', 'KARP', 'EEVEE'];
const MINE: Craft[] = NAMES.map((name, i) => ({ species: [65, 184, 7, 25, 129, 133][i], name, level: 30, moves: [45], hp: 200, stats: [90, 60, 60, 60, 60], personality: 1000 + i * 25 }));
const THEIRS: Craft[] = [{ species: 19, name: 'RATTATA', level: 30, moves: [92], hp: 300, stats: [90, 60, 60, 60, 60], personality: 4242 }];

async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 6 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

async function relay() {
  process.env.WORLD_BOTS = '2';
  process.env.WORLD_RING_SECS = '900';
  const { createWorld } = (await import('../../relay/world.js' as string)) as any;
  const world = createWorld({ log: () => undefined });
  const calm = setInterval(() => {
    for (const room of (world.service as any)?.rooms.values() ?? []) for (const a of room.host?.room.actors ?? []) if (a.bot && a.calm < NO_FIGHT) a.calm = NO_FIGHT;
  }, 100);
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  await new Promise<void>((ok) => server.listen(PORT, ok));
  return {
    room: () => [...(world.service as any).rooms.values()][0].host.room as any,
    close: async () => { clearInterval(calm); world.close(); await new Promise((ok) => server.close(ok)); },
  };
}

const menuShown = (page: Page) => page.locator('.bm-cell').first().isVisible();
async function menuUp(page: Page, t = 90_000): Promise<void> {
  await expect(page.locator('.bm-cell').first()).toBeVisible({ timeout: t });
  await page.waitForTimeout(200);
}
/** My one out, by its position (a link battle numbers the battlers by who is the master). */
const mine = (page: Page) => spike(page, (s) => {
  const e = s.rom.emu, pos = s.art.sym('gBattlerPositions'), idx = s.art.sym('gBattlerPartyIndexes'), mons = s.art.sym('gBattleMons');
  let b = 0;
  for (let i = 0; i < 4; i++) if (e.read(pos + i, 8) === 0) { b = i; break; }
  const at = mons + b * 0x58;
  return { slot: e.read(idx + 2 * b, 16) as number, hp: e.read(at + 0x28, 16) as number, maxHp: e.read(at + 0x2c, 16) as number, status: e.read(at + 0x4c, 32) as number };
});

/** The guest's TOXIC, whenever its menu is up, until `done`. */
function guestPlays(guest: Page): { stop: () => Promise<void> } {
  let on = true;
  const run = (async () => {
    while (on) {
      if (await menuShown(guest).catch(() => false)) await guest.locator('.bm-cell').first().click({ timeout: 2000 }).catch(() => undefined);
      await guest.waitForTimeout(300);
    }
  })();
  return { stop: async () => { on = false; await run; } };
}

/** The foe's HP back to full on the master (the host's ROM runs the engine): the fog's tenth a
 *  turn would end the fight before the switches are through. */
const topUp = (host: Page) => spike(host, (s) => {
  const e = s.rom.emu, pos = s.art.sym('gBattlerPositions'), mons = s.art.sym('gBattleMons');
  for (let i = 0; i < 4; i++) if (e.read(pos + i, 8) === 1) { const at = mons + i * 0x58; e.write(at + 0x28, e.read(at + 0x2c, 16), 16); }
});

async function growl(host: Page): Promise<void> {
  await menuUp(host);
  await topUp(host);
  await host.locator('.bm-cell').first().click();
  await expect(host.locator('.bm-cell').first()).toBeHidden({ timeout: 20_000 });
  await menuUp(host);
}

async function switchTo(host: Page, name: string): Promise<void> {
  await menuUp(host);
  await topUp(host);
  await host.keyboard.press('q');
  await expect(host.locator('.bm-slot').first()).toBeVisible();
  const at = await host.evaluate((name) => (window as any).__spike.battleMenu.team.findIndex((m: any) => m.name === name), name);
  expect(at, `${name} has a row`).toBeGreaterThanOrEqual(0);
  await host.locator('.bm-slot').nth(at).click();
  await host.locator('.bm-m-btn').nth(2).click();
  await expect.poll(async () => NAMES[(await mine(host)).slot], { timeout: 60_000, message: `${name} went out` }).toBe(name);
  await menuUp(host);
  console.log(`${name} out: ${JSON.stringify(await mine(host))}`);
}

test('in a link battle, a hurt and badly poisoned lead switches out for each of the others, and back in', async ({ browser }) => {
  test.setTimeout(900_000);
  const r = await relay();
  const [hc, gc] = [await browser.newContext({ viewport: { width: 1280, height: 900 } }), await browser.newContext({ viewport: { width: 1280, height: 900 } })];
  const errors: string[] = [];
  try {
    const [host, guest] = [await hc.newPage(), await gc.newPage()];
    for (const [n, p] of [['host', host], ['guest', guest]] as const) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
    const url = `/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}`;
    await host.goto(`${url}#host`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 90_000 });
    await setOption(host, 'room-safari', 'NO SAFARI');
    await guest.goto(`${url}${new URL(host.url()).hash}`);
    await expect(host.locator('#room-roster li', { hasText: 'CAM' })).toHaveCount(2, { timeout: 90_000 });
    await host.locator('#room-start').click();
    for (const p of [host, guest]) await p.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 180_000 });
    await host.waitForTimeout(3000);
    await giveTeam(host, MINE);
    await giveTeam(guest, THEIRS);
    const [hostId, guestId] = [await spike(host, (s) => s.link.me as number), await spike(guest, (s) => s.link.me as number)];
    const room = r.room();
    Object.assign(room.actor(hostId), { battling: true, foe: guestId });
    Object.assign(room.actor(guestId), { battling: true, foe: hostId });
    await Promise.all([
      host.evaluate(([me, foe]) => (window as any).__spike.startFor({ type: 'duel', tick: 0, id: me, foe, first: true }), [hostId, guestId]),
      guest.evaluate(([me, foe]) => (window as any).__spike.startFor({ type: 'duel', tick: 0, id: me, foe, first: false }), [guestId, hostId]),
    ]);
    await menuUp(host, 120_000);
    const g = guestPlays(guest);
    try {
      expect(NAMES[(await mine(host)).slot]).toBe('ALAKAZAM');
      // GROWL until TOXIC lands, counting from the turn it does: TOXIC is 85% accurate, so a
      // "missed!" is a turn with no poison, and the count starts a turn later.
      let before = await mine(host);
      for (let turn = 1; !(before.status & STATUS1_TOXIC_POISON); turn++) {
        expect(turn, 'TOXIC lands within 8 turns').toBeLessThanOrEqual(8);
        await growl(host);
        const now = await mine(host);
        const landed = !!(now.status & STATUS1_TOXIC_POISON);
        console.log(`turn ${turn}: ${JSON.stringify(now)}${landed ? ', TOXIC landed' : ''}`);
        expect(before.hp - now.hp, landed ? 'the turn TOXIC lands, 1/16' : 'TOXIC missed, no hurt').toBe(landed ? 12 : 0);
        before = now;
      }
      // Gen 3's TOXIC: n/16 of max HP on the nth turn (12, 24, 36 of 200), the count back to 1 on a
      // switch (battle_util.c ENDTURN_POISON, STATUS1_TOXIC_COUNTER).
      for (const [n, tick] of [[2, 24], [3, 36]]) {
        await growl(host);
        const now = await mine(host);
        expect(now.status & STATUS1_TOXIC_POISON, 'badly poisoned').toBeTruthy();
        expect(before.hp - now.hp, `the turn after, ${n}/16`).toBe(tick);
        before = now;
      }
      const hurt = before;
      console.log(`ALAKAZAM three turns into TOXIC: ${JSON.stringify(hurt)}`);
      let was = hurt.hp;
      for (const name of NAMES.slice(1, 3)) {
        await switchTo(host, name);
        await growl(host);
        await switchTo(host, 'ALAKAZAM');
        await growl(host);
        const now = await mine(host);
        expect(now.status & STATUS1_TOXIC_POISON, 'still badly poisoned').toBeTruthy();
        expect(was - now.hp, 'back in, the count starts over: 1/16 on the turn it came in, 2/16 the next').toBe(12 + 24);
        was = now.hp;
      }
    } catch (e) {
      for (const [n, p] of [['host', host], ['guest', guest]] as const) console.log(`${n}: ${await spike(p, (s) => JSON.stringify({ last: s.lastResult, battle: !!s.battle, out: s.isOut }))}`);
      throw e;
    } finally { await g.stop(); }
    expect(errors).toEqual([]);
  } finally {
    await hc.close();
    await gc.close();
    await r.close();
  }
});
