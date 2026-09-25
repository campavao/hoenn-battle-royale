// node --test  (from this directory)
//
// Drives the relay over real WebSocket connections on an ephemeral port:
// host, join, roster fan-out, unicast and broadcast routing, the error
// reasons the client shows, locking, host migration, the passcode, the
// version gate, flood disconnect, the idle/unbound sweep, and /health.
//
// Ported from the Kanto relay's relay.test.js (gen1recomp-multiplayer,
// mods/battle_royale/relay/), which drove the same server over raw TCP.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRelay, clientAddress, CODE_ALPHABET, CODE_LENGTH, limitsFromEnv, stats } from "./server.js";

class Client {
  // headers: what a proxy in front of the relay would add (POK-330 #19)
  constructor(port, headers) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`, headers ? { headers } : undefined);
    this.inbox = [];
    this.waiters = [];
    this.closed = false;
    this.ws.addEventListener("message", (ev) => {
      this.push(JSON.parse(ev.data));
    });
    this.ws.addEventListener("close", () => {
      this.closed = true;
      this.push({ type: "__closed" });
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  push(msg) {
    const w = this.waiters.shift();
    if (w) w(msg); else this.inbox.push(msg);
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  // one raw text frame, not JSON -- the WebSocket equivalent of a garbage
  // line, since framing is per-message rather than newline-delimited
  raw(text) {
    this.ws.send(text);
  }

  next(timeoutMs = 2000) {
    if (this.inbox.length) return Promise.resolve(this.inbox.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
      this.waiters.push((msg) => { clearTimeout(timer); resolve(msg); });
    });
  }

  // Round-trip this connection: everything sent on it before the ping has
  // been processed by the time the pong comes back.  This is the only
  // ordering guarantee available between two clients -- the server reads one
  // connection in order, but nothing sequences one client against another.
  async settled(timeoutMs = 2000) {
    this.send({ type: "ping" });
    await this.until("pong", timeoutMs);
  }

  // skip messages until one of the given type arrives
  async until(type, timeoutMs = 2000) {
    for (;;) {
      const msg = await this.next(timeoutMs);
      if (msg.type === type) return msg;
    }
  }

  end() {
    this.ws.close();
  }
}

async function withRelay(fn, limits) {
  const relay = createRelay({ limits });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    await fn(addr.port, relay);
  } finally {
    await relay.close();
  }
}

// Every connection gets an unasked `info` push the instant it opens (so a
// client learns `minProtocol` before it sends anything). The tests below
// port straight from the TCP relay's, where no such push existed, so
// connect() swallows it here rather than every test having to know about it.
async function connect(port, headers) {
  const c = new Client(port, headers);
  await c.ready();
  const info = await c.until("info");
  c.bootInfo = info;
  return c;
}

test("the boot info push carries motd, counts and minProtocol", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    assert.equal(a.bootInfo.type, "info");
    assert.equal(a.bootInfo.minProtocol, 1);
    assert.equal(a.bootInfo.conns, 1);
    assert.equal(a.bootInfo.rooms, 0);
    a.end();
  });
});

test("host gets a code in the entry-widget alphabet and a roster of one", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "RED" });
    const hosted = await a.next();
    assert.equal(hosted.type, "room_hosted");
    assert.equal(hosted.id, 1);
    assert.equal(hosted.code.length, CODE_LENGTH);
    for (const ch of hosted.code) assert.ok(CODE_ALPHABET.includes(ch), `code char ${ch}`);
    const roster = await a.next();
    assert.equal(roster.type, "roster");
    assert.equal(roster.host, 1);
    assert.deepEqual(roster.members, [{ id: 1, name: "RED" }]);
    a.end();
  });
});

test("join by code: everyone sees the roster grow, names are cleaned", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "RED" });
    const { code } = await a.next();
    await a.next(); // roster

    const b = await connect(port);
    b.send({ type: "join_room", code: code.toLowerCase(), name: "  blue\x01toolongname " });
    const joined = await b.next();
    assert.equal(joined.type, "room_joined");
    assert.equal(joined.id, 2);
    assert.equal(joined.host, 1);
    assert.equal(joined.code, code);

    const rosterB = await b.next();
    const rosterA = await a.next();
    assert.deepEqual(rosterA, rosterB);
    assert.deepEqual(rosterA.members.map((m) => m.name), ["RED", "bluetoolon"]);
    a.end(); b.end();
  });
});

test("unicast reaches one member, broadcast reaches everyone else", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" });
    await b.next(); await b.next(); await a.next();
    const c = await connect(port);
    c.send({ type: "join_room", code, name: "C" });
    await c.next(); await c.next(); await a.next(); await b.next();

    a.send({ type: "to", id: 3, m: { t: "hi", n: 1 } });
    const got = await c.next();
    assert.deepEqual(got, { type: "recv", from: 1, m: { t: "hi", n: 1 } });

    b.send({ type: "all", m: { t: "step", d: "up" } });
    const ga = await a.next();
    const gc = await c.next();
    assert.deepEqual(ga, { type: "recv", from: 2, m: { t: "step", d: "up" } });
    assert.deepEqual(gc, ga);

    // the sender never hears its own broadcast, and a unicast to yourself
    // or to nobody is dropped rather than echoed
    b.send({ type: "to", id: 2, m: { t: "self" } });
    b.send({ type: "to", id: 99, m: { t: "nobody" } });
    b.send({ type: "ping", t: 7 });
    const pong = await b.next();
    assert.deepEqual(pong, { type: "pong", t: 7 });
    a.end(); b.end(); c.end();
  });
});

test("join errors: not_found, locked, full, already_in_room", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();

    const x = await connect(port);
    x.send({ type: "join_room", code: "ZZZZZZ", name: "X" });
    assert.deepEqual(await x.next(), { type: "room_error", reason: "not_found" });

    // lock_room is silent -- no ack, no roster -- and `a` and `x` are two
    // independent sockets, so "send the lock, then send the join" orders
    // nothing at all: on a fast machine the join is read first and the
    // assertion below fails against a server that is behaving perfectly.
    // A ping on the SAME connection as the lock is the ordering: the server
    // reads one connection's messages in order, so a pong means the lock landed.
    await a.settled();
    a.send({ type: "lock_room", locked: true });
    await a.settled();
    x.send({ type: "join_room", code, name: "X" });
    assert.deepEqual(await x.next(), { type: "room_error", reason: "locked" });
    a.send({ type: "lock_room", locked: false });
    await a.settled();

    x.send({ type: "join_room", code, name: "X" });
    assert.equal((await x.next()).type, "room_joined");
    await x.next(); await a.next();

    const y = await connect(port);
    y.send({ type: "join_room", code, name: "Y" });
    assert.deepEqual(await y.next(), { type: "room_error", reason: "full" });

    x.send({ type: "host_room", name: "X" });
    assert.deepEqual(await x.next(), { type: "room_error", reason: "already_in_room" });
    a.end(); x.end(); y.end();
  }, { members: 2 });
});

test("a guest leaving updates the roster; the host leaving closes the room", async () => {
  await withRelay(async (port, relay) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" });
    await b.next(); await b.next(); await a.next();
    const c = await connect(port);
    c.send({ type: "join_room", code, name: "C" });
    await c.next(); await c.next(); await a.next(); await b.next();

    b.end();
    const rosterA = await a.until("roster");
    assert.deepEqual(rosterA.members.map((m) => m.id), [1, 3]);
    const rosterC = await c.until("roster");
    assert.deepEqual(rosterC.members.map((m) => m.id), [1, 3]);

    a.send({ type: "leave_room" });
    const closed = await c.until("room_closed");
    assert.equal(closed.reason, "left");
    assert.equal(relay.rooms.size, 0);

    // ...and the code is gone
    c.send({ type: "join_room", code, name: "C" });
    assert.deepEqual(await c.next(), { type: "room_error", reason: "not_found" });
    a.end(); c.end();
  });
});

test("the room outlives its host when somebody can take it over", async () => {
  await withRelay(async (port, relay) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();
    const b = await connect(port);
    b.send({ type: "can_host", ok: true });
    b.send({ type: "join_room", code, name: "B" });
    await b.next(); await b.next(); await a.next();
    const c = await connect(port);
    c.send({ type: "can_host", ok: true });
    c.send({ type: "join_room", code, name: "C" });
    await c.next(); await c.next(); await a.next(); await b.next();

    // the host goes, and the room does not
    a.end();
    const roster = await b.until("roster");
    assert.equal(roster.host, 2, "the longest-standing eligible member inherits");
    assert.deepEqual(roster.members.map((m) => m.id), [2, 3]);
    assert.equal(relay.rooms.size, 1, "the room is still open");

    // and it is a working room: the new host is just a member like any other
    const rosterC = await c.until("roster");
    assert.equal(rosterC.host, 2);
    b.send({ type: "all", m: { t: "ring", phase: 2 } });
    const relayed = await c.until("recv");
    assert.equal(relayed.from, 2);
    assert.deepEqual(relayed.m, { t: "ring", phase: 2 });
    b.end(); c.end();
  });
});

test("a host can stand down without leaving the room", async () => {
  await withRelay(async (port, relay) => {
    const a = await connect(port);
    a.send({ type: "can_host", ok: true });
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();
    const b = await connect(port);
    b.send({ type: "can_host", ok: true });
    b.send({ type: "join_room", code, name: "B" });
    await b.next(); await b.next(); await a.next();

    // The host's tab went to the background: it hands the match over rather than
    // making everybody wait for a throttled timer, and stays in the room.
    a.send({ type: "can_host", ok: false });
    const roster = await a.until("roster");
    assert.equal(roster.host, 2, "the guest was promoted");
    assert.deepEqual(roster.members.map((m) => m.id), [1, 2], "the old host is still in it");
    assert.equal(relay.rooms.size, 1);

    // ...and it is an ordinary member now: what it says still reaches the room.
    a.send({ type: "all", m: { t: "ring", phase: 3 } });
    const relayed = await b.until("recv");
    assert.equal(relayed.from, 1);
    a.end(); b.end();
  });
});

test("a host with nobody to hand to keeps the room", async () => {
  await withRelay(async (port, relay) => {
    const a = await connect(port);
    a.send({ type: "can_host", ok: true });
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" }); // never says it can host
    await b.next(); await b.next(); await a.next();

    a.send({ type: "can_host", ok: false });
    // A pong proves the can_host ahead of it has landed and moved nothing.
    a.send({ type: "ping" });
    assert.equal((await a.next()).type, "pong");
    assert.equal([...relay.rooms.values()][0].host.id, 1, "it is still the host");
    a.end(); b.end();
  });
});
test("a room of clients that cannot host still closes, as it always did", async () => {
  await withRelay(async (port, relay) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();
    // b never says it can host -- an older client, or one that never learned
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" });
    await b.next(); await b.next(); await a.next();

    a.send({ type: "leave_room" });
    const closed = await b.until("room_closed");
    assert.equal(closed.reason, "left");
    assert.equal(relay.rooms.size, 0);
    a.end(); b.end();
  });
});

test("an eliminated player withdraws, and the room passes over them", async () => {
  await withRelay(async (port, relay) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    const { code } = await a.next();
    await a.next();
    const b = await connect(port);
    b.send({ type: "can_host", ok: true });
    b.send({ type: "join_room", code, name: "B" });
    await b.next(); await b.next(); await a.next();
    const c = await connect(port);
    c.send({ type: "can_host", ok: true });
    c.send({ type: "join_room", code, name: "C" });
    await c.next(); await c.next(); await a.next(); await b.next();

    // B is knocked out and stands down; C is next in line despite joining later
    // A withdrawal is broadcast to nobody, so wait on a round-trip down B's
    // own socket instead: messages from one connection are handled in order,
    // so a pong proves the can_host ahead of it has already landed.
    b.send({ type: "can_host", ok: false });
    b.send({ type: "ping" });
    await b.until("pong");
    a.end();
    const roster = await c.until("roster");
    assert.equal(roster.host, 3, "the room skips the member that stood down");
    assert.equal(relay.rooms.size, 1);
    b.end(); c.end();
  });
});

test("quick_join finds an open room, and says so when there is none", async () => {
  await withRelay(async (port) => {
    // nobody is hosting: the answer is an answer, not an error, so the
    // client can turn round and host on the same connection
    const first = await connect(port);
    first.send({ type: "quick_join", name: "ANNA" });
    assert.equal((await first.next()).type, "no_open_rooms");

    // ...which is exactly what it then does
    first.send({ type: "host_room", name: "ANNA", open: true });
    const hosted = await first.until("room_hosted");
    const firstRoster = await first.until("roster");
    assert.equal(firstRoster.open, true);

    // a stranger with no code now lands in that room
    const second = await connect(port);
    second.send({ type: "quick_join", name: "BEN" });
    const joined = await second.until("room_joined");
    assert.equal(joined.code, hosted.code);
    assert.equal(joined.host, 1);
    const roster = await second.until("roster");
    assert.deepEqual(roster.members.map((m) => m.name), ["ANNA", "BEN"]);
    first.end();
    second.end();
  });
});

test("quick_join skips private, locked and full rooms", async () => {
  await withRelay(async (port) => {
    const priv = await connect(port);
    priv.send({ type: "host_room", name: "PRIV" });   // open defaults to false
    await priv.until("room_hosted");

    const shut = await connect(port);
    shut.send({ type: "host_room", name: "SHUT", open: true });
    await shut.until("room_hosted");
    shut.send({ type: "lock_room", locked: true });

    // ...but an open room that is LOCKED is a match in progress, and since
    // POK-133 that is its own answer: the seeker is not seated, but they
    // are told where to watch.
    const seeker = await connect(port);
    seeker.send({ type: "quick_join", name: "SEEK" });
    const answer = await seeker.next();
    assert.equal(answer.type, "match_in_progress");
    assert.equal(typeof answer.code, "string");

    priv.end(); shut.end(); seeker.end();
  }, { members: 2 });
});

test("quick_join with nothing open and nothing running says no_open_rooms", async () => {
  await withRelay(async (port) => {
    const priv = await connect(port);
    priv.send({ type: "host_room", name: "PRIV" });   // private, unlocked
    await priv.until("room_hosted");
    const seeker = await connect(port);
    seeker.send({ type: "quick_join", name: "SEEK" });
    // a private lobby is not a match in progress: it is invisible, full stop
    assert.equal((await seeker.next()).type, "no_open_rooms");
    priv.end(); seeker.end();
  });
});

test("quick_join gathers strangers into the fullest room, not the first", async () => {
  await withRelay(async (port) => {
    const small = await connect(port);
    small.send({ type: "host_room", name: "SMALL", open: true });
    await small.until("room_hosted");

    const big = await connect(port);
    big.send({ type: "host_room", name: "BIG", open: true });
    const bigCode = (await big.until("room_hosted")).code;
    const mate = await connect(port);
    mate.send({ type: "join_room", code: bigCode, name: "MATE" });
    await mate.until("room_joined");

    // two rooms are open; the one with people in it wins, so a handful of
    // strangers becomes one match rather than three lonely lobbies
    const seeker = await connect(port);
    seeker.send({ type: "quick_join", name: "SEEK" });
    assert.equal((await seeker.until("room_joined")).code, bigCode);

    small.end(); big.end(); mate.end(); seeker.end();
  });
});

test("set_open is the host's alone, and tells the room", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const code = (await host.until("room_hosted")).code;
    const guest = await connect(port);
    guest.send({ type: "join_room", code, name: "GUEST" });
    await guest.until("room_joined");
    await guest.until("roster");   // the one their own arrival caused

    // a guest asking is ignored
    guest.send({ type: "set_open", open: true });
    const seeker = await connect(port);
    seeker.send({ type: "quick_join", name: "SEEK" });
    assert.equal((await seeker.next()).type, "no_open_rooms");

    // the host asking is not
    host.send({ type: "set_open", open: true });
    assert.equal((await guest.until("roster")).open, true);
    const seeker2 = await connect(port);
    seeker2.send({ type: "quick_join", name: "SEEK2" });
    assert.equal((await seeker2.until("room_joined")).code, code);

    host.end(); guest.end(); seeker.end(); seeker2.end();
  });
});

test("MAX is the room's size: the host sets it, the relay refuses past it", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true, max: 2 });
    const code = (await host.until("room_hosted")).code;
    assert.equal((await host.until("roster")).max, 2, "the roster says the size");

    const a = await connect(port);
    a.send({ type: "join_room", code, name: "A" });
    await a.until("room_joined");
    await a.until("roster");   // the one their own arrival caused
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" });
    assert.equal((await b.next()).reason, "full", "a third trainer is refused");
    // ...and quick play walks past it too
    const seeker = await connect(port);
    seeker.send({ type: "quick_join", name: "SEEK" });
    assert.equal((await seeker.next()).type, "no_open_rooms");

    // a guest cannot resize the room; the host can, live
    a.send({ type: "set_max", max: 4 });
    const c = await connect(port);
    c.send({ type: "join_room", code, name: "C" });
    assert.equal((await c.next()).reason, "full");
    host.send({ type: "set_max", max: 4 });
    assert.equal((await a.until("roster")).max, 4);
    const d = await connect(port);
    d.send({ type: "join_room", code, name: "D" });
    await d.until("room_joined");
    await a.until("roster");   // D's arrival

    // and it never exceeds the relay's own ceiling, or drops under two
    host.send({ type: "set_max", max: 999 });
    assert.equal((await a.until("roster")).max, 16);
    host.send({ type: "set_max", max: 0 });
    assert.equal((await a.until("roster")).max, 2);

    host.end(); a.end(); b.end(); c.end(); d.end(); seeker.end();
  });
});

test("the room ceiling holds, refuses cleanly, and frees up again", async () => {
  await withRelay(async (port) => {
    // concurrent rooms are what a hosted relay is billed for, so the cap has
    // to be real and has to fail in a way the client can explain
    const a = await connect(port);
    a.send({ type: "host_room", name: "ONE" });
    await a.until("room_hosted");
    const b = await connect(port);
    b.send({ type: "host_room", name: "TWO" });
    await b.until("room_hosted");

    const third = await connect(port);
    third.send({ type: "host_room", name: "THREE" });
    const refused = await third.until("room_error");
    assert.equal(refused.reason, "server_full");

    // quick play must not squeeze past the ceiling by another door
    const quick = await connect(port);
    quick.send({ type: "quick_join", name: "QUICK" });
    assert.equal((await quick.next()).type, "no_open_rooms");

    // ...and a room closing gives the slot back
    a.end();
    await new Promise((r) => setTimeout(r, 50));
    const fourth = await connect(port);
    fourth.send({ type: "host_room", name: "FOUR" });
    assert.equal((await fourth.until("room_hosted")).code.length, CODE_LENGTH);

    b.end(); third.end(); quick.end(); fourth.end();
  }, { rooms: 2 });
});

test("traffic accounting counts what it actually wrote", async () => {
  await withRelay(async (port) => {
    const before = stats();
    const a = await connect(port);
    a.send({ type: "host_room", name: "RED" });
    await a.until("roster");
    const after = stats();
    assert.ok(after.bytesOut > before.bytesOut, "bytes out went up");
    assert.ok(after.linesOut > before.linesOut, "lines out went up");
    assert.ok(after.roomsOpened > before.roomsOpened, "a room was counted");
    a.end();
  });
});

test("garbage frames are dropped, a flood of them disconnects", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.raw("not json");
    a.raw("[1,2]");
    a.raw("{\"noType\":1}");
    a.send({ type: "ping" });
    assert.equal((await a.next()).type, "pong");
    for (let i = 0; i < 30; i++) a.raw("garbage");
    const closed = await a.until("__closed");
    assert.equal(closed.type, "__closed");
  }, { badLines: 5 });
});

test("a host's line budget is deeper than a guest's", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const hosted = await host.until("room_hosted");
    const guest = await connect(port);
    guest.send({ type: "join_room", code: hosted.code, name: "GUEST" });
    await guest.until("room_joined");
    await host.until("roster");
    // the same burst from both: a guest's bucket is 40 lines, the host's
    // four times that (hostLines) -- thirty walking bots at ~4 steps/s
    // each is the host's ordinary rate, not a flood
    for (let i = 0; i < 100; i++) { guest.send({ type: "ping" }); host.send({ type: "ping" }); }
    const dropped = await guest.until("__closed");
    assert.equal(dropped.type, "__closed", "the guest was dropped for flooding");
    // the host is still there: its pings were all answered (the guest's
    // drop puts a roster in between, which is not a pong)
    let pongs = 0;
    while (pongs < 100) {
      const m = await host.next();
      if (m.type === "pong") pongs++;
      else if (m.type === "__closed") assert.fail("the host was dropped too");
    }
    assert.equal(pongs, 100, "every one of the host's pings was answered");
    host.end();
  }, { burstLines: 40, linesPerSec: 1 });
});

test("a stat line is counted and never answered", async () => {
  await withRelay(async (port) => {
    const before = stats();
    const a = await connect(port);
    a.send({ type: "stat", id: "0123456789abcdef", v: "0.31.0",
             solo: 3, since: "2026-08-20" });
    // nothing comes back: the client sends this and forgets it, so a reply
    // would be a message no client is listening for
    a.send({ type: "ping" });
    assert.equal((await a.next()).type, "pong");
    const after = stats();
    assert.equal(after.statSeen, before.statSeen + 1, "the stat was seen");
    assert.equal(after.statSolo, before.statSolo + 3, "and its solo count added");
    a.end();
  });
});

test("a stat with a junk id or count is dropped, not logged", async () => {
  await withRelay(async (port) => {
    const before = stats();
    const a = await connect(port);
    // the id is the one field whose whole content the client chooses, so a
    // non-hex id must never reach a log line
    a.send({ type: "stat", id: "../../etc/passwd", solo: 1 });
    a.send({ type: "stat", id: "not hex at all", solo: 1 });
    a.send({ type: "stat", solo: 1 });
    a.send({ type: "ping" });
    assert.equal((await a.next()).type, "pong");
    assert.equal(stats().statSeen, before.statSeen, "none of them counted");

    // a sane id with a nonsense count still counts the install, at zero
    a.send({ type: "stat", id: "abc123", solo: -5 });
    a.send({ type: "ping" });
    assert.equal((await a.next()).type, "pong");
    const after = stats();
    assert.equal(after.statSeen, before.statSeen + 1, "the install counted");
    assert.equal(after.statSolo, before.statSolo, "the bad count did not");
    a.end();
  });
});

test("a stat needs no room, which is the whole point", async () => {
  await withRelay(async (port) => {
    const before = stats();
    const a = await connect(port);
    // never hosts, never joins -- a solo player's count arriving on a
    // connection that exists for some other reason
    a.send({ type: "stat", id: "feedface", v: "0.31.0", solo: 12 });
    a.send({ type: "ping" });
    assert.equal((await a.next()).type, "pong");
    assert.equal(stats().statSolo, before.statSolo + 12, "counted without a room");
    a.end();
  });
});

// ------- POK-130: the host can show somebody the door

// the roster arrives once per change, so a test that hosted then joined has
// two of them queued; wait for the one that matches
async function rosterWhere(client, pred) {
  for (;;) {
    const roster = await client.until("roster");
    if (pred(roster)) return roster;
  }
}

test("kick removes a member, tells them, and their IP stays out", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true });
    const code = (await host.until("room_hosted")).code;
    const guest = await connect(port);
    guest.send({ type: "join_room", code, name: "GUEST" });
    const joined = await guest.until("room_joined");
    await host.until("roster");

    host.send({ type: "kick", id: joined.id });
    const closed = await guest.until("room_closed");
    assert.equal(closed.reason, "removed");
    const roster = await rosterWhere(host, (r) => r.members.length === 1);
    assert.equal(roster.members[0].name, "HOST", "the roster is the host alone");

    // the same IP cannot come back through either door
    guest.send({ type: "join_room", code, name: "GUEST" });
    assert.equal((await guest.until("room_error")).reason, "removed");
    const again = await connect(port);   // a fresh connection, same IP
    again.send({ type: "quick_join", name: "GUEST" });
    assert.equal((await again.next()).type, "no_open_rooms");

    host.end(); guest.end(); again.end();
  });
});

test("only the host kicks, and never themselves", async () => {
  await withRelay(async (port, relay) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true });
    const code = (await host.until("room_hosted")).code;
    const guest = await connect(port);
    guest.send({ type: "join_room", code, name: "GUEST" });
    await guest.until("room_joined");
    await host.until("roster");

    // a guest asking is ignored; so is a host aiming at their own id
    guest.send({ type: "kick", id: 1 });
    await guest.settled();
    host.send({ type: "kick", id: 1 });
    await host.settled();
    assert.equal(relay.rooms.get(code).members.size, 2, "nobody went anywhere");

    host.end(); guest.end();
  });
});

// ------- POK-133: watch the running match, play the next one

test("a spectator enters a locked room and is seated at the unlock", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true });
    const code = (await host.until("room_hosted")).code;
    host.send({ type: "lock_room", locked: true });

    // a player is barred; a watcher is not
    const player = await connect(port);
    player.send({ type: "join_room", code, name: "LATE" });
    assert.equal((await player.until("room_error")).reason, "locked");
    const watcher = await connect(port);
    watcher.send({ type: "join_room", code, name: "LATE", spectate: true });
    await watcher.until("room_joined");
    let roster = await rosterWhere(host,
      (r) => r.members.some((m) => m.name === "LATE"));
    const seat = roster.members.find((m) => m.name === "LATE");
    assert.equal(seat.spectate, true, "the roster marks the watcher");

    // the match ends, the room unlocks, the watcher becomes a player
    host.send({ type: "lock_room", locked: false });
    roster = await rosterWhere(watcher,
      (r) => r.members.some((m) => m.name === "LATE" && !m.spectate));
    const seated = roster.members.find((m) => m.name === "LATE");
    assert.equal(seated.spectate, undefined, "the unlock seats them");

    host.end(); player.end(); watcher.end();
  });
});

// ------- the match line: a lock is a match starting, an unlock is it ending

async function withLoggedRelay(fn, limits) {
  const lines = [];
  const relay = createRelay({ limits, log: (l) => lines.push(l) });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    await fn(addr.port, lines);
  } finally {
    await relay.close();
  }
}

test("a lock logs the match with its mode and who was seated; the unlock logs the end", async () => {
  await withLoggedRelay(async (port, lines) => {
    const before = stats().matches;
    // quick play that found nothing and hosted its own -- the room is "quick"
    const host = await connect(port);
    host.send({ type: "quick_join", name: "HOST" });
    assert.equal((await host.next()).type, "no_open_rooms");
    host.send({ type: "host_room", name: "HOST", open: true, max: 6 });
    const code = (await host.until("room_hosted")).code;
    const guest = await connect(port);
    guest.send({ type: "join_room", code, name: "GUEST" });
    await guest.until("room_joined");
    host.send({ type: "lock_room", locked: true });
    const watcher = await connect(port);
    watcher.send({ type: "join_room", code, name: "LATE", spectate: true });
    await watcher.until("room_joined");
    await host.settled();

    const started = lines.find((l) => l.startsWith(`match ${code} started`));
    assert.equal(started, `match ${code} started (quick) | 2 trainers | max 6`,
      "the watcher arrived after the lock and is not in the count");
    assert.equal(stats().matches, before + 1);

    // a second lock while locked is not a second match
    host.send({ type: "lock_room", locked: true });
    await host.settled();
    assert.equal(lines.filter((l) => l.startsWith(`match ${code} started`)).length, 1);
    assert.equal(stats().matches, before + 1);

    host.send({ type: "lock_room", locked: false });
    await host.settled();
    const ended = lines.find((l) => l.startsWith(`match ${code} ended`));
    assert.match(ended, new RegExp(`^match ${code} ended after \\d+s$`));

    // an unlock with nothing running says nothing
    host.send({ type: "lock_room", locked: false });
    await host.settled();
    assert.equal(lines.filter((l) => l.startsWith(`match ${code} ended`)).length, 1);

    // the next match counts the seated watcher as a trainer
    host.send({ type: "lock_room", locked: true });
    await host.settled();
    const again = lines.filter((l) => l.startsWith(`match ${code} started`));
    assert.equal(again.length, 2);
    assert.equal(again[1], `match ${code} started (quick) | 3 trainers | max 6`);

    host.end(); guest.end(); watcher.end();
  });
});

test("a room from the HOST row is a host match, and the daily is the daily", async () => {
  await withLoggedRelay(async (port, lines) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    const code = (await a.until("room_hosted")).code;
    a.send({ type: "lock_room", locked: true });
    await a.settled();
    assert.equal(lines.find((l) => l.startsWith(`match ${code}`)),
      `match ${code} started (host) | 1 trainer | max 16`);

    const d = await connect(port);
    d.send({ type: "daily_join", name: "D" });
    const daily = (await d.until("room_hosted")).code;
    d.send({ type: "lock_room", locked: true });
    await d.settled();
    assert.equal(lines.find((l) => l.startsWith(`match ${daily}`)),
      `match ${daily} started (daily) | 1 trainer | max 16`);
    a.end(); d.end();
  });
});

// ------- POK-161: the official game time, served not shipped

test("info answers with the bounded motd and live counts", async () => {
  const { createRelay: mk } = await import("./server.js");
  const relay = mk({ motd: "GAME NIGHT DAILY\n7PM CENTRAL" });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    const a = await connect(addr.port);
    assert.deepEqual(a.bootInfo.motd, ["GAME NIGHT DAILY", "7PM CENTRAL"]);
    a.send({ type: "info" });
    const info = await a.until("info");
    assert.deepEqual(info.motd, ["GAME NIGHT DAILY", "7PM CENTRAL"]);
    assert.equal(info.conns, 1);
    assert.equal(info.rooms, 0);
    // needs no room, like stat: the empty lobby is exactly who asks
    a.send({ type: "host_room", name: "A" });
    await a.until("room_hosted");
    a.send({ type: "info" });
    const again = await a.until("info");
    assert.equal(again.rooms, 1);
    a.end();
  } finally {
    await relay.close();
  }
});

test("the motd is bounded: 17 cells, 3 rows, printable only", async () => {
  const { cleanMotd } = await import("./server.js");
  assert.deepEqual(cleanMotd(undefined), []);
  assert.deepEqual(cleanMotd(""), []);
  assert.deepEqual(cleanMotd("A ROW THAT RUNS FAR PAST THE BOX"),
    ["A ROW THAT RUNS F"]);
  assert.deepEqual(cleanMotd("ONE\nTWO\nTHREE\nFOUR"),
    ["ONE", "TWO", "THREE"]);
  assert.deepEqual(cleanMotd("GÉMÉ  SOIRÉE  "), ["GM  SOIRE"]);
});

// ------- POK-161 v2: the DAILY GAME

test("daily config parses, bounds, and counts down", async () => {
  const { parseDaily, dailySecondsUntil } = await import("./server.js");
  assert.equal(parseDaily(undefined), null);
  assert.equal(parseDaily("nonsense"), null);
  assert.equal(parseDaily("19:00|Not/AZone|X"), null);
  const d = parseDaily("19:00|America/Chicago|7PM CENTRAL");
  assert.equal(d.hour, 19);
  assert.equal(d.label, "7PM CENTRAL");
  const secs = dailySecondsUntil(d);
  assert.ok(secs > 0 && secs <= 86400, "within a day: " + secs);
  // a label past the box is trimmed like any motd row
  assert.equal(parseDaily("07:30|UTC|A LABEL THAT RUNS PAST THE BOX").label,
    "A LABEL THAT RUNS");
});

test("daily_join shares one room, and quick_join never seats there", async () => {
  const relay = createRelay({ daily: "19:00|America/Chicago|7PM CENTRAL" });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    const a = await connect(addr.port);
    a.send({ type: "info" });
    const info = await a.until("info");
    assert.ok(info.daily && info.daily.secs > 0, "info carries the schedule");
    assert.equal(info.daily.label, "7PM CENTRAL");

    // first press creates it, second press joins the SAME room
    a.send({ type: "daily_join", name: "EARLY" });
    const hosted = await a.until("room_hosted");
    const b = await connect(addr.port);
    b.send({ type: "daily_join", name: "ALSO" });
    assert.equal((await b.until("room_joined")).code, hosted.code);

    // quick play walks straight past the waiting daily room
    const q = await connect(addr.port);
    q.send({ type: "quick_join", name: "NOW" });
    assert.equal((await q.next()).type, "no_open_rooms");

    // ...but once its match runs, it is the POK-133 answer for everyone
    a.send({ type: "lock_room", locked: true });
    await a.settled();
    const late = await connect(addr.port);
    late.send({ type: "daily_join", name: "LATE" });
    const running = await late.next();
    assert.equal(running.type, "match_in_progress");
    assert.equal(running.code, hosted.code);
    const q2 = await connect(addr.port);
    q2.send({ type: "quick_join", name: "NOW2" });
    assert.equal((await q2.until("match_in_progress")).code, hosted.code);

    a.end(); b.end(); q.end(); late.end(); q2.end();
  } finally {
    await relay.close();
  }
});

// ------- the lobby list and the passcode (2026-09-13)

test("list_rooms shows every joinable lobby: host, skin, trainers over seats, the lock", async () => {
  await withRelay(async (port) => {
    // an open room of thirty with two trainers in it
    const anna = await connect(port);
    anna.send({ type: "host_room", name: "ANNA", open: true, max: 30, skin: "SPRITE_HIKER" });
    const annaCode = (await anna.until("room_hosted")).code;
    const mate = await connect(port);
    mate.send({ type: "join_room", code: annaCode, name: "MATE" });
    await mate.until("room_joined");

    // a passcoded room of four, listed with its lock and no code
    const ben = await connect(port);
    ben.send({ type: "host_room", name: "BEN", open: true, max: 4, pass: "ab12" });
    const benCode = (await ben.until("room_hosted")).code;

    // ...and the ones a stranger may not walk into: private, mid-match, daily
    const priv = await connect(port);
    priv.send({ type: "host_room", name: "PRIV" });
    await priv.until("room_hosted");
    const live = await connect(port);
    live.send({ type: "host_room", name: "LIVE", open: true });
    await live.until("room_hosted");
    live.send({ type: "lock_room", locked: true });
    await live.settled();
    const daily = await connect(port);
    daily.send({ type: "daily_join", name: "DAILY" });
    await daily.until("room_hosted");

    const seeker = await connect(port);
    seeker.send({ type: "list_rooms" });
    const answer = await seeker.until("rooms");
    assert.deepEqual(answer.rooms, [
      { code: annaCode, host: "ANNA", skin: "SPRITE_HIKER", players: 2, seats: 30, pass: false, full: false },
      // (no skin sent, no skin key: JSON has no undefined)
      { code: benCode, host: "BEN", players: 1, seats: 4, pass: true, full: false },
    ]);
    // the seat count is the host's MAX as asked, not the human ceiling
    assert.equal(answer.rooms[0].seats, 30);
    // and the room's own roster only ever says THAT a passcode is set
    ben.send({ type: "set_max", max: 6 });
    const roster = await ben.until("roster");
    assert.equal(roster.pass, true);
    assert.equal(roster.max, 4, "the roster's max is the human ceiling");
    assert.equal("passcode" in roster, false);
    seeker.send({ type: "list_rooms" });
    assert.equal((await seeker.until("rooms")).rooms.find((r) => r.host === "BEN").seats, 6,
                 "the list's seats are the host's MAX as asked");

    // a garbage skin is dropped rather than echoed to every browser
    const odd = await connect(port);
    odd.send({ type: "host_room", name: "ODD", open: true, skin: "<img src=x>" });
    await odd.until("room_hosted");
    seeker.send({ type: "list_rooms" });
    const again = await seeker.until("rooms");
    assert.equal(again.rooms.find((r) => r.host === "ODD").skin, undefined);

    for (const c of [anna, mate, ben, priv, live, daily, seeker, odd]) c.end();
  }, { members: 4 });   // a human ceiling under the thirty seats ANNA asked for
});

// a BR_DAILY string for a wall-clock time `minutes` from now, in UTC
function dailyIn(minutes) {
  const at = new Date(Date.now() + minutes * 60 * 1000);
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}|UTC|TEST`;
}

