// A room: its members, the seats they hold and the ones held for them, and the
// door's state.  What a message does to a room is server.js's (createRelay's
// handlers); this is only what a room knows about itself.  Moved out of
// server.js (POK-331 #19).

import { randomBytes } from "node:crypto";

// The highest member id.  An id is the page's seat and the ROM's gBrMySeat,
// and both have 32 of them (web/src/net/wire.ts MAX_SEAT, br_config.h
// BR_MAX_SEATS); seat 0 is SOLO VS BOTS', so a room hands out 1..31.
export const MAX_SEAT = 31;

export class Room {
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
    // the one shared DAILY GAME room, which quick play and the list walk past
    this.daily = false;
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
    // The token of the HOST's held seat while the room waits for it to come
    // back (POK-330 #47), else null.  A host that drops with nobody to take
    // over -- alone with its bots, or late in a match when everybody else is
    // out -- used to close the room two lines after holding its seat.  Now
    // the room outlives the drop by the hold: `host` still names the one it
    // is waiting for, and the door takes nobody new but a watcher meanwhile.
    this.hostToken = null;
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
  // `token` that names a held seat, the SAME id as before; otherwise `seat`
  // when the caller has one it knows is free, else the lowest free one (the
  // caller has checked full() first).  The token is new either way: the old
  // one has done its job.
  add(conn, token, seat) {
    const held = token ? this.held.get(token) : undefined;
    if (held) {
      this.held.delete(token);
      conn.id = held.id;
      conn.joined = held.joined;
      conn.canHost = held.canHost;
      conn.spectator = held.spectator;
      // the host the room was waiting for: it is theirs again
      if (token === this.hostToken) {
        this.host = conn;
        this.hostToken = null;
      }
    } else {
      conn.id = seat ?? this.freeId();
      conn.joined = ++this.joined;
    }
    // Nobody watches a lobby (POK-331 #9 review): a watcher is a player of the
    // next match, and the unlock seats every one in the room.  One who asks to
    // watch between matches -- a #watch reload once the match is over, a
    // match_in_progress that lost the race with the unlock -- or whose seat
    // was held across the unlock is seated like them, and can be heir.
    if (!this.locked) conn.spectator = undefined;
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

  // The member whose token this is, while its socket is still in the room: a
  // page that called that socket dead and came back on a new one before the
  // relay saw the old one go (POK-330 #47 review).
  holder(token) {
    if (typeof token !== "string") return null;
    for (const m of this.members.values()) if (m.token === token) return m;
    return null;
  }

  // ...whose seat is held for that token, as a drop would hold it, for the new
  // socket to claim; a host's say goes with the seat.
  release(conn, now) {
    this.remove(conn);
    this.hold(conn, now);
    if (this.host === conn) this.hostToken = conn.token;
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
    // `seats` is the host's MAX as asked (up to limits.seats), `max` the
    // humans it is clamped to: the page labels MAX and deals its bots from
    // the first, and read the second as both, so MAX stuck at 16 (POK-330 #29)
    return { type: "roster", code: this.code, host: this.host.id,
             open: this.open, max: this.max, seats: this.seats,
             pass: this.pass !== null, members };
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
  // `full` is the door's own answer: `players` counts trainers against the
  // seats asked for, while the door counts against the human ceiling and
  // the ids left, so the list could not work it out (POK-330 #29)
  listing() {
    return { code: this.code, host: this.host.name, skin: this.host.skin,
             players: this.trainerCount(), seats: this.seats,
             pass: this.pass !== null, full: this.full() };
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
