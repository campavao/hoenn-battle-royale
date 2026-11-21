#!/usr/bin/env node
// Lays out the community's Discord server (Cam, 11-21: folks asked for one "to coordinate
// playing games"; Cam made the empty server, this does the rest). Run it again and it changes
// nothing it already did: everything is found by name before it is made.
//
//     node tools/br/discord-setup.mjs            # token from DISCORD_BOT_TOKEN or ~/.hbr-discord-token
//
// Apps cannot make servers (Discord, July 2025), so the bot Cam added is only the hands: once
// this has run it can be removed and its token reset. The two webhooks it makes keep working
// without it, and their URLs (secrets: anyone with one can post) go to ~/.hbr-discord.json,
// never stdout or the repo. The relay's is its DISCORD_ROOMS_WEBHOOK (relay/discord.js).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://discord.com/api/v10";
const SITE = "https://hoenn-battle-royale.vercel.app";
const KANTO = "https://github.com/campavao/kanto-battle-royale";
const OUT = join(homedir(), ".hbr-discord.json");
const tokenFile = join(homedir(), ".hbr-discord-token");
const token = (process.env.DISCORD_BOT_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8") : "")).trim();
if (!token) {
  console.error(`no bot token: set DISCORD_BOT_TOKEN or put it alone in ${tokenFile}`);
  process.exit(2);
}

const bit = (n) => 1n << BigInt(n);
const P = {
  KICK: bit(1), BAN: bit(2), ADMIN: bit(3), ADD_REACTIONS: bit(6), VIEW: bit(10), SEND: bit(11), MANAGE_MESSAGES: bit(13),
  MUTE: bit(22), MOVE: bit(24), MANAGE_THREADS: bit(34), PUBLIC_THREADS: bit(35),
  PRIVATE_THREADS: bit(36), SEND_IN_THREADS: bit(38), TIMEOUT: bit(40),
};
const str = (...bits) => String(bits.reduce((a, b) => a | b, 0n));
// Read-only for everybody: the game and Cam post, players read (and react).
const READ_ONLY = str(P.SEND, P.SEND_IN_THREADS, P.PUBLIC_THREADS, P.PRIVATE_THREADS);

async function api(method, path, body) {
  for (;;) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (hbr-setup, 1)" },
      body: body && JSON.stringify(body),
    });
    if (res.status === 429) {
      const { retry_after = 1 } = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, retry_after * 1000 + 100));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
}

// Which server: the only one the bot is in, or DISCORD_GUILD_ID.
const guilds = await api("GET", "/users/@me/guilds");
const guild = process.env.DISCORD_GUILD_ID ? guilds.find((g) => g.id === process.env.DISCORD_GUILD_ID) : guilds.length === 1 ? guilds[0] : null;
if (!guild) {
  console.error(guilds.length ? `the bot is in ${guilds.length} servers (${guilds.map((g) => `${g.name} ${g.id}`).join(", ")}): set DISCORD_GUILD_ID` : "the bot is in no server: add it with the OAuth2 URL first");
  process.exit(2);
}
const G = guild.id;
console.log(`server: ${guild.name}`);

