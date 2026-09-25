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
//         protocol?, seat?}                are refused "full"; clamped to the
//                                         member ceiling.  skin: the walk
//                                         sheet the lobby list draws the host
//                                         as.  pass: a passcode every join
//                                         must carry.  patch/protocol: the
//                                         host's version, recorded for the
//                                         gate below.  seat: the id to open
//                                         it as, 1..MAX_SEAT, for a match
//                                         re-hosted from the seat it is
//                                         played from (POK-331 #14))
//   {type:"set_max", max}              -> host only: the room's size, live
//   {type:"set_pass", pass}            -> host only: the passcode, live; "" or
//                                         absent clears it.  A passcoded room
//                                         is listed with a lock, skipped by
//                                         quick_join, and joined only with
//                                         the matching `pass`
//   {type:"set_skin", skin}               what this member looks like, live
//   {type:"list_rooms", patch?,        -> rooms {rooms:[{code, host, skin,
//         protocol?}                      players, seats, pass, full}]}: every
//                                         lobby a stranger may walk into --
//                                         open, not mid-match, not the daily.
//                                         `players` counts trainers, never
//                                         watchers; `seats` is the host's MAX
//                                         as they set it; `pass` says a
//                                         passcode is needed; `full` says the
//                                         door would refuse a join.  A browser that
//                                         keeps asking is kept alive past the
//                                         unbound sweep.  Inside the half hour
//                                         before the DAILY GAME its row leads
//                                         the list: {host:"DAILY", daily:true,
//                                         secs, code: the room's or ""} -- the
//                                         daily this browser's press would
//                                         land in, by its own patch/protocol
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
//                                     if the current one drops (POK-116);
//                                     never while it is watching (POK-331 #9)
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
//   {type:"daily_join", name, skin?,   -> the one shared DAILY GAME room:
//         patch?, protocol?}           joins it, creates it as its host, or
//                                      answers match_in_progress while its
//                                      match runs.  quick_join never seats
//                                      anyone in a daily room.  Behind the
//                                      same door as every other way in: a
//                                      daily of another build is not yours,
//                                      and you get one of your own
//   {type:"quick_join", name,          same as join_room, but the relay picks
//         patch?, protocol?}           the fullest open room rather than a code,
//                                      passing over any of another build
// Server -> client
//   {type:"roster", code, host, open, max, seats, pass,
//         members:[{id,name,spectate?}]}
//                                      on every change (max: the humans the
//                                      room seats; seats: the host's MAX as
//                                      asked, bots filling the rest; pass:
//                                      whether a passcode is set, never the
//                                      code)
//   {type:"rooms", rooms:[...]}        the lobby list, see list_rooms
//   {type:"recv", from, m}
//   {type:"room_closed", reason}       the host left and nobody could take
//                                      the room over -- or, reason
//                                      "removed", the host showed YOU out.
//                                      A host that DROPS with no heir is
//                                      waited for through the seat hold
//                                      (POK-330 #47): the roster keeps
//                                      naming it, the door takes nobody new
//                                      but a watcher (POK-331 #14), its token
//                                      makes it host again, and a member
//                                      sending can_host takes over;
//                                      when the hold runs out, "host_gone"
//   {type:"match_in_progress", code, members}  quick_join's third answer
//                                      (POK-133): nothing joinable, but a
//                                      match is running -- watch it and
//                                      play the next one
//   {type:"room_error", reason:        the host's client is on a different
//        "version", host:              build or protocol than this one; the
//        {patch, protocol}}            reasons list above already has
//                                       "not_found"/"full"/"locked"/etc, this
//                                       adds one more.  `patch` is the sha1 of
//                                       the ROM running in the tab (POK-330
//                                       #3), a string; relay/protocol.fixtures
//                                       .json is what the page sends
//
// Ids are 1..MAX_SEAT, the lowest one free: not a member's, not held for one
// who dropped, and not used since the match locked the door (nor a bot's).
// None left is `full`.  The host is whoever created the room.  Codes use the
// same 0/O/1/I/L-free
// alphabet as the game's room-code entry widget, so a code read aloud never
// has to be checked twice.

import http from "node:http";
import { randomInt } from "node:crypto";
import { WebSocketServer } from "ws";
import { cleanMotd, cleanName, cleanPass, cleanSkin, cleanVersion, clientAddress,
         dailySecondsUntil, limitsFromEnv, originAllowed, parseDaily,
         parseOrigins } from "./clean.js";