test("the DAILY GAME leads the list inside its half hour, and its row is the daily's door", async () => {
  const relay = createRelay({ daily: dailyIn(20) });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    // nobody has pressed the row: the relay promises the room anyway
    const seeker = await connect(addr.port);
    seeker.send({ type: "list_rooms" });
    let rooms = (await seeker.until("rooms")).rooms;
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].host, "DAILY");
    assert.equal(rooms[0].daily, true);
    assert.equal(rooms[0].code, "", "no room yet, no code");
    assert.equal(rooms[0].players, 0);
    assert.equal(rooms[0].seats, 30);
    assert.equal(rooms[0].pass, false);
    assert.ok(rooms[0].secs > 18 * 60 && rooms[0].secs <= 20 * 60,
              "the countdown: " + rooms[0].secs);

    // somebody presses DAILY GAME: the row names the room and counts them,
    // and it stays ahead of a fuller open room
    const early = await connect(addr.port);
    early.send({ type: "daily_join", name: "EARLY" });
    const hosted = await early.until("room_hosted");
    const anna = await connect(addr.port);
    anna.send({ type: "host_room", name: "ANNA", open: true, max: 30 });
    const annaCode = (await anna.until("room_hosted")).code;
    const mate = await connect(addr.port);
    mate.send({ type: "join_room", code: annaCode, name: "MATE" });
    await mate.until("room_joined");
    seeker.send({ type: "list_rooms" });
    rooms = (await seeker.until("rooms")).rooms;
    assert.equal(rooms[0].host, "DAILY", "the daily leads");
    assert.equal(rooms[0].code, hosted.code);
    assert.equal(rooms[0].players, 1);
    assert.equal(rooms[1].host, "ANNA");

    // picking the row is daily_join on the browsing connection
    seeker.send({ type: "daily_join", name: "SEEKER" });
    assert.equal((await seeker.until("room_joined")).code, hosted.code);

    // once the daily is running, no row
    early.send({ type: "lock_room", locked: true });
    await early.settled();
    const late = await connect(addr.port);
    late.send({ type: "list_rooms" });
    rooms = (await late.until("rooms")).rooms;
    assert.equal(rooms.find((r) => r.daily), undefined, "a running daily is not listed");
    for (const c of [seeker, early, anna, mate, late]) c.end();
  } finally {
    await relay.close();
  }
});

