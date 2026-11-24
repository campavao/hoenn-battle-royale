// The open rooms, in the community's Discord (Cam, 11-21: folks asked for a Discord to
// "coordinate playing games"). One message per room on LOBBIES that is waiting for players,
// posted through a channel webhook, edited as trainers join, and marked started (or taken
// down, if it emptied) when it stops waiting. A webhook, not a bot: nothing runs on Discord's
// side, and the relay holds only the one URL (DISCORD_ROOMS_WEBHOOK, a Railway variable,
// never the repo). No URL, no poster.

export const SITE = "https://hoenn-battle-royale.vercel.app";
// How often the rooms are read, and the least time between two edits of one room's message:
// a quick room that fills fast is a few edits, not one a trainer.
const EVERY_MS = 5_000;
const EDIT_MS = 10_000;

/** A trainer's name as Discord shows it: none of its markdown, nobody pinged (the webhook
 *  sends with no mentions allowed at all, this is the belt to those braces). */
const plain = (s) => String(s).replace(/[\\*_~`|>#[\]()<@:-]/g, "\\$&").slice(0, 32);

/** Rooms worth a post: waiting, on LOBBIES, no passcode (those are for friends), and not the
 *  live specs' (their trainers are all `E2E`, project CLAUDE.md). */
export const posted = (r) => !r.playing && !r.pass && r.host !== "E2E";

/** What a room's message says. `deadline` is the quick room's start, epoch ms. */
export function roomText(r, deadline, site = SITE) {
  const link = `<${site}/#join=${r.code}>`;
  if (r.quick) {
    const when = deadline ? ` and starts <t:${Math.round(deadline / 1000)}:R>` : "";
    return `**QUICK PLAY** has ${r.players}/${r.seats} trainers${when}.\nJoin: ${link}`;
  }
  return `**${plain(r.host)}** is hosting a room with ${r.players}/${r.seats} trainers. It starts when they press START.\nJoin: ${link}`;
}

/** A room whose match is on: anyone can still come in to watch it (service.ts: a join to a
 *  playing room spectates), so the post keeps its link, worded JOIN (Cam, 11-21: "Join might convince folks to
 *  click more"). */
export function startedText(r, site = SITE) {
  return `${r.quick ? "**QUICK PLAY**" : `**${plain(r.host)}**'s room`} started with ${r.players} trainer${r.players === 1 ? "" : "s"}.\nJoin: <${site}/#join=${r.code}>`;
}

/**
 * Keeps one channel's messages in step with `rooms()` (the world service's LOBBIES list,
 * wire.ts Listed). `tick()` is one look; `start()` looks every few seconds; `drain()` takes
 * every message down (a deploy: the rooms move to the next relay, which posts them again).
 */
export function createRoomPoster({ url, rooms, log = () => {}, fetch = globalThis.fetch, now = Date.now, site = SITE, everyMs = EVERY_MS, editMs = EDIT_MS }) {
  const base = url.replace(/\?.*$/, "");
  /** code -> { id, players, deadline, at, playing } */
  const open = new Map();
  let busy = false;
  let quietUntil = 0;
  let timer = null;
  let failing = false;
  // A deploy's drain: no more looks, and the one under way (if any) finishes before the messages
  // come down, or a post it was still sending outlived the drain (11-22: two stayed for good).
  let stopped = false;

  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
    });
    if (res.status === 429) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after) || 5;
      quietUntil = now() + wait * 1000;
      throw new Error(`rate limited for ${wait}s`);
    }
    // A message somebody deleted by hand is gone either way.
    if (res.status === 404 && method !== "POST") return null;
    if (!res.ok) throw new Error(`${method} ${res.status}`);
    return res.status === 204 ? null : res.json();
  };

  const deadlineOf = (r) => (r.quick && r.startsIn !== undefined ? now() + r.startsIn * 1000 : 0);

  async function tick() {
    if (stopped || busy || now() < quietUntil) return;
    busy = true;
    try {
      const all = rooms();
      const byCode = new Map(all.map((r) => [r.code, r]));
      const waiting = all.filter(posted);
      for (const r of waiting) {
        const had = open.get(r.code);
        const deadline = deadlineOf(r);
        if (!had) {
          const msg = await call("POST", "?wait=true", { content: roomText(r, deadline, site) });
          open.set(r.code, { id: msg.id, players: r.players, deadline, at: now() });
          continue;
        }
        // The count restarts when somebody joins: a deadline more than a few seconds off is news.
        const moved = had.players !== r.players || Math.abs(had.deadline - deadline) > 3000;
        if (!moved || now() - had.at < editMs) continue;
        await call("PATCH", `/messages/${had.id}`, { content: roomText(r, deadline, site) });
        Object.assign(had, { players: r.players, deadline, at: now() });
      }
      for (const [code, had] of open) {
        const r = byCode.get(code);
        if (r && posted(r)) continue;
        // Started: said once, with its watch link, and kept until the match is over. A quick
        // room waits a minute, so this is the post most people see.
        if (r?.playing && !r.pass && r.host !== "E2E") {
          if (!had.playing) {
            await call("PATCH", `/messages/${had.id}`, { content: startedText(r, site) });
            had.playing = true;
          }
          continue;
        }
        // Over, emptied or gone: the channel lists rooms you can get into, so it comes down.
        await call("DELETE", `/messages/${had.id}`);
        open.delete(code);
      }
      if (failing) log("discord: posting again");
      failing = false;
    } catch (err) {
      // Once per outage, not every five seconds of it.
      if (!failing) log(`discord: ${err && err.message || err}`);
      failing = true;
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    get open() { return open.size; },
    start() {
      timer ??= setInterval(() => { void tick(); }, everyMs);
      timer.unref?.();
    },
    async drain() {
      stopped = true;
      clearInterval(timer);
      timer = null;
      for (let i = 0; busy && i < 100; i++) await new Promise((ok) => setTimeout(ok, 50));
      for (const [code, had] of open) {
        try { await call("DELETE", `/messages/${had.id}`); } catch { /* the next relay posts it again */ }
        open.delete(code);
      }
    },
  };
}
