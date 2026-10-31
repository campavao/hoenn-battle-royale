// Spike B's battles: the real ROM, asked to fight and nothing else.
//
// The page owns the overworld; this ROM stands parked in Littleroot behind it, hidden.
// A fight is the path a bot fight already takes (br_bot.c, the bot-fight driver): a
// TRAINER card puts the other side's party in gEnemyParty, a PLACE puts their ghost on
// our map, and a CHALLENGE starts an ordinary trainer battle. A wild battle is asked for
// in gBrWildAsk (br_wild.h): the map the page's marked spot is on, and the ROM rolls it
// from that map's own table. When the ROM is back on the field the battle is over, the
// page takes the screen back, and the ROM is put back where it was parked -- with the
// party and the bag the battle left (a catch, a used POTION, a level), so the trainer's
// team is theirs from battle to battle (carry.ts).
//
// The ROM is the player's own, picked on this page (import.ts) and patched the way the
// game patches it (loadRom). In dev, `?rom=<path>` or web/public/spike-rom/ (gitignored,
// never committed) can stand in for it.

import { Emulator, type GbaKey } from '../src/emu';
import { Mailbox, MAILBOX } from '../src/net/mailbox';
import { BR_CONT_FLAG, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from '../src/net/slots';
import { PROTOCOL, type Dir, type Msg, type PackedMon } from '../src/net/wire';
import { loadCheckedRelease } from '../src/release';
import { isPrePatched, sha1Hex } from '../src/rom/emerald';
import { BAG_AT, BAG_LEN, DEX2_AT, DEX2_LEN, KEY_AT, PARTY_LEN, SEEN1_AT, SEEN2_AT, SEEN_LEN, arrived, fameTeam, fieldOf, healed, rekey, spillOf, teamOf, withMoney, withoutItem } from './carry';
import { startMenuTable } from '../src/touch';
import { FADE_COLOR_WORD, FADE_Y_WORD, fadeOf } from '../src/field';
import type { PatchWorkerRequest, PatchWorkerResponse } from '../src/patch/bps.worker';
import { CATCH_UP_SPEED, spectatePace } from '../src/match/spectate';
import type { SpMsg } from './shared/wire';
import { readTally, type MatchTally } from '../src/match/tally';
import type { FameMon } from '../src/ui/results';
import { MUSIC_ASKED, MUSIC_QUIET, type MusicAsk } from './music';

/** SaveBlock2's options halfword (include/global.h). */
const OPTIONS_AT = 0x14;
/** sizeof(struct BrTally) (include/br/br_tally.h). */
const TALLY_LEN = 52;

/** br_boot.h's BR_BOOT_MAP with BR_BOOT_FLAG_SAFARIKIT: a fresh game with no POKeMON, as
 *  a match starts, and the Safari's POKeBLOCKs for its battles. */
const BOOT_MAP_SAFARIKIT = 0x11;
/** EnterSafariMode's 30: what each round's opening throws from. */
const SAFARI_BALLS = 30;
/** SaveBlock1's POKeBLOCK case, 0x848 up to seen1 (0x988): the Safari battle's feed. */
const BLOCKS_AT = 0x848;
const BLOCKS_LEN = 0x988 - 0x848;
const ME = 0;
const FOE_SEAT = 31;
/** Whose a dropped bag is on the hidden ROM: a seat nobody here sits in. */
const DROP_SEAT = 30;
/** br_match.h's BR_PHASE_SAFARI and BR_PHASE_PLAY (gBrMatch.phase). */
const BR_PHASE_SAFARI = 1;
const BR_PHASE_PLAY = 2;
/** An event's first piece (web/src/match/events.ts's eventKey(0, 0)). */
const LEGEND_KEY = 0xb000;
/** Event 0's trader (BR_EVENT_TRADER_KEY), and below it his claim key. */
const TRADER_KEY = 0xb00f;
/** Ours while a mirror runs: seat 0 is then the publisher's, a ghost with their look. */
const MIRROR_SEAT = 29;
/** global.h's ObjectEvent: 0x24 bytes, currentCoords at 0x10, facing in 0x18's low bits. */
const OBJECT_EVENT_SIZE = 0x24;
/** A facing (DIR_SOUTH..DIR_EAST) as a step. */
const STEP: Record<number, [number, number]> = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0] };

export interface TeamRow { species: number; level: number }
// include/br/br_wild.h.
const WILD_ASKED = 1;
const WILD_FIGHTING = 2;
const WILD_DONE = 3;
const WILD_ASKED_SAFARI = 4;
/** br_wild.h's BR_WILD_ASKED_TEACH: arm the teach for the item in `species`. */
const WILD_ASKED_TEACH = 5;
/** br_wild.h's BR_WILD_ASKED_PICK: the fly map as the drop's picker (br_pick.c). */
const WILD_ASKED_PICK = 6;
// gBattleOutcome.
const LOST = 2;
// include/br/br_ring.h: BR_FOG_TICK_FRAMES.
const FOG_TICK = 240;
/** gBrRing's first ten bytes (active, phase, cx, cy, r, outside, applied, out,
 *  damageTimer) at the match's ring phase: fog everywhere (r = 0xFF, -1), or a ring so
 *  wide nothing is outside it (r = 127 sections). The phase is the level rung (br_levels.c
 *  BrLevels_Tick): the party lifted to it on the field, a wild one rolled at it. */
const ringBytes = (phase: number, fog: boolean) => [1, phase, 0, 0, fog ? 0xff : 0x7f, 0, 0, 0, FOG_TICK & 0xff, FOG_TICK >> 8];
const DREW = 3;
const ROM_BASE = 0x08000000;
/** How long the last fight took to start: from the TRAINER card to the battle running. */
export let lastStart: { ms: number; frames: number } | null = null;

/** How a battle the page asked for went. `ok` false: the ROM never got into it (the page
 *  keeps the screen, and nothing showed). */
/** A battle's end. `released`: who a catch with a full party let go (BrLoot_Released's
 *  SPILL), for the page to lay beside the trainer. */
export interface Fought { ok: boolean; outcome: number; species: number; level: number; released?: { species: number; level: number }[] }

/** A link battle's wire: our blocks out; theirs handed in by the page as they come. */
export interface DuelLink {
  send(seq: number, data: number[]): void;
  /** Called with a function the page hands each block from the other side to. */
  listen(take: ((seq: number, data: number[]) => void) | null): void;
}

/** What the MAP row (MENU_ACTION_BR_MAP) is opened on (ringmap.ts): where this world's
 *  trainer stands, as a MAP section and a cell of it, and the ring as the ROM draws it --
 *  r 127 for nothing fogged (the page fogs over it), -1 for fog everywhere -- and the
 *  section the prompt names safe, in the ROM's own letters ([] names none). */
export interface MapLook { mapsec: number; cellX: number; cellY: number; r: number; place: number[] }

/** Somebody else's battle, as the page hands it to a mirror (watch.ts): what their ROM
 *  published, in order, from its BSTART. */
export interface MirrorFeed {
  /** The next message not yet handed to the ROM, or null. */
  peek(): SpMsg | null;
  shift(): void;
  /** The fight is over where it is fought: once the replay has what came before, it ends. */
  over(): boolean;
  /** Stop watching it, now. */
  stopped(): boolean;
  /** The trainer watched is the publisher's foe: the replay turned round, their back to us. */
  turned: boolean;
  /** Each side's look (the publisher's, their foe's), as their trainers walk. */
  skins: [number, number];
}

export interface Given { items: { id: number; n: number }[]; money: number; used: boolean }