test("hours ahead of its time the DAILY GAME is not on the list", async () => {
  const relay = createRelay({ daily: dailyIn(5 * 60) });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    const seeker = await connect(addr.port);
    seeker.send({ type: "list_rooms" });
    assert.deepEqual((await seeker.until("rooms")).rooms, []);
    seeker.end();
  } finally {
    await relay.close();
  }
});

test("a passcode gates the door: wrong is refused, right is seated, quick play walks past", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true });
    const code = (await host.until("room_hosted")).code;
    await host.until("roster");

    // a guest cannot set one
    const early = await connect(port);
    early.send({ type: "join_room", code, name: "EARLY" });
    await early.until("room_joined");
    await early.until("roster");
    early.send({ type: "set_pass", pass: "NOPE" });
    await early.settled();
    const walkin = await connect(port);
    walkin.send({ type: "join_room", code, name: "WALK" });
    assert.equal((await walkin.next()).type, "room_joined");
    walkin.send({ type: "leave_room" });
    await host.until("roster");

    // the host can, and the room hears only that it is set
    host.send({ type: "set_pass", pass: "ab12" });
    await rosterWhere(early, (r) => r.pass === true);

    const wrong = await connect(port);
    wrong.send({ type: "join_room", code, name: "WRONG", pass: "zz99" });
    assert.equal((await wrong.next()).reason, "passcode");
    const none = await connect(port);
    none.send({ type: "join_room", code, name: "NONE" });
    assert.equal((await none.next()).reason, "passcode");
    // a watcher is held to it too
    const peek = await connect(port);
    peek.send({ type: "join_room", code, name: "PEEK", spectate: true });
    assert.equal((await peek.next()).reason, "passcode");
    // quick play never lands a stranger behind a passcode
    const seeker = await connect(port);
    seeker.send({ type: "quick_join", name: "SEEK" });
    assert.equal((await seeker.next()).type, "no_open_rooms");

    // the code is case-blind, like the room code itself
    const right = await connect(port);
    right.send({ type: "join_room", code, name: "RIGHT", pass: "AB12" });
    assert.equal((await right.next()).type, "room_joined");

    // taking it off reopens the door, and the roster says so
    host.send({ type: "set_pass" });
    await rosterWhere(early, (r) => r.pass === false);
    const late = await connect(port);
    late.send({ type: "join_room", code, name: "LATE" });
    assert.equal((await late.next()).type, "room_joined");

    // a passcode may be hosted with, and junk is no passcode at all
    const locked = await connect(port);
    locked.send({ type: "host_room", name: "LOCKED", open: true, pass: "k9" });
    await locked.until("room_hosted");
    assert.equal((await locked.until("roster")).pass, true);
    const junk = await connect(port);
    junk.send({ type: "host_room", name: "JUNK", open: true, pass: "way too long!!" });
    await junk.until("room_hosted");
    assert.equal((await junk.until("roster")).pass, false);

    for (const c of [host, early, walkin, wrong, none, peek, seeker, right, late, locked, junk]) c.end();
  });
});

