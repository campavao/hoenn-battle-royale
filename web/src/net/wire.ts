// The battle-royale room vocabulary (POK-217): one JSON `Msg` per message type,
// exchanged page <-> relay <-> page inside the relay's own `{type:"recv", from, m}`
// envelope (relay/server.js) -- this module only ever sees the `m` payload.
//
// Ported from Kanto's `mods/battle_royale/lib/wire.lua`; field names stay short for
// the same reason they were short there -- `step` and `place` travel roughly four
// times a second per player, to every other player. Kept: names, shapes and the
// comments explaining WHY a field exists, wherever Hoenn still has the thing they
// describe. Changed: every message carries `seat` (0..31, a fixed roster slot) where
// Kanto carried an arbitrary `as`/id, because Hoenn always knows the seat and Kanto
// did not; Kanto's town-map cx/cy (Fog centre) become region-map `sx`/`sy` (DESIGN.md
// §6 -- `gRegionMapEntries` is Hoenn's analogue of the town map); `safari` becomes the
// generic `clock`; `took` becomes `pickup`. Dropped entirely: the drawn lobby room
// (Hoenn's lobby is HTML) and anything that was gen1recomp engine plumbing rather
// than room state. See docs/WIRE.md for the message table and the ones this file
// does NOT carry (with why), and `slots.ts` for the binary subset that also crosses
// into the ROM's mailbox.
//
// A peer that speaks a different PROTOCOL is refused at `place`, same as Kanto.
export const PROTOCOL = 1;

export const MAX_SEAT = 31; // roster is 32 seats (br_mailbox.h's `struct BrRoster`)
export const MAX_NAME = 7; // the Gen 1/3 player name box width
export const MAX_ID = 64; // a generic short-string cap (species keys, item ids, ...)
export const MAX_VER = 16; // "0.0.0-dev" plus room for a suffix (Wire.cleanVersion)
export const MAX_CELL = 1000; // overworld tile coordinate bound
export const MAX_TEXT = 96; // a ticker/battle line
export const MAX_PLAYERS = 32;

/** Emerald's own facing constants (include/constants/global.h): 0 has no
 *  DIR_NONE case on this wire -- every place/step/face names a real facing. */
export type Dir = 1 | 2 | 3 | 4; // DIR_SOUTH DIR_NORTH DIR_WEST DIR_EAST

export type Status = 'lobby' | 'alive' | 'battle' | 'out';
export type BusyKind = 'menu' | 'battle';
export type Outcome = 'win' | 'lose' | 'draw' | 'forfeit';

/** An Emerald map reference: MAP_GROUP + MAP_NUM, the pair every warp and event uses. */
export interface MapRef {
  group: number; // u8, MAP_GROUP(...)
  num: number; // u8, MAP_NUM(...)
}

/** The sender's own build (Wire.buildDiffers's PROTOCOL-9 fields), for the door's
 *  "these two cannot fight" message rather than a silent stall at the first engage. */
export interface Build {
  engine?: string; // the engine release this client's patch was built against
  mod?: string; // this mod build's own version
}

export interface Lines {
  intro?: string; // the challenger's own battle-start line
  win?: string; // shown on a win
  lose?: string; // shown on a loss
}

// ---- messages -------------------------------------------------------------

/** Where I am and my status, roughly 4x/second. Crosses into the ROM (place). */
export interface PlaceMsg {
  t: 'place';
  v: number; // sender's PROTOCOL -- a mismatch is refused here, not half-understood
  seat: number; // 0..31, whose position this is
  map?: MapRef; // absent while still in the lobby (not yet spawned)
  x?: number; // tile x, present iff `map` is
  y?: number; // tile y, present iff `map` is
  f: Dir; // facing
  st: Status;
  sprite?: string; // skin id (a Brendan/May variant or NPC sprite key)
  wins?: number; // career win count, for the lobby's seat card
  fill?: number; // host's FILL target (0 = off), for the lobby's seat card
  seed?: number; // the room's match seed, so a guest's lobby shows the same bots
  countdown?: number; // seconds until the host's clock starts the match
  build?: Build;
}

/** A step just committed. Crosses into the ROM (step). */
export interface StepMsg {
  t: 'step';
  seat: number;
  d: Dir;
  x: number;
  y: number;
  map: MapRef;
}

/** A turn in place. Crosses into the ROM (face). */
export interface FaceMsg {
  t: 'face';
  seat: number;
  f: Dir;
  map: MapRef;
}

/** One spawn row inside `start`/`late`. */
export interface Spawn {
  seat: number;
  map: MapRef;
  x: number;
  y: number;
  st?: 'out'; // only ever set on `late` -- a start has no fallen yet
}

/** The host's pace (Kanto POK-186): TEXT SPEED and BATTLE ANIMATION, applied by
 *  every client in the match so nobody reads dialogue at a different speed. */
export interface Pace {
  textSpeed: 1 | 3 | 5;
  animations: boolean;
}

/** Host: the match begins. Crosses into the ROM (start/seed). */
export interface StartMsg {
  t: 'start';
  seed: number;
  spawns: Spawn[]; // one per seated player, at most MAX_PLAYERS
  safari?: number; // seconds, the Safari opening's length (0/absent = plain drop)
  fog?: number; // seconds, the round's fog-phase length
  pace?: Pace;
}

/** Host -> one watcher who joined mid-match (relay unicast, never broadcast): the
 *  match as it stands, `start`'s shape plus per-seat status and the current ring.
 *  JSON only -- a late join is rare and this is not a message the ROM needs to see
 *  a binary version of; the page rebuilds the watcher's own ROM state from it. */
export interface LateMsg {
  t: 'late';
  seed: number;
  spawns: Spawn[]; // `st: "out"` marks the fallen
  fog?: number;
  pace?: Pace;
  ring?: RingMsg;
}