import { Conn } from "./conn.js";
import { MAX_SEAT, Room } from "./room.js";

// The input cleaners, Room and Conn live beside this file (POK-331 #19); what
// server.js exported before the move, it still does.
export { cleanMotd, cleanPass, clientAddress, dailySecondsUntil, limitsFromEnv,
         MAX_SEAT, originAllowed, parseDaily, parseOrigins };

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;

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
  //
  // Never a watcher (POK-331 #9).  Every page says can_host the moment it has a
  // seat, watching or not, and a watcher is not in the match: made its host, it
  // would run one it never heard the start of.  Kanto's watcher withdraws
  // itself; here the relay knows who is watching.  The unlock seats it, and
  // from then on it is anybody's heir; nobody watches a lobby (Room.add).
  function heirOf(room) {
    let heir = null;
    for (const m of room.members.values()) {
      if (m.canHost && !m.spectator && (!heir || m.joined < heir.joined)) heir = m;
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
      // Nobody could take it, but the host only dropped: the room waits the
      // seat hold out for it (POK-330 #47).  A lone host playing bots is the
      // common case, and a phone's blip ended their match on the spot.  The
      // roster still names them as host; the door takes nobody new but a
      // watcher.
      if (conn.token && room.held.has(conn.token)) {
        room.hostToken = conn.token;
        room.broadcast(room.roster());
        log(`room ${room.code}: host ${conn.name}#${conn.id} dropped, held`
            + ` ${Math.round(limits.rejoinMs / 1000)}s`);
        return;
      }
      // Left on purpose: the old ending, for a room of old clients or one
      // whose last eligible member has been eliminated.
      closeRoom(room, reason || "host_left");
    } else {
      room.broadcast(room.roster());
      log(`room ${room.code}: ${conn.name}#${conn.id} left`);
    }
  }

  // The room is over: everybody still in it is told, and its code is gone.
  function closeRoom(room, reason) {
    room.broadcast({ type: "room_closed", reason });
    for (const m of [...room.members.values()]) {
      room.remove(m);
    }
    rooms.delete(room.code);
    log(`room ${room.code} closed (${reason}, no heir)`);
  }

  // Lets go of seats held past rejoinMs, and closes a room whose host's was
  // one of them.  False when the room is gone.
  function reap(room, now) {
    room.expireHeld(now, limits.rejoinMs);
    if (room.hostToken === null || room.held.has(room.hostToken)) return true;
    closeRoom(room, "host_gone");
    return false;
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

  // Why `conn` may not come through `room`'s door, or null when it may
  // (POK-330 #46).  Every way in asks this one question -- the list, a code,
  // quick play, the daily -- where each used to keep its own copy of the
  // filter, and the daily's copy had quietly lost the version gate.  The order
  // is the answer a stranger gets: removed, then the passcode (without it you
  // learn nothing past "not yours"), then the version, then the door's state.
  // A member coming back to a seat the room is holding is past the passcode and
  // the door's state: they were already inside.  The passcode above all
  // (POK-330 #47 review): a host sets it after opening, so its page never has it
  // to rejoin with, and a guest's is stale once the host changes it.
  function canEnter(room, conn, { token, pass, version, spectate = false, resuming = false } = {}) {
    if (room.banned.has(conn.ip)
        || (typeof token === "string" && room.bannedTokens.has(token))) return "removed";
    if (!resuming && room.pass !== null && cleanPass(pass) !== room.pass) return "passcode";
    if (versionMismatch(room, version)) return "version";
    if (resuming) return null;
    // waiting on its dropped host (POK-330 #47): nobody would run the lobby
    // for a newcomer.  Not the daily's lobby, which is nobody's in particular:
    // a newcomer's can_host makes it the host there, where passing the room
    // over opened a second daily.  A running match waiting on its host is
    // shut to players like any other, and open to watchers (POK-331 #14):
    // watching needs nobody to run anything, a watcher is never made host
    // (heirOf), and one turned away here had been told match_in_progress
    // and had nowhere left to go but the lobby.
    if (room.hostToken !== null && !room.locked && !room.daily) return "locked";
    if (room.locked && !spectate) return "locked";
    if (room.full()) return "full";
    return null;
  }

  // Where a press of the DAILY GAME puts `conn` (POK-161 v2): `open`, the
  // first daily lobby of its build that would seat it, else `running`, the
  // first daily match of its build it could watch -- and neither is the press
  // opening one.  daily_join acts on it and list_rooms' row describes it, so
  // the row is always the press (POK-331 #14).  A daily match already running
  // is watched, like quick play's, and one running while its host is away is
  // still running (POK-330 #47 review): canEnter lets its watchers in, so it
  // is not a reason to open a second daily beside it.
  function dailyDoor(conn, version) {
    let open = null, running = null;
    for (const room of rooms.values()) {
      if (!room.daily || canEnter(room, conn, { version, spectate: room.locked }) !== null) continue;
      if (room.locked) running = running || room;
      else open = open || room;
    }
    return { open, running };
  }

  // canEnter's answer, said to the client that asked; a version refusal says
  // what the room runs, so the page can tell its player which of them is stale
  function refuse(conn, room, why) {
    conn.send(why === "version"
      ? { type: "room_error", reason: why, host: room.version }
      : { type: "room_error", reason: why });
  }

  // A new room with `conn` as its host: the lobby's HOST row, quick play that
  // found nothing, and the daily's first press.  Null, having said why, at the
  // room ceiling.  `seat`: the id its opener asked for, else the lowest (1).
  function openRoom(conn, msg, { mode, open, pass = null, max, seat }) {
    if (rooms.size >= limits.rooms) {
      traffic.rejected += 1;
      conn.send({ type: "room_error", reason: "server_full" });
      log(`room refused: at the ${limits.rooms}-room ceiling`);
      return null;
    }
    conn.name = cleanName(msg.name);
    conn.skin = cleanSkin(msg.skin);
    conn.spectator = undefined; // a host is never watching, whatever it did last room
    const room = new Room(makeCode(rooms), conn, cleanMax(max));
    room.seats = cleanSeats(max);
    room.mode = mode;
    room.daily = mode === "daily";
    room.open = open;
    room.pass = pass;
    room.version = cleanVersion(msg);
    rooms.set(room.code, room);
    room.add(conn, undefined, seat);
    traffic.roomsOpened += 1;
    if (rooms.size > traffic.peakRooms) traffic.peakRooms = rooms.size;
    conn.send({ type: "room_hosted", code: room.code, id: conn.id, token: conn.token, rejoinMs: limits.rejoinMs });
    conn.send(room.roster());
    log(`room ${room.code} hosted by ${conn.name}#${conn.id}`
        + (room.daily ? " (daily)"
           : (room.open ? " (open)" : "") + (room.pass ? " (passcode)" : "")));
    return room;
  }

  // `conn` walks into `room`: the one place a room_joined is made, whichever
  // door it came through.  `token` names the seat of a member coming back.
  function admit(conn, room, msg, how, { spectate = false, token } = {}) {
    conn.name = cleanName(msg.name);
    conn.skin = cleanSkin(msg.skin);
    conn.spectator = spectate || undefined;
    room.add(conn, token);
    conn.send({ type: "room_joined", code: room.code, id: conn.id, host: room.host.id, token: conn.token, rejoinMs: limits.rejoinMs });
    room.broadcast(room.roster());
    log(`room ${room.code}: ${conn.name}#${conn.id} ${how}`);
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
          if (!room.open || room.daily) continue;
          // the door as somebody holding the passcode would find it: a full
          // room is still a row, marked, and so is a passcoded one
          const why = canEnter(room, conn, { pass: room.pass });
          if (why === null || why === "full") list.push(room.listing());
        }
        list.sort((a, b) => b.players - a.players || (a.code < b.code ? -1 : 1));
        // The DAILY GAME (2026-09-13): inside the last half hour before
        // its hour, one row at the top -- whether or not anybody has
        // pressed the row yet, since the relay owns the clock and can
        // promise the room.  `secs` is the countdown; picking it is
        // daily_join, which creates the room or seats you in it.  A
        // daily match already running is a locked room: no row.
        //
        // The row is the press (POK-331 #14): the daily daily_join would
        // put THIS browser in, by its own build (`patch`/`protocol`, as
        // every door is asked).  It took the first unlocked daily of any
        // build for its code and count, and vanished while any daily of
        // any build ran.
        if (daily) {
          const secs = dailySecondsUntil(daily);
          const { open, running } = dailyDoor(conn, cleanVersion(msg));
          if (secs <= limits.dailyListSecs && (open || !running)) {
            list.unshift({ code: open ? open.code : "", host: "DAILY",
                           daily: true, secs,
                           players: open ? open.trainerCount() : 0,
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
        const { open, running } = dailyDoor(conn, cleanVersion(msg));
        if (open) {
          admit(conn, open, msg, "joined the daily");
          return;
        }
        if (running) {
          conn.send({ type: "match_in_progress", code: running.code,
                      members: running.members.size });
          return;
        }
        // open, so it is discoverable to watch; quick_join and the list skip it
        openRoom(conn, msg, { mode: "daily", open: true });
        return;
      }

      case "host_room": {
        if (conn.room) { conn.send({ type: "room_error", reason: "already_in_room" }); return; }
        openRoom(conn, msg, {
          mode: conn.seen.get("quick_join") ? "quick" : "host",
          open: msg.open === true,
          pass: cleanPass(msg.pass),
          max: msg.max,
          // A match that outlived its room -- a relay restart, or a hold that ran
          // out -- is hosted again from the page running it (POK-331 #14), and an
          // id is a seat: its ghost, its loot keys, gBrMySeat in its ROM.  Opened
          // as 1, an heir came back as another trainer of its own match, so only
          // seat 1 could do it.  Any seat is free in a room nobody else is in.
          seat: Number.isInteger(msg.seat) && msg.seat >= 1 && msg.seat <= MAX_SEAT
            ? msg.seat : undefined,
        });
        return;
      }

      case "join_room": {
        if (conn.room) { conn.send({ type: "room_error", reason: "already_in_room" }); return; }
        const code = typeof msg.code === "string" ? msg.code.toUpperCase() : "";
        const room = rooms.get(code);
        // a room whose host's hold ran out is closed here, not at the next sweep:
        // that host is told not_found, which is what re-hosts its match
        if (!room || !reap(room, Date.now())) { conn.send({ type: "room_error", reason: "not_found" }); return; }
        // Coming back to a seat the room is still holding (POK-284): the
        // door's state is not asked, because they were already inside.
        // A stale or unknown token is an ordinary join.
        //
        // ...or to one it has not let go of yet (POK-330 #47 review).  A page
        // calls its socket dead after two missed pings, 20-30 s in; a half-open
        // socket goes on the relay's side only at idleMs, a minute after its
        // last line.  Asked as a stranger, that rejoin was refused `locked`
        // mid-match, or seated a host as a guest of its own room.
        const now = Date.now();
        const stale = room.holder(msg.token);
        const resuming = stale !== null || room.holding(msg.token, now, limits.rejoinMs);
        // A spectator's door opens where a player's is barred (POK-133):
        // lock_room exists to stop competitors joining a running match,
        // and somebody who asks to WATCH is not one.  The flag rides the
        // roster so every client knows who is a guest of the next match
        // rather than a trainer in this one.  Watchers need the passcode
        // too -- a passcoded room is a room with friends in it, and the
        // match is theirs to show.
        const spectate = msg.spectate === true;
        const why = canEnter(room, conn, { token: msg.token, pass: msg.pass,
                                           version: cleanVersion(msg), spectate, resuming });
        if (why) { refuse(conn, room, why); return; }
        // the old socket goes out of the room first, so its close is not a drop:
        // no hold, no heir, nobody told the host has gone
        if (stale) {
          room.release(stale, now);
          stale.destroy("replaced");
        }
        admit(conn, room, msg, stale ? "rejoined over its old socket"
              : resuming ? "rejoined" : spectate && room.locked ? "spectates" : "joined",
              { spectate, token: resuming ? msg.token : undefined });
        return;
      }

      // Quick play: the point is that a newcomer needs nothing from anyone
      // -- no code read out over voice chat, no friend already playing.  We
      // pick the FULLEST joinable room rather than the first, so strangers
      // gather into one match instead of scattering one-per-room.
      case "quick_join": {
        if (conn.room) { conn.send({ type: "room_error", reason: "already_in_room" }); return; }
        // A room of another build is passed over, not refused (POK-330 #3):
        // right after a deploy the fullest room may be the old build's, and
        // telling every up-to-date arrival to reload -- which cannot help
        // them -- turned quick play off until it emptied.  Walking past it
        // finds a room of their own build, or hosts one.
        const version = cleanVersion(msg);
        let best = null;
        for (const room of rooms.values()) {
          // a daily room waits for its hour; quick play wants a game NOW,
          // and a passcoded room (no pass is asked here) wants somebody who
          // knows the host
          if (!room.open || room.daily || canEnter(room, conn, { version }) !== null) continue;
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
            if (!room.open || !room.locked
                || canEnter(room, conn, { version, spectate: true }) !== null) continue;
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
        admit(conn, best, msg, "quick-joined");
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
        // A room waiting on its dropped host takes the first member able to
        // run it (POK-330 #47): a guest coming back from the same blip, say.
        // The old host's seat is still held, as an ordinary one.  Not a
        // watcher, for heirOf's reason (POK-331 #9).
        const waiting = conn.room && conn.room.hostToken !== null ? conn.room : null;
        if (conn.canHost && waiting && !conn.spectator) {
          const gone = waiting.host;
          waiting.host = conn;
          waiting.hostToken = null;
          waiting.broadcast(waiting.roster());
          log(`room ${waiting.code}: host ${gone.name}#${gone.id} left,`
              + ` ${conn.name}#${conn.id} promoted`);
          return;
        }
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
    traffic,
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
      // `locked`: matches running, which a relay deploy would end (docs/DEPLOY.md)
      let locked = 0;
      for (const room of rooms.values()) if (room.locked) locked += 1;
      const body = JSON.stringify({ status: "ok", rooms: rooms.size, conns: conns.size, locked });
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
  // idle and what it has moved, without shipping a metrics stack.  Once more
  // on the way out, or a deploy loses everything since the last one.
  const report = () => `rooms ${rooms.size}/${limits.rooms} conns ${conns.size}/${limits.conns}`
      + ` | sent ${human(traffic.bytesOut)} in ${traffic.linesOut} lines`
      + ` | peak ${traffic.peakRooms} rooms ${traffic.peakConns} conns`
      + (traffic.matches ? ` | matches ${traffic.matches}` : "")
      + (traffic.statSeen
         ? ` | stats ${traffic.statSeen} (solo ${traffic.statSolo})` : "")
      + (traffic.rejected ? ` | refused ${traffic.rejected}` : "");
  const reporter = setInterval(() => log(report()), 5 * 60_000);
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
    for (const room of [...rooms.values()]) reap(room, now);
  }, limits.sweepMs);
  sweeper.unref();

  httpServer.on("error", (err) => log(`server error: ${err && err.message}`));

  // Every socket goes, cut or -- with a `code` -- closed with one.  The rooms go
  // first, and quietly (POK-330 #47 review): socket by socket, the host's close
  // elected an heir and told it so before the heir's own close landed, and its
  // page started a takeover a moment before the restart cut it off too.
  function close(code) {
    clearInterval(sweeper);
    clearInterval(reporter);
    for (const room of rooms.values()) {
      for (const m of room.members.values()) m.room = null;
    }
    rooms.clear();
    for (const conn of [...conns]) conn.destroy("shutdown", code);
    return new Promise((resolve) => httpServer.close(() => resolve()));
  }

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
    close,
    // A deploy stops the old process with SIGTERM (POK-330 #47).  Every room
    // dies with it -- they live in memory -- so what a clean stop buys is the
    // counters since the last report, which a deploy used to lose, and a close
    // code (1012, service restart) a page can tell from its own network going.
    shutdown(signal) {
      log(`${signal}: shutting down | ${report()}`);
      return close(1012);
    },
  };
}

// The process's end of a deploy: SIGTERM shuts the relay down and exits once
// every socket has closed, or after graceMs for a peer that never answers its
// close frame.
export function exitOnSignal(relay, proc = process, graceMs = 3000) {
  proc.once("SIGTERM", () => {
    const force = setTimeout(() => proc.exit(0), graceMs);
    relay.shutdown("SIGTERM").finally(() => {
      clearTimeout(force);
      proc.exit(0);
    });
  });
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
  exitOnSignal(relay);
  relay.listen(port, host).then((addr) => {
    console.log(`hoenn battle royale relay listening on ${addr.address}:${addr.port}`);
  });
}
