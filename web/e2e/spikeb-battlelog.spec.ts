// A fight as a log (battlereader.ts -> the relay -> a watcher's link.onBattleLog): the fighter's
// page reads its ROM's battle and says what happens, the relay keeps it for whoever comes late,
// and a watcher folding it with applyEvent ends where the fighter's ROM did.
//
// Two real pages (the fighter's and a watcher's, each with a real ROM) on the real relay code,
// run inside this process so the spec can say a trainer is in a fight the way the room does
// (room.ts engage) instead of walking to one for minutes. The fight itself is real: the page
// hands it to its ROM (startFor, as a room event would) and the spec plays it through the
// battle windows. A late joiner is a bare socket speaking the protocol.
//
// What the fighter's ROM "really did" is sampled by an oracle that reads the same memory every
// frame with none of the reader's care (no two-frame debounce, no checksums): the lines the box
// held, each mon's HP, which slot was out. The party after the fight (rom.teamNow) is a second,
// independent witness to the fighter's own HP.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 3;
const WORLD = `ws://localhost:${PORT}/world`;
const SCRATCH = process.env.HBR_E2E_SCRATCH || '';
const CLICK = { timeout: 2000 };
/** Where the run is, for a spec that hangs: a line a step in $HBR_E2E_SCRATCH/progress.txt. */
const step = (msg: string) => { if (SCRATCH) fs.appendFileSync(path.join(SCRATCH, 'progress.txt'), `${new Date().toISOString().slice(11, 19)} ${msg}\n`); };

async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 6 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

/** The relay's own code (relay/world.js over the bundled service), served here. */
async function relay(bots = 3) {
  process.env.WORLD_BOTS = String(bots);
  // Three fights outlast a 120 s ring phase, and past it the fog bites the party on the field, so the
  // party read after a fight is not the one the fight left.
  process.env.WORLD_RING_SECS = '900';
  const { createWorld } = (await import('../../relay/world.js' as string)) as any;
  const { WORLD_HASH } = (await import('../../relay/world/service.js' as string)) as any;
  const world = createWorld({ log: (l: string) => step(`relay: ${l}`) });
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  await new Promise<void>((ok) => server.listen(PORT, ok));
  return {
    hash: WORLD_HASH as string,
    room: () => [...(world.service as any).rooms.values()][0].host.room as any,
    match: () => [...(world.service as any).rooms.values()][0] as any,
    close: async () => { world.close(); await new Promise((ok) => server.close(ok)); },
  };
}

/** A bare socket that joins the room late and watches `target`: what a phone coming in
 *  mid-fight is told. */
async function lateJoiner(code: string, target: number, hash: string) {
  const { default: WS } = (await import('../../relay/node_modules/ws/wrapper.mjs' as string)) as any;
  const romSha = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/patch/br-version.json'), 'utf8')).romSha1.slice(0, 7);
  const ws = new WS(WORLD);
  const msgs: any[] = [];
  let watching = false;
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'LATE', skin: 0, code, w: hash, r: romSha })));
  ws.on('message', (d: any) => {
    const m = JSON.parse(String(d));
    msgs.push(m);
    if (!watching && (m.t === 'hello' || (m.t === 'room' && m.playing))) { watching = true; ws.send(JSON.stringify({ t: 'watch', id: target })); }
  });
  return { msgs, bl: () => msgs.filter((m) => m.t === 'bl'), close: () => ws.close() };
}

/** What the fighter's ROM really did, sampled every frame with none of the reader's care. */
async function installOracle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { battleText } = await import('/spike-b/battlereader.ts' as string);
    const s = (window as any).__spike, emu = s.rom.emu, sym = s.art.sym;
    const mons = sym('gBattleMons'), txt = sym('gDisplayedStringBattle'), idx = sym('gBattlerPartyIndexes'), pos = sym('gBattlerPositions'), menu = sym('gBrBattle') + 8;
    const o: any = { lines: [], last: '', hp: [{}, {}], field: [[], []], off: null };
    o.off = emu.onFrame(() => {
      const raw = emu.bytes(txt, 128) as Uint8Array;
      let n = 0;
      while (n < 128 && raw[n] !== 0xff) n++;
      const key = Array.from(raw.subarray(0, n)).join(',');
      if (key !== o.last) {
        o.last = key;
        const line = n && emu.read(menu, 8) === 0 ? battleText(raw.subarray(0, n)) : '';
        if (line && !/^What will\b.*\bdo\?$/.test(line)) o.lines.push(line);
      }
      let local = 0;
      for (let i = 0; i < 4; i++) if (emu.read(pos + i, 8) === 0) { local = i; break; }
      for (const side of [0, 1]) {
        const b = side ? local ^ 1 : local;
        if (!emu.read(mons + b * 0x58, 16)) continue;
        const slot = emu.read(idx + b * 2, 16);
        o.hp[side][slot] = emu.read(mons + b * 0x58 + 0x28, 16);
        if (o.field[side].at(-1) !== slot) o.field[side].push(slot);
      }
    });
    (window as any).__oracle = o;
  });
}