/** I am facing you: fight. Once both sides agree this same shape (minus `lines`) is
 *  pushed into each side's own ROM mailbox naming the opponent seat, so `br_netlink`
 *  knows who it is exchanging blocks with. Crosses into the ROM (challenge). */
export interface ChallengeMsg {
  t: 'challenge';
  seat: number; // the challenger
  opponent: number; // the seat being challenged / engaged
  nonce: number; // ties the reply and the eventual engage to this challenge
  lines?: Lines; // the challenger's own battle text (JSON negotiation only)
}

/** The reply. JSON only -- accept/decline never reaches the ROM; only a resolved
 *  `challenge` does. */
export interface AcceptMsg {
  t: 'accept';
  seat: number;
  opponent: number;
  nonce: number;
  lines?: Lines;
}

export interface DeclineMsg {
  t: 'decline';
  seat: number;
  opponent: number;
  nonce: number;
  why?: string;
}

/** One raw GBA link-block exchange (Kanto's `bt`, renamed for what it now carries:
 *  PvP here is Emerald's own link battle over `br_netlink.c`, so the payload is the
 *  actual block bytes `SendBlock`/`gBlockRecvBuffer` trade, not a Lua lockstep
 *  message). `seq` is the block's own sequence number in the link exchange, distinct
 *  from the mailbox slot continuation sequence in slots.ts. Crosses into the ROM. */
export interface BlockMsg {
  t: 'bt';
  seat: number; // whose block this is
  seq: number; // 0..65535, the link exchange's own counter
  data: number[]; // the block bytes, at most 256 (Emerald's BLOCK_BUFFER_SIZE)
}

/** A link battle starting, published by the challenger so a spectator can replay it as
 *  a BATTLE_TYPE_RECORDED (POK-233). `data` is the seed + both parties + names,
 *  opaque to the page -- the spectator's ROM decodes it. Crosses into the ROM. */
export interface BstartMsg {
  t: 'bstart';
  battle: number; // u16: the seat pair, low seat | high seat << 8
  data: number[]; // seed + parties + names
}

/** The action bytes a published battle produced since the last turn message, streamed
 *  so a spectator's recorded replay stays a turn behind (POK-233). Crosses into the
 *  ROM (fed through RecordedBattle_RecordAllBattlerData on the spectator). */
export interface TurnMsg {
  t: 'turn';
  battle: number; // u16
  data: number[]; // one or more [battler, count, action bytes] runs
}

/** A trainer's full party -- for a bot roster seat (`CreateNPCTrainerParty` builds a
 *  trainer battle's party from this) or a player's, for the Hall of Fame. Crosses
 *  into the ROM (party). */
export interface PartyMsg {
  t: 'party';
  seat: number;
  mons: PackedMon[]; // at most 6
}

/** A bot's trainer card: who it is and what it is carrying. A bot has no ROM, so the
 *  fight against it is an ordinary trainer battle in the player's own -- this is the
 *  party that battle is built from, staged before the challenge that starts it.
 *  Crosses into the ROM (trainer). */
export interface TrainerMsg {
  t: 'trainer';
  seat: number; // the bot's seat
  name: string; // Gen 3 charmap text, at most 7 chars
  mons: PackedMon[]; // 1..6
  /** What it may spend in this fight, out of its own bag (POK-237). Emerald's trainer
   *  AI reads at most MAX_TRAINER_ITEMS = 4, so this is four units at most -- and they
   *  are units, not stacks: two POTIONs are two entries. Absent means an empty bag. */
  items?: number[];
}

/** The ROM that fought a bot says which of the items it was handed were actually used
 *  (POK-237). The bot's bag lives on the host's page and the fight does not, so this
 *  is the only thing that knows -- without it a bot's bag could only ever be guessed
 *  at, and what is left has to be right, because it is what hits the ground when the
 *  bot falls. Crosses out of the ROM (spent). */
export interface SpentMsg {
  t: 'spent';
  seat: number; // the bot whose bag it was
  items: number[]; // the item ids used, at most 4
}

/** Two bots, handed to the hidden proxy instance to fight properly (POK-238). Only
 *  that instance ever receives one: it has no seat and is in no room. Side A's party
 *  goes into its gPlayerParty and B's into gEnemyParty, and both are played by the AI.
 *  Crosses into the ROM (duel). */
export interface DuelMsg {
  t: 'duel';
  seatA: number;
  seatB: number;
  a: PackedMon[]; // 1..6
  b: PackedMon[]; // 1..6
  /** What each side may spend out of its own bag in there (POK-237), at most four
   *  units each. Emerald keeps one trainer's worth of items, so the ROM swaps the
   *  right list in before each side decides. */
  itemsA?: number[];
  itemsB?: number[];
}

/** How it went. Not the mons -- the page sent them and still holds them -- only what
 *  the fight changed: who won, and what each side has left. Crosses out of the ROM
 *  (dresult). */
export interface DresultMsg {
  t: 'dresult';
  seatA: number;
  seatB: number;
  /** 0 = A, 1 = B, 2 = neither: a draw, or a fight that never resolved. */
  winner: number;
  a: { hp: number; status: number }[];
  b: { hp: number; status: number }[];
  /** And what each side actually spent, so the page takes it off the right bag. */
  usedA?: number[];
  usedB?: number[];
}

/** This trainer just ran from that one (POK-266, Kanto v0.49.0): a boot over their
 *  head on everybody's screen. Its own message rather than a fourth `busy` kind --
 *  `busy` means "cannot be challenged", and POK-231's rule is that only the fleer is
 *  held off the pursuer, so reporting a flee as busy would take a runner off the board
 *  for the whole room. Crosses out of and into the ROM (fled). */
export interface FledMsg {
  t: 'fled';
  seat: number; // who ran
  from: number; // who they ran from
}

