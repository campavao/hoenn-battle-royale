// One client's socket: its buckets, its census, and the two ways a line leaves
// the relay (send, sendRaw).  What a message does, and what happens when a
// socket goes, is server.js's: createRelay hands each Conn a `relay` of
// {limits, log, onClose, traffic}.  Moved out of server.js (POK-331 #19).

// The message types server.js's handle() answers.  The per-connection census
// counts these by name and everything else as "other": keyed by whatever
// string a client sent, it was a Map that grew by one entry per junk type for
// the life of the socket (16 MB from one probe, POK-330 #18).
export const HANDLED = new Set([
  "ping", "info", "list_rooms", "daily_join", "host_room", "join_room",
  "quick_join", "set_open", "set_max", "set_pass", "set_skin", "lock_room",
  "can_host", "kick", "leave_room", "to", "all", "stat",
]);

export class Conn {
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
      this.relay.traffic.bytesOut += bytes;
      this.relay.traffic.linesOut += 1;
      this.ws.send(line);
    } catch {
      this.destroy("write_failed");
    }
  }

  // `code`, when there is one to say: a close frame the page can read (1012,
  // the relay restarting) rather than a cut it cannot tell from its own network
  destroy(reason, code) {
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
    try {
      if (code) this.ws.close(code, reason); else this.ws.terminate();
    } catch { /* already gone */ }
  }
}
