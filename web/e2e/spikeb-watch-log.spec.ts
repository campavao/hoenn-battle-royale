// The whole road of a watched bot fight, as every relay now has it: the relay's simulator fights it,
// its log goes down the wire, and a trainer who is out sees it drawn by their page in the battle
// screen's place, from its start or from wherever it stood when they came.
//
// The first test is cut to a few minutes on every PR: a hosted room on the real relay code, 8 seats, no
// Safari and a long fog so the teams stay one or two strong, its bots stood together two by two so
// fights overlap and none of them waits for a meeting, and a cap on a fight's turns (the real
// simulator, the real log, judged on HP at the cap). HBR_SIM_SOAK=1 runs the standard flow instead,
// nothing staged: FILL on, default Safari and fog, to a champion, and says what it took.
//
// $HBR_E2E_SCRATCH, if set: a progress line per step, screenshots, and the numbers as JSON.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath } from './symbols';

test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
// A trace of minutes of polling takes as long to close as the fights took to play (4.5 min after the
// standard match, a minute after the short one). The numbers below say what a run did; a failure's
// page can be had with $HBR_E2E_SCRATCH.
test.use({ trace: 'off' });

/* eslint-disable @typescript-eslint/no-explicit-any */
const spike = <T>(page: Page, f: (s: any) => T) => page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as any).__spike), f.toString()) as Promise<T>;

const PORT = Number(process.env.HBR_E2E_PORT || 7820) + 4;
const WORLD = `ws://localhost:${PORT}/world`;
const SCRATCH = process.env.HBR_E2E_SCRATCH || '';
const step = (msg: string) => { if (SCRATCH) fs.appendFileSync(path.join(SCRATCH, 'progress.txt'), `${new Date().toISOString().slice(11, 19)} ${msg}\n`); };
/** A fight's turns at most on the short match: under a minute of log, and the match stays minutes. */
const FIGHT_TURNS = 6;
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10 : 0; };

async function setOption(page: Page, id: string, want: string): Promise<void> {
  const b = page.locator(`#${id}`);
  for (let i = 0; i < 12 && (await b.textContent())?.trim() !== want; i++) {
    const was = await b.textContent();
    await b.click();
    await expect(b).not.toHaveText(was ?? '', { timeout: 10_000 });
  }
  await expect(b).toHaveText(want);
}

/** The relay's own code, served here: as a deploy runs it, or with WORLD_SIM_BOTS=0. */
async function relay(env: { WORLD_SIM_BOTS?: string } = {}) {
  delete process.env.WORLD_BOTS;
  delete process.env.WORLD_SIM_BOTS;
  Object.assign(process.env, env);
  const { createWorld } = (await import('../../relay/world.js' as string)) as any;
  const world = createWorld({ log: () => undefined });
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise<void>((ok) => server.listen(PORT, ok));
  return {
    match: () => [...(world.service as any).rooms.values()][0],
    // Not listening first, and every socket gone after: server.close waits on each one it took, and
    // a page still open reconnects at once.
    close: async () => {
      delete process.env.WORLD_SIM_BOTS;
      const closed = new Promise((ok) => server.close(ok));
      world.close();
      for (const s of sockets) s.destroy();
      await closed;
    },
  };
}

/** Everything the relay did with its fights: every log the simulator gave, every answer the room
 *  took, what a frame costs, who the fights' two bots were and how many were at it at once. */
function tap(hosted: any, turnCap?: number) {
  const out = { fights: [] as any[], answers: [] as any[], costs: [] as number[], maxPairs: 0, pairsAt: [] as number[] };
  const logs = new Map<string, any>();
  const onLog = hosted.onLog;
  hosted.onLog = (seat: number, log: any[]) => {
    onLog(seat, log);
    const a = hosted.room.actor(seat);
    const key = `${Math.min(seat, a.foe)}:${Math.max(seat, a.foe)}:${a.since}`;
    if (logs.has(key)) return;
    const f = { key, since: a.since, at: hosted.room.tick, log, judge: a.judge, fog: !!hosted.room.inFog(a.m.spot), phase: hosted.room.ring().phase };
    logs.set(key, f);
    out.fights.push(f);
  };
  const apply = hosted.room.apply.bind(hosted.room);
  hosted.room.apply = (c: any) => {
    const a = c.c === 'bots' ? hosted.room.actor(c.a) : null;
    const since = a?.since;
    apply(c);
    if (c.c === 'bots') out.answers.push({ key: `${Math.min(c.a, c.b)}:${Math.max(c.a, c.b)}:${since}`, id: c.id, winner: c.winner, at: hosted.room.tick, loserGone: c.winner ? !hosted.room.actor(c.winner === c.a ? c.b : c.a) : null, winnerFree: c.winner ? hosted.room.actor(c.winner)?.battling === false : null });
  };
  const advance = hosted.advance.bind(hosted);
  hosted.advance = () => {
    const t = performance.now();
    const res = advance();
    out.costs.push(performance.now() - t);
    const pairs = hosted.room.actors.filter((x: any) => x.bot && x.battling && x.judge).length / 2;
    if (pairs > out.maxPairs) out.maxPairs = pairs;
    return res;
  };
  if (turnCap) void hosted.simReady().then(() => { const sim = hosted.simulation; hosted.simulation = (a: any, b: any, o: any) => sim(a, b, { ...o, turnCap }); });
  return out;
}