/** Where a trainer chose to drop (POK-223). The ROM puts the fly map in front of them
 *  when the opening ends and sends the section they picked; the host deals a cell
 *  inside it that nobody else has. Crosses into the ROM (pick). */
export interface PickMsg {
  t: 'pick';
  seat: number;
  section: number; // a MAPSEC_* value -- regionmap.json carries `num` for each
}

/** The cell that pick was answered with. Crosses into the ROM (land). */
export interface LandMsg {
  t: 'land';
  seat: number;
  map: MapRef;
  x: number;
  y: number;
}

export interface PackedMove {
  id: number; // move id
  pp: number; // current PP
  ppUps: number; // 0..3 PP UPs used
}

/** The fields the wire actually carries per mon -- not the ROM's real encrypted
 *  `struct Pokemon`, but a fixed shape `slots.ts` packs to exactly 100 bytes (the
 *  same size as that struct) so the continuation-slot math for a 6-mon party matches
 *  the ticket's own example (6 x 100 = 600 bytes). */
export interface PackedMon {
  species: number; // species id
  level: number; // 1..100
  hp: number; // current HP
  maxHp: number; // max HP
  status: number; // 0 = none, else a status condition id
  moves: PackedMove[]; // at most 4
  heldItem: number; // item id, 0 = none
  otId: number; // original trainer id
  personality: number; // u32, the mon's personality value
  exp: number; // u32
  nickname: string; // Gen 3 charmap text, at most 10 chars
  ot: string; // original trainer name, at most 7 chars
  traded?: boolean; // this row changed hands (Kanto POK-181's trade line)
}

/** A Pokemon in battle fainted -- ROM-emitted, for spectator/HUD state (which party
 *  slot is down) rather than the trainer's own elimination. Crosses into the ROM. */
export interface FaintMsg {
  t: 'faint';
  seat: number;
  index: number; // 0..5, the party slot that fainted
}

/** I have been eliminated. Crosses into the ROM (out). */
export interface OutMsg {
  t: 'out';
  seat: number;
}

/** Watch this seat walk around. Page -> the spectator's own ROM only: the seat being
 *  followed never sees it, and it never leaves the page that sent it. `seat` null
 *  stops following, and the ROM gets 0xFF for it (follow). */
export interface FollowMsg {
  t: 'follow';
  seat: number | null;
}

/** That ground item is mine, or part of a bag is (Kanto's `took`, renamed to match
 *  what it does). A bare `key` is the whole piece; with `item`/`n`, that many of that
 *  item left the bag and the rest is still there; `cash` says the money went too.
 *  Crosses into the ROM (pickup). */
export interface PickupMsg {
  t: 'pickup';
  seat: number;
  key: number; // ground-item instance id (numeric here -- EWRAM has no string ids)
  item?: number; // item id
  n?: number; // 1..99
  cash?: boolean;
}

export interface SpillMon {
  key: number;
  x: number;
  y: number;
  species: number;
  level: number;
}

export interface SpillBag {
  key: number;
  x: number;
  y: number;
  items: { id: number; n: number }[]; // at most 32 stacks
  money: number;
  name?: string; // the fallen trainer's name, at most MAX_NAME chars
}

/** My team hit the ground (DESIGN D8). Crosses into the ROM (spill). */
export interface SpillMsg {
  t: 'spill';
  seat: number;
  map: MapRef;
  mons: SpillMon[]; // at most 6
  bag?: SpillBag;
}

/** One of Hoenn's own route/field trainers has been beaten: hide the sprite everywhere
 *  (POK-287). Kanto's rule, from its README -- beaten means gone, because the world is a
 *  record of the match and reading a route as "somebody got here first" is the point.
 *
 *  This was JSON-only under POK-217's ROM-crossing scope, on the reasoning that each
 *  client's ROM keeps its own beaten-trainer flags. It does -- for the trainers IT beat.
 *  Everybody else saw the spilled Poke Balls on the ground with the trainer still
 *  standing next to them, and could fight and loot the same one again. docs/WIRE.md named
 *  this as the follow-up if it ever mattered in practice; it does.
 *
 *  Crosses into the ROM. `obj` was a string for a page-side view that was never built;
 *  it is the object event's local id now, because EWRAM has no room for names and the
 *  object is found by id anyway. */
export interface NpcOutMsg {
  t: 'npcout';
  seat: number; // the beater
  map: MapRef;
  localId: number; // the object event's local id on that map
}

/** The host's word on where the fog is now; `place` is the section's name so every
 *  client can announce it without a lookup. `sx`/`sy` are region-map SECTION
 *  coordinates -- Hoenn's analogue of Kanto's town-map cell (DESIGN.md §6). `elapsed`
 *  is the host's own match clock, ridden on every shrink so an heir (POK-116) can
 *  carry the fog on rather than restart it. `r < 0` means "over everything". Crosses
 *  into the ROM (ring). */
export interface RingMsg {
  t: 'ring';
  seat: number; // the host
  phase: number; // 1..64
  sx: number; // region-map section x, -64..64
  sy: number; // region-map section y, -64..64
  r: number; // radius in sections; < 0 = everywhere
  place?: string; // the section's name
  elapsed?: number; // seconds since the match began
}

/** A countdown the room is watching (Kanto's `safari`, generalised: the Safari
 *  opening's clock today, and anywhere else a shared countdown is needed later --
 *  "rods stay" per POK-217, Hoenn's Safari Zone keeps the Kanto shape). `left`
 *  reaching 0 is the buzzer. Crosses into the ROM (clock). */
export interface ClockMsg {
  t: 'clock';
  seat: number; // the host
  left: number; // seconds, 0..3600
}

