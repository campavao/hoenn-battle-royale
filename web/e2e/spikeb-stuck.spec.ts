// The stuck-fight net (spike-b/stuck.ts): a fight that never reached its first menu ends in a
// minute with no winner, and both trainers are back on the field with the team they had.
//
// Two real pages with real ROMs on the real relay code, run inside this process. The limits are
// shortened through __spike.stuckLimits (the minute is 8 s here), and the stall is made the way
// a bad network makes it: the link blocks between the two pages stop (a duel hangs at its VS
// cards waiting for them), or a page misses the frames that held the fight's event and resyncs
// past it (the room says it fights, the page has no fight up).
//
// HBR_STUCK_NET_OFF=1 sets the limits to infinity: the same specs then show the hang the net is
// for (they fail on the first poll after the stall, and say what is stuck).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 5;
const WORLD = `ws://localhost:${PORT}/world`;
const SCRATCH = process.env.HBR_E2E_SCRATCH || '';
const NET_OFF = !!process.env.HBR_STUCK_NET_OFF;
/** The minute, shortened. */
const LIMIT_MS = 8000;
const step = (msg: string) => {
  console.log(`[stuck] ${msg}`);
  if (SCRATCH) fs.appendFileSync(path.join(SCRATCH, 'progress.txt'), `${new Date().toISOString().slice(11, 19)} ${msg}\n`);
};

async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 6 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

async function relay(bots: number) {
  process.env.WORLD_BOTS = String(bots);
  process.env.WORLD_RING_SECS = '900';
  const { createWorld } = (await import('../../relay/world.js' as string)) as any;
  const world = createWorld({ log: (l: string) => { if (SCRATCH) fs.appendFileSync(path.join(SCRATCH, 'progress.txt'), `relay: ${l}\n`); } });
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  await new Promise<void>((ok) => server.listen(PORT, ok));
  return {
    room: () => [...(world.service as any).rooms.values()][0].host.room as any,
    match: () => [...(world.service as any).rooms.values()][0] as any,
    close: async () => { world.close(); await new Promise((ok) => server.close(ok)); },
  };
}

const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];
interface Craft { species: number; name: string; level: number; moves: number[]; hp: number; stats: [number, number, number, number, number]; personality: number }

/** A party of struct Pokemon as the ROM keeps it (pokemon.h), as spikeb-battlelog.spec.ts makes one. */
function craftParty(mons: Craft[]): Buffer {
  const party = Buffer.alloc(600);
  mons.forEach((m, i) => {
    const o = i * 100, otId = 0x1234abcd;
    party.writeUInt32LE(m.personality >>> 0, o);
    party.writeUInt32LE(otId, o + 4);
    party.fill(0xff, o + 8, o + 18);
    [...m.name].forEach((c, k) => { party[o + 8 + k] = 0xbb + c.charCodeAt(0) - 65; });
    party[o + 18] = 2;
    party.fill(0xff, o + 20, o + 27);
    const plain = Buffer.alloc(48);
    const at = (sub: string) => 12 * ORDERS[m.personality % 24].indexOf(sub);
    plain.writeUInt16LE(m.species, at('G'));
    plain.writeUInt32LE(m.level ** 3, at('G') + 4);
    plain[at('G') + 9] = 70;
    m.moves.forEach((mv, k) => { plain.writeUInt16LE(mv, at('A') + 2 * k); plain[at('A') + 8 + k] = 25; });
    plain.writeUInt16LE(m.level | (0x0b << 7) | (4 << 11), at('M') + 2);
    plain.writeUInt32LE(0x0a5294a5 >>> 0, at('M') + 4);
    let sum = 0;
    for (let h = 0; h < 24; h++) sum = (sum + plain.readUInt16LE(h * 2)) & 0xffff;
    party.writeUInt16LE(sum, o + 28);
    const key = (m.personality ^ otId) >>> 0;
    for (let w = 0; w < 12; w++) party.writeUInt32LE((plain.readUInt32LE(w * 4) ^ key) >>> 0, o + 32 + w * 4);
    party[o + 84] = m.level;
    party.writeUInt16LE(m.hp, o + 86);
    party.writeUInt16LE(m.hp, o + 88);
    m.stats.forEach((v, k) => party.writeUInt16LE(v, o + 90 + 2 * k));
  });
  return party;
}

