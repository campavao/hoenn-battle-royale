// What reaches the relay from outside -- a message's fields, an env var, a
// request's headers -- made into a value server.js can trust, or into nothing.
// Pure functions, no state.  Moved out of server.js (POK-331 #19), which still
// exports the ones it always did.

// Env vars for the ceilings in server.js's DEFAULT_LIMITS.  A limit that is
// not a positive number is dropped with a log line, not used: NaN compares
// false with everything, so BR_MAX_ROOMS=forty used to switch the room cap
// off rather than set it.
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

export function cleanSkin(skin) {
  return typeof skin === "string" && SKIN_RE.test(skin) ? skin : undefined;
}

// A version stamp, if the client sent one at all.  Older clients send
// neither field, and the gate (server.js versionMismatch) treats "nothing
// sent" as "nothing to check" on both ends -- a version gate that refuses a
// client for saying less than a newer one would is worse than no gate.
//
// `patch` is the sha1 of the ROM running in the client's tab (POK-330 #3):
// forty characters, which the old 32 cut off.  A page older than that sends
// the hand-bumped patch number, which is compared as a string -- dropped for
// not being one, it left the gate comparing nothing but a protocol that has
// never moved.
export function cleanVersion(msg) {
  const raw = Number.isFinite(msg.patch) ? String(msg.patch) : msg.patch;
  const patch = typeof raw === "string" && raw.length > 0 && raw.length <= 64 ? raw : undefined;
  const protocol = Number.isInteger(msg.protocol) ? msg.protocol : undefined;
  if (patch === undefined && protocol === undefined) return null;
  return { patch, protocol };
}

export function cleanName(name) {
  if (typeof name !== "string") return "PLAYER";
  const out = name.replace(/[^\x20-\x7e]/g, "").trim().slice(0, NAME_MAX);
  return out === "" ? "PLAYER" : out;
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