/** Host: the match is over. JSON only, room-level -- not a ROM message (folds
 *  Kanto's `winner` and the "end" half of "win/end": there is no separate broadcast
 *  for "a winner was decided" vs "the match ended", they are the same event). */
export interface WinMsg {
  t: 'win';
  seat?: number; // absent = no winner (an empty room, or a draw)
}

/** Back to the lobby with the roster kept (Kanto POK-20/144). Host only, broadcast
 *  as part of every ending that keeps the room. JSON only. */
export interface AgainMsg {
  t: 'again';
  seat: number; // the host
}

/** What this trainer is doing that is not walking (Kanto POK-113). Edge-triggered:
 *  the ROM sends it when its own answer settles (POK-230), and every peer's ROM keeps
 *  it per seat so the engage leaves a trainer mid-battle alone. `BR_MSG_BUSY` 17:
 *  seat, kind (0 map, 1 menu, 2 battle). */
export interface BusyMsg {
  t: 'busy';
  seat: number;
  kind?: BusyKind; // absent = back on the map
}

/** The seconds left on a fighter's shot clock (POK-231), so somebody watching sees the
 *  pressure they are under. Each fighter publishes its own; a spectator draws the one
 *  belonging to the seat it follows. 0 means they have chosen. Crosses into the ROM
 *  (shot). */
export interface ShotMsg {
  t: 'shot';
  seat: number;
  secs: number; // 0..30
}

/** A spectator asks the trainer they watch what they carry (Kanto POK-18). The answer
 *  is a `party` message for the same seat. Crosses into the ROM (peek). */
export interface PeekMsg {
  t: 'peek';
  seat: number; // the asker
  target: number; // whose party is being asked for
}

/** A bot beat by `seat` -- `target` is the bot's own roster seat. JSON only: bots are
 *  JS-side (DESIGN.md §6), so this never needs to reach a ROM. */
export interface BotOutMsg {
  t: 'botout';
  seat: number; // the beater
  target: number; // the bot's seat
}

export interface BotRecMon {
  species: number;
  hpFrac: number; // 0..1
  traded?: boolean;
}

/** A bot's persistent team changed (Kanto POK-158) -- load-bearing, not cosmetic:
 *  two clients that disagree about a bot's record disagree about who wins a fight
 *  with it. JSON only, same reasoning as `botout`. */
export interface BotRecMsg {
  t: 'botrec';
  seat: number; // the bot's own seat
  mons: BotRecMon[]; // at most 6
  bag?: { items: { id: number; n: number }[]; money: number };
}

export interface FameRow {
  species: number;
  nickname: string;
  level: number;
}

export interface FameStat {
  catches: number;
  beats: number;
  steps: number;
  rings: number; // which ring phase the match ended on, >= 1
  seconds: number;
  money: number;
}

/** The champion's parade, for the whole room to watch (Kanto POK-107). JSON only --
 *  drawn by the page, not the ROM's own Hall of Fame scene. */
export interface FameMsg {
  t: 'fame';
  seat: number; // the champion
  party: FameRow[]; // at most 6
  stat: FameStat;
}

export type TickerKind = 'kill' | 'system' | 'say';

/** A line for the overworld ticker/HUD (new for Hoenn: DESIGN.md §6 draws the
 *  ticker as a ROM window, so unlike Kanto's same-process HUD, the text has to
 *  physically cross the mailbox to reach the screen that draws it). `say` is a
 *  player chat line through the same pipe -- Hoenn has no separate chat feature, so
 *  it rides the ticker as one more kind. Crosses into the ROM (ticker/say). */
export interface TickerMsg {
  t: 'ticker';
  seat: number; // who said it / who the line is about
  kind?: TickerKind; // absent = system
  text: string; // Gen 3 charmap text, at most MAX_TEXT chars
}

/** A lobby seat's ready flag (new for Hoenn: the lobby is HTML, not a drawn room --
 *  DESIGN.md §7 -- so readiness needs its own message where Kanto had none). JSON
 *  only. */
export interface ReadyMsg {
  t: 'ready';
  seat: number;
  ready: boolean;
}

/** ROM -> page: a link/trainer battle this seat was in just concluded. Distinct from
 *  `win` (the room's overall winner) and from `out` (elimination) -- a lost PvP fight
 *  does not by itself eliminate anyone. Crosses into the ROM (result), since the ROM
 *  is what emits it. */
/** Put these items in the bag (POK-280). Kanto's rule is that a fallen trainer's BAG is
 *  items AND money, taken whole in one press. Ours handed over the cash and left the
 *  items on the floor: the ROM's loot table has room for eight pieces on a map and none
 *  at all for what is inside one, and EWRAM has eighty bytes left to argue with. So the
 *  page keeps the contents -- as it already does for the whole match, match/loot.ts --
 *  and gives them over when it sees our own seat take the bag.
 *  Crosses into the ROM only. */
export interface GiveMsg {
  t: 'give';
  items: { id: number; n: number }[];
}

export interface ResultMsg {
  t: 'result';
  seat: number;
  outcome: Outcome;
}

/** An application-level ping/pong, distinct from the relay's own connection
 *  heartbeat (`{type:"ping"}` at the envelope level, relay/server.js) -- this pair
 *  rides inside `m` so two peers (or a peer and the room) can time each other.
 *  JSON only. */
export interface PingMsg {
  t: 'ping';
  seat: number;
  at: number; // sender's own clock, ms, echoed back unchanged on `pong`
}

export interface PongMsg {
  t: 'pong';
  seat: number;
  at: number; // copied verbatim from the `ping` this answers
}