test("a browser that keeps asking outlives the unbound sweep, and one that stops does not", async () => {
  await withRelay(async (port) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const browser = await connect(port);
    // eight looks over ~800ms, against a 300ms unbound cut
    for (let i = 0; i < 8; i++) {
      browser.send({ type: "list_rooms" });
      await browser.until("rooms");
      await wait(100);
    }
    assert.equal(browser.closed, false, "still connected while looking");
    // ...then it stops looking, and the sweep takes it like any other
    await wait(700);
    assert.equal(browser.closed, true, "dropped once it stopped");
  }, { unboundMs: 300, sweepMs: 50 });
});

// ------- POK-218: WebSocket-specific additions -- version gate, origins, /health

test("host_room records a version, and a mismatched join is refused", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true, patch: "1.2.0", protocol: 11 });
    const code = (await host.until("room_hosted")).code;
    await host.until("roster");

    // same protocol, different patch: still a mismatch (either field differing refuses)
    const stalePatch = await connect(port);
    stalePatch.send({ type: "join_room", code, name: "OLD", patch: "1.1.0", protocol: 11 });
    const refused = await stalePatch.next();
    assert.equal(refused.type, "room_error");
    assert.equal(refused.reason, "version");
    assert.deepEqual(refused.host, { patch: "1.2.0", protocol: 11 });

    // a different protocol number alone is also a mismatch
    const staleProtocol = await connect(port);
    staleProtocol.send({ type: "join_room", code, name: "OLDP", patch: "1.2.0", protocol: 10 });
    assert.equal((await staleProtocol.next()).reason, "version");

    // matching versions get in
    const same = await connect(port);
    same.send({ type: "join_room", code, name: "SAME", patch: "1.2.0", protocol: 11 });
    assert.equal((await same.next()).type, "room_joined");

    // an older client that sends neither field is never refused for silence
    const silent = await connect(port);
    silent.send({ type: "join_room", code, name: "SILENT" });
    assert.equal((await silent.next()).type, "room_joined");

    host.end(); stalePatch.end(); staleProtocol.end(); same.end(); silent.end();
  });
});

