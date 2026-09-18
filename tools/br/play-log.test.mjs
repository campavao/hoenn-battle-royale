// node --test tools/br/play-log.test.mjs
//
// The parser and the session builder, against lines copied from the live relay on
// 2026-09-18 (the first day it had a log worth reading) plus Kanto's cases, which
// this relay still logs the same way. Names and install ids are what the relay
// logged; the expectations are what the log says happened.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, parseHeartbeat, derive } from "./play-log.mjs";

const LINES = [
  // the live relay, 2026-09-18: a quick play that found nobody and hosted its own
  "2026-09-18T01:38:20.998Z open 100.64.0.3 (2/200)",
  "2026-09-18T01:38:29.765Z drop PLAYER#- (closed) after 9s | in list_roomsx1 | headroom 1199/1200",
  "2026-09-18T01:38:29.879Z open 100.64.0.4 (2/200)",
  "2026-09-18T01:38:30.018Z room DMD2KP hosted by CAM#1 (open)",
  "2026-09-18T01:38:30.086Z match DMD2KP started (quick) | 1 trainer | max 8",
  "2026-09-18T01:39:42.481Z drop CAM#1 room DMD2KP (closed) after 73s | in allx1998 can_hostx5 pingx3 quick_joinx1 host_roomx1 lock_roomx1 | headroom 1199/1200",
  "2026-09-18T01:39:42.481Z room DMD2KP closed (host_gone, no heir)",
  // ...and a hosted room with a joiner by code, the guest leaving first
  "2026-09-18T04:20:43.003Z room M9PMPT hosted by CAM#1 (open)",
  "2026-09-18T04:20:45.260Z room M9PMPT: CAM#2 joined",
  "2026-09-18T04:20:45.326Z match M9PMPT started (host) | 2 trainers | max 8",
  "2026-09-18T04:20:53.187Z drop CAM#2 room M9PMPT (closed) after 8s | in allx3 join_roomx1 can_hostx1 | headroom 1199/1200",
  "2026-09-18T04:20:53.188Z room M9PMPT: CAM#2 left",
  "2026-09-18T04:20:53.197Z drop CAM#1 room M9PMPT (closed) after 10s | in allx187 host_roomx1 can_hostx1 lock_roomx1 | headroom 1199/1200",
  "2026-09-18T04:20:53.197Z room M9PMPT closed (host_gone, no heir)",
  // the lobby's own socket, which only ever lists rooms: not a bounce
  "2026-09-18T04:32:31.685Z drop PLAYER#- (closed) after 11299s | in list_roomsx2255 pingx563 | headroom 1199/1200",
  // three friends on an older relay with no match lines: one hosts by HOST, two
  // join by code; the host drops mid third match and the room migrates
  "2026-09-06T06:40:28.894Z room SA8QBK hosted by RED#1 (open)",
  "2026-09-06T06:40:28.991Z stat eb5dd2d0f128b3ac v1 | solo +0 | since 2026-09-06",
  "2026-09-06T06:41:44.335Z room SA8QBK: RED#2 joined",
  "2026-09-06T06:41:44.453Z stat a6c9d924117a42a7 v1 | solo +0 | since 2026-09-06",
  "2026-09-06T06:44:22.770Z room SA8QBK seats 16",
  "2026-09-06T06:44:50.142Z room SA8QBK: RED#2 left",
  "2026-09-06T06:44:50.142Z drop RED#2 (closed) after 186s | in allx250 pingx37 infox13 can_hostx4 join_roomx1 statx1 tox1 leave_roomx1 | headroom 1195/1200",
  "2026-09-06T06:46:56.438Z room SA8QBK: BLUE#3 joined",
  "2026-09-06T06:46:56.559Z stat a6c9d924117a42a7 v1 | solo +0 | since 2026-09-06",
  "2026-09-06T06:48:28.732Z drop RED#1 room SA8QBK (closed) after 480s | in allx184 pingx91 infox31 lock_roomx5 can_hostx4 host_roomx1 statx1 tox1 set_maxx1 | headroom 1195/1200",
  "2026-09-06T06:48:28.733Z room SA8QBK: host RED#1 left, BLUE#3 promoted",
  "2026-09-06T06:49:52.667Z drop BLUE#3 room SA8QBK (closed) after 176s | in allx61 pingx35 infox12 can_hostx2 join_roomx1 statx1 lock_roomx1 | headroom 1195/1200",
  "2026-09-06T06:49:52.668Z room SA8QBK closed (host_gone, no heir)",
  // the daily, with a backlog of solo matches on its stat
  "2026-09-05T23:41:57.256Z room HKTWE2 hosted by CF#1 (daily)",
  "2026-09-05T23:41:57.348Z stat 864907c6cfb15675 v1 | solo +23 | since 2026-08-27",
  "2026-09-06T00:13:59.476Z room HKTWE2 closed (left, no heir)",
  "2026-09-06T00:13:59.476Z drop CF#1 (closed) after 1922s | in pingx384 infox129 can_hostx2 lock_roomx2 daily_joinx1 statx1 allx1 leave_roomx1 | headroom 1196/1200",
  // a quick play offered a running match that declined it
  "2026-09-06T00:37:40.284Z drop PLAYER#- (closed) after 7s | in quick_joinx1 pingx1 leave_roomx1 | headroom 1199/1200",
  // a spectator
  "2026-09-06T00:26:55.245Z room 5YKZAM hosted by CAM#1 (open)",
  "2026-09-06T00:38:34.641Z room 5YKZAM: RED#2 spectates",
  "2026-09-06T00:38:52.301Z room 5YKZAM: RED#2 left",
  "2026-09-06T00:38:52.301Z drop RED#2 (closed) after 20s | in pingx4 allx2 infox2 quick_joinx1 join_roomx1 can_hostx1 statx1 leave_roomx1 | headroom 1195/1200",
  "2026-09-06T00:38:55.076Z drop CAM#1 room 5YKZAM (closed) after 720s | in allx332 pingx143 infox48 can_hostx2 quick_joinx1 host_roomx1 statx1 lock_roomx1 | headroom 1111/1200",
  "2026-09-06T00:38:55.076Z room 5YKZAM closed (host_gone, no heir)",
  // a room still open when the log was read, behind a passcode
  "2026-09-18T13:50:01.391Z room ZZZZZZ hosted by CAM#1 (open) (passcode)",
  // a room whose host tabbed out and handed the match on (POK-247), and whose guest
  // dropped and came back on a token (POK-284): two humans, not three
  "2026-09-18T15:00:00.000Z room HANDOV hosted by KIT#1 (open)",
  "2026-09-18T15:00:30.000Z room HANDOV: FOX#2 joined",
  "2026-09-18T15:01:00.000Z match HANDOV started (host) | 2 trainers | max 8",
  "2026-09-18T15:02:00.000Z room HANDOV: host KIT#1 stood down, FOX#2 promoted",
  "2026-09-18T15:03:00.000Z room HANDOV: KIT#1 rejoined",
  "2026-09-18T15:09:00.000Z match HANDOV ended after 480s",
  "2026-09-18T15:10:00.000Z drop KIT#1 room HANDOV (closed) after 600s | in allx900 pingx240 lock_roomx2 host_roomx1 can_hostx3 | headroom 1195/1200",
  "2026-09-18T15:10:00.001Z room HANDOV closed (host_gone, no heir)",
  // the e2e suite against the live relay (web/e2e/live-room.spec.ts): its own room,
  // and a real room it walked into. Neither is play.
  "2026-09-18T16:00:00.000Z room E2EROM hosted by E2E#1 (open)",
  "2026-09-18T16:00:02.000Z room E2EROM: E2E#2 joined",
  "2026-09-18T16:00:02.100Z match E2EROM started (host) | 2 trainers | max 8",
  "2026-09-18T16:00:10.000Z drop E2E#2 room E2EROM (closed) after 8s | in allx3 join_roomx1 can_hostx1 | headroom 1199/1200",
  "2026-09-18T16:00:10.001Z room E2EROM: E2E#2 left",
  "2026-09-18T16:00:10.010Z drop E2E#1 room E2EROM (closed) after 10s | in allx187 host_roomx1 can_hostx1 lock_roomx1 | headroom 1199/1200",
  "2026-09-18T16:00:10.010Z room E2EROM closed (host_gone, no heir)",
  "2026-09-18T16:30:00.000Z room REAL01 hosted by OWL#1 (open)",
  "2026-09-18T16:30:05.000Z room REAL01: E2E#2 joined",
  "2026-09-18T16:30:06.000Z match REAL01 started (host) | 2 trainers | max 8",
  "2026-09-18T16:30:20.000Z drop OWL#1 room REAL01 (closed) after 20s | in allx50 host_roomx1 can_hostx1 lock_roomx1 | headroom 1199/1200",
  "2026-09-18T16:30:20.000Z room REAL01 closed (host_gone, no heir)",
];