export type Msg =
  | PlaceMsg
  | StepMsg
  | FaceMsg
  | StartMsg
  | LateMsg
  | ChallengeMsg
  | AcceptMsg
  | DeclineMsg
  | BlockMsg
  | BstartMsg
  | TurnMsg
  | PartyMsg
  | TrainerMsg
  | DuelMsg
  | DresultMsg
  | FledMsg
  | SpentMsg
  | PickMsg
  | LandMsg
  | FaintMsg
  | OutMsg
  | PickupMsg
  | SpillMsg
  | NpcOutMsg
  | RingMsg
  | ClockMsg
  | WinMsg
  | AgainMsg
  | BusyMsg
  | FollowMsg
  | PeekMsg
  | ShotMsg
  | BotOutMsg
  | BotRecMsg
  | FameMsg
  | TickerMsg
  | ReadyMsg
  | ResultMsg
  | GiveMsg
  | PingMsg
  | PongMsg;

export class WireError extends Error {}

// ---- validation helpers ----------------------------------------------------

function fail(msg: string): never {
  throw new WireError(msg);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSeat(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SEAT;
}

function reqSeat(m: Record<string, unknown>, field = 'seat'): number {
  const v = m[field];
  if (!isSeat(v)) fail(`missing or out-of-range seat: ${JSON.stringify(v)}`);
  return v as number;
}

function isCell(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= -MAX_CELL && v <= MAX_CELL;
}

function reqCell(m: Record<string, unknown>, field: string): number {
  const v = m[field];
  if (!isCell(v)) fail(`bad cell '${field}': ${JSON.stringify(v)}`);
  return v as number;
}

function isDir(v: unknown): v is Dir {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

function reqDir(m: Record<string, unknown>, field: string): Dir {
  const v = m[field];
  if (!isDir(v)) fail(`bad facing '${field}': ${JSON.stringify(v)}`);
  return v;
}

function isMapRef(v: unknown): v is MapRef {
  if (!isPlainObject(v)) return false;
  const { group, num } = v;
  return (
    typeof group === 'number' && Number.isInteger(group) && group >= 0 && group <= 255 &&
    typeof num === 'number' && Number.isInteger(num) && num >= 0 && num <= 255
  );
}

function reqMapRef(m: Record<string, unknown>, field = 'map'): MapRef {
  const v = m[field];
  if (!isMapRef(v)) fail(`bad map ref '${field}': ${JSON.stringify(v)}`);
  return v as MapRef;
}

function optMapRef(m: Record<string, unknown>, field = 'map'): MapRef | undefined {
  if (m[field] === undefined) return undefined;
  return reqMapRef(m, field);
}

function isShortString(v: unknown, max = MAX_ID): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function optShortString(m: Record<string, unknown>, field: string, max = MAX_ID): string | undefined {
  const v = m[field];
  if (v === undefined) return undefined;
  if (!isShortString(v, max)) fail(`bad string '${field}': ${JSON.stringify(v)}`);
  return v as string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function optInt(m: Record<string, unknown>, field: string, lo: number, hi: number): number | undefined {
  const v = m[field];
  if (v === undefined) return undefined;
  if (!isFiniteNumber(v) || !Number.isInteger(v) || v < lo || v > hi) {
    fail(`bad integer '${field}': ${JSON.stringify(v)}`);
  }
  return v as number;
}

/** A field of raw bytes -- the ROM messages that carry a slice of its own memory. */
function reqBytes(m: Record<string, unknown>, field: string, max: number): number[] {
  const data = m[field];
  if (!Array.isArray(data) || data.length > max) fail(`bad ${field}`);
  for (const b of data) {
    if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) fail(`bad ${field} byte`);
  }
  return data as number[];
}

/** A short run of Gen 3 item ids: the four a trainer may spend in one fight, and the
 *  four a ROM can report back (POK-237). */
function itemIds(raw: unknown, what: string): number[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 4) fail(`bad ${what}`);
  return raw.map((id) => reqInt({ id }, 'id', 1, 0xffff));
}

function reqInt(m: Record<string, unknown>, field: string, lo: number, hi: number): number {
  const v = optInt(m, field, lo, hi);
  if (v === undefined) fail(`missing integer '${field}'`);
  return v as number;
}

function reqBuild(m: Record<string, unknown>, field = 'build'): Build | undefined {
  const v = m[field];
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) fail(`bad build`);
  const engine = v.engine === undefined ? undefined : optShortString({ engine: v.engine }, 'engine', MAX_VER);
  const mod = v.mod === undefined ? undefined : optShortString({ mod: v.mod }, 'mod', MAX_VER);
  if (engine === undefined && mod === undefined) return undefined;
  return { engine, mod };
}

function reqLines(m: Record<string, unknown>, field = 'lines'): Lines | undefined {
  const v = m[field];
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) fail('bad lines');
  return {
    intro: optShortString(v, 'intro', MAX_TEXT),
    win: optShortString(v, 'win', MAX_TEXT),
    lose: optShortString(v, 'lose', MAX_TEXT),
  };
}

function reqSpawns(m: Record<string, unknown>): Spawn[] {
  const v = m.spawns;
  if (!Array.isArray(v)) fail('bad spawns');
  const spawns: Spawn[] = [];
  for (const raw of v.slice(0, MAX_PLAYERS)) {
    if (!isPlainObject(raw)) fail('bad spawn row');
    spawns.push({
      seat: reqSeat(raw),
      map: reqMapRef(raw),
      x: reqCell(raw, 'x'),
      y: reqCell(raw, 'y'),
      st: raw.st === 'out' ? 'out' : undefined,
    });
  }
  if (spawns.length === 0) fail('no spawns');
  return spawns;
}

function reqPace(m: Record<string, unknown>): Pace | undefined {
  const v = m.pace;
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) fail('bad pace');
  const ts = v.textSpeed;
  if (ts !== 1 && ts !== 3 && ts !== 5) fail('bad pace textSpeed');
  if (typeof v.animations !== 'boolean') fail('bad pace animations');
  return { textSpeed: ts, animations: v.animations };
}

