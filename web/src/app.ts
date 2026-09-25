// The web shell's state machine (POK-213): importing -> patching -> playing.
// Plain DOM, phone-first (see index.html for layout). Everything Emerald/GBA-specific
// goes through emu/index.ts's Emulator wrapper -- this file never touches the core
// directly, per the project CLAUDE.md.

import { KEY_BIT, Emulator, type GbaKey } from './emu';
import { checkEmerald, isPrePatched, sha1Hex } from './rom/emerald';
import { loadCheckedRelease, loadSidecars, type CheckedRelease, type ReleaseInfo } from './release';
import type { PatchWorkerRequest, PatchWorkerResponse } from './patch/bps.worker';
import { Mailbox, MAILBOX } from './net/mailbox';
import { RelayClient, type RoomListing, type RosterEvent } from './net/relay';
import { Bridge } from './net/bridge';
import { RomPort } from './net/romport';
import { PARTY_BAG_MAX, type BstartMsg, type Msg, type PackedMon, type TurnMsg } from './net/wire';
import { MAP_OFFSET, toRomCells } from './net/cells';
import { encodeGen3 } from './text/gen3';
import { writeHudClockSecs, writeHudEyes, writeHudLeft, writeMySeat, writeMySkin } from './net/hud';
import { DEFAULT_SAFARI_SECS, Director, type DirectorState, type DirectorWorld } from './match/director';
import { nameBstart, romReplaying, Spectate } from './match/spectate';
import { bossAt } from './match/bosses';
import { Loot } from './match/loot';
import { Results } from './match/results';
import { Bots } from './bots/brain';
import { lootView, resumeAt, routeToBots } from './bots/adapt';
import { romCell, type RomCell } from './bots/space';
import { dealBots, MAX_SEATS } from './bots/roster';
import type { Bot } from './bots/roster';
import { type BotVoice, lineAt, nextLine, voiceFor } from './bots/lines';
import * as Ticker from './match/ticker';
import { readZonePool } from './match/zone';
import { NpcFog } from './match/npcfog';
import { emptyNote, isRoomCode, playRows, profileRows, roomRows, type LobbyAction, type LobbyRow } from './match/lobby';
import { clockLeftAt, onRefused, ringClockLeft } from './match/room';
import { Stage } from './ui/stage';
import { drawerKey, drawerLabel, stageKey } from './ui/roomkeys';
import { menuScreen, roomScreen, wardrobeScreen, type RoomModel, type RoomSeat, type RowSpec } from './ui/screens';
import {
  canStart,
  doorOf,
  nextDoor,
  nextFog,
  nextMax,
  nextTextSpeed,
  roomView,
  startNote,
  type RoomView,
  textSpeedLabel,
  nextSafari,
  safariLabel,
} from './match/room';
import { Roster, type RosterEntry } from './match/roster';
import type { TickerMsg, MapRef } from './net/wire';
import { World, type WorldMap } from './bots/world';
import { TouchLayer } from './touch';
import { STICK_KEY, guessedStickKeys, learnAxis, loadStickMap, stickKeys, type AxisSense, type StickMap } from './pad';
import { BAND, FieldView } from './field';
import { sectionInside } from './match/ring';
import { dealParty, speciesName } from './bots/party';
import { MatchLog, saveMatch } from './match/log';
import { dealBag } from './bots/bag';
import { ProxyDuels } from './bots/proxy';
import { mulberry32 } from './match/clock';
import {
  careerLine,
  exportCareer,
  importCareer,
  cleanName,
  loadCareer,
  nextSkin,
  peekSkin,
  skinNote,
  skinUnlocked,
  ordinal,
  recordMatch,
  saveProfile,
  SKINS,
} from './match/career';
import { loadStats, recordSolo, setStatsOff, statFlushed, statMessage } from './match/stats';
import worldData from './data/world.json';
import TRAINERS from './data/trainers.json';
import { DOORSTEPS, HAND, LANDING } from './match/landing';
import { SAFARI_CELLS } from './match/safari';
import { cardFor } from './match/card';
import { MatchRecord, recordLines } from './match/record';
import {
  botRows,
  botSeatsOf,
  catchUp,
  departedSeats,
  freshMatch,
  lootOwed,
  onAgain,
  onPromotion,
  seatsFor,
  type MatchSnapshot,
} from './match/lifecycle';
import regionmapData from './data/regionmap.json';
import { parseRoomHash as parseHash, withoutRoom, withRoom, type RoomHash, type RoomMode } from './hash';

// The world data the director deals spawns and picks ring centres from (POK-223/224).
// Cast rather than re-declared: these three JSON files are the exporter's own output
// (DESIGN.md §6), and director.ts only reads the handful of fields it documents on
// `DirectorMapEntry`/`LandingCell`/`RegionSection` -- a wider real shape satisfies it.
const WORLD: DirectorWorld = {
  maps: worldData.maps as DirectorWorld['maps'],
  landing: LANDING,
  doorsteps: DOORSTEPS,
  hand: HAND,
  sections: regionmapData.sections as DirectorWorld['sections'],
};

const MUTE_STORAGE_KEY = 'hbr:muted';
const UNMUTED_VOLUME = 100;
const NAME_STORAGE_KEY = 'hbr:name';
const DEFAULT_NAME = 'CAM';
const DEFAULT_RELAY_URL = 'wss://hoenn-relay-production.up.railway.app';

// The boot block (include/br/br_boot.h): a fresh game, dropped straight into
// Littleroot, skipping the intro/Birch/naming screen every driver and every match
// alike would otherwise have to sit through.
const BR_BOOT_MAP = 1;
// Solo only (POK-222): warp straight into the Safari opening, skipping Littleroot --
// there is no lobby to wait in when there's nobody else to wait for.
const BR_BOOT_SAFARI = 2;
// br_boot.h: ORed into the mode, hands the ROM a level 5 Treecko. Dev only, and only
// on an explicit `#testmon` -- the e2e needs two seats able to actually fight before
// anyone has caught anything.
const BR_BOOT_FLAG_TESTMON = 0x80;
const MALE = 0;
const FEMALE = 1;
const LITTLEROOT = { group: 0, num: 9, x: 5, y: 8 };
/** `struct BrBoot` (include/br/br_boot.h): where writeBootBlock puts each field. */
const BOOT_AT = { mode: 0, gender: 1, mapGroup: 2, mapNum: 3, x: 4, y: 6, name: 8 };

/** One of the page's own elements. Throws with the selector rather than handing back a
 *  null dressed as an element: POK-320 removed a button and solo fell over on it with a
 *  bare TypeError, far from the lookup, in the one mode that reached it (7a4713615).
 *  lookups.test.ts checks every id this file looks up against index.html. */
const $ = <T extends Element>(sel: string): T => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`no ${sel} on the page (index.html)`);
  return el as T;
};

type Screen = 'importing' | 'patching' | 'lobby' | 'playing';
const SCREENS: Screen[] = ['importing', 'patching', 'lobby', 'playing'];

function showScreen(screen: Screen): void {
  for (const s of SCREENS) $(`#screen-${s}`).toggleAttribute('hidden', s !== screen);
  // On the playing screen the header's job moves into the drawer (index.html).
  document.body.classList.toggle('playing', screen === 'playing');
}

/** The stage every screen outside the game is drawn on (POK-320): the lobby before a
 *  match and the room before START. One canvas, made when first needed. */
let stage: Stage | null = null;
function theStage(): Stage {
  if (!stage) stage = new Stage($('#stage') as HTMLElement, $('#ui') as HTMLCanvasElement, $('#ui-hits') as HTMLElement);
  return stage;
}
/** What a match starting does to the room screen: set by wireRoom, called by anything
 *  that learns a match is on. */
let hideRoomHook: (() => void) | null = null;

function setVersionLine(text: string): void {
  $('#version').textContent = text;
  $('#drawer-version').textContent = text;
}

/** The phone's chrome (Cam, 2026-09-18): in a match, only game controls are on the
 *  glass and everything else waits behind the menu button. The results open the
 *  drawer themselves, because "you are out" is not something to go looking for. */
function setInMatch(on: boolean): void {
  document.body.classList.toggle('in-match', on);
  if (on) hideRoomHook?.();
  if (!on) document.body.classList.remove('drawer-open');
  ($('#menu-btn') as HTMLButtonElement).setAttribute('aria-expanded', String(document.body.classList.contains('drawer-open')));
}

function openDrawer(open: boolean): void {
  document.body.classList.toggle('drawer-open', open);
  ($('#menu-btn') as HTMLButtonElement).setAttribute('aria-expanded', String(open));
}

function versionText(info: ReleaseInfo): string {
  return `patch ${info.patch} · shell ${info.shell.slice(0, 7)}`;
}

/** Which ROM is actually running, in seven characters. `patch` is a hand-bumped
 *  constant and `shell` is package.json's, so neither moves when a build does -- and
 *  the play-test spent a night reporting bugs from a ROM three hours older than the
 *  fixes for them, with nothing on screen able to say so. This is that, said out loud:
 *  the sha1 of the ROM in the tab (`running`), and the one the sidecar expects beside
 *  it when they differ. */
function buildLine(info: ReleaseInfo, running: string): string {
  const mine = running.slice(0, 7);
  const want = (info.romSha1 ?? '').slice(0, 7);

  if (!want || mine === want) return `rom ${mine}`;
  return `rom ${mine} — STALE, build is ${want}`;
}

/** Why this tab could not get the ROM br-version.json names, even fetched past every
 *  cache (POK-330 #23) -- or null. Solo still plays; a room would be a link battle
 *  between two builds, and that desyncs. */
let roomsRefused: string | null = null;

/** Said instead of joining a room, with the one way out: a reload. */
function refuseRoom(why: string): void {
  showScreen('patching');
  ($('#patch-status') as HTMLElement).textContent = 'Online play is off in this tab.';
  const banner = $('#patch-banner') as HTMLElement;
  banner.textContent =
    `It could not get the current release (${why}), and everybody in a room has to run`
    + ' the same build. Reload to try again -- SOLO VS BOTS still works.';
  banner.hidden = false;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'RELOAD';
  reload.addEventListener('click', () => backToLobby());
  banner.after(reload);
}

// ---- BPS patching, off the main thread ---------------------------------------------

function applyPatchInWorker(source: Uint8Array, patch: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./patch/bps.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<PatchWorkerResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'patch worker crashed'));
    };
    const request: PatchWorkerRequest = { source, patch };
    // Transferred, not cloned: both buffers are one-shot copies (a fresh readRom() /
    // fetch result) that nothing else on the main thread needs afterwards.
    worker.postMessage(request, [source.buffer, patch.buffer]);
  });
}

// ---- importing ----------------------------------------------------------------------

async function runImportScreen(emu: Emulator): Promise<void> {
  // Dev only: a `#rom=` in the hash always wins over whatever is stored.
  const devRomHash = import.meta.env.DEV ? new URLSearchParams(location.hash.slice(1)).get('rom') : null;
  if (emu.hasRom() && !devRomHash) return; // already imported on this device; nothing to do

  showScreen('importing');
  const input = $('#rom-input') as HTMLInputElement;
  const dropzone = $('#dropzone') as HTMLElement;
  const errorEl = $('#import-error') as HTMLElement;

  const bytes = await new Promise<Uint8Array>((resolve) => {
    const showError = (reason: string) => {
      errorEl.textContent = reason;
      errorEl.hidden = false;
    };

    const handle = async (file: File) => {
      errorEl.hidden = true;
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      if (import.meta.env.DEV && isPrePatched(fileBytes)) {
        resolve(fileBytes); // a local build: dev runs it without a patch
        return;
      }
      const result = await checkEmerald(fileBytes);
      if (!result.ok) {
        showError(result.reason ?? 'not a Pokémon Emerald (U) ROM, 16 MiB');
        return;
      }
      resolve(fileBytes);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void handle(file);
    });
    // A ROM picked BEFORE this listener existed is still sitting on the input, and
    // nothing would ever read it.
    //
    // `#screen-importing` is the page's default screen -- it carries no `hidden` in
    // index.html -- so the dropzone and the file picker are live from the first paint,
    // while this listener is not attached until runImportScreen runs, which is after
    // `await Emulator.create()`: five pthread workers and a 1.8 MB wasm core. Over a slow
    // connection that is seconds, and a change event fired in the gap lands on nothing.
    // The file is silently never read and the shell waits for ever, which looks exactly
    // like a shell that cannot patch -- it is what the first live test of the deployed
    // site hit, and a quick player on a slow line can hit it too.
    if (input.files?.[0]) void handle(input.files[0]);
    // Dev only: `#rom=<absolute path>` pulls a local file through Vite's /@fs/ route so a
    // headless browser can drive the shell without a file picker. Never in production.
    const devRom = import.meta.env.DEV ? new URLSearchParams(location.hash.slice(1)).get('rom') : null;
    if (devRom) {
      void fetch(`/@fs/${devRom}`)
        .then(async (r) => handle(new File([await r.arrayBuffer()], 'dev.gba')))
        .catch((e) => showError(`dev ROM: ${String(e)}`));
    }
    dropzone.addEventListener('dragover', (e) => e.preventDefault());
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) void handle(file);
    });
  });

  await emu.importRom(bytes);
}

// ---- patching -------------------------------------------------------------------------

interface PatchResult {
  bytes: Uint8Array;
  usingPatched: boolean;
  /** gBrMailbox's bus address, from br-symbols.json -- absent when unpatched, since
   *  there is no BR-aware ROM running to have a mailbox at all. */
  mailboxBase?: number;
  protocol?: number;
  /** The sha1 of the ROM running in this tab, for the relay's version gate (POK-244):
   *  both sides of a link battle must run the same build. It was br-version.json's
   *  `patch`, a hand-bumped number that had never moved, and which the relay dropped for
   *  not being a string, so any two builds shared a room (POK-330 #3). */
  patch?: string;
  /** The full symbol table alongside mailboxBase -- gBrHud/gBrMySeat's addresses
   *  (director.ts's HUD wiring, POK-222/224/228) come from here rather than a
   *  second hard-coded constant (per CLAUDE.md: never hard-code an EWRAM address). */
  symbols?: Map<string, number>;
}

/** The build this repo just made, as `tools/br/dev-patch.sh` leaves it in public/.
 *  Null when it is not there -- a checkout that has never built a ROM, or a shell
 *  served from anywhere but the dev server. Dev only; nothing ships this file. */