/** What the ROM's buffer holds besides the box's lines: a healthbox's name, and the move menu's
 *  PP and type windows. Judged here on its own, so the reader's own filter is held to it. */
// Sampled every frame it catches that buffer half rewritten too ("18/3SH", "1P"), which is why a
// word on its own with nothing to end it is no line, whatever it says.
const NOT_A_LINE = /^(\S*[^\s!?…]|(NORMAL|FIGHT|FLYING|POISON|GROUND|ROCK|BUG|GHOST|STEEL|FIRE|WATER|GRASS|ELECTR|PSYCHC|ICE|DRAGON|DARK)\b[ ./\d]*)$/;
const takeOracle = (page: Page) => page.evaluate(() => { const o = (window as any).__oracle; o.off(); return { lines: o.lines as string[], hp: o.hp as Record<number, number>[], field: o.field as number[][] }; }).then((o) => ({ ...o, lines: o.lines.filter((l) => !NOT_A_LINE.test(l)) }));

/** Folds events the way a watcher's view would. */
async function fold(page: Page, events: unknown[]): Promise<any> {
  return page.evaluate(async (events) => {
    const { applyEvent, emptyState } = await import('/spike-b/shared/battlelog.ts' as string);
    const s = emptyState();
    for (const ev of events as any[]) applyEvent(s, ev);
    return s;
  }, events);
}

const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

interface Craft { species: number; name: string; level: number; moves: number[]; hp: number; stats: [number, number, number, number, number]; personality: number }

/** A party of struct Pokemon as the ROM keeps it (pokemon.h): the 48 bytes of substructs
 *  XORed with personality ^ otId, summed into the checksum. Level is the rung the ROM lifts
 *  it from. */