export interface RomBattles {
  /** Fight `name`'s party. Resolves when the ROM is back on the field. */
  fight(name: string, mons: PackedMon[], skin: number, onStart: () => void, fog?: boolean): Promise<Fought>;
  /** The wild battle a marked spot on map (group, num) starts; `behavior` is the spot's
   *  metatile behaviour (water or land, and the backdrop). */
  wild(group: number, num: number, behavior: number, onStart: () => void, fog?: boolean): Promise<Fought>;
  /** Gym leader `n` (br_gym.c's order): their own battle, music and defeat text; won, the
   *  gym's TM and purse. Not ok when they would not fight (TATE&LIZA want two POKeMON). */
  boss(n: number, onStart: () => void, fog?: boolean): Promise<Fought>;
  /** A legendary an event put down (br_legend.c): stood before the hidden trainer as its
   *  own sprite, A on it, its cry, its legendary battle. The outcome says whether it was
   *  caught (7); anything else and it goes back where it stood. */
  legend(species: number, level: number, onStart: () => void, fog?: boolean): Promise<Fought>;
  /** An event's trader (br_event.c), stood before the hidden trainer: A on him, through
   *  his line, and the party menu on the page (`onStart`) to pick which one he gets for
   *  `species` at the rung. The species he was given, or 0 for none. */
  trade(species: number, onStart: () => void): Promise<number>;
  /** A link battle with another trainer (br_netlink.c): this ROM's side of it, the blocks
   *  out through `link.send` and theirs in through `link.recv`. `first` is the side that
   *  challenged (link id 0). Resolves when the ROM is back on the field. */
  duel(me: string, foe: string, skin: number, first: boolean, link: DuelLink, onStart: () => void, fog?: boolean): Promise<Fought>;
  /** The trainer we are fighting went out (left, or the fog took them): the fight is ours
   *  (BrNetlink_PeerOut). */
  foeOut(): void;
  /** The match is mine and I am still fighting (a wild one, a bot, a boss): the ROM's
   *  RESULT win (br_match.c sWinPending) leaves the fight at its next choice with the RUN
   *  that cannot fail, "You won the match!" (BR_RUN_OVER). A link fight ends by foeOut. */
  wonMatch(): void;
  /** The Safari's buzzer while one of its battles runs: the next choice is a RUN out
   *  (br_match.c's BrMatch_BuzzerClosing, BR_RUN_ROLL), so the drop is not kept waiting. */
  buzzer(): void;
  /** The match's ring phase (1 the first, as the host numbers them): the level rung every
   *  battle from now on starts at. */
  setPhase(phase: number): void;
  /** The Safari opening (br_zone.c): wild battles draw any first stage while it runs. */
  setSafari(on: boolean): void;
  /** ROYALe BALLs left to throw in this round's Safari (gNumSafariBalls, 30 a round). */
  safariBalls(): number;
  /** How many POKeMON I carry (gPlayerPartyCount): none until the Safari's first catch. */
  partyCount(): number;
  /** The first of the party still standing, "HP 26/40" (br_hud.c LeadHp); '' with
   *  nobody standing. */
  leadHp(): string;
  /** I won: Emerald's Hall of Fame with my team, the live winner's parade (br_match.c's
   *  RESULT for our own seat). Resolves when it is over (or never came up). */
  fame(onStart: () => void): Promise<boolean>;
  /** Somebody else won: Emerald's Hall of Fame with their team, under their name and
   *  sprite (br_hof.c, POK-417's FAME: "Everyone who is still in the game should see the
   *  hall of fame screen"). Resolves when it is over (or never came up). */
  paradeOf(mons: PackedMon[], name: string, skin: number, onStart: () => void): Promise<boolean>;
  /** The fog's bite between battles (br_ring.c Bleed): a tenth of each mon's max HP, at
   *  least 1, a fainted one's status cleared. How many are still standing. */
  bleed(): Promise<number>;
  /** gBrTally (POK-416): what the hidden battles have counted since boot, for MY STATS;
   *  null for a build without it. */
  tally(): MatchTally | null;
  /** The host's TEXT speed and ANIM (the live room's pace, br_match.c): set on the save
   *  before each battle, since every battle starts from the parked boot (FAST, none). */
  pace(textSpeed: 1 | 3 | 5, animations: boolean): void;
  /** BATTLE BACKDROP's OVER MAP (gBrSeeThrough, br_battle.h): `on` asks the ROM to paint
   *  the battle's backdrop in the key blue; true while it does (its count of frames). */
  seeThrough(on: boolean): boolean;
  /** This frame's picture, RGBA, into `out`; false when the core cannot hand it over. */
  picture(out: Uint8ClampedArray): boolean;
  /** The ring closed on the trainer in the middle of a battle: from the next turn's end
   *  that battle is fought in the fog. Nothing between battles. */
  fogNow(): void;
  /** An item ball picked up: into the bag the ROM's own way (a match's GIVE, so a vitamin
   *  is used and a nugget sold as in a match). What went in, as the ROM filed it; `used`
   *  when it went on the team; null when it did not fit. */
  give(item: number, n: number): Promise<Given | null>;
  /** A TM or a held item off the ground, as a match's pickup takes it (br_loot.c): into
   *  the bag, then the party screen to teach it (the bag's GIVE screen to hold it) on
   *  the ROM's own field, from `onStart` until it is back. What it made of it, as give. */
  teach(item: number, onStart: () => void): Promise<Given | null>;
  /** What the trainer carries, as a bag left on the ground when they are out (POK-232):
   *  read in turn, after whatever was already going in. */
  spill(): Promise<{ items: { id: number; n: number }[]; money: number; mons: TeamRow[] }>;
  /** A fallen trainer's team, as the match opens it (br_loot.c): the bag set down before
   *  the hidden trainer, POKeMON chosen, and the ROM's own BAG screen (br_swap.h) with
   *  each of theirs made fresh at its species and level (MakeTaken, BrLevels_Settle).
   *  Ours on the left, theirs on the right, picks moved across. Resolves, back on the
   *  field, with the team left in the bag. `onStart` is when the screen is up. */
  team(mons: TeamRow[], name: string, onStart: () => void): Promise<TeamRow[]>;
  /** The START menu's row `action` (start_menu.c's MENU_ACTION_*: POKeMON 1, BAG 2, the
   *  trainer card 4), opened the way the match's PARTY button opens it (touch.ts): START,
   *  the cursor walked to the row, A -- all on the hidden field, the page keeping the
   *  screen until the row's own screen is up (`onStart`). Resolves back on the field, with
   *  whatever was used or moved kept: `up` false when the row would not open, and `said`
   *  what the hidden field told the player instead of a screen, for the page to say. */
  menu(action: number, onStart: () => void, onEnd: () => void, look?: MapLook): Promise<{ up: boolean; said: string; flew?: { group: number; num: number; x: number; y: number } }>;
  /** The drop (br_pick.c): the fly map, "Drop where?", opened on `look`, every section a
   *  choice, its own twenty seconds. The section chosen, or 0 when the clock ran out on
   *  none. `onStart` when the map is up. */
  drop(look: MapLook, onStart: () => void): Promise<number>;
  /** Somebody else's battle, replayed on this ROM as the match's spectator replays it
   *  (br_spectate.c: a BSTART, its TURNs, a RESULT to finish), the trainer watched near
   *  the camera. `onStart` when the replay is on screen. Resolves back on the field (or
   *  when `feed` says stop), the hidden ROM put back as it was parked. */
  mirror(feed: MirrorFeed, onStart: () => void): Promise<void>;
  /** Where what this ROM publishes of its own battles goes (a BSTART, then its TURNs):
   *  to the relay, for whoever watches. */
  publish(to: ((m: SpMsg) => void) | null): void;
  /** A screen the page put up (menu, team) closes now: B until it is back on the field
   *  (a challenge closes a menu in the match, br_netlink.c). */
  leave(): void;
  /** A new round: the team, bag and Pokédex the game booted with, after whatever is
   *  on the ROM now. */
  fresh(): Promise<void>;
  /** A new match's seed (the national stand-ins on the routes are the match's). */
  reseed(seed: number): void;
  /** Money out of somebody's bag (br_loot.c's Take pays it). */
  addMoney(n: number): Promise<void>;
  /** One `item` out of the bag (a person wanted it); false when there is none. */
  take(item: number): Promise<boolean>;
  /** The money the trainer has. */
  money(): Promise<number>;
  /** The trainer's own (party, bag, Pokédex), as text for a reload to bring back. */
  save(): Promise<string>;
  /** Back from save()'s text. False when it would not read. */
  load(text: string): Promise<boolean>;
  /** A MART's sale: `n` of `item` into the bag the ROM's own way, `each` paid for every
   *  one that went in. How many did; 0 when they could not pay or nothing fitted. */
  buy(item: number, n: number, each: number): Promise<number>;
  /** The CENTER's heal (HealPlayerParty), on the team the next battle takes. */
  heal(): Promise<void>;
  /** What the team could do on the field now (room.ts FIELD_*). */
  field(): Promise<number>;
  /** The team as the results screen's hall of fame shows it. */
  fameTeam(): Promise<FameMon[]>;
  /** The same, now, from the team the last battle left (null before any): for the end of
   *  a battle, told before the battle's end is. */
  teamNow(): FameMon[] | null;
  /** The song for where the page's trainer is (music.ts), played by the hidden ROM
   *  between battles (br_music.h); null for none, and the ROM stands still between them. */
  music(ask: MusicAsk | null): void;
  /** A sound of the field's (music.ts SE_*, MUS_* fanfares), played once by the hidden
   *  ROM on its field (gBrMusic.sound); nothing on a patch without it, or with no song. */
  sound(id: number): void;
  press(k: GbaKey): void;
  release(k: GbaKey): void;
  emu: Emulator;
}

function gen3(text: string): number[] {
  // A..Z, 0..9 and space: enough for a name card.
  const out: number[] = [];
  for (const ch of text.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) out.push(0xbb + c - 65);
    else if (c >= 48 && c <= 57) out.push(0xa1 + c - 48);
    else out.push(0x00);
  }
  return out;
}

export interface RomFiles {
  emu: Emulator;
  rom: Uint8Array;
  sym: (name: string) => number;
  /** The live game's version line: which ROM is in the tab, in seven characters, and
   *  STALE when br-version.json names another (app.ts buildLine). */
  version: string;
  /** The patched ROM's sha1, seven characters: what a room's battles run on (join's `r`). */
  romSha: string;
}

/** The player's ROM, patched, and its build's symbols. Dev: web/public/spike-rom/ when it
 *  is there. Otherwise the game's own way: the ROM the player picked on the main page
 *  (stored in this browser) with the published patch applied and checked. */
