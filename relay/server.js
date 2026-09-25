// The Battle Royale relay: N players in one room, every message forwarded.
//
// WebSocket, one JSON object per text frame -- ported from the Kanto relay's
// raw-TCP newline-JSON version (gen1recomp-multiplayer, mods/battle_royale/
// relay/server.js) so a browser, and anything else that only speaks
// WebSocket, can reach it without a TCP proxy in front. Nothing here knows
// what a battle or a step is: a room is a set of connections, and the
// server's whole job is to hand each message to the member it names (or to
// everyone else) and to keep the roster honest when someone drops. Game
// rules live in the host player's client.
//
// One dependency on purpose: `ws`. `npm i && node server.js` on any box with
// a public port is a deployment.
//
// Client -> server
//   {type:"host_room", name, open?, max?, -> room_hosted {code, id}, then a roster
//         skin?, pass?, patch?,            (max: the room's size; joins past it
//         protocol?}                       are refused "full"; clamped to the
//                                         member ceiling.  skin: the walk
//                                         sheet the lobby list draws the host
//                                         as.  pass: a passcode every join
//                                         must carry.  patch/protocol: the
//                                         host's version, recorded for the
//                                         gate below)
//   {type:"set_max", max}              -> host only: the room's size, live
//   {type:"set_pass", pass}            -> host only: the passcode, live; "" or
//                                         absent clears it.  A passcoded room
//                                         is listed with a lock, skipped by
//                                         quick_join, and joined only with
//                                         the matching `pass`
//   {type:"set_skin", skin}               what this member looks like, live
//   {type:"list_rooms"}                -> rooms {rooms:[{code, host, skin,
//                                         players, seats, pass}]}: every
//                                         lobby a stranger may walk into --
//                                         open, not mid-match, not the daily.
//                                         `players` counts trainers, never
//                                         watchers; `seats` is the host's MAX
//                                         as they set it; `pass` says a
//                                         passcode is needed.  A browser that
//                                         keeps asking is kept alive past the
//                                         unbound sweep.  Inside the half hour
//                                         before the DAILY GAME its row leads
//                                         the list: {host:"DAILY", daily:true,
//                                         secs, code: the room's or ""}
//   {type:"join_room", code, name,     -> room_joined {code, id, host}, or
//         spectate?, pass?, skin?,        room_error {reason}; spectate:true
//         patch?, protocol?}              enters a LOCKED room as a watcher
//                                        who is seated when it unlocks
//                                        (POK-133); a passcoded room refuses
//                                        "passcode" unless pass matches;
//                                        patch/protocol: this client's
//                                        version, checked against the host's
//   {type:"stat", id, v, solo, since}   how much play there has been: a random
//                                      install id, the mod version, solo matches
//                                      since the last one, and a first-seen date.
//                                      Never a trainer name. Logged, counted, not
//                                      answered -- the client sends it on a
//                                      connection it already had (POK-124).
//   {type:"lock_room", locked, bots?}  host only: refuse new joiners (a match
//                                      in progress).  Logged as one `match`
//                                      line at the lock and one at the
//                                      unlock -- the relay's only record of
//                                      a match as a thing that happened.
//                                      bots: the seats the host dealt its
//                                      bots, never handed to a member until
//                                      the unlock
//   {type:"kick", id}                  host only: remove a member and refuse
//                                      their address and their resume
//                                      token for the room's life (POK-130)
//   {type:"leave_room"}
//   {type:"can_host", ok}             may this client be promoted to host
//                                     if the current one drops (POK-116)
//   {type:"to", id, m}                 unicast m to one member
//   {type:"all", m}                    m to every other member
//   {type:"ping"}                      -> pong
//   {type:"info"}                      -> info {motd, rooms, conns, minProtocol,
//                                      daily?}: BR_MOTD as bounded rows, live
//                                      counts, minProtocol (see below), and
//                                      daily {secs, label} -- seconds until
//                                      the next BR_DAILY wall-clock time
//                                      (POK-161).  The same message is pushed
//                                      once, unasked, the moment a socket
//                                      connects, so a client learns
//                                      minProtocol before it sends anything.
//   {type:"daily_join", name}          -> the one shared DAILY GAME room:
//                                      joins it, creates it as its host, or
//                                      answers match_in_progress while its
//                                      match runs.  quick_join never seats
//                                      anyone in a daily room.
//   {type:"quick_join", name,          same as join_room, but the relay picks
//         patch?, protocol?}           the fullest open room rather than a code
// Server -> client
//   {type:"roster", code, host, open, max, pass, members:[{id,name,spectate?}]}
//                                      on every change (pass: whether a
//                                      passcode is set, never the code)
//   {type:"rooms", rooms:[...]}        the lobby list, see list_rooms
//   {type:"recv", from, m}
//   {type:"room_closed", reason}       the host left and nobody could take
//                                      the room over -- or, reason
//                                      "removed", the host showed YOU out
//   {type:"match_in_progress", code, members}  quick_join's third answer
//                                      (POK-133): nothing joinable, but a
//                                      match is running -- watch it and
//                                      play the next one
//   {type:"room_error", reason:        the host's client is on a different
//        "version", host:              patch or protocol than this one; the
//        {patch, protocol}}            reasons list above already has
//                                       "not_found"/"full"/"locked"/etc, this
//                                       adds one more
//
// Ids are 1..MAX_SEAT, the lowest one free: not a member's, not held for one
// who dropped, and not used since the match locked the door (nor a bot's).
// None left is `full`.  The host is whoever created the room.  Codes use the
// same 0/O/1/I/L-free
// alphabet as the game's room-code entry widget, so a code read aloud never
// has to be checked twice.

import http from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { WebSocketServer } from "ws";

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;

// The highest member id.  An id is the page's seat and the ROM's gBrMySeat,
// and both have 32 of them (web/src/net/wire.ts MAX_SEAT, br_config.h
// BR_MAX_SEATS); seat 0 is SOLO VS BOTS', so a room hands out 1..31.
export const MAX_SEAT = 31;