test("a host that never said its version never gates a join on one", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true });   // no patch/protocol
    const code = (await host.until("room_hosted")).code;

    const guest = await connect(port);
    guest.send({ type: "join_room", code, name: "GUEST", patch: "9.9.9", protocol: 999 });
    assert.equal((await guest.next()).type, "room_joined");

    host.end(); guest.end();
  });
});

test("quick_join gates on the target room's version the same way join_room does", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true, patch: "2.0.0", protocol: 5 });
    await host.until("room_hosted");

    const mismatched = await connect(port);
    mismatched.send({ type: "quick_join", name: "SEEK", patch: "1.0.0", protocol: 5 });
    const refused = await mismatched.next();
    assert.equal(refused.type, "room_error");
    assert.equal(refused.reason, "version");
    assert.deepEqual(refused.host, { patch: "2.0.0", protocol: 5 });

    const matched = await connect(port);
    matched.send({ type: "quick_join", name: "SEEK2", patch: "2.0.0", protocol: 5 });
    assert.equal((await matched.next()).type, "room_joined");

    host.end(); mismatched.end(); matched.end();
  });
});

test("info carries minProtocol from options, both on connect and on request", async () => {
  const relay = createRelay({ minProtocol: 7 });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    const a = await connect(addr.port);
    assert.equal(a.bootInfo.minProtocol, 7);
    a.send({ type: "info" });
    assert.equal((await a.until("info")).minProtocol, 7);
    a.end();
  } finally {
    await relay.close();
  }
});

