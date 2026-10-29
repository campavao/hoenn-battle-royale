// node --test: /world, spike B's shared world, over real sockets. Phones meet in a room
// (HOST, a code, QUICK PLAY), the host starts it, and they see each other, walk, and
// their copies of the match agree with the relay's.

import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./server.js";

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
    send: (m) => ws.send(JSON.stringify(m)),
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
    assert.ok(ha.state.actors.length >= 60, "the bots are in");
    // The first frame puts them both at the truck and locks the match to everybody in it.
    const first = await a.until((m) => m.t === "f");
    const cmds = first.f[0].cmds ?? [];
    assert.deepEqual(cmds.filter((c) => c.c === "join").map((c) => c.id), [ha.id, hb.id]);
    assert.equal(cmds.at(-1).c, "lock");
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
    a.ws.close(); b.ws.close();
  } finally {
    await relay.close();
  }
});

test("/world: a link block goes to the trainer you are fighting, and nobody else", async () => {
  const relay = createRelay({});
  const { port } = await relay.listen(0, "127.0.0.1");
  try {
    const [a, b, c] = [phone(port), phone(port), phone(port)];
    await Promise.all([a.open(), b.open(), c.open()]);
    const ids = [];
    let code = "";
    for (const [p, name] of [[a, "alice"], [b, "bob"], [c, "cara"]]) {
      p.send({ t: "join", name, skin: 0, ...(code ? { code } : { host: true }) });
      const r = await p.until((m) => m.t === "room");
      code = r.code;
      ids.push(r.you);
    }
    a.send({ t: "start" });
    for (const p of [a, b, c]) await p.until((m) => m.t === "hello");
    // Not fighting anybody: dropped.
    a.send({ t: "bt", q: 1, d: [1, 2, 3] });
    // By the truck alice (10,10), bob (11,10) and cara (9,10) stand in a row facing south.
    // Past the join grace, alice turns east and sees bob.
    await new Promise((r) => setTimeout(r, 5200));
    // (a trainer moves on its phone's inputs, one a frame: the turn, then standing)
    a.send({ t: "in", s: 1, k: [8, ...Array(30).fill(0)] });
    // ...once the turn has played out and the relay's room has them fighting.
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 1100));
      a.send({ t: "sync" });
      const st = (await a.until((m) => m.t === "state")).state;
      const me = st.actors.find((x) => x.id === ids[0]);
      if (me.battling) { assert.equal(me.foe, ids[1]); break; }
      assert.ok(i < 5, "alice never engaged");
    }
    a.send({ t: "bt", q: 1, d: [9, 8, 7, 300] });
    const got = await b.until((m) => m.t === "bt");
    assert.deepEqual(got, { t: "bt", q: 1, d: [9, 8, 7, 300 & 0xff] });
    // bob's answer reaches alice; nothing reached cara, and the early block went nowhere
    b.send({ t: "bt", q: 1, d: [5] });
    assert.deepEqual(await a.until((m) => m.t === "bt"), { t: "bt", q: 1, d: [5] });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(c.inbox.filter((m) => m.t === "bt").length, 0);
    assert.equal(b.inbox.filter((m) => m.t === "bt").length, 0);
    // A block too big is refused.
    a.send({ t: "bt", q: 2, d: Array(2000).fill(0) });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(b.inbox.filter((m) => m.t === "bt").length, 0);
    for (const p of [a, b, c]) p.ws.close();
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