const HEARTBEAT = "2026-09-18T04:24:12.760Z rooms 0/40 conns 1/200 | sent 1.2MB in 3002 lines | peak 2 rooms 4 conns | matches 2 | stats 3 (solo 7)";

const events = LINES.map(l => parseLine(l, "2026-09-18T00:00:00.000Z")).filter(Boolean);
const play = derive(events);
const room = code => play.sessions.find(s => s.code === code);

test("lines that say nothing about play parse to null", () => {
  assert.equal(parseLine("2026-09-18T01:38:20.998Z open 100.64.0.3 (2/200)", "x"), null);
  assert.equal(parseLine("Starting Container", "x"), null);
  assert.equal(parseLine("hoenn battle royale relay listening on 0.0.0.0:8080", "x"), null);
  assert.equal(parseLine(HEARTBEAT, "x"), null);
});

test("no name or wire id survives parsing", () => {
  const text = JSON.stringify(events);
  for (const word of ["RED", "BLUE", "CAM", "KIT", "FOX", "CF", "eb5dd2d0f128b3ac", "864907c6cfb15675"])
    assert.ok(!text.includes(word), `${word} leaked`);
});

test("the drop line is read whole", () => {
  const ev = parseLine(LINES[5], "x");
  assert.equal(ev.kind, "drop");
  assert.equal(ev.code, "DMD2KP");
  assert.equal(ev.why, "closed");
  assert.equal(ev.secs, 73);
  assert.equal(ev.sent.lock_room, 1);
  assert.equal(ev.sent.quick_join, 1);
  assert.equal(ev.sent.host_room, 1);
});