export async function loadRom(canvas: HTMLCanvasElement, say: (text: string) => void, pick: (emu: Emulator) => Promise<void>, devRom: string | null): Promise<RomFiles> {
  const emu = await Emulator.create(canvas);
  const devJson = (url: string) => fetch(url).then((r) => (r.ok && !r.headers.get('content-type')?.includes('html') ? r.json() : null), () => null) as Promise<Record<string, string> | null>;
  const dev = !import.meta.env.DEV || devRom ? null : await devJson('/spike-rom/br-symbols.json');
  if (dev) {
    const rom = new Uint8Array(await (await fetch('/spike-rom/rom.gba')).arrayBuffer());
    const romSha = (await sha1Hex(rom)).slice(0, 7);
    return { emu, rom, sym: (n) => Number(dev[n]), version: `spike B · local build · rom ${romSha}`, romSha };
  }
  // No ROM on this device yet (or a dev `?rom=`, which always wins): ask for one.
  if (!emu.hasRom() || devRom) await pick(emu);
  // Dev: a local build stored as it is runs without a patch, on the sidecars
  // tools/br/dev-patch.sh writes next to it (as app.ts does).
  if (import.meta.env.DEV && isPrePatched(emu.readRom())) {
    const sym = await devJson('/patch/br-symbols.json');
    if (!sym) { say('A local build needs tools/br/dev-patch.sh run first.'); throw new Error('no dev sidecars'); }
    const rom = emu.readRom();
    const romSha = (await sha1Hex(rom)).slice(0, 7);
    return { emu, rom, sym: (n) => Number(sym[n]), version: `spike B · local build · rom ${romSha}`, romSha };
  }
  say('Applying the patch to your ROM…');
  const release = await loadCheckedRelease((patch) => applyPatch(emu.readRom(), patch));
  if (release.status !== 'ready') {
    say(`No patch published: ${release.reason}`);
    throw new Error(release.reason);
  }
  const symbols = release.symbols;
  const mine = (await sha1Hex(release.rom)).slice(0, 7);
  const want = (release.info.romSha1 ?? '').slice(0, 7);
  const build = !want || mine === want ? `rom ${mine}` : `rom ${mine} — STALE, build is ${want}`;
  return { emu, rom: release.rom, sym: (n) => symbols.get(n) ?? NaN, version: `spike B · patch ${release.info.patch} · shell ${release.info.shell.slice(0, 7)} · ${build}`, romSha: mine };
}

function applyPatch(source: Uint8Array, patch: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../src/patch/bps.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PatchWorkerResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'patch worker crashed'));
    };
    const request: PatchWorkerRequest = { source, patch };
    worker.postMessage(request, [source.buffer, patch.buffer]);
  });
}