test("BR_ORIGINS refuses an upgrade from an origin not on the list, and allows no-origin clients", async () => {
  const relay = createRelay({ origins: ["https://good.example"] });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    // a browser-shaped request with a disallowed Origin never reaches the
    // app: the socket closes before any WebSocket frame is possible
    const refused = new WebSocket(`ws://127.0.0.1:${addr.port}`, {
      headers: { Origin: "https://evil.example" },
    });
    await new Promise((resolve) => {
      refused.addEventListener("error", () => resolve());
      refused.addEventListener("close", () => resolve());
      refused.addEventListener("open", () => resolve());
    });
    assert.notEqual(refused.readyState, WebSocket.OPEN, "the bad-origin socket never opens");

    // an allowed origin, and a client that sends no Origin at all (most
    // non-browser WebSocket libraries, and the game itself), both connect
    const allowed = new WebSocket(`ws://127.0.0.1:${addr.port}`, {
      headers: { Origin: "https://good.example" },
    });
    await new Promise((resolve, reject) => {
      allowed.addEventListener("open", resolve, { once: true });
      allowed.addEventListener("error", reject, { once: true });
    });
    allowed.close();

    const noOrigin = await connect(addr.port);   // node's WebSocket sends no Origin
    assert.equal(noOrigin.bootInfo.type, "info");
    noOrigin.end();
  } finally {
    await relay.close();
  }
});

test("GET /health answers 200 with room and connection counts", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A" });
    await a.until("room_hosted");

    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, data }));
      }).on("error", reject);
    });
    assert.equal(body.status, 200);
    const parsed = JSON.parse(body.data);
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.rooms, 1);
    assert.equal(parsed.conns, 1);

    a.end();
  });
});

// A dropped socket gets its seat back (POK-284): the id IS the page's seat, so a
// returning client that was handed a new one would be somebody else to every ROM in
// the room.
test("rejoin: a dropped guest presents its token and gets the same id, past a locked door", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "RED" });
    const hosted = await a.next();
    assert.equal(typeof hosted.token, "string");
    await a.next(); // roster

    const b = await connect(port);
    b.send({ type: "join_room", code: hosted.code, name: "BLUE" });
    const joined = await b.next();
    assert.equal(joined.id, 2);
    assert.equal(typeof joined.token, "string");
    await b.next(); await a.next(); // rosters

    // The match starts, then BLUE's socket dies.
    a.send({ type: "lock_room" });
    await a.settled();
    b.end(); // the socket goes without a leave_room: a drop, as the relay sees it
    const gone = await a.until("roster");
    assert.deepEqual(gone.members.map((m) => m.id), [1]);

    // A stranger cannot get in: the door is locked.
    const c = await connect(port);
    c.send({ type: "join_room", code: hosted.code, name: "GREEN" });
    assert.equal((await c.next()).reason, "locked");

    // BLUE comes back with its token and is seat 2 again, locked door or not.
    const b2 = await connect(port);
    b2.send({ type: "join_room", code: hosted.code, name: "BLUE", token: joined.token });
    const back = await b2.next();
    assert.equal(back.type, "room_joined");
    assert.equal(back.id, 2);
    assert.notEqual(back.token, joined.token); // a token is spent by the rejoin
    const roster = await a.until("roster");
    assert.deepEqual(roster.members.map((m) => m.id), [1, 2]);

    // The spent token is worth nothing a second time.
    const b3 = await connect(port);
    b3.send({ type: "join_room", code: hosted.code, name: "BLUE", token: joined.token });
    assert.equal((await b3.next()).reason, "locked");
    a.end(); b2.end(); c.end(); b3.end();
  });
});

test("rejoin: leaving on purpose holds nothing, and a hold expires", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "RED" });
    const hosted = await a.next();
    await a.next();
    const b = await connect(port);
    b.send({ type: "join_room", code: hosted.code, name: "BLUE" });
    const joined = await b.next();
    await b.next(); await a.next();

    b.send({ type: "leave_room" });
    await a.until("roster");
    // nothing was held for a leaver: the next stranger gets its seat...
    const c = await connect(port);
    c.send({ type: "join_room", code: hosted.code, name: "GREEN" });
    assert.equal((await c.next()).id, 2);
    await a.until("roster");
    // ...and its token is an ordinary join, to the next free seat
    const b2 = await connect(port);
    b2.send({ type: "join_room", code: hosted.code, name: "BLUE", token: joined.token });
    const rejoined = await b2.next();
    assert.equal(rejoined.id, 3);
    await b2.next(); await a.until("roster");

    b2.end();
    await a.until("roster");
    // while seat 3 is held, nobody else is handed it
    const d = await connect(port);
    d.send({ type: "join_room", code: hosted.code, name: "D" });
    assert.equal((await d.next()).id, 4);
    await new Promise((r) => setTimeout(r, 120)); // past rejoinMs + a sweep
    // expired: a stranger gets it, and the token is worth nothing
    const e = await connect(port);
    e.send({ type: "join_room", code: hosted.code, name: "E" });
    assert.equal((await e.next()).id, 3);
    const b3 = await connect(port);
    b3.send({ type: "join_room", code: hosted.code, name: "BLUE", token: rejoined.token });
    assert.equal((await b3.next()).id, 5);
    for (const x of [a, c, d, e, b3]) x.end();
  }, { rejoinMs: 50, sweepMs: 20 });
});

// ------- POK-330 #18: one hostile socket must not take the relay down

// Whether a socket gets as far as open, or is refused on the way.
function opens(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.addEventListener("open", () => { resolve(true); ws.close(); }, { once: true });
    ws.addEventListener("error", () => resolve(false), { once: true });
    ws.addEventListener("close", () => resolve(false), { once: true });
  });
}

test("junk message types are counted as one, not one entry each", async () => {
  await withRelay(async (port, relay) => {
    const a = await connect(port);
    for (let i = 0; i < 300; i++) a.send({ type: `junk${i}` });
    await a.settled();
    const [conn] = [...relay.conns];
    assert.equal(conn.seen.get("other"), 300, "every junk frame is counted");
    assert.deepEqual([...conn.seen.keys()].sort(), ["other", "ping"],
      "but under one key: the census is bounded by what the relay knows");
    a.end();
  });
});

test("a socket that stops reading is dropped before its backlog grows", async () => {
  const lines = [];
  const relay = createRelay({ log: (l) => lines.push(l) });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    const a = await connect(addr.port);
    const [conn] = [...relay.conns];
    // what ws reports for a peer that has not read for a long while
    Object.defineProperty(conn.ws, "bufferedAmount", { get: () => 2 * 1024 * 1024 });
    a.send({ type: "ping" });   // the pong would be one more line in the queue
    await a.until("__closed");
    assert.ok(lines.some((l) => l.includes("(slow_consumer)")), lines.join("\n"));
  } finally {
    await relay.close();
  }
});

test("a byte flood disconnects, even inside the line budget", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    const pad = "x".repeat(2000);
    // three ~2 KB frames against a 4 KB byte bucket and a 1200-line one
    for (let i = 0; i < 3; i++) a.send({ type: "all", m: { pad } });
    const closed = await a.until("__closed");
    assert.equal(closed.type, "__closed");
  }, { burstBytes: 4096, bytesPerSec: 1 });
});

test("the byte bucket leaves ordinary play alone", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "HOST" });
    await a.until("roster");
    // a second of a busy host: forty places
    for (let i = 0; i < 40; i++) {
      a.send({ type: "all", m: { t: "place", seat: 31, x: i, y: 4, map: { group: 0, num: 9 }, d: 1 } });
    }
    await a.settled();
    assert.equal(a.closed, false);
    a.end();
  });
});

test("limits must be positive numbers, from the env or from code", async () => {
  const said = [];
  assert.deepEqual(limitsFromEnv({
    BR_MAX_ROOMS: "forty", BR_MAX_CONNS: "0", BR_LINES_PER_SEC: "-1", BR_BURST_LINES: "50",
  }, (l) => said.push(l)), { burstLines: 50 });
  assert.equal(said.length, 3, "each bad one is logged");
  assert.deepEqual(limitsFromEnv({}), {});

  // NaN used to switch the cap off (every comparison with it is false)
  const relay = createRelay({ limits: { rooms: NaN, conns: 0, members: 4 } });
  assert.equal(relay.limits.rooms, 40);
  assert.equal(relay.limits.conns, 200);
  assert.equal(relay.limits.members, 4, "a good one is kept");
  await relay.close();
});

test("the per-IP and total connection ceilings refuse the next socket", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    const b = await connect(port);
    assert.equal(await opens(port), false, "a third from one address");
    a.end(); b.end();
  }, { connsPerIp: 2 });
  await withRelay(async (port) => {
    const a = await connect(port);
    const b = await connect(port);
    assert.equal(await opens(port), false, "a third on the relay");
    a.end(); b.end();
  }, { conns: 2 });
});

test("a silent socket is swept as idle; a pinging one is kept", async () => {
  await withRelay(async (port) => {
    const quiet = await connect(port);
    const chatty = await connect(port);
    const pinger = setInterval(() => chatty.send({ type: "ping" }), 40);
    try {
      await quiet.until("__closed", 2000);
      assert.equal(chatty.closed, false);
    } finally {
      clearInterval(pinger);
    }
    chatty.end();
  }, { idleMs: 200, sweepMs: 20 });
});

test("a frame past the line limit closes the socket", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "all", m: { pad: "x".repeat(2048) } });
    const closed = await a.until("__closed");
    assert.equal(closed.type, "__closed");
  }, { line: 1024 });
});

// ------- POK-330 #66: a broadcast is serialized once, not once per member

test("a broadcast is serialized once for the whole room", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const { code } = await host.until("room_hosted");
    const guests = [];
    for (const name of ["A", "B", "C"]) {
      const g = await connect(port);
      g.send({ type: "join_room", code, name });
      await g.until("room_joined");
      guests.push(g);
    }
    await host.settled();

    const real = JSON.stringify;
    let recvs = 0;
    JSON.stringify = function (value, ...rest) {
      if (value && value.type === "recv") recvs += 1;
      return real.call(this, value, ...rest);
    };
    try {
      host.send({ type: "all", m: { t: "ring", phase: 1 } });
      for (const g of guests) assert.deepEqual((await g.until("recv")).m, { t: "ring", phase: 1 });
    } finally {
      JSON.stringify = real;
    }
    assert.equal(recvs, 1, "three recipients, one stringify");
    host.end(); for (const g of guests) g.end();
  });
});

// ------- POK-330 #19: behind a proxy, a client is its forwarded address

test("clientAddress trusts the proxy's headers only when told to", () => {
  const req = (headers) => ({ socket: { remoteAddress: "100.64.0.7" }, headers });
  // off: the socket's own address, whatever the client wrote
  assert.equal(clientAddress(req({ "x-real-ip": "203.0.113.9" }), false), "100.64.0.7");
  // on: X-Real-IP first...
  assert.equal(clientAddress(req({ "x-real-ip": "203.0.113.9",
    "x-forwarded-for": "198.51.100.1" }), true), "203.0.113.9");
  // ...then the entry the proxy APPENDED, never the ones the client sent
  assert.equal(clientAddress(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.10" }), true),
    "203.0.113.10");
  assert.equal(clientAddress(req({ "x-forwarded-for": "2001:db8::1" }), true), "2001:db8::1");
  // junk, or nothing, falls back to the socket
  assert.equal(clientAddress(req({ "x-real-ip": "<script>" }), true), "100.64.0.7");
  assert.equal(clientAddress(req({}), true), "100.64.0.7");
});

test("behind BR_TRUST_PROXY, two clients through one proxy are two addresses", async () => {
  const relay = createRelay({ trustProxy: true, limits: { connsPerIp: 1 } });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    // both sockets come from 127.0.0.1, the "proxy"
    const a = await connect(addr.port, { "X-Forwarded-For": "203.0.113.1" });
    const b = await connect(addr.port, { "X-Forwarded-For": "203.0.113.2" });
    assert.equal(b.closed, false, "a stranger is not capped with the first");
    a.end(); b.end();
  } finally {
    await relay.close();
  }
  // ...and without the flag the header is ignored: one address, one cap
  await withRelay(async (port) => {
    const a = await connect(port, { "X-Forwarded-For": "203.0.113.1" });
    assert.equal(await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { "X-Forwarded-For": "203.0.113.2" } });
      ws.addEventListener("open", () => { resolve(true); ws.close(); }, { once: true });
      ws.addEventListener("close", () => resolve(false), { once: true });
    }), false);
    a.end();
  }, { connsPerIp: 1 });
});

test("a kick bans the member's address and token, not the proxy everyone shares", async () => {
  const relay = createRelay({ trustProxy: true });
  const addr = await relay.listen(0, "127.0.0.1");
  try {
    const host = await connect(addr.port, { "X-Real-IP": "203.0.113.1" });
    host.send({ type: "host_room", name: "HOST", open: true });
    const code = (await host.until("room_hosted")).code;
    const guest = await connect(addr.port, { "X-Real-IP": "203.0.113.2" });
    guest.send({ type: "join_room", code, name: "GUEST" });
    const joined = await guest.until("room_joined");
    await host.until("roster");

    host.send({ type: "kick", id: joined.id });
    await guest.until("room_closed");

    // a bystander through the same proxy walks in
    const bystander = await connect(addr.port, { "X-Real-IP": "203.0.113.3" });
    bystander.send({ type: "join_room", code, name: "NEW" });
    assert.equal((await bystander.next()).type, "room_joined");

    // the removed page's automatic rejoin, from a new address, is still refused
    const back = await connect(addr.port, { "X-Real-IP": "198.51.100.4" });
    back.send({ type: "join_room", code, name: "GUEST", token: joined.token });
    assert.equal((await back.next()).reason, "removed");
    // and so is its old address
    const same = await connect(addr.port, { "X-Real-IP": "203.0.113.2" });
    same.send({ type: "join_room", code, name: "GUEST" });
    assert.equal((await same.next()).reason, "removed");
    for (const c of [host, guest, bystander, back, same]) c.end();
  } finally {
    await relay.close();
  }
});

// ------- POK-330 #6: ids are seats, and there are 31 of them

test("ids are the lowest free one, and 40 reloads later still fit a seat", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const { code } = await host.until("room_hosted");
    for (let i = 0; i < 40; i++) {
      const g = await connect(port);
      g.send({ type: "join_room", code, name: "G" });
      assert.equal((await g.until("room_joined")).id, 2, `cycle ${i}`);
      g.send({ type: "leave_room" });
      await g.settled();
      g.end();
    }
    host.end();
  });
});

test("past seat 31 the answer is full, whatever MAX says", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true, max: 40 });
    const { code } = await host.until("room_hosted");
    const guests = [];
    for (let id = 2; id <= 31; id++) {
      const g = await connect(port);
      g.send({ type: "join_room", code, name: "G" });
      assert.equal((await g.until("room_joined")).id, id);
      guests.push(g);
    }
    const late = await connect(port);
    late.send({ type: "join_room", code, name: "LATE" });
    assert.equal((await late.next()).reason, "full");
    const quick = await connect(port);
    quick.send({ type: "quick_join", name: "QUICK" });
    assert.equal((await quick.next()).type, "no_open_rooms");
    for (const c of [host, late, quick, ...guests]) c.end();
  }, { members: 40, conns: 64, connsPerIp: 64 });
});

test("mid-match, a latecomer never gets a seat the match has used", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const { code } = await host.until("room_hosted");
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" });
    assert.equal((await b.until("room_joined")).id, 2);
    host.send({ type: "lock_room", locked: true });
    await host.settled();

    // B walks out mid-match; seat 2 is still B's ghost on every page
    b.send({ type: "leave_room" });
    await b.settled();
    const watcher = await connect(port);
    watcher.send({ type: "join_room", code, name: "W", spectate: true });
    assert.equal((await watcher.until("room_joined")).id, 3);

    // the match ends: its seats are free again
    host.send({ type: "lock_room", locked: false });
    await host.settled();
    const next = await connect(port);
    next.send({ type: "join_room", code, name: "N" });
    assert.equal((await next.until("room_joined")).id, 2);
    for (const c of [host, b, watcher, next]) c.end();
  });
});

test("the seats the host dealt its bots are never a latecomer's", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const { code } = await host.until("room_hosted");
    host.send({ type: "lock_room", locked: true });
    // twenty-nine bots, counted down from the top the way bots/roster.ts deals them
    const bots = [];
    for (let seat = 31; seat >= 3; seat--) bots.push(seat);
    host.send({ type: "lock_room", locked: true, bots: [...bots, 0, 32, "x"] });
    await host.settled();

    const w1 = await connect(port);
    w1.send({ type: "join_room", code, name: "W1", spectate: true });
    assert.equal((await w1.until("room_joined")).id, 2, "the one seat left");
    const w2 = await connect(port);
    w2.send({ type: "join_room", code, name: "W2", spectate: true });
    assert.equal((await w2.next()).reason, "full", "not seat 3, which is a bot");
    for (const c of [host, w1, w2]) c.end();
  });
});

test("a seat held for a dropped member goes to the bot the host dealt onto it", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const { code } = await host.until("room_hosted");
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" });
    const joined = await b.until("room_joined");
    await rosterWhere(host, (r) => r.members.some((m) => m.id === 2));
    b.end();   // a drop: seat 2 is held
    await rosterWhere(host, (r) => !r.members.some((m) => m.id === 2));
    host.send({ type: "lock_room", locked: true });
    host.send({ type: "lock_room", locked: true, bots: [2] });
    await host.settled();
    const back = await connect(port);
    back.send({ type: "join_room", code, name: "B", token: joined.token, spectate: true });
    assert.equal((await back.until("room_joined")).id, 3, "a new seat, not the bot at 2");
    host.end(); back.end();
  });
});

test("the heir is the earliest arrival, not the lowest id", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST" });
    const { code } = await host.until("room_hosted");
    const b = await connect(port);
    b.send({ type: "join_room", code, name: "B" });
    await b.until("room_joined");
    const c = await connect(port);
    c.send({ type: "can_host", ok: true });
    c.send({ type: "join_room", code, name: "C" });
    assert.equal((await c.until("room_joined")).id, 3);
    b.send({ type: "leave_room" });
    await b.settled();
    // D arrives after C but takes the seat B left
    const d = await connect(port);
    d.send({ type: "can_host", ok: true });
    d.send({ type: "join_room", code, name: "D" });
    assert.equal((await d.until("room_joined")).id, 2);
    host.send({ type: "leave_room" });
    const roster = await rosterWhere(c, (r) => r.host !== 1);
    assert.equal(roster.host, 3, "C has been here longer than D");
    for (const x of [host, b, c, d]) x.end();
  });
});

// ------- POK-330 #29: MAX goes to 30, and the list says full the way the door does

test("the roster carries the seats asked for beside the humans seated", async () => {
  await withRelay(async (port) => {
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", max: 30 });
    let roster = await host.until("roster");
    assert.equal(roster.max, 16, "humans: the relay's ceiling");
    assert.equal(roster.seats, 30, "seats: what the host asked for, bots filling the rest");
    host.send({ type: "set_max", max: 20 });
    roster = await host.until("roster");
    assert.equal(roster.seats, 20);
    host.end();
  });
});

test("a listed room is full when its door would say so, not by trainers over seats", async () => {
  await withRelay(async (port) => {
    // thirty seats, two humans allowed: a trainer and a watcher fill it
    const host = await connect(port);
    host.send({ type: "host_room", name: "HOST", open: true, max: 30 });
    const { code } = await host.until("room_hosted");
    const seeker = await connect(port);
    seeker.send({ type: "list_rooms" });
    assert.equal((await seeker.until("rooms")).rooms[0].full, false);
    const watcher = await connect(port);
    watcher.send({ type: "join_room", code, name: "W", spectate: true });
    await watcher.until("room_joined");
    seeker.send({ type: "list_rooms" });
    const [row] = (await seeker.until("rooms")).rooms;
    assert.equal(row.players, 1, "the watcher is not a trainer");
    assert.equal(row.seats, 30);
    assert.equal(row.full, true, "but the door is shut all the same");
    const late = await connect(port);
    late.send({ type: "join_room", code, name: "L" });
    assert.equal((await late.next()).reason, "full");
    for (const c of [host, seeker, watcher, late]) c.end();
  }, { members: 2 });
});

// POK-330 #25: the page's host gives a vanished seat exactly as long as the relay holds
// it. The two used to disagree (ten seconds against sixty), and a seat that came back in
// between walked into a match that had already eliminated it.
test("every door says how long a dropped seat is held", async () => {
  await withRelay(async (port) => {
    const a = await connect(port);
    a.send({ type: "host_room", name: "A", open: true });
    const hosted = await a.until("room_hosted");
    assert.equal(hosted.rejoinMs, 7_000);

    const b = await connect(port);
    b.send({ type: "join_room", code: hosted.code, name: "B" });
    assert.equal((await b.until("room_joined")).rejoinMs, 7_000);

    const c = await connect(port);
    c.send({ type: "quick_join", name: "C" });
    assert.equal((await c.until("room_joined")).rejoinMs, 7_000);

    const d = await connect(port);
    d.send({ type: "daily_join", name: "D" });
    assert.equal((await d.until("room_hosted")).rejoinMs, 7_000);
    const e = await connect(port);
    e.send({ type: "daily_join", name: "E" });
    assert.equal((await e.until("room_joined")).rejoinMs, 7_000);
    for (const x of [a, b, c, d, e]) x.end();
  }, { rejoinMs: 7_000 });
});