async function fetchLocalBuild(): Promise<Uint8Array | null> {
  try {
    const res = await fetch('/patch/pokeemerald.gba', { cache: 'no-store' });

    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return isPrePatched(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

async function runPatchingScreen(emu: Emulator): Promise<PatchResult> {
  showScreen('patching');
  const statusEl = $('#patch-status') as HTMLElement;
  const bannerEl = $('#patch-banner') as HTMLElement;

  statusEl.textContent = 'Checking for a release…';
  const stored = emu.readRom();
  if (import.meta.env.DEV && isPrePatched(stored)) {
    const side = await loadSidecars();
    if (!side) throw new Error('pre-patched ROM but no /patch/br-symbols.json: run tools/br/dev-patch.sh');
    // ...but WHICH local build? A ROM in IndexedDB is a ROM the shell keeps using, and
    // this branch never asked. A whole night of fixes landed, every driver went green,
    // and the tab was still playing the morning's ROM -- every report from it about
    // things that were already fixed (2026-09-17). The sidecar knows the sha1 of the
    // build it was written for, so ask.
    let bytes = stored;
    let running = await sha1Hex(stored);
    if (side.info.romSha1 && running !== side.info.romSha1) {
      statusEl.textContent = 'Your stored ROM is an older build -- fetching this one…';
      const fresh = await fetchLocalBuild();
      if (fresh) {
        bytes = fresh;
        running = await sha1Hex(fresh);
        await emu.importRom(fresh); // so the next reload starts here rather than fetching again
      } else {
        bannerEl.textContent =
          'The ROM stored in this browser is NOT the build in this repo, and'
          + ' patch/pokeemerald.gba is not being served -- run tools/br/dev-patch.sh.'
          + ' Nothing built since that ROM is in this tab. Forget stored ROM and import'
          + ' pokeemerald.gba from the repo root.';
        bannerEl.hidden = false;
      }
    }
    setVersionLine(`${versionText(side.info)} · local build · ${buildLine(side.info, running)}`);
    return {
      bytes,
      usingPatched: true,
      mailboxBase: side.symbols.get('gBrMailbox'),
      protocol: side.info.protocol,
      patch: running,
      symbols: side.symbols,
    };
  }
  // Fetched by the sha1 br-version.json names, applied, and checked against it: a copy
  // that builds anything else is fetched once more past every cache (POK-330 #23).
  let release: CheckedRelease;
  try {
    release = await loadCheckedRelease((patch) => {
      statusEl.textContent = 'Applying the patch…';
      return applyPatchInWorker(emu.readRom(), patch);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Patch failed: ${message}`;
    throw err;
  }

  if (release.status === 'unpublished') {
    setVersionLine('unpatched');
    statusEl.textContent = 'No patch published yet -- starting the unpatched ROM.';
    // A stock ROM on the dev server boots into vanilla Emerald -- NEW GAME, the real
    // intro, no battle royale -- and the only clue was one word in the corner. Say
    // what to do about it instead.
    bannerEl.textContent = import.meta.env.DEV
      ? 'This is a stock ROM and the dev server has no BPS to apply, so nothing here is'
        + ' battle royale. Forget stored ROM, then import the build this repo just made:'
        + ' pokeemerald.gba in the repo root.'
      : `Running the unpatched ROM (${release.reason}). Battle royale features are not active.`;
    bannerEl.hidden = false;
    return { bytes: emu.readRom(), usingPatched: false };
  }

  // The same line the local-build path gets: which ROM is in the tab, in seven
  // characters. This is the path a stock ROM takes, and it is just as able to be
  // running something other than the build everyone is talking about.
  const running = await sha1Hex(release.rom);
  setVersionLine(`${versionText(release.info)} · ${buildLine(release.info, running)}`);
  roomsRefused = release.stale;
  return {
    bytes: release.rom,
    usingPatched: true,
    mailboxBase: release.symbols.get('gBrMailbox'),
    protocol: release.info.protocol,
    patch: running,
    symbols: release.symbols,
  };
}

// ---- input: keyboard ------------------------------------------------------------------

const KEYBOARD_MAP: Record<string, GbaKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  z: 'a',
  x: 'b',
  Enter: 'start',
  Shift: 'select',
  a: 'l',
  s: 'r',
};

function wireKeyboard(emu: Emulator): () => void {
  // A drawn screen (POK-320) has the presses; the game under it hears nothing -- except
  // the releases, which always go through (POK-330 #56, Emulator.bindKeyboard).
  return emu.bindKeyboard(KEYBOARD_MAP, (key, repeat) => {
    if (!stage?.active) return false;
    if (!repeat) stage.key(key);
    return true;
  });
}

// ---- input: gamepad -------------------------------------------------------------------

/** Standard-mapping indices (w3c.github.io/gamepad/#remapping), laid out the way mGBA
 *  itself defaults: the bottom face button is A, the right one is B. Face left and
 *  face top mirror them, so a pad held any way round still plays. */
const GAMEPAD_DEFAULT: Record<number, GbaKey> = {
  0: 'a',
  1: 'b',
  2: 'b',
  3: 'a',
  4: 'l',
  5: 'r',
  6: 'l',
  7: 'r',
  8: 'select',
  9: 'start',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
};
const REMAP_KEY = 'hbr.padmap';
/** The order the wizard asks for them in. Directions are not here: they come off the
 *  D-pad, the hat and the stick, and all three are standard enough to leave alone. */
const REMAP_ORDER: GbaKey[] = ['a', 'b', 'start', 'select', 'l', 'r'];

/** Every pad lays its face buttons out differently and the standard mapping is a
 *  promise, not a fact -- so whatever we guess, somebody's B is our A. This is that
 *  somebody's way out, and it is remembered per device. */
function loadPadMap(): Record<number, GbaKey> {
  try {
    const raw = localStorage.getItem(REMAP_KEY);
    if (!raw) return { ...GAMEPAD_DEFAULT };
    const saved = JSON.parse(raw) as Record<string, GbaKey>;
    const out: Record<number, GbaKey> = {};
    for (const [index, key] of Object.entries(saved)) {
      if (KEY_BIT[key] !== undefined) out[Number(index)] = key;
    }
    return Object.keys(out).length > 0 ? out : { ...GAMEPAD_DEFAULT };
  } catch {
    return { ...GAMEPAD_DEFAULT }; // private window, cleared storage: the default still plays
  }
}

let gamepadMap = loadPadMap();
/** Set while the remap wizard is waiting for a button; the poll feeds it instead of
 *  the emulator, so binding START does not also open the start menu. */
let padCapture: ((index: number) => void) | null = null;
/** Set while the wizard is waiting for the stick to be pushed a given way (POK-321);
 *  any button press skips the step, for a pad with no stick. */
let axisCapture: ((sense: AxisSense | null) => void) | null = null;
/** The stick, once the wizard has been shown it; null means the parity guess. */
let stickMap: StickMap | null = loadStickMap();

/** The line under the buttons, when no pad has taken it over. */
const KEY_LEGEND =
  'Arrows move · Z = A · X = B · A = L · S = R · Enter = START · Shift = SELECT · a gamepad works too';

/** Eight hat positions, evenly spaced over -1..1, starting at up and going clockwise. */
const HAT: GbaKey[][] = [
  ['up'],
  ['up', 'right'],
  ['right'],
  ['down', 'right'],
  ['down'],
  ['down', 'left'],
  ['left'],
  ['up', 'left'],
];

/** A D-pad that arrives as one "hat" axis instead of four buttons -- which is what a
 *  pad in DirectInput mode does, and the reason a controller could press A but not
 *  walk. Idle sits outside the range (1.29 on the usual layout), which is the only
 *  thing separating it from up. */
function hatKeys(axis: number): GbaKey[] {
  if (axis < -1.1 || axis > 1.1) return [];
  return HAT[Math.round((axis + 1) * 3.5) % 8];
}

/** A controller, polled. The Gamepad API has no events for buttons -- a pad is only
 *  ever a snapshot you ask for -- so this reads one every 16ms and sends the
 *  difference, which is what turns a held button into one press and one release.
 *  A timer and not requestAnimationFrame: rAF stops whenever the page is not being
 *  painted, and a pad that only works while the compositor feels like it is worse
 *  than no pad at all. */
function wireGamepad(emu: Emulator): () => void {
  if (typeof navigator.getGamepads !== 'function') return () => {};
  let held = new Set<GbaKey>();
  const wasPressed = new Set<number>();
  // What each pad's axes read when nobody is touching it. A stick rests at 0, but an
  // axis a pad is not using rests wherever it likes -- 1, or -1 -- and read as a stick
  // that is a direction held down forever, which is a player who cannot move and
  // cannot see why. Directions are a move AWAY from rest, not a position.
  const rest = new Map<number, readonly number[]>();
  /** Which axes are away from rest this poll, for the readout. */
  const moved: string[] = [];
  const poll = () => {
    const now = new Set<GbaKey>();
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      if (!rest.has(pad.index)) rest.set(pad.index, [...pad.axes]);
      const base = rest.get(pad.index) ?? [];
      if (padCapture) {
        const pressed = pad.buttons.findIndex((button) => button.pressed);
        if (pressed >= 0 && !wasPressed.has(pressed)) {
          const take = padCapture;
          wasPressed.add(pressed);
          take(pressed);
        }
        if (pressed < 0) wasPressed.clear(); // let go before the next one counts
        continue;
      }
      if (axisCapture) {
        const take = axisCapture;
        const pressed = pad.buttons.findIndex((button) => button.pressed);
        if (pressed >= 0 && !wasPressed.has(pressed)) {
          wasPressed.add(pressed);
          take(null); // no stick to teach: skip
        } else {
          if (pressed < 0) wasPressed.clear();
          const sense = learnAxis(pad.axes, base);
          if (sense) take(sense);
        }
        continue;
      }
      pad.buttons.forEach((button, i) => {
        const key = gamepadMap[i];
        if (key && button.pressed) now.add(key);
      });
      // EVERY axis, not just the first pair (Cam's play-test: "analog stick on my
      // controller doesn't work" on a pad whose D-pad did). A standard pad puts the
      // left stick on axes 0 and 1; a non-standard one puts its sticks wherever its
      // driver felt like, and reading only the first two means a pad whose stick is on
      // 2 and 3 has no stick at all. Even axes are horizontal, odd are vertical --
      // the one convention every layout keeps -- and axis 9 is skipped because that is
      // the DirectInput hat, decoded below.
      // ...unless the wizard has been shown the stick (POK-321, Cam's pad, whose
      // vertical is an even axis): then only its two learned axes count.
      moved.length = 0;
      if (stickMap) {
        for (const key of stickKeys(pad.axes, base, stickMap)) now.add(key);
      } else {
        const guess = guessedStickKeys(pad.axes, base);
        for (const key of guess.keys) now.add(key);
        moved.push(...guess.moved);
      }
      // The tenth axis is where a DirectInput pad puts its D-pad. Only there, and
      // only on a pad that has one: a resting stick reads 0, which decodes to "down".
      if (pad.axes.length >= 10) for (const key of hatKeys(pad.axes[9])) now.add(key);
    }
    const ui = stage?.active === true;
    for (const key of now) {
      if (held.has(key)) continue;
      if (ui) stage!.key(key);
      else emu.press(key);
    }
    for (const key of held) if (!now.has(key)) emu.release(key);
    held = now;
    // What the pad is doing, on screen. A pad the page cannot see, a pad it has mapped
    // wrong and a pad with a stuck axis all look identical from the sofa; this is the
    // difference, and it is the line that would have found the stuck axis in seconds.
    if (padLine !== null) {
      const keys = [...held].join(' ');
      // The axes that have moved, by number, so a pad that does nothing can be told
      // apart from a pad whose stick is somewhere this code is not looking -- which is
      // the difference this line existed to show and could not.
      const axes = moved.length > 0 ? ` [axes ${moved.join(' ')}]` : '';
      padLine.textContent = `${padName}${keys ? ` -- ${keys}` : ''}${axes}`;
    }
  };
  let padLine: HTMLElement | null = null;
  let padName = '';
  const note = (e: GamepadEvent) => {
    padName = `Gamepad: ${e.gamepad.id} (${e.gamepad.mapping || 'non-standard'})`;
    padLine = document.querySelector('.keys');
    rest.delete(e.gamepad.index); // a pad that just arrived gets its rest read again
  };
  const gone = (e: GamepadEvent) => {
    rest.delete(e.gamepad.index);
    if (padLine) padLine.textContent = KEY_LEGEND;
    padLine = null;
  };
  const id = setInterval(poll, 16);
  addEventListener('gamepadconnected', note);
  addEventListener('gamepaddisconnected', gone);
  return () => {
    clearInterval(id);
    removeEventListener('gamepadconnected', note);
    removeEventListener('gamepaddisconnected', gone);
  };
}

/** The remap wizard: one prompt per key, bind by pressing the button you want. Six
 *  presses and a pad whose face buttons are the wrong way round is the right way
 *  round, for good -- it is stored per device. */
function wireRemap(): void {
  const button = $('#remap') as HTMLButtonElement;
  const line = $('#remap-line') as HTMLElement;
  let cancel: (() => void) | null = null;

  const stop = (note: string) => {
    padCapture = null;
    axisCapture = null;
    cancel = null;
    line.textContent = note;
    button.textContent = 'Remap pad';
  };

  const run = () => {
    const taken: Record<number, GbaKey> = {};
    let i = 0;
    // After the buttons, the stick: pushed UP, then RIGHT, each learned from whichever
    // axis moves (any button skips, for a pad without one).
    let up: AxisSense | null = null;
    const askStick = (which: 'up' | 'right') => {
      line.textContent = `Push the stick ${which.toUpperCase()} (any button to skip, Esc to cancel)`;
      axisCapture = (sense) => {
        axisCapture = null;
        if (which === 'up') {
          up = sense;
          if (!sense) { finish(null); return; }
          askStick('right');
          return;
        }
        finish(sense && up && sense.axis !== up.axis ? { up, right: sense } : null);
      };
    };
    const finish = (stick: StickMap | null) => {
      gamepadMap = taken;
      stickMap = stick;
      try {
        localStorage.setItem(REMAP_KEY, JSON.stringify(taken));
        if (stick) localStorage.setItem(STICK_KEY, JSON.stringify(stick));
        else localStorage.removeItem(STICK_KEY);
      } catch {
        // Private window or storage off: the mapping still holds for this session.
      }
      stop(stick ? 'Pad remapped, stick learned.' : 'Pad remapped.');
    };
    const ask = () => {
      if (i >= REMAP_ORDER.length) {
        askStick('up');
        return;
      }
      line.textContent = `Press the button for ${REMAP_ORDER[i].toUpperCase()} (Esc to cancel)`;
      padCapture = (index) => {
        taken[index] = REMAP_ORDER[i];
        i++;
        ask();
      };
    };
    button.textContent = 'Cancel';
    cancel = () => stop('Remap cancelled.');
    ask();
  };

  button.addEventListener('click', () => (cancel ? cancel() : run()));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cancel) cancel();
  });
  const reset = $('#remap-reset') as HTMLButtonElement;
  reset.addEventListener('click', () => {
    gamepadMap = { ...GAMEPAD_DEFAULT };
    stickMap = null;
    try {
      localStorage.removeItem(REMAP_KEY);
      localStorage.removeItem(STICK_KEY);
    } catch {
      // nothing stored, nothing to clear
    }
    stop('Pad mapping reset.');
  });
}

// ---- input: touch pad -------------------------------------------------------------------

function wireButton(el: Element, key: GbaKey, emu: Emulator): void {
  const down = (e: Event) => {
    e.preventDefault();
    el.classList.add('down');
    emu.press(key);
    buzz();
  };
  const up = (e: Event) => {
    e.preventDefault();
    el.classList.remove('down');
    emu.release(key);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}

/** An 8-way D-pad on a single square surface: the touch position's angle from
 * center picks 1 or 2 (diagonal) keys, with a dead zone near the center so a light
 * touch doesn't register a direction. */
/** A short tap of haptic feedback on a button going down (POK-245). Phones without it,
 *  and every desktop, get nothing and no error -- and a page the user has not touched
 *  yet is not allowed to buzz at all, which the try/catch covers. */
function buzz(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // A browser that refuses (no gesture yet, or the API disabled): not worth a word.
  }
}

function wireDpad(el: HTMLElement, emu: Emulator): void {
  const DEAD_ZONE = 0.35; // fraction of the half-width/height
  let active = new Set<GbaKey>();

  const directionsFor = (dx: number, dy: number): Set<GbaKey> => {
    const next = new Set<GbaKey>();
    if (Math.hypot(dx, dy) < DEAD_ZONE) return next;
    const octant = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 45) * 45;
    switch (octant) {
      case -180:
      case 180:
        next.add('left');
        break;
      case -135:
        next.add('up');
        next.add('left');
        break;
      case -90:
        next.add('up');
        break;
      case -45:
        next.add('up');
        next.add('right');
        break;
      case 0:
        next.add('right');
        break;
      case 45:
        next.add('down');
        next.add('right');
        break;
      case 90:
        next.add('down');
        break;
      case 135:
        next.add('down');
        next.add('left');
        break;
    }
    return next;
  };

  const update = (clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const dx = (clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const next = directionsFor(dx, dy);
    for (const key of active) if (!next.has(key)) emu.release(key);
    for (const key of next) {
      if (active.has(key)) continue;
      emu.press(key);
      buzz(6); // a step is a lighter tap than a button press
    }
    active = next;
    el.classList.toggle('active', next.size > 0);
  };

  const clear = () => {
    for (const key of active) emu.release(key);
    active = new Set();
    el.classList.remove('active');
  };

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    update(e.clientX, e.clientY);
  });
  el.addEventListener('pointerup', (e) => {
    e.preventDefault();
    clear();
  });
  el.addEventListener('pointercancel', clear);
  el.addEventListener('lostpointercapture', clear);
}

// ---- settings: volume + forget ROM -------------------------------------------------------

function wireSettings(emu: Emulator): void {
  const muteBtn = $('#mute') as HTMLButtonElement;
  const forgetBtn = $('#forget-rom') as HTMLButtonElement;

  const applyMute = (muted: boolean) => {
    emu.setVolume(muted ? 0 : UNMUTED_VOLUME);
    muteBtn.textContent = muted ? 'Unmute' : 'Mute';
    muteBtn.setAttribute('aria-pressed', String(muted));
  };
  applyMute(localStorage.getItem(MUTE_STORAGE_KEY) === '1');

  muteBtn.addEventListener('click', () => {
    const muted = muteBtn.getAttribute('aria-pressed') !== 'true';
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    applyMute(muted);
  });

  forgetBtn.addEventListener('click', async () => {
    // Unlinked and flushed BEFORE the core is stopped: forgetRom's own FSSync is the
    // thing that writes the deletion through to IndexedDB, and a stopped core is a
    // poor time to ask it to. The play-test pressed this and came back into the same
    // match, which is what a deletion that never reached disk looks like.
    await emu.forgetRom();
    emu.stop();
    location.reload();
  });
}

// ---- fps readout, dev only ---------------------------------------------------------------

function wireFps(emu: Emulator): void {
  if (!import.meta.env.DEV) return;
  const el = $('#fps') as HTMLElement;
  el.hidden = false;
  let frames = 0;
  let last = performance.now();
  emu.onFrame(() => frames++);
  setInterval(() => {
    const now = performance.now();
    const fps = (frames * 1000) / (now - last);
    frames = 0;
    last = now;
    el.textContent = `${fps.toFixed(0)} fps`;
  }, 1000);
}

// ---- boot: start in Littleroot under the career name (br_boot.h) ------------------------

/** Wait for the ROM to wake its mailbox.
 *
 *  `staleAfter` is for a reboot, and it is the whole reason this takes an argument. The
 *  magic is the last thing BrMailbox_Init writes, so on a cold boot its presence really
 *  does mean the ROM is up -- but a reboot does not necessarily clear EWRAM, and the
 *  magic the previous run left there is still at the same address the instant the core
 *  restarts. Resolving on that puts the boot block in before BrInit has run, and
 *  BrMailbox_Init's CpuFill32 then wipes it: nothing boots, the ROM sits on the title
 *  screen with live input, and the first A press walks the player into NEW GAME and the
 *  moving van. Pass the frame counter read just before the reboot; a count that has not
 *  gone backwards is not a fresh ROM.
 *
 *  Both the resolve and the timeout count emulated frames, so never call this paused. */
function waitForMailbox(emu: Emulator, mailboxBase: number, staleAfter?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const off = emu.onFrame(() => {
      const awake = emu.read(mailboxBase + MAILBOX.OFF_MAGIC, 16) === MAILBOX.MAGIC;
      const fresh = staleAfter === undefined || emu.read(mailboxBase + MAILBOX.OFF_FRAME, 32) < staleAfter;
      if (awake && fresh) {
        off();
        resolve();
      } else if (++frames > 600) {
        off();
        reject(new Error('the ROM never woke its mailbox: is this a Hoenn BR build?'));
      }
    });
  });
}

/** Take the ROM back to the start of a match, the way main() comes in -- which is the
 *  one way in PLAY AGAIN never had. Zeroing the magic before the reset is inert if
 *  mGBA's loadGame clears WRAM and decisive if it does not, so it costs nothing either
 *  way; the pause has to come AFTER the wait, because waitForMailbox counts emulated
 *  frames both to resolve and to time out. */
async function rebootIntoBr(emu: Emulator, mailboxBase: number, bootMode: number): Promise<void> {
  const before = emu.read(mailboxBase + MAILBOX.OFF_FRAME, 32);
  emu.write(mailboxBase + MAILBOX.OFF_MAGIC, 0, 16);
  await emu.reboot();
  await waitForMailbox(emu, mailboxBase, before);
  emu.pause();
  writeBootBlock(emu, mailboxBase, careerName(), bootMode, careerSkin());
  emu.resume();
}

/** The boot mode for a way in. Hoisted out of main() because PLAY AGAIN needs the same
 *  answer and hardcoded BR_BOOT_MAP instead, which quietly dropped the testmon flag --
 *  and with it the e2e harness's party -- on every replay. */
function bootModeFor(mode: string): number {
  const wantsTestMon = import.meta.env.DEV && new URLSearchParams(location.hash.slice(1)).has('testmon');
  return (mode === 'solo' ? BR_BOOT_SAFARI : BR_BOOT_MAP) | (wantsTestMon ? BR_BOOT_FLAG_TESTMON : 0);
}

function careerName(): string {
  // The old key, from before the profile lived beside the record (POK-243). Read as a
  // fallback so nobody loses the name they already had.
  const career = loadCareer();
  return career.name || cleanName(localStorage.getItem(NAME_STORAGE_KEY) ?? '') || DEFAULT_NAME;
}

/** The last team each seat was seen carrying, from any `party` that crossed this page.
 *  Kept for one thing (POK-243): the champion's own ROM sends its party as the parade
 *  starts, and the results screen is the shell's half of that parade. A `party` is
 *  otherwise an answer to a spectator's peek and belongs to whoever asked. */
const lastParty = new Map<number, PackedMon[]>();

/** What each seat did in the match, for the card under the parade (POK-303). One for
 *  the page rather than one per path: solo and a room never run at the same time, and
 *  `start` clears it either way. */
const record = new MatchRecord();

/** The hidden instance that fights bot-vs-bot duels for real (POK-238). Module state
 *  rather than an argument because it is made at boot, long before there is a room, and
 *  only the host will ever ask it anything -- it boots its emulator lazily, on the first
 *  duel, so a page that never runs bots never pays for it. Null on an unpatched ROM,
 *  which has no BrDuel to talk to. */
let proxyDuels: ProxyDuels | null = null;
/** Where the proxy's fight goes as it happens (POK-300). The instance is made before
 *  there is a room to tell; the room path sets this when it has one. */
let proxyStream: ((msg: BstartMsg | TurnMsg) => void) | null = null;

/** Which of the four trainer sprites is your ghost on everybody else's screen. */
function careerSkin(): number {
  return loadCareer().skin ?? 0;
}

/** The sprite the lobby's row is SHOWING, which is not always the one you are wearing
 *  (POK-282). Cam: "in Kanto you're able to preview all the different skins even if you
 *  don't have all the wins yet" -- a wardrobe you cannot look at is not a ladder, because
 *  there is nothing to climb towards. Browsing walks every entry; only an unlocked one is
 *  saved, so wandering into the locked half and leaving still leaves you dressed. */
let browsedSkin: number | null = null;

/** MY VOICE: the three lines this seat speaks with when its own duels get announced
 *  (POK-243, split into three by POK-283). Each is an index into `LINES`; an unpicked
 *  one falls back to the head of the pool rather than to a deal, because a profile is
 *  chosen ahead of any match and has no seed to deal from. */
function careerVoiceLines(): BotVoice {
  const career = loadCareer();
  return {
    intro: lineAt(career.intro ?? 0),
    win: lineAt(career.win ?? 0),
    lose: lineAt(career.lose ?? 0),
  };
}

/** Writes gBrMailbox.boot so a fresh game skips the intro/Birch/naming screens and
 *  is already standing in Littleroot -- every driver's own trick (project CLAUDE.md),
 *  used here so a match (or solo play) starts the same way. The ROM clears `mode`
 *  once it has consumed the block. */
function writeBootBlock(
  emu: Emulator,
  mailboxBase: number,
  name: string,
  mode: number = BR_BOOT_MAP,
  skin = 0,
): void {
  const boot = mailboxBase + MAILBOX.OFF_BOOT;
  emu.write(boot + BOOT_AT.mode, mode, 8);
  // The four sprites are BRENDAN, MAY, RIVAL BRENDAN, RIVAL MAY -- the odd ones are
  // the girls, and the player's own avatar should be what they picked for their ghost.
  emu.write(boot + BOOT_AT.gender, skin % 2 === 1 ? FEMALE : MALE, 8);
  emu.write(boot + BOOT_AT.mapGroup, LITTLEROOT.group, 8);
  emu.write(boot + BOOT_AT.mapNum, LITTLEROOT.num, 8);
  emu.write(boot + BOOT_AT.x, LITTLEROOT.x, 16);
  emu.write(boot + BOOT_AT.y, LITTLEROOT.y, 16);
  const nameField = emu.bytes(boot + BOOT_AT.name, MAILBOX.BOOT_BYTES - BOOT_AT.name);
  nameField.fill(0xff); // EOS (include/constants/characters.h) pads whatever the name doesn't fill
  nameField.set(encodeGen3(name, 7));
}

// ---- room: relay + bridge, opted into by the URL hash ------------------------------------

/** Which room the URL names (hash.ts), or null for the lobby. */
function parseRoomHash(): RoomHash | null {
  return parseHash(location.hash);
}

/** Keeps the URL honest about which room you are in, so a reload rejoins it and the
 *  link is shareable -- without adding a history entry per press. */
function setRoomHash(key: RoomMode, value?: string): void {
  history.replaceState(null, '', `#${withRoom(location.hash, key, value)}`);
}

/** Set while this client is the one who may show somebody the door (POK-241).
 *
 *  Module state rather than an argument, because the roster is redrawn from two places
 *  -- the room screen, which knows, and the spectate loop, which does not -- and the
 *  loop's redraw every tick would otherwise quietly take the host's KICK away again. */
let roomKick: RelayClient | null = null;

/** What the room views last showed, so the spectate loop's call every 500 ms redraws
 *  only on a change: a list rebuilt under a finger mid-tap loses the tap (POK-330 #33). */
let roomDrawn: { bridge: Bridge; list: string; stage: string } | null = null;

/** Whose card the drawn room has open, for its key (ui/roomkeys.ts). Set by wireRoom. */
let roomCardSeat: () => number | null = () => null;

/** The room, as everybody in it sees it. */
function renderRoom(bridge: Bridge): void {
  const list = $('#match-roster') as HTMLElement;
  const card = $('#match-card') as HTMLElement;
  const entries = bridge.roster.all();
  // A card left open on somebody who has gone is a card about nobody.
  if (card.dataset.seat && !entries.some((e) => String(e.seat) === card.dataset.seat)) {
    card.hidden = true;
    card.dataset.seat = '';
  }
  // Each view keyed on what it shows. Walking is in neither: in a match every seat walks,
  // and a list keyed on the map is rebuilt on most ticks.
  const nameOf = (seat: number) => bridge.roster.nameOf(seat);
  const listKey = drawerKey(entries, nameOf);
  const stageAt = stageKey(entries, nameOf, roomCardSeat());
  const last = roomDrawn?.bridge === bridge ? roomDrawn : null;
  roomDrawn = { bridge, list: listKey, stage: stageAt };
  // The drawn room shows the same people (POK-320).
  if (last?.stage !== stageAt) stage?.redraw();
  if (last?.list === listKey) return;
  list.innerHTML = '';
  for (const entry of entries) {
    const li = document.createElement('li');
    // A name is a button now (POK-268): Kanto's drawn lobby opens a trainer's card on
    // A, and this is the same idea in the shape this front end has.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'roster-name';
    button.textContent = drawerLabel(entry, nameOf(entry.seat));
    button.addEventListener('click', () => {
      if (card.dataset.seat === String(entry.seat) && !card.hidden) {
        card.hidden = true;
        card.dataset.seat = '';
        return;
      }
      // The list outlives the entries it was drawn from: the card is of them as they are now.
      const now = bridge.roster.get(entry.seat) ?? entry;
      const relay = roomKick;
      const mapId = now.map ? mapIdOf(now.map) : undefined;
      card.innerHTML = '';
      for (const line of cardFor(now, mapId)) {
        const row = document.createElement('div');
        row.className = 'card-line';
        row.textContent = line.label ? `${line.label}: ${line.value}` : line.value;
        card.appendChild(row);
      }
      // The host's one power over another seat, and it lives on the card rather than
      // as a row of buttons beside every name (POK-241).
      if (relay && !now.isMe) {
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'card-kick';
        kick.textContent = 'KICK';
        kick.addEventListener('click', () => {
          relay.kick(entry.seat);
          card.hidden = true;
          card.dataset.seat = '';
        });
        card.appendChild(kick);
      }
      card.dataset.seat = String(entry.seat);
      card.hidden = false;
    });
    li.appendChild(button);
    list.appendChild(li);
  }
}

/** world.json's id for a wire MapRef, for the places a card names. */
function mapIdOf(map: MapRef): string | undefined {
  return (worldData as { maps: { id: string; group: number; num: number }[] }).maps.find(
    (m) => m.group === map.group && m.num === map.num,
  )?.id;
}

// ---- the room screen (POK-241) ------------------------------------------------------

/** What the host has set, between roster events. The relay owns MAX, OPEN and the
 *  passcode; FILL is ours alone, since bots never touch the relay. */
interface RoomControls {
  fill: boolean;
  roster: RosterEvent | null;
  /** MATCH OPTIONS. The pace rides START and every ROM in the room applies it; the fog
   *  length is the director's, and six phases of it is most of a match. */
  textSpeed: 1 | 3 | 5;
  animations: boolean;
  fogSecs: number;
  /** How long the opening runs. Zero means there is none: a dealt drop, straight away. */
  safariSecs: number;
}

/** The room screen's START and its started flag (POK-320). The drawn room reads the
 *  controls itself; this is how the rest of the page tells it what START does and
 *  that the match is on. Set by wireRoom. */
let roomPanelHook: ((onStart: () => void, started: boolean) => void) | null = null;

/** Redraws the room: `onStart` is the host pressing START -- the thing that used to be
 *  a ten-second timer -- and `started` takes the controls away once it has. */
function renderRoomPanel(
  _controls: RoomControls,
  _mySeat: number,
  _relay: RelayClient,
  onStart: () => void,
  started: boolean,
): void {
  roomPanelHook?.(onStart, started);
}

// ---- bots (POK-236) -----------------------------------------------------------------

/** How many the host fills a room to when nothing says otherwise. The room screen's
 *  own FILL control (POK-241) overrides it; Kanto's rooms are never empty, which is the
 *  whole point. */
const BOT_FILL = 8;
/** `#nobots` fills the room with nobody. A dev-only affordance like `#testmon`: an e2e
 *  that is about two people needs the room to hold still, and eight bots walking into
 *  them is eight chances for the thing under test to be something else. */
/** `#quick` runs the match at a pace a test can sit through: a 25-second opening
 *  instead of two minutes, and ring phases of 15 seconds instead of a minute each --
 *  six of those is where a match's length actually lives. Dev only, like `#testmon`
 *  and `#nobots`. Still long enough to do something during the opening, which is the
 *  only part of a match where everybody is in the same place. */
/** `#fast` is the dev pace: a 25-second opening and 15-second fog phases, so a whole
 *  match can be looked at in three minutes. It used to be `#quick` -- which is ALSO
 *  what QUICK PLAY puts in the hash, so every quick-play game in dev ran at the dev
 *  pace: Cam's play-test had eight fog phases inside two minutes while the room's own
 *  control said FOG 120s, and there was no time to catch anything. Two meanings, one
 *  word, and the one that lost was the game. */
function paceOptions(): { safariSecs?: number; fogSecs?: number } | undefined {
  if (!import.meta.env.DEV || !new URLSearchParams(location.hash.slice(1)).has('fast')) return undefined;
  return { safariSecs: 25, fogSecs: 15 };
}

function botFill(): number {
  return import.meta.env.DEV && new URLSearchParams(location.hash.slice(1)).has('nobots') ? 0 : BOT_FILL;
}
/** The bots' own pump. Faster than one step, so the pace comes out of `Bots.tick`
 *  rather than out of whatever interval the browser felt like giving us. */
const BOT_TICK_MS = 100;

/** Fills the room with bots the host walks around. They reach every other client as
 *  ordinary `place`/`step` -- a ghost, which is all a bot ever is on the wire -- so
 *  nothing downstream of here has to know they are not people. */
/** Who is in a battle or a menu right now, off the ROMs' own `busy` (POK-230). The
 *  eyeline needs it: a bot does not challenge somebody already fighting. */
const busySeats = new Set<number>();

function noteBusy(msg: Msg): void {
  if (msg.t === 'busy') {
    if (msg.kind === 'battle') busySeats.add(msg.seat);
    else busySeats.delete(msg.seat);
  } else if (msg.t === 'out') {
    busySeats.delete(msg.seat);
  }
}

/** Picking up somebody else's bots (POK-252). The deal is a pure function of the
 *  match seed and the seats that were taken, so the promoted host can re-run it and
 *  get the same bots -- same seats, same names, same skins -- without anybody having
 *  sent it a thing. What the seed cannot say is where they have walked to since, so
 *  the roster supplies that: every bot's `place` has been passing this client all
 *  match. */
interface BotResume {
  /** Every bot seat the match was dealt, the dead ones included -- the deal has to be
   *  re-run whole or the survivors come back under the wrong names. */
  botSeats: number[];
  /** The seats taken when it was dealt, so the allocator lands on the same seats. */
  humanSeats: number[];
  /** Seats that are not coming back: eliminated, or gone from the room. */
  out: Set<number>;
  /** Where the room last saw it -- a roster row, so the wire's space. */
  where: (seat: number) => ({ map: MapRef } & RomCell) | undefined;
}

function startBots(
  send: (msg: Msg) => void,
  takenSeats: number[],
  seed: number,
  loot: Loot,
  players: () => RosterEntry[],
  sendTo: (seat: number, msg: Msg) => void,
  onDuel: (winner: number, loser: number) => void,
  onEngage: (seat: number, target: number) => void,
  fill: number,
  resume?: BotResume,
  /** Seconds of Safari opening. Above zero the bots start in the Zone with everybody
   *  else (POK-257) and only go out into Hoenn when the fog does. */
  safariSecs = 0,
  /** This match's Zone pool, read out of the ROM (match/zone.ts). Asked for at every deal
   *  rather than once: the first deal can come before the ROM has dealt the pool. */
  zonePool: () => number[] = () => [],
): {
  bots: Bots;
  seats: number[];
  /** The buzzer: the bots leave the Zone for the cells the seed dealt them. */
  drop: () => void;
  setRing: (ring: { sx: number; sy: number; r: number }, phase: number) => void;
  /** A bot's team, for answering a peek about it. Null for a seat we do not own. */
  partyFor: (seat: number) => Msg | null;
  dispose: () => void;
} {
  const maps = (worldData as { maps: WorldMap[] }).maps;
  const world = new World(maps);
  const refById = new Map(maps.map((m) => [m.id, { group: m.group, num: m.num }]));
  const outdoor = new Set(maps.filter((m) => m.outdoor).map((m) => m.id));
  // The same pool the drop deals from: known-walkable, outdoor, already in the bundle.
  const targets = LANDING
    .filter((c) => outdoor.has(c.map) && refById.has(c.map))
    .map((c) => ({ mapId: c.map, x: c.x, y: c.y }));
  // The opening is two minutes long and the bots used to spend all of it out in Hoenn,
  // so a room of one human and fifteen bots was a single-player Safari trip with a
  // countdown. They start in the Zone now, on the cells the ROM deals its own players
  // from, and the drop is what sends everybody out (POK-257).
  // All six areas of the Zone, not just the south one (POK-261): they are joined by
  // seams, so bots walk between them the same way a trainer does.
  const safariTargets = SAFARI_CELLS.filter((c) => refById.has(c.map)).map((c) => ({
    mapId: c.map,
    x: c.x,
    y: c.y,
  }));
  const opening = safariSecs > 0 && safariTargets.length > 0 && resume === undefined;
  const safariSpawns = safariTargets.map((t) => ({ ...t, map: refById.get(t.mapId)! }));
  let inOpening = opening;
  const sectionOf = new Map(maps.map((m) => [m.id, m.section]));
  const idByRef = new Map(maps.map((m) => [`${m.group}:${m.num}`, m.id]));
  const idOf = (map: MapRef) => idByRef.get(`${map.group}:${map.num}`);
  let ring: { sx: number; sy: number; r: number } | undefined;
  const bots = new Bots({
    world,
    targets: opening ? safariTargets : targets,
    mapRef: (id) => refById.get(id),
    send,
    rng: mulberry32(seed ^ 0x51ce),
    sendTo,
    // No ring yet means no fog anywhere, not fog everywhere. Before this, a bot was
    // counted as outside a ring that did not exist and bled through the whole opening:
    // eight bots went into the Zone and two came out of it (POK-257).
    inside: (id) => ring === undefined || sectionInside(WORLD.sections[sectionOf.get(id) ?? ''], ring),
    // The table holds what the wire said, which is the ROM's space; the brain asks
    // about the grid it walks (bots/space.ts).
    loot: lootView(loot, (mapId) => refById.get(mapId), idOf),
    // The eyeline (POK-238). A bot fights a player the same way a player fights one:
    // whoever sees the other starts it. The team goes over as a `trainer` card first,
    // because the ROM has to build a party before the challenge lands.
    engage: {
      // ...and back out of it on the way in. A player's cell on the roster came from
      // their own ROM, so it is seven tiles out from the grid the brain walks -- and an
      // eyeline measured between the two spaces is an eyeline measured wrong.
      players: () =>
        players()
          .filter((e) => e.alive && !seatsDealt.has(e.seat) && e.map && e.x !== undefined && e.y !== undefined)
          .map((e) => ({
            seat: e.seat,
            mapId: idByRef.get(`${e.map!.group}:${e.map!.num}`) ?? '',
            x: e.x! - MAP_OFFSET,
            y: e.y! - MAP_OFFSET,
            dir: e.dir as 1 | 2 | 3 | 4,
            busy: busySeats.has(e.seat),
          }))
          .filter((p) => p.mapId !== ''),
    },
    // Two bots meeting is fought for real in the hidden instance when there is one
    // (POK-238); `duel.ts`'s seeded resolver is what answers when there is not.
    settle: proxyDuels
      ? (a, b) => (proxyDuels as ProxyDuels).fight(a, b)
      : undefined,
    // Where the bot is standing is where its mons came from (POK-237): the drop put
    // it on a route, and that route's own table is what a trainer there would have.
    deal: (bot, atPhase, mapId) => dealParty(seed, bot.seat, atPhase, mapId, bot.grade, zonePool()),
    // And the bag it spends from (POK-237): the potions it drinks between fights, the
    // X ATTACKs its opponent's ROM pops on its behalf, and what a player finds on it.
    bagFor: (bot, atPhase) => dealBag(seed, bot.seat, atPhase, bot.grade),
    seed,
    onDuel,
    // Nobody fights in the Zone -- not a player, not another bot.
    fights: () => !inOpening,
    onEngage,
    centres: () => world.centres(),
    // Bots are on this roster too -- the host applies its own bots' `place` to it --
    // so this is the whole field, which is what the hunt rule wants.
    alive: () => players().filter((e) => e.alive).length,
  });
  const spawns = targets.map((t) => ({ mapId: t.mapId, map: refById.get(t.mapId)!, x: t.x, y: t.y }));
  // Re-deal the whole field so the names line up, drop whoever is out of the match,
  // and stand the rest where the room last saw them rather than back on their drop.
  const resumed = (r: BotResume): Bot[] =>
    dealBots(seed, r.botSeats.length, r.humanSeats, spawns)
      .filter((b) => !r.out.has(b.seat))
      .map((b) => resumeAt(b, r.where(b.seat), idOf));
  const dealt = resume
    ? resumed(resume)
    : dealBots(seed, fill, takenSeats, opening ? safariSpawns : spawns);
  // Where they will be when the fog comes. The deal draws the same seats, names and
  // skins whichever pool it is handed -- only the cell differs -- so this is the same
  // sixteen bots, standing where the drop would have put them.
  const landing = new Map(dealBots(seed, fill, takenSeats, spawns).map((b) => [b.seat, b]));
  const seatsDealt = new Set(dealt.map((b) => b.seat));
  let phase = 0;
  bots.start(dealt, performance.now());
  // The fog clears Hoenn's own trainers off a map it has taken (POK-299): the host runs
  // the per-map clock, and each trainer leaves every ROM as `npcout`, the way a beaten
  // one does. The seat on it is only a seat; `fog` says nobody beat them.
  const npcFog = new NpcFog(TRAINERS as Record<string, number[]>, (id) => WORLD.sections[sectionOf.get(id) ?? '']);
  const fogSeat = takenSeats[0] ?? 0;
  const id = setInterval(() => {
    const now = performance.now();

    bots.tick(now);
    if (inOpening) return;
    const died = npcFog.tick(now, ring);
    let cleared = 0;
    for (const mapId of died) {
      const map = refById.get(mapId);

      if (!map) continue;
      for (const localId of TRAINERS[mapId as keyof typeof TRAINERS] ?? []) {
        send({ t: 'npcout', seat: fogSeat, map, localId, fog: true });
        cleared++;
      }
    }
    if (cleared > 0) {
      const line = Ticker.cleared(fogSeat, cleared, died.length);

      if (line) send(line);
    }
  }, BOT_TICK_MS);
  return {
    bots,
    seats: dealt.map((b) => b.seat),
    drop: () => {
      if (!inOpening) return;
      inOpening = false;
      bots.setTargets(targets);
      for (const bot of dealt) {
        const to = landing.get(bot.seat);

        if (to) bots.placeAt(bot.seat, { map: to.mapId, x: to.x, y: to.y });
      }
    },
    // The host hands its own `ring` straight over: the bots read the fog off the same
    // message every ROM in the room does.
    setRing: (next: { sx: number; sy: number; r: number }, nextPhase: number) => {
      ring = next;
      phase = nextPhase;
      bots.ringMoved(nextPhase);
    },
    // Pull, not push: a bot's team only goes on the wire when somebody asks to see
    // it, the same way a player's does (POK-227's peek) -- and what it answers with
    // is the team the bot is actually carrying, fights it has had and all.
    partyFor: (seat: number) => {
      const mons = bots.partyOf(seat);
      if (!seatsDealt.has(seat) || mons.length === 0) return null;
      // ...and what it is carrying (POK-297): a bot's bag lives here and nowhere else.
      const items = bots.bagOf(seat).slice(0, PARTY_BAG_MAX).map((s) => ({ id: s.id, n: Math.min(99, s.n) }));
      return { t: 'party', seat, mons, bag: { money: bots.moneyOf(seat), items: items.filter((s) => s.n > 0) } };
    },
    dispose: () => clearInterval(id),
  };
}

// ---- results (POK-228) --------------------------------------------------------------

/** Where we came, how long we lasted, and what that does to the career record. Shown
 *  once, when the match ends: `recordMatch` folds the placement in and the line under
 *  it is the record it produced. PLAY AGAIN reloads the page on the same hash, which
 *  re-imports the ROM from IndexedDB and rejoins the same room -- the blunt way, and
 *  the one that cannot leave half a match's state behind. */
function renderResults(seat: number, roster: Roster, results: Results, seats: number, seed?: number): void {
  const panel = $('#results-panel') as HTMLElement;
  openDrawer(true);
  const mine = results.forSeat(seat, performance.now());
  if (!mine.ended) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const parts: string[] = [];
  if (mine.placement !== undefined) parts.push(`${ordinal(mine.placement)} of ${seats}`);
  if (mine.survived !== undefined) {
    const mm = Math.floor(mine.survived / 60);
    const ss = String(mine.survived % 60).padStart(2, '0');
    parts.push(`survived ${mm}:${ss}`);
  }
  if (mine.winner !== undefined) {
    parts.push(mine.winner === seat ? 'you won' : `${roster.nameOf(mine.winner)} won`);
  } else {
    parts.push('a draw');
  }
  // The seed last, because it is the question anybody asks about a round afterwards
  // and the round is written down under it (POK-248, match/log.ts).
  if (seed !== undefined) parts.push(`seed ${seed}`);
  ($('#results-line') as HTMLElement).textContent = parts.join(' · ');
  renderFame(roster, mine.winner, seat);
  renderRecord(seat);
}

/** The champion's team under the result (POK-243, Kanto's Hall of Fame parade). The
 *  ROM's own parade runs on the winner's screen; everybody else gets this, which is
 *  the only place the room ever sees what actually took the match. Silent when the
 *  champion's `party` never arrived -- a bot's never does, since a bot has no ROM to
 *  send one. */
function renderFame(roster: Roster, winner: number | undefined, seat: number): void {
  const el = $('#results-fame') as HTMLElement;
  const party = winner === undefined ? undefined : lastParty.get(winner);

  if (winner === undefined || !party || party.length === 0) {
    el.hidden = true;
    return;
  }
  const who = winner === seat ? 'YOUR TEAM' : `${roster.nameOf(winner)}'S TEAM`;
  const team = party
    .filter((mon) => mon.species > 0)
    .map((mon) => `${mon.nickname || speciesName(mon.species)} L${mon.level}`)
    .join(' · ');
  el.innerHTML = '';
  const label = document.createElement('b');
  label.textContent = `${who}: `;
  el.append(label, document.createTextNode(team));
  el.hidden = false;
}

/** What you did in there, under the parade (POK-303). Cam asked for "how many rings you
 *  survived, how many trainers you beat"; `record.ts` counts those off the wire and this
 *  is where they land. Always drawn -- RINGS is an answer even at zero, and a match you
 *  were eliminated from thirty seconds into is exactly when you want to see the number. */
function renderRecord(seat: number): void {
  const el = $('#results-record') as HTMLElement;
  el.innerHTML = '';
  for (const line of recordLines(record.forSeat(seat))) {
    const row = document.createElement('span');
    const label = document.createElement('b');
    label.textContent = line.label;
    row.append(label, document.createTextNode(` ${line.value}`));
    el.append(row);
  }
  el.hidden = false;
}

// ---- spectating (POK-233) -----------------------------------------------------------

/** How long a finished solo match stays on screen before the lobby comes back. Longer
 *  than the room's four seconds: there is no PLAY AGAIN to press here, so this is the
 *  only time the player has to read it. */
const SOLO_END_GRACE_MS = 8_000;

/** A bag we just took hands its contents over (POK-280).
 *
 *  Kanto's rule is that a fallen trainer's BAG is items AND money, taken whole in one
 *  press. Ours gave the cash and left the items lying there, because the ROM never kept
 *  them: `ParseSpill` skips the item rows on purpose, the loot table has room for eight
 *  pieces on a map and none for what is inside one, and EWRAM has eighty bytes left to
 *  argue with. Bots did not lose out -- `bag.ts` folds a bag on the ground into their own
 *  -- so a player was the only one getting a worse deal than Kanto's.
 *
 *  The page has held the contents for the whole match anyway (match/loot.ts), so it gives
 *  them over: the ROM says the whole piece is leaving the ground, this answers with what
 *  was in it. **Call before loot.note**, which is what deletes the piece.
 *
 *  A `pickup` that names an item is a bot taking one stack out of a bag that stays where
 *  it is (POK-237), not the bag itself; and `bagItems` is undefined for a ball, so a mon
 *  never reaches this. */
function giveBag(loot: Loot, msg: Msg, push: (m: Msg) => void): void {
  if (msg.t !== 'pickup' || msg.item !== undefined) return;
  const items = loot.bagItems(msg.key);
  if (items && items.length > 0) push({ t: 'give', items });
}

/** `gBrMatch.phase` once the winner's Hall of Fame has finished and the ROM is back on
 *  the map (include/br/br_match.h). The one byte the page reads out of the match struct:
 *  everything else it needs comes through the mailbox. */
const BR_PHASE_DONE = 5;

/** The champion's own exit waits for their parade instead of a timer, and this is how
 *  long it waits before going anyway. Kanto's END_DEADLINE_SECONDS, the same idea. */
const SOLO_WIN_GRACE_MAX_MS = 60_000;
const SOLO_PARADE_POLL_MS = 500;

const SPECTATE_TICK_MS = 500; // the peek timer is 3s; this only has to not miss it by much

/** The strip of who an eliminated player can watch. Alive only, ourselves never, and
 *  nothing at all while we are still in the match -- watching is what being out is
 *  for. Clicking a seat hands our own ROM a `follow`; clicking the one we are on, or
 *  STOP, gives the camera back. */
function renderSpectate(bridge: Bridge, spectate: Spectate): void {
  const strip = $('#spectate-strip') as HTMLElement;
  const me = bridge.roster.get(bridge.seat);
  const out = me !== undefined && !me.alive;
  strip.hidden = !out;
  if (!out) {
    if (spectate.watchingSeat() !== null) for (const m of spectate.follow(null)) bridge.pushToRom(m);
    strip.innerHTML = '';
    return;
  }
  strip.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'WATCH';
  strip.appendChild(label);
  const watching = spectate.watchingSeat();
  for (const entry of bridge.roster.all()) {
    if (!entry.alive || entry.seat === bridge.seat) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = bridge.roster.nameOf(entry.seat);
    button.setAttribute('aria-pressed', String(watching === entry.seat));
    button.addEventListener('click', () => {
      const next = spectate.watchingSeat() === entry.seat ? null : entry.seat;
      for (const m of spectate.follow(next)) bridge.pushToRom(m);
      renderSpectate(bridge, spectate);
    });
    strip.appendChild(button);
  }
  if (watching !== null) {
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.textContent = 'STOP';
    stop.addEventListener('click', () => {
      for (const m of spectate.follow(null)) bridge.pushToRom(m);
      renderSpectate(bridge, spectate);
    });
    strip.appendChild(stop);
  }
}

/** The battle id our ROM is replaying, from gBrSpectate (include/br/br_spectate.h:
 *  `watching` at +5, `watchId` at +6), null when it is not replaying anything, and
 *  undefined without the symbol to read it by. */
function romWatching(emu: Emulator, base: number | undefined): number | null | undefined {
  if (base === undefined) return undefined;
  return emu.read(base + 5, 8) !== 0 ? emu.read(base + 6, 16) : null;
}

/** The spectator's own pump: re-ask the trainer we watch what they carry (the ask is
 *  also what tells them they are being watched), and mirror how many are watching US
 *  into the corner eye. Returns a disposer. */
function startSpectateLoop(
  emu: Emulator,
  hudBase: number | undefined,
  bridge: Bridge,
  spectate: Spectate,
  spectateBase?: number,
): () => void {
  const id = setInterval(() => {
    const now = performance.now();
    const ask = spectate.duePeek(bridge.seat, now, romReplaying(bridge.rom, () => romWatching(emu, spectateBase)));
    if (ask) bridge.relay.all(ask);
    // Bots join by walking, not by joining: their seats appear in the roster from a
    // `place`, and there is no relay event to redraw the list on.
    // This loop has no `isHost` of its own, and the roster it would ask lives in the
    // room screen's closure -- so it draws the list without the host's KICK on it. The
    // roster handler redraws with it the moment anything about the room changes, which
    // is what a host is looking at when they go to use it.
    renderRoom(bridge);
    if (hudBase !== undefined) writeHudEyes(emu, hudBase, spectate.eyes(now));
  }, SPECTATE_TICK_MS);
  return () => clearInterval(id);
}

// ---- the match director's page-side wiring (POK-222/223/224/228) ------------------------

const AUTO_START_MS = 10_000; // "for now": a room starts 10s after hosting, or once 2+ seats
/** `#noauto` holds the room open instead. Dev only, like `#testmon`, `#nobots` and
 *  `#quick`: an e2e about one piece of a match needs the rest of it to stand still,
 *  and a director that starts under the test warps everybody out from under it. */
/** `#seed=N` runs the match off a fixed seed instead of a fresh one. Dev only: it is
 *  what makes a whole match reproducible -- the drop, the ring's centre, every bot's
 *  team and every duel come off it, so the same seed is the same match. */
function fixedSeed(): number | null {
  if (!import.meta.env.DEV) return null;
  const raw = new URLSearchParams(location.hash.slice(1)).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function autoStarts(): boolean {
  return !import.meta.env.DEV || !new URLSearchParams(location.hash.slice(1)).has('noauto');
}
/** Which rooms start on their own (POK-320, Cam: "if I click an option that isn't quick
 *  play, the game should not start automatically"). Quick play and the daily are
 *  games that are going; a hosted room waits for its host's START. */
function startsItself(mode: string): boolean {
  return mode === 'quick' || mode === 'daily';
}
const DIRECTOR_TICK_MS = 1000; // coarser than the 5s clock/fogSecs cadence director.ts needs

/** The same strip, for a client that is not running the match (POK-268). The host's is
 *  drawn by the director's own loop, so until now RING / N LEFT / the clock appeared on
 *  exactly one page in the room and everybody else had to read their ROM's corner.
 *
 *  Everything here arrived in messages every client hears -- which is the same reason a
 *  promoted host can pick a match up mid-flight (POK-252). */
/** Returns what it drew, or null when there is no match to draw -- the caller puts the
 *  same two numbers into the ROM's own HUD corner. */
function renderGuestStrip(
  bridge: Bridge,
  match: Pick<MatchSnapshot, 'ringPhase' | 'ringR' | 'centre' | 'clockLeft' | 'clockAt' | 'active'>,
  now: number,
): { alive: number; clockLeft: number } | null {
  const strip = $('#match-strip') as HTMLElement;
  // A watcher arrives mid-match and never hears the START, so the seed is not the test
  // for "is there a match": what it has is the late burst the host sent it, a ring and
  // a clock (POK-260) -- which `active` counts. And PLAY AGAIN puts it back to false:
  // reading "a match was once heard" as "a match is on" is what took the room screen
  // and its START away a second after every return (POK-330 #22).
  if (!match.active) {
    strip.hidden = true;
    return null;
  }
  ($('#room-panel') as HTMLElement).hidden = false;
  strip.hidden = false;
  setInMatch(true);
  // The CLOCK lands every five seconds; the seconds in between are counted off here,
  // the same way the ROM counts them off against its own frame timer.
  const left = clockLeftAt(match, now);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const alive = bridge.roster.all().filter((e) => e.alive).length;
  const phaseLabel =
    match.ringPhase <= 0 ? 'SAFARI' : `RING ${match.ringR} (${match.centre?.place ?? '?'})`;
  // A watcher's roster fills up as people move, so "0 left" is only ever "nobody has
  // moved yet" -- say nothing rather than something wrong.
  const standing = alive > 0 ? ` · ${alive} left` : '';
  strip.textContent = `${phaseLabel}${standing} · ${mm}:${ss}`;
  return { alive, clockLeft: left };
}

function renderMatchStrip(state: DirectorState): void {
  const panel = $('#room-panel') as HTMLElement;
  const strip = $('#match-strip') as HTMLElement;
  panel.hidden = false;
  strip.hidden = false;
  setInMatch(true);
  const mm = Math.floor(state.clockLeft / 60);
  const ss = String(state.clockLeft % 60).padStart(2, '0');
  const phaseLabel =
    state.phase === 'safari'
      ? 'SAFARI'
      : state.phase === 'ring'
        ? `RING ${state.ring?.r ?? '?'} (${state.ring?.place ?? '?'})`
        : state.phase === 'ended'
          ? state.winner !== undefined
            ? `P${state.winner} WINS`
            : 'DRAW'
          : 'WAITING';
  strip.textContent = `${phaseLabel} · ${state.alive} left · ${mm}:${ss}`;
}

/** Starts the director's own 1Hz pump: `tick()` (fires the due clock/ring messages),
 *  then mirrors its `state` into `gBrHud`'s two page-writes fields and the HTML
 *  strip. Returns a disposer. */
function startDirectorLoop(emu: Emulator, hudBase: number | undefined, director: Director): () => void {
  const pump = () => {
    director.tick();
    const state = director.state;
    if (hudBase !== undefined) {
      writeHudLeft(emu, hudBase, state.alive);
      writeHudClockSecs(emu, hudBase, state.clockLeft);
    }
    renderMatchStrip(state);
  };
  pump();
  const id = setInterval(pump, DIRECTOR_TICK_MS);
  return () => clearInterval(id);
}

// ---- solo: no relay at all, this page is the whole match -------------------------------

/** Solo play (no `#host`/`#join`): there is no room, so there is no Bridge either --
 *  just a RomPort into this ROM's own mailbox (net/romport.ts) and a
 *  Director for the one seat this client owns. `onOut` wires nothing in: a one-seat
 *  match's own out (a real whiteout) never decides a winner (director.ts's own
 *  header comment), so nobody needs to hear about it here. */
function runSolo(emu: Emulator, mailboxBase: number, symbols: Map<string, number> | undefined): void {
  // The relay cannot see this: no socket opens for solo play, ever (that is the whole
  // point of the mode). The count rides along on whatever real connection comes next
  // (POK-243, match/stats.ts) -- a local bump now, nothing that touches the network.
  recordSolo();
  const rom = new RomPort(new Mailbox(emu, mailboxBase));
  const seatBase = symbols?.get('gBrMySeat');
  if (seatBase !== undefined) writeMySeat(emu, seatBase, 0);

  let out: ((seat: number) => void) | null = null;
  const log = new MatchLog();
  // SOLO VS BOTS, with the bots (POK-275). The row has promised them since the lobby
  // was built and `startBots` was only ever called from the room path, so solo was one
  // seat in an empty Hoenn -- and a director whose field starts at one can never
  // declare a winner, which is why the match would not end either.
  //
  // Everything the bots need is page-side: no relay, no Bridge, no other ROM. Their
  // messages go straight into our own ROM's in-ring, which is what the room's host
  // does for itself anyway (nobody hears their own messages).
  const roster = new Roster();
  const loot = new Loot();
  const seed = Math.floor(Math.random() * 0x7fff_ffff) + 1;
  roster.setMySeat(0);
  // A solo match ended in complete silence: the director declared a winner, the round
  // was written down, and the player was left standing in Hoenn with nothing on screen
  // to say so. `Results` was only ever built in the room path. Solo has everything it
  // needs -- a seat, a roster and the same messages -- so it gets the same panel, the
  // same career line, and the same grace before the exit.
  const results = new Results();
  const matchBase = symbols?.get('gBrMatch');
  let fieldSize = 0;
  let recorded = false;
  let endGraceTimer: ReturnType<typeof setTimeout> | null = null;
  const noteResult = (msg: Msg): void => {
    if (msg.t === 'start') {
      fieldSize = msg.spawns.length;
      results.start(fieldSize, performance.now());
      record.start();
      recorded = false;
    }
    results.note(msg, performance.now());
    record.note(msg);
    if (msg.t !== 'win' || recorded) return;
    recorded = true;
    ($('#results-career') as HTMLElement).textContent =
      careerLine(recordMatch(results.forSeat(0, performance.now()).placement));
    renderResults(0, roster, results, fieldSize, seed);
    // The parade, the same as a room's (POK-281). Solo is seat 0, so a `win` naming it
    // is ours; naming a bot, it is the seat whose fight a spectating player was watching.
    // A `win` with no seat at all is a draw and there is nobody to crown.
    if (msg.seat !== undefined) rom.push({ t: 'result', seat: msg.seat, outcome: 'win' });
    // Solo has no room to go back to, so the exit is the lobby -- which is what
    // backToLobby does, and there is no socket here for it to scatter.
    if (endGraceTimer !== null) clearTimeout(endGraceTimer);
    if (msg.seat === 0 && matchBase !== undefined) {
      // Won: wait for the Hall of Fame rather than a timer, with a deadline so a ROM that
      // never finishes cannot strand anybody in a match that is over.
      const deadline = setTimeout(() => {
        clearInterval(poll);
        backToLobby();
      }, SOLO_WIN_GRACE_MAX_MS);
      const poll = setInterval(() => {
        if (emu.read(matchBase, 8) !== BR_PHASE_DONE) return;
        clearInterval(poll);
        clearTimeout(deadline);
        backToLobby();
      }, SOLO_PARADE_POLL_MS);
      return;
    }
    endGraceTimer = setTimeout(() => backToLobby(), SOLO_END_GRACE_MS);
  };
  const solo = startBots(
    (msg) => {
      // Into the ROM's coordinate space on the way out (net/cells.ts): the brain walks
      // the exporter's grid, the ROM draws in the one seven tiles further out.
      const wire = toRomCells(msg);

      rom.push(wire);
      roster.applyMsg(wire);
      loot.note(wire);
      log.note(wire, performance.now());
      noteResult(wire);
      if (wire.t === 'out') out?.(wire.seat);
    },
    [0],
    seed,
    loot,
    () => roster.all(),
    // No relay, so a trainer card for our own seat is a direct push and a card for
    // anybody else has nowhere to go.
    (toSeat, msg) => {
      if (toSeat === 0) rom.push(msg);
    },
    () => {},
    () => {},
    botFill(),
    undefined,
    paceOptions()?.safariSecs ?? DEFAULT_SAFARI_SECS,
    () => readZonePool((a, b) => emu.read(a, b), symbols?.get('gBrZone'), seed),
  );
  // The bots on the roster by the names they were dealt, as a room's are (POK-330 #51):
  // nothing else names them, so solo's results and saved round said P31 won.
  roster.seatBots(botRows(seed, solo.seats));
  const director = new Director({
    seats: [0, ...solo.seats],
    // `#quick` is a dev pace, and solo is where a change gets looked at first -- it had
    // no way to ask for it, so every solo look cost the full two-minute opening.
    options: paceOptions(),
    hostSeat: 0,
    seed,
    world: WORLD,
    send: (msg) => {
      rom.push(msg);
      // The bots hear the director the same way a room's do: the ring moving is what
      // sends them out of the Zone and what they aim at afterwards.
      if (msg.t === 'ring') {
        solo.drop();
        solo.setRing({ sx: msg.sx, sy: msg.sy, r: msg.r }, msg.phase);
      }
      // Solo rounds are written down too (POK-248): a match nobody else saw is the
      // one whose seed is hardest to come by afterwards.
      log.note(msg, performance.now(), (seat) => roster.nameOf(seat));
      if (msg.t === 'win') {
        const round = log.current(performance.now());
        if (round) saveMatch(round);
      }
      noteResult(msg);
    },
    now: () => performance.now(),
    onOut: (handler) => {
      out = handler;
      return () => {
        out = null;
      };
    },
  });

  // Solo talks in one direction only -- which is how the drop picker came to send its
  // `pick` into a room with nobody in it and the ROM sat on a black screen waiting for
  // a `land` that could never arrive (POK-255). A room has the Bridge for this; solo
  // has no Bridge, so it needs the one answer the ROM cannot go on without.
  const fromRom = (msg: Msg) => {
    log.note(msg, performance.now());
    noteResult(msg);
    giveBag(loot, msg, (m) => rom.push(m));
    // Our own pickups come off this page's table too. Only the bots' did, so a ball the
    // player had already taken stayed on the solo table for ever and a bot could walk
    // over to "take" it again -- the room path has always done this (app.ts's out
    // observer) and solo never did.
    loot.note(msg);
    roster.applyMsg(msg); // our own ghost, so the bots' eyeline can see us
    // And our fights with the bots, routed exactly as the room routes them (POK-330
    // #17). Solo never did: a bot we beat was never eliminated, a bot we spotted first
    // never sent its card, and with nothing feeding `busy` a second bot could stage its
    // team into the battle we were already in.
    noteBusy(msg);
    routeToBots(solo.bots, msg, 0);
    if (msg.t === 'pick') rom.push({ t: 'land', ...director.landFor(msg.seat, msg.section) });
    else if (msg.t === 'out') out?.(msg.seat);
  };

  // "the first PLACE message it emits, or simply after the mailbox is awake + ~200
  // frames" -- this takes the second, simpler option: solo has no Bridge unpacking
  // PLACE for us to hook, and 200 frames (~3.3s) is well past BR_BOOT_SAFARI's own
  // warp-in.
  let frames = 0;
  const off = emu.onFrame(() => {
    if (++frames < 200) return;
    off();
    director.start();
    startDirectorLoop(emu, symbols?.get('gBrHud'), director);
  });
  // One pump for both directions: the port is the only thing that writes the ring.
  emu.onFrame(() => {
    if (!rom.mailbox.isAwake()) return;
    rom.flush();
    rom.drain(fromRom);
  });
  // LEAVE works in here too (POK-276). The strip is drawn for every mode and the
  // button was only ever wired in `wireRoom`, so the one way out of a solo match was
  // editing the URL.
  const leave = $('#match-leave') as HTMLButtonElement;
  leave.hidden = false;
  leave.addEventListener('click', () => backToLobby());
}

// ---- room: relay + bridge, opted into by the URL hash ------------------------------------

/** The career, out to a file the player keeps (POK-243). A download is the browser's
 *  answer to Kanto's keyfile: something you own, that survives this browser, and that
 *  moves to a phone by being a file. */
function saveCareerFile(): void {
  const blob = new Blob([exportCareer()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = 'hoenn-battle-royale-career.json';
  document.body.append(a);
  a.click();
  a.remove();
  // Let the click start before the URL stops meaning anything.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** ...and back in. A file that is not one of ours changes nothing and says so. */
function loadCareerFile(then: () => void): void {
  const input = document.createElement('input');

  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => {
        if (importCareer(text)) then();
        else alert('That is not a Hoenn Battle Royale career file.');
      })
      .catch(() => alert('That file could not be read.'));
  });
  input.click();
}

/** Drops the room out of the URL and reloads, which lands on the lobby (parseRoomHash
 *  returns null with no room in the hash). The way out of anywhere. */
function backToLobby(): void {
  location.hash = withoutRoom(location.hash);
  location.reload();
}

function wireRoom(
  emu: Emulator,
  mailboxBase: number | undefined,
  protocol: number | undefined,
  symbols: Map<string, number> | undefined,
  hash: RoomHash,
  patch?: string,
): void {
  if (mailboxBase === undefined || hash.mode === 'solo') return; // solo: no socket at all

  const panel = $('#room-panel') as HTMLElement;
  panel.hidden = false;
  /** The drawn room's own state (POK-320): what no roster event carries. */
  const room = {
    status:
      hash.mode === 'host'
        ? 'Hosting…'
        : hash.mode === 'quick'
          ? 'Finding a game…'
          : hash.mode === 'daily'
            ? 'Joining the daily…'
            : `Joining ${hash.code}…`,
    /** The room refused us; BACK TO LOBBY is all there is. */
    fatal: false,
    /** Whose card is open over the seats. */
    card: null as { seat: number } | null,
    /** The match is on: the room screen is down and its controls gone. */
    started: false,
    /** When a room that starts itself will (quick play, the daily). */
    startAt: null as number | null,
    onStart: () => {},
  };
  roomCardSeat = () => room.card?.seat ?? null;
  const stage = theStage();
  // The same status and note in the drawer, where they stay through the match (the room
  // screen comes down when it starts): what the strip sits under, and what a test reads.
  const codeEl = $('#room-code') as HTMLElement;
  const noteEl = $('#room-note') as HTMLElement;
  const setStatus = (text: string) => {
    room.status = text;
    codeEl.textContent = text;
    stage.redraw();
  };
  setStatus(room.status);

  const relay = new RelayClient();
  /** The one writer into our ROM's in-ring (POK-330 #44), shared by every Bridge this
   *  page builds and by the host's director. The host used to have a second queue beside
   *  the Bridge's, and two writers could put one `spill`'s slots between another's. */
  const rom = new RomPort(new Mailbox(emu, mailboxBase));
  let bridge: Bridge | null = null;
  let director: Director | null = null;
  /** The director's own elimination handler, for `out`s this page makes itself. */
  let localOut: ((seat: number) => void) | null = null;
  /** Announces a seat out of the match to the whole room -- set while this client is
   *  the one running a director (POK-271). A seat that closed its tab has to be
   *  eliminated by somebody, and the host is the only client that can: nobody hears
   *  their own messages, so the one who left cannot say it about themselves. */
  let announceOut: ((seat: number) => void) | null = null;
  /** The director's ear on the room while one runs, called from the page's one handler
   *  on the Bridge (attach): what the Bridge let through, and nothing else. */
  let directorHears: ((m: Msg) => void) | null = null;
  let stopDirectorLoop: (() => void) | null = null;
  let isHost = false;
  /** A rejoin is out: a refusal is about the room we were in, not one we asked into. */
  let rejoining = false;
  /** The room is ours again after our own drop (POK-330 #47), and the match with it:
   *  the director the drop stopped starts again on the next roster that says so. */
  let resumeHost = false;
  /** The host's room settings between roster events (POK-241). */
  const controls: RoomControls = {
    fill: true, roster: null, textSpeed: 3, animations: true, fogSecs: 120,
    safariSecs: DEFAULT_SAFARI_SECS,
  };

  // ---- the room, drawn (POK-320) ----
  // Kanto's lobby: the code, a 2x4 of seats with everybody's sprite, what START would
  // make, the host's options, START or LEAVE. It covers the game until the match is
  // on: nobody walks Littleroot while the host is still choosing the fog.
  const hostOptions = (view: RoomView) => {
    const redraw = () => stage.redraw();
    return [
      { id: 'room-max', label: `MAX ${view.max}`, onPress: () => relay.setMax(nextMax(view.max)) },
      {
        id: 'room-fill',
        label: view.fill > 0 ? `FILL ${view.fill}` : 'FILL OFF',
        onPress: () => {
          controls.fill = !controls.fill;
          redraw();
        },
      },
      {
        id: 'room-door',
        label: { open: 'LISTED', private: 'UNLISTED', pass: 'PASSCODE' }[doorOf(view)],
        onPress: () => {
          const next = nextDoor(doorOf(view));
          if (next === 'pass') {
            const code = (prompt('Passcode for the door? (4 characters)') ?? '').trim().toUpperCase();
            if (!code) return;
            relay.setPass(code);
            relay.setOpen(true);
          } else {
            relay.setPass(null);
            relay.setOpen(next === 'open');
          }
        },
      },
      {
        id: 'room-text',
        label: `TEXT ${textSpeedLabel(controls.textSpeed)}`,
        onPress: () => {
          controls.textSpeed = nextTextSpeed(controls.textSpeed);
          redraw();
        },
      },
      {
        id: 'room-anim',
        label: controls.animations ? 'ANIM ON' : 'ANIM OFF',
        onPress: () => {
          controls.animations = !controls.animations;
          redraw();
        },
      },
      {
        id: 'room-fog',
        label: `FOG ${controls.fogSecs}s`,
        onPress: () => {
          controls.fogSecs = nextFog(controls.fogSecs);
          redraw();
        },
      },
      // How long the opening lasts, including not at all (POK-241). Zero is Kanto's own
      // escape hatch: no Safari, straight to a dealt drop.
      {
        id: 'room-safari',
        label: safariLabel(controls.safariSecs),
        onPress: () => {
          controls.safariSecs = nextSafari(controls.safariSecs);
          redraw();
        },
      },
    ];
  };
  const roomModel = (): RoomModel => {
    const view = controls.roster && bridge ? roomView(controls.roster, bridge.seat, controls.fill) : null;
    const seats: RoomSeat[] = (controls.roster?.members ?? []).map((m) => {
      const entry = bridge?.roster.get(m.id);
      return {
        seat: m.id,
        name: m.name || entry?.name || 'TRAINER',
        skin: Number(entry?.skin ?? 0) || 0,
        isMe: m.id === bridge?.seat,
        spectating: m.spectate === true,
        alive: entry?.alive ?? true,
      };
    });
    const cardEntry = room.card ? bridge?.roster.get(room.card.seat) : undefined;
    const countdown = room.startAt !== null && !room.started ? Math.max(0, Math.ceil((room.startAt - performance.now()) / 1000)) : null;
    const note = view && !room.started ? startNote(view) : '';
    if (!room.fatal) noteEl.textContent = note;
    return {
      status: room.status,
      note,
      seats,
      max: view?.max ?? BOT_FILL,
      fill: view?.fill ?? 0,
      isHost: view?.isHost ?? false,
      started: room.started,
      canStart: view ? canStart(view) : false,
      countdown,
      options: view?.isHost ? hostOptions(view) : null,
      card: cardEntry
        ? {
            seat: cardEntry.seat,
            lines: cardFor(cardEntry, cardEntry.map ? mapIdOf(cardEntry.map) : undefined),
            canKick: (view?.isHost ?? false) && !cardEntry.isMe,
          }
        : null,
      fatal: room.fatal,
      onStart: () => room.onStart(),
      onLeave: () => backToLobby(),
      onBack: () => backToLobby(),
      onSeat: (seat) => {
        room.card = room.card?.seat === seat ? null : { seat };
        stage.redraw();
      },
      onKick: (seat) => {
        relay.kick(seat);
        room.card = null;
        stage.redraw();
      },
      onCloseCard: () => {
        room.card = null;
        stage.redraw();
      },
    };
  };
  const roomScreenView = roomScreen(roomModel);
  const showRoomScreen = () => {
    room.started = false;
    room.card = null;
    stage.show(roomScreenView);
  };
  const hideRoomScreen = () => {
    if (room.started) return;
    room.started = true;
    room.startAt = null;
    if (stage.current === roomScreenView) stage.hide();
  };
  hideRoomHook = hideRoomScreen;
  roomPanelHook = (onStart, started) => {
    room.onStart = onStart;
    if (started) hideRoomScreen();
    stage.redraw();
  };
  // A room that starts itself counts down on screen.
  setInterval(() => {
    if (room.startAt !== null && !room.started) stage.redraw();
  }, 1000);
  showRoomScreen();

  /** `members` comes straight off the relay's roster event when there is one, and the
   *  relay's last roster otherwise: who is in the room is the relay's to say. Never
   *  `bridge.roster`, which also holds whoever this page has merely heard from -- last
   *  match's bots, which PLAY AGAIN then seated as people (POK-330 #22). Watchers are in
   *  the room but not in the match (POK-260): seating one deals it a drop it will never
   *  take and counts it among the living, so the match cannot reach a winner. */
  const startDirector = (members?: number[], takeOver = false) => {
    if (director || !bridge || !isHost) return;
    const seats = seatsFor(controls.roster, members);
    if (seats.length === 0) return;
    const hostSeat = bridge.seat;
    // Everybody in the room now was dealt in, or on a takeover has been hearing the match
    // all along: only somebody who arrives, or comes back, needs catching up.
    for (const m of controls.roster?.members ?? []) greeted.add(m.id);
    // The door shuts when the match starts, wherever the start came from (POK-260).
    // It used to be the START button's job alone, so a match dealt by the ten-second
    // buzzer left the room open -- latecomers walked into a running match as players,
    // and quick play offered it as somewhere to join rather than somewhere to watch.
    relay.lockRoom(true);
    // A takeover keeps the match's own seed: the bots are dealt from it, and dealing
    // them again from a new one would rename everybody mid-match.
    const seed = takeOver && match.seed !== 0
      ? match.seed
      : fixedSeed() ?? Math.floor(Math.random() * 0x7fff_ffff) + 1;
    // Bots count down from the top seat and people count up from zero (bots/roster.ts),
    // so the bots are the run at the top of the field the match was dealt with.
    const dealtField = new Set(match.seats);
    const botSeats: number[] = [];
    for (let seat = MAX_SEATS - 1; dealtField.has(seat); seat--) botSeats.push(seat);
    const humanSeats = match.seats.filter((seat) => !dealtField.has(seat) || seat < MAX_SEATS - botSeats.length);
    // Whoever was in the match and is no longer in the room is not coming back --
    // the old host above all. Left alive they would hold the match open forever.
    const gone = takeOver
      ? humanSeats.filter((seat) => !seats.includes(seat) && seat !== hostSeat)
      : [];
    const resume: BotResume | undefined = takeOver && match.seed !== 0
      ? {
          botSeats,
          humanSeats,
          out: new Set([...match.out, ...gone]),
          where: (seat: number) => {
            const row = bridge!.roster.all().find((e) => e.seat === seat);
            return row?.map && row.x !== undefined && row.y !== undefined
              ? { map: row.map, ...romCell(row.x, row.y) }
              : undefined;
          },
        }
      : undefined;
    // The ticker. The ROM has drawn the window since POK-226 and nothing had ever sent
    // it a line, so a match was silent: people vanished, the fog closed, somebody won,
    // and the only way to know was to be watching the right corner. The host narrates,
    // because the host is the one client that knows the whole match.
    const nameOf = (seat: number) => bridge!.roster.nameOf(seat);
    const say = (msg: TickerMsg | null) => {
      if (!msg) return;
      bridge!.relay.all(msg);
      rom.push(msg);
    };
    // The seed's voice for anyone, except this client's own seat, which speaks with
    // whatever its profile picked (POK-243) -- see the onDuel/onEngage callbacks below.
    const myVoice = (seat: number, matchSeed: number): BotVoice => {
      if (seat === bridge!.seat) return careerVoiceLines();
      // What they actually picked, if their challenge told us (POK-274). A bot never
      // sends one, so a bot keeps the lines the seed deals it -- which is what makes a
      // room of bots sound like a room of people in the first place.
      const heard = bridge!.linesFor(seat);
      if (!heard) return voiceFor(matchSeed, seat);
      const dealt = voiceFor(matchSeed, seat);
      return {
        intro: heard.intro ?? dealt.intro,
        win: heard.win ?? dealt.win,
        lose: heard.lose ?? dealt.lose,
      };
    };
    const seen = new Set<number>(); // seats already announced out, so a repeat is quiet
    /** A message this page makes for the room: out to everybody else, into our own ROM,
     *  and through the same bookkeeping every guest runs on it when it arrives. Nobody
     *  hears their own messages back over the relay, so whatever is not done here never
     *  happens on the host at all -- the results, the record and the round's log never
     *  saw its own bots go out, and its placement was counted against a field that, as
     *  far as they knew, never thinned (POK-330 #16). */
    const hostSays = (msg: Msg) => {
      bridge!.relay.all(msg);
      rom.push(msg);
      bridge!.roster.applyMsg(msg);
      loot.note(msg); // a bot taking a ball takes it off this page's table too
      noteResult(msg); // before the director hears an `out`, so its `win` comes after it
    };
    // The host speaks for the bots as well as for the clock: same relay, same in-ring,
    // and its own roster too -- nobody hears their own messages come back, so the host
    // would otherwise be the one client that cannot see the bots it is walking.
    bots = startBots(
      (msg) => {
        // The wire is the ROM's coordinate space (net/cells.ts): every client's ghosts
        // are drawn from it, and a player's own `place` already arrives that way.
        const wire = toRomCells(msg);

        hostSays(wire);
        if (wire.t === 'out') localOut?.(wire.seat);
      },
      seats,
      seed,
      loot,
      () => bridge!.roster.all(),
      // A trainer card is for the one player it is a challenge to. The host's own ROM
      // never hears itself over the relay, so its copy is a direct push.
      (toSeat, msg) => {
        if (toSeat === bridge!.seat) rom.push(msg);
        else bridge!.relay.to(toSeat, msg);
      },
      // The kill feed. A duel is the only moment both sides of a fight are known at
      // once -- an `out` on its own cannot say who did it.
      (winner, loser) => {
        say(Ticker.beat(winner, nameOf(winner), nameOf(loser)));
        // And they say something about it (POK-239). Dealt from the seed, so the same
        // bot has the same voice all match on every client that works it out -- unless
        // the seat that just fought is this client's own, in which case it is whatever
        // voice its profile picked (POK-243): the same pipe a bot gets, handed to the
        // one player who actually gets to choose it. Any *other* real player still
        // falls back to the seed, the same as a bot -- their own pick lives only in
        // their own localStorage, and nothing on the wire carries it here yet.
        say(Ticker.said(winner, nameOf(winner), myVoice(winner, seed).win));
        say(Ticker.said(loser, nameOf(loser), myVoice(loser, seed).lose));
      },
      // Walking up to somebody is the other time a bot has something to say.
      (seat) => say(Ticker.said(seat, nameOf(seat), myVoice(seat, seed).intro)),
      // How many bots the host is filling to (POK-241's FILL), held to what the room
      // has room for.
      // `seats` is MAX as the host set it; `max` is only the humans (POK-330 #29).
      botFill() === 0 ? 0 : Math.max(0, (controls.roster?.seats ?? controls.roster?.max ?? BOT_FILL) - seats.length),
      resume,
      paceOptions()?.safariSecs ?? controls.safariSecs,
      () => readZonePool((a, b) => emu.read(a, b), symbols?.get('gBrZone'), seed),
    );
    // Which seats are bots, said once rather than guessed at by everything downstream:
    // the ones walked here, or on a takeover every one the match was dealt, dead or not.
    match.botSeats = new Set(resume ? resume.botSeats : bots.seats);
    // The bots' seats are spoken for until the match ends: the relay hands a latecomer
    // the lowest id nobody is using, and a bot's seat looks unused to it (POK-330 #6).
    relay.lockRoom(true, bots.seats);
    director = new Director({
      // Bots are contestants, not scenery: leaving them out of the seat list makes
      // "N LEFT" a lie and hands the match to whoever outlasts the humans alone.
      // A takeover inherits the field the match was dealt with, not the room as it
      // stands now: people who have already been eliminated are still in it, and
      // resume() is what takes them back out.
      seats: takeOver && match.seats.length > 0 ? match.seats : [...seats, ...bots.seats],
      options: paceOptions() ?? {
        safariSecs: controls.safariSecs,
        fogSecs: controls.fogSecs,
        pace: { textSpeed: controls.textSpeed, animations: controls.animations },
      },
      hostSeat,
      seed,
      world: WORLD,
      send: (msg) => {
        // Guests' ROMs act on this over the relay; the host's own ROM would too,
        // eventually, but ring/clock/win carry `seat: hostSeat` and bridge.ts's own
        // echo-guard (msgSeat(msg) === this.seat) drops exactly those coming back
        // over the wire -- so the host's own mailbox needs this direct push, not a
        // round trip through the relay it just sent to. `win` is JSON-only
        // (docs/WIRE.md) and has no slots.ts codec, so it never goes to `rom`.
        bridge!.relay.all(msg);
        rom.push(msg); // no-op for `win` -- the port only packs a msg.t crossesToRom() knows
        noteResult(msg); // the host's own `start`/`win` never come back to it over the relay
        if (msg.t === 'ring') {
          // The first ring IS the buzzer: it is what ends the opening in the ROM
          // (br_match.c reads gBrRing.active), so it is when the bots leave too.
          bots?.drop();
          bots?.setRing({ sx: msg.sx, sy: msg.sy, r: msg.r }, msg.phase);
        }
        // The match, narrated. These are the director's own messages on their way out,
        // which is the one place every one of them passes through.
        if (msg.t === 'start') {
          say(Ticker.opening(hostSeat, msg.safari ?? 0));
          say(Ticker.dropped(hostSeat, msg.spawns.length));
        } else if (msg.t === 'ring') {
          say(Ticker.fog(hostSeat, msg.phase, msg.r < 0));
        } else if (msg.t === 'win' && msg.seat !== undefined && msg.seat !== null) {
          say(Ticker.won(msg.seat, nameOf(msg.seat)));
        }
      },
      now: () => performance.now(),
      onOut: (handler) => {
        // A bot the fog took is eliminated by this very page, so its `out` never comes
        // back over the relay -- nobody hears their own messages. Without this the
        // host's own bots are immortal and the match cannot end.
        const narrate = (seat: number) => {
          if (seen.has(seat)) return;
          seen.add(seat);
          const left = Math.max(0, (director?.state.alive ?? 1) - 1);
          say(Ticker.out(seat, nameOf(seat), left));
          if (left === 3) say(Ticker.fewLeft(seat, left));
          handler(seat);
        };
        localOut = narrate;
        // ...and the same door for a seat that simply vanished (POK-271): the relay's
        // roster is the authority on who is still here, and a match cannot end while
        // it is waiting on somebody who closed their tab.
        announceOut = (seat: number) => {
          if (seen.has(seat)) return;
          hostSays({ t: 'out', seat }); // our own ROM and results never hear it over the relay
          narrate(seat);
        };
        // It used to take `recv` off the relay itself and decode each message again,
        // trusting whoever sent it (POK-330 #24); it hears what the Bridge let through.
        directorHears = (m) => {
          if (m.t === 'out') narrate(m.seat);
        };
        return () => {
          localOut = null;
          announceOut = null;
          directorHears = null;
        };
      },
    });
    if (import.meta.env.DEV) {
      // The whole-match e2e needs to see the director's own verdict: a winner is a
      // page-side rule, and there is nothing in RAM that says the match ended.
      const dev = (window as unknown as { __br?: Record<string, unknown> }).__br;
      if (dev) {
        dev.director = director;
        dev.botCount = () => bots?.bots.count() ?? 0;
      }
    }
    if (takeOver) {
      // The old host's tab went away and the relay handed us the room (POK-252).
      // Everybody already has a `start`, a drop and a ring, so dealing again would
      // restart the match under them: pick up what the wire already said instead.
      director.resume({
        ringPhase: match.ringPhase,
        centre: match.centre,
        // counted off since it was heard or kept: a host back from a drop is that much
        // further on, as every guest's ROM is
        secsLeftInPhase: clockLeftAt(match, performance.now()),
        out: [...match.out, ...gone],
        // The old host's list of dealt cells left with it. What `start` dealt, and where
        // everybody stands now (a `land` is unicast, so a trainer who dropped and has not
        // moved is only known by their `place`), back out of the ROM's space.
        dealt: [
          ...match.spawns,
          ...bridge.roster.all().flatMap((e) =>
            e.map && e.x !== undefined && e.y !== undefined ? [{ map: e.map, x: e.x - MAP_OFFSET, y: e.y - MAP_OFFSET }] : [],
          ),
        ],
      });
      // And the room is told about the ones who walked out, so every roster agrees
      // with the count this page is now keeping.
      for (const seat of gone) hostSays({ t: 'out', seat });
      say(Ticker.said(hostSeat, nameOf(hostSeat), 'I HAVE THE CLOCK.'));
    } else {
      director.start();
    }
    const stopLoop = startDirectorLoop(emu, symbols?.get('gBrHud'), director);
    stopDirectorLoop = () => {
      stopLoop();
      bots?.dispose();
      bots = null;
    };
  };

  const spectate = new Spectate();
  // The ROM only holds the loot for the map it is standing on, and forgets it on the
  // way out; the page holds the match's whole table and hands back the piece that
  // matters every time our own trainer arrives somewhere (POK-232).
  // A `let`, because PLAY AGAIN starts the next match on a clean table: last match's
  // unclaimed pieces were pushed back into the rebooted ROM, and bots walked to them.
  let loot = new Loot();
  let lootMap: string | null = null;
  const results = new Results();
  /** Everything a promoted client needs to pick the match up (POK-252), and reset by
   *  returnToRoom for the next one (match/lifecycle.ts). */
  const match: MatchSnapshot = freshMatch();
  /** The match's fog phase, from its `start`: what a `ring` puts on the clock. A watcher
   *  who walked in late never heard one, and has the default the director would use. */
  let matchFog = controls.fogSecs;
  let fieldSize = 0;
  let recorded = false;
  const log = new MatchLog();
  // Everything that decides a placement crosses this page one way or the other: our
  // own ROM's `out` on the way up, everybody else's on the way in, and the host's own
  // `start`/`win` as it sends them.
  const noteResult = (msg: Msg) => {
    // The match, as anybody in the room can see it.
    if (msg.t === 'start') {
      // A new match, whatever the last one left here: its eliminations, its ring, its end.
      Object.assign(match, freshMatch(), {
        seed: msg.seed,
        seats: msg.spawns.map((s) => s.seat),
        spawns: msg.spawns.map((s) => ({ map: s.map, x: s.x, y: s.y })),
        // The host set its own bot seats when it dealt them; a guest reads them off the
        // room. Either way they go on the roster by the names the seed gave them, which
        // every page can work out (POK-330 #51) -- before the log below takes its names.
        botSeats: director ? match.botSeats : new Set(botSeatsOf(msg.spawns.map((s) => s.seat), controls.roster)),
        active: true,
      });
      matchFog = msg.fog ?? controls.fogSecs;
      bridge?.roster.seatBots(botRows(msg.seed, match.botSeats));
      hideRoomScreen();
    } else if (msg.t === 'ring') {
      match.ringPhase = msg.phase;
      match.centre = { sx: msg.sx, sy: msg.sy, place: msg.place };
      match.ringR = msg.r;
      match.clockLeft = ringClockLeft(msg.phase, matchFog); // nothing sends a `clock` in the ring
      match.clockAt = performance.now();
      match.active = true; // a watcher's late start: it never heard the `start`
    } else if (msg.t === 'clock') {
      match.clockLeft = msg.left;
      match.clockAt = performance.now();
      match.active = true;
    } else if (msg.t === 'win') {
      match.ended = true;
    } else if (msg.t === 'out') {
      match.out.add(msg.seat);
    }
    // A bot's fight runs in whoever fought it, and what that ROM reports goes to the
    // brain through routeToBots (bots/adapt.ts) -- below, where the seat that sent it
    // is known.
    if (msg.t === 'party') {
      lastParty.set(msg.seat, msg.mons);
      // The champion's own party arrives after the `win` that put the results on
      // screen -- their ROM sends it as the parade starts (POK-243) -- so the panel
      // is drawn again rather than waiting for a team that came too late.
      if (recorded && bridge) renderResults(bridge.seat, bridge.roster, results, fieldSize, match.seed);
    }
    if (msg.t === 'start') {
      fieldSize = msg.spawns.length;
      results.start(fieldSize, performance.now());
      record.start();
      recorded = false;
    }
    results.note(msg, performance.now());
    record.note(msg);
    // ...and the round is written down as it happens (POK-248). The same messages
    // placement is derived from, kept in a shape the round can be read back from.
    log.note(msg, performance.now(), (seat) => bridge?.roster.nameOf(seat) ?? `P${seat}`);
    // The match is over: the door opens again (POK-258). START locked the room to keep
    // latecomers out of a running match, and leaving it locked is what turned the end
    // of a match into everybody scattering -- a reload could not get back in.
    if (msg.t === 'win' && director) {
      relay.lockRoom(false);
      // And says so: a client that never saw the `win` -- a socket that blinked over the
      // last fight -- still gets taken out of the match. `again` has been defined in the
      // wire since POK-258 and sent by nobody until now. It is the recovery path and not
      // the mechanism: each client's own grace below is what actually moves it, so a
      // room of older clients still ends properly.
      relay.all({ t: 'again', seat: bridge?.seat ?? 0 });
    }
    if (msg.t === 'win' && bridge && !recorded) {
      recorded = true;
      const round = log.current(performance.now());
      if (round) saveMatch(round);
      const mine = results.forSeat(bridge.seat, performance.now());
      ($('#results-career') as HTMLElement).textContent = careerLine(recordMatch(mine.placement));
      renderResults(bridge.seat, bridge.roster, results, fieldSize, match.seed);
      // And the ROM is told who won (POK-243's parade, POK-281). `win` is a page-side
      // verdict with no codec, so it has never crossed to any ROM: the Hall of Fame has
      // been reachable only by a driver poking the RESULT slot by hand, which is exactly
      // why nobody ever saw it. One push serves the whole room -- the winner's own ROM
      // matches the seat and runs the parade, and everybody else's ends a replay of a
      // fight whose fighter has just taken the match (BrSpectate_OnResult).
      // A `win` with no seat is a draw -- nobody to crown, and nothing to end a replay on.
      if (msg.seat !== undefined) bridge.pushToRom({ t: 'result', seat: msg.seat, outcome: 'win' });
      // "If the game is over I should be kicked back to the main menu." Nothing took
      // anybody out of a finished match: the page drew the results panel over a ROM that
      // went on walking Hoenn, and the host did not even have a LEAVE button. Kanto's
      // shape (main.lua, END_GRACE_SECONDS): everybody reads the result for a moment,
      // then one funnel takes them all back -- keeping the room, so the next match is a
      // press of START rather than eight people finding each other again.
      armEndGrace(() => void returnToRoom(), msg.seat === bridge.seat);
    }
  };
  let stopSpectateLoop: (() => void) | null = null;
  let stopGuestStrip: (() => void) | null = null;
  /** How long the result stays on screen before the match lets go of you. Kanto's
   *  END_GRACE_SECONDS, and the same reasoning: long enough to read where you came, short
   *  enough that nobody is left sitting in a game that is over. */
  const END_GRACE_MS = 4_000;
  /** The champion waits for their own parade instead. Kanto's END_DEADLINE_SECONDS is the
   *  same idea -- take the exit once the screen is quiet, and take it regardless after
   *  this long, because a ROM that never finishes must not strand somebody in a match
   *  that is over. */
  const WIN_GRACE_MAX_MS = 60_000;
  const PARADE_POLL_MS = 500;
  let endGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let paradePoll: ReturnType<typeof setInterval> | null = null;
  /** Cancel a grace that is in flight -- because the exit has already been taken, by a
   *  press of PLAY AGAIN. (Not by the host's `again`, which arrives right behind the
   *  `win` and used to cut every guest's grace short: onAgain.) */
  const endGrace = (): void => {
    if (endGraceTimer !== null) clearTimeout(endGraceTimer);
    if (paradePoll !== null) clearInterval(paradePoll);
    endGraceTimer = null;
    paradePoll = null;
  };
  const armEndGrace = (go: () => void, won = false): void => {
    endGrace();
    const matchBase = symbols?.get('gBrMatch');
    if (!won || matchBase === undefined) {
      endGraceTimer = setTimeout(go, END_GRACE_MS);
      return;
    }
    // BR_PHASE_DONE: BrMatch_HallOfFameDone sets it on the way back to the map. Polling
    // one byte beats guessing at a duration -- the parade is as long as the champion's
    // team is, and a four-second timer would reboot the ROM in the middle of it.
    endGraceTimer = setTimeout(go, WIN_GRACE_MAX_MS);
    paradePoll = setInterval(() => {
      if (emu.read(matchBase, 8) !== BR_PHASE_DONE) return;
      endGrace();
      go();
    }, PARADE_POLL_MS);
  };
  /** In the room to look, not to play (POK-260). Set when this client asks to watch,
   *  and reasserted from the relay's own roster, which is the authority on it. */
  let amWatching = false;
  /** Hands a trainer who is out somebody to watch, and keeps the strip honest as the
   *  field thins. Kanto's rule: being out IS spectating -- the strip is how you change
   *  who, not how you start. A watcher (POK-260) is left alone: it chose its own seat
   *  and was never in the match to be eliminated from it. */
  const autoWatch = (): void => {
    if (!bridge || amWatching) return;
    const me = bridge.roster.get(bridge.seat);
    if (me === undefined || me.alive) return;
    const on = spectate.watchingSeat();
    const still = on !== null && bridge.roster.all().some((e) => e.seat === on && e.alive);
    if (!still) {
      const next = bridge.roster.all().find((e) => e.alive && e.seat !== bridge!.seat);
      // Nobody left to watch is the end of the match, and the results panel is what
      // answers that; the strip just stops offering.
      if (next) for (const m of spectate.follow(next.seat)) bridge.pushToRom(m);
      else if (on !== null) for (const m of spectate.follow(null)) bridge.pushToRom(m);
    }
    renderSpectate(bridge, spectate);
  };
  /** Seats this client has already caught up on the running match. A seat that leaves is
   *  taken off it, so coming back is a late arrival like any other (POK-330 #25). */
  const greeted = new Set<number>();
  /** Seats caught up on everything but the loot where they stand, which waits for their
   *  first `place` to say where that is. */
  const owedLoot = new Set<number>();
  let bots: ReturnType<typeof startBots> | null = null;
  /** The room we are attached to, so a second attach can tell a rejoin of it (the relay
   *  handed our seat back) from a new room. */
  let attachedTo: { seat: number; code: string } | null = null;

  const attach = (seat: number, code: string, host: number) => {
    // A rejoin mid-fight keeps the fight: the ROM is still in it, and a fresh Bridge knew
    // no opponent -- its blocks went to the whole room -- and had no copy of the last ones
    // it sent, which the blip may have lost (POK-330 #20, #7).
    const rejoin = attachedTo?.seat === seat && attachedTo.code === code;
    const carry = rejoin ? bridge?.carry() : undefined;
    // A re-join after a reconnect must not leave two pumps on one ring, nor two copies of
    // the page's handler: dispose() lets go of both.
    if (bridge) bridge.dispose();
    attachedTo = { seat, code };
    console.info(`[room] attached as seat ${seat} in ${code}`);
    bridge = new Bridge({ emu, mailboxBase, relay, seat, protocol, carry, rom });
    // Whose room it is, as the relay says: ours when we opened it, whoever it names when
    // we joined. The hash said `host` on a rejoin too, after the relay had already handed
    // the room to an heir when our socket went (POK-330 #13).
    const wasHost = isHost;
    isHost = host === seat;
    rejoining = false;
    // Ours before the drop and ours again: the relay waited for us, or the room had gone
    // and we opened another (POK-330 #47). The match lives in this tab.
    resumeHost = wasHost && isHost && director === null && onPromotion(match) === 'take-over';
    // A rejoin mid-match gets a fresh Bridge and with it a fresh roster: the bots go
    // back on it by name, the same as they went on at the `start` (POK-330 #51), and the
    // fallen go back on it fallen.
    if (match.seed !== 0) bridge.roster.seatBots(botRows(match.seed, match.botSeats));
    for (const out of match.out) bridge.roster.applyMsg({ t: 'out', seat: out });
    if (rejoin) {
      // ...and what we last said to the seat we are fighting, which the blip may have
      // swallowed (#7).
      bridge.resendBlocks();
      // So may our own `out`, and a host that never hears it waits on us for ever
      // (POK-330 #25). A second one is harmless everywhere.
      if (match.out.has(seat) && !match.ended) relay.all({ t: 'out', seat });
    }
    setStatus(`Room ${code}`);
    renderRoom(bridge);
    const seatBase = symbols?.get('gBrMySeat');
    if (seatBase !== undefined) writeMySeat(emu, seatBase, seat);
    // And what our ghost looks like to everybody else, which the ROM stamps on every
    // `place` it sends (POK-243).
    const skinBase = symbols?.get('gBrMySkin');
    if (skinBase !== undefined) writeMySkin(emu, skinBase, careerSkin());
    // Willing to run the match if the host's tab goes away (POK-252). Every client
    // says this the moment it has a ROM and a seat; the relay promotes the
    // longest-standing one that has. Nobody ever said it before, so `heirOf` never
    // found anybody and a host leaving closed the room on everybody in it.
    relay.canHost(true);
    // The gate on relay -> ROM: a bstart starts a replay, and it is a broadcast.
    bridge.setRomFilter((msg) => spectate.wantsFromRelay(msg));
    // Two bots fighting can be watched (POK-300): the proxy instance publishes its duel
    // the way a player's ROM publishes a link battle, and this page is its relay -- to
    // the room, and through the same gate to our own ROM if we are following either bot.
    // The bots' names go in on the way past; the instance has no roster to read them from.
    proxyStream = (raw) => {
      const msg = raw.t === 'bstart'
        ? nameBstart(raw, (s) => bridge!.roster.nameOf(s))
        : raw;

      bridge!.relay.all(msg);
      if (spectate.wantsFromRelay(msg)) bridge!.pushToRom(msg);
    };
    // A watcher is furniture: its ROM is walking around Littleroot and nobody in the
    // match should see a ghost of it, or hear it claim a seat (POK-260).
    // Everybody hears what we picked (POK-274): our three lines ride out on every
    // challenge, which is the one message that reaches the other side before a fight.
    bridge.myLines = careerVoiceLines();
    bridge.setOutFilter(() => !amWatching);
    // A gym leader fell (POK-295): every page in the room says so, off the `npcout` that
    // already takes the sprite off every map. Nothing new crosses the wire.
    const bossFell = (m: Msg) => {
      if (m.t !== 'npcout' || m.fog || !bridge) return; // the fog taking a gym is not a win
      const boss = bossAt(m.map, m.localId);
      if (!boss) return;
      const line = Ticker.felled(m.seat, bridge.roster.nameOf(m.seat), boss);
      if (line) bridge.pushToRom(line);
    };
    bridge.setOutObserver((msg) => {
      spectate.noteOutgoing(msg);
      giveBag(loot, msg, (m) => bridge?.pushToRom(m));
      bossFell(msg); // our own win never comes back over the relay
      loot.note(msg);
      noteResult(msg);
      noteBusy(msg);
      // Our own ROM challenged one of our bots, or fought one and is saying how it went
      // (POK-238): the host walks the bot, and nobody hears their own messages come back.
      if (bots && bridge) routeToBots(bots.bots, msg, bridge.seat);
      // Our own ROM's pick never comes back over the relay either.
      if (msg.t === 'pick' && director) {
        bridge!.pushToRom({ t: 'land', ...director.landFor(msg.seat, msg.section) });
      }
      // Our own ROM saying we are out. Nobody hears their own messages come back over
      // the relay, so without this the director never counts this client's own
      // elimination and the match it is running cannot reach a winner.
      if (msg.t === 'out') {
        localOut?.(msg.seat);
        // And we withdraw from the succession: a trainer who is out should not be the
        // one still running the match everybody else is in (POK-252).
        if (msg.seat === bridge?.seat && !director) relay.canHost(false);
        // Going out is the moment to start watching (play-test: "when I got out in the
        // Safari, it should have brought me to spectating the other players"). Our own
        // `out` never comes back over the relay, so nothing else here ever saw it --
        // on a host walking a room of bots, no relay message arrives at all and the
        // WATCH strip was never even drawn.
        if (msg.seat === bridge?.seat) autoWatch();
      }
      // Our own `place` is how the page learns we changed maps -- there is no separate
      // "I have arrived" message, and this one is already on the wire four times a
      // second.
      if (msg.t === 'place' && msg.map) {
        const key = `${msg.map.group}:${msg.map.num}`;
        if (key !== lootMap) {
          lootMap = key;
          const standing = loot.forMap(msg.map);
          if (standing) bridge!.pushToRom(standing);
        }
      }
    });
    // The room, as the Bridge hands it over: decoded once, from somebody entitled to say
    // it, with who said it (POK-330 #24). Released by bridge.dispose() on the next attach.
    bridge.onMessage((m, from) => {
      // What the trainer we are watching just took (POK-268). Drawn here rather than
      // sent: a `pickup` reaches the whole room, and only the page following that
      // seat has any business saying so. The describe() has to happen before the
      // loot table forgets the piece, which loot.note() does on this same message.
      // The host says the match is over (POK-258's `again`). Belt and braces for the
      // local grace: a socket that blinked over the last fight never saw the `win` and
      // would otherwise sit in a finished match for ever -- so that page, and only that
      // page, starts the grace now. It arrives on the heels of the `win`, and a page
      // that took it as the exit rebooted before anybody had read a result (#9).
      if (m.t === 'again' && onAgain({ running: director !== null, match, graceArmed: endGraceTimer !== null }) === 'grace') {
        armEndGrace(() => void returnToRoom());
      }
      if (m.t === 'pickup' && bridge && spectate.watchingSeat() === m.seat) {
        const what = loot.describe(m.key);
        const line = what ? Ticker.took(m.seat, bridge.roster.nameOf(m.seat), what) : null;
        if (line) bridge.pushToRom(line);
      }
      // The DAY CARE chest (POK-306) is the other pickup worth a line, and this one is
      // for the whole room: everybody who was on their way there should stop.
      if (m.t === 'pickup' && bridge && m.key === Ticker.CHEST_KEY && m.item === undefined) {
        const line = Ticker.chest(m.seat, bridge.roster.nameOf(m.seat));
        if (line) bridge.pushToRom(line);
      }
      bossFell(m);
      loot.note(m);
      noteResult(m);
      noteBusy(m);
      directorHears?.(m);
      // The drop (POK-223): a trainer chose a section, the host deals them a cell
      // inside it that nobody else has. Only the host answers -- everyone hears the
      // `pick`, and two answers would put two trainers on two different tiles.
      if (m.t === 'pick' && director) {
        const land = director.landFor(m.seat, m.section);
        if (m.seat === bridge!.seat) bridge!.pushToRom({ t: 'land', ...land });
        else bridge!.relay.to(m.seat, { t: 'land', ...land });
      }
      // A seat the host has just caught up on the match learns what is lying where it
      // stands, once its first `place` or `step` has said where that is (POK-330 #25).
      if (director) {
        const standing = lootOwed(owedLoot, m, from, (map) => loot.forMap(map));
        if (standing) bridge!.relay.to(from, standing);
      }
      // Somebody else's ROM challenged one of our bots, or fought one. Same as our own
      // ROM's above -- the host is the only page that has the bot's team -- and the
      // relay's `from` is what says whose ROM it was.
      if (bots) routeToBots(bots.bots, m, from);
      if (m.t === 'peek' && m.target === seat) {
        spectate.notePeek(m.seat, performance.now());
        // Their ROM answers the party; the fight so far is ours to hand over, since the
        // relay never delivered our bstart to somebody who was not in the room -- unless
        // their ROM is replaying it already (POK-330 #10).
        for (const part of spectate.streamFor(seat, m.have)) bridge!.relay.to(m.seat, part);
      }
      else if (m.t === 'peek') {
        // A bot has no ROM to answer for it, so the host that walks it does.
        const party = bots?.partyFor(m.target);
        if (party) bridge!.relay.to(m.seat, party);
      }
      else if (m.t === 'result') spectate.noteResult(m.seat);
      else if (m.t === 'out') {
        bots?.bots.remove(m.seat); // a bot that is out stops being walked around
        // The host saying we are out: we went while our socket was down and came back to
        // a match that had buried us (POK-330 #25). Out is watching, as for anybody.
        if (m.seat === seat) {
          relay.canHost(false);
          autoWatch();
        }
        renderSpectate(bridge!, spectate);
      }
    });
    if (import.meta.env.DEV) {
      // The E2E drives a watch without a click: the strip only exists once you are out.
      const dev = (window as unknown as { __br?: Record<string, unknown> }).__br;
      if (dev) {
        dev.spectate = spectate;
        // What a promotion would resume from (POK-252), so the migration e2e can see
        // whether this client was listening to the match it is in.
        dev.match = match;
        // The relay's last roster, so a test can ask who the room thinks is watching
        // (POK-260) rather than inferring it from the screen.
        dev.controls = controls;
        dev.watch = (target: number | null) => {
          for (const m of spectate.follow(target)) bridge!.pushToRom(m);
          renderSpectate(bridge!, spectate);
        };
      }
    }
    stopSpectateLoop?.();
    stopSpectateLoop = startSpectateLoop(emu, symbols?.get('gBrHud'), bridge, spectate, symbols?.get('gBrSpectate'));
    // A second's cadence, like the director's own loop. It stands down the moment this
    // client becomes the one running the match, which draws the real one.
    stopGuestStrip?.();
    const hudBase = symbols?.get('gBrHud');
    const guestStrip = setInterval(() => {
      if (!director && bridge) {
        const shown = renderGuestStrip(bridge, match, performance.now());
        // The same two numbers into the ROM's own corner (net/hud.ts). `gBrHud.left` and
        // `gBrHud.clockSecs` are PAGE WRITES -- the ROM never works them out for itself --
        // and the only thing writing them was startDirectorLoop, which exists only on the
        // host. So every guest in every match played with a dead corner: no count, and a
        // clock frozen at 0:00, for the whole sixteen minutes. The HTML strip above it was
        // right the whole time, which is what made it look like a drawing bug.
        if (shown && hudBase !== undefined) {
          writeHudLeft(emu, hudBase, shown.alive);
          writeHudClockSecs(emu, hudBase, shown.clockLeft);
        }
      }
      // ...and the seat we are watching may itself have gone out since.
      autoWatch();
    }, 1000);
    stopGuestStrip = () => clearInterval(guestStrip);
    renderSpectate(bridge, spectate);
    if (isHost && autoStarts() && startsItself(hash.mode)) {
      room.startAt = performance.now() + AUTO_START_MS;
      stage.redraw();
      setTimeout(() => startDirector(), AUTO_START_MS);
    }
  };

  // PLAY AGAIN goes back to the lobby, not back into this room. Reloading on the same
  // hash rejoined the room the match had just been played in -- which START locked, so
  // a guest got "Couldn't join: locked" and had nowhere to go but the URL bar, and a
  // host silently opened a new room and abandoned everybody in the old one.
  // PLAY AGAIN keeps the room, the code and the roster, and rolls a fresh match
  // (POK-258, Kanto v0.6.0). It used to reload onto the lobby, which scattered the
  // eight people you had just played with; before that it reloaded onto the same hash,
  // which is worse, because START had locked the room and the rejoin was refused.
  //
  // So it reloads nothing. The socket, the bridge and the roster stay up and only the
  // ROM starts over -- which is also the only way the next match is fair, since a ROM
  // that has just finished one is carrying that match's team and an empty ball pocket.
  // The way out of a room (POK-241). A host leaving closes the room for everybody --
  // that is what migration is for -- so this is offered to guests only.
  const matchLeave = $('#match-leave') as HTMLButtonElement;
  matchLeave.addEventListener('click', () => backToLobby());
  const playAgainButton = $('#play-again') as HTMLButtonElement;

  /** Out of the match and back into the room: the ROM starts over, the results panel
   *  comes down, and the room -- socket, roster, code -- is exactly as it was. This is
   *  the one funnel, the way Kanto has one `endMatch`. PLAY AGAIN is a press of it and
   *  so is the grace timer below; nothing else may take the exit, because a reload
   *  (backToLobby) scatters the eight people you have just played with (POK-258). */
  let returning = false;
  /** Forgets the last match (POK-330 #22): what the room heard of it, its loot, who was
   *  busy in it, who had been caught up on it, and its bots on the roster. PLAY AGAIN
   *  used to keep all of that, and each piece went wrong in the next match its own way:
   *  the room screen and START went a second after coming back, the next START seated
   *  the old bots as people, and an heir resumed the match that had just been won. */
  const resetMatch = (): void => {
    Object.assign(match, freshMatch());
    loot = new Loot();
    lootMap = null;
    busySeats.clear();
    greeted.clear();
    owedLoot.clear();
    room.startAt = null;
    if (bridge) {
      bridge.roster.endMatch();
      if (controls.roster) bridge.roster.applyRoster(controls.roster);
    }
  };
  async function returnToRoom(): Promise<void> {
    if (returning) return;
    returning = true;
    playAgainButton.disabled = true;
    try {
      endGrace();
      teardownHost();
      resetMatch();
      if (mailboxBase !== undefined) await rebootIntoBr(emu, mailboxBase, bootModeFor('room'));
      else await emu.reboot();
      recorded = false;
      // Last match's champion is not this match's, and the parade reads by seat
      // (POK-243): a seat that wins twice would otherwise be shown the team it had
      // the first time, and one that never sends a `party` would be shown somebody
      // else's. PLAY AGAIN used to reload the page, which cleared this for free.
      lastParty.clear();
      // Whoever we were watching is not in a match any more.
      for (const m of spectate.follow(null)) bridge?.pushToRom(m);
      ($('#results-panel') as HTMLElement).hidden = true;
      setInMatch(false);
      showRoomScreen();
      if (bridge) {
        renderRoom(bridge);
        renderSpectate(bridge, spectate);
        // The host gets its START back: a new match is dealt from the room, the same
        // way the first one was.
        renderRoomPanel(controls, bridge.seat, relay, () => {
          startDirector(controls.roster?.members.map((m) => m.id)); // locks the room itself
          renderRoomPanel(controls, bridge!.seat, relay, () => {}, true);
        }, false);
      }
    } finally {
      returning = false;
      playAgainButton.disabled = false;
    }
  }
  playAgainButton.addEventListener('click', () => void returnToRoom());

  relay.on('room_hosted', (ev) => attach(ev.id, ev.code, ev.id));
  relay.on('room_joined', (ev) => attach(ev.id, ev.code, ev.host));
  /** Seats the roster has stopped listing, with the timer that will finish them off
   *  (POK-271). A tab that reconnects inside the grace keeps its place: a blip on
   *  somebody's wifi is not a forfeit, and the relay hands a returning client the seat
   *  it had. The wait is a timer rather than the next roster event, because a
   *  departure is usually the LAST roster event -- nothing else is coming to notice
   *  it on.
   *
   *  The grace is the relay's own seat hold (relay.rejoinMs), so there is one window: it
   *  was ten seconds here against the relay's sixty, and a seat that came back in the
   *  fifty between walked into a match that had already eliminated it (POK-330 #25). */
  const leaving = new Map<number, ReturnType<typeof setTimeout>>();

  /** Everything that makes this page the one running the match, undone at once
   *  (POK-330 #13). Standing down, a dropped socket and the way back to the room each
   *  used to null their own share of it and none called director.stop(), so the
   *  Director's `out` subscription outlived it: every later elimination was narrated a
   *  second time, with a stale count, and the orphan could send a second `win`. */
  const teardownHost = (): void => {
    director?.stop(); // lets go of its `out` subscription, and localOut/announceOut with it
    stopDirectorLoop?.();
    stopDirectorLoop = null;
    director = null;
    localOut = null;
    announceOut = null;
    for (const timer of leaving.values()) clearTimeout(timer);
    leaving.clear();
    if (import.meta.env.DEV) {
      const dev = (window as unknown as { __br?: Record<string, unknown> }).__br;
      if (dev) dev.director = undefined;
    }
  };

  relay.on('roster', (ev) => {
    controls.roster = ev;
    // Who is gone. Only the host acts on it -- it is the one client running a director
    // -- and only while a match is actually running; before START, leaving a room is
    // just leaving a room.
    if (director && bridge && isHost) {
      // Never the bots (POK-330 #4): no roster lists them, so every roster event used to
      // count every bot still standing as gone, and ten seconds later they all were.
      const gone = new Set(departedSeats(match.seats, match.botSeats, ev.members.map((m) => m.id), match.out));
      // Back, or out anyway: whatever was counting them down stops.
      for (const [seat, timer] of leaving) {
        if (gone.has(seat)) continue;
        clearTimeout(timer);
        leaving.delete(seat);
      }
      for (const seat of gone) {
        if (leaving.has(seat)) continue;
        leaving.set(
          seat,
          setTimeout(() => {
            leaving.delete(seat);
            // Still gone, still in the match, and we are still the one running it.
            if (!director || !isHost || match.out.has(seat)) return;
            if ((controls.roster?.members ?? []).some((m) => m.id === seat)) return;
            console.info(`[room] seat ${seat} left the match`);
            announceOut?.(seat);
          }, relay.rejoinMs),
        );
      }
    }
    // Who may kick, for every redraw between now and the next roster event.
    roomKick = ev.host === bridge?.seat ? relay : null;
    // The relay says who is watching; believe it over what we asked for.
    if (bridge) amWatching = ev.members.some((m) => m.id === bridge!.seat && m.spectate === true);
    // Promoted. The relay moves `host` on the roster and says nothing else about it
    // (POK-252), so this is where a guest finds out it is now running the match.
    if (bridge && ev.host === bridge.seat && !isHost) {
      isHost = true;
      console.info('[room] promoted to host');
      // An heir to a room that starts itself (quick play, the daily) before any match
      // counts it down, after the STARTS IN count (POK-320); the room's own first host
      // does that from attach(), which knows it opened the room.
      // Before any match, an heir inherits the room and nothing else: a hosted room still
      // waits for START, now this page's (play-test 2026-09-19: the host switched apps,
      // iOS dropped its socket, and the guest it handed to started the match unasked).
      // After one it is the same, once the grace brings everybody back: a match that has
      // been won is not one to take over (POK-330 #22).
      const next = onPromotion(match);
      if (next === 'room') {
        if (!room.started && startsItself(hash.mode) && autoStarts() && room.startAt === null) {
          room.startAt = performance.now() + AUTO_START_MS;
          setTimeout(() => startDirector(), AUTO_START_MS);
        }
      } else if (next === 'take-over') startDirector(ev.members.map((m) => m.id), match.seed !== 0);
    }
    // Stood down. The relay moved `host` off us while we are still in the room, which
    // only happens because we asked it to (the tab went to the background). The
    // director has to stop with it: two clients running one match is worse than one
    // running it slowly. Everything else -- our own trainer, the ghosts, the ticker --
    // carries on as any guest's does.
    else if (bridge && isHost && ev.host !== bridge.seat) {
      isHost = false;
      console.info('[room] stood down as host');
      teardownHost();
    }
    // Back as the host after our own drop (POK-330 #47): the drop stopped the director,
    // and it picks the match up the way a promoted heir does, from where it stands.
    if (resumeHost && bridge && isHost && ev.host === bridge.seat) {
      resumeHost = false;
      console.info('[room] host again after a drop');
      startDirector(ev.members.map((m) => m.id), true);
    }
    // Somebody arrived while the match is running: tell them where the fog is, now
    // (POK-260). Kanto calls this the late start -- a watcher who has to wait for the
    // next ring to learn the state spends up to two minutes looking at nothing. Not once
    // it has been won: the room is open again, and somebody walking in on the wait for
    // PLAY AGAIN would be handed a match that is over and lose the room screen to it.
    // A player back from a blip is somebody arriving too (POK-330 #25): the relay held
    // their seat, and everything said while they were gone -- who went out, them above
    // all -- went to nobody. So a seat that leaves is forgotten here, and caught up again
    // when it is back: the fog, the clock, one `out` per seat gone, and (on its first
    // `place`) the loot where it stands.
    if (director && bridge && director.state.phase !== 'ended') {
      const state = director.state;
      const here = new Set(ev.members.map((m) => m.id));
      for (const seat of [...greeted]) {
        if (here.has(seat)) continue;
        greeted.delete(seat);
        owedLoot.delete(seat);
      }
      for (const m of ev.members) {
        if (m.id === bridge.seat || greeted.has(m.id)) continue;
        greeted.add(m.id);
        owedLoot.add(m.id);
        for (const msg of catchUp(bridge.seat, state)) relay.to(m.id, msg);
      }
    }
    // The buzzer, before the panel is drawn: a director created after the draw would
    // leave the host's controls on screen for the rest of the match.
    if (ev.members.length >= 2 && autoStarts() && startsItself(hash.mode)) startDirector(ev.members.map((m) => m.id));
    if (bridge) renderRoom(bridge);
    // A host leaving closes the room for everybody -- that is what migration is for --
    // so the in-match LEAVE is a guest's button (POK-241).
    matchLeave.hidden = isHost;
    if (bridge) renderSpectate(bridge, spectate);
    if (bridge) {
      renderRoomPanel(controls, bridge.seat, relay, () => {
        // START: the host shuts the door and deals the match. This is what the
        // ten-second timer was standing in for.
        startDirector(ev.members.map((m) => m.id)); // locks the room itself
        renderRoomPanel(controls, bridge!.seat, relay, () => {}, true);
      }, director !== null);
    }
  });
  /** A dead end is not one unless the page says where else to go: BACK TO LOBBY. */
  const deadEnd = (): void => {
    if (room.fatal) return;
    room.fatal = true;
    noteEl.textContent = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'BACK TO LOBBY';
    back.addEventListener('click', () => backToLobby());
    noteEl.appendChild(back);
    // The drawer says so, under no screen: a dead end is not worth drawing.
    stage.hide();
  };
  relay.on('room_error', (ev) => {
    // `locked` is the common refusal: a room mid-match, which is exactly what you rejoin
    // if you reload an old link. Which ones are dead ends is match/room.ts's onRefused.
    const next = onRefused(ev.reason, { rejoining, wasHost: isHost, seat: bridge?.seat ?? null });
    rejoining = false;
    // The room we were running is gone -- a relay restart, or the seat hold ran out
    // (POK-330 #47). The match is still in this tab, so it goes on in a new room.
    if (next === 'rehost') {
      setStatus('The room was gone. Hosting it again…');
      relay.host({ ...me, open: true, max: BOT_FILL });
      return;
    }
    // Kanto's door: a room on another build is not one you can play in (POK-330 #3). A
    // reload fixes it when this tab is the stale one; when the room is, the lobby does.
    if (ev.reason === 'version') {
      const rom = (sha?: string) => (sha ? sha.slice(0, 7) : '?');
      setStatus(`That room runs rom ${rom(ev.host?.patch)}, this tab rom ${rom(patch)}: the older one reloads to update.`);
    } else setStatus(`Couldn't join: ${ev.reason}`);
    if (next === 'dead-end') deadEnd();
  });
  // QUICK PLAY found nothing to join: host one and let the bots fill it, which is what
  // Kanto does rather than leaving somebody looking at an empty list (POK-240).
  relay.on('no_open_rooms', () => {
    setStatus('No game going. Hosting one…');
    relay.host({ ...me, open: true, max: BOT_FILL }); // our build with it, or the gate has nothing to hold
  });
  // Everything open is mid-match: WATCH PLAY NEXT. Joining as a spectator gets you the
  // match now and a seat in the next one.
  relay.on('match_in_progress', (ev) => {
    if (!ev.code) return;
    setStatus(`Watching ${ev.code}…`);
    setRoomHash('join', ev.code);
    amWatching = true;
    relay.join(ev.code, { ...me, spectate: true }); // a watcher's replay is a link battle: the gate's
  });
  relay.on('closed', (ev) => {
    // A host's socket going is the room going to an heir, or waiting for us: either way
    // this page is not running the match any more, and a director left standing here
    // would answer picks next to the heir's once the rejoin lands. A host the relay
    // waited for starts its director again from attach (POK-330 #47), from the clock
    // this one stopped at.
    if (director && director.state.phase !== 'ended') {
      match.clockLeft = director.state.clockLeft;
      match.clockAt = performance.now();
    }
    teardownHost();
    stopSpectateLoop?.();
    // The room itself is over -- the host left, its hold ran out, or it showed us out --
    // and no new socket is coming (POK-330 #47): the same dead end a refused door is.
    if (!ev.reconnecting) {
      setStatus(`The room closed: ${ev.reason}`);
      deadEnd();
      return;
    }
    setStatus(ev.reason === 'restart' ? 'The server is restarting. Reconnecting…' : `Disconnected: ${ev.reason}`);
  });
  // ...and it comes back. The socket retries on its own, but nothing ever un-said
  // `Disconnected`, so a page that had recovered still read as dead for the rest of
  // the match (play-test: the line was on the strip in every frame of the video).
  relay.on('open', (ev) => {
    if (!ev.reconnected) return;
    // Back to the seat we had (POK-284): the relay holds it for a minute after a
    // socket drops, and the id it hands back is the one every ROM in the room already
    // knows us by. A host that dropped finds an heir running the match and comes back
    // as a member of it (POK-116), or finds the room waited and is its host again; if
    // the room is gone (a relay restart), room_error's onRefused hosts a new one.
    if (relay.rejoin()) {
      rejoining = true;
      setStatus('Reconnected. Rejoining…');
      return;
    }
    // A relay that gave us no token to come back with.
    if (isHost) {
      setStatus('Reconnected. Hosting again…');
      relay.host({ ...me, open: true, max: BOT_FILL });
      return;
    }
    setStatus('Reconnected, but the room carried on without you. LEAVE to start again.');
  });

  // A hidden tab gets its timers throttled and its rAF stopped, and on the host those
  // are the match: the director's clock, the bots' walking and the emulator itself.
  // POK-247 put a warning in the title bar and a line on the room panel, which is
  // the best a page can do about its own freeze -- and not what anybody wants.
  // Cam's call at the play-test: "we cannot pause the game if the host tabs out. If
  // that happens it should swap hosts. No alert is needed."
  //
  // So it hands the room over. `can_host false` is already how an eliminated client
  // withdraws from the succession (POK-252); the relay now reads it from the host
  // itself as a stand-down and holds the same election it holds when a host leaves.
  // The heir was already mirroring the world the director is authoritative over, so
  // there is nothing to send: the roster carries `host` and the promotion below is
  // what everybody already does with it.
  //
  // On the way back this page is an ordinary member. It says it could host again --
  // for the next time the room needs an heir -- and does not take the match back.
  document.addEventListener('visibilitychange', () => {
    if (amWatching) return;
    if (document.hidden) {
      if (director) relay.canHost(false);
      return;
    }
    const me = bridge ? bridge.roster.get(bridge.seat) : undefined;
    if (me === undefined || me.alive) relay.canHost(true);
  });

  const relayUrl = (import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL;
  const skin = String(careerSkin());
  // What we are running, so the relay's version gate can do its job (POK-244). Both
  // sides of a link battle must run the same build or the block exchange desyncs
  // silently -- and saying nothing means never being refused, which is the wrong end
  // of that trade once there is more than one build in the world. Every way in says
  // it: the quick-play host and the watcher's join used to leave it out.
  const me = { name: careerName(), skin, patch, protocol };
  relay.connect(relayUrl);
  // Whatever solo play never got to tell the relay about itself (POK-243): `wireRoom`
  // only ever runs for host/quick/daily/join -- solo returned above, before there was
  // a `relay` to send on -- so reaching this line at all is the "next real connection"
  // match/stats.ts's own comment is waiting for. `send` queues until the socket is
  // actually open, the same trust `relay.host`/`relay.join` below already put in it.
  const stat = statMessage(String(protocol ?? '?'));
  if (stat) {
    relay.send(stat);
    statFlushed();
  }
  // Open, because a room nobody can find is not a lobby (POK-240). JOIN BY CODE still
  // works for one that is not listed; that is what a passcode is for.
  if (hash.mode === 'host') relay.host({ ...me, open: true, max: BOT_FILL });
  else if (hash.mode === 'quick') relay.quickJoin(me);
  else if (hash.mode === 'daily') relay.dailyJoin(me);
  else relay.join(hash.code!, { ...me, spectate: hash.mode === 'watch' });
}

// ---- the lobby (POK-240) -----------------------------------------------------------

/** How often the list refreshes. Kanto's `relay.lua` re-asks `list_rooms` every
 *  `LIST_EVERY` (5.0s) while its browse screen is up; this is the same beat, and it
 *  is also what tells the relay somebody is browsing (its `browsedAt`, which its own
 *  stats read). */
const LOBBY_REFRESH_MS = 5000;

/** Kanto's one screen: every way into a match is a row on it. Resolves with the choice,
 *  having closed the browsing socket first -- SOLO VS BOTS must reach the ROM with no
 *  connection open, which is the whole point of it. */
function runLobby(): Promise<RoomHash> {
  showScreen('lobby');
  const stage = theStage();
  const relay = new RelayClient();
  let online = false;
  let rooms: RoomListing[] = [];
  /** The line under the main menu: a rejected code, or nothing. */
  let note = '';

  return new Promise<RoomHash>((resolve) => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const done = (hash: RoomHash) => {
      if (timer) clearInterval(timer);
      relay.close();
      stage.hide();
      resolve(hash);
    };
    const redraw = () => stage.redraw();

    const press = (action: LobbyAction) => {
      switch (action.kind) {
        case 'name': {
          const typed = cleanName(prompt('Your name? (7 characters)') ?? '');
          if (typed) saveProfile({ name: typed });
          redraw();
          return;
        }
        case 'skin':
          // The wardrobe (POK-320): every sprite on the ladder, Kanto's Picker.
          browsedSkin = careerSkin();
          stage.push(wardrobe);
          return;
        case 'intro':
        case 'win':
        case 'lose': {
          // Three rows, three independent picks (POK-283). One index for all three meant
          // choosing a win line you did not want to get the intro you did.
          const which = action.kind;
          const career = loadCareer();
          saveProfile({ [which]: nextLine(career[which] ?? 0) });
          redraw();
          return;
        }
        case 'stats':
          setStatsOff(!loadStats().off);
          redraw();
          return;
        case 'career':
          // Kanto's career is a file somebody can carry between machines; ours lives
          // in a localStorage nobody can copy, so this is the door (POK-243). Save
          // writes it out; load takes one back and re-reads the profile from it.
          if (confirm('Save your career to a file?\n\nCancel to load one instead.')) saveCareerFile();
          else loadCareerFile(redraw);
          return;
        case 'lobbies':
          stage.push(lobbies);
          return;
        case 'solo':
          setRoomHash('solo');
          return done({ mode: 'solo' });
        case 'quick':
          setRoomHash('quick');
          return done({ mode: 'quick' });
        case 'host':
          setRoomHash('host');
          return done({ mode: 'host' });
        case 'daily':
          // The daily has its own door on the relay: everybody who presses this row
          // lands in the same room, whoever gets there first hosting it (POK-242).
          setRoomHash('daily');
          return done({ mode: 'daily' });
        case 'code': {
          const code = (prompt('Room code?') ?? '').trim().toUpperCase();
          // The relay never issues 0/O/1/I/L -- they read alike at a glance -- so a
          // code with one of those in it, or the wrong length, could not be real
          // (POK-240). Catching that here beats waiting on the relay's `not_found`.
          if (!isRoomCode(code)) {
            note = code ? `${code} is not a room code.` : '';
            redraw();
            return;
          }
          setRoomHash('join', code);
          return done({ mode: 'join', code });
        }
        case 'join':
        case 'watch':
          setRoomHash('join', action.code);
          return done({ mode: 'join', code: action.code });
      }
    };
    const row = (r: LobbyRow): RowSpec => ({
      label: r.label,
      // The padlock is not in Emerald's font.
      detail: r.detail?.replace('🔒', 'PASS'),
      disabled: r.disabled,
      onPress: () => press(r.action),
    });
    const record = () => {
      const career = loadCareer();
      return career.matches > 0 ? careerLine(career) : 'your name';
    };

    const main = menuScreen(() => ({
      title: 'HOENN BATTLE ROYALE',
      rows: playRows(online, rooms.filter((r) => !r.daily).length, rooms.find((r) => r.daily)).map(row),
      rowsId: 'lobby-rows',
      note: note || (online ? '' : 'Not connected. SOLO VS BOTS works without a socket.'),
      noteId: 'lobby-note',
      trainer: { name: careerName(), skin: careerSkin(), record: record(), onPress: () => stage.push(trainer) },
    }));
    const trainer = menuScreen(() => ({
      title: 'TRAINER',
      rows: profileRows({
        name: careerName(),
        skin: SKINS[careerSkin()],
        lines: careerVoiceLines(),
        statsOn: !loadStats().off,
        record: record(),
      }).map(row),
      rowsId: 'trainer-rows',
      note: '',
      buttons: [{ label: 'BACK', id: 'trainer-back', onPress: () => stage.pop() }],
      onBack: () => stage.pop(),
    }));
    const lobbies = menuScreen(() => ({
      title: 'LOBBIES',
      rows: roomRows(rooms).map(row),
      rowsId: 'lobby-rooms',
      note: rooms.length === 0 ? emptyNote(online) : '',
      noteId: 'lobby-rooms-note',
      buttons: [{ label: 'BACK', id: 'lobbies-back', onPress: () => stage.pop() }],
      onBack: () => stage.pop(),
    }));
    const wardrobe = wardrobeScreen(() => ({
      wins: loadCareer().wins,
      worn: careerSkin(),
      browsing: browsedSkin ?? careerSkin(),
      onBrowse: (skin) => {
        // Only what you have earned is worn. saveProfile refuses a locked skin anyway
        // -- that is the backstop against a poked store -- but asking it to is what
        // would make the screen lie about which sprite is yours.
        if (browsedSkin === skin && skinUnlocked(skin, loadCareer().wins)) saveProfile({ skin });
        browsedSkin = skin;
        redraw();
      },
      onWear: (skin) => {
        if (skinUnlocked(skin, loadCareer().wins)) saveProfile({ skin });
        redraw();
      },
      onBack: () => {
        browsedSkin = null;
        stage.pop();
      },
    }));
    stage.show(main);

    relay.on('closed', () => {
      online = false;
      rooms = [];
      redraw();
    });
    relay.on('rooms', (ev) => {
      rooms = ev.rooms;
      redraw();
    });
    relay.connect((import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL);
    // There is no 'open' event to hang this on, so the refresh tick is also what
    // notices the socket came up. A short first beat so the list is not blank for
    // three seconds on a connection that was ready immediately.
    const beat = () => {
      const up = relay.isOpen();
      if (up !== online) {
        online = up;
        redraw();
      }
      if (up) relay.listRooms();
    };
    setTimeout(beat, 200);
    timer = setInterval(beat, LOBBY_REFRESH_MS);
  });
}

// ---- wiring -------------------------------------------------------------------------------

function wirePlayScreen(emu: Emulator, symbols: Map<string, number> | undefined, rom: Uint8Array | null = null): void {
  wireKeyboard(emu);
  wireGamepad(emu);
  wireRemap();
  for (const el of document.querySelectorAll<HTMLElement>('#pad .btn[data-key]')) {
    wireButton(el, el.dataset.key as GbaKey, emu);
  }
  wireDpad($('#dpad-surface') as HTMLElement, emu);
  wireSettings(emu);
  wireDrawer();
  wireFps(emu);
  // The picture in its box and the field drawn past it (field.ts, POK-317). Without the
  // symbol table the picture is still placed; the field around it stays dark.
  new FieldView({
    emu,
    symbols: symbols ?? null,
    box: $('#screen-wrap') as HTMLElement,
    lcd: $('#canvas') as HTMLCanvasElement,
    field: $('#field') as HTMLCanvasElement,
    overlay: $('#overlay') as HTMLCanvasElement,
    pad: $('#pad') as HTMLElement,
    rom,
  }).attach();
  // Tapping the map (touch.ts). Needs the symbol table: without it there is no reading
  // where we stand or which menu is up, and a tap does nothing.
  if (symbols) {
    new TouchLayer({
      emu,
      canvas: $('#canvas') as HTMLCanvasElement,
      surface: $('#screen-wrap') as HTMLElement,
      symbols,
    }).attach();
  }
}

function wireDrawer(): void {
  const btn = $('#menu-btn') as HTMLButtonElement;
  btn.addEventListener('click', () => openDrawer(!document.body.classList.contains('drawer-open')));
  ($('#drawer-close') as HTMLButtonElement).addEventListener('click', () => openDrawer(false));
}

/** Registers the service worker (POK-246), so a second visit works with no network and
 *  the site can be added to a home screen. Production only: in dev it would cache the
 *  dev server's own modules and fight HMR for the rest of the afternoon. */
function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  // After load, so it never competes with the shell and the wasm core for the network
  // on a first visit -- which is the visit that decides whether anybody comes back.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // A blocked worker (private mode, an http:// origin, a policy) costs offline and
      // nothing else, so it is worth a line in the console and not a word on screen.
      console.info('[pwa] no service worker:', err);
    });
  });
}

/** Asks the browser to keep what we store (POK-246). The whole premise is "import your
 *  ROM once", and without this Safari evicts an origin's storage after about a week of
 *  not being opened -- which would mean finding the .gba again. The prompt, where there
 *  is one, is only shown to somebody who has already installed or engaged with the
 *  site, so asking is not a thing a first-time visitor sees. */
async function askToKeepStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    // Refused or unsupported: the ROM is still in IndexedDB, just evictable.
  }
}

/** The name the proxy instance boots under. It never appears anywhere -- no room, no
 *  ghost, no HUD -- but the boot block wants one. */
const PROXY_NAME = 'PROXY';

/** `#fresh`: the reload that cannot be argued with. A shift-reload asks the browser
 *  nicely and a service worker (or a browser with its own ideas about caching) can
 *  still answer with what it had -- the play-test pressed it repeatedly and kept
 *  getting the same page. This unregisters every worker for this origin, drops every
 *  cache, and comes back on a clean hash so it happens once. */
async function runFreshIfAsked(): Promise<boolean> {
  const hash = new URLSearchParams(location.hash.slice(1));

  if (!hash.has('fresh')) return false;
  setVersionLine('clearing…');
  try {
    if ('serviceWorker' in navigator) {
      const workers = await navigator.serviceWorker.getRegistrations();
      await Promise.all(workers.map((w) => w.unregister()));
    }
  } catch {
    /* no workers, or a browser that will not say: the caches below still go */
  }
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    /* nothing cached */
  }
  location.replace(`${location.pathname}${location.search}`);
  return true;
}

