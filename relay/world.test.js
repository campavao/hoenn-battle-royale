// node --test: /world, spike B's shared world, over real sockets. Phones meet in a room
// (HOST, a code, QUICK PLAY), the host starts it, and they see each other, walk, and
// their copies of the match agree with the relay's.

import test from "node:test";
import assert from "node:assert/strict";
import { createRelay, exitOnSignal, stats } from "./server.js";
import { EventEmitter } from "node:events";
import { WORLD_HASH } from "./world/service.js";

function phone(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/world`);
  const inbox = [];
  let wake = null;
  ws.addEventListener("message", (ev) => { inbox.push(JSON.parse(ev.data)); wake?.(); });
  const until = async (pred, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(0, i + 1).pop();
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => { wake = r; setTimeout(r, 50); });
    }
  };
  return {
    ws, inbox, until,
    open: () => new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); }),
    // A page of this build: its joins carry the world it was built with (spike-b/net.ts).
    send: (m) => ws.send(JSON.stringify(m.t === "join" && !("w" in m) ? { ...m, w: WORLD_HASH } : m)),
  };
}

test("/world: two phones share one room at 60 Hz", async () => {
  const relay = createRelay({});
  const { port } = await relay.listen(0, "127.0.0.1");
  try {
    const a = phone(port), b = phone(port);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "join", name: "alice", skin: 0, host: true });
    const ra = await a.until((m) => m.t === "room");
    assert.equal(ra.owner, ra.you, "alice hosts");
    assert.equal(ra.quick, false);
    assert.equal(ra.startsIn, undefined, "a room of your own waits for START");
    b.send({ t: "join", name: "bob", skin: 1, code: ra.code.toLowerCase() });
    const rb = await b.until((m) => m.t === "room");
    assert.equal(rb.code, ra.code);
    assert.deepEqual(rb.members.map((m) => m.name), ["ALICE", "BOB"]);
    assert.equal((await a.until((m) => m.t === "room")).members.length, 2, "alice hears bob come in");
    // Only the host starts it.
    b.send({ t: "start" });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(b.inbox.filter((m) => m.t === "hello").length, 0);
    a.send({ t: "start" });
    const ha = await a.until((m) => m.t === "hello");
    const hb = await b.until((m) => m.t === "hello");
    assert.equal(ha.id, ra.you);
    assert.equal(hb.id, rb.you);
    // MAX 8 with FILL on, the live room's own: six bots for the seats nobody has.
    assert.equal(ha.state.actors.filter((x) => x.bot).length, 6, "the bots are in");
    // The hello is the match itself: both of them in it and locked to everybody, or a page's curtain
    // counts the bots and nobody else (Cam, 11-04: "29 TRAINERS"). No frame joins them a second time.
    for (const id of [ha.id, hb.id]) assert.ok(ha.state.actors.some((x) => x.id === id), `${id} in the hello`);
    assert.equal(ha.state.results.entrants.length, 8, "locked to all eight");
    const first = await a.until((m) => m.t === "f");
    const cmds = first.f[0].cmds ?? [];
    assert.deepEqual(cmds.filter((c) => c.c === "join" || c.c === "lock"), []);
    assert.equal((await b.until((m) => m.t === "room")).playing, true);
    // a walks: its keys come back acked
    a.send({ t: "in", s: 1, k: Array(20).fill(2) });
    const acked = await a.until((m) => m.t === "f" && m.f.some((f) => f.a >= 20));
    assert.ok(acked);
    // frames come in order with no gaps, about 60 a second (by the ticks the relay
    // stamped, over two seconds: what this process happens to read in a burst does not
    // count)
    const ticks = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      const m = await b.until((x) => x.t === "f");
      ticks.push(...m.f.map((f) => f.tick));
    }
    for (let i = 1; i < ticks.length; i++) assert.equal(ticks[i], ticks[i - 1] + 1);
    const rate = (ticks[ticks.length - 1] - ticks[0]) / ((Date.now() - t0) / 1000);
    assert.ok(rate > 45 && rate < 75, `${rate.toFixed(1)} frames a second`);
    // a hash rides along every 60 frames
    const h = await b.until((m) => m.t === "f" && m.f.some((f) => f.h !== undefined), 2000);
    assert.ok(h);
    // the whole room, at most once a second however often it is asked for
    for (let i = 0; i < 5; i++) b.send({ t: "sync" });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(b.inbox.filter((m) => m.t === "state").length, 1);
    // health counts the world's trainers
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.world, 2);
    // ...and /live tells play.html what is happening, as counts: no code, no names
    const res = await fetch(`http://127.0.0.1:${port}/live`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const live = await res.json();
    assert.equal(live.players, 2);
    assert.equal(live.peak, 2);
    assert.equal(live.rooms.length, 1);
    assert.deepEqual({ ...live.rooms[0], secs: 0 }, { quick: false, trainers: 2, playing: true, secs: 0 });
    assert.ok(!JSON.stringify(live).includes(ra.code) && !/ALICE|BOB/.test(JSON.stringify(live)));
    // the heartbeat's `matches` counts the world's
    assert.ok(stats().matches >= 1);
    assert.ok(stats().peakWorld >= 2);
    a.ws.close(); b.ws.close();
  } finally {
    await relay.close();
  }
});