function craftParty(mons: Craft[]): Buffer {
  const party = Buffer.alloc(600);
  mons.forEach((m, i) => {
    const o = i * 100, otId = 0x1234abcd;
    party.writeUInt32LE(m.personality >>> 0, o);
    party.writeUInt32LE(otId, o + 4);
    party.fill(0xff, o + 8, o + 18);
    [...m.name].forEach((c, k) => { party[o + 8 + k] = 0xbb + c.charCodeAt(0) - 65; });
    party[o + 18] = 2; // English
    party.fill(0xff, o + 20, o + 27);
    const plain = Buffer.alloc(48);
    const at = (sub: string) => 12 * ORDERS[m.personality % 24].indexOf(sub);
    plain.writeUInt16LE(m.species, at('G'));
    plain.writeUInt32LE(m.level ** 3, at('G') + 4);
    plain[at('G') + 9] = 70;
    m.moves.forEach((mv, k) => { plain.writeUInt16LE(mv, at('A') + 2 * k); plain[at('A') + 8 + k] = 25; });
    plain.writeUInt16LE(m.level | (0x0b << 7) | (4 << 11), at('M') + 2); // met at its level, in Emerald, a Poke Ball
    plain.writeUInt32LE(0x0a5294a5 >>> 0, at('M') + 4); // IVs of 5s
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

/** The fighter's team, put into its ROM the way a reload brings a saved one back. */
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

/** A weak lead to faint and a strong one behind it. */
const TEAM: Craft[] = [
  { species: 129, name: 'MAGIKARP', level: 3, moves: [33, 150], hp: 4, stats: [5, 6, 8, 5, 5], personality: 1111 },
  { species: 258, name: 'MUDKIP', level: 8, moves: [33, 189], hp: 28, stats: [16, 15, 12, 12, 12], personality: 2222 },
];

/** The fight on `page`, played through the battle windows until it is over (or `stop`). */
async function play(page: Page, switchAt = 0): Promise<void> {
  // Always the first move; once, `switchAt` taps in, the second of the party is sent out (PARTY on
  // Q, the slot, SEND OUT: the windows' own keys).
  let turns = 0;
  let tried = 0;
  for (let i = 0; i < 400; i++) {
    if (!(await spike(page, (s) => !!s.battle))) return;
    if (i % 20 === 3) step(`play ${i}: ${JSON.stringify(await spike(page, (s) => ({ menu: s.battleMenu?.isShown, lead: s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16) })))} cells ${await page.locator('.bm-cell').count()} slots ${await page.locator('.bm-slot').count()}`);
    if (await page.locator('.bm-m-btn').first().isVisible().catch(() => false)) {
      // A member's panel (BACK, SUMMARY, SEND OUT): a forced switch after a faint lands here. One
      // that cannot go has its SEND OUT off, which no click will take: BACK, and the next of the party.
      const send = page.locator('.bm-m-btn').nth(2);
      if ((await send.getAttribute('aria-disabled').catch(() => null)) === 'true') await page.locator('.bm-m-btn').first().click(CLICK).catch(() => undefined);
      else await send.click(CLICK).catch(() => undefined);
    } else if (await page.locator('.bm-cell').first().isVisible().catch(() => false)) {
      // Only while the lead is still out and the other can go: with the lead down and the other out,
      // the party has nobody to send, and the window would never let this go on (it held one repeat
      // in three at a menu until the 400 tries ran out).
      if (switchAt && ++turns === switchAt && (await spike(page, (s) => s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16))) === 0) {
        step('switching');
        await page.keyboard.press('q');
        await page.locator('.bm-slot').nth(1).click(CLICK).catch(() => undefined);
        await page.locator('.bm-m-btn').nth(2).click(CLICK).catch(() => undefined);
        await page.waitForTimeout(4000);
        continue;
      }
      await page.locator('.bm-cell').first().click(CLICK).catch(() => undefined);
    } else if (await page.locator('.bm-slot').first().isVisible().catch(() => false)) {
      const slots = page.locator('.bm-slot');
      const n = await slots.count();
      for (let k = 0; k < n; k++) {
        const at = slots.nth(n - 1 - tried++ % n);
        if ((await at.isVisible()) && (await at.getAttribute('aria-disabled')) !== 'true') { await at.click(CLICK).catch(() => undefined); break; }
      }
    } else {
      await page.keyboard.press('z');
    }
    await page.waitForTimeout(400);
  }
  if (SCRATCH) await page.screenshot({ path: path.join(SCRATCH, `stuck-${Date.now()}.png`) }).catch(() => undefined);
  // The windows are drawn on canvases: what they say is on their labels.
  const said = await page.locator('.bm-m-btn:visible, .bm-cell:visible, .bm-slot:visible').evaluateAll((all) => all.map((e) => e.getAttribute('aria-label'))).catch(() => []);
  const net = await spike(page, (s) => { const a = s.art.sym('gBrNetlink'), e = s.rom.emu; return `sent ${e.read(a + 12, 16)} heard ${e.read(a + 14, 16)} flags ${e.read(a + 3, 8)}, in the battle's own loop: ${!!e.read(s.art.sym('gBattleMainFunc'), 32)}`; }).catch(() => '');
  throw new Error(`the fight did not end, its menu saying ${JSON.stringify(said)}; link ${net}`);
}

const flat = (got: any[]) => got.flatMap((m) => m.events) as any[];
const linesOf = (events: any[]) => events.filter((e) => e.e === 'text').map((e) => e.text as string);

/** The log's whole story against the ROM's, for the fight just played on `host`. */
async function expectLogMatchesRom(host: Page, events: any[], oracle: Awaited<ReturnType<typeof takeOracle>>, what: string): Promise<any> {
  expect(events[0]?.e, `${what}: begins with its start`).toBe('start');
  expect(events.at(-1)?.e, `${what}: ends with its end`).toBe('end');
  expect(events.filter((e) => e.e === 'start'), `${what}: one fight`).toHaveLength(1);
  const state = await fold(host, events);
  // The lines the fighter saw, each once, in order.
  expect(linesOf(events), `${what}: the box's lines`).toEqual(oracle.lines);
  // Who was out, in order, on each side.
  for (const side of [0, 1]) {
    expect(events.filter((e) => e.e === 'send' && e.side === side).map((e) => e.slot), `${what}: side ${side}'s send-outs`).toEqual(oracle.field[side]);
    // ...and the HP each of them was last seen at.
    for (const [slot, hp] of Object.entries(oracle.hp[side])) expect(state[side ? 'b' : 'a'].team[Number(slot)].hp, `${what}: side ${side} slot ${slot} HP`).toBe(hp);
  }
  // My party after the fight: the fighter's own HP, from bytes the reader never saw.
  // (A lost fight puts the team back as it came in.)
  const after = (await spike(host, (s) => s.lastResult as string)).includes('lost') ? null : await spike(host, (s) => s.rom.teamNow());
  after?.forEach((m: any, i: number) => expect(state.a.team[i].hp, `${what}: my slot ${i} against the party`).toBe(m.hp));
  return state;
}

/** A hosted room of two pages on the in-process relay, the match begun, both ROMs up. */
async function bootRoom(browser: Browser, bots = 3) {
  const r = await relay(bots);
  const [hc, gc] = [await browser.newContext(), await browser.newContext()];
  const [host, guest] = [await hc.newPage(), await gc.newPage()];
  const url = `/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}`;
  step('start');
  host.on('pageerror', (e) => step(`host pageerror ${e.message}`));
  guest.on('pageerror', (e) => step(`guest pageerror ${e.message}`));
  await host.goto(`${url}#host`);
  await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 90_000 });
  const code = (await host.locator('#room-code').textContent())!.match(/[A-Z0-9]{6}/)![0];
  await setOption(host, 'room-safari', 'NO SAFARI');
  await guest.goto(`${url}${new URL(host.url()).hash}`);
  await expect(host.locator('#room-roster li', { hasText: 'CAM' })).toHaveCount(2, { timeout: 90_000 });
  await expect(host.locator('#room-start')).toBeEnabled();
  await host.locator('#room-start').click();
  step('started');
  // Polled on a timer, not on animation frames: a page that is not painting would never answer.
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
  step('both pages up');
  const close = async () => { await hc.close(); await gc.close(); await r.close(); };
  return { r, host, guest, hostId: hostId as number, guestId: guestId as number, code, close };
}