// ---- roles ---------------------------------------------------------------------------------
// Cam's three (11-21): Creator (Cam, the owner), Gym Leader (Cam's friends, who keep the
// peace: delete messages, time out, kick, ban) and Trainer (everybody: Onboarding hands it out
// as they join, below). Gym Leaders are named in GYM_LEADERS by Discord username; one who has
// not joined yet gets the role the next time this runs.
const GYM_LEADERS = ["snackpack", "akhatib7", "jchazz", "en"];
let roles = await api("GET", `/guilds/${G}/roles`);
async function role(name, body, was = []) {
  let r = roles.find((x) => x.name === name) ?? roles.find((x) => was.includes(x.name));
  if (!r) { r = await api("POST", `/guilds/${G}/roles`, { name, ...body }); roles.push(r); console.log(`made role ${name}`); }
  else if (r.name !== name) { const before = r.name; r = await api("PATCH", `/guilds/${G}/roles/${r.id}`, { name, ...body }); console.log(`renamed role ${before} to ${name}`); }
  return r;
}
const creator = await role("Creator", { permissions: str(P.ADMIN), color: 0xe8b400, hoist: true, mentionable: false });
const mod = await role("Gym Leader", { permissions: str(P.KICK, P.BAN, P.MANAGE_MESSAGES, P.MUTE, P.MOVE, P.MANAGE_THREADS, P.TIMEOUT), color: 0x3f9b5a, hoist: true, mentionable: true }, ["Mod"]);
const trainer = await role("Trainer", { permissions: "0", color: 0x5b8fd6, hoist: true, mentionable: false });
// The game roles of an earlier run: Cam's list has no place for them.
for (const name of ["Hoenn", "Kanto"]) {
  const r = roles.find((x) => x.name === name);
  if (r) { await api("DELETE", `/guilds/${G}/roles/${r.id}`); console.log(`removed role ${name}`); }
}
// Highest first, just under the bot's own role (it can only hand out roles below its own).
roles = await api("GET", `/guilds/${G}/roles`);
const top = Math.max(...roles.filter((r) => r.managed).map((r) => r.position));
await api("PATCH", `/guilds/${G}/roles`, [creator, mod, trainer].map((r, i) => ({ id: r.id, position: top - 1 - i })));
async function give(user, r, who) {
  const m = await api("GET", `/guilds/${G}/members/${user}`);
  if (!m.roles.includes(r.id)) { await api("PUT", `/guilds/${G}/members/${user}/roles/${r.id}`); console.log(`gave ${who} ${r.name}`); }
}
const owner = (await api("GET", `/guilds/${G}`)).owner_id;
await give(owner, creator, "the owner");
for (const name of GYM_LEADERS) {
  // An exact username, never a nickname: "en" is in a lot of names.
  const hits = await api("GET", `/guilds/${G}/members/search?query=${encodeURIComponent(name)}&limit=100`);
  const m = hits.find((x) => x.user.username.toLowerCase() === name);
  if (m) await give(m.user.id, mod, name);
  else console.log(`${name} has not joined yet: Gym Leader waits for them`);
}

// ---- channels ------------------------------------------------------------------------------
// A section per game: Hoenn first, it is the one being made, and Kanto for the players of the
// original (Cam, 11-21: "there are still some Kanto folks out there"). INFO and COMMUNITY are
// both games'.
let channels = await api("GET", `/guilds/${G}/channels`);
const TEXT = [0, 5];
const find = (names, types) => channels.find((c) => names.includes(c.name) && types.includes(c.type));
async function category(name, was = []) {
  let c = find([name, ...was], [4]);
  if (!c) { c = await api("POST", `/guilds/${G}/channels`, { name, type: 4 }); channels.push(c); console.log(`made category ${name}`); }
  else if (c.name !== name) { c = await api("PATCH", `/channels/${c.id}`, { name }); console.log(`renamed category to ${name}`); }
  return c;
}
const everyone = (allow, deny) => ({ id: G, type: 0, allow, deny });
async function channel(name, { type = 0, parent, topic, slow, readOnly, hidden, was = [] }) {
  const overwrites = readOnly ? [everyone(str(P.ADD_REACTIONS), READ_ONLY), { id: mod.id, type: 0, allow: str(P.SEND), deny: "0" }]
    : hidden ? [everyone("0", str(P.VIEW)), { id: mod.id, type: 0, allow: str(P.VIEW, P.SEND), deny: "0" }]
    : undefined;
  const want = {
    name,
    parent_id: parent.id,
    ...(topic !== undefined ? { topic } : {}),
    ...(slow !== undefined ? { rate_limit_per_user: slow } : {}),
    ...(overwrites ? { permission_overwrites: overwrites } : {}),
  };
  let c = find([name, ...was], type === 2 ? [2] : TEXT);
  if (!c) {
    c = await api("POST", `/guilds/${G}/channels`, { type, ...want });
    channels.push(c);
    console.log(`made #${name}`);
  } else if (c.name !== name || c.parent_id !== parent.id || (topic !== undefined && c.topic !== topic) || (slow !== undefined && c.rate_limit_per_user !== slow) || overwrites) {
    const before = c.name;
    c = await api("PATCH", `/channels/${c.id}`, want);
    console.log(before === name ? `set #${name}` : `renamed #${before} to #${name}`);
  }
  return c;
}