test("SIGTERM drains: the match under way plays on, a new phone is turned away, and the relay exits after", async () => {
  const lines = [];
  const relay = createRelay({ log: (l) => lines.push(l) });
  const { port } = await relay.listen(0, "127.0.0.1");
  const a = phone(port), b = phone(port);
  await Promise.all([a.open(), b.open()]);
  a.send({ t: "join", name: "alice", skin: 0, host: true });
  const ra = await a.until((m) => m.t === "room");
  b.send({ t: "join", name: "bob", skin: 1, code: ra.code });
  await b.until((m) => m.t === "room");
  a.send({ t: "start" });
  await a.until((m) => m.t === "hello");

  const proc = new EventEmitter();
  const exited = new Promise((resolve) => { proc.exit = resolve; });
  exitOnSignal(relay, proc, 3000, 1500);
  proc.emit("SIGTERM");
  // Draining, and saying so: a release reads `drains` and needs no empty world.
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.drains, true);
  assert.equal(health.draining, true);
  // The match goes on: frames keep coming.
  const t0 = (await b.until((m) => m.t === "f")).f[0].tick;
  const t1 = (await b.until((m) => m.t === "f" && m.f[0].tick > t0 + 30)).f[0].tick;
  assert.ok(t1 > t0);
  // A new phone is turned away: its socket closes, and its page's reconnect finds the new relay.
  const n = phone(port);
  await n.open();
  const closed = new Promise((resolve) => n.ws.addEventListener("close", resolve, { once: true }));
  n.send({ t: "join", name: "nia", skin: 0, host: true });
  await closed;
  assert.ok(!n.inbox.some((m) => m.t === "room"));
  // At the drain's end (1.5 s here, 25 minutes live) it shuts down as before.
  assert.equal(await exited, 0);
  assert.ok(lines.some((l) => /^SIGTERM: draining, 1 match under way/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /^SIGTERM: 1 match still on at the drain's end/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /^SIGTERM: shutting down/.test(l)));
  a.ws.close(); b.ws.close();
});

test("SIGTERM with nothing under way drains at once", async () => {
  const lines = [];
  const relay = createRelay({ log: (l) => lines.push(l) });
  await relay.listen(0, "127.0.0.1");
  const proc = new EventEmitter();
  const exited = new Promise((resolve) => { proc.exit = resolve; });
  const t = Date.now();
  exitOnSignal(relay, proc, 3000, 60_000);
  proc.emit("SIGTERM");
  assert.equal(await exited, 0);
  assert.ok(Date.now() - t < 2000, "no match to wait for");
  assert.ok(lines.includes("SIGTERM: drained"), lines.join("\n"));
});

test("/live answers before anyone has opened the world", async () => {
  const relay = createRelay({});
  const { port } = await relay.listen(0, "127.0.0.1");
  try {
    const live = await (await fetch(`http://127.0.0.1:${port}/live`)).json();
    assert.equal(live.players, 0);
    assert.deepEqual(live.rooms, []);
    assert.ok(Date.parse(live.up) <= Date.parse(live.at));
  } finally {
    await relay.close();
  }
});

test("/world: a page of another world is told to reload, and nothing else", async () => {
  const relay = createRelay({});
  const { port } = await relay.listen(0, "127.0.0.1");
  try {
    const [a, b] = [phone(port), phone(port)];
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "join", name: "alice", skin: 0, host: true, w: "000000000000" });
    assert.deepEqual(await a.until((m) => m.t === "old"), { t: "old" });
    b.send({ t: "join", name: "bob", skin: 0, host: true, w: undefined });
    await b.until((m) => m.t === "old");
    assert.ok(!a.inbox.some((m) => m.t === "room") && !b.inbox.some((m) => m.t === "room"), "neither got a room");
    // The same socket, reloaded into this world, gets in.
    a.send({ t: "join", name: "alice", skin: 0, host: true });
    await a.until((m) => m.t === "room");
    for (const p of [a, b]) p.ws.close();
  } finally {
    await relay.close();
  }
});