/** Two free bots side by side, the way round `i` says: the room's own rule has them meet. A cell can
 *  be a wall, so a pair that has not met is stood again another way round. */
function standTogether(a: any, b: any, i: number): void {
  const [dx, dy, fa, fb] = ([[1, 0, 4, 3], [-1, 0, 3, 4], [0, 1, 1, 2], [0, -1, 2, 1]] as const)[i % 4];
  b.m = { ...b.m, spot: { map: a.m.spot.map, x: a.m.spot.x + dx, y: a.m.spot.y + dy }, facing: fb, moveDir: fb, action: null, px: 0, py: 0 };
  a.m = { ...a.m, facing: fa, moveDir: fa, action: null, px: 0, py: 0 };
  a.calm = b.calm = 0;
}

/** Every frame of the page: how long it took, and what a fight in a view looked like. */
async function sampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (w.__watchlog) return;
    const o: any = { dts: [], viewDts: [], sessions: {}, order: [], mirrorCalls: 0, screens: [], long: [], maxPairs: 0, song: [] };
    w.__watchlog = o;
    const rom = w.__spike.rom, mirror = rom.mirror.bind(rom);
    rom.mirror = (...a: unknown[]) => { o.mirrorCalls++; return mirror(...a); };
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) o.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
    } catch { /* not this browser */ }
    const battle = document.getElementById('battle')!;
    let last = performance.now();
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const dt = now - last;
      last = now;
      if (document.hidden) return;
      o.dts.push(dt);
      const s = w.__spike;
      if (!s?.watch || !s.link?.room) return;
      const on = s.watch.showing;
      if (on) o.viewDts.push(dt);
      const pairs = s.link.room.actors.filter((a: any) => a.bot && a.battling).length / 2;
      if (pairs > o.maxPairs) o.maxPairs = pairs;
      // Any ROM screen up while out: its frames, and who had won by then (a parade comes after).
      if (battle.classList.contains('on') && s.isOut) {
        const k = o.screens.at(-1);
        if (k && now - k.last < 100) { k.frames++; k.last = now; } else o.screens.push({ frames: 1, last: now, winner: s.link.room.results.winner, tick: s.link.room.tick });
      }
      if (!on) { o.current = null; return; }
      const key = `${on.from}:${on.f}`;
      const snap = on.view.snapshot();
      let e = o.sessions[key];
      if (!e) {
        e = o.sessions[key] = { key, from: on.from, f: on.f, side: on.side, firstMs: snap.ms, lastMs: 0, lastNext: 0, events: on.events.length, texts: [], mirror: 0, opens: 0, ended: false, stats: null };
        o.order.push(key);
      }
      if (o.current !== key) { e.opens++; o.current = key; }
      e.lastMs = snap.ms;
      e.lastNext = snap.next;
      e.events = on.events.length;
      e.last = { near: snap.near, far: snap.far };
      e.ended = e.ended || snap.ended;
      if (snap.text && e.texts.at(-1) !== snap.text) e.texts.push(snap.text);
      if (battle.classList.contains('on')) e.mirror++;
      e.stats = on.view.stats();
    };
    requestAnimationFrame(frame);
  });
}

/** Hold the camera on a fighter: NEXT, as a thumb would, until the one watched is in a fight. */
async function toAFight(page: Page, tries = 12): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const at = await spike(page, (s) => {
      if (!s.isOut && !s.waiting) return 'in';
      if (s.watch.showing) return 'viewing';
      const fighters = s.link.room.actors.filter((a: any) => a.battling && a.bot).map((a: any) => a.name);
      const on = (document.getElementById('watch-who')!.textContent ?? '').replace('WATCHING ', '');
      if (!fighters.length) return 'none';
      return fighters.includes(on) ? 'on' : 'next';
    });
    if (at !== 'next') return;
    await page.locator('#watch-next').click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(60);
  }
}

