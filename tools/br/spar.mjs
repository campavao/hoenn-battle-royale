#!/usr/bin/env node
// A second player for when there is nobody else to play with: a real page, with a real ROM, in
// a browser of its own, in the room with you. It comes to you and fights you, over the relay, the
// way another trainer would: a link battle between two ROMs, its moves picked at random.
//
//   node tools/br/spar.mjs --rom <your Emerald .gba>            hosts: prints the room's code to join
//   node tools/br/spar.mjs --rom <your Emerald .gba> ABC123     joins your room
//   --url <site>  (default the live site)   --headed  to see it   --minutes <n>  (default 30)
//
// Not quite a player: it gets to you by the MAP's fly command wherever you are, and it is given a
// full team (rom.fillParty) when it has none. It is named E2E, so the play log leaves it out.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../../web/package.json'))('@playwright/test');

const RETAIL = 'f3ae088181bf583e55daf962a92bb46f4f1d07b7';
const KEY = { 1: 'ArrowDown', 2: 'ArrowUp', 3: 'ArrowLeft', 4: 'ArrowRight' };

function args(argv) {
  const o = { url: 'https://hoenn-battle-royale.vercel.app', rom: resolve(here, '../../pokeemerald_pret.gba'), headed: false, minutes: 30, code: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') o.url = argv[++i];
    else if (argv[i] === '--rom') o.rom = argv[++i];
    else if (argv[i] === '--minutes') o.minutes = Number(argv[++i]);
    else if (argv[i] === '--headed') o.headed = true;
    else o.code = argv[i].toUpperCase();
  }
  return o;
}