test("/world: the relay simulates its bots' fights, unless WORLD_SIM_BOTS=0", async () => {
  try {
    for (const [env, want] of [[undefined, true], ["1", true], ["0", undefined]]) {
      if (env === undefined) delete process.env.WORLD_SIM_BOTS;
      else process.env.WORLD_SIM_BOTS = env;
      const relay = createRelay({});
      const { port } = await relay.listen(0, "127.0.0.1");
      try {
        const a = phone(port);
        await a.open();
        a.send({ t: "join", name: "alice", skin: 0, host: true });
        await a.until((m) => m.t === "room");
        a.send({ t: "start" });
        const { state } = await a.until((m) => m.t === "hello");
        assert.equal(state.simBots, want, `WORLD_SIM_BOTS=${env}`);
        a.ws.close();
      } finally {
        await relay.close();
      }
    }
  } finally {
    delete process.env.WORLD_SIM_BOTS;
  }
});

test("/world: a quick room waiting for players is posted to the Discord webhook, and comes down with its trainer", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ method: init.method, url, content: init.body && JSON.parse(init.body).content });
    return { ok: true, status: init.method === "DELETE" ? 204 : 200, json: async () => ({ id: "9" }) };
  };
  const relay = createRelay({ world: { discord: "https://discord.example/api/webhooks/1/tok", fetch } });
  const { port } = await relay.listen(0, "127.0.0.1");
  try {
    const a = phone(port);
    await a.open();
    a.send({ t: "join", name: "quinn", skin: 0 });
    const ra = await a.until((m) => m.t === "room");
    // The real service's LOBBIES list, read by world.js (`listed`, a TypeScript private).
    await relay.world.poster.tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].content.startsWith("**QUICK PLAY** has 1/30 trainers and starts <t:"), calls[0].content);
    assert.ok(calls[0].content.endsWith(`Join: <https://hoenn-battle-royale.vercel.app/#join=${ra.code}>`), calls[0].content);
    a.ws.close();
    for (let i = 0; i < 50 && relay.world.rooms().length; i++) await new Promise((r) => setTimeout(r, 50));
    await relay.world.poster.tick();
    assert.deepEqual(calls.map((c) => c.method), ["POST", "DELETE"]);
  } finally {
    await relay.close();
  }
});

test("/world: a code nobody has, and quick play's count", async () => {
  process.env.WORLD_AUTOSTART_SECS = "1";
  const relay = createRelay({});
  const { port } = await relay.listen(0, "127.0.0.1");
  try {
    const [a, b, c] = [phone(port), phone(port), phone(port)];
    await Promise.all([a.open(), b.open(), c.open()]);
    a.send({ t: "join", name: "alice", skin: 0, code: "ZZZZZZ" });
    assert.deepEqual(await a.until((m) => m.t === "no_room"), { t: "no_room", code: "ZZZZZZ" });
    // Not in a room, a phone can still pick one.
    a.send({ t: "join", name: "alice", skin: 0 });
    const ra = await a.until((m) => m.t === "room");
    assert.equal(ra.quick, true);
    assert.ok(ra.startsIn > 0 && ra.startsIn <= 1000, "a quick room counts down");
    b.send({ t: "join", name: "bob", skin: 0 });
    assert.equal((await b.until((m) => m.t === "room")).code, ra.code, "quick play fills the room that is waiting");
    // Nobody presses START: the count does.
    await a.until((m) => m.t === "hello", 3000);
    await b.until((m) => m.t === "hello");
    await new Promise((r) => setTimeout(r, 300));
    a.send({ t: "sync" });
    const sa = (await a.until((m) => m.t === "state")).state;
    assert.equal(sa.results.entrants.filter(([id]) => id >= 1000).length, 2);
    // Somebody who comes in once it is on watches it, from the bench.
    c.send({ t: "join", name: "cara", skin: 0, code: ra.code });
    const rc = await c.until((m) => m.t === "room");
    assert.equal(rc.playing, true);
    await c.until((m) => m.t === "hello");
    await new Promise((r) => setTimeout(r, 300));
    c.send({ t: "sync" });
    const sc = (await c.until((m) => m.t === "state")).state;
    assert.ok(sc.bench.some((x) => x.id === rc.you), "cara watches");
    assert.ok(!sc.results.entrants.some(([id]) => id === rc.you));
    for (const p of [a, b, c]) p.ws.close();
  } finally {
    delete process.env.WORLD_AUTOSTART_SECS;
    await relay.close();
  }
});
