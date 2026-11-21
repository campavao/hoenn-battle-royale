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
const OUT = join(homedir(), ".hbr-discord.json");
const tokenFile = join(homedir(), ".hbr-discord-token");
const token = (process.env.DISCORD_BOT_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8") : "")).trim();
if (!token) {
  console.error(`no bot token: set DISCORD_BOT_TOKEN or put it alone in ${tokenFile}`);
  process.exit(2);
}

const bit = (n) => 1n << BigInt(n);
const P = {
  KICK: bit(1), BAN: bit(2), ADD_REACTIONS: bit(6), SEND: bit(11), MANAGE_MESSAGES: bit(13),
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
// One, for whoever Cam trusts to keep the peace: delete messages, time out, kick, ban.
const roles = await api("GET", `/guilds/${G}/roles`);
let mod = roles.find((r) => r.name === "Mod");
if (!mod) {
  mod = await api("POST", `/guilds/${G}/roles`, { name: "Mod", permissions: str(P.KICK, P.BAN, P.MANAGE_MESSAGES, P.MUTE, P.MOVE, P.MANAGE_THREADS, P.TIMEOUT), color: 0x3f9b5a, hoist: true, mentionable: true });
  console.log("made role Mod");
}

// ---- channels ------------------------------------------------------------------------------
let channels = await api("GET", `/guilds/${G}/channels`);
const byName = (name, type) => channels.find((c) => c.name === name && c.type === type);
async function category(name, position) {
  let c = byName(name, 4);
  if (!c) { c = await api("POST", `/guilds/${G}/channels`, { name, type: 4, position }); channels.push(c); console.log(`made category ${name}`); }
  return c;
}
async function channel(name, { type = 0, parent, topic, slow, readOnly }) {
  const want = {
    parent_id: parent.id,
    ...(topic !== undefined ? { topic } : {}),
    ...(slow !== undefined ? { rate_limit_per_user: slow } : {}),
    ...(readOnly ? { permission_overwrites: [{ id: G, type: 0, allow: str(P.ADD_REACTIONS), deny: READ_ONLY }, { id: mod.id, type: 0, allow: str(P.SEND), deny: "0" }] } : {}),
  };
  let c = byName(name, type);
  if (!c) {
    c = await api("POST", `/guilds/${G}/channels`, { name, type, ...want });
    channels.push(c);
    console.log(`made #${name}`);
  } else if (c.parent_id !== parent.id || (topic !== undefined && c.topic !== topic) || (slow !== undefined && c.rate_limit_per_user !== slow) || readOnly) {
    c = await api("PATCH", `/channels/${c.id}`, want);
    console.log(`set #${name}`);
  }
  return c;
}

const info = await category("INFO", 0);
const play = await category("PLAY", 1);
const voice = await category("VOICE", 2);
const welcome = await channel("welcome", { parent: info, readOnly: true, topic: `What Hoenn Battle Royale is, and how to play: ${SITE}` });
const news = await channel("announcements", { parent: info, readOnly: true, topic: "New versions of the game, as they go live." });
const rooms = await channel("open-rooms", { parent: info, readOnly: true, topic: "Rooms waiting for trainers right now, posted by the game. Tap a link to join." });
const general = await channel("general", { parent: play, topic: "Anything Hoenn Battle Royale." });
const lfm = await channel("looking-for-match", { parent: play, slow: 10, topic: "Say when you're on and want a match. Quick play starts itself 60 s after the first trainer joins." });
const feedback = await channel("feedback", { parent: play, topic: "What should change? Cam reads these." });
const bugs = await channel("bugs", { parent: play, topic: "Something broke? Say what you did, what you saw, and your phone or browser." });
// "Create My Own" comes with a `General` voice channel: it moves, under its new name.
const oldVoice = byName("General", 2);
if (oldVoice && !byName("Match voice", 2)) {
  await api("PATCH", `/channels/${oldVoice.id}`, { name: "Match voice", parent_id: voice.id });
  oldVoice.name = "Match voice";
  console.log("moved the General voice channel to VOICE as Match voice");
}
await channel("Match voice", { type: 2, parent: voice });

// The defaults' own categories, once nothing is left in them.
channels = await api("GET", `/guilds/${G}/channels`);
for (const name of ["Text Channels", "Voice Channels"]) {
  const c = byName(name, 4);
  if (c && !channels.some((x) => x.parent_id === c.id)) { await api("DELETE", `/channels/${c.id}`); console.log(`removed the empty ${name} category`); }
}

// ---- the server's own settings ---------------------------------------------------------------
// Pings only for @mentions (a busy #looking-for-match would buzz everyone's phone), a verified
// email to talk, Discord's image filter for everyone, and join messages in #general.
await api("PATCH", `/guilds/${G}`, { default_message_notifications: 1, verification_level: 1, explicit_content_filter: 2, system_channel_id: general.id });
console.log("set notifications to mentions only, verification to email, image filter on");

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
// ROM links: the game only ever runs the player's own copy, and the server never hands one out.
await rule("No ROM links", { trigger_type: 1, trigger_metadata: { keyword_filter: ["rom download*", "download rom*", "*romsfun*", "*romspure*", "*vimm.net*", "*emulatorgames.net*"] }, actions: [{ type: 1, metadata: { custom_message: "No ROM links here: Hoenn Battle Royale runs your own copy of Emerald." } }] });

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

// ---- the welcome post, once ----------------------------------------------------------------
if (!saved.welcomed) {
  const content = [
    "# Welcome to Hoenn Battle Royale",
    `A battle royale on Pokémon Emerald, in your browser: up to 30 trainers drop into Hoenn, catch and train a team, and fight until one is left. Play at ${SITE}`,
    "",
    "**You bring the game.** It runs your own copy of Pokémon Emerald (US), which you load on the site's first screen. It never leaves your device, and nobody here will share one, so please don't ask or post links.",
    "",
    `**Finding a match:** <#${rooms.id}> lists rooms waiting for trainers, live from the game, so tap a link to join. Or say you're on in <#${lfm.id}>. QUICK PLAY on the site starts by itself 60 seconds after the first trainer joins, and fills the empty seats with bots.`,
    "",
    "**Rules:** be kind, no spam or self-promotion, no ROMs. Mods may remove messages or time people out.",
    "",
    `Ideas go in <#${feedback.id}> and problems in <#${bugs.id}>. Cam reads both.`,
  ].join("\n");
  await fetch(out.welcome, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) }).then((r) => { if (!r.ok) throw new Error(`welcome post: ${r.status}`); });
  out.welcomed = true;
  console.log("posted the welcome message");
}

// ---- an invite that never runs out ---------------------------------------------------------
const invites = await api("GET", `/guilds/${G}/invites`);
const forever = invites.find((i) => i.max_age === 0 && i.max_uses === 0 && i.channel?.id === welcome.id);
const invite = forever ?? (await api("POST", `/channels/${welcome.id}/invites`, { max_age: 0, max_uses: 0, unique: false }));
out.invite = `https://discord.gg/${invite.code}`;

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
console.log(`webhook URLs saved to ${OUT}`);
console.log(`invite: ${out.invite}`);