/** A fight's numbers off the relay's tap, on what the page saw. */
function reportOf(t: ReturnType<typeof tap>, got: any, errors: string[]) {
  const answered = new Map(t.answers.map((a) => [a.key, a]));
  const held = t.fights.map((f) => { const a = answered.get(f.key); const total = f.log.reduce((n: number, e: any) => n + eventMsOf(e), 0); return a ? { logFrames: Math.ceil(total / 1000 * 60), heldFrames: a.at - f.since, firstAnswered: f.at - f.since } : null; }).filter(Boolean) as any[];
  return {
    fights: t.fights.length,
    answers: t.answers.length,
    judges: [...new Set(t.answers.map((a) => a.id))],
    allHost: t.answers.every((a) => a.id === -1),
    winnersAgree: t.fights.filter((f) => { const a = answered.get(f.key); return a && (f.log.at(-1).winner === a.winner); }).length,
    loserGone: t.answers.filter((a) => a.loserGone === true).length,
    noWinner: t.answers.filter((a) => !a.winner).length,
    heldMaxOff: held.length ? Math.max(...held.map((h) => Math.abs(h.heldFrames - h.logFrames))) : null,
    workedOutFrames: held.length ? { p50: pct(held.map((h) => h.firstAnswered), 0.5), max: Math.max(...held.map((h) => h.firstAnswered)) } : null,
    logEvents: { p50: pct(t.fights.map((f) => f.log.length), 0.5), max: Math.max(0, ...t.fights.map((f) => f.log.length)) },
    logBytes: Math.max(0, ...t.fights.map((f) => JSON.stringify(f.log).length)),
    logSecs: { p50: pct(held.map((h) => h.logFrames / 60), 0.5), p90: pct(held.map((h) => h.logFrames / 60), 0.9), max: Math.max(0, ...held.map((h) => h.logFrames / 60)) },
    overlapOnRelay: t.maxPairs,
    overlapOnPage: got.maxPairs,
    relayFrameMs: { p50: pct(t.costs, 0.5), p99: pct(t.costs, 0.99), max: Math.round(Math.max(0, ...t.costs) * 10) / 10, over8: t.costs.filter((c) => c > 8).length, n: t.costs.length },
    views: got.sessions.length,
    fromStart: got.sessions.filter((e: any) => e.firstMs < 1000).length,
    midWay: got.sessions.filter((e: any) => e.firstMs >= 1000).length,
    endedProperly: got.sessions.filter((e: any) => e.ended || e.lastNext >= e.events - 1).length,
    leftEarly: got.sessions.filter((e: any) => !(e.ended || e.lastNext >= e.events - 1)).map((e: any) => `${e.key}@${Math.round(e.lastMs)}/${e.lastNext}/${e.events}`),
    mirrorFramesInViews: got.sessions.reduce((n: number, e: any) => n + e.mirror, 0),
    mirrorCalls: got.mirrorCalls,
    romScreens: got.screens.map((k: any) => ({ frames: k.frames, winner: k.winner, tick: k.tick })),
    fogSeenInViews: got.sessions.flatMap((e: any) => e.texts).filter((x: string) => /is hurt by the fog!/.test(x)).length,
    frameMs: { n: got.dts.length, p50: pct(got.dts, 0.5), p95: pct(got.dts, 0.95), p99: pct(got.dts, 0.99), over50: got.dts.filter((d: number) => d > 50).length },
    frameMsInViews: { n: got.viewDts.length, p50: pct(got.viewDts, 0.5), p95: pct(got.viewDts, 0.95), p99: pct(got.viewDts, 0.99), over50: got.viewDts.filter((d: number) => d > 50).length },
    longTasks: { n: got.long.length, max: Math.max(0, ...got.long), over100: got.long.filter((d: number) => d > 100).length },
    errors,
  };
}

const pageNumbers = (p: Page) => p.evaluate(() => { const o = (window as any).__watchlog; return { ...o, sessions: Object.values(o.sessions) }; });
const songOf = (page: Page, music: number, player: number) => page.evaluate(([m, pl]) => { const e = (window as any).__spike.rom.emu; return { waiting: e.read(m + 8, 8), header: e.read(pl, 32) >>> 0, volume: e.m.getVolume() }; }, [music, player]);