test("the live relay's quick play is quick, one trainer, one match, from the match line", () => {
  const s = room("DMD2KP");
  assert.equal(s.exact, true);
  assert.equal(s.mode, "quick");
  assert.equal(s.humans, 1);
  assert.equal(s.matches, 1);
  assert.equal(s.secs, 72);
});

test("the live relay's hosted room: two trainers, together, read from the match line", () => {
  const s = room("M9PMPT");
  assert.equal(s.exact, true);
  assert.equal(s.mode, "host");
  assert.equal(s.humans, 2);
  assert.equal(s.together, 2);
  assert.equal(s.matches, 1);
  assert.deepEqual(s.joins.map(j => j.how), ["code"]);
});

test("a hosted room with joiners by code on an old relay: matches from the room's locks", () => {
  const s = room("SA8QBK");
  assert.equal(s.exact, undefined);
  assert.equal(s.mode, "host");
  assert.equal(s.humans, 3);
  assert.equal(s.together, 2);
  // 5 locks from the opener + 1 from the heir = 6 -> three matches, not four
  assert.equal(s.matches, 3);
  assert.equal(s.migrated, 1);
  assert.equal(s.secs, 564);
  assert.equal(s.installs.length, 2);
  assert.deepEqual(s.versions, ["1"]);
});

test("the daily is the daily and two locks are one match", () => {
  const s = room("HKTWE2");
  assert.equal(s.mode, "daily");
  assert.equal(s.matches, 1);
  assert.equal(s.humans, 1);
});