export const DEFAULT_LIMITS = Object.freeze({
  line: 16 * 1024,      // bytes per message; the game caps at the same order
  // Sustained rate, drained from a bucket -- NOT a per-second window.
  // Steps are ~4/s/player, so 120/s is a flood and not play; but a host
  // legitimately bursts far above its average in a single frame, and a
  // window counter cannot tell the two apart.  When the ring first shrinks,
  // every map it left behind runs out its grace on the SAME beat, and the
  // host retires each of their trainers with an npcout -- a few hundred
  // lines in one tick, from a client averaging four (POK-114).  It got
  // dropped for flooding, and with no host migration that ended the match.
  linesPerSec: 120,
  burstLines: 1200,     // bucket depth: one fog sweep, with room over it
  // The HOST's bucket is this many times deeper and refills this many
  // times faster.  A host speaks for every bot in the room -- one `place`
  // line per bot step, ~4/s each -- so thirty bots on the move alone reach
  // 120/s, the fog's beats add their spills and eliminations on top, and
  // the mirror hands each spectator every frame of every fight they look
  // at.  2026-09-14: a four-trainer match's host was dropped for flooding
  // at headroom 1/1200 half an hour in, and the room closed under three
  // spectators with "no heir".  A runaway client is still orders of
  // magnitude above this; the multiplier only lifts the ceiling off the
  // one connection whose legitimate rate scales with the room.
  hostLines: 4,
  // Bytes as well as lines (POK-330 #18): a line may be `line` bytes, so the
  // line bucket alone let one guest push 120 x 16 KB a second into a room
  // that hands each of them to fifteen others.  Play is a few KB a second; a
  // fog sweep or a spectator's catch-up is tens of KB at once.  The host's
  // bucket scales by hostLines, like its line bucket.
  bytesPerSec: 64 * 1024,
  burstBytes: 1024 * 1024,
  // A socket whose unsent output passes this is not reading.  A busy room
  // sends ~10 KB/s, so a megabyte is over a minute behind, and every byte of
  // it sits in this process's heap until it is dropped.
  sendBuffer: 1024 * 1024,
  badLines: 20,         // unparsable frames before we give up on a socket
  members: 16,
  // The widest room the lobby list may claim: the host's MAX as the mod
  // offers it (thirty, bots filling what humans do not), which is what a
  // browser is told as "1/30".  `members` above is how many HUMANS the
  // relay seats; `seats` is only ever a number on a list.
  seats: 30,
  // How long before the DAILY GAME's hour it takes a row on the lobby
  // list: a room the relay promises, whether or not anybody pressed the
  // row yet (the relay owns the clock)
  dailyListSecs: 30 * 60,
  // Ceilings, not targets.  A relay is billed by what it moves, and what
  // moves bytes is a live room: the host of a 30-bot match broadcasts ~40
  // small messages a second to everyone in it, so concurrent ROOMS -- not
  // connections -- decide the bill.  These are sized for a small hosted box;
  // BR_MAX_ROOMS / BR_MAX_CONNS raise them.
  rooms: 40,
  conns: 200,
  connsPerIp: 24,
  idleMs: 60_000,       // clients ping every few seconds
  unboundMs: 30_000,    // connected but never hosted/joined
  sweepMs: 5_000,
  // How long a seat is held for a member whose socket dropped (POK-284).
  // The page's own grace for a missing seat is ten seconds; this is
  // longer because the page's clock starts on the roster that says they
  // are gone, and a phone coming back from a tunnel takes what it takes.
  rejoinMs: 60_000,
});

// Env vars for the ceilings above.  A limit that is not a positive number is
// dropped with a log line, not used: NaN compares false with everything, so
// BR_MAX_ROOMS=forty used to switch the room cap off rather than set it.
const ENV_LIMITS = {
  BR_MAX_ROOMS: "rooms",
  BR_MAX_CONNS: "conns",
  BR_LINES_PER_SEC: "linesPerSec",
  BR_BURST_LINES: "burstLines",
};

export function limitsFromEnv(env, log = () => {}) {
  const limits = {};
  for (const [name, key] of Object.entries(ENV_LIMITS)) {
    if (env[name] === undefined || env[name] === "") continue;
    const n = Number(env[name]);
    if (Number.isFinite(n) && n > 0) limits[key] = n;
    else log(`ignoring ${name}=${JSON.stringify(env[name])}: not a positive number`);
  }
  return limits;
}

// The message types handle() answers.  The per-connection census counts
// these by name and everything else as "other": keyed by whatever string a
// client sent, it was a Map that grew by one entry per junk type for the
// life of the socket (16 MB from one probe, POK-330 #18).
const HANDLED = new Set([
  "ping", "info", "list_rooms", "daily_join", "host_room", "join_room",
  "quick_join", "set_open", "set_max", "set_pass", "set_skin", "lock_room",
  "can_host", "kick", "leave_room", "to", "all", "stat",
]);

const NAME_MAX = 10;
// A passcode: the code-entry alphabet, one to eight of them, uppercased so
// the one the host set and the one a guest scrubbed in always compare.
const PASS_RE = /^[A-Z0-9]{1,8}$/;
// A skin is a walk-sheet id ("SPRITE_HIKER"): letters, digits, underscores,
// bounded, and never interpreted here -- the client that draws the list
// falls back to an outline for a sheet it does not have.
const SKIN_RE = /^[A-Z0-9_]{1,24}$/;

export function cleanPass(pass) {
  if (typeof pass !== "string") return null;
  const up = pass.trim().toUpperCase();
  return PASS_RE.test(up) ? up : null;
}

function cleanSkin(skin) {
  return typeof skin === "string" && SKIN_RE.test(skin) ? skin : undefined;
}

// A version stamp, if the client sent one at all.  Older clients send
// neither field, and the gate below treats "nothing sent" as "nothing to
// check" on both ends -- a version gate that refuses a client for saying
// less than a newer one would is worse than no gate.
function cleanVersion(msg) {
  const patch = typeof msg.patch === "string" && msg.patch.length <= 32 ? msg.patch : undefined;
  const protocol = Number.isInteger(msg.protocol) ? msg.protocol : undefined;
  if (patch === undefined && protocol === undefined) return null;
  return { patch, protocol };
}

// Bytes actually written, so "what is this costing" has an answer that is not
// a guess.  Egress is the line item that scales with players.
const traffic = { bytesOut: 0, linesOut: 0, roomsOpened: 0, peakRooms: 0,
                  peakConns: 0, rejected: 0, statSolo: 0, statSeen: 0,
                  matches: 0 };

export function stats() { return { ...traffic }; }

function human(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + "KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + "MB";
  return (bytes / 1073741824).toFixed(2) + "GB";
}

// The message of the day, served to any client that asks (POK-161): the
// official game time, authored as the BR_MOTD env var so changing the
// schedule edits one Railway variable and never ships a mod release.
// Bounded here, not trusted there: the Gen 1 text box is 17 cells wide
// and three rows is all the lobby can spare, and an env var is still
// input.  Rows split on real newlines or a literal backslash-n, since
// env editors rarely take the real thing.
export function cleanMotd(text) {
  if (typeof text !== "string" || !text) return [];
  const rows = [];
  for (const line of text.split(/\\n|\n/)) {
    const clean = line.replace(/[^ -~]/g, "").trim().slice(0, 17);
    if (clean) rows.push(clean);
    if (rows.length >= 3) break;
  }
  return rows;
}