test('a watched bot fight, start to champion: drawn by the page, from one log, on the real relay', async ({ browser }) => {
  test.setTimeout(540_000);
  const t0 = Date.now();
  const r = await relay();
  const errors: string[] = [];
  const hc = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hc.newPage();
  host.on('pageerror', (e) => { errors.push(`host: ${e.message}`); step(`host pageerror ${e.message}`); });
  const url = `/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}`;
  let lateContext: Awaited<ReturnType<Browser['newContext']>> | null = null;
  try {
    step('start');
    await host.goto(`${url}#host`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 120_000 });
    await setOption(host, 'room-safari', 'NO SAFARI');
    await setOption(host, 'room-fog', 'FOG 180s');
    await expect(host.locator('#room-start')).toBeEnabled({ timeout: 30_000 });
    await host.locator('#room-start').click();
    await expect.poll(() => !!r.match()?.host, { timeout: 30_000 }).toBe(true);
    const hosted = r.match().host;
    const seen = tap(hosted, FIGHT_TURNS);
    await expect.poll(() => spike(host, (s) => !!s.rom && !!s.link?.room?.actor(s.link.me)), { timeout: 180_000 }).toBe(true);
    await sampler(host);
    step('match on');

    // Out of it, watching (spikeb.spec.ts has the way a player gets there, out at the drop).
    await spike(host, (s) => s.goOut('out'));
    await expect.poll(() => spike(host, (s) => s.isOut && s.spectating), { timeout: 30_000 }).toBeTruthy();
    step('out: watching');

    // A second page, a phone, comes in once a fight is well under way, without holding this one up.
    let late: Page | null = null;
    let lateAsked = 0;
    const lateSeen: any[] = [];
    const synced: any[] = [];
    let shots = 0;
    let moved: any = null;
    const sym = loadSymbols();
    const rom = fs.readFileSync(romPath());
    const header = (id: number) => rom.readUInt32LE(sym.gSongTable - 0x08000000 + 8 * id);
    const heard: any[] = [];
    let round = 0, stoodAt = 0, turnOf = 0;

    const until = Date.now() + 360_000;
    while (Date.now() < until && !(await host.locator('#results-panel').isVisible().catch(() => false))) {
      // Every free bot stood with another, the first time all at once: fights overlap. After the first,
      // once the late joiner has had a fight to come in on, and the camera on one of them first: that
      // one is watched from its first moment. A pair that has not met is stood again another way round.
      const free = hosted.room.actors.filter((a: any) => a.bot && !a.battling && !a.meet);
      const lateDue = !round || late || (lateAsked && Date.now() - lateAsked > 120_000);
      if (free.length >= 2 && lateDue && Date.now() - stoodAt > 500) {
        stoodAt = Date.now();
        round++;
        step(`stood ${free.length} free`);
        if (round > 1) await host.evaluate((id) => (window as any).__spike.watch.host.setFollow(id), free[0].id);
        for (let i = 0; i + 1 < free.length; i += 2) standTogether(free[i], free[i + 1], turnOf++);
      }

      await toAFight(host);
      const on = await spike(host, (s) => {
        const v = s.watch.showing;
        if (!v) return null;
        const a = s.link.room.actor(v.from);
        return { from: v.from, f: v.f, side: v.side, ms: v.view.snapshot().ms, next: v.view.snapshot().next, tick: s.link.room.tick, since: a?.since ?? 0 };
      });
      if (on) {
        // The sound: the battle's song on the hidden ROM's BGM player. Asked for every frame a view
        // is up and it can be a while coming, so any moment of the match will do, not the first 40
        // looks: that is what failed run 41669116464's first try (0 of 40, then 6 of 40 on the retry).
        if (on.ms > 1000 && heard.filter((h) => h.fight).length < 3) {
          const e = await songOf(host, sym.gBrMusic, sym.gMPlayInfo_BGM);
          heard.push({ ...e, fight: e.header === header(476), ms: Math.round(on.ms) });
        }
        // Where the fight stands against the room's clock.
        synced.push(Math.abs(on.ms - (on.tick - on.since) * (1000 / 60)));
        if (!shots && on.ms > 5000 && SCRATCH) {
          shots = 1;
          await host.screenshot({ path: path.join(SCRATCH, 'bot-fight-1280x720.png') });
          step('shot 1280x720');
        }
        // PREV and NEXT work in a fight, and PREV comes back to where it stands by then.
        if (!moved && on.ms > 4000) {
          step(`NEXT in fight ${on.from}:${on.f}`);
          const t = Date.now();
          await host.locator('#watch-next').click({ timeout: 2000 });
          await host.waitForTimeout(250);
          const after = await spike(host, (s) => ({ who: document.getElementById('watch-who')!.textContent, dim: document.getElementById('battleview-dim')!.hidden, v: s.watch.showing ? `${s.watch.showing.from}:${s.watch.showing.f}` : null }));
          await host.locator('#watch-prev').click({ timeout: 2000 });
          await expect.poll(() => spike(host, (s) => !!s.watch.showing), { timeout: 3000 }).toBe(true);
          const back = await spike(host, (s) => { const v = s.watch.showing; return { key: `${v.from}:${v.f}`, ms: v.view.snapshot().ms, side: v.side }; });
          moved = { before: on, after, back, gone: Date.now() - t };
          step(`moved ${JSON.stringify(moved)}`);
        }
        // The phone comes in, a page of its own booting off to one side.
        if (!lateAsked && on.ms > 6000) {
          lateAsked = Date.now();
          step('the late joiner comes in');
          void (async () => {
            lateContext = await browser.newContext({ ...devices['Pixel 7'] });
            const p = await lateContext.newPage();
            p.on('pageerror', (e) => { errors.push(`late: ${e.message}`); step(`late pageerror ${e.message}`); });
            await p.goto(`${url}${new URL(host.url()).hash}`);
            await expect.poll(() => spike(p, (s) => !!s?.rom && !!s.link?.room), { timeout: 180_000 }).toBe(true);
            await sampler(p);
            late = p;
            step('the late joiner is up');
          })().catch((e) => step(`the late joiner did not come: ${e}`));
        }
        if (late) {
          const l = await spike(late, (s) => { const v = s.watch.showing; return v ? { key: `${v.from}:${v.f}`, ms: v.view.snapshot().ms, side: v.side, next: v.view.snapshot().next } : null; });
          const h = await spike(host, (s) => { const v = s.watch.showing; return v ? { key: `${v.from}:${v.f}`, ms: v.view.snapshot().ms, next: v.view.snapshot().next } : null; });
          if (l && h) {
            if (l.key === h.key) lateSeen.push({ key: l.key, diff: Math.abs(l.ms - h.ms), ms: l.ms });
            if (shots === 1 && l.ms > 3000 && SCRATCH) {
              shots = 2;
              await (late as Page).screenshot({ path: path.join(SCRATCH, 'bot-fight-phone.png') });
              step('shot phone');
            }
          }
          await toAFight(late, 6);
        }
      }
      await host.waitForTimeout(250);
    }

    await expect(host.locator('#results-panel')).toBeVisible({ timeout: 10_000 });
    step('results');
    const got = await pageNumbers(host);
    const lateGot = late ? await pageNumbers(late) : null;
    const status = await spike(host, (s) => s.link.status()).catch(() => '');
    const chunks = await host.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /battlesim|engine\/gen3|simbrain/.test(n)));

    const report = {
      ...reportOf(seen, got, errors),
      secs: Math.round((Date.now() - t0) / 1000),
      stood: round,
      moved,
      late: lateGot ? { views: lateGot.sessions.length, midWay: lateGot.sessions.filter((e: any) => e.firstMs >= 1000).length, firstMs: lateGot.sessions[0]?.firstMs, compared: lateSeen.length, maxDiff: Math.round(Math.max(0, ...lateSeen.map((x) => x.diff))), p50Diff: pct(lateSeen.map((x) => x.diff), 0.5), frameMs: { n: lateGot.dts.length, p50: pct(lateGot.dts, 0.5), p95: pct(lateGot.dts, 0.95), p99: pct(lateGot.dts, 0.99), over50: lateGot.dts.filter((d: number) => d > 50).length }, mirrorCalls: lateGot.mirrorCalls, romScreens: lateGot.screens.length } : null,
      heard: { n: heard.length, fightSong: heard.filter((h) => h.fight).length, firstAtMs: heard.find((h) => h.fight)?.ms, looksBefore: heard.findIndex((h) => h.fight), waiting: heard.filter((h) => h.waiting).length, volume: heard.at(-1)?.volume },
      syncedToRoomMs: { p50: pct(synced, 0.5), p95: pct(synced, 0.95), max: Math.round(Math.max(0, ...synced)) },
      chunks,
      sample: got.sessions.slice(0, 2).map((e: any) => ({ key: e.key, side: e.side, firstMs: Math.round(e.firstMs), texts: e.texts.slice(0, 8) })),
      status,
    };
    console.log(JSON.stringify(report, null, 1));
    if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'watch-log-match.json'), JSON.stringify(report, null, 1));

    expect(errors, 'no page errors').toEqual([]);
    expect(report.allHost, 'every fight the host\'s').toBe(true);
    expect(report.fights).toBeGreaterThan(2);
    expect(report.answers).toBeGreaterThanOrEqual(report.fights);
    expect(report.winnersAgree, 'the room took the log\'s winner').toBe(report.fights);
    expect(report.overlapOnPage, 'fights at once').toBeGreaterThan(1);
    expect(report.views, 'watched some').toBeGreaterThan(1);
    expect(report.mirrorFramesInViews, 'no ROM mirror under a view').toBe(0);
    expect(report.mirrorCalls, 'no ROM mirror at all').toBe(0);
    expect(report.romScreens.filter((k: any) => !k.winner), 'no ROM screen until the champion\'s parade').toEqual([]);
    expect(report.heard.fightSong, 'the battle song under a view').toBeGreaterThan(0);
    expect(report.fromStart, 'one watched from its first moment').toBeGreaterThan(0);
    expect(report.chunks, 'the simulator is not on the page').toEqual([]);
    expect(report.moved?.after.v ?? report.moved?.after.dim, 'NEXT left the fight').toBeTruthy();
    expect(report.moved?.back.ms, 'PREV: where it stands by then').toBeGreaterThan(report.moved?.before.ms + 200);
    expect(report.late, 'a late joiner came').toBeTruthy();
  } finally {
    step('closing');
    await (lateContext as Awaited<ReturnType<Browser['newContext']>> | null)?.close().catch(() => undefined);
    step('late page closed');
    await hc.close();
    step('host page closed');
    await r.close();
    step('relay closed');
  }
});