test('a fight is a log: the watcher ends where the fighter\'s ROM did, and a late joiner with it', async ({ browser }) => {
  test.setTimeout(1_200_000);
  const late: Awaited<ReturnType<typeof lateJoiner>>[] = [];
  const room0 = await bootRoom(browser);
  const { r, host, guest, hostId, code } = room0;
  try {
    await giveTeam(host, TEAM);
    expect(await spike(host, (s) => s.rom.partyCount())).toBe(2);

    // The watcher is what a watcher is: a trainer who is out, following the host. As a trainer still
    // in, with no team, the first bot to meet it put it out, and being out it follows whoever is
    // nearest: the relay rightly stopped sending it the host's fight (1 repeat in 6, 2 in 16, at a
    // fight's tail or its head). Its page takes each call as it comes, and hands it on to the view.
    await spike(guest, (s) => s.goOut('out'));
    await expect.poll(() => spike(guest, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
    await guest.evaluate((id) => (window as any).__spike.watch.host.setFollow(id), hostId);
    await expect.poll(() => spike(guest, (s) => !!s.link.onBattleLog), { timeout: 10_000 }).toBe(true);
    await guest.evaluate(() => {
      const w = window as any, l = w.__spike.link, view = l.onBattleLog;
      w.__got = [];
      l.onBattleLog = (from: number, f: number, events: unknown[], ago?: number) => { w.__got.push({ from, f, events, ago }); view(from, f, events, ago); };
    });
    const freeBot = () => r.room().actors.find((a: any) => a.bot && !a.battling)?.id as number;
    const stillIn = () => !!r.match()?.host?.room.actor(hostId);

    /** One fight of the host's: the relay's room says they are at it (room.ts engage), the page
     *  hands it to its ROM as the event would, and the spec plays it. A late joiner comes in
     *  after `lateAt` events of it. */
    const fight = async (what: string, event: (foe: number) => unknown, foe: number, lateAt = 0, switchAt = 0) => {
      const room = r.room();
      Object.assign(room.actor(hostId), { battling: true, foe });
      if (foe) Object.assign(room.actor(foe), { battling: true, foe: hostId, foughtBy: hostId });
      step(`${what}: start`);
      await installOracle(host);
      await guest.evaluate(() => { (window as any).__got.length = 0; });
      await host.evaluate(() => {
        const w = window as any, l = w.__spike.link;
        w.__said = [];
        if (!w.__saidOn) { w.__saidOn = true; const bl = l.bl.bind(l); l.bl = (f: number, ev: any[]) => { w.__said.push(...ev.map((e) => e.e)); bl(f, ev); }; }
      });
      const lates: Awaited<ReturnType<typeof lateJoiner>>[] = [];
      await host.evaluate((ev) => (window as any).__spike.startFor(ev), event(foe) as any);
      const playing = play(host, switchAt);
      if (lateAt) {
        await expect.poll(async () => flat(await guest.evaluate(() => (window as any).__got)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(lateAt);
        step(`${what}: a late joiner comes in`);
        const l = await lateJoiner(code, hostId, r.hash);
        lates.push(l);
        late.push(l);
      }
      step(`${what}: played through`);
      await playing;
      step(`${what}: over`);
      await host.waitForTimeout(1500);
      const got = await guest.evaluate(() => (window as any).__got);
      const events = flat(got);
      const said = await host.evaluate(() => (window as any).__said as string[]);
      step(`${what}: page said ${said.length} (last ${said.at(-1)}), watcher got ${events.length} (last ${events.at(-1)?.e}); ${await spike(host, (s) => s.lastResult)}; watcher ${await spike(guest, (s) => `${s.isOut ? 'out' : 'in'}, ${document.getElementById('watch-who')!.textContent}`)}; round ${r.match()?.host?.room.results.round}`);
      expect(said.at(-1), `${what}: the ROM's fight-end is said`).toBe('end');
      expect(events.length, `${what}: the watcher has all of it`).toBe(said.length);
      const oracle = await takeOracle(host);
      const result = await spike(host, (s) => s.lastResult as string);
      const stats = await spike(host, (s) => s.rom.logStats());
      console.log(`[${what}] ${result}; ${events.length} events in ${got.length} messages; reader ${stats.frames} frames, ${(stats.ms / stats.frames * 1000).toFixed(1)} us each, worst ${stats.maxMs.toFixed(2)} ms`);
      console.log(`[${what}] ` + events.map((e: any) => (e.e === 'text' ? `"${e.text}"` : e.e === 'start' ? 'start' : `${e.e}${e.side ?? ''}${e.slot ?? e.hp ?? e.winner ?? ''}`)).join(' '));
      if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, `${what.replace(/\W+/g, '-')}.json`), JSON.stringify({ events, oracle, got }, null, 1));
      const state = await expectLogMatchesRom(host, events, oracle, what);
      // ...and its view, playing it at the log's pace, gets to the end and closes. (After the party is
      // read: on the field the fog goes on biting it.)
      await expect.poll(() => spike(guest, (s) => !s.watch.showing), { timeout: 180_000 }).toBe(true);
      for (const l of lates) {
        await expect.poll(() => l.bl().length, { timeout: 10_000 }).toBeGreaterThan(0);
        const first = l.bl()[0];
        expect(first.ago, `${what}: a late joiner is told how long ago it began`).toBeGreaterThan(0);
        expect(first.events[0].e, 'the whole log so far, from its start').toBe('start');
        const lateState = await fold(host, l.bl().flatMap((m: any) => m.events));
        expect(lateState, `${what}: a late joiner ends in the same state`).toEqual(state);
        l.close();
      }
      return { events, state, result };
    };

    // A bot, to the end: two send-outs, a lead fainting, the next coming in, a faint, the end.
    const botFight = await fight('bot fight', (foe) => ({ type: 'fight', tick: 0, id: hostId, foe }), freeBot(), 8, 4);
    expect(botFight.events.filter((e) => e.e === 'send').length, 'a send-out beyond the first two').toBeGreaterThan(2);
    expect(botFight.events.some((e) => e.e === 'faint')).toBe(true);
    expect(botFight.events.some((e) => e.e === 'hit') && botFight.events.some((e) => e.e === 'hp')).toBe(true);

    // A team that loses puts the host out of the match, and the room has no trainer left to stage the
    // next fight on: what ran was checked, and this repeat is done. Said, not hidden.
    const lost = (what: string, result: string) => {
      if (stillIn()) return false;
      test.info().annotations.push({ type: 'note', description: `the ${what} fight was lost (${result}): no more fights this repeat` });
      step(`the ${what} fight was lost: the host is out, no more fights this repeat`);
      return true;
    };
    if (lost('bot', botFight.result)) return;
    // A wild POKeMON, off a marked spot of Route 117.
    const spot = await spike(host, (s) => { const q = s.link.room.patchesOn('MAP_ROUTE117')[0]; return { x: q.x, y: q.y, key: q.key }; });
    const wild = await fight('wild fight', () => ({ type: 'wild', tick: 0, id: hostId, map: 'MAP_ROUTE117', x: spot.x, y: spot.y, key: spot.key }), 0, 6);
    expect(wild.events[0].b.seat, 'a wild one has no trainer').toBe(0);
    if (lost('wild', wild.result)) return;
    // A gym leader's, lost: the log says it ended with nobody the winner.
    const gym = await fight('gym fight', () => ({ type: 'boss', tick: 0, id: hostId, n: 0 }), 0);
    void gym;
    void late;
  } finally {
    for (const l of late) l.close();
    await room0.close();
  }
});

/** A watcher's page, every frame: the view it has up (the last it showed of each fight), and whether
 *  its ROM's battle screen ever came up. */
async function watchSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__views = { fights: {}, mirror: 0, order: [], mirrorCalls: 0, spAt: 0, logAt: 0 };
    const battle = document.getElementById('battle')!;
    const rom = w.__spike.rom, mirrorOf = rom.mirror.bind(rom);
    rom.mirror = (...a: unknown[]) => { w.__views.mirrorCalls++; return mirrorOf(...a); };
    const link = w.__spike.link, onSp = link.onSp, onLog = link.onBattleLog;
    if (onSp) link.onSp = (...a: any[]) => { w.__views.spAt ||= performance.now(); onSp(...a); };
    if (onLog) link.onBattleLog = (...a: any[]) => { w.__views.logAt ||= performance.now(); onLog(...a); };
    const frame = () => {
      requestAnimationFrame(frame);
      const s = w.__spike, on = s.watch.showing;
      if (battle.classList.contains('on')) w.__views.mirror++;
      if (!on) return;
      const key = `${on.from}:${on.f}`;
      const snap = on.view.snapshot();
      const e = w.__views.fights[key] ??= { side: on.side, firstMs: snap.ms, texts: [], lastNext: 0, events: 0, near: null, far: null, ended: false };
      if (!w.__views.order.includes(key)) w.__views.order.push(key);
      e.lastNext = snap.next;
      e.events = on.events.length;
      e.near = snap.near ?? e.near;
      e.far = snap.far ?? e.far;
      e.ended = e.ended || snap.ended;
      e.lastMs = snap.ms;
      if (snap.text && e.texts.at(-1) !== snap.text) e.texts.push(snap.text);
    };
    requestAnimationFrame(frame);
  });
}

