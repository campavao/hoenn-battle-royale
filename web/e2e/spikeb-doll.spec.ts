// Cam's 11-16 match: another player RAN with a POKe DOLL, almost a whole team standing, and was
// out of the match. The master ROM ended the getaway as a wild one's (outcome MON_FLED, "Wild
// RATTATA fled!"), which never told the other ROM: both fights waited for good, until the shot
// clock forfeited somebody. BR's rule (src/br/br_battle.c, POK-293) is that a doll is a sure getaway from
// a fight with somebody, and nobody is eliminated. Two real pages and two real ROMs in a link
// battle over the relay's own code; the guest holds one POKe DOLL and runs on the first turn.
import http from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { giveTeam, type Craft } from './craft';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 5;
const WORLD = `ws://localhost:${PORT}/world`;
const NO_FIGHT = 2 ** 30;
const ITEM_POKE_DOLL = 80;

const MINE: Craft[] = [{ species: 65, name: 'ALAKAZAM', level: 30, moves: [45], hp: 200, stats: [90, 60, 60, 60, 60], personality: 1000 }];
const THEIRS: Craft[] = ['RATTATA', 'ZIGZAG', 'PIDGEY', 'WURMPLE', 'POOCH'].map((name, i) => ({ species: [19, 263, 16, 265, 261][i], name, level: 30, moves: [45], hp: 300, stats: [90, 60, 60, 60, 60], personality: 4242 + i * 31 }));

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

async function menuUp(page: Page, t = 90_000): Promise<void> {
  await expect(page.locator('.bm-cell').first()).toBeVisible({ timeout: t });
  await page.waitForTimeout(200);
}
const state = (p: Page) => spike(p, (s) => ({ last: s.lastResult, battle: !!s.battle, out: s.isOut, dolls: s.pocket(0).filter((r: any) => r.item === 80).reduce((n: number, r: any) => n + r.n, 0) }));

test('in a link battle, RUN with a POKe DOLL gets away, and nobody is out', async ({ browser }) => {
  test.setTimeout(600_000);
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
    await spike(guest, (s) => s.rom.give(80, 1));
    await expect.poll(async () => (await state(guest)).dolls, { timeout: 20_000, message: 'the guest holds a POKe DOLL' }).toBe(1);
    const [hostId, guestId] = [await spike(host, (s) => s.link.me as number), await spike(guest, (s) => s.link.me as number)];
    const room = r.room();
    Object.assign(room.actor(hostId), { battling: true, foe: guestId });
    Object.assign(room.actor(guestId), { battling: true, foe: hostId });
    await Promise.all([
      host.evaluate(([me, foe]) => (window as any).__spike.startFor({ type: 'duel', tick: 0, id: me, foe, first: true }), [hostId, guestId]),
      guest.evaluate(([me, foe]) => (window as any).__spike.startFor({ type: 'duel', tick: 0, id: me, foe, first: false }), [guestId, hostId]),
    ]);
    await Promise.all([menuUp(host, 120_000), menuUp(guest, 120_000)]);
    const run = guest.getByRole('button', { name: 'RUN', exact: true });
    await expect(run).toBeEnabled();
    await host.locator('.bm-cell').first().click();
    await run.click();
    // What each page has, every ten seconds, until both fights are over.
    for (let i = 0; i < 12; i++) {
      const [hs, gs] = [await state(host), await state(guest)];
      console.log(`+${i * 10}s host ${JSON.stringify(hs)} guest ${JSON.stringify(gs)}`);
      if (!hs.battle && !gs.battle) break;
      await host.waitForTimeout(10_000);
    }
    await expect.poll(async () => (await state(host)).battle || (await state(guest)).battle, { timeout: 5_000, message: 'both battles over' }).toBe(false);
    await host.waitForTimeout(3000);
    const [h, g] = [await state(host), await state(guest)];
    console.log(`host: ${JSON.stringify(h)}\nguest: ${JSON.stringify(g)}\nrelay host: ${JSON.stringify({ out: room.actor(hostId)?.out, alive: !!room.actor(hostId) })} guest: ${JSON.stringify({ out: room.actor(guestId)?.out, alive: !!room.actor(guestId) })}`);
    expect(g.dolls, 'the doll is spent').toBe(0);
    expect(g.out, 'the guest got away, and is not out').toBe(false);
    expect(h.out, 'the host is not out either').toBe(false);
    expect(g.last).toMatch(/ran/);
    expect(errors).toEqual([]);
  } finally {
    await hc.close();
    await gc.close();
    await r.close();
  }
});
