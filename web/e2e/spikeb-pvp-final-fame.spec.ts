// Cam's 11-22 play-test (iPhone, v0.3.135): "player vs player for the last two and I won but no
// banner came down and no hall of fame showed. It just showed the overworld again before kicking
// to the match over screen." Two real pages and two real ROMs fight the match's last duel as a
// link battle over the relay's own code; the winner's page should run its Hall of Fame.
import http from 'node:http';
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { giveTeam, type Craft } from './craft';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any, arg?: any) => T, arg?: unknown) =>
  page.evaluate(([src, a]) => new Function('s', 'a', `return (${src})(s, a)`)((window as any).__spike, a), [f.toString(), arg] as [string, unknown]) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 5;
const WORLD = `ws://localhost:${PORT}/world`;

// The winner's one hit takes the loser's one mon.
const WINNER: Craft[] = [{ species: 65, name: 'ALAKAZAM', level: 50, moves: [33], hp: 300, stats: [250, 90, 250, 90, 90], personality: 1000 }];
const LOSER: Craft[] = [{ species: 129, name: 'KARP', level: 5, moves: [150], hp: 12, stats: [5, 5, 5, 5, 5], personality: 4242 }];

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
  process.env.WORLD_BOTS = '0';
  process.env.WORLD_RING_SECS = '900';
  const { createWorld } = (await import('../../relay/world.js' as string)) as any;
  const world = createWorld({ log: () => undefined });
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  await new Promise<void>((ok) => server.listen(PORT, ok));
  return {
    room: () => [...(world.service as any).rooms.values()][0].host.room as any,
    close: async () => { world.close(); await new Promise((ok) => server.close(ok)); },
  };
}

/** The first move, whenever the page's menu is up, until stopped. */
function fights(page: Page): { stop: () => Promise<void> } {
  let on = true;
  const run = (async () => {
    while (on) {
      if (await page.locator('.bm-cell').first().isVisible().catch(() => false)) await page.locator('.bm-cell').first().click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  })();
  return { stop: async () => { on = false; await run; } };
}

/** Extra addresses (static ones br-symbols.json does not carry) for the diagnosis, if given:
 *  HBR_DIAG_SYMS, a JSON of name -> address, e.g. from arm-none-eabi-nm on the build's ELF. */
const diagSyms: Record<string, number> = (() => {
  try { return process.env.HBR_DIAG_SYMS ? JSON.parse(fs.readFileSync(process.env.HBR_DIAG_SYMS, 'utf8')) : {}; } catch { return {}; }
})();

/** What holds the winner's ROM off its parade: the page's flags and the ROM's own. */
const state = (page: Page) => spike(page, (s, d) => {
  const e = s.rom.emu, sym = (n: string) => s.art.sym(n);
  const cb2 = e.read(sym('gMain') + 4, 32) >>> 0, overworld = sym('CB2_Overworld') >>> 0;
  const rd = (n: string, w = 8) => (d[n] === undefined ? null : e.read(d[n], w));
  return {
    battle: !!s.battle, ...s.ending, winner: s.link.room.results.winner, me: s.link.me,
    phase: e.read(sym('gBrMatch'), 8), onField: ((cb2 & ~1) >>> 0) === ((overworld & ~1) >>> 0), cb2: cb2.toString(16),
    inBattle: !!(e.read(sym('gMain') + 0x439, 8) & 2), endingAt: Math.round(s.ending.endingAt),
    script: rd('sGlobalScriptContextStatus'), locked: rd('sLockFieldControls'), winPending: rd('sWinPending'),
    fame: document.querySelector('#battle')?.className ?? '', results: !!document.getElementById('results-again'),
  };
}, diagSyms);

test('the last two trainers: the one who wins the duel gets the Hall of Fame', async ({ browser }) => {
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
    await giveTeam(host, WINNER);
    await giveTeam(guest, LOSER);
    const [hostId, guestId] = [await spike(host, (s) => s.link.me as number), await spike(guest, (s) => s.link.me as number)];
    const room = r.room();
    expect(room.actors.filter((a: any) => a.bot).length, 'no bots: these two are the match').toBe(0);
    // The two of them are the match (the fog's first close would have said so).
    room.results.entrants = [[hostId, room.actor(hostId).name], [guestId, room.actor(guestId).name]];
    Object.assign(room.actor(hostId), { battling: true, foe: guestId });
    Object.assign(room.actor(guestId), { battling: true, foe: hostId });
    await Promise.all([
      host.evaluate(([me, foe]) => (window as any).__spike.startFor({ type: 'duel', tick: 0, id: me, foe, first: true }), [hostId, guestId]),
      guest.evaluate(([me, foe]) => (window as any).__spike.startFor({ type: 'duel', tick: 0, id: me, foe, first: false }), [guestId, hostId]),
    ]);
    await expect(host.locator('.bm-cell').first()).toBeVisible({ timeout: 120_000 });
    const [h, g] = [fights(host), fights(guest)];
    const seen: string[] = [];
    let fame = false;
    try {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < 120_000) {
        const now = await state(host);
        const line = JSON.stringify(now);
        if (line !== last) { seen.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`); last = line; }
        if (now.fame.includes('fame')) { fame = true; break; }
        await host.waitForTimeout(250);
      }
    } finally {
      await h.stop();
      await g.stop();
      console.log(`winner's page, each change:\n${seen.join('\n')}`);
    }
    expect(await spike(host, (s) => s.link.room.results.winner), 'the room crowned the winner').toBe(hostId);
    expect(fame, 'the Hall of Fame came up on the winner\'s page').toBe(true);
    await host.waitForTimeout(4000);
    await host.screenshot({ path: test.info().outputPath('pvp-final-fame.png') });
    // The relay ends the match the moment the last one falls, while the winner's duel is still on
    // screen: its results waited for nothing and came up over the parade (Cam, 11-22).
    const during = await state(host);
    console.log(`4 s into the parade: ${JSON.stringify(during)}`);
    expect(during.results, 'the results wait for the parade, not over it').toBe(false);
    expect(during.fame, 'the parade still up').toContain('fame');
    // The ROM's picture over the curtain: many colours where it stands, as spikeb-fame-mine checks.
    const box = (await host.locator('#gba').boundingBox())!;
    const png = await host.screenshot({ clip: { x: box.x + box.width * 0.1, y: box.y + box.height * 0.2, width: box.width * 0.8, height: box.height * 0.6 } });
    const n = await host.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const gx = c.getContext('2d')!;
      gx.drawImage(img, 0, 0);
      const px = gx.getImageData(0, 0, c.width, c.height).data, set = new Set<number>();
      for (let i = 0; i < px.length; i += 4) set.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      return set.size;
    }, png.toString('base64'));
    expect(n, 'the ROM drew the parade over the curtain').toBeGreaterThan(8);
    // ...and once it is over, the match's results.
    await expect(host.locator('#results-again'), 'the results after the parade').toBeAttached({ timeout: 150_000 });
    expect(errors).toEqual([]);
  } finally {
    await hc.close();
    await gc.close();
    await r.close();
  }
});