function reqRing(m: Record<string, unknown>, field = 'ring'): RingMsg | undefined {
  const v = m[field];
  if (v === undefined) return undefined;
  if (!isPlainObject(v)) fail('bad ring');
  return validateRing(v);
}

function validateRing(m: Record<string, unknown>): RingMsg {
  const phase = reqInt(m, 'phase', 1, 64);
  const sx = reqInt(m, 'sx', -64, 64);
  const sy = reqInt(m, 'sy', -64, 64);
  const r = reqInt(m, 'r', -1, 64);
  return {
    t: 'ring',
    seat: reqSeat(m),
    phase,
    sx,
    sy,
    r,
    place: optShortString(m, 'place'),
    elapsed: optInt(m, 'elapsed', 0, 9_999_999),
  };
}

function reqItems(v: unknown, maxStacks = 32): { id: number; n: number }[] {
  if (!Array.isArray(v)) fail('bad items');
  const out: { id: number; n: number }[] = [];
  for (const raw of v.slice(0, maxStacks)) {
    if (!isPlainObject(raw)) fail('bad item stack');
    const id = raw.id;
    const n = raw.n;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) fail('bad item id');
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 99) fail('bad item count');
    out.push({ id, n });
  }
  return out;
}

// ---- per-type decoders ------------------------------------------------------

type Decoder = (m: Record<string, unknown>) => Msg;