/** The view's last word on a fight, against the fighter's ROM. `near` is the side followed. */
function expectViewEndsOnRom(view: any, oracle: Awaited<ReturnType<typeof takeOracle>>, near: 0 | 1, what: string): void {
  const hpOf = (side: number) => { const slot = oracle.field[side].at(-1)!; return oracle.hp[side][slot]; };
  // What was out last on each side: a mon that fainted goes off the view at its faint, and its bar
  // stood at what the ROM's did until then.
  const was = (v: any, side: number) => {
    if (hpOf(side) === 0) return; // fainted: the log's 0, and the view shows it sink
    expect(v?.hp, `${what}: the view's bar for side ${side}`).toBe(hpOf(side));
  };
  was(view.near, near);
  was(view.far, near === 0 ? 1 : 0);
}

test("a trainer's real fight on a second page: its view, no ROM replay, and it ends on the fighter's ROM's HP", async ({ browser }) => {
  test.setTimeout(900_000);
  const room0 = await bootRoom(browser);
  const { r, host, guest, hostId } = room0;
  try {
    await giveTeam(host, TEAM);
    await spike(guest, (s) => s.goOut('out'));
    await expect.poll(() => spike(guest, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
    await guest.evaluate((id) => (window as any).__spike.watch.host.setFollow(id), hostId);
    await watchSampler(guest);
    await guest.waitForTimeout(500);
    const bots = r.room().actors.filter((a: any) => a.bot).map((a: any) => a.id as number);
    const room = r.room();
    Object.assign(room.actor(hostId), { battling: true, foe: bots[0] });
    Object.assign(room.actor(bots[0]), { battling: true, foe: hostId, foughtBy: hostId });
    await installOracle(host);
    await host.evaluate((ev) => (window as any).__spike.startFor(ev), { type: 'fight', tick: 0, id: hostId, foe: bots[0] } as any);
    const playing = play(host, 4);
    // Up from the fight's first event: the page's own view, in the battle screen's place.
    await expect.poll(() => guest.evaluate(() => Object.keys((window as any).__views.fights).length), { timeout: 60_000 }).toBeGreaterThan(0);
    const during = await guest.evaluate(() => ({ dim: document.getElementById('battleview-dim')!.hidden, strip: document.getElementById('watch')!.hidden }));
    expect(during, 'the view up, the strip over it').toEqual({ dim: false, strip: false });
    if (SCRATCH) await guest.screenshot({ path: path.join(SCRATCH, 'human-fight-view.png') });
    await playing;
    const oracle = await takeOracle(host);
    step(`played; the view catches up`);
    // The fight's over for the fighter; the watcher's page plays it at the log's pace.
    await expect.poll(() => guest.evaluate(() => (window as any).__spike.watch.showing === null && Object.keys((window as any).__views.fights).length > 0), { timeout: 240_000 }).toBe(true);
    const views = await guest.evaluate(() => (window as any).__views);
    const view = views.fights[views.order[0]];
    console.log(`[view of a real fight] ${JSON.stringify({ views: views.order.length, mirror: views.mirror, side: view.side, firstMs: view.firstMs, lastMs: view.lastMs, lastNext: view.lastNext, events: view.events, near: view.near, far: view.far, oracleHp: oracle.hp, oracleField: oracle.field, lines: view.texts.length })}`);
    if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'human-fight.json'), JSON.stringify({ view, oracle }, null, 1));
    expect(views.mirror, 'no ROM replay').toBe(0);
    expect(view.side, 'the trainer I watch').toBe(0);
    expect(view.lastNext, 'played to its end').toBeGreaterThanOrEqual(view.events - 1);
    expectViewEndsOnRom(view, oracle, 0, 'real fight');
    // Every line the fighter saw, in order, as the watcher's own screen read it.
    expect(view.texts.filter((t: string) => !/would like to battle/.test(t))).toEqual(oracle.lines.filter((l: string) => !/would like to battle/.test(l)).filter((l: string, i: number, a: string[]) => a[i - 1] !== l));
  } finally {
    await room0.close();
  }
});