const info = await category("INFO");
const community = await category("COMMUNITY", ["PLAY"]);
const hoennCat = await category("HOENN BATTLE ROYALE");
const kantoCat = await category("KANTO BATTLE ROYALE");
const voice = await category("VOICE");
const welcome = await channel("welcome", { parent: info, readOnly: true, topic: "Start here: the two games, how to play them, and the rules." });
const news = await channel("announcements", { parent: info, readOnly: true, topic: "New versions of the games, as they go live." });
const modUpdates = await channel("mod-updates", { parent: info, hidden: true, topic: "Discord's notices for the server's mods." });
const general = await channel("general", { parent: community, topic: "Anything Pokémon Battle Royale, either game." });
const rooms = await channel("hoenn-open-rooms", { parent: hoennCat, readOnly: true, was: ["open-rooms"], topic: "Hoenn rooms waiting for trainers right now, posted by the game. Tap a link to join." });
const hoennLfm = await channel("hoenn-find-a-match", { parent: hoennCat, slow: 10, was: ["looking-for-match"], topic: `Say when you're on for Hoenn. Play at ${SITE}. Quick play starts itself 60 s after the first trainer joins.` });
const hoennFeedback = await channel("hoenn-feedback", { parent: hoennCat, was: ["feedback"], topic: "What should change in Hoenn Battle Royale? Cam reads these." });
const hoennBugs = await channel("hoenn-bugs", { parent: hoennCat, was: ["bugs"], topic: "Something broke? Say what you did, what you saw, and your phone or browser." });
const kantoLfm = await channel("kanto-find-a-match", { parent: kantoCat, slow: 10, topic: `Say when you're on for Kanto. The mod: ${KANTO}` });
const kantoFeedback = await channel("kanto-feedback", { parent: kantoCat, topic: "What should change in Kanto Battle Royale?" });
const kantoBugs = await channel("kanto-bugs", { parent: kantoCat, topic: "Something broke? Say what you did, what you saw, and your gen1recomp and mod versions." });
// Whatever the server came with ("Create My Own" or a template's #clips-and-highlights,
// Lobby, Gaming) moves in with the rest: text to COMMUNITY, voice to VOICE. Read afresh: the
// renames above made new objects, and a stale PLAY would sweep up the channels just placed.
channels = await api("GET", `/guilds/${G}/channels`);
for (const name of ["Text Channels", "Voice Channels", "PLAY"]) {
  const from = find([name], [4]);
  if (!from) continue;
  for (const c of channels.filter((x) => x.parent_id === from.id)) {
    const to = c.type === 2 ? voice : community;
    await api("PATCH", `/channels/${c.id}`, { parent_id: to.id });
    c.parent_id = to.id;
    console.log(`moved ${c.name} to ${to.name}`);
  }
}
// A voice channel to meet in, if the server came with none.
if (!channels.some((c) => c.type === 2)) await channel("Match voice", { type: 2, parent: voice });

// The defaults' own categories, once nothing is left in them.
channels = await api("GET", `/guilds/${G}/channels`);
for (const name of ["Text Channels", "Voice Channels", "PLAY"]) {
  const c = find([name], [4]);
  if (c && !channels.some((x) => x.parent_id === c.id)) { await api("DELETE", `/channels/${c.id}`); console.log(`removed the empty ${name} category`); }
}
// In reading order, and in each section the order made above, anything else after.
const order = ["INFO", "welcome", "announcements", "mod-updates", "COMMUNITY", "general", "HOENN BATTLE ROYALE", "hoenn-open-rooms", "hoenn-find-a-match", "hoenn-feedback", "hoenn-bugs", "KANTO BATTLE ROYALE", "kanto-find-a-match", "kanto-feedback", "kanto-bugs", "VOICE"];
channels = await api("GET", `/guilds/${G}/channels`);
const rank = (c) => { const i = order.indexOf(c.name); return i < 0 ? order.length : i; };
const sorted = [...channels].sort((x, y) => rank(x) - rank(y) || x.position - y.position);
await api("PATCH", `/guilds/${G}/channels`, sorted.map((c, i) => ({ id: c.id, position: i })));