async function main(): Promise<void> {
  if (await runFreshIfAsked()) return;
  registerServiceWorker();
  void askToKeepStorage();
  setVersionLine('—');
  const canvas = $('#canvas') as HTMLCanvasElement;
  const emu = await Emulator.create(canvas);
  // The picture past the LCD (POK-319, field.ts): the core draws a band around the
  // 240x160 from the same registers. A core without the export draws the LCD alone.
  emu.setViewport(BAND);

  await runImportScreen(emu);
  const { bytes, usingPatched, mailboxBase, protocol, symbols, patch } = await runPatchingScreen(emu);

  showScreen('playing');
  if (usingPatched) await emu.startBytes(bytes);
  else await emu.start();

  // Dev only, for the e2e harness (POK-220): solo play never builds a Bridge, so this
  // is the only way in to read the emulator's memory from outside the page.
  if (import.meta.env.DEV) (window as unknown as { __hbr?: unknown }).__hbr = { emu };

  // The proxy's own instance is not booted here -- only made available. It costs a
  // second wasm core and a second copy of the ROM, so it is paid for on the first bot
  // -vs-bot meeting, in the one tab that runs the bots (POK-238).
  if (usingPatched && mailboxBase !== undefined) {
    proxyDuels = new ProxyDuels({
      mailboxBase,
      boot: async () => {
        // Headless: a second core with a window would resize the first's canvas -- SDL
        // finds its canvas by the selector "#canvas", not by Module.canvas.
        const hidden = document.createElement('canvas');
        hidden.width = 240;
        hidden.height = 160;
        const other = await Emulator.create(hidden, undefined, true);
        await other.startBytes(bytes);
        other.setVolume(0); // it is not on screen and it is not to be heard
        other.setSpeed(8); // ...and it is in a hurry: a duel is a fight nobody watches
        return other;
      },
      writeBoot: (e, base) => writeBootBlock(e as Emulator, base, PROXY_NAME),
      onNote: (what) => console.info('[proxy]', what),
      onStream: (msg) => proxyStream?.(msg),
    });
  }

  // Input first, and before anything that waits: the wiring used to sit after the
  // mailbox handshake and the lobby, so between the ROM starting and the match being
  // chosen there was a running game that answered to nothing at all.
  wirePlayScreen(emu, symbols, bytes);

  // Which way in decides the boot block -- solo warps straight into the Safari opening
  // (BR_BOOT_SAFARI) while a room waits in Littleroot (BR_BOOT_MAP) -- so the choice has
  // to be made before the ROM is told anything. A hash is that choice already made (a
  // deep link, a rejoin, a test); with no hash, the lobby is where it gets made.
  // Held still while the lobby is up (play-test: "it looks like I'm doing the weird
  // intro screen with the cars... I should never see this screen"). The ROM starts
  // before the lobby and the boot block is not written until a way in has been chosen,
  // so every second spent choosing was a second of a ROM nobody was steering -- long
  // enough to reach the title screen and start Emerald's own attract loop, which is
  // what Cam watched. A hash in the URL skips the lobby and lands the block in about
  // 150 frames, which is why no driver and no e2e has ever seen it.
  // The ROM is held still from the moment its mailbox answers until the boot block is
  // in. It has a copyright screen, a title screen and an attract loop, and if nobody is
  // steering it it will play all three -- which is the truck the play-test kept seeing
  // (POK-221). The first version of this only held it while the LOBBY was up, and every
  // other way in still had a running game behind it: a deep link, a rejoin, PLAY AGAIN
  // rebooting the emulator, a quick-play join waiting on the relay. So the hold is
  // around all of them now, hash or no hash.
  //
  // BrMailbox_Init zeroes the struct on the ROM's first frame, so the wait has to come
  // before the block and the block cannot be written before the magic appears.
  if (mailboxBase !== undefined) {
    await waitForMailbox(emu, mailboxBase);
    emu.pause();
    // The ROM's own mailbox says which wire it speaks and how big it is (POK-330 #3): a
    // page that reads it differently would get every message in a room wrong, so it
    // plays solo only. Nothing ever asked before.
    if (!roomsRefused && protocol !== undefined) {
      try {
        new Mailbox(emu, mailboxBase).assertCompatible(protocol);
      } catch (err) {
        roomsRefused = err instanceof Error ? err.message : String(err);
      }
    }
  }
  const fromHash = parseRoomHash();
  let roomHash = fromHash;
  if (!roomHash) roomHash = await runLobby();
  if (roomsRefused && roomHash.mode !== 'solo') return refuseRoom(roomsRefused);
  const bootMode = bootModeFor(roomHash.mode);

  if (mailboxBase !== undefined) {
    writeBootBlock(emu, mailboxBase, careerName(), bootMode, careerSkin());
    emu.resume();
  }

  showScreen('playing');
  if (mailboxBase !== undefined && roomHash.mode === 'solo') runSolo(emu, mailboxBase, symbols);
  else wireRoom(emu, mailboxBase, protocol, symbols, roomHash, patch);
}

main().catch((err) => {
  // Safari's `stack` is frames only, no message: say both.
  const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  console.error('shell startup failed', err);
  showScreen('importing');
  const el = $('#import-error') as HTMLElement;
  el.textContent = `Startup failed: ${message}`;
  el.hidden = false;
});