test('a switch, then the one switched in faints: the party has the other come out, and the fight ends', async ({ browser }) => {
  test.setTimeout(420_000);
  const room0 = await bootRoom(browser);
  const { r, host, hostId } = room0;
  try {
    // Whoever is out, the page's slots are the ROM's screen's: the one out first. Read in the field's
    // order the two swapped after any switch, and the last of a team could not be sent (one repeat in
    // three of the spec above stood at this window until it gave up).
    await giveTeam(host, [
      { species: 258, name: 'MUDKIP', level: 8, moves: [33, 189], hp: 28, stats: [16, 15, 12, 12, 12], personality: 2222 },
      { species: 129, name: 'MAGIKARP', level: 3, moves: [33, 150], hp: 2, stats: [1, 1, 1, 1, 1], personality: 1111 },
    ]);
    const foe = r.room().actors.find((a: any) => a.bot && !a.battling).id as number;
    Object.assign(r.room().actor(hostId), { battling: true, foe });
    Object.assign(r.room().actor(foe), { battling: true, foe: hostId, foughtBy: hostId });
    await installOracle(host);
    await host.evaluate((ev) => (window as any).__spike.startFor(ev), { type: 'fight', tick: 0, id: hostId, foe } as any);
    const inFight = () => spike(host, (s) => !!s.battle);
    const cell = host.locator('.bm-cell').first();
    await expect(cell).toBeVisible({ timeout: 60_000 });
    // The first menu: MAGIKARP, the weak one, for MUDKIP.
    await host.keyboard.press('q');
    await expect(host.locator('.bm-slot').first()).toBeVisible();
    await host.locator('.bm-slot').nth(1).click(CLICK);
    await host.locator('.bm-m-btn').nth(2).click(CLICK);
    await expect.poll(() => spike(host, (s) => s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16)), { timeout: 30_000 }).toBe(1);
    // The window now: MAGIKARP first, marked as out; MUDKIP, who can go, second.
    await expect(cell).toBeVisible({ timeout: 60_000 });
    await host.keyboard.press('q');
    await expect(host.locator('.bm-slot').first()).toBeVisible();
    const rows = await spike(host, (s) => s.battleMenu.team.map((m: any) => ({ name: m.name, active: m.active })));
    expect(rows).toEqual([{ name: 'MAGIKARP', active: true }, { name: 'MUDKIP', active: false }]);
    await host.keyboard.press('x');
    await expect(cell).toBeVisible({ timeout: 10_000 });
    await host.locator('.bm-cell').first().click(CLICK);
    // MAGIKARP goes down: MUDKIP must be choosable, from the same window, on the first asking.
    await expect.poll(async () => { await host.keyboard.press('z'); return host.locator('.bm-m-btn, .bm-slot').first().isVisible(); }, { timeout: 90_000 }).toBe(true);
    await expect(host.locator('.bm-slot').first()).toBeVisible();
    const forced = await spike(host, (s) => s.battleMenu.team.map((m: any) => ({ name: m.name, active: m.active, hp: m.hp })));
    step(`forced: ${JSON.stringify(forced)}`);
    expect(forced.map((m: any) => m.name)).toEqual(['MAGIKARP', 'MUDKIP']);
    expect(forced[0].active).toBe(true);
    expect(forced[0].hp).toBe(0);
    await host.locator('.bm-slot').nth(1).click(CLICK);
    await expect(host.locator('.bm-m-btn').nth(2)).toHaveAttribute('aria-disabled', 'false');
    await host.locator('.bm-m-btn').nth(2).click(CLICK);
    await expect.poll(() => spike(host, (s) => s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16)), { timeout: 30_000 }).toBe(0);
    await play(host);
    expect(await inFight()).toBe(false);
    if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'switch-fight.json'), JSON.stringify({ forced, oracle: await takeOracle(host) }, null, 1));
  } finally {
    await room0.close();
  }
});