// ---- the server's own settings ---------------------------------------------------------------
// Pings only for @mentions (a busy find-a-match channel would buzz everyone's phone), a verified
// email to talk, Discord's image filter for everyone, and join messages in #general.
await api("PATCH", `/guilds/${G}`, { default_message_notifications: 1, verification_level: 1, explicit_content_filter: 2, system_channel_id: general.id });
console.log("set notifications to mentions only, verification to email, image filter on");
// A Community server, for the one thing that needs it: players picking their games' roles as
// they join (Onboarding). It is not Discovery (its own switch, and 1000 members away): the
// server stays invite-only.
const g = await api("GET", `/guilds/${G}`);
if (!g.features.includes("COMMUNITY")) {
  await api("PATCH", `/guilds/${G}`, { features: [...g.features, "COMMUNITY"], rules_channel_id: welcome.id, public_updates_channel_id: modUpdates.id });
  console.log("made it a Community server (#welcome is its rules, #mod-updates its notices)");
}
// #announcements as an announcement channel: other servers can follow it.
if (news.type === 0) { await api("PATCH", `/channels/${news.id}`, { type: 5 }); console.log("made #announcements an announcement channel"); }

// ---- AutoMod: Discord's own, so it works with no bot online ---------------------------------
const rules = await api("GET", `/guilds/${G}/auto-moderation/rules`);
async function rule(name, body) {
  if (rules.some((r) => r.name === name)) return;
  try {
    await api("POST", `/guilds/${G}/auto-moderation/rules`, { name, event_type: 1, enabled: true, ...body });
    console.log(`made AutoMod rule: ${name}`);
  } catch (err) {
    // A server gets one spam rule and one mention-spam rule; Discord may already have made them.
    console.log(`AutoMod rule ${name} not made: ${err.message.slice(0, 160)}`);
  }
}
await rule("Slurs and sexual content", { trigger_type: 4, trigger_metadata: { presets: [2, 3] }, actions: [{ type: 1, metadata: { custom_message: "That message was blocked. Keep it friendly." } }] });
await rule("Mention spam", { trigger_type: 5, trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true }, actions: [{ type: 1 }, { type: 3, metadata: { duration_seconds: 600 } }] });
await rule("Spam", { trigger_type: 3, actions: [{ type: 1 }] });
// ROM links: both games run the player's own copy, and the server never hands one out.
await rule("No ROM links", { trigger_type: 1, trigger_metadata: { keyword_filter: ["rom download*", "download rom*", "*romsfun*", "*romspure*", "*vimm.net*", "*emulatorgames.net*"] }, actions: [{ type: 1, metadata: { custom_message: "No ROM links here: both games run your own copy." } }] });

// ---- Onboarding: what a player is asked as they join ---------------------------------------
// One question, either game or both, and any answer makes you a Trainer. New prompts and
// options take any unique id; Discord gives them real ones.
const sendable = [general, hoennLfm, hoennFeedback, hoennBugs, kantoLfm, kantoFeedback, kantoBugs];
await api("PUT", `/guilds/${G}/onboarding`, {
  enabled: true,
  mode: 0,
  default_channel_ids: [welcome, news, ...sendable, rooms].map((c) => c.id),
  prompts: [{
    id: "1", type: 0, title: "Welcome, Trainer! Which do you play?", single_select: false, required: true, in_onboarding: true,
    options: [
      { id: "2", title: "Hoenn Battle Royale", description: "Emerald, in the browser", emoji: { name: "🌋" }, role_ids: [trainer.id], channel_ids: [rooms.id, hoennLfm.id] },
      { id: "3", title: "Kanto Battle Royale", description: "Red, Blue and Yellow, a gen1recomp mod", emoji: { name: "⚡" }, role_ids: [trainer.id], channel_ids: [kantoLfm.id] },
    ],
  }],
});
console.log("set Onboarding: every new member picks a game and becomes a Trainer");