// The standard flow, once, by hand (it is a whole match, 10 to 25 minutes): HBR_SIM_SOAK=1.
test('the standard match: FILL on, default Safari and fog, to a champion, one page', async ({ browser }) => {
  test.skip(!process.env.HBR_SIM_SOAK, 'a whole match: HBR_SIM_SOAK=1 runs it');
  test.setTimeout(2_400_000);
  const r = await relay();
  const errors: string[] = [];
  const hc = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hc.newPage();
  host.on('pageerror', (e) => { errors.push(`host: ${e.message}`); step(`host pageerror ${e.message}`); });
  try {
    step('start');
    await host.goto(`/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}#host`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 120_000 });
    await expect(host.locator('#room-start')).toBeEnabled({ timeout: 30_000 });
    const settings = { fog: await host.locator('#room-fog').textContent(), safari: await host.locator('#room-safari').textContent(), max: await host.locator('#room-max').textContent(), fill: await host.locator('#room-fill').textContent() };
    step(`settings ${JSON.stringify(settings)}`);
    await host.locator('#room-start').click();
    const t0 = Date.now();
    await expect.poll(() => !!r.match()?.host, { timeout: 30_000 }).toBe(true);
    const hosted = r.match().host;
    const seen = tap(hosted);
    await expect.poll(() => spike(host, (s) => !!s.rom && !!s.link?.room?.actor(s.link.me)), { timeout: 180_000 }).toBe(true);
    await sampler(host);
    step('match on');
    await expect.poll(() => spike(host, (s) => s.isOut), { timeout: 400_000 }).toBe(true);
    step('out: watching');
    const sym = loadSymbols();
    const rom = fs.readFileSync(romPath());
    const song = rom.readUInt32LE(sym.gSongTable - 0x08000000 + 8 * 476);
    const heard: any[] = [];
    let last = 0, twoAt = 0, oneAt = 0;
    while (Date.now() - t0 < 2_200_000 && !(await host.locator('#results-panel').isVisible().catch(() => false))) {
      await toAFight(host);
      const on = await spike(host, (s) => { const v = s.watch.showing; return v ? v.view.snapshot().ms : 0; });
      if (on > 1000) { const e = await songOf(host, sym.gBrMusic, sym.gMPlayInfo_BGM); heard.push(e.header === song); }
      const res = hosted.room.results;
      const left = res.entrants.length - res.fallen.length;
      if (left === 2 && !twoAt) { twoAt = hosted.room.tick; step(`last two at ${Math.round(twoAt / 60)} s`); }
      if (res.winner && !oneAt) { oneAt = hosted.room.tick; step(`champion at ${Math.round(oneAt / 60)} s`); }
      if (Date.now() - last > 60_000) { last = Date.now(); step(`${Math.round((Date.now() - t0) / 1000)} s: tick ${hosted.room.tick}, phase ${hosted.room.ring().phase}, ${left} left, ${seen.fights.length} fights, ${hosted.room.actors.filter((a: any) => a.bot && a.battling).length / 2} going`); }
      await host.waitForTimeout(500);
    }
    await expect(host.locator('#results-panel')).toBeVisible({ timeout: 10_000 });
    step('results');
    const got = await pageNumbers(host);
    const res = hosted.room.results;
    const fightLines = seen.fights.map((f) => ({ fog: f.fog, lines: f.log.filter((e: any) => e.e === 'text' && /is hurt by the fog!/.test(e.text)).length, secs: Math.round(f.log.reduce((n: number, e: any) => n + eventMsOf(e), 0) / 1000), phase: f.phase }));
    const report = {
      settings,
      matchSecs: Math.round((oneAt || hosted.room.tick) / 60),
      wallSecs: Math.round((Date.now() - t0) / 1000),
      lastTwoSecs: twoAt && oneAt ? Math.round((oneAt - twoAt) / 60) : null,
      entrants: res.entrants.length,
      fallen: res.fallen.map((f: any) => ({ name: f.name, by: f.by, bot: !!f.bot, secs: Math.round(f.at / 60) })),
      botsTakenByFog: res.fallen.filter((f: any) => f.bot && !f.by).length,
      botsTakenInFights: res.fallen.filter((f: any) => f.bot && f.by).length,
      winner: res.winner,
      phaseAtEnd: hosted.room.ring().phase,
      fightsBegunInFog: fightLines.filter((f) => f.fog).length,
      foggedFightsWithLines: fightLines.filter((f) => f.fog && f.lines).length,
      clearFightsWithLines: fightLines.filter((f) => !f.fog && f.lines).length,
      fightSecs: fightLines.map((f) => f.secs),
      fightPhases: fightLines.map((f) => f.phase),
      heard: { n: heard.length, fightSong: heard.filter(Boolean).length },
      ...reportOf(seen, got, errors),
    };
    console.log(JSON.stringify(report, null, 1));
    if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'standard-match.json'), JSON.stringify(report, null, 1));
    expect(errors, 'no page errors').toEqual([]);
    expect(report.allHost, 'every fight the host\'s').toBe(true);
    expect(report.winnersAgree, 'the room took the log\'s winner').toBe(report.fights);
    expect(report.mirrorCalls, 'no ROM mirror at all').toBe(0);
    expect(report.clearFightsWithLines, 'no fog in a fight begun clear of it').toBe(0);
    expect(res.winner, 'a champion').toBeTruthy();
  } finally {
    await hc.close();
    await r.close();
  }
});

