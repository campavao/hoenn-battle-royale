// node --test: /world, spike B's shared world, over real sockets. Two phones join one
// room, see each other, walk, and their copies of the room agree with the relay's.

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
    a.send({ t: "join", name: "alice", skin: 0 });
    const ha = await a.until((m) => m.t === "hello");
    b.send({ t: "join", name: "bob", skin: 1 });
    const hb = await b.until((m) => m.t === "hello");
    assert.notEqual(ha.id, hb.id);
    assert.ok(ha.state.actors.length >= 60, "the bots are in");
    // a hears b join in a frame's cmds
    const join = await a.until((m) => m.t === "f" && m.f.some((f) => f.cmds?.some((c) => c.c === "join" && c.id === hb.id)));
    assert.ok(join);
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