// ---- webhooks ------------------------------------------------------------------------------
async function webhook(c, name) {
  const hooks = await api("GET", `/channels/${c.id}/webhooks`);
  const h = hooks.find((x) => x.name === name) ?? (await api("POST", `/channels/${c.id}/webhooks`, { name }));
  return `https://discord.com/api/webhooks/${h.id}/${h.token}`;
}
const saved = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const out = {
  ...saved,
  guild: G,
  rooms: await webhook(rooms, "Open rooms"),
  releases: await webhook(news, "Releases"),
  welcome: await webhook(welcome, "Hoenn Battle Royale"),
};

// ---- the welcome post: posted once, then edited to what this file says -------------------------
const content = [
  "# Welcome to Pokémon Battle Royale",
  "Up to 30 trainers drop into a region, catch and train a team, and fight until one is left. There are two games, and this server is for both.",
  "",
  `## Hoenn Battle Royale\nPokémon Emerald, in your browser, on a phone or a computer. Play at ${SITE}\nRooms waiting for trainers show up in <#${rooms.id}> as they open. Tap a link to join. Or say you're on in <#${hoennLfm.id}>. QUICK PLAY starts by itself 60 seconds after the first trainer joins, and fills the empty seats with bots.`,
  "",
  `## Kanto Battle Royale\nThe first game, a gen1recomp mod for PC that plays on Red, Blue or Yellow. Download and install steps: <${KANTO}>\nFind a match in <#${kantoLfm.id}>.`,
  "",
  "**You bring the game.** Both run your own copy of the original game, which never leaves your device. Nobody here will share one, so please don't ask or post links.",
  "",
  "**Be kind.** No spam, self-promotion or ROMs. Gym Leaders may remove messages or time people out.",
  "",
  `Ideas go in <#${hoennFeedback.id}> or <#${kantoFeedback.id}>, problems in <#${hoennBugs.id}> or <#${kantoBugs.id}>. Cam reads them all.`,
].join("\n");
const body = JSON.stringify({ content, allowed_mentions: { parse: [] } });
const headers = { "Content-Type": "application/json" };
if (!saved.welcomeId) {
  // The post an older run made (before this file kept its id), if there is one.
  const hookId = new URL(out.welcome).pathname.split("/").at(-2);
  const msgs = await api("GET", `/channels/${welcome.id}/messages?limit=20`);
  saved.welcomeId = msgs.find((m) => m.webhook_id === hookId)?.id;
}
const edited = saved.welcomeId && (await fetch(`${out.welcome}/messages/${saved.welcomeId}`, { method: "PATCH", headers, body })).ok;
if (edited) {
  out.welcomeId = saved.welcomeId;
  console.log("edited the welcome message");
} else {
  const r = await fetch(`${out.welcome}?wait=true`, { method: "POST", headers, body });
  if (!r.ok) throw new Error(`welcome post: ${r.status} ${await r.text()}`);
  out.welcomeId = (await r.json()).id;
  console.log("posted the welcome message");
}
delete out.welcomed;

// ---- an invite that never runs out ---------------------------------------------------------
const invites = await api("GET", `/guilds/${G}/invites`);
const forever = invites.find((i) => i.max_age === 0 && i.max_uses === 0 && i.channel?.id === welcome.id);
const invite = forever ?? (await api("POST", `/channels/${welcome.id}/invites`, { max_age: 0, max_uses: 0, unique: false }));
out.invite = `https://discord.gg/${invite.code}`;

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
console.log(`webhook URLs saved to ${OUT}`);
console.log(`invite: ${out.invite}`);