// The way back: WORLD_SIM_BOTS=0 on Railway, no code change. A meeting goes to a trainer's page, on its
// hidden ROM, one at a time; watched, it replays on the watcher's ROM. All of that stays until the
// page's judge path is taken out.
test('the switch off (WORLD_SIM_BOTS=0): a trainer\'s page fights the bots on its hidden ROM, and its ROM shows it', async ({ browser }) => {
  test.setTimeout(420_000);
  const r = await relay({ WORLD_SIM_BOTS: '0' });
  const errors: string[] = [];
  const hc = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hc.newPage();
  host.on('pageerror', (e) => errors.push(e.message));
  try {
    await host.goto(`/?rom=${romHashParam()}&world=${encodeURIComponent(WORLD)}#host`);
    await expect(host.locator('#room-code')).toHaveText(/Room [A-Z0-9]{6}/, { timeout: 120_000 });
    await setOption(host, 'room-safari', 'SAFARI 60s');
    await setOption(host, 'room-fog', 'FOG 180s');
    await setOption(host, 'room-max', 'MAX 4');
    await expect(host.locator('#room-start')).toBeEnabled({ timeout: 30_000 });
    await host.locator('#room-start').click();
    await expect.poll(() => spike(host, (s) => !!s.rom && !!s.link?.room?.actor(s.link.me)), { timeout: 180_000 }).toBe(true);
    await sampler(host);
    const hosted = r.match().host;
    expect(hosted.room.simBots, 'the switch').toBe(false);
    const seen = tap(hosted);
    await expect.poll(() => spike(host, (s) => s.isOut), { timeout: 180_000 }).toBe(true);
    const me = await spike(host, (s) => s.link.me);

    // Two bots stood together on the relay's room, and the watcher follows one of them. The page hears
    // of the meeting by its hash, as a state and not as the event its own copy of the room would have
    // made of it, so the event is handed to it here: everything after that is the page's own.
    const until = Date.now() + 240_000;
    let turn = 0, handed = false;
    while (Date.now() < until && !seen.answers.length) {
      const room = hosted.room;
      const going = room.actors.find((x: any) => x.bot && x.battling);
      if (!going) {
        const free = room.actors.filter((x: any) => x.bot && !x.battling && !x.meet);
        if (free.length >= 2 && room.tick >= room.duelAfter) {
          await host.evaluate((id) => (window as any).__spike.watch.host.setFollow(id), free[0].id);
          standTogether(free[0], free[1], turn++);
        }
      } else if (!handed && (await spike(host, (s) => s.link.room.actors.filter((x: any) => x.bot && x.battling).length)) === 2) {
        handed = true;
        await host.evaluate(({ me, a, b }) => (window as any).__spike.startFor({ type: 'bots', tick: 0, id: me, a, b }), { me, a: going.id, b: going.foe });
        step(`handed ${going.id} v ${going.foe}`);
      }
      await host.waitForTimeout(250);
    }
    const a = seen.answers[0];
    const got = await pageNumbers(host);
    console.log(JSON.stringify({ answers: seen.answers, mirrorCalls: got.mirrorCalls, screens: got.screens.length, views: got.sessions.length }));
    expect(errors).toEqual([]);
    expect(a, 'the page answered').toBeTruthy();
    expect(a.id, 'the page, not the host').toBe(me);
    expect(a.winner, 'a real fight has a winner').toBeGreaterThan(0);
    expect(a.loserGone, 'and the loser is out').toBe(true);
    expect(got.mirrorCalls, 'watched on the ROM').toBeGreaterThan(0);
    expect(got.sessions.length, 'no log to draw').toBe(0);
  } finally {
    await hc.close();
    await r.close();
  }
});