// The DAILY GAME (POK-161 v2): one scheduled match a day, at a wall-clock
// time the server owns.  BR_DAILY is "HH:MM|IANA timezone|label", e.g.
// "19:00|America/Chicago|7PM CENTRAL".  The relay never starts anything --
// it serves the seconds until the next occurrence and the daily room's
// host client arms its own start clock from that.
export function parseDaily(text) {
  if (typeof text !== "string" || !text) return null;
  const [time, tz, label] = text.split("|");
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  if (!m || !tz) return null;
  const hour = Number(m[1]) % 24;
  const minute = Number(m[2]) % 60;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return null;
  }
  return { hour, minute, tz, label: cleanMotd(label || "")[0] || "" };
}

// Seconds until the next HH:MM in tz.  Reads the wall clock THERE via
// Intl, so DST is the zone's problem, not ours; the one soft spot is the
// transition night itself, where this can be off by the shifted hour.
export function dailySecondsUntil(daily, from = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: daily.tz, hour12: false,
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(from);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const nowSecs = (get("hour") % 24) * 3600 + get("minute") * 60 + get("second");
  let d = daily.hour * 3600 + daily.minute * 60 - nowSecs;
  if (d <= 0) d += 86400;
  return d;
}

function cleanName(name) {
  if (typeof name !== "string") return "PLAYER";
  const out = name.replace(/[^\x20-\x7e]/g, "").trim().slice(0, NAME_MAX);
  return out === "" ? "PLAYER" : out;
}

function makeCode(taken) {
  for (let attempt = 0; attempt < 64; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    if (!taken.has(code)) return code;
  }
  throw new Error("relay: could not allocate a room code");
}

// The origin allow-list (BR_ORIGINS): comma-separated, checked in the
// upgrade handler before the WebSocket handshake completes.  An empty list
// allows everything, so a bare checkout with no env set still works for
// local dev and for clients (the game itself) that send no Origin header at
// all -- a browser always sends one, a WebSocket client library often does
// not, and refusing "no origin" would refuse every non-browser player.
export function parseOrigins(text) {
  if (typeof text !== "string" || !text.trim()) return null; // null = allow all
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export function originAllowed(allowlist, origin) {
  if (!allowlist) return true;
  if (!origin) return true;
  return allowlist.includes(origin);
}

// Who a connection is, for the per-IP cap and a kick's ban (POK-330 #19).
// Behind a proxy -- Railway's edge -- every socket's own address is the
// proxy's, so strangers shared one cap and a kick banned everybody who came
// through the same edge.  With trustProxy (BR_TRUST_PROXY=1) the address is
// the proxy's X-Real-IP, or failing that the entry it APPENDED to
// X-Forwarded-For (the last one: the ones before it are whatever the client
// sent).  Off by default, because without a proxy in front both headers are
// the client's to invent.
const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;

export function clientAddress(req, trustProxy) {
  const direct = (req.socket && req.socket.remoteAddress) || "?";
  if (!trustProxy) return direct;
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && IP_RE.test(real.trim())) return real.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const appended = forwarded.split(",").pop().trim();
    if (IP_RE.test(appended)) return appended;
  }
  return direct;
}

class Room {
  constructor(code, host, max) {
    this.code = code;
    this.host = host;
    this.members = new Map();
    // How many have come in, for seniority: ids are reused now, so the
    // lowest one is no longer the longest-standing (heirOf).
    this.joined = 0;
    // Ids spoken for since the match locked the door (POK-330 #6): everyone
    // in the room or held at the lock, everyone seated since, and the seats
    // the host dealt its bots.  An id in here is somebody's ghost, loot keys
    // and roster row on every page and ROM until the match ends, so no
    // latecomer is handed it.  Emptied at the unlock.
    this.spent = new Set();
    this.locked = false;
    // an open room is one quick_join is allowed to hand strangers; a room
    // is private until its host says otherwise
    this.open = false;
    // how many may be in it: the host's MAX (the lobby's row), never more
    // than the relay's own member ceiling.  `full` past it.
    this.max = max;
    // the size the host ASKED for, for the lobby list's "n/30": max above
    // is clamped to the human ceiling, and a room of thirty with fourteen
    // bot seats still reads as a room of thirty to somebody choosing one
    this.seats = max;
    // A passcode (string) or null.  Not `locked`: that is a match in
    // progress.  A passcoded room stays on the lobby list, with a lock,
    // and takes the code at the door; quick_join walks past it.
    this.pass = null;
    // How the room came to be, for the match line: "quick" when its
    // opener arrived by quick_join and found nothing, "daily" for the
    // shared daily room, "host" for the lobby's HOST row.  Fixed at
    // opening -- an heir after a migration inherits the room, not a mode.
    this.mode = "host";
    // when the current match locked the door, or null between matches
    this.lockedAt = null;
    // Addresses the host has removed (POK-130).  Per-room and in-memory,
    // like everything else here: a removal lasts as long as the room does.
    // Coarse (a shared NAT goes together), but the alternative is a removed
    // guest quick-joining straight back in, which makes the REMOVE row a
    // revolving door.
    this.banned = new Set();
    // ...and the resume tokens they held (POK-330 #19).  An address is
    // coarse both ways: behind one proxy it is everybody's, and a phone
    // changes it walking out of wifi.  The token is the removed client's
    // own, and its page presents it on every automatic rejoin.
    this.bannedTokens = new Set();
    // The host's {patch, protocol}, from host_room -- null when the host's
    // client sent neither (an older client, or one that opts out of the
    // gate entirely).
    this.version = null;
    // Seats held for members whose socket dropped (POK-284), by resume
    // token: the id and what the member was when they went, kept for
    // limits.rejoinMs.  A returning client presents the token and gets
    // the same id back -- and the id is the page's seat, so its ghost, its
    // loot keys, its spectator target and everything in flight still fit.
    this.held = new Map();
  }

  // The id the next newcomer gets: the lowest in 1..MAX_SEAT that nobody is
  // in, nobody is coming back to, and the running match has not already
  // used (POK-330 #6).  It used to be a counter that only went up, so each
  // reload spent an id, and a room that had seen 32 arrivals handed out ids
  // no page, wire message or ROM table has a slot for.  Null when none is
  // left, which the doors answer as `full`.
  freeId() {
    const taken = new Set(this.members.keys());
    for (const held of this.held.values()) taken.add(held.id);
    for (let id = 1; id <= MAX_SEAT; id++) {
      if (!taken.has(id) && !this.spent.has(id)) return id;
    }
    return null;
  }

  // Would a newcomer be turned away?  Past the host's MAX, or out of ids.
  full() {
    return this.members.size >= this.max || this.freeId() === null;
  }

  // The door shuts on a match (or opens after one).  Shutting spends every id
  // in the room or held; `bots` are the seats the host dealt its bots, sent
  // in a second lock once it has dealt them.  A seat held for a dropped
  // member that a bot now has is not theirs to come back to: they get a
  // new one rather than a bot's.
  setLocked(locked, bots) {
    const was = this.locked;
    this.locked = locked;
    if (!locked) { this.spent.clear(); return; }
    if (!was) {
      for (const id of this.members.keys()) this.spent.add(id);
      for (const held of this.held.values()) this.spent.add(held.id);
    }
    for (const id of bots) {
      this.spent.add(id);
      for (const [token, held] of this.held) {
        if (held.id === id) this.held.delete(token);
      }
    }
  }