const decoders: Record<string, Decoder> = {
  place: (m) => {
    if (m.v !== PROTOCOL) fail(`protocol ${JSON.stringify(m.v)}, expected ${PROTOCOL}`);
    const map = optMapRef(m);
    const st = m.st;
    if (st !== 'lobby' && st !== 'alive' && st !== 'battle' && st !== 'out') fail('bad status');
    return {
      t: 'place',
      v: PROTOCOL,
      seat: reqSeat(m),
      map,
      x: map ? reqCell(m, 'x') : undefined,
      y: map ? reqCell(m, 'y') : undefined,
      f: reqDir(m, 'f'),
      st,
      sprite: optShortString(m, 'sprite'),
      wins: optInt(m, 'wins', 0, 999_999),
      fill: optInt(m, 'fill', 0, MAX_PLAYERS),
      seed: optInt(m, 'seed', 1, 2_147_483_646),
      countdown: optInt(m, 'countdown', 0, 3600),
      build: reqBuild(m),
    };
  },

  step: (m) => ({
    t: 'step',
    seat: reqSeat(m),
    d: reqDir(m, 'd'),
    x: reqCell(m, 'x'),
    y: reqCell(m, 'y'),
    map: reqMapRef(m),
  }),

  face: (m) => ({
    t: 'face',
    seat: reqSeat(m),
    f: reqDir(m, 'f'),
    map: reqMapRef(m),
  }),

  start: (m) => ({
    t: 'start',
    seed: reqInt(m, 'seed', 0, 2_147_483_647),
    spawns: reqSpawns(m),
    safari: optInt(m, 'safari', 0, 3600),
    fog: optInt(m, 'fog', 1, 86_400),
    pace: reqPace(m),
  }),

  late: (m) => {
    const base = decoders.start(m) as StartMsg;
    return { t: 'late', seed: base.seed, spawns: base.spawns, fog: base.fog, pace: base.pace, ring: reqRing(m) };
  },

  challenge: (m) => ({
    t: 'challenge',
    seat: reqSeat(m),
    opponent: reqSeat(m, 'opponent'),
    nonce: reqInt(m, 'nonce', 0, Number.MAX_SAFE_INTEGER),
    lines: reqLines(m),
  }),

  accept: (m) => ({
    t: 'accept',
    seat: reqSeat(m),
    opponent: reqSeat(m, 'opponent'),
    nonce: reqInt(m, 'nonce', 0, Number.MAX_SAFE_INTEGER),
    lines: reqLines(m),
  }),

  decline: (m) => ({
    t: 'decline',
    seat: reqSeat(m),
    opponent: reqSeat(m, 'opponent'),
    nonce: reqInt(m, 'nonce', 0, Number.MAX_SAFE_INTEGER),
    why: optShortString(m, 'why'),
  }),

  bt: (m) => {
    const data = m.data;
    if (!Array.isArray(data) || data.length > 256) fail('bad block data');
    for (const b of data) if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 255) fail('bad block byte');
    return { t: 'bt', seat: reqSeat(m), seq: reqInt(m, 'seq', 0, 0xffff), data: data as number[] };
  },

  // A published battle's setup and its action stream (POK-233). Both carry raw ROM
  // bytes: the `bstart` is a seed, two names and two real parties (~1.2 KB), the
  // `turn` a handful of action bytes. Without a decoder here every peer drops them as
  // an unknown type and nobody can ever watch anything -- which is exactly what the
  // first three-tab run did.
  bstart: (m) => ({
    t: 'bstart',
    battle: reqInt(m, 'battle', 0, 0xffff),
    data: reqBytes(m, 'data', 1400),
  }),

  turn: (m) => ({
    t: 'turn',
    battle: reqInt(m, 'battle', 0, 0xffff),
    data: reqBytes(m, 'data', 256),
  }),

  // Page -> its own ROM only (docs/WIRE.md); decodable so the type round-trips, but
  // match/spectate.ts refuses one that arrives from anybody else.
  follow: (m) => ({ t: 'follow', seat: m.seat === null ? null : reqSeat(m) }),

  party: (m) => {
    const mons = m.mons;
    if (!Array.isArray(mons) || mons.length === 0 || mons.length > 6) fail('bad party');
    return { t: 'party', seat: reqSeat(m), mons: mons.map(validateMon) };
  },

  pick: (m) => ({ t: 'pick', seat: reqSeat(m), section: reqInt(m, 'section', 0, 0xffff) }),

  land: (m) => ({
    t: 'land',
    seat: reqSeat(m),
    map: reqMapRef(m),
    x: reqCell(m, 'x'),
    y: reqCell(m, 'y'),
  }),

  trainer: (m) => {
    const mons = m.mons;
    if (!Array.isArray(mons) || mons.length === 0 || mons.length > 6) fail('bad trainer party');
    const msg: TrainerMsg = {
      t: 'trainer',
      seat: reqSeat(m),
      name: optShortString(m, 'name', 7) ?? '',
      mons: mons.map(validateMon),
    };
    const items = itemIds(m.items, 'trainer items');
    if (items.length > 0) msg.items = items;
    return msg;
  },

  spent: (m) => ({ t: 'spent', seat: reqSeat(m), items: itemIds(m.items, 'spent items') }),

  fled: (m) => ({ t: 'fled', seat: reqSeat(m), from: reqSeat(m, 'from') }),

  duel: (m) => {
    const side = (raw: unknown, what: string): PackedMon[] => {
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 6) fail(`bad duel ${what}`);
      return (raw as unknown[]).map(validateMon);
    };
    const msg: DuelMsg = {
      t: 'duel',
      seatA: reqSeat(m, 'seatA'),
      seatB: reqSeat(m, 'seatB'),
      a: side(m.a, 'side a'),
      b: side(m.b, 'side b'),
    };
    const itemsA = itemIds(m.itemsA, 'duel items a');
    const itemsB = itemIds(m.itemsB, 'duel items b');
    if (itemsA.length > 0) msg.itemsA = itemsA;
    if (itemsB.length > 0) msg.itemsB = itemsB;
    return msg;
  },

  dresult: (m) => {
    const left = (raw: unknown, what: string): { hp: number; status: number }[] => {
      if (!Array.isArray(raw) || raw.length > 6) fail(`bad dresult ${what}`);
      return (raw as unknown[]).map((row) => {
        if (!isPlainObject(row)) fail(`bad dresult ${what}`);
        return {
          hp: reqInt(row, 'hp', 0, 0xffff),
          status: reqInt(row, 'status', 0, 0xff),
        };
      });
    };
    const msg: DresultMsg = {
      t: 'dresult',
      seatA: reqSeat(m, 'seatA'),
      seatB: reqSeat(m, 'seatB'),
      winner: reqInt(m, 'winner', 0, 2),
      a: left(m.a, 'side a'),
      b: left(m.b, 'side b'),
    };
    const usedA = itemIds(m.usedA, 'dresult used a');
    const usedB = itemIds(m.usedB, 'dresult used b');
    if (usedA.length > 0) msg.usedA = usedA;
    if (usedB.length > 0) msg.usedB = usedB;
    return msg;
  },

  faint: (m) => ({ t: 'faint', seat: reqSeat(m), index: reqInt(m, 'index', 0, 5) }),

  out: (m) => ({ t: 'out', seat: reqSeat(m) }),

  pickup: (m) => {
    const key = reqInt(m, 'key', 0, 0xffff);
    const hasItem = m.item !== undefined;
    return {
      t: 'pickup',
      seat: reqSeat(m),
      key,
      item: hasItem ? reqInt(m, 'item', 0, 0xffff) : undefined,
      n: hasItem ? reqInt(m, 'n', 1, 99) : undefined,
      cash: hasItem ? m.cash === true : undefined,
    };
  },

  spill: (m) => {
    const mons = m.mons;
    if (!Array.isArray(mons)) fail('bad spill mons');
    const rows: SpillMon[] = mons.slice(0, 6).map((raw) => {
      if (!isPlainObject(raw)) fail('bad spill row');
      return {
        key: reqInt(raw, 'key', 0, 0xffff),
        x: reqCell(raw, 'x'),
        y: reqCell(raw, 'y'),
        species: reqInt(raw, 'species', 1, 0xffff),
        level: reqInt(raw, 'level', 1, 100),
      };
    });
    const bagRaw = m.bag;
    let bag: SpillBag | undefined;
    if (bagRaw !== undefined) {
      if (!isPlainObject(bagRaw)) fail('bad bag');
      bag = {
        key: reqInt(bagRaw, 'key', 0, 0xffff),
        x: reqCell(bagRaw, 'x'),
        y: reqCell(bagRaw, 'y'),
        items: reqItems(bagRaw.items ?? []),
        money: reqInt(bagRaw, 'money', 0, 999_999),
        name: optShortString(bagRaw, 'name', MAX_NAME),
      };
    }
    if (rows.length === 0 && !bag) fail('empty spill');
    return { t: 'spill', seat: reqSeat(m), map: reqMapRef(m), mons: rows, bag };
  },

  npcout: (m) => ({
    t: 'npcout',
    seat: reqSeat(m),
    map: reqMapRef(m),
    localId: reqInt(m, 'localId', 1, 255),
  }),

  ring: (m) => validateRing(m),

  clock: (m) => ({ t: 'clock', seat: reqSeat(m), left: reqInt(m, 'left', 0, 3600) }),

  win: (m) => ({ t: 'win', seat: optInt(m, 'seat', 0, MAX_SEAT) }),

  again: (m) => ({ t: 'again', seat: reqSeat(m) }),

  busy: (m) => {
    const kind = m.kind;
    return {
      t: 'busy',
      seat: reqSeat(m),
      kind: kind === 'menu' || kind === 'battle' ? kind : undefined,
    };
  },

  peek: (m) => ({ t: 'peek', seat: reqSeat(m), target: reqSeat(m, 'target') }),

  shot: (m) => ({ t: 'shot', seat: reqSeat(m), secs: reqInt(m, 'secs', 0, 60) }),

  botout: (m) => ({ t: 'botout', seat: reqSeat(m), target: reqSeat(m, 'target') }),

  botrec: (m) => {
    const mons = m.mons;
    if (!Array.isArray(mons) || mons.length === 0 || mons.length > 6) fail('bad botrec mons');
    const rows: BotRecMon[] = mons.map((raw) => {
      if (!isPlainObject(raw)) fail('bad botrec row');
      const hpFrac = raw.hpFrac;
      if (typeof hpFrac !== 'number' || !Number.isFinite(hpFrac)) fail('bad botrec hp');
      return {
        species: reqInt(raw, 'species', 1, 0xffff),
        hpFrac: Math.max(0, Math.min(1, hpFrac)),
        traded: raw.traded === true ? true : undefined,
      };
    });
    const bagRaw = m.bag;
    let bag: BotRecMsg['bag'];
    if (bagRaw !== undefined) {
      if (!isPlainObject(bagRaw)) fail('bad botrec bag');
      bag = { items: reqItems(bagRaw.items ?? []), money: reqInt(bagRaw, 'money', 0, 999_999) };
    }
    return { t: 'botrec', seat: reqSeat(m), mons: rows, bag };
  },

  fame: (m) => {
    const party = m.party;
    if (!Array.isArray(party) || party.length === 0 || party.length > 6) fail('bad fame party');
    const rows: FameRow[] = party.map((raw) => {
      if (!isPlainObject(raw)) fail('bad fame row');
      return {
        species: reqInt(raw, 'species', 1, 0xffff),
        nickname: optShortString(raw, 'nickname', MAX_ID) ?? String(reqInt(raw, 'species', 1, 0xffff)),
        level: reqInt(raw, 'level', 1, 100),
      };
    });
    const st = isPlainObject(m.stat) ? m.stat : {};
    return {
      t: 'fame',
      seat: reqSeat(m),
      party: rows,
      stat: {
        catches: optInt(st, 'catches', 0, 99_999) ?? 0,
        beats: optInt(st, 'beats', 0, 99_999) ?? 0,
        steps: optInt(st, 'steps', 0, 9_999_999) ?? 0,
        rings: optInt(st, 'rings', 1, 64) ?? 1,
        seconds: optInt(st, 'seconds', 0, 999_999) ?? 0,
        money: optInt(st, 'money', 0, 999_999) ?? 0,
      },
    };
  },

  ticker: (m) => {
    const kind = m.kind;
    return {
      t: 'ticker',
      seat: reqSeat(m),
      kind: kind === 'kill' || kind === 'system' || kind === 'say' ? kind : undefined,
      text: optShortString(m, 'text', MAX_TEXT) ?? fail('bad ticker text'),
    };
  },

  ready: (m) => {
    if (typeof m.ready !== 'boolean') fail('bad ready flag');
    return { t: 'ready', seat: reqSeat(m), ready: m.ready };
  },

  result: (m) => {
    const outcome = m.outcome;
    if (outcome !== 'win' && outcome !== 'lose' && outcome !== 'draw' && outcome !== 'forfeit') fail('bad outcome');
    return { t: 'result', seat: reqSeat(m), outcome };
  },

  give: (m) => ({ t: 'give', items: reqItems(m.items ?? [], 8) }),

  ping: (m) => ({ t: 'ping', seat: reqSeat(m), at: reqInt(m, 'at', 0, Number.MAX_SAFE_INTEGER) }),
  pong: (m) => ({ t: 'pong', seat: reqSeat(m), at: reqInt(m, 'at', 0, Number.MAX_SAFE_INTEGER) }),
};