const o = args(process.argv.slice(2));
const tag = o.code ? 'spar' : 'spar host';
const say = (msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${tag}: ${msg}`);

if (createHash('sha1').update(readFileSync(o.rom)).digest('hex') !== RETAIL) {
  console.error(`${o.rom} is not Pokemon Emerald (U), sha1 ${RETAIL}`);
  process.exit(2);
}

const browser = await chromium.launch({ headless: !o.headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(() => { try { localStorage.setItem('hbr:name', 'E2E'); } catch { /* a blocked store */ } });
const page = await context.newPage();
page.on('pageerror', (e) => say(`page error: ${e.message}`));

const hasRom = () => page.evaluate(() => !!window.__spike?.rom);
const inMatch = () => page.evaluate(() => { const s = window.__spike; return !!s?.rom && !!s.link?.room?.actor?.(s.link.me); });

/** Presses a room option until its label reads `want` (each press steps it once). */
async function setOption(id, want) {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 8 && (await b.textContent())?.trim() !== want; i++) { await b.click(); await page.waitForTimeout(400); }
}

/** One step of the walk to the nearest cell beside `target`, over the room's own steps: its first
 *  direction, or null when it is right there or there is no way. */
const nextStep = () => page.evaluate(() => {
  const s = window.__spike, room = s.link.room, a = s.link.mine() ?? room.actor(s.link.me);
  const foe = room.actors.find((o) => !o.bot && o.id !== s.link.me);
  if (!foe || foe.m.spot.map !== a.m.spot.map) return null;
  const k = (p) => `${p.map}:${p.x}:${p.y}`, step = room.stepFor(a);
  const near = (p) => Math.abs(p.x - foe.m.spot.x) + Math.abs(p.y - foe.m.spot.y) <= 1;
  if (near(a.m.spot)) return null;
  const from = new Map([[k(a.m.spot), null]]), q = [a.m.spot];
  for (let i = 0; i < q.length && i < 6000; i++) {
    const p = q[i];
    if (near(p)) {
      let c = k(p), first = 0;
      while (from.get(c)) { first = from.get(c)[1]; c = from.get(c)[0]; }
      return first;
    }
    for (const d of [1, 2, 3, 4]) {
      const r = step(p, d);
      if (!r || r.warp || r.water || from.has(k(r.to))) continue;
      from.set(k(r.to), [k(p), d]);
      q.push(r.to);
    }
  }
  return null;
});

/** To a cell a few steps from the other trainer, when they are on another map. */
const flyOver = () => page.evaluate(() => {
  const s = window.__spike, room = s.link.room, a = room.actor(s.link.me);
  const foe = room.actors.find((o) => !o.bot && o.id !== s.link.me);
  if (!foe || foe.battling || foe.m.spot.map === a.m.spot.map) return false;
  const k = (p) => `${p.map}:${p.x}:${p.y}`, step = room.stepFor(foe);
  const seen = new Set([k(foe.m.spot)]), q = [[foe.m.spot, 0]];
  for (let i = 0; i < q.length && i < 400; i++) {
    const [p, n] = q[i];
    if (n === 3) { s.link.fly(p.map, p.x, p.y); return `${p.map} ${p.x},${p.y}`; }
    for (const d of [1, 2, 3, 4]) {
      const r = step(p, d);
      if (!r || r.warp || r.water || seen.has(k(r.to))) continue;
      seen.add(k(r.to));
      q.push([r.to, n + 1]);
    }
  }
  return false;
});

const spot = () => page.evaluate(() => { const p = window.__spike.link.mine()?.m.spot; return p ? `${p.map}:${p.x}:${p.y}` : ''; });
const inBattle = () => page.evaluate(() => !!window.__spike.battle);

/** One step, one press: the key comes up the moment the page's own trainer has left the cell. */
async function walk(d) {
  const was = await spot();
  await page.keyboard.down(KEY[d]);
  for (let i = 0; i < 30; i++) {
    if ((await spot()) !== was || (await inBattle())) break;
    await page.waitForTimeout(30);
  }
  await page.keyboard.up(KEY[d]);
}

/** One look at the battle windows: a move, a send-out, or A through the text. */
async function battleTurn() {
  const CLICK = { timeout: 1500 };
  if (await page.locator('.bm-m-btn').first().isVisible().catch(() => false)) {
    const send = page.locator('.bm-m-btn').nth(2);
    if ((await send.getAttribute('aria-disabled').catch(() => null)) === 'true') await page.locator('.bm-m-btn').first().click(CLICK).catch(() => undefined);
    else await send.click(CLICK).catch(() => undefined);
  } else if (await page.locator('.bm-cell').first().isVisible().catch(() => false)) {
    const cells = page.locator('.bm-cell'), n = await cells.count();
    await cells.nth(Math.floor(Math.random() * n)).click(CLICK).catch(() => undefined);
  } else if (await page.locator('.bm-slot').first().isVisible().catch(() => false)) {
    const slots = page.locator('.bm-slot'), n = await slots.count();
    for (let k = 0; k < n; k++) {
      const at = slots.nth(k);
      if ((await at.isVisible()) && (await at.getAttribute('aria-disabled')) !== 'true') { await at.click(CLICK).catch(() => undefined); break; }
    }
  } else {
    await page.keyboard.press('z');
  }
  await page.waitForTimeout(400);
}

try {
  await page.goto(`${o.url}/${o.code ? `#join=${o.code}` : '#host'}`);
  await page.waitForFunction(() => document.getElementById('rom-input'), undefined, { timeout: 60_000 });
  await page.setInputFiles('#rom-input', o.rom);
  say('ROM in; waiting for the game');
  const deadline = Date.now() + o.minutes * 60_000;

  if (!o.code) {
    const code = page.locator('#room-code');
    await code.waitFor({ timeout: 180_000 });
    await setOption('room-fill', 'FILL OFF');
    await setOption('room-safari', 'NO SAFARI');
    await setOption('room-fog', 'FOG 180s');
    const text = (await code.textContent())?.trim() ?? '';
    say(`${text}: join at ${o.url}/#join=${text.split(' ').pop()}`);
    for (;;) {
      if (Date.now() > deadline) throw new Error('nobody joined');
      if ((await page.locator('#room-roster li').count()) >= 2 && (await page.locator('#room-start').isEnabled())) break;
      await page.waitForTimeout(500);
    }
    say('somebody is in; starting');
    await page.locator('#room-start').click();
  }

  while (!(await inMatch())) {
    if (Date.now() > deadline) throw new Error('the match never started');
    await page.waitForTimeout(500);
  }
  say(`in the match, ROM ${await hasRom()}`);

  let flyAt = 0, fights = 0, was = false, teamed = false, outAt = 0;
  while (Date.now() < deadline) {
    if (await page.locator('#results-panel').isVisible().catch(() => false)) {
      say(`results up after ${fights} fight${fights === 1 ? '' : 's'}`);
      break;
    }
    const now = await inBattle();
    if (now !== was) {
      if (now) { fights++; say(`fight ${fights}: ${await page.evaluate(() => { const b = window.__spike.battle; return b?.foe ? `${b.foe.name}${b.foe.bot ? ' (bot)' : ' (trainer)'}` : 'wild'; })}`); }
      else say(`fight ${fights} over, ${await page.evaluate(() => { const a = window.__spike.link.room.actor(window.__spike.link.me); return a ? 'still in' : 'out'; })}`);
      was = now;
    }
    if (now) { await battleTurn(); continue; }
    const state = await page.evaluate(() => {
      const s = window.__spike, a = s.link.room.actor(s.link.me);
      return { out: !a || s.isOut, safari: !!s.link.room.ring().safari, party: s.rom.partyCount(), other: s.link.room.actors.some((o) => !o.bot && o.id !== s.link.me) };
    });
    // Out, with the results not up in two minutes: gone, or an open page keeps the relay's `world` from 0.
    if (state.out) {
      if (!outAt) { outAt = Date.now(); say('out of the match'); }
      if (Date.now() - outAt > 120_000) { say('out, no results up: leaving'); break; }
      await page.waitForTimeout(2000);
      continue;
    }
    if (!teamed && !state.party && !state.safari) {
      await page.evaluate(() => window.__spike.rom.fillParty());
      teamed = true;
      say('team given');
      continue;
    }
    if (state.safari || !state.other) { await page.waitForTimeout(500); continue; }
    if (Date.now() - flyAt > 5000) {
      const flew = await flyOver();
      if (flew) { flyAt = Date.now(); say(`flew to ${flew}`); await page.waitForTimeout(1000); continue; }
    }
    const d = await nextStep();
    if (d) await walk(d);
    else {
      // Right beside them, or nowhere to go: A, and a look round.
      await page.keyboard.press('z');
      await page.waitForTimeout(400);
    }
  }
} catch (e) {
  say(`stopped: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