  // A member's seat, and a fresh token that can claim it back.  With a
  // `token` that names a held seat, the SAME id as before; otherwise the
  // lowest free one (the caller has checked full() first).  The token is new
  // either way: the old one has done its job.
  add(conn, token) {
    const held = token ? this.held.get(token) : undefined;
    if (held) {
      this.held.delete(token);
      conn.id = held.id;
      conn.joined = held.joined;
      conn.canHost = held.canHost;
      conn.spectator = held.spectator;
    } else {
      conn.id = this.freeId();
      conn.joined = ++this.joined;
    }
    if (this.locked) this.spent.add(conn.id);
    conn.token = randomBytes(12).toString("hex");
    conn.room = this;
    this.members.set(conn.id, conn);
    return conn.id;
  }

  // Keep a dropped member's seat for a while.  Not for one who LEFT, and
  // not for one shown the door: a removal is meant to stick.
  hold(conn, now) {
    if (!conn.token) return;
    this.held.set(conn.token, { id: conn.id, name: conn.name, canHost: conn.canHost,
                                spectator: conn.spectator, joined: conn.joined, at: now });
  }

  // Is this token a seat this room is still holding?
  holding(token, now, rejoinMs) {
    const held = typeof token === "string" ? this.held.get(token) : undefined;
    if (!held) return false;
    if (now - held.at > rejoinMs) { this.held.delete(token); return false; }
    return true;
  }

  expireHeld(now, rejoinMs) {
    for (const [token, held] of this.held) {
      if (now - held.at > rejoinMs) this.held.delete(token);
    }
  }

  remove(conn) {
    this.members.delete(conn.id);
    conn.room = null;
  }

  roster() {
    const members = [];
    for (const m of this.members.values()) {
      members.push({ id: m.id, name: m.name,
                     spectate: m.spectator || undefined });
    }
    return { type: "roster", code: this.code, host: this.host.id,
             open: this.open, max: this.max, pass: this.pass !== null,
             members };
  }

  // trainers seated, never watchers: a list that said 3/30 for a lobby
  // with two people and a camera would be lying about the match
  trainerCount() {
    let n = 0;
    for (const m of this.members.values()) if (!m.spectator) n += 1;
    return n;
  }

  // The row the lobby list shows for this room.  The host's name and
  // skin, never their id or IP; the passcode's existence, never the code.
  listing() {
    return { code: this.code, host: this.host.name, skin: this.host.skin,
             players: this.trainerCount(), seats: this.seats,
             pass: this.pass !== null };
  }

  // Serialized once for the whole room, not once per member: a host's place
  // or ring line goes to everybody, and this is the relay's hottest path.
  broadcast(msg, except) {
    const line = JSON.stringify(msg);
    const bytes = Buffer.byteLength(line);
    for (const m of this.members.values()) {
      if (m !== except) m.sendRaw(line, bytes);
    }
  }
}

class Conn {
  constructor(ws, ip, relay) {
    this.ws = ws;
    this.relay = relay;
    this.ip = ip || "?";
    this.id = null;
    this.room = null;
    this.name = "PLAYER";
    this.skin = undefined;
    this.lastSeen = Date.now();
    this.openedAt = this.lastSeen;
    // when this connection last asked for the lobby list: a browser is
    // unbound by definition, and the sweep must not take it mid-look
    this.browsedAt = 0;
    this.tokens = relay.limits.burstLines;
    this.byteTokens = relay.limits.burstBytes;
    this.tokenAt = this.lastSeen;
    this.minTokens = this.tokens;   // how close real play came to the wall
    this.badLines = 0;
    this.closed = false;
    // What this connection actually moved, by message TYPE and bytes
    // (POK-86).  Per-message logging on a relay carrying a match's
    // movement would be its own denial of service, and the payloads are
    // the players' business -- but a count per type, printed once when
    // the connection goes, is what tells you afterwards whether a client
    // that "froze" had stopped sending or stopped being heard.
    this.seen = new Map();
    this.bytesIn = 0;
    // POK-116: whether this client has said it can take the room over.
    // Opt-in rather than assumed, because a client that does not understand
    // migration would be promoted into owning a fog clock it never received
    // and restart the ring at phase 1.  Silence means "close the room", the
    // behaviour every client already expects.
    this.canHost = false;
  }

  note(type, bytes) {
    const key = HANDLED.has(type) ? type : "other";
    this.seen.set(key, (this.seen.get(key) || 0) + 1);
    this.bytesIn += bytes;
  }

  census() {
    if (this.seen.size === 0) return "nothing";
    return [...this.seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${type}x${n}`)
      .join(" ");
  }

  send(msg) {
    if (this.closed) return;
    const line = JSON.stringify(msg);
    this.sendRaw(line, Buffer.byteLength(line));
  }

  // One already-serialized line, and its byte count for the traffic total.
  sendRaw(line, bytes) {
    if (this.closed) return;
    // ws queues whatever a socket cannot take yet, without limit.  A client
    // that stops reading -- a frozen tab, or one doing it on purpose -- would
    // grow that queue until the process ran out of heap and dropped every
    // room, so it goes first.
    if (this.ws.bufferedAmount > this.relay.limits.sendBuffer) {
      this.destroy("slow_consumer");
      return;
    }
    try {
      traffic.bytesOut += bytes;
      traffic.linesOut += 1;
      this.ws.send(line);
    } catch {
      this.destroy("write_failed");
    }
  }

  destroy(reason) {
    if (this.closed) return;
    this.closed = true;
    // Why a connection went away is the first thing you need when a match
    // breaks, and "the client just vanished" is indistinguishable from
    // "we dropped them for flooding" without it.
    this.relay.log(`drop ${this.name}#${this.id ?? "-"}`
      + `${this.room ? ` room ${this.room.code}` : ""} (${reason})`
      + ` after ${Math.round((Date.now() - this.openedAt) / 1000)}s`
      + ` | in ${this.census()}`
      + ` | headroom ${Math.round(this.minTokens)}/${this.relay.limits.burstLines}`);
    this.relay.onClose(this, reason);
    try { this.ws.terminate(); } catch { /* already gone */ }
  }
}