export async function bootRom({ emu, rom, sym }: RomFiles, seed: number): Promise<RomBattles> {
  const startMenu = startMenuTable(rom, sym('gBrStartMenu'));
  await emu.startBytes(rom);
  const box = new Mailbox(emu, sym('gBrMailbox'));

  // Power-on, then the boot block: a fresh game in Littleroot (0,9) at 5,8, no POKeMON
  // (a match's trainers catch their first in the Safari), name "YOU".
  await frames(emu, 30);
  // No song until the page asks for one: Littleroot's would play on the hidden field.
  const musicAt = sym('gBrMusic');
  if (!Number.isNaN(musicAt)) emu.bytes(musicAt, 2).set([MUSIC_ASKED | MUSIC_QUIET, 0]);
  const boot = [BOOT_MAP_SAFARIKIT, 0, 0, 9, 5, 0, 8, 0, ...gen3('YOU'), 0xff];
  emu.bytes(box.base + MAILBOX.OFF_BOOT, boot.length).set(boot);
  await frames(emu, 400);
  const match = sym('gBrMatch');
  emu.write(match, 2, 8); // mid-match: fights are allowed
  // The page's match seed: the national stand-ins on the routes are this match's
  // (BrZone_NationalOn), as the spots the page deals are (bots/patches.ts).
  emu.write(match + 8, seed >>> 0, 32);
  emu.write(sym('gNumSafariBalls'), SAFARI_BALLS, 8);
  await frames(emu, 2);
  // Parked: every battle starts from here and comes back to it. Whatever a battle leaves
  // on the hidden field -- a whiteout's walk home, a story flag -- is undone, so the next
  // one is never refused (review of #157). The party, the bag (prize money too) and the
  // Pokédex are carried (carry.ts).
  const parked = emu.snapshot();
  if (!parked) throw new Error('the core would not save a state');

  const fightAt = sym('gBrBotFight');
  const menuCbAt = sym('gMenuCallback');
  const netAt = sym('gBrNetlink');
  const askAt = sym('gBrWildAsk');
  const mainFunc = sym('gBattleMainFunc');
  const outcomeAt = sym('gBattleOutcome');
  const catchAt = sym('gBrCatch');
  const ringAt = sym('gBrRing');
  const levelsAt = sym('gBrLevels');
  // gBrTally (POK-416), carried with the trainer like the levels: every battle ends in the
  // parked boot snapshot, which would put the counts back to the boot's.
  const tallyAt = sym('gBrTally');
  const tallyOf = (u: Uint8Array) => { const v = new DataView(u.buffer, u.byteOffset, u.byteLength); return readTally((a, bits) => (bits === 8 ? v.getUint8(a) : bits === 16 ? v.getUint16(a, true) : v.getUint32(a, true)), 0); };
  const mapAt = sym('gBrMap');
  const romView = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const headerAt = sym('gMapHeader');
  const mainAt = sym('gMain');
  const seatAt = sym('gBrMySeat');
  const spectAt = sym('gBrSpectate');
  const overworldCb = sym('CB2_Overworld');
  const objectsAt = sym('gObjectEvents');
  const avatarAt = sym('gPlayerAvatar');
  const partyAt = sym('gPlayerParty');
  const countAt = sym('gPlayerPartyCount');
  const save1 = sym('gSaveBlock1Ptr');
  const ballsAt = sym('gNumSafariBalls');
  const save2 = sym('gSaveBlock2Ptr');
  // gBattleMoves[move].pp, a move's PP before PP UPs. Its stride is found from POUND,
  // KARATE CHOP and DOUBLESLAP's 35, 25 and 10 rather than assumed.
  const movesAt = sym('gBattleMoves');
  const MOVE_PP = 4;
  const romByte = (at: number) => rom[(at - 0x08000000) >>> 0] ?? 0; // the cartridge, not RAM
  const moveSize = [12, 9].find((n) => [35, 25, 10].every((pp, i) => romByte(movesAt + (i + 1) * n + MOVE_PP) === pp)) ?? 12;
  const basePp = (move: number) => romByte(movesAt + move * moveSize + MOVE_PP);
  /** The trainer's own: party, bag and Pokédex, copied out of the ROM, and back in. The
   *  save blocks move at every battle's start, so each is found through its pointer. */
  const kept = () => {
    const s1 = emu.read(save1, 32), s2 = emu.read(save2, 32);
    return {
      count: emu.read(countAt, 8),
      party: emu.bytes(partyAt, PARTY_LEN).slice(),
      bag: emu.bytes(s1 + BAG_AT, BAG_LEN).slice(),
      key: emu.read(s2 + KEY_AT, 32),
      dex: emu.bytes(s2 + DEX2_AT, DEX2_LEN).slice(),
      seen1: emu.bytes(s1 + SEEN1_AT, SEEN_LEN).slice(),
      seen2: emu.bytes(s1 + SEEN2_AT, SEEN_LEN).slice(),
      // The rung the party was lifted to, and the rod it holds for it (br_levels.c).
      levels: emu.bytes(levelsAt, 8).slice(),
      tally: Number.isNaN(tallyAt) ? new Uint8Array(TALLY_LEN) : emu.bytes(tallyAt, TALLY_LEN).slice(),
      // The Safari's POKeBLOCKs and ROYALe BALLs, thrown down a round's opening.
      blocks: emu.bytes(s1 + BLOCKS_AT, BLOCKS_LEN).slice(),
      balls: emu.read(ballsAt, 8),
    };
  };
  const keep = (k: ReturnType<typeof kept>) => {
    const s1 = emu.read(save1, 32), s2 = emu.read(save2, 32);
    emu.write(countAt, k.count, 8);
    emu.bytes(partyAt, PARTY_LEN).set(k.party);
    emu.bytes(s1 + BAG_AT, BAG_LEN).set(rekey(k.bag, k.key, emu.read(s2 + KEY_AT, 32)));
    emu.bytes(s2 + DEX2_AT, DEX2_LEN).set(k.dex);
    emu.bytes(s1 + SEEN1_AT, SEEN_LEN).set(k.seen1);
    emu.bytes(s1 + SEEN2_AT, SEEN_LEN).set(k.seen2);
    emu.bytes(levelsAt, 8).set(k.levels);
    if (!Number.isNaN(tallyAt)) emu.bytes(tallyAt, TALLY_LEN).set(k.tally);
    emu.bytes(s1 + BLOCKS_AT, BLOCKS_LEN).set(k.blocks);
    emu.write(ballsAt, k.balls, 8);
  };
  const send = (msg: Parameters<typeof packSlot>[0]) => {
    for (const s of packSlot(msg)) box.push(s.type, s.payload);
  };
  /** What the ROM said since the last call, whole (romport.ts's drain): a base slot and
   *  its continuations, unframed. One that will not read is skipped. */
  const drain = (handle: (m: Msg) => void) => {
    const raw = box.poll();
    for (let i = 0; i < raw.length;) {
      const group: BinarySlot[] = [raw[i++]];
      while (i < raw.length && (raw[i].type & BR_CONT_FLAG) !== 0) group.push(raw[i++]);
      let m: Msg;
      try { const w = reassembleSlots(group); m = unpackSlot(w.type, w.payload); } catch { continue; }
      handle(m);
    }
  };

  const moneyOf = (k: ReturnType<typeof kept>) => (new DataView(k.bag.buffer, k.bag.byteOffset).getUint32(0, true) ^ k.key) >>> 0;
  const giveNow = async (item: number, n: number): Promise<Given | null> => {
    if (broken) return null;
    const before = kept();
    // br_loot.c's HandleGive: straight into AddBagItem when no bag of ours is waiting.
    lay();
    emu.resume();
    send({ t: 'give', items: [{ id: item, n }] });
    await until(emu, () => box.pending() === 0, 60);
    await frames(emu, 1);
    emu.pause();
    const after = kept();
    // Back to parked with what it left, as after a battle: a refusal's NO ROOM box and
    // the frames it ran are not where the next battle starts.
    if (!repark(true)) broken = true;
    else keep(after);
    carried = last = after;
    const got = arrived(before, after);
    const used = after.party.some((b, i) => b !== before.party[i]);
    return got.items.length || got.money || used ? { ...got, used } : null;
  };

  // A battle of ours, as the ROM publishes it for a spectator (BrSpectate_Publishing).
  let publishTo: ((m: SpMsg) => void) | null = null;
  // ...and a duel's link blocks, to the trainer it is with: whichever drain hears them.
  let blocksTo: ((seq: number, data: number[]) => void) | null = null;
  // ...and a PICKUP the battle's own kick waits on (a legendary's claim): the drain above
  // runs first, so it hands them on.
  let pickupTo: ((m: Extract<Msg, { t: 'pickup' }>) => void) | null = null;
  const published = (m: Msg) => {
    if (m.t === 'bstart' || m.t === 'turn') publishTo?.({ t: m.t, battle: m.battle, data: m.data });
    else if (m.t === 'bt') blocksTo?.(m.seq, m.data);
    else if (m.t === 'pickup') pickupTo?.(m);
  };

  /** One battle: `kick` asks for it, `going` says the ROM took it, `over` that it is back
   *  on the field. The page gets the screen at the battle's first frame (onStart) and
   *  never before, so the hidden field never shows through. */
  let broken = false;
  let fighting = false;
  /** buzzer() set the Zone's phase under a battle: PLAY's again once it ends. */
  let buzzed = false;
  let phase = 1;
  /** The ring as the ROM should see it on its field or in a battle. */
  let seedNow = seed >>> 0;
  let safari = false;
  const lay = (fog = false, at = phase) => {
    emu.bytes(ringAt, 10).set(ringBytes(at, fog));
    emu.write(match + 8, seedNow, 32);
  };
  // The trainer a duel is with left before its turn on the ROM came.
  let foeLeft = false;
  let carried: ReturnType<typeof kept> | null = null;
  // The bag as it last stood, a lost battle's included: what a trainer who is out leaves
  // is what they had at the end, not the bag a loss puts the team back to (as BrMatch_Out
  // reads it, after the battle).
  let last: ReturnType<typeof kept> | null = null;
  // A screen the page opened (a menu row, a bag's team) asked to close.
  let leaving = false;
  const onField = () => ((emu.read(mainAt + 4, 32) & ~1) >>> 0) === overworldCb;
  /** Until the screen the player is on is closed and the field has settled: B a few times
   *  a second once leave() asks for it. */
  const backOnField = async () => {
    let n = 0;
    await until(emu, () => {
      if (leaving && !(n++ % 12)) { emu.press('b'); } else if (leaving && n % 12 === 4) emu.release('b');
      return onField();
    }, Infinity);
    emu.release('b');
  };
  /** The parked field made to stand where `look` says, for the MAP's player icon
   *  (region_map.c InitMapBasedOnPlayerLocation): the section, and a spot on the parked
   *  map's own layout that its sum lands on the cell. Undone by the restore after. */
  const partyMenuAt = sym('gPartyMenu');
  const lookFrom = (look: MapLook) => {
    const r = emu.bytes(ringAt, 36);
    r[4] = look.r & 0xff;
    const place = look.place.slice(0, 16);
    r.set([...place, 0xff], 14);
    r[33] = 0; // nothing to preview: the page blinks it
    emu.write(headerAt + 0x14, look.mapsec, 8);
    const entry = sym('gRegionMapEntries') + look.mapsec * 8 - ROM_BASE;
    const layout = emu.read(headerAt, 32) - ROM_BASE;
    const along = (dim: number, cells: number, cell: number) => Math.max(1, Math.floor(dim / cells)) * cell;
    const s1 = emu.read(save1, 32);
    emu.write(s1, along(romView.getInt32(layout, true), rom[entry + 2], look.cellX), 16);
    emu.write(s1 + 2, along(romView.getInt32(layout + 4, true), rom[entry + 3], look.cellY), 16);
  };
  // One thing at a time on the ROM: a battle asked for while an item goes in waits for it.
  let queue: Promise<unknown> = Promise.resolve();
  // FAST text and no battle scene, as br_boot.c parks the ROM.
  let paceBits = 2 | 0x400;
  const inTurn = <T>(f: () => Promise<T>): Promise<T> => {
    const run = queue.then(f, f);
    queue = run.catch(() => undefined);
    return run;
  };

  // Route music (br_music.h): between turns the hidden ROM runs on, on its parked field,
  // and its sound engine plays the song the page asks for. A turn that uses the ROM stops
  // it and puts the parked state back first (the field it idled on is not where a battle
  // starts), carrying the sound engine across so the song goes on. After a battle, a
  // replay or the parade it starts again from the top, as Emerald's does.
  const sounds: [number, number][] = [];
  const carryAt = sym('gBrSoundCarry');
  if (!Number.isNaN(musicAt) && !Number.isNaN(carryAt))
    for (let at = carryAt - ROM_BASE; romView.getUint32(at, true); at += 8) sounds.push([romView.getUint32(at, true), romView.getUint32(at + 4, true)]);
  let tune: MusicAsk | null = null;
  // Running between turns; and run since the parked state was last put back.
  let singing = false;
  let idled = false;
  let turns = 0;
  const writeTune = () => {
    if (!tune) return;
    const want = [tune.asked, tune.how, tune.group, tune.num, tune.x & 0xff, (tune.x >> 8) & 0xff];
    const now = emu.bytes(musicAt, want.length);
    if (want.some((v, i) => now[i] !== v)) now.set(want);
  };
  /** Back to parked; `sound` carries the sound engine across, so the song goes on. */
  const repark = (sound: boolean): boolean => {
    const held = sound ? sounds.map(([at, n]) => emu.bytes(at, n).slice()) : [];
    if (!emu.restore(parked!)) return false;
    held.forEach((b, i) => emu.bytes(sounds[i][0], b.length).set(b));
    return true;
  };
  const hush = () => {
    if (singing) emu.pause();
    singing = false;
    if (!idled) return;
    idled = false;
    if (!repark(true)) broken = true;
    else if (carried) keep(carried);
  };
  const sing = () => {
    if (broken || singing || turns || !tune || !sounds.length) return;
    writeTune();
    emu.resume();
    singing = idled = true;
  };
  /** A turn that runs the ROM: from the parked state, the song held meanwhile. A turn
   *  that ends some way other than its own put-back is put back before the next. */
  const onCore = <T>(f: () => Promise<T>): Promise<T> => inTurn(async () => {
    turns++;
    hush();
    try { return await f(); } finally { turns--; idled = true; sing(); }
  });
  async function battle(fog: boolean, kick: () => void, going: () => boolean, over: () => boolean, onStart: () => void, after: () => Omit<Fought, 'ok'>): Promise<Fought> {
    if (broken) throw new Error('the parked ROM could not be restored');
    // Every battle from one state would roll the same: a fresh draw each time.
    emu.write(sym('gRngValue'), (Math.random() * 2 ** 32) >>> 0, 32);
    emu.write(mainFunc, 0, 32);
    // The room's pace on SaveBlock2's options (0x14: text speed bits 0-2, battle scene
    // off bit 10), as BrMatch's start writes the live match's.
    const opts = emu.read(save2, 32) + OPTIONS_AT;
    emu.write(opts, (emu.read(opts, 16) & ~0x407) | paceBits, 16);
    // Fought in the fog (br_ring.h): a ring with fog everywhere, so the hidden ROM's own
    // map is outside it. The fog hurts each mon on the field a tenth at every turn's end
    // and can knock it out, as in every fog battle (BrRing_FogEndTurn, HBR-11). None: no
    // ring. The ROM asks the ring again each turn, so fogNow() reaches a battle under way.
    // The rung the fight starts at is the rung it ends at: a phase that moves meanwhile
    // lifts the party at the next thing on the ROM, not on the field the loss left
    // (lifted there, after the OUT, the team came back a bad egg).
    const at = phase;
    lay(fog, at);
    fighting = true;
    emu.resume();
    // A frame on the new ring before the ask: br_main.c runs BrWild_Tick before
    // BrLevels_Tick, so a wild asked on the frame the rung moves rolls at the old one.
    await frames(emu, 2);
    const t0 = performance.now();
    let n = 0;
    const count = emu.onFrame(() => { n++; });
    // Whatever else the ROM says meanwhile is nobody's here (a duel takes its blocks first),
    // but the mon a catch with a full party let go (BrLoot_Released): nothing leaves the match.
    const released: { species: number; level: number }[] = [];
    const pub = emu.onFrame(() => drain((m) => {
      if (m.t === 'spill' && m.seat === ME && !m.bag) for (const r of m.mons) released.push({ species: r.species, level: r.level });
      else published(m);
    }));
    kick();
    const took = await until(emu, going, 600);
    count();
    lastStart = { ms: performance.now() - t0, frames: n };
    // Emerald's battle loop: set once the battle screen itself runs, after the swirl
    // that is drawn over the hidden ROM's own field.
    // A refused ask (DONE at once: no table for that spot) never draws a battle.
    const shown = took && !over() && await until(emu, () => emu.read(mainFunc, 32) !== 0, 600);
    if (!shown) console.warn('spike: no battle', { took, ask: [...emu.bytes(askAt, 8)], fighting: emu.read(fightAt + 2, 8), callback2: emu.read(sym('gMain') + 4, 32).toString(16) });
    let result: Fought = { ok: false, outcome: 0, species: 0, level: 0 };
    // However long it takes: a battle is never pulled out from under the player.
    if (shown) {
      onStart();
      await until(emu, over, Infinity);
      if (buzzed) { emu.write(match, BR_PHASE_PLAY, 8); buzzed = false; }
      // The ring is the battle's: back on the field nothing of it is left to bleed the
      // hidden ROM's party while a catch prompt waits.
      fighting = false;
      lay(false, at);
      result = { ok: true, ...after(), released };
      // A catch with a full party: back on its field the ROM asks which one makes room
      // (br_catch.c). The player answers it on the ROM's screen, as in a match.
      // Ten seconds with the prompt never put up (asked, byte 1, still 0) is a stall, not
      // a slow thumb.
      if (!await until(emu, () => emu.read(catchAt, 8) === 0 || emu.read(catchAt + 1, 8) !== 0, 600))
        console.warn('spike: a catch is still waiting for its prompt after 10 s', { catch: [...emu.bytes(catchAt, 8)], callback2: emu.read(sym('gMain') + 4, 32).toString(16) });
      await until(emu, () => emu.read(catchAt, 8) === 0, Infinity);
      // A loss is a whiteout: in a match the trainer is out. Here the team goes back to
      // how it came in (the ring and elimination are the match's, later).
      const now = kept();
      last = now;
      if (result.outcome !== LOST && result.outcome !== DREW) carried = now;
      // The counts stand either way: a lost battle was still fought (MY STATS).
      else carried = { ...(carried ?? start), tally: now.tally };
    }
    fighting = false;
    pub();
    emu.pause();
    // A ROM that could not be put back would start the next battle from whatever this
    // one left on its field: no more battles from it.
    if (!repark(false)) broken = true;
    else if (carried) keep(carried);
    return result;
  }

  // What a new round starts from: the parked game's own.
  const start = kept();

  return {
    emu,
    press: (k) => emu.press(k),
    release: (k) => emu.release(k),
    sound(id) {
      // Only while the song plays: a ROM standing still would play it when it next ran.
      if (sounds.length && tune && singing && !turns) emu.write(musicAt + 10, id & 0xffff, 16);
    },
    music(ask) {
      tune = ask;
      if (!sounds.length) return;
      if (turns) { if (ask) writeTune(); return; }
      if (!ask) { if (singing) emu.pause(); singing = false; return; }
      if (singing) writeTune();
      else sing();
    },
    fight(name, mons, skin, onStart, fog = false) {
      // The path a bot fight takes: its card, its ghost beside us, its challenge. All three
      // go on the ring in one go, on purpose: the ROM reads the ring in order, so the card
      // is staged before the CHALLENGE that needs it (the fight is up in ~80 frames).
      return onCore(() => battle(fog, () => {
        send({ t: 'trainer', seat: FOE_SEAT, name, mons });
        send({ t: 'place', v: PROTOCOL, seat: FOE_SEAT, map: { group: 0, num: 9 }, x: 20, y: 8, f: 1, st: 'alive', sprite: String(skin) });
        send({ t: 'challenge', seat: FOE_SEAT, opponent: ME, nonce: 0 });
      }, () => emu.read(fightAt + 2, 8) === 1, () => emu.read(fightAt + 2, 8) === 0, onStart,
      () => ({ outcome: emu.read(outcomeAt, 8), species: 0, level: 0 })));
    },
    seeThrough(on) {
      const at = sym('gBrSeeThrough');
      if (Number.isNaN(at)) return false;
      emu.write(at, on ? 1 : 0, 8);
      return on && emu.read(at + 1, 8) > 0;
    },
    picture(out) {
      return emu.lcdPixels(out);
    },
    pace(textSpeed, animations) {
      paceBits = Math.max(0, [1, 3, 5].indexOf(textSpeed)) | (animations ? 0 : 0x400);
    },
    tally() {
      // The trainer's own counts, as the last battle left them (the ROM sits in the boot
      // snapshot between battles).
      return Number.isNaN(tallyAt) ? null : tallyOf((carried ?? kept()).tally);
    },
    bleed() {
      return inTurn(async () => {
        if (broken) return 0;
        const n = emu.read(countAt, 8);
        let alive = 0;
        for (let i = 0; i < n; i++) {
          const at = partyAt + i * 100;
          let hp = emu.read(at + 86, 16);
          if (!hp) continue;
          hp -= Math.min(hp, Math.max(1, Math.floor(emu.read(at + 88, 16) / 10)));
          emu.write(at + 86, hp, 16);
          if (hp) alive++;
          else emu.write(at + 80, 0, 32); // a fainted mon has no status (Bleed)
        }
        carried = last = kept();
        return alive;
      });
    },
    duel(me, foe, skin, first, link, onStart, fog = false) {
      return onCore(async () => {
        // Their blocks, held until our side of the link is open (HandleBt drops any that
        // land before), each said to the ROM once, from their seat.
        const inbox: { seq: number; data: number[] }[] = [];
        let heard = 0;
        link.listen((seq, data) => { if (seq > heard) { heard = seq; inbox.push({ seq, data }); } });
        blocksTo = (seq, data) => link.send(seq, data);
        const watch = emu.onFrame(() => {
          drain(published);
          while (inbox.length && emu.read(netAt, 8)) {
            const b = inbox[0];
            // The fight's first block carries their name (TakePeerName): RIVAL otherwise.
            const slots = packSlot({ t: 'bt', seat: FOE_SEAT, seq: b.seq, data: b.data, ...(b.seq === 1 ? { name: foe } : {}) });
            if (MAILBOX.RING_SLOTS - box.pending() < slots.length) break;
            for (const sl of slots) box.push(sl.type, sl.payload);
            inbox.shift();
          }
        });
        try {
          return await battle(fog, () => {
            // Our name, as our link player says it (FillLinkPlayers reads the save).
            const s2 = emu.read(save2, 32);
            const name = [...gen3(me).slice(0, 7), 0xff];
            emu.bytes(s2, name.length).set(name);
            drain(() => undefined);
            // Their ghost on the cell the hidden trainer faces, then the challenge: ours
            // handed back to us when we challenged (link id 0), theirs to us when not.
            const s1 = emu.read(save1, 32);
            const self = objectsAt + emu.read(avatarAt + 5, 8) * OBJECT_EVENT_SIZE;
            const f = emu.read(self + 0x18, 8) & 15;
            const [dx, dy] = STEP[f] ?? [0, 1];
            const back = (({ 1: 2, 2: 1, 3: 4, 4: 3 } as Record<number, number>)[f] ?? 2) as Dir;
            send({ t: 'place', v: PROTOCOL, seat: FOE_SEAT, map: { group: emu.read(s1 + 4, 8), num: emu.read(s1 + 5, 8) },
              x: emu.read(self + 0x10, 16) + dx, y: emu.read(self + 0x12, 16) + dy, f: back, st: 'alive', sprite: String(skin) });
            send(first ? { t: 'challenge', seat: ME, opponent: FOE_SEAT, nonce: 0 } : { t: 'challenge', seat: FOE_SEAT, opponent: ME, nonce: 0 });
            if (foeLeft) send({ t: 'out', seat: FOE_SEAT });
          }, () => emu.read(netAt, 8) === 1,
          () => emu.read(netAt, 8) === 0 && ((emu.read(mainAt + 4, 32) & ~1) >>> 0) === overworldCb, onStart,
          () => ({ outcome: emu.read(netAt + 11, 8), species: 0, level: 0 }));
        } finally {
          watch();
          blocksTo = null;
          link.listen(null);
          foeLeft = false;
        }
      });
    },
    wonMatch() {
      if (fighting && !broken) send({ t: 'result', seat: ME, outcome: 'win' });
    },
    buzzer() {
      // The parked match is PLAY's; BrMatch_BuzzerClosing asks for the Zone's phase with
      // its clock at 0. Put back as the battle ends, before the field acts on it.
      if (!fighting || broken) return;
      emu.write(match, BR_PHASE_SAFARI, 8);
      emu.write(match + 1, 1, 8);
      emu.write(match + 12, 0, 16);
      buzzed = true;
    },
    foeOut() {
      // Before the duel's turn on the ROM has come (it waits behind whatever was going
      // in), it is said as the fight starts.
      if (fighting && !broken) send({ t: 'out', seat: FOE_SEAT });
      else foeLeft = true;
    },
    setPhase(p) { phase = Math.max(1, Math.min(255, p | 0)); },
    setSafari(on) { safari = on; },
    safariBalls() { return (carried ?? start).balls; },
    partyCount() { return (carried ?? start).count; },
    leadHp() {
      const k = carried ?? start;
      for (let i = 0; i < k.count; i++) {
        const at = i * 100, hp = k.party[at + 86] | (k.party[at + 87] << 8);
        if (hp) return `HP ${hp}/${k.party[at + 88] | (k.party[at + 89] << 8)}`;
      }
      return '';
    },
    fogNow() {
      if (fighting && !broken && emu.read(ringAt + 4, 8) !== 0xff) lay(true);
    },
    spill() {
      return inTurn(async () => {
        const k = last ?? kept();
        return { ...spillOf(k.bag, k.key), mons: teamOf(k.party, k.count) };
      });
    },
    field() {
      return inTurn(async () => {
        const k = carried ?? kept();
        return fieldOf(k.party, k.count);
      });
    },
    teamNow() {
      return carried ? fameTeam(carried.party, carried.count) : null;
    },
    fameTeam() {
      return inTurn(async () => {
        const k = carried ?? kept();
        return fameTeam(k.party, k.count);
      });
    },
    heal() {
      return inTurn(async () => {
        if (broken) return;
        const k = carried ?? kept();
        const next = { ...k, party: healed(k.party, k.count, basePp) as typeof k.party };
        keep(next);
        carried = last = next;
      });
    },
    take(item) {
      return inTurn(async () => {
        if (broken) return false;
        const k = carried ?? kept();
        const bag = withoutItem(k.bag, k.key, item);
        if (!bag) return false;
        const next = { ...k, bag: bag as typeof k.bag };
        keep(next);
        carried = last = next;
        return true;
      });
    },
    addMoney(n) {
      return inTurn(async () => {
        if (broken || n <= 0) return;
        const k = carried ?? kept();
        const next = { ...k, bag: withMoney(k.bag, k.key, n) as typeof k.bag };
        keep(next);
        carried = last = next;
      });
    },
    team(mons, name, onStart) {
      return onCore(async () => {
        if (broken || !mons.length) return mons;
        leaving = false;
        lay();
        emu.resume();
        drain(() => undefined); // anything older is not this bag's
        // The bag where the hidden trainer faces, the team in it: the match's own SPILL,
        // under a seat that is nobody here.
        const s1 = emu.read(save1, 32);
        const self = objectsAt + emu.read(avatarAt + 5, 8) * OBJECT_EVENT_SIZE;
        const [dx, dy] = STEP[emu.read(self + 0x18, 8) & 15] ?? [0, 1];
        const x = emu.read(self + 0x10, 16) + dx, y = emu.read(self + 0x12, 16) + dy;
        const keys = mons.map((_, i) => (DROP_SEAT << 8) | i);
        send({
          t: 'spill', seat: DROP_SEAT, map: { group: emu.read(s1 + 4, 8), num: emu.read(s1 + 5, 8) },
          mons: mons.map((m, i) => ({ key: keys[i], x, y, species: m.species, level: m.level })),
          bag: { key: (DROP_SEAT << 8) | 0xff, x, y, items: [], money: 0, name: name.slice(0, 7) },
        });
        const taken = new Set<number>();
        const put: { species: number; level: number }[] = [];
        const watch = emu.onFrame(() => drain((m) => {
          if (m.t === 'pickup' && keys.includes(m.key)) taken.add(m.key);
          // One of ours put down for theirs (SwapInOurs): it stays with the bag.
          else if (m.t === 'spill' && m.seat !== DROP_SEAT) for (const r of m.mons) put.push({ species: r.species, level: r.level });
        }));
        const tap = async () => { emu.press('a'); await frames(emu, 4); emu.release('a'); };
        const off = () => ((emu.read(mainAt + 4, 32) & ~1) >>> 0) !== overworldCb;
        // A at the bag asks POKeMON or BAG (BrBagMenu_Choose), and the page has asked that
        // already: POKeMON, its first line, once the box hears keys (br_bagmenu.c's
        // BR_BAGMENU_DEAF_FRAMES, 20). Not on the ROM's BUSY: a menu says so only after
        // 120 frames of it (BR_BUSY_MENU_SETTLE), and the page gave up at 120, so a bag's
        // POKeMON opened nothing (Cam, 10-30). The screen is the page's until it is up.
        await frames(emu, 3);
        let up = false;
        for (let i = 0; i < 2 && !up; i++) {
          await tap();
          if ((up = await until(emu, off, 30))) break;
          await tap();
          up = await until(emu, off, 90);
        }
        if (!up) console.warn('spike: the team\'s screen did not open', { callback2: emu.read(mainAt + 4, 32).toString(16) });
        else {
          onStart();
          // B closes it; back on the field the box settles (SettleBoxes): a PICKUP for
          // each of theirs taken, a SPILL for any of ours put down.
          await backOnField();
          await frames(emu, 60);
        }
        watch();
        emu.pause();
        const now = kept();
        if (!repark(true)) broken = true;
        else keep(now);
        carried = last = now;
        return [...mons.filter((_, i) => !taken.has(keys[i])), ...put];
      });
    },
    menu(action, onStart, onEnd, look) {
      return onCore(async () => {
        if (broken || !startMenu) return { up: false, said: '' };
        leaving = false;
        lay();
        if (look) lookFrom(look);
        emu.resume();
        drain(() => undefined);
        // MOVES off the team is noted as it is asked (gBrCatch.movesSlot), for the line its
        // field says when there is nothing to learn. A on a town on the MAP, with somebody
        // who could learn FLY, is Emerald's own flight (br_map.c, POK-278): BrMap_TakeFlight
        // names the bird in gPartyMenu.slotId, which nothing else on a look writes.
        let moves = false;
        if (look) emu.write(partyMenuAt + 9, 0xff, 8);
        const watch = emu.onFrame(() => {
          drain(() => undefined);
          if (!Number.isNaN(catchAt) && emu.read(catchAt + 2, 8) !== 0xff) moves = true;
        });
        let flew: { group: number; num: number; x: number; y: number } | undefined;
        const tap = async (k: GbaKey) => { emu.press(k); await frames(emu, 3); emu.release(k); await frames(emu, 3); };
        let up = false;
        let back = true;
        let said = '';
        const before = kept();
        await tap('start');
        // Taking keys once its handler is in gMenuCallback and its text is drawn.
        if (await until(emu, () => emu.read(menuCbAt, 32) === startMenu.input, 90)) {
          await frames(emu, 12);
          const count = emu.read(startMenu.count, 8);
          const rows = Array.from({ length: count }, (_, i) => emu.read(startMenu.actions + i, 8));
          const target = rows.indexOf(action);
          for (let i = 0; target >= 0 && i < count && emu.read(startMenu.cursor, 8) !== target; i++) {
            const cur = emu.read(startMenu.cursor, 8);
            const down = (target - cur + count) % count;
            await tap(down <= count - down ? 'down' : 'up');
          }
          if (target >= 0 && emu.read(startMenu.cursor, 8) === target) {
            await tap('a');
            up = !leaving && await until(emu, () => !onField(), 120);
          }
        }
        if (up) {
          onStart();
          await backOnField();
          // Out of the row's screen the game puts the START menu back up, on the hidden
          // field: the page takes the screen now, and B shuts the menu out of sight.
          onEnd();
          // A flight: the bird, then the warp, on the hidden field. Where it lands (the
          // town's heal location) is where the page's trainer goes; the hidden ROM is
          // parked again after, as after any row.
          const s1 = () => emu.read(save1, 32);
          const from = emu.read(s1() + 4, 16);
          if (look && emu.read(partyMenuAt + 9, 8) < 6 && await until(emu, () => onField() && emu.read(s1() + 4, 16) !== from, 900)) {
            await frames(emu, 30);
            const s = s1();
            flew = { group: emu.read(s + 4, 8), num: emu.read(s + 5, 8), x: emu.read(s, 16), y: emu.read(s + 2, 16) };
          }
          // Or the row asked the field for a screen of its own and shut the menu: the
          // team's MOVES (party_menu.c's CursorCb_BrMoves) is the relearner once the field
          // is back (BrCatch_Tick). That one is the player's too, and what it taught stays.
          let again = !!flew;
          for (; !flew;) {
            // The START menu takes keys once its handler is back and its text drawn
            // (touch.ts's START_SETTLE_FRAMES).
            await until(emu, () => emu.read(menuCbAt, 32) === startMenu.input || !onField(), 120);
            if (onField()) break;
            again = true;
            onStart();
            await backOnField();
            onEnd();
          }
          if (!flew && emu.read(menuCbAt, 32) === startMenu.input) {
            await frames(emu, 12);
            await tap('b');
          } else back = again;
          // MOVES with nothing to teach: BrCatch_Tick said so on the hidden field's HUD.
          if (moves && !again) said = 'No new moves at this level.';
        }
        await frames(emu, 10);
        watch();
        emu.pause();
        // A row that acted on the field instead of coming back to the menu (an ESCAPE
        // ROPE, a rod, FLY or DIG off the team) did it on the hidden ROM's field, which
        // is not this world: none of it happened, nothing of it is spent.
        const now = back ? kept() : before;
        if (!repark(true)) broken = true;
        else keep(now);
        carried = last = now;
        leaving = false;
        return { up, said, ...(flew ? { flew } : {}) };
      });
    },
    drop(look, onStart) {
      return onCore(async () => {
        if (broken) return 0;
        leaving = false;
        lay();
        lookFrom(look);
        emu.resume();
        drain(() => undefined);
        let section = -1, ran = 0;
        const pickAt = sym('gBrPick');
        const watch = emu.onFrame(() => drain((m) => { if (m.t === 'pick') section = m.section; }));
        emu.write(askAt, WILD_ASKED_PICK, 8);
        const up = await until(emu, () => emu.read(askAt, 8) === WILD_FIGHTING && !onField(), 120);
        if (up) {
          // Off the field is not on screen yet: the ROM fades to black and loads the region
          // map, and showing it then put a black band over the page for a moment at every
          // buzzer. The page keeps the field until the map's fade-in is done (two seconds
          // at most, so a ROM with no fade to read still shows its map).
          const fadeAt = sym('gPaletteFade');
          await until(emu, () => { if (Number.isNaN(fadeAt)) return true; const f = fadeOf(emu.read(fadeAt + FADE_Y_WORD, 16), emu.read(fadeAt + FADE_COLOR_WORD, 16)); return !f.active && f.y === 0; }, 120);
          onStart();
          // Chosen, or the map's clock (BrPick.timer) ran out with the cursor on no place,
          // which asks nothing: a second on, it is nobody's choice.
          await until(emu, () => section >= 0 || leaving || (emu.read(pickAt + 8, 16) === 0 && ++ran > 60), 40 * 60);
        }
        watch();
        emu.pause();
        const now = kept();
        if (!repark(true)) broken = true;
        else keep(now);
        carried = last = now;
        leaving = false;
        return section > 0 ? section : 0;
      });
    },
    mirror(feed, onStart) {
      return onCore(async () => {
        if (broken || !Number.isFinite(spectAt) || !Number.isFinite(seatAt)) return;
        lay();
        emu.resume();
        drain(() => undefined);
        // Both fighters as ghosts with their looks, for the replay's trainer pictures
        // (BrSpectate_SideSkin): the publisher in seat 0, theirs in FOE_SEAT, as their
        // ROM numbered them. The one we follow stands where the hidden trainer faces, so
        // the field's own follow rides it there rather than warping off to find it.
        emu.write(seatAt, MIRROR_SEAT, 8);
        const s1 = emu.read(save1, 32);
        const self = objectsAt + emu.read(avatarAt + 5, 8) * OBJECT_EVENT_SIZE;
        const [dx, dy] = STEP[emu.read(self + 0x18, 8) & 15] ?? [0, 1];
        const map = { group: emu.read(s1 + 4, 8), num: emu.read(s1 + 5, 8) };
        const near = { x: emu.read(self + 0x10, 16) + dx, y: emu.read(self + 0x12, 16) + dy };
        const far = { x: near.x + 6, y: near.y };
        send({ t: 'place', v: PROTOCOL, seat: 0, map, ...(feed.turned ? far : near), f: 1, st: 'alive', sprite: String(feed.skins[0]) });
        send({ t: 'place', v: PROTOCOL, seat: FOE_SEAT, map, ...(feed.turned ? near : far), f: 1, st: 'alive', sprite: String(feed.skins[1]) });
        // Side 1 followed: the replay turned round (WatchingSideOne).
        if (feed.turned) emu.write(spectAt + 8, FOE_SEAT, 8);
        emu.write(mainFunc, 0, 32);
        let shown = false, ended = false, speed = 1, waited = 0, battle = -1;
        const pace = (to: number) => {
          speed = to;
          emu.setSpeed(to);
          emu.setVolume(to === CATCH_UP_SPEED ? 0 : 100);
        };
        const tick = emu.onFrame(() => {
          drain(() => undefined);
          for (let m = feed.peek(); m; m = feed.peek()) {
            const slots = packSlot(m);
            if (MAILBOX.RING_SLOTS - box.pending() < slots.length) break;
            for (const sl of slots) box.push(sl.type, sl.payload);
            if (m.t === 'bstart') battle = m.battle;
            feed.shift();
          }
          if (!shown && emu.read(spectAt + 5, 8) && emu.read(mainFunc, 32) !== 0) { shown = true; onStart(); }
          if (!shown) waited++;
          const want = shown ? spectatePace(emu.read(spectAt + 15, 8), () => false) : 1;
          if (want !== speed) pace(want);
          // The fight is over and everything of it is in: the replay finishes what it has.
          if (shown && !ended && battle >= 0 && feed.over() && !feed.peek() && box.pending() === 0) {
            ended = true;
            send({ t: 'result', seat: battle & 0xff, outcome: 'lose' });
          }
        });
        // Ten seconds and the replay never came up (a BSTART the ROM would not take, or
        // none at all): nothing to watch.
        await until(emu, () => feed.stopped() || (shown ? onField() && !emu.read(spectAt + 5, 8) : waited > 600 || (feed.over() && !feed.peek() && waited > 60)), Infinity);
        tick();
        if (speed !== 1) pace(1);
        emu.pause();
        if (!repark(false)) broken = true;
        else if (carried) keep(carried);
      });
    },
    fame(onStart) {
      return onCore(async () => {
        if (broken) return false;
        if (carried) keep(carried);
        lay();
        emu.resume();
        // br_match.h: BR_PHASE_PLAY, so the RESULT is a win and not an out's; DONE (5)
        // once the parade has run.
        emu.write(match, 2, 8);
        leaving = false;
        send({ t: 'result', seat: ME, outcome: 'win' });
        const up = await until(emu, () => { drain(() => undefined); return leaving || !onField(); }, 600);
        // leave(): cut short (the next round, or the next match, is starting).
        if (up && !leaving) {
          onStart();
          await until(emu, () => { drain(() => undefined); return leaving || emu.read(match, 8) === 5 || onField(); }, 60 * 120);
        }
        leaving = false;
        emu.pause();
        if (!repark(false)) broken = true;
        else if (carried) keep(carried);
        return up;
      });
    },
    paradeOf(mons, name, skin, onStart) {
      return onCore(async () => {
        if (broken || !mons.length) return false;
        if (carried) keep(carried);
        lay();
        emu.resume();
        // A FAME is heard only in a match (br_hof.c HandleFame), and DONE (5) says the
        // parade has run.
        emu.write(match, 2, 8);
        leaving = false;
        // The champion in a seat of their own, as a fight's foe is: present, in their
        // skin (the parade's trainer picture), their team its PARTY rows, then the FAME.
        send({ t: 'place', v: PROTOCOL, seat: FOE_SEAT, map: { group: 0, num: 9 }, x: 20, y: 8, f: 1, st: 'alive', sprite: String(skin) });
        send({ t: 'party', seat: FOE_SEAT, mons: mons.slice(0, 6) });
        send({ t: 'fame', seat: FOE_SEAT, name: name.slice(0, 7) });
        const up = await until(emu, () => { drain(() => undefined); return leaving || !onField(); }, 600);
        if (up && !leaving) {
          onStart();
          await until(emu, () => { drain(() => undefined); return leaving || emu.read(match, 8) === 5 || onField(); }, 60 * 120);
        }
        leaving = false;
        emu.pause();
        if (!repark(false)) broken = true;
        else if (carried) keep(carried);
        return up;
      });
    },
    publish(to) { publishTo = to; },
    leave() { leaving = true; },
    reseed(s) { seedNow = s >>> 0; },
    fresh() {
      return inTurn(async () => {
        if (broken) return;
        // A fresh team, but the counts go on (record() takes each round's difference).
        const k = { ...start, tally: (carried ?? kept()).tally };
        keep(k);
        carried = k;
        last = null;
      });
    },
    give(item, n) {
      return onCore(() => giveNow(item, n));
    },
    teach(item, onStart) {
      return onCore(async () => {
        if (broken) return null;
        const before = kept();
        leaving = false;
        lay();
        emu.resume();
        // Armed first: BrMoves_TeachSoon counts the bag, and opens when the GIVE adds one.
        emu.write(askAt + 4, item, 16);
        emu.write(askAt, WILD_ASKED_TEACH, 8);
        await until(emu, () => emu.read(askAt, 8) === WILD_DONE, 30);
        send({ t: 'give', items: [{ id: item, n: 1 }] });
        await until(emu, () => box.pending() === 0, 60);
        const up = await until(emu, () => { drain(() => undefined); return !onField(); }, 180);
        if (up) {
          onStart();
          // leave() backs out of it with B, like a menu.
          const quiet = emu.onFrame(() => drain(() => undefined));
          await backOnField();
          quiet();
        }
        leaving = false;
        emu.pause();
        const after = kept();
        if (!repark(true)) broken = true;
        else keep(after);
        carried = last = after;
        const got = arrived(before, after);
        const used = after.party.some((b, i) => b !== before.party[i]);
        return got.items.length || got.money || used ? { ...got, used } : null;
      });
    },
    money() {
      return inTurn(async () => moneyOf(carried ?? kept()));
    },
    save() {
      return inTurn(async () => {
        const k = carried ?? kept();
        const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
        return JSON.stringify({ count: k.count, key: k.key, party: b64(k.party), bag: b64(k.bag), dex: b64(k.dex), seen1: b64(k.seen1), seen2: b64(k.seen2), levels: b64(k.levels), tally: b64(k.tally), blocks: b64(k.blocks), balls: k.balls });
      });
    },
    load(text) {
      return inTurn(async () => {
        if (broken) return false;
        try {
          const j = JSON.parse(text);
          const un = (s: string, n: number) => {
            const u = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
            if (u.length !== n) throw new Error('size');
            return u;
          };
          const k = {
            count: j.count >>> 0, key: j.key >>> 0, party: un(j.party, PARTY_LEN), bag: un(j.bag, BAG_LEN),
            dex: un(j.dex, DEX2_LEN), seen1: un(j.seen1, SEEN_LEN), seen2: un(j.seen2, SEEN_LEN), levels: un(j.levels, 8),
            // A save from before the tally rode along: the counts start again.
            tally: typeof j.tally === 'string' ? un(j.tally, TALLY_LEN) : new Uint8Array(TALLY_LEN),
            blocks: typeof j.blocks === 'string' ? un(j.blocks, BLOCKS_LEN) : start.blocks,
            balls: typeof j.balls === 'number' ? j.balls & 0xff : start.balls,
          };
          keep(k);
          carried = last = k;
          return true;
        } catch { return false; }
      });
    },
    buy(item, n, each) {
      return onCore(async () => {
        if (broken || n <= 0 || moneyOf(carried ?? kept()) < n * each) return 0;
        const got = await giveNow(item, n);
        const took = got?.items.find((r) => r.id === item)?.n ?? 0;
        if (!took || broken) return 0;
        const k = carried ?? kept();
        const next = { ...k, bag: withMoney(k.bag, k.key, -took * each) as typeof k.bag };
        keep(next);
        carried = last = next;
        return took;
      });
    },
    trade(species, onStart) {
      return onCore(async () => {
        if (broken) return 0;
        leaving = false;
        lay();
        emu.resume();
        drain(() => undefined);
        const s1 = emu.read(save1, 32);
        const self = objectsAt + emu.read(avatarAt + 5, 8) * OBJECT_EVENT_SIZE;
        const [dx, dy] = STEP[emu.read(self + 0x18, 8) & 15] ?? [0, 1];
        const x = emu.read(self + 0x10, 16) + dx, y = emu.read(self + 0x12, 16) + dy;
        send({ t: 'event', seat: DROP_SEAT, n: 0, mapsec: 0, key: LEGEND_KEY, trader: { map: { group: emu.read(s1 + 4, 8), num: emu.read(s1 + 5, 8) }, x, y, species } });
        let given = 0;
        // His claim (BR_EVENT_CLAIM_KEY): the room already said he is mine, so yes at once;
        // the PICKUP of his key naming a species is the trade done (BrLoot_SendHolds).
        const watch = emu.onFrame(() => drain((m) => {
          if (m.t !== 'pickup') return;
          if (m.key === TRADER_KEY - 1) send({ t: 'pickup', seat: emu.read(seatAt, 8), key: TRADER_KEY });
          else if (m.key === TRADER_KEY && m.item) given = m.item;
        }));
        // A on him (a frame for his sprite to stand), then through his one line to the menu.
        await frames(emu, 4);
        let n = 0;
        const up = await until(emu, () => {
          const k = n++ % 20;
          if (k === 0) emu.press('a'); else if (k === 4) emu.release('a');
          return !onField();
        }, 400);
        emu.release('a');
        if (up) {
          onStart();
          await backOnField();
          // The claim, its answer and the swap, on the field after the menu.
          await until(emu, () => given !== 0, 90);
        } else console.warn('spike: the trader\'s menu did not open');
        watch();
        emu.pause();
        const now = kept();
        if (!repark(true)) broken = true;
        else keep(now);
        carried = last = now;
        return given;
      });
    },
    legend(species, level, onStart, fog = false) {
      let seen = false;
      let stop: (() => void) | null = null;
      return onCore(() => battle(fog, () => {
        drain(() => undefined);
        // Its piece where the hidden trainer faces, under an event's key (BR_EVENT_KEY_BASE),
        // which is what makes it stand as itself (BrLegend_Gfx) and A on it a challenge.
        const s1 = emu.read(save1, 32);
        const self = objectsAt + emu.read(avatarAt + 5, 8) * OBJECT_EVENT_SIZE;
        const [dx, dy] = STEP[emu.read(self + 0x18, 8) & 15] ?? [0, 1];
        const x = emu.read(self + 0x10, 16) + dx, y = emu.read(self + 0x12, 16) + dy;
        send({ t: 'spill', seat: DROP_SEAT, map: { group: emu.read(s1 + 4, 8), num: emu.read(s1 + 5, 8) }, mons: [{ key: LEGEND_KEY, x, y, species, level }] });
        // Its cry asks the room for it (BR_LEGEND_CLAIM_KEY): this page has already had the
        // room's yes, so the answer is ours at once. Then the battle, and back on the field.
        // battle()'s drain hears it (published): it runs before anything registered here.
        pickupTo = (m) => { if (m.key === (LEGEND_KEY | 0x0800)) send({ t: 'pickup', seat: emu.read(seatAt, 8), key: LEGEND_KEY }); };
        stop = emu.onFrame(() => { if (!onField()) seen = true; });
        void frames(emu, 3).then(async () => { emu.press('a'); await frames(emu, 4); emu.release('a'); });
      }, () => emu.read(mainFunc, 32) !== 0, () => {
        return seen && onField();
      }, onStart, () => ({ outcome: emu.read(outcomeAt, 8), species, level }))).finally(() => { stop?.(); pickupTo = null; });
    },
    boss(n, onStart, fog = false) {
      // br_wild.h's BR_WILD_BOSS: the same ask, a leader for a map.
      return onCore(() => battle(fog, () => {
        emu.write(askAt + 1, 0xff, 8);
        emu.write(askAt + 2, n, 8);
        emu.write(askAt + 3, 0, 8);
        emu.write(askAt, WILD_ASKED, 8);
      }, () => emu.read(askAt, 8) !== WILD_ASKED, () => emu.read(askAt, 8) === WILD_DONE, onStart,
      () => ({ outcome: emu.read(askAt + 7, 8), species: 0, level: 0 })));
    },
    wild(group, num, behavior, onStart, fog = false) {
      // br_wild.h: the map, then ASKED; FIGHTING once it is under way, DONE when it is over.
      return onCore(() => battle(fog, () => {
        emu.write(askAt + 1, group, 8);
        emu.write(askAt + 2, num, 8);
        emu.write(askAt + 3, behavior, 8);
        // br_wild.h's ASKED_SAFARI: the opening's roll, any first stage.
        emu.write(askAt, safari ? WILD_ASKED_SAFARI : WILD_ASKED, 8);
      }, () => ![WILD_ASKED, WILD_ASKED_SAFARI].includes(emu.read(askAt, 8)), () => emu.read(askAt, 8) === WILD_DONE, onStart,
      () => ({ outcome: emu.read(askAt + 7, 8), species: emu.read(askAt + 4, 16), level: emu.read(askAt + 6, 8) })));
    },
  };
}

function frames(emu: Emulator, n: number): Promise<void> {
  return new Promise((done) => {
    let left = n;
    const off = emu.onFrame(() => {
      if (--left <= 0) { off(); done(); }
    });
  });
}

function until(emu: Emulator, ok: () => boolean, max: number): Promise<boolean> {
  return new Promise((done) => {
    let left = max;
    const off = emu.onFrame(() => {
      if (ok()) { off(); done(true); }
      else if (--left <= 0) { off(); done(false); }
    });
  });
}