/** battlelog.ts eventMs, here so the sum needs no page. */
function eventMsOf(e: any): number {
  const HOLD: Record<string, number> = { start: 2000, send: 1200, back: 700, text: 1400, hit: 500, hp: 900, status: 300, faint: 1000, end: 1500 };
  return e.e === 'text' ? Math.max(1400, 500 + e.text.length * 30) : HOLD[e.e];
}

test('a page alone: the trainer who is out watches its bots, fog and all', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/?rom=${romHashParam()}#solo&safari=0&fog=30&seed=${11}`);
  await page.locator('#intro-go').click({ timeout: 120_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 180_000 });
  await sampler(page);
  await spike(page, (s) => s.goOut('out'));
  await expect.poll(() => spike(page, (s) => s.spectating), { timeout: 30_000 }).toBeTruthy();
  let fog = 0;
  const until = Date.now() + 300_000;
  while (Date.now() < until && !(await page.locator('#win').evaluate((e) => e.classList.contains('on')).catch(() => false))) {
    // Two bots in the fog stood side by side, once the fog has reached any: the room's own rule has
    // them fight from there, and the camera goes with them.
    await spike(page, (s) => {
      const r = s.link.room, w = window as any;
      if (r.actor(w.__fogFight)?.battling) return;
      const free = r.actors.filter((a: any) => a.bot && !a.battling && !a.m.action && r.inFog(a.m.spot));
      if (free.length < 2) return;
      const [a, b] = free;
      const [dx, dy, fa, fb] = ([[1, 0, 4, 3], [-1, 0, 3, 4], [0, 1, 1, 2], [0, -1, 2, 1]] as const)[Math.floor(performance.now() / 300) % 4];
      b.m = { ...b.m, spot: { map: a.m.spot.map, x: a.m.spot.x + dx, y: a.m.spot.y + dy }, facing: fb, moveDir: fb };
      a.m = { ...a.m, facing: fa, moveDir: fa };
      a.calm = b.calm = 0;
      w.__fogFight = a.id;
      s.watch.host.setFollow(a.id);
    });
    fog = await page.evaluate(() => Object.values((window as any).__watchlog.sessions).flatMap((e: any) => e.texts).filter((t: any) => /is hurt by the fog!/.test(t)).length);
    if (fog >= 1) break;
    await page.waitForTimeout(300);
  }
  const got = await page.evaluate(() => { const o = (window as any).__watchlog; return { sessions: Object.values(o.sessions) as any[], mirror: o.mirrorCalls, maxPairs: o.maxPairs }; });
  const line = got.sessions.flatMap((e: any) => e.texts).find((t: string) => /is hurt by the fog!/.test(t));
  console.log(JSON.stringify({ views: got.sessions.length, fog, line, mirror: got.mirror, maxPairs: got.maxPairs, first: got.sessions[0]?.texts.slice(0, 8) }));
  if (SCRATCH) await page.screenshot({ path: path.join(SCRATCH, 'solo-view.png') });
  expect(errors).toEqual([]);
  expect(got.sessions.length, 'a view in a solo world').toBeGreaterThan(0);
  expect(got.mirror).toBe(0);
  expect(fog, 'a fight in the fog says so').toBeGreaterThan(0);
});