export function createRelay(options = {}) {
  const log = options.log || (() => {});
  // Every ceiling is a positive number or it is the default: a NaN or a zero
  // here would not fail loudly, it would quietly switch the cap off.
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(options.limits || {})) {
    if (Number.isFinite(value) && value > 0) limits[key] = value;
    else log(`limit ${key}=${value} is not a positive number: keeping ${DEFAULT_LIMITS[key]}`);
  }
  // a host's MAX: a whole number from two up to the member ceiling; anything
  // else (an older client sends nothing) is the ceiling
  const cleanMax = (n) => Number.isInteger(n)
    ? Math.max(2, Math.min(limits.members, n)) : limits.members;
  // the same number for the list, clamped to the seat ceiling instead of
  // the human one -- an older client sends nothing, and reads as the
  // human ceiling it is actually held to
  const cleanSeats = (n) => Number.isInteger(n)
    ? Math.max(2, Math.min(limits.seats, n)) : limits.members;
  const motd = cleanMotd(options.motd ?? process.env.BR_MOTD);
  const daily = parseDaily(options.daily ?? process.env.BR_DAILY);
  const minProtocol = Number.isInteger(options.minProtocol)
    ? options.minProtocol
    : Number(process.env.BR_MIN_PROTOCOL || 1);
  const originAllowlist = "origins" in options
    ? options.origins
    : parseOrigins(process.env.BR_ORIGINS);
  const trustProxy = "trustProxy" in options
    ? options.trustProxy === true
    : process.env.BR_TRUST_PROXY === "1";
  const rooms = new Map();
  const conns = new Set();
  const perIp = new Map();

  // Who inherits a room whose host just went.  The longest-standing member
  // that said it could take it -- the earliest arrival, by the room's own
  // count rather than by id, since ids are reused -- is the one that has
  // seen the most of the match.  The relay knows nothing about who is still
  // alive -- that is the client's business, and a client that has been
  // eliminated withdraws by sending can_host false.
  function heirOf(room) {
    let heir = null;
    for (const m of room.members.values()) {
      if (m.canHost && (!heir || m.joined < heir.joined)) heir = m;
    }
    return heir;
  }

  function leaveRoom(conn, reason) {
    const room = conn.room;
    if (!room) return;
    room.remove(conn);
    // A dropped socket keeps its seat for a while (POK-284); a member who
    // said "leave_room" does not, and neither does one the host removed.
    if (reason !== "left" && reason !== "removed") room.hold(conn, Date.now());
    if (room.host === conn) {
      // Host migration (POK-116).  The host's client is the match authority,
      // but every guest already mirrors the world it is authoritative over --
      // where each trainer stands, what has spilled, which trainers the fog
      // took, where the ring is -- and the rest (bot names, teams, walks, the
      // ring's eye) derives from the shared seed.  So the room can outlive
      // the machine that opened it.
      //
      // No new message is needed to say so: the roster already carries
      // `host`, and lib/relay.lua already adopts it, so isHost() flips on the
      // client the moment this broadcast lands.
      const heir = heirOf(room);
      if (heir) {
        room.host = heir;
        room.broadcast(room.roster());
        log(`room ${room.code}: host ${conn.name}#${conn.id} left,`
            + ` ${heir.name}#${heir.id} promoted`);
        return;
      }
      // Nobody could take it: the old ending, for a room of old clients or
      // one whose last eligible member has been eliminated.
      room.broadcast({ type: "room_closed", reason: reason || "host_left" });
      for (const m of [...room.members.values()]) {
        room.remove(m);
      }
      rooms.delete(room.code);
      log(`room ${room.code} closed (${reason || "host_left"}, no heir)`);
    } else {
      room.broadcast(room.roster());
      log(`room ${room.code}: ${conn.name}#${conn.id} left`);
    }
  }

  function infoFor() {
    return { type: "info", motd, rooms: rooms.size, conns: conns.size,
             minProtocol,
             daily: daily ? { secs: dailySecondsUntil(daily),
                              label: daily.label } : undefined };
  }

  // The version gate (minimal, additive): a client may say what it is
  // running, and if the room's host said something too, the two must
  // agree. Either side saying nothing skips the check entirely -- an
  // older client, on either end, is never refused for silence.
  function versionMismatch(room, clientVersion) {
    if (!room.version || !clientVersion) return false;
    if (clientVersion.patch !== undefined && room.version.patch !== undefined
        && clientVersion.patch !== room.version.patch) return true;
    if (clientVersion.protocol !== undefined && room.version.protocol !== undefined
        && clientVersion.protocol !== room.version.protocol) return true;
    return false;
  }

  function handle(conn, msg) {
    switch (msg.type) {
      case "ping":
        conn.send({ type: "pong", t: msg.t });
        return;

      // "Is anybody out there?" answered honestly (POK-161): the motd
      // (the official game time) and the live counts.  Presence beats
      // any schedule line, so both travel together and the client picks.
      case "info":
        conn.send(infoFor());
        return;

      // The lobby list: every room a stranger could walk into right now,
      // fullest first, so the browser's top row is where the people are.
      // The same door quick_join uses -- open, not mid-match, not the
      // daily, not a room this IP was removed from -- with the passcoded
      // rooms kept IN, marked, because "I know the host" is exactly what a
      // list is for.  A full room is listed too: its count says why the
      // door will not open, which beats it vanishing.
      case "list_rooms": {
        conn.browsedAt = Date.now();
        const list = [];
        for (const room of rooms.values()) {
          if (!room.open || room.locked || room.daily
              || room.banned.has(conn.ip)) continue;
          list.push(room.listing());
        }
        list.sort((a, b) => b.players - a.players || (a.code < b.code ? -1 : 1));
        // The DAILY GAME (2026-09-13): inside the last half hour before
        // its hour, one row at the top -- whether or not anybody has
        // pressed the row yet, since the relay owns the clock and can
        // promise the room.  `secs` is the countdown; picking it is
        // daily_join, which creates the room or seats you in it.  A
        // daily match already running is a locked room: no row.
        if (daily) {
          const secs = dailySecondsUntil(daily);
          let waiting = null, running = false;
          for (const room of rooms.values()) {
            if (!room.daily) continue;
            if (room.locked) running = true; else waiting = waiting || room;
          }
          if (secs <= limits.dailyListSecs && !running) {
            list.unshift({ code: waiting ? waiting.code : "", host: "DAILY",
                           daily: true, secs,
                           players: waiting ? waiting.trainerCount() : 0,
                           seats: limits.seats, pass: false });
          }
        }
        conn.send({ type: "rooms", rooms: list });
        return;
      }

      // The DAILY GAME's one door (POK-161 v2): everyone who presses the
      // row lands in the SAME room.  First in becomes its host; a locked
      // daily room is the official match running, which is the POK-133
      // spectate answer; and quick_join never seats anyone here, because
      // a lobby that starts at 7pm is the opposite of "a game right now".
      case "daily_join": {
        if (conn.room) { conn.send({ type: "room_error", reason: "already_in_room" }); return; }
        let open = null, running = null;
        for (const room of rooms.values()) {
          if (!room.daily || room.banned.has(conn.ip)) continue;
          if (room.full()) continue;
          if (room.locked) { running = running || room; continue; }
          open = open || room;
        }
        if (open) {
          conn.name = cleanName(msg.name);
          open.add(conn);
          conn.send({ type: "room_joined", code: open.code, id: conn.id, host: open.host.id, token: conn.token });
          open.broadcast(open.roster());
          log(`room ${open.code}: ${conn.name}#${conn.id} joined the daily`);
          return;
        }
        if (running) {
          conn.send({ type: "match_in_progress", code: running.code,
                      members: running.members.size });
          return;
        }
        if (rooms.size >= limits.rooms) {
          traffic.rejected += 1;
          conn.send({ type: "room_error", reason: "server_full" });
          return;
        }
        conn.name = cleanName(msg.name);
        const room = new Room(makeCode(rooms), conn, limits.members);
        room.daily = true;
        room.mode = "daily";
        room.open = true;   // discoverable for spectate; quick_join skips it
        rooms.set(room.code, room);
        room.add(conn);
        traffic.roomsOpened += 1;
        if (rooms.size > traffic.peakRooms) traffic.peakRooms = rooms.size;
        conn.send({ type: "room_hosted", code: room.code, id: conn.id, token: conn.token });
        conn.send(room.roster());
        log(`room ${room.code} hosted by ${conn.name}#${conn.id} (daily)`);
        return;
      }

      case "host_room": {
        if (conn.room) { conn.send({ type: "room_error", reason: "already_in_room" }); return; }
        if (rooms.size >= limits.rooms) {
          traffic.rejected += 1;
          conn.send({ type: "room_error", reason: "server_full" });
          log(`room refused: at the ${limits.rooms}-room ceiling`);
          return;
        }
        conn.name = cleanName(msg.name);
        conn.skin = cleanSkin(msg.skin);
        const room = new Room(makeCode(rooms), conn, cleanMax(msg.max));
        room.seats = cleanSeats(msg.max);
        room.open = msg.open === true;
        room.pass = cleanPass(msg.pass);
        room.version = cleanVersion(msg);
        if (conn.seen.get("quick_join")) room.mode = "quick";
        rooms.set(room.code, room);
        room.add(conn);
        traffic.roomsOpened += 1;
        if (rooms.size > traffic.peakRooms) traffic.peakRooms = rooms.size;
        conn.send({ type: "room_hosted", code: room.code, id: conn.id, token: conn.token });
        conn.send(room.roster());
        log(`room ${room.code} hosted by ${conn.name}#${conn.id}` +
            (room.open ? " (open)" : "") + (room.pass ? " (passcode)" : ""));
        return;
      }

      case "join_room": {
        if (conn.room) { conn.send({ type: "room_error", reason: "already_in_room" }); return; }
        const code = typeof msg.code === "string" ? msg.code.toUpperCase() : "";
        const room = rooms.get(code);
        if (!room) { conn.send({ type: "room_error", reason: "not_found" }); return; }
        if (room.banned.has(conn.ip)
            || (typeof msg.token === "string" && room.bannedTokens.has(msg.token))) {
          conn.send({ type: "room_error", reason: "removed" });
          return;
        }
        // The passcode is checked before the door's state is told: a
        // stranger without it learns nothing about the room past "not
        // yours".  Watchers need it too -- a passcoded room is a room
        // with friends in it, and the match is theirs to show.
        if (room.pass !== null && cleanPass(msg.pass) !== room.pass) {
          conn.send({ type: "room_error", reason: "passcode" });
          return;
        }
        if (versionMismatch(room, cleanVersion(msg))) {
          conn.send({ type: "room_error", reason: "version", host: room.version });
          return;
        }
        // Coming back to a seat the room is still holding (POK-284): the
        // door's state is not asked, because they were already inside.
        // A stale or unknown token is an ordinary join.
        const resuming = room.holding(msg.token, Date.now(), limits.rejoinMs);
        // A spectator's door opens where a player's is barred (POK-133):
        // lock_room exists to stop competitors joining a running match,
        // and somebody who asks to WATCH is not one.  The flag rides the
        // roster so every client knows who is a guest of the next match
        // rather than a trainer in this one.
        const spectate = msg.spectate === true;
        if (!resuming) {
          if (room.locked && !spectate) { conn.send({ type: "room_error", reason: "locked" }); return; }
          if (room.full()) { conn.send({ type: "room_error", reason: "full" }); return; }
        }
        conn.name = cleanName(msg.name);
        conn.skin = cleanSkin(msg.skin);
        conn.spectator = spectate || undefined;
        room.add(conn, resuming ? msg.token : undefined);
        conn.send({ type: "room_joined", code: room.code, id: conn.id, host: room.host.id, token: conn.token });
        room.broadcast(room.roster());
        log(`room ${room.code}: ${conn.name}#${conn.id} ${resuming ? "rejoined" : spectate ? "spectates" : "joined"}`);
        return;
      }

      // Quick play: the point is that a newcomer needs nothing from anyone
      // -- no code read out over voice chat, no friend already playing.  We
      // pick the FULLEST joinable room rather than the first, so strangers
      // gather into one match instead of scattering one-per-room.
      case "quick_join": {
        if (conn.room) { conn.send({ type: "room_error", reason: "already_in_room" }); return; }
        let best = null;
        for (const room of rooms.values()) {
          // a daily room waits for its hour; quick play wants a game NOW,
          // and a passcoded room wants somebody who knows the host
          if (!room.open || room.locked || room.daily || room.pass !== null
              || room.banned.has(conn.ip)) continue;
          if (room.full()) continue;
          if (!best || room.members.size > best.members.size) best = room;
        }
        if (!best) {
          // Nothing joinable -- but is something RUNNING?  (POK-133.)  A
          // locked open room is a match in progress, and "no open rooms"
          // used to be the answer even while one was live -- the arrival
          // hosted their own bot game one wall away from the only other
          // human online.  Name the fullest one instead; the client may
          // join it as a spectator and be seated in the next match.
          let running = null;
          for (const room of rooms.values()) {
            if (!room.open || !room.locked || room.pass !== null
                || room.banned.has(conn.ip)) continue;
            if (room.full()) continue;
            if (!running || room.members.size > running.members.size) running = room;
          }
          if (running) {
            conn.send({ type: "match_in_progress", code: running.code,
                        members: running.members.size });
            return;
          }
          conn.send({ type: "no_open_rooms" });
          return;
        }
        if (versionMismatch(best, cleanVersion(msg))) {
          conn.send({ type: "room_error", reason: "version", host: best.version });
          return;
        }
        conn.name = cleanName(msg.name);
        conn.skin = cleanSkin(msg.skin);
        best.add(conn);
        conn.send({ type: "room_joined", code: best.code, id: conn.id, host: best.host.id, token: conn.token });
        best.broadcast(best.roster());
        log(`room ${best.code}: ${conn.name}#${conn.id} quick-joined`);
        return;
      }

      case "set_open": {
        const room = conn.room;
        if (!room || room.host !== conn) return;
        room.open = msg.open === true;
        room.broadcast(room.roster());
        log(`room ${room.code} is now ${room.open ? "open" : "private"}`);
        return;
      }

      case "set_max": {
        const room = conn.room;
        if (!room || room.host !== conn) return;
        room.max = cleanMax(msg.max);
        room.seats = cleanSeats(msg.max);
        room.broadcast(room.roster());
        log(`room ${room.code} seats ${room.max}`);
        return;
      }

      // The host puts a passcode on the door, or takes it off.  The
      // roster carries only THAT it is set, so a guest's client can show
      // the lock without ever holding the code.
      case "set_pass": {
        const room = conn.room;
        if (!room || room.host !== conn) return;
        const was = room.pass;
        room.pass = cleanPass(msg.pass);
        if ((was !== null) !== (room.pass !== null)) {
          room.broadcast(room.roster());
        }
        log(`room ${room.code} ${room.pass ? "now needs a passcode" : "needs no passcode"}`);
        return;
      }

      // What this member looks like, for the lobby list -- the host's is
      // the one drawn, but the room can change hands (POK-116), so every
      // member keeps theirs current.
      case "set_skin":
        conn.skin = cleanSkin(msg.skin);
        return;

      case "lock_room": {
        const room = conn.room;
        if (!room || room.host !== conn) return;
        const was = room.locked;
        // The host's second lock carries the seats it dealt its bots, which
        // the relay must not hand a latecomer (POK-330 #6)
        const bots = Array.isArray(msg.bots)
          ? msg.bots.slice(0, MAX_SEAT + 1)
              .filter((id) => Number.isInteger(id) && id >= 1 && id <= MAX_SEAT)
          : [];
        room.setLocked(msg.locked !== false, bots);
        // The lock IS the match starting and the unlock IS it ending, and
        // until this line the only trace either left was a lock_room count
        // on the host's drop line -- from which "how many matches, with
        // how many people" had to be inferred.  One line each way, with
        // the room's mode and who was seated, so the record is exact.
        if (room.locked && !was) {
          let trainers = 0, watching = 0;
          for (const m of room.members.values()) {
            if (m.spectator) watching += 1; else trainers += 1;
          }
          room.lockedAt = Date.now();
          traffic.matches += 1;
          log(`match ${room.code} started (${room.mode})`
              + ` | ${trainers} trainer${trainers === 1 ? "" : "s"}`
              + (watching ? ` ${watching} watching` : "")
              + ` | max ${room.max}`);
        } else if (!room.locked && was && room.lockedAt) {
          log(`match ${room.code} ended after`
              + ` ${Math.round((Date.now() - room.lockedAt) / 1000)}s`);
          room.lockedAt = null;
        }
        // The door reopening seats the watchers (POK-133): a spectator is
        // a player of the NEXT match, and the unlock at match end is where
        // the next match's lobby begins.
        if (!room.locked) {
          let seated = false;
          for (const m of room.members.values()) {
            if (m.spectator) { m.spectator = undefined; seated = true; }
          }
          if (seated) room.broadcast(room.roster());
        }
        return;
      }

      // A client says whether it is willing and able to inherit the room.
      // Sent once on arrival by anything that understands migration, and
      // again with ok:false when its player goes out (POK-116).
      //
      // A HOST saying it can no longer host is handing the room over without
      // leaving it.  A browser tab in the background has its timers throttled
      // and its emulator stopped, and on the host those timers are the match --
      // so it stands down rather than making everybody wait for it, and takes
      // an ordinary seat in the room it opened.  Same election as leaveRoom's,
      // and the same broadcast: the roster carries `host`, and every client
      // already adopts it.
      case "can_host": {
        conn.canHost = msg.ok !== false;
        if (conn.canHost || !conn.room || conn.room.host !== conn) return;
        const successor = heirOf(conn.room);
        if (!successor) return; // nobody to take it: it stays where it is
        conn.room.host = successor;
        conn.room.broadcast(conn.room.roster());
        log(`room ${conn.room.code}: host ${conn.name}#${conn.id} stood down,`
            + ` ${successor.name}#${successor.id} promoted`);
        return;
      }

      // The host shows somebody the door (POK-130).  The room had eleven
      // message types and not one of them could do this, so an open room
      // was a one-way valve: set_open false stops NEW joins, and lock_room
      // starts the match -- neither is a way out once somebody is in.
      // The removed client is told the room closed, which its POK-115 exit
      // already handles cleanly; its connection stays up (it may want to
      // host or quick-play elsewhere), but this room will not take its
      // address, or the token its page rejoins with, back for the life of
      // the room.
      case "kick": {
        const room = conn.room;
        if (!room || room.host !== conn) return;
        const target = room.members.get(Number(msg.id));
        if (!target || target === conn) return;
        room.banned.add(target.ip);
        if (target.token) room.bannedTokens.add(target.token);
        room.remove(target);
        target.token = null; // no seat is held for the removed (POK-284)
        target.send({ type: "room_closed", reason: "removed" });
        room.broadcast(room.roster());
        log(`room ${room.code}: ${target.name}#${target.id} removed by host`);
        return;
      }

      case "leave_room":
        leaveRoom(conn, "left");
        return;

      case "to": {
        const room = conn.room;
        if (!room || typeof msg.m !== "object" || msg.m === null) return;
        const target = room.members.get(Number(msg.id));
        if (target && target !== conn) target.send({ type: "recv", from: conn.id, m: msg.m });
        return;
      }

      case "all": {
        const room = conn.room;
        if (!room || typeof msg.m !== "object" || msg.m === null) return;
        room.broadcast({ type: "recv", from: conn.id, m: msg.m }, conn);
        return;
      }

      case "stat": {
        // Play the client could not otherwise report: SOLO VS BOTS never
        // opens a socket, so it arrives here on the next connection made
        // for some other reason. Logged and counted; deliberately not
        // answered, so a client can send one and forget it.
        //
        // Everything is bounded before it reaches a log line: an id that is
        // not a short hex string, or a count that is not a sane number, is
        // dropped rather than written, because this is the one message
        // whose whole content is chosen by the client.
        const id = typeof msg.id === "string" && /^[0-9a-f]{1,32}$/.test(msg.id)
          ? msg.id : null;
        if (!id) return;
        const solo = Number.isFinite(msg.solo)
          ? Math.max(0, Math.min(100000, Math.floor(msg.solo))) : 0;
        const version = typeof msg.v === "string" && msg.v.length <= 16
          ? msg.v : "?";
        const since = typeof msg.since === "string"
          && /^\d{4}-\d{2}-\d{2}$/.test(msg.since) ? msg.since : "?";
        traffic.statSeen += 1;
        traffic.statSolo += solo;
        log(`stat ${id} v${version} | solo +${solo} | since ${since}`);
        return;
      }
      default:
        // unknown control types are ignored rather than fatal: a newer
        // client talking to an older relay should degrade, not disconnect
        return;
    }
  }

  function onMessage(conn, data, isBinary) {
    const now = Date.now();
    conn.lastSeen = now;
    // ws hands a text frame over as a Buffer: its length is the byte count,
    // with no second decode to measure it
    const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.length;

    const mul = (conn.room && conn.room.host === conn) ? limits.hostLines : 1;
    if (mul > 1 && !conn.hostDepth) {
      // promoted (or hosting): the deeper bucket starts full, not at
      // whatever a guest's was down to
      conn.hostDepth = true;
      conn.tokens += limits.burstLines * (mul - 1);
      conn.byteTokens += limits.burstBytes * (mul - 1);
    }
    const elapsed = (now - conn.tokenAt) / 1000;
    conn.tokens = Math.min(limits.burstLines * mul,
      conn.tokens + elapsed * limits.linesPerSec * mul);
    conn.byteTokens = Math.min(limits.burstBytes * mul,
      conn.byteTokens + elapsed * limits.bytesPerSec * mul);
    conn.tokenAt = now;
    if (conn.tokens < 1) { conn.destroy("flood"); return; }
    if (conn.byteTokens < bytes) { conn.destroy("flood_bytes"); return; }
    conn.tokens -= 1;
    conn.byteTokens -= bytes;
    if (conn.tokens < conn.minTokens) conn.minTokens = conn.tokens;

    // One JSON object per text frame -- a binary frame or one that does not
    // parse to an object is rejected the same way a bad line was: counted,
    // and once too many arrive, the socket goes.
    let msg = null;
    if (!isBinary) {
      const text = typeof data === "string" ? data : data.toString("utf8");
      try {
        msg = JSON.parse(text);
      } catch {
        msg = null;
      }
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.type !== "string") {
      if (++conn.badLines > limits.badLines) conn.destroy("bad_input");
      return;
    }
    conn.note(msg.type, bytes);
    try {
      handle(conn, msg);
    } catch (err) {
      // WHICH message, from whom, in which room: a bare stack tells you
      // the line of code and nothing about the game that hit it (POK-86)
      log(`handler error on ${msg.type} from ${conn.name}#${conn.id ?? "-"}`
          + `${conn.room ? ` in room ${conn.room.code}` : ""}:`
          + ` ${err && err.stack || err}`);
    }
  }

  const relay = {
    rooms,
    conns,
    limits,
    log,
    onClose(conn, reason) {
      leaveRoom(conn, reason === "left" ? "left" : "host_gone");
      conns.delete(conn);
      const n = (perIp.get(conn.ip) || 1) - 1;
      if (n <= 0) perIp.delete(conn.ip); else perIp.set(conn.ip, n);
    },
  };

  // The HTTP side: just /health, for Railway's healthcheck (and anybody
  // else's). Everything else on this port is the WebSocket upgrade below.
  const httpServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const body = JSON.stringify({ status: "ok", rooms: rooms.size, conns: conns.size });
      res.writeHead(200, { "Content-Type": "application/json",
                            "Content-Length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.line });

  httpServer.on("upgrade", (req, socket, head) => {
    const origin = req.headers.origin;
    if (!originAllowed(originAllowlist, origin)) {
      log(`refused upgrade from origin ${origin}: not on BR_ORIGINS`);
      socket.destroy();
      return;
    }
    const ip = clientAddress(req, trustProxy);
    const ipCount = (perIp.get(ip) || 0) + 1;
    if (conns.size >= limits.conns || ipCount > limits.connsPerIp) {
      // silently dropping these made a full relay look like a network
      // fault from the client side, with nothing on the server to match
      log(`refused ${ip}: `
          + (conns.size >= limits.conns
             ? `at the ${limits.conns}-connection ceiling`
             : `${ipCount} connections from one address`));
      traffic.rejected += 1;
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, ip);
    });
  });

  wss.on("connection", (ws, req, ip) => {
    const conn = new Conn(ws, ip, relay);
    const ipCount = (perIp.get(conn.ip) || 0) + 1;
    log(`open ${conn.ip} (${conns.size + 1}/${limits.conns})`);
    perIp.set(conn.ip, ipCount);
    conns.add(conn);
    if (conns.size > traffic.peakConns) traffic.peakConns = conns.size;
    conn.send(infoFor());
    ws.on("message", (data, isBinary) => onMessage(conn, data, isBinary));
    ws.on("error", () => conn.destroy("socket_error"));
    ws.on("close", () => conn.destroy("closed"));
  });

  // One line every few minutes: enough to see whether the box is busy or
  // idle and what it has moved, without shipping a metrics stack.
  const reporter = setInterval(() => {
    log(`rooms ${rooms.size}/${limits.rooms} conns ${conns.size}/${limits.conns}`
        + ` | sent ${human(traffic.bytesOut)} in ${traffic.linesOut} lines`
        + ` | peak ${traffic.peakRooms} rooms ${traffic.peakConns} conns`
        + (traffic.matches ? ` | matches ${traffic.matches}` : "")
        + (traffic.statSeen
           ? ` | stats ${traffic.statSeen} (solo ${traffic.statSolo})` : "")
        + (traffic.rejected ? ` | refused ${traffic.rejected}` : ""));
  }, 5 * 60_000);
  reporter.unref();

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const conn of [...conns]) {
      if (now - conn.lastSeen > limits.idleMs) conn.destroy("idle");
      // a browser is unbound on purpose: its clock is its last look at
      // the list, so it lives while it keeps looking
      else if (!conn.room && now - Math.max(conn.openedAt, conn.browsedAt) > limits.unboundMs) {
        conn.destroy("unbound");
      }
    }
    for (const room of rooms.values()) room.expireHeld(now, limits.rejoinMs);
  }, limits.sweepMs);
  sweeper.unref();

  httpServer.on("error", (err) => log(`server error: ${err && err.message}`));

  return {
    server: httpServer,
    wss,
    rooms,
    conns,
    limits,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          resolve(httpServer.address());
        });
      });
    },
    close() {
      clearInterval(sweeper);
      clearInterval(reporter);
      for (const conn of [...conns]) conn.destroy("shutdown");
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
  || (process.argv[1] && process.argv[1].endsWith("server.js") && import.meta.url.endsWith("server.js"));

if (isMain) {
  const port = Number(process.env.PORT || process.env.BR_RELAY_PORT || 7790);
  const host = process.env.HOST || "0.0.0.0";
  const log = (line) => console.log(new Date().toISOString(), line);
  const relay = createRelay({ limits: limitsFromEnv(process.env, log), log });
  process.on("uncaughtException", (err) => console.error("uncaught:", err));
  process.on("unhandledRejection", (err) => console.error("unhandled:", err));
  relay.listen(port, host).then((addr) => {
    console.log(`hoenn battle royale relay listening on ${addr.address}:${addr.port}`);
  });
}