test('two real trainers walk into a real duel, a third page watches: its view ends on the ROMs', async ({ browser }) => {
  test.setTimeout(900_000);
  // No bots: one that met either of them first would have that trainer fighting it, not the other.
  const room0 = await bootRoom(browser, 0);
  const { r, host, guest, hostId, guestId, code } = room0;
  const wc = await browser.newContext();
  const third = await wc.newPage();
  try {
    // Hard hitters with little to lose: two ROMs and a third on one machine make a long fight long.
    const SHORT: Craft[] = [{ species: 258, name: 'MUDKIP', level: 20, moves: [33], hp: 14, stats: [90, 15, 12, 12, 12], personality: 2222 }];
    await giveTeam(host, SHORT);
    await giveTeam(guest, SHORT);
    await third.goto(`/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}#join=${code}`);
    await expect.poll(() => spike(third, (s) => !!s?.rom && !!s.link?.room), { timeout: 180_000 }).toBe(true);
    await expect.poll(() => spike(third, (s) => s.spectating), { timeout: 60_000 }).toBeTruthy();
    await third.evaluate((id) => (window as any).__spike.watch.host.setFollow(id), hostId);
    await watchSampler(third);
    // The room's own rule from here: two trainers who see each other fight. They fly to one street,
    // as a page's MAP would have them (a command every page hears, so nothing has to be corrected),
    // and the host walks toward the other until they meet. Standing them there on the relay's room
    // alone had the pages resync, and a page can resync past the meeting: no fight, ever (Retry #2 of
    // run 41619593068).
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
    // The link's blocks in bunches, as a slow page or a bad network hands them over: two landing
    // before the ROM read the first lost it, and the fight hung, in CI's every run and on no fast box.
    for (const p of [host, guest]) await p.evaluate(() => {
      const l = (window as any).__spike.link, receive = l.receive.bind(l);
      const held: unknown[] = [];
      l.receive = (m: { t: string }, ready: () => void) => { if (m.t === 'bt') held.push(m); else receive(m, ready); };
      setInterval(() => { for (const m of held.splice(0)) receive(m, () => undefined); }, 400);
    });
    step('they met');
    await expect.poll(() => spike(host, (s) => !!s.battle), { timeout: 60_000 }).toBe(true);
    await expect.poll(() => spike(guest, (s) => !!s.battle), { timeout: 60_000 }).toBe(true);
    await installOracle(host);
    const playing = Promise.all([play(host), play(guest)]);
    await expect.poll(() => third.evaluate(() => Object.keys((window as any).__views.fights).length), { timeout: 120_000 }).toBeGreaterThan(0);
    await playing;
    const oracle = await takeOracle(host);
    await expect.poll(() => third.evaluate(() => (window as any).__spike.watch.showing === null), { timeout: 300_000 }).toBe(true);
    const views = await third.evaluate(() => (window as any).__views);
    const view = views.fights[views.order[0]];
    console.log(`[view of a duel] ${JSON.stringify({ views: views.order.length, mirror: views.mirror, mirrorCalls: views.mirrorCalls, logAfterSp: Math.round(views.logAt - views.spAt), side: view.side, firstMs: view.firstMs, lastNext: view.lastNext, events: view.events, near: view.near, far: view.far, oracleHp: oracle.hp, oracleField: oracle.field })}`);
    if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'duel.json'), JSON.stringify({ view, oracle }, null, 1));
    expect(views.mirror, 'no ROM replay').toBe(0);
    expect(view.lastNext).toBeGreaterThanOrEqual(view.events - 1);
    expectViewEndsOnRom(view, oracle, view.side as 0 | 1, 'duel');
  } finally {
    await wc.close();
    await room0.close();
  }
});