async function giveTeam(page: Page, mons: Craft[]): Promise<void> {
  const party = craftParty(mons).toString('base64');
  const ok = await page.evaluate(async ([party, count]) => {
    const rom = (window as any).__spike.rom;
    const j = JSON.parse(await rom.save());
    j.party = party;
    j.count = count;
    return rom.load(JSON.stringify(j));
  }, [party, mons.length] as [string, number]);
  expect(ok, 'the team went in').toBe(true);
}

const TEAM: Craft[] = [{ species: 258, name: 'MUDKIP', level: 20, moves: [33], hp: 14, stats: [90, 15, 12, 12, 12], personality: 2222 }];

/** A hosted room of two pages, no bots, the match begun, both ROMs up, a team in each, the limits set. */
async function bootRoom(browser: Browser, bots = 0) {
  const r = await relay(bots);
  const [hc, gc] = [await browser.newContext(), await browser.newContext()];
  const [host, guest] = [await hc.newPage(), await gc.newPage()];
  const url = `/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}`;
  host.on('pageerror', (e) => step(`host pageerror ${e.message}`));
  guest.on('pageerror', (e) => step(`guest pageerror ${e.message}`));
  host.on('console', (m) => { if (/stopped with no winner|never started|no battle/.test(m.text())) step(`host console: ${m.text()}`); });
  guest.on('console', (m) => { if (/stopped with no winner|never started|no battle/.test(m.text())) step(`guest console: ${m.text()}`); });
  await host.goto(`${url}#host`);
  await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 90_000 });
  await setOption(host, 'room-safari', 'NO SAFARI');
  await guest.goto(`${url}${new URL(host.url()).hash}`);
  await expect(host.locator('#room-roster li', { hasText: 'CAM' })).toHaveCount(2, { timeout: 90_000 });
  await expect(host.locator('#room-start')).toBeEnabled();
  await host.locator('#room-start').click();
  for (const [name, p] of [['host', host], ['guest', guest]] as const) {
    const t0 = Date.now();
    for (;;) {
      const up = await Promise.race([p.evaluate(() => !!(window as any).__spike?.rom && !!(window as any).__spike.link?.room?.actor((window as any).__spike.link.me)), new Promise<string>((ok) => setTimeout(() => ok('no answer'), 5000))]);
      if (up === true) break;
      if (Date.now() - t0 > 180_000) throw new Error(`${name} page: ROM not up after 3 min (${up})`);
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
  const [hostId, guestId] = [await spike(host, (s) => s.link.me), await spike(guest, (s) => s.link.me)];
  await giveTeam(host, TEAM);
  await giveTeam(guest, TEAM);
  for (const p of [host, guest]) {
    await p.evaluate(([off, ms]) => {
      const s = (window as any).__spike;
      if (s.stuckLimits) Object.assign(s.stuckLimits, off ? { ms: 1e12, frames: 1e12, hardMs: 1e12 } : { ms, frames: 120, hardMs: 40_000 });
      // What the box said, whenever it said it (a line stays up 2.5 s).
      (window as any).__said = [];
      new MutationObserver(() => { const t = document.getElementById('msg')?.getAttribute('data-text') ?? ''; if (t && !(window as any).__said.includes(t)) (window as any).__said.push(t); })
        .observe(document.getElementById('msg')!, { attributes: true, attributeFilter: ['data-text'] });
    }, [NET_OFF, LIMIT_MS] as const);
  }
  step('both pages up');
  const close = async () => { await hc.close(); await gc.close(); await r.close(); };
  return { r, host, guest, hostId: hostId as number, guestId: guestId as number, close };
}

/** The two on one street, the host walking at the guest until the room has them in a fight. */
async function meet(room: Awaited<ReturnType<typeof bootRoom>>): Promise<void> {
  const { r, host, guest, hostId, guestId } = room;
  await host.evaluate(() => (window as any).__spike.link.fly('MAP_LITTLEROOT_TOWN', 9, 12));
  await guest.evaluate(() => (window as any).__spike.link.fly('MAP_LITTLEROOT_TOWN', 11, 12));
  await expect.poll(() => { const t = r.room().actor(hostId), g = r.room().actor(guestId); return `${t.m.spot.map},${t.m.spot.x} ${g.m.spot.map},${g.m.spot.x}`; }, { timeout: 30_000 }).toBe('MAP_LITTLEROOT_TOWN,9 MAP_LITTLEROOT_TOWN,11');
  for (let i = 0; i < 40 && !r.room().actor(hostId).battling; i++) {
    await host.keyboard.down('ArrowRight');
    await host.waitForTimeout(80);
    await host.keyboard.up('ArrowRight');
    await host.waitForTimeout(300);
  }
  await expect.poll(() => { const t = r.room().actor(hostId); return t.battling ? t.foe : 0; }, { timeout: 30_000 }).toBe(guestId);
}

/** Where a page stands, for the report. */
const where = (p: Page) => spike(p, (s) => {
  const me = s.link.room.actor(s.link.me);
  return { battle: !!s.battle, roomBattling: !!me?.battling, foe: me?.foe ?? 0, menu: s.rom.menuUp?.() ?? null, party: s.rom.partyCount(), last: s.lastResult as string };
});

/** Both pages back on the field with nothing lost: no fight up, the room has neither fighting, the team the ROM carries as it was. */
async function expectBackOnField(room: Awaited<ReturnType<typeof bootRoom>>, teams: string[], told = [room.host, room.guest], within = 60_000): Promise<void> {
  const { r, host, guest, hostId, guestId } = room;
  const t0 = Date.now();
  let was = '';
  try {
    await expect.poll(async () => {
      const [h, g] = [await where(host), await where(guest)];
      // A line when either page changes, to see when each was let go.
      const now = `host ${h.battle ? 'fighting' : 'free'}${h.menu ? ' (menu)' : ''}${h.last ? ` [${h.last}]` : ''}, guest ${g.battle ? 'fighting' : 'free'}${g.menu ? ' (menu)' : ''}, room ${r.room().actor(hostId).battling}/${r.room().actor(guestId).battling}`;
      if (now !== was) { step(`+${Math.round((Date.now() - t0) / 1000)} s ${now}`); was = now; }
      const rm = [r.room().actor(hostId), r.room().actor(guestId)];
      return !h.battle && !g.battle && !rm[0].battling && !rm[1].battling;
    }, { timeout: within, intervals: [500] }).toBe(true);
  } catch (e) {
    step(`still stuck after ${within} ms: host ${JSON.stringify(await where(host))} guest ${JSON.stringify(await where(guest))}`);
    throw e;
  }
  step(`back on the field after ${Date.now() - t0} ms`);
  expect(r.room().actor(hostId).foe).toBe(0);
  expect(r.room().actor(guestId).foe).toBe(0);
  // Nothing lost: the team the ROM carries is the one it had.
  const after = [await spike(host, (s) => JSON.stringify(s.rom.teamNow())), await spike(guest, (s) => JSON.stringify(s.rom.teamNow()))];
  expect(after).toEqual(teams);
  // The ROM took its next turn: nothing is waiting in its queue behind the fight that stopped.
  for (const p of [host, guest]) expect(await spike(p, async (s) => (await s.rom.fameTeam()).length), 'the ROM is free again').toBeGreaterThan(0);
  // A watcher's view closes: every fight log the relay holds has its end.
  const logs = [...r.match().logs.values()] as { ended: boolean }[];
  expect(logs.every((l) => l.ended), `fight logs ended (${logs.length})`).toBe(true);
  // The recording says it, for a saved log.
  for (const p of told) {
    const text = await p.evaluate(async () => (await import('/spike-b/recorder.ts' as string)).recorder.text());
    expect(JSON.parse(text).log.some((e: { k: string }) => e.k === 'stuck'), 'a stuck line in the recording').toBe(true);
  }
}

const teamsOf = (room: Awaited<ReturnType<typeof bootRoom>>) => Promise.all([spike(room.host, (s) => JSON.stringify(s.rom.teamNow())), spike(room.guest, (s) => JSON.stringify(s.rom.teamNow()))]);

// The second page has a net of its own, or none (a page whose net is not running): then only the
// first's end can release it, whichever noticed first.
for (const guestNet of [true, false]) test(`a duel whose link blocks stop at its VS cards ends with no winner, and both are back on the field${guestNet ? '' : ' (the other page has no net of its own)'}`, async ({ browser }) => {
  test.setTimeout(400_000);
  const room = await bootRoom(browser);
  try {
    const { host, guest } = room;
    const teams = await teamsOf(room);
    if (!guestNet) await guest.evaluate(() => Object.assign((window as any).__spike.stuckLimits, { ms: 1e12, frames: 1e12, hardMs: 1e12 }));
    // The guest hears the host's first block and no other: the link stands at its cards.
    await guest.evaluate(() => {
      const l = (window as any).__spike.link, receive = l.receive.bind(l);
      let n = 0;
      (window as any).__bt = () => n;
      l.receive = (m: { t: string }, ready: () => void) => { if (m.t === 'bt' && ++n > 1) return; receive(m, ready); };
    });
    await meet(room);
    step('they met');
    await expect.poll(() => spike(host, (s) => !!s.battle), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => spike(guest, (s) => !!s.battle), { timeout: 60_000 }).toBe(true);
    // Stalled: well past the intro (7 s), no menu on either ROM.
    await host.waitForTimeout(5000);
    step(`stalled: host ${JSON.stringify(await where(host))} guest ${JSON.stringify(await where(guest))} (blocks the guest saw: ${await guest.evaluate(() => (window as any).__bt())})`);
    expect((await where(host)).menu).toBe(false);
    expect((await where(guest)).menu).toBe(false);
    await expectBackOnField(room, teams);
    // The player was told.
    for (const p of [room.host, room.guest]) expect(await p.evaluate(() => (window as any).__said as string[])).toContain("The battle couldn't start.");
    for (const p of [room.host, room.guest]) expect(await spike(p, (s) => s.lastResult as string)).toContain('stopped');
    // Which noticed: the host by the clock, the guest by it too, or by the host having stopped.
    if (!guestNet) {
      const why = await guest.evaluate(async () => JSON.parse((await import('/spike-b/recorder.ts' as string)).recorder.text()).log.find((e: { k: string }) => e.k === 'stuck').why);
      expect(why).toBe('foe-ended');
    }
  } finally {
    await room.close();
  }
});

test('a page that resynced past its fight event is told the room has it fighting, and is back on the field with the other', async ({ browser }) => {
  test.setTimeout(400_000);
  const room = await bootRoom(browser);
  try {
    const { r, host, guest, guestId } = room;
    const teams = await teamsOf(room);
    // The guest misses the frames that hold the meeting: a page that fell behind. Its hold is
    // lifted after the fight's event is past; the next frame it hears is not the next one, and
    // net.ts asks the relay for its state by itself (a `gap`), which has the fight begun.
    await guest.evaluate(() => {
      const l = (window as any).__spike.link, receive = l.receive.bind(l);
      (window as any).__hold = true;
      l.receive = (m: { t: string }, ready: () => void) => { if ((window as any).__hold && m.t === 'f') return; receive(m, ready); };
    });
    await meet(room);
    step('the room has them fighting; the guest saw none of it');
    await host.waitForTimeout(3000);
    await guest.evaluate(() => { (window as any).__hold = false; });
    await expect.poll(() => spike(guest, (s) => !!s.link.room.actor(s.link.me)?.battling), { timeout: 15_000 }).toBe(true);
    await guest.waitForTimeout(2000);
    const gaps = await guest.evaluate(async () => JSON.parse((await import('/spike-b/recorder.ts' as string)).recorder.text()).log.filter((e: { k: string; what?: string }) => e.k === 'net' && e.what === 'gap').length);
    step(`the guest's recording has ${gaps} gap(s): the resync was net.ts's own`);
    expect(gaps).toBeGreaterThan(0);
    // The theory, shown: the room says the guest fights and the guest has no fight up.
    const g = await where(guest);
    step(`after the resync: guest ${JSON.stringify(g)} host ${JSON.stringify(await where(host))}`);
    expect(g.roomBattling, 'the room says the guest fights').toBe(true);
    expect(g.battle, 'and the guest has no fight up').toBe(false);
    expect(r.room().actor(guestId).battling).toBe(true);
    await expectBackOnField(room, teams);
    expect(await guest.evaluate(() => (window as any).__said as string[])).toContain("The battle couldn't start.");
  } finally {
    await room.close();
  }
});

test('a fight with a bot that never shows a first menu is stopped on the running ROM, with the team as it was', async ({ browser }) => {
  test.setTimeout(400_000);
  const room = await bootRoom(browser, 3);
  try {
    const { r, host, hostId } = room;
    const teams = await teamsOf(room);
    const foe = r.room().actors.find((a: any) => a.bot && !a.battling).id as number;
    // The room has them at it (room.ts engage); the page hands it to its ROM as the event would.
    // The ROM's fight is real and reaches its menu, but this page is told it has not: the net
    // stops a fight that is running, mid-menu, which is the hardest one to unwind.
    Object.assign(r.room().actor(hostId), { battling: true, foe });
    Object.assign(r.room().actor(foe), { battling: true, foe: hostId, foughtBy: hostId });
    await host.evaluate((foe) => {
      const s = (window as any).__spike;
      s.rom.menuUp = () => false;
      s.startFor({ type: 'fight', tick: 0, id: s.link.me, foe });
    }, foe);
    await expect.poll(() => spike(host, (s) => !!s.battle), { timeout: 30_000 }).toBe(true);
    step('the bot fight is up');
    await expectBackOnField(room, teams, [host]);
    expect(r.room().actor(foe).battling, 'the bot is free').toBe(false);
    expect(await host.evaluate(() => (window as any).__said as string[])).toContain("The battle couldn't start.");
    // The ROM is parked: a fight afterwards starts and is stopped the same way.
    expect(await spike(host, (s) => s.lastResult as string)).toContain('stopped');
  } finally {
    await room.close();
  }
});

test('a ROM that cannot unwind the stopped fight does not hold the trainer: the page lets go, and the late end of that fight counts for nothing', async ({ browser }) => {
  test.setTimeout(400_000);
  const room = await bootRoom(browser, 3);
  try {
    const { r, host, hostId } = room;
    const foe = r.room().actors.find((a: any) => a.bot && !a.battling).id as number;
    Object.assign(r.room().actor(hostId), { battling: true, foe });
    Object.assign(r.room().actor(foe), { battling: true, foe: hostId, foughtBy: hostId });
    await host.evaluate((foe) => {
      const s = (window as any).__spike;
      // A ROM whose emulator is not running, or that has a turn ahead of this fight that never ends:
      // asked to stop, it does nothing.
      s.rom.menuUp = () => false;
      s.rom.abort = () => undefined;
      s.startFor({ type: 'fight', tick: 0, id: s.link.me, foe });
    }, foe);
    await expect.poll(() => spike(host, (s) => !!s.battle), { timeout: 30_000 }).toBe(true);
    // The net (8 s) and then the page's own let-go (4 s).
    await expect.poll(() => spike(host, (s) => !s.battle && !s.link.room.actor(s.link.me)?.battling), { timeout: 40_000 }).toBe(true);
    expect(r.room().actor(hostId).battling).toBe(false);
    expect(r.room().actor(foe).battling).toBe(false);
    expect(await spike(host, (s) => s.lastResult as string)).toContain('stopped');
    expect(await host.evaluate(() => (window as any).__said as string[])).toContain("The battle couldn't start.");
    // The fight is still running on the hidden ROM; when it ends, in its time, it is nobody's.
    await host.waitForTimeout(3000);
    expect(await spike(host, (s) => s.isOut)).toBe(false);
  } finally {
    await room.close();
  }
});