test("a spectator counts as a spectator, not a human in the match", () => {
  const s = room("5YKZAM");
  assert.equal(s.mode, "quick");
  assert.equal(s.humans, 1);
  assert.equal(s.spectators, 1);
  assert.equal(s.matches, 1);
});

test("a quick play that never got a room number is a bounce; the lobby's list socket is not", () => {
  assert.equal(play.bounces.length, 1);
  assert.equal(play.bounces[0].tried, "quick");
  assert.equal(play.bounces[0].secs, 7);
});

test("a room open at the end of the record is live, passcode or not", () => {
  const s = room("ZZZZZZ");
  assert.equal(s.live, true);
  assert.equal(s.end, null);
  assert.equal(s.mode, "host");   // provisional until its opener drops
});

test("a host standing down and a guest rejoining are the same two people", () => {
  const s = room("HANDOV");
  assert.equal(s.humans, 2);
  assert.equal(s.together, 2);
  assert.equal(s.migrated, 1);
  assert.equal(s.matches, 1);
  assert.deepEqual(s.joins.map(j => j.how), ["code"], "a rejoin is not a join");
  assert.deepEqual(s.played.map(m => m.secs), [480]);
});

test("the e2e suite's rooms are not play: its own, and a real one it walked into", () => {
  assert.equal(room("E2EROM"), undefined);
  assert.equal(room("REAL01"), undefined);
  assert.ok(!play.sessions.some(s => s.code.startsWith("E2E")));
  assert.equal(parseLine(LINES[LINES.length - 12], "x").test, true, "the suite's own host line");
  assert.equal(parseLine(LINES[LINES.length - 4], "x").test, true, "the suite joining a real room");
  assert.equal(parseLine(LINES[LINES.length - 5], "x").test, undefined, "the real host is not the suite");
  assert.equal(parseLine("2026-09-18T16:00:00.000Z room X hosted by E2E#1 (open)", "x").test, true);
  assert.equal(parseLine("2026-09-18T16:00:00.000Z room X hosted by CAM#1 (open)", "x").test, undefined);
});

test("installs are counted across check-ins with their solo backlog", () => {
  const cf = play.installs.find(i => i.solo === 23);
  assert.ok(cf);
  assert.equal(cf.since, "2026-08-27");
  assert.equal(play.solo.length, 1);
  assert.equal(play.solo[0].n, 23);
  const twice = play.installs.find(i => i.checkins === 2);
  assert.ok(twice, "the joiner checked in twice on two connections");
});

test("sessions come newest first", () => {
  const at = play.sessions.map(s => s.at);
  assert.deepEqual(at, at.slice().sort().reverse());
});

test("the match lines are parsed whole", () => {
  const start = parseLine("2026-09-18T15:10:00.000Z match EXACT1 started (quick) | 3 trainers 1 watching | max 8", "x");
  assert.deepEqual(start, { t: "2026-09-18T15:10:00.000Z", kind: "match", code: "EXACT1",
                            mode: "quick", trainers: 3, watching: 1, max: 8 });
  const one = parseLine(LINES[4], "x");
  assert.equal(one.trainers, 1);
  assert.equal(one.watching, 0);
  const end = parseLine("2026-09-18T15:09:00.000Z match EXACT1 ended after 480s", "x");
  assert.deepEqual(end, { t: "2026-09-18T15:09:00.000Z", kind: "matchend", code: "EXACT1", secs: 480 });
});

test("the heartbeat is a snapshot, read whole", () => {
  assert.deepEqual(parseHeartbeat(HEARTBEAT), {
    at: "2026-09-18T04:24:12.760Z", rooms: 0, roomCap: 40, conns: 1, connCap: 200,
    peakRooms: 2, peakConns: 4, matches: 2, statSeen: 3, statSolo: 7,
    sent: "1.2MB", lines: 3002
  });
  assert.equal(parseHeartbeat(LINES[3]), null);
  const bare = parseHeartbeat("2026-09-18T01:29:12.000Z rooms 0/40 conns 0/200 | sent 0B in 0 lines | peak 0 rooms 0 conns");
  assert.equal(bare.matches, undefined);
  assert.equal(bare.lines, 0);
});
