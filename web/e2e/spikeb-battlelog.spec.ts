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
async function relay() {
  process.env.WORLD_BOTS = '3';
  const { createWorld } = (await import('../../relay/world.js' as string)) as any;
  const { WORLD_HASH } = (await import('../../relay/world/service.js' as string)) as any;
  const world = createWorld({ log: () => undefined });
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  await new Promise<void>((ok) => server.listen(PORT, ok));
  return {
    hash: WORLD_HASH as string,
    room: () => [...(world.service as any).rooms.values()][0].host.room as any,
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
const NOT_A_LINE = /^(PP|-|\d+\/\d+|[A-Z]+[♀♂]?|(NORMAL|FIGHT|FLYING|POISON|GROUND|ROCK|BUG|GHOST|STEEL|FIRE|WATER|GRASS|ELECTR|PSYCHC|ICE|DRAGON|DARK)\b[ ./\d]*)$/;
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
  for (let i = 0; i < 400; i++) {
    if (!(await spike(page, (s) => !!s.battle))) return;
    if (i % 20 === 3) step(`play ${i}: ${JSON.stringify(await spike(page, (s) => ({ menu: s.battleMenu?.isShown, lead: s.rom.emu.read(s.art.sym('gBattlerPartyIndexes'), 16) })))} cells ${await page.locator('.bm-cell').count()} slots ${await page.locator('.bm-slot').count()}`);
    if (await page.locator('.bm-m-btn').first().isVisible().catch(() => false)) {
      // A member's panel (BACK, SUMMARY, SEND OUT): a forced switch after a faint lands here.
      await page.locator('.bm-m-btn').nth(2).click(CLICK).catch(() => undefined);
    } else if (await page.locator('.bm-cell').first().isVisible().catch(() => false)) {
      if (switchAt && ++turns === switchAt) {
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
      for (let k = (await slots.count()) - 1; k >= 0; k--) {
        if ((await slots.nth(k).getAttribute('aria-disabled')) !== 'true') { await slots.nth(k).click(CLICK).catch(() => undefined); break; }
      }
    } else {
      await page.keyboard.press('z');
    }
    await page.waitForTimeout(400);
  }
  throw new Error('the fight did not end');
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
async function bootRoom(browser: Browser) {
  const r = await relay();
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

    // The watcher's page takes the log as a view would: every call, in order.
    await guest.evaluate(([id]) => {
      const w = window as any;
      w.__got = [];
      w.__spike.link.onBattleLog = (from: number, f: number, events: unknown[], ago?: number) => w.__got.push({ from, f, events, ago });
      w.__spike.link.watch(id);
    }, [hostId]);
    const bots = r.room().actors.filter((a: any) => a.bot).map((a: any) => a.id as number);

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
      const oracle = await takeOracle(host);
      const result = await spike(host, (s) => s.lastResult as string);
      const stats = await spike(host, (s) => s.rom.logStats());
      console.log(`[${what}] ${result}; ${events.length} events in ${got.length} messages; reader ${stats.frames} frames, ${(stats.ms / stats.frames * 1000).toFixed(1)} us each, worst ${stats.maxMs.toFixed(2)} ms`);
      console.log(`[${what}] ` + events.map((e: any) => (e.e === 'text' ? `"${e.text}"` : e.e === 'start' ? 'start' : `${e.e}${e.side ?? ''}${e.slot ?? e.hp ?? e.winner ?? ''}`)).join(' '));
      if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, `${what.replace(/\W+/g, '-')}.json`), JSON.stringify({ events, oracle, got }, null, 1));
      const state = await expectLogMatchesRom(host, events, oracle, what);
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
    const botFight = await fight('bot fight', (foe) => ({ type: 'fight', tick: 0, id: hostId, foe }), bots[0], 8, 4);
    expect(botFight.events.filter((e) => e.e === 'send').length, 'a send-out beyond the first two').toBeGreaterThan(2);
    expect(botFight.events.some((e) => e.e === 'faint')).toBe(true);
    expect(botFight.events.some((e) => e.e === 'hit') && botFight.events.some((e) => e.e === 'hp')).toBe(true);

    // A wild POKeMON, off a marked spot of Route 117.
    const spot = await spike(host, (s) => { const q = s.link.room.patchesOn('MAP_ROUTE117')[0]; return { x: q.x, y: q.y, key: q.key }; });
    const wild = await fight('wild fight', () => ({ type: 'wild', tick: 0, id: hostId, map: 'MAP_ROUTE117', x: spot.x, y: spot.y, key: spot.key }), 0, 6);
    expect(wild.events[0].b.seat, 'a wild one has no trainer').toBe(0);
    // A gym leader's, lost: the log says it ended with nobody the winner.
    const gym = await fight('gym fight', () => ({ type: 'boss', tick: 0, id: hostId, n: 0 }), 0);
    void gym;
    void late;
  } finally {
    for (const l of late) l.close();
    await room0.close();
  }
});