test("a watched fight's song is the ROM's own, and the route's comes back", async ({ page }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const rom = fs.readFileSync(romPath());
  const header = (id: number) => rom.readUInt32LE(sym.gSongTable - 0x08000000 + 8 * id);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  const engine = () => page.evaluate(([music, player]) => {
    const e = (window as any).__spike.rom.emu;
    return { asked: e.read(music, 8), playing: e.read(music + 6, 16), waiting: e.read(music + 8, 8), sound: e.read(music + 10, 16), header: e.read(player, 32) >>> 0, status: e.read(player + 4, 32) >>> 0 };
  }, [sym.gBrMusic, sym.gMPlayInfo_BGM]);
  await expect.poll(async () => (await engine()).playing, { timeout: 15_000 }).toBeGreaterThan(0);
  const route = (await engine()).playing;
  expect((await engine()).header, 'the route song').toBe(header(route));
  // Asked every frame, as watch.ts does while a view is up.
  await page.evaluate(() => { const w = window as any; w.__asking = setInterval(() => w.__spike.rom.fightSong(true), 16); });
  await expect.poll(async () => { const e = await engine(); return { fight: e.header === header(476), waiting: e.waiting, sound: e.sound }; }, { timeout: 5_000 }).toMatchObject({ fight: true, waiting: 1, sound: 0 });
  // Past the fanfare that held it up (160 frames), and over the sounds of a fight.
  await page.waitForTimeout(4000);
  await page.evaluate(() => (window as any).__spike.rom.sound(13));
  await page.waitForTimeout(1000);
  let e = await engine();
  expect(e.header, 'it stays').toBe(header(476));
  expect(e.status & 0x80000000, 'playing').toBe(0);
  expect(await page.evaluate(() => (window as any).__spike.rom.emu.m.getVolume()), 'heard').toBe(1);
  await page.evaluate(() => { const w = window as any; clearInterval(w.__asking); w.__spike.rom.fightSong(false); });
  await expect.poll(async () => (await engine()).header, { timeout: 5_000 }).toBe(header(route));
  e = await engine();
  expect(e.waiting).toBe(0);
  expect(e.playing).toBe(route);
});

test("a fight's song isn't lost to a sound that lands while it starts (CI, 11-03: the route's played on)", async ({ page }) => {
  test.setTimeout(180_000);
  const sym = loadSymbols();
  const rom = fs.readFileSync(romPath());
  const header = (id: number) => rom.readUInt32LE(sym.gSongTable - 0x08000000 + 8 * id);
  await page.goto(`/?rom=${romHashParam()}#solo&nobots&safari=600&seed=7`);
  await page.locator('#intro-go').click({ timeout: 90_000 });
  await page.waitForFunction(() => { const s = (window as any).__spike; return !!s?.rom && !!s.link?.room.actor(s.link.me); }, undefined, { timeout: 120_000 });
  const engine = () => page.evaluate(([music, player]) => {
    const e = (window as any).__spike.rom.emu;
    return { playing: e.read(music + 6, 16), waiting: e.read(music + 8, 8), header: e.read(player, 32) >>> 0 };
  }, [sym.gBrMusic, sym.gMPlayInfo_BGM]);
  await expect.poll(async () => (await engine()).playing, { timeout: 15_000 }).toBeGreaterThan(0);
  // As watch.ts on the frames a fight opens: the song asked for, then a send-out's sound after it.
  await page.evaluate(() => {
    const w = window as any;
    let n = 0;
    w.__asking = setInterval(() => { w.__spike.rom.fightSong(true); if (n++ < 8) w.__spike.rom.sound(13); }, 16);
  });
  await page.waitForTimeout(6000);
  const e = await engine();
  expect(e.waiting, 'held').toBe(1);
  expect(e.header, 'the battle\'s song, not the route\'s').toBe(header(476));
  expect(await page.evaluate(() => (window as any).__spike.rom.emu.m.getVolume()), 'heard').toBe(1);
  await page.evaluate(() => clearInterval((window as any).__asking));
});