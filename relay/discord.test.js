// node --test: the open rooms' messages in Discord (discord.js), against a fake webhook.

import test from "node:test";
import assert from "node:assert/strict";
import { createRoomPoster, roomText } from "./discord.js";

function webhook() {
  const calls = [];
  let next = 1;
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, url, body });
    if (init.method === "POST") return { ok: true, status: 200, json: async () => ({ id: String(next++) }) };
    return { ok: true, status: init.method === "DELETE" ? 204 : 200, json: async () => ({}) };
  };
  return { calls, fetch };
}

const URL_ = "https://discord.com/api/webhooks/1/tok";
const quick = (players, startsIn = 60, playing = false) => ({ code: "QK1234", host: "QUINN", skin: 0, players, seats: 30, playing, pass: false, quick: true, ...(playing ? {} : { startsIn }) });

test("a quick room is posted, edited as it fills, and marked started", async () => {
  const hook = webhook();
  let t = 1_000_000;
  let list = [quick(1)];
  const p = createRoomPoster({ url: URL_, rooms: () => list, fetch: hook.fetch, now: () => t, editMs: 10_000 });
  await p.tick();
  assert.equal(hook.calls.length, 1);
  assert.equal(hook.calls[0].method, "POST");
  assert.equal(hook.calls[0].url, `${URL_}?wait=true`);
  assert.match(hook.calls[0].body.content, /^\*\*QUICK PLAY\*\* has 1\/30 trainers and starts <t:1060:R>\.\nJoin: <https:\/\/hoenn-battle-royale\.vercel\.app\/#join=QK1234>$/);
  // Nobody is ever pinged by a trainer's name.
  assert.deepEqual(hook.calls[0].body.allowed_mentions, { parse: [] });

  // A second trainer, too soon for an edit: held, then sent.
  t += 2_000; list = [quick(2, 60)];
  await p.tick();
  assert.equal(hook.calls.length, 1);
  t += 9_000;
  await p.tick();
  assert.equal(hook.calls.length, 2);
  assert.equal(hook.calls[1].method, "PATCH");
  assert.equal(hook.calls[1].url, `${URL_}/messages/1`);
  assert.match(hook.calls[1].body.content, /2\/30 trainers/);

  // Nothing new, nothing sent (the countdown is Discord's own).
  t += 20_000; list = [quick(2, 40)];
  await p.tick();
  assert.equal(hook.calls.length, 2);

  t += 40_000; list = [quick(2, 0, true)];
  await p.tick();
  assert.equal(hook.calls[2].method, "PATCH");
  assert.equal(hook.calls[2].body.content, "**QUICK PLAY** started with 2 trainers.");
  assert.equal(p.open, 0);
});

test("a room that empties is taken down; passcoded, playing and E2E rooms are never posted", async () => {
  const hook = webhook();
  let list = [
    { code: "AAA111", host: "ALICE", skin: 3, players: 1, seats: 8, playing: false, pass: false },
    { code: "BBB222", host: "BOB", skin: 1, players: 2, seats: 8, playing: false, pass: true },
    { code: "CCC333", host: "CARL", skin: 1, players: 4, seats: 8, playing: true, pass: false },
    { code: "EEE444", host: "E2E", skin: 0, players: 1, seats: 8, playing: false, pass: false },
  ];
  const p = createRoomPoster({ url: URL_, rooms: () => list, fetch: hook.fetch });
  await p.tick();
  assert.deepEqual(hook.calls.map((c) => c.body.content), ["**ALICE** is hosting a room with 1/8 trainers. It starts when they press START.\nJoin: <https://hoenn-battle-royale.vercel.app/#join=AAA111>"]);
  list = [];
  await p.tick();
  assert.equal(hook.calls[1].method, "DELETE");
  assert.equal(hook.calls[1].url, `${URL_}/messages/1`);
});

test("a deploy's drain takes every message down; a rate limit waits it out", async () => {
  const hook = webhook();
  let t = 0;
  let limited = true;
  const fetch = async (url, init) => {
    if (limited) { limited = false; return { ok: false, status: 429, json: async () => ({ retry_after: 2 }) }; }
    return hook.fetch(url, init);
  };
  const logs = [];
  const p = createRoomPoster({ url: URL_, rooms: () => [quick(1)], fetch, now: () => t, log: (l) => logs.push(l) });
  await p.tick();
  assert.equal(p.open, 0);
  assert.match(logs[0], /rate limited for 2s/);
  t += 1_000;
  await p.tick();
  assert.equal(hook.calls.length, 0);
  t += 1_500;
  await p.tick();
  assert.equal(p.open, 1);
  assert.equal(logs.at(-1), "discord: posting again");
  await p.drain();
  assert.equal(hook.calls.at(-1).method, "DELETE");
  assert.equal(p.open, 0);
});

test("a host's name cannot format or ping", () => {
  const t = roomText({ code: "X", host: "@everyone**", players: 1, seats: 8 });
  assert.ok(t.startsWith("**\\@everyone\\*\\*** is hosting"));
});
