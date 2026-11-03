#!/usr/bin/env node
// How the relay holds up under several rooms at once: the real service over real sockets, each room
// one phone and its FILL bots, for a set time. One relay serves every room, so a frame over budget
// delays them all, and the simulator takes up to 4 ms a frame in each room with a fight to run.
//
//   node tools/br/relay-load.mjs [rooms] [seats] [seconds] [--no-sim] [--safari=<secs>] [--fog=<secs>]
//
// This process is the relay; the phones are a child process of it, so reading the sockets is not
// charged to the relay's frames. Prints one line of JSON:
//   pumpMs      the relay's work a pump (every room's frames that were due): the 16.7 ms budget
//   loopDelayMs how late the event loop ran things, which is how late every room's frame goes out
//   sim         fights and what running them took
//   heapMB/rssMB at the end, and the most seen
import { fork } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const here = fileURLToPath(import.meta.url);
const relayDir = fileURLToPath(new URL('../../relay/', import.meta.url));

// ------------------------------------------------------------------ the phones (the child)
if (process.argv[2] === '--phones') {
  const { default: WebSocket } = await import(new URL('../../relay/node_modules/ws/wrapper.mjs', import.meta.url));
  const [port, rooms, seats, safari, fog, hash] = process.argv.slice(3);
  const opened = [];
  for (let n = 0; n < Number(rooms); n++) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/world`);
    opened.push(ws);
    let seq = 0, set = false, go = false;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: `load${n}`, skin: 0, host: true, w: hash })));
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.t === 'room' && !set) {
        set = true;
        ws.send(JSON.stringify({ t: 'set', set: { bots: true, max: Number(seats), safariSecs: Number(safari), fogSecs: Number(fog) } }));
      }
      if (m.t === 'room' && set && !go && m.set.max === Number(seats)) { go = true; ws.send(JSON.stringify({ t: 'start' })); }
      if (m.t === 'hello') {
        // Out at the drop, watching a bot: the bots play on, as for a player who caught nothing. A
        // page's keys go up a frame at a time (net.ts).
        setTimeout(() => {
          if (ws.readyState !== 1) return;
          ws.send(JSON.stringify({ t: 'out' }));
          ws.send(JSON.stringify({ t: 'watch', id: 1 }));
        }, Number(safari) * 1000 + 2000);
        setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'in', s: ++seq, k: [0] })); }, 16);
      }
    });
    ws.on('error', (e) => console.error(`phone ${n}: ${e.message}`));
    await new Promise((ok) => setTimeout(ok, 20));
  }
  process.on('message', () => process.exit(0));
} else {
  // ---------------------------------------------------------------- the relay (this process)
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const [rooms = 5, seats = 8, secs = 180] = args.filter((a) => !a.startsWith('--')).map(Number);
  const flag = (n, d) => { const f = flags.find((x) => x.startsWith(`--${n}=`)); return f ? Number(f.split('=')[1]) : d; };
  const safari = flag('safari', 0), fog = flag('fog', 120);
  const sim = !flags.includes('--no-sim');
  process.env.WORLD_SIM_BOTS = sim ? '1' : '0';
  process.env.BR_WORLD_PER_IP = '100';
  const { createWorld } = await import(`file://${relayDir.replace(/\\/g, '/')}world.js`);
  const { WORLD_HASH } = await import(`file://${relayDir.replace(/\\/g, '/')}world/service.js`);
  const lines = [];
  const world = createWorld({ log: (l) => { if (/stopped on|dropped|not loaded/.test(l)) lines.push(l); } });
  const server = http.createServer((_, res) => res.end('ok'));
  server.on('upgrade', (req, socket, head) => world.handle(req, socket, head, '127.0.0.1'));
  await new Promise((ok) => server.listen(0, ok));
  const port = server.address().port;
  const phones = fork(here, ['--phones', String(port), String(rooms), String(seats), String(safari), String(fog), WORLD_HASH]);

  const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100 : 0; };
  const stat = (xs) => ({ n: xs.length, p50: pct(xs, 0.5), p99: pct(xs, 0.99), p999: pct(xs, 0.999), max: Math.round(Math.max(0, ...xs) * 10) / 10 });
  const pumps = [], simCosts = [], frameCosts = [];
  let fights = 0, answered = 0, maxGoing = 0, peakHeap = 0, peakRss = 0, sent = 0;
  const tapped = new WeakSet();
  while (!world.service) await new Promise((ok) => setTimeout(ok, 10));
  const svc = world.service;
  const pump = svc.pump.bind(svc);
  // The service's own timer calls this.pump, so this one is what runs. A pump that did nothing
  // (its frames not yet due) is not a frame: only the ones that stepped a room count.
  svc.pump = () => {
    let before = 0;
    for (const r of svc.rooms.values()) before += r.host?.room.tick ?? 0;
    const t = performance.now();
    pump();
    const d = performance.now() - t;
    let after = 0;
    for (const r of svc.rooms.values()) {
      after += r.host?.room.tick ?? 0;
      const h = r.host;
      if (h && !tapped.has(h)) {
        tapped.add(h);
        const run = h.simRun.bind(h);
        h.simRun = (f) => { const s = performance.now(); run(f); simCosts.push(performance.now() - s); };
        h.__born = [performance.now(), h.room.tick];
        const seen = new Set();
        const log = h.onLog;
        h.onLog = (seat, l) => {
          const a = h.room.actor(seat);
          const key = a ? `${Math.min(seat, a.foe)}:${Math.max(seat, a.foe)}:${a.since}` : '';
          if (a && !seen.has(key)) { seen.add(key); fights++; sent += JSON.stringify(l).length; }
          log(seat, l);
        };
        const apply = h.room.apply.bind(h.room);
        h.room.apply = (c) => { if (c.c === 'bots') answered++; return apply(c); };
      }
    }
    if (after !== before) frameCosts.push(d);
    pumps.push(d);
  };
  const delay = monitorEventLoopDelay({ resolution: 1 });
  const watch = setInterval(() => {
    const m = process.memoryUsage();
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakRss = Math.max(peakRss, m.rss);
    let going = 0;
    for (const r of svc.rooms.values()) going += (r.host?.room.actors ?? []).filter((a) => a.bot && a.battling && a.judge).length / 2;
    maxGoing = Math.max(maxGoing, going);
  }, 500);
  await new Promise((ok) => setTimeout(ok, Math.min(secs * 1000, 5000)));
  delay.enable();
  const heapAtStart = process.memoryUsage().heapUsed;
  await new Promise((ok) => setTimeout(ok, Math.max(0, secs * 1000 - 5000)));
  delay.disable();
  clearInterval(watch);
  const m = process.memoryUsage();
  const live = [...svc.rooms.values()].filter((r) => r.host);
  const behind = live.map((r) => (performance.now() - r.host.__born[0]) * 0.06 - (r.host.room.tick - r.host.__born[1]));
  const report = {
    rooms, seats, secs, sim, safari, fog,
    roomsRunning: live.length,
    botsAtEnd: live.reduce((n, r) => n + r.host.room.actors.filter((a) => a.bot).length, 0),
    roomsFinishedOrStopped: rooms - live.length,
    // Frames a room is short of the clock by the end: frames the relay could not run in time.
    framesBehindMax: behind.length ? Math.round(Math.max(...behind)) : 0,
    frameMs: stat(frameCosts),
    framesOver8: frameCosts.filter((d) => d > 8).length,
    framesOver16: frameCosts.filter((d) => d > 16.7).length,
    loopDelayMs: { p50: Math.round(delay.percentile(50) / 1e4) / 100, p99: Math.round(delay.percentile(99) / 1e4) / 100, p999: Math.round(delay.percentile(99.9) / 1e4) / 100, max: Math.round(delay.max / 1e4) / 100 },
    simTurnMs: stat(simCosts),
    fights, answered, maxGoing,
    meanLogKB: fights ? Math.round(sent / fights / 102.4) / 10 : 0,
    heapMB: { start: Math.round(heapAtStart / 1048576), end: Math.round(m.heapUsed / 1048576), peak: Math.round(peakHeap / 1048576) },
    rssMB: { end: Math.round(m.rss / 1048576), peak: Math.round(peakRss / 1048576) },
    trouble: lines.slice(0, 5),
  };
  console.log(JSON.stringify(report));
  phones.send('end');
  world.close();
  server.close();
  setTimeout(() => process.exit(0), 200);
}