function validateMon(raw: unknown): PackedMon {
  if (!isPlainObject(raw)) fail('bad party mon');
  const moves = raw.moves;
  const packedMoves: PackedMove[] = [];
  if (moves !== undefined) {
    if (!Array.isArray(moves) || moves.length > 4) fail('bad moves');
    for (const mv of moves) {
      if (!isPlainObject(mv)) fail('bad move');
      packedMoves.push({
        id: reqInt(mv, 'id', 0, 0xffff),
        pp: reqInt(mv, 'pp', 0, 99),
        ppUps: reqInt(mv, 'ppUps', 0, 3),
      });
    }
  }
  return {
    species: reqInt(raw, 'species', 1, 0xffff),
    level: reqInt(raw, 'level', 1, 100),
    hp: reqInt(raw, 'hp', 0, 999),
    maxHp: reqInt(raw, 'maxHp', 1, 999),
    status: reqInt(raw, 'status', 0, 255),
    moves: packedMoves,
    heldItem: optInt(raw, 'heldItem', 0, 0xffff) ?? 0,
    otId: optInt(raw, 'otId', 0, 0xffff) ?? 0,
    personality: optInt(raw, 'personality', 0, 0xffffffff) ?? 0,
    exp: optInt(raw, 'exp', 0, 0xffffffff) ?? 0,
    nickname: optShortString(raw, 'nickname', 10) ?? '',
    ot: optShortString(raw, 'ot', 7) ?? '',
    traded: raw.traded === true ? true : undefined,
  };
}

/** Encodes a `Msg` to the JSON string the relay forwards verbatim as `m`. */
export function encode(msg: Msg): string {
  return JSON.stringify(msg);
}

/** Decodes and validates a `Msg` off the wire. Throws WireError on an unknown type,
 *  a missing/out-of-range `seat`, or any field that fails its own check -- the relay
 *  forwards whatever the other end sent, and "the other end" is a stranger's build. */
export function decode(json: string): Msg {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new WireError(`invalid JSON: ${(e as Error).message}`);
  }
  if (!isPlainObject(parsed)) throw new WireError('not an object');
  const t = parsed.t;
  if (typeof t !== 'string' || !(t in decoders)) throw new WireError(`unknown type: ${JSON.stringify(t)}`);
  return decoders[t](parsed);
}
