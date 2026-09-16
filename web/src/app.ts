// The web shell's state machine (POK-213): importing -> patching -> playing.
// Plain DOM, phone-first (see index.html for layout). Everything Emerald/GBA-specific
// goes through emu/index.ts's Emulator wrapper -- this file never touches the core
// directly, per the project CLAUDE.md.

import { Emulator, type GbaKey } from './emu';
import { checkEmerald, isPrePatched } from './rom/emerald';
import { loadRelease, loadSidecars, type ReleaseInfo } from './release';
import type { PatchWorkerRequest, PatchWorkerResponse } from './patch/bps.worker';
import { Mailbox, MAILBOX } from './net/mailbox';
import { RelayClient, type RoomListing, type RosterEvent } from './net/relay';
import { Bridge } from './net/bridge';
import { crossesToRom, packSlot, type BinarySlot } from './net/slots';
import { decode, type Msg } from './net/wire';
import { encodeGen3 } from './text/gen3';
import { writeHudClockSecs, writeHudEyes, writeHudLeft, writeMySeat, writeMySkin } from './net/hud';
import { Director, type DirectorState, type DirectorWorld } from './match/director';
import { Spectate } from './match/spectate';
import { Loot } from './match/loot';
import { Results } from './match/results';
import { Bots } from './bots/brain';
import { dealBots } from './bots/roster';
import { voiceFor } from './bots/lines';
import * as Ticker from './match/ticker';
import { emptyNote, fixedRows, roomRows, type LobbyAction, type LobbyRow } from './match/lobby';
import {
  canStart,
  doorOf,
  nextDoor,
  nextFog,
  nextMax,
  nextTextSpeed,
  roomView,
  startNote,
  textSpeedLabel,
} from './match/room';
import type { RosterEntry } from './match/roster';
import type { TickerMsg } from './net/wire';
import { World, type WorldMap } from './bots/world';
import { sectionInside } from './match/ring';
import { dealParty } from './bots/party';
import { mulberry32 } from './match/clock';
import {
  careerLine,
  cleanName,
  loadCareer,
  nextSkin,
  ordinal,
  recordMatch,
  saveProfile,
  SKINS,
} from './match/career';
import worldData from './data/world.json';
import { LANDING } from './match/landing';
import regionmapData from './data/regionmap.json';

// The world data the director deals spawns and picks ring centres from (POK-223/224).
// Cast rather than re-declared: these three JSON files are the exporter's own output
// (DESIGN.md §6), and director.ts only reads the handful of fields it documents on
// `DirectorMapEntry`/`LandingCell`/`RegionSection` -- a wider real shape satisfies it.
const WORLD: DirectorWorld = {
  maps: worldData.maps as DirectorWorld['maps'],
  landing: LANDING,
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

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

type Screen = 'importing' | 'patching' | 'lobby' | 'playing';
const SCREENS: Screen[] = ['importing', 'patching', 'lobby', 'playing'];

function showScreen(screen: Screen): void {
  for (const s of SCREENS) $(`#screen-${s}`).toggleAttribute('hidden', s !== screen);
}

function setVersionLine(text: string): void {
  $('#version').textContent = text;
}

function versionText(info: ReleaseInfo): string {
  return `patch ${info.patch} · shell ${info.shell.slice(0, 7)}`;
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
  /** The patch number this ROM was built from, for the relay's version gate
   *  (POK-244): both sides of a link battle must be on the same one. */
  patch?: number;
  /** The full symbol table alongside mailboxBase -- gBrHud/gBrMySeat's addresses
   *  (director.ts's HUD wiring, POK-222/224/228) come from here rather than a
   *  second hard-coded constant (per CLAUDE.md: never hard-code an EWRAM address). */
  symbols?: Map<string, number>;
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
    setVersionLine(`${versionText(side.info)} · local build`);
    return {
      bytes: stored,
      usingPatched: true,
      mailboxBase: side.symbols.get('gBrMailbox'),
      protocol: side.info.protocol,
      patch: side.info.patch,
      symbols: side.symbols,
    };
  }
  const release = await loadRelease();

  if (release.status === 'unpublished') {
    setVersionLine('unpatched');
    statusEl.textContent = 'No patch published yet -- starting the unpatched ROM.';
    bannerEl.textContent = `Running the unpatched ROM (${release.reason}). Battle royale features are not active.`;
    bannerEl.hidden = false;
    return { bytes: emu.readRom(), usingPatched: false };
  }

  setVersionLine(versionText(release.info));
  statusEl.textContent = 'Applying the patch…';
  try {
    const patched = await applyPatchInWorker(emu.readRom(), release.patch);
    return {
      bytes: patched,
      usingPatched: true,
      mailboxBase: release.symbols.get('gBrMailbox'),
      protocol: release.info.protocol,
      patch: release.info.patch,
      symbols: release.symbols,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Patch failed: ${message}`;
    throw err;
  }
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
  const down = (e: KeyboardEvent) => {
    const key = KEYBOARD_MAP[e.key];
    if (!key) return;
    e.preventDefault();
    emu.press(key);
  };
  const up = (e: KeyboardEvent) => {
    const key = KEYBOARD_MAP[e.key];
    if (!key) return;
    e.preventDefault();
    emu.release(key);
  };
  addEventListener('keydown', down);
  addEventListener('keyup', up);
  return () => {
    removeEventListener('keydown', down);
    removeEventListener('keyup', up);
  };
}

// ---- input: touch pad -------------------------------------------------------------------

function wireButton(el: Element, key: GbaKey, emu: Emulator): void {
  const down = (e: Event) => {
    e.preventDefault();
    el.classList.add('down');
    emu.press(key);
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
    for (const key of next) if (!active.has(key)) emu.press(key);
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
    emu.stop();
    await emu.forgetRom();
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

function waitForMailbox(emu: Emulator, mailboxBase: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let frames = 0;
    const off = emu.onFrame(() => {
      if (emu.read(mailboxBase + MAILBOX.OFF_MAGIC, 16) === MAILBOX.MAGIC) {
        off();
        resolve();
      } else if (++frames > 600) {
        off();
        reject(new Error('the ROM never woke its mailbox: is this a Hoenn BR build?'));
      }
    });
  });
}

function careerName(): string {
  // The old key, from before the profile lived beside the record (POK-243). Read as a
  // fallback so nobody loses the name they already had.
  const career = loadCareer();
  return career.name || cleanName(localStorage.getItem(NAME_STORAGE_KEY) ?? '') || DEFAULT_NAME;
}

/** Which of the four trainer sprites is your ghost on everybody else's screen. */
function careerSkin(): number {
  return loadCareer().skin ?? 0;
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
  emu.write(boot + 0, mode, 8);
  // The four sprites are BRENDAN, MAY, RIVAL BRENDAN, RIVAL MAY -- the odd ones are
  // the girls, and the player's own avatar should be what they picked for their ghost.
  emu.write(boot + 1, skin % 2 === 1 ? FEMALE : MALE, 8);
  emu.write(boot + 2, LITTLEROOT.group, 8);
  emu.write(boot + 3, LITTLEROOT.num, 8);
  emu.write(boot + 4, LITTLEROOT.x, 16);
  emu.write(boot + 6, LITTLEROOT.y, 16);
  const nameField = emu.bytes(boot + 8, 8);
  nameField.fill(0xff); // EOS (include/constants/characters.h) pads whatever the name doesn't fill
  nameField.set(encodeGen3(name, 7));
}

// ---- room: relay + bridge, opted into by the URL hash ------------------------------------

interface RoomHash {
  mode: 'host' | 'join' | 'quick' | 'solo' | 'daily' | 'watch';
  code?: string;
}

/** `#host` hosts a room, `#join=CODE` joins one, `#quick` takes whatever game is going,
 *  and `#solo` plays alone and opens no socket at all (Kanto's rule, project
 *  CLAUDE.md). No hash at all is the lobby, which is a choice between those. */
function parseRoomHash(): RoomHash | null {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('solo')) return { mode: 'solo' };
  if (params.has('host')) return { mode: 'host' };
  if (params.has('quick')) return { mode: 'quick' };
  if (params.has('daily')) return { mode: 'daily' };
  const code = params.get('join');
  return code && /^[A-Za-z0-9]+$/.test(code) ? { mode: 'join', code: code.toUpperCase() } : null;
}

/** Keeps the URL honest about which room you are in, so a reload rejoins it and the
 *  link is shareable -- without adding a history entry per press. */
function setRoomHash(key: string, value?: string): void {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const k of ['host', 'join', 'quick', 'solo', 'daily']) params.delete(k);
  params.set(key, value ?? '');
  history.replaceState(null, '', `#${params.toString().replace(/=(?=&|$)/g, '')}`);
}

function renderRoom(bridge: Bridge): void {
  const list = $('#room-roster') as HTMLElement;
  list.innerHTML = '';
  for (const entry of bridge.roster.all()) {
    const li = document.createElement('li');
    const label = entry.name || `P${entry.seat}`;
    li.textContent = `${label}${entry.isMe ? ' (you)' : ''}${entry.alive ? '' : ' -- OUT'}`;
    list.appendChild(li);
  }
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
}

/** Draws the room panel: the roster everybody sees, and the four controls only the
 *  host gets. `onStart` is the host pressing START -- the thing that used to be a
 *  ten-second timer. */
function renderRoomPanel(
  controls: RoomControls,
  mySeat: number,
  relay: RelayClient,
  onStart: () => void,
  started: boolean,
): void {
  const box = $('#room-controls') as HTMLElement;
  const note = $('#room-note') as HTMLElement;
  if (!controls.roster) {
    box.hidden = true;
    note.textContent = '';
    return;
  }
  const view = roomView(controls.roster, mySeat, controls.fill);
  box.hidden = !view.isHost || started;
  note.textContent = started ? '' : startNote(view);
  if (box.hidden) return;

  const max = $('#room-max') as HTMLButtonElement;
  const fill = $('#room-fill') as HTMLButtonElement;
  const door = $('#room-door') as HTMLButtonElement;
  const start = $('#room-start') as HTMLButtonElement;
  const text = $('#room-text') as HTMLButtonElement;
  const anim = $('#room-anim') as HTMLButtonElement;
  const fog = $('#room-fog') as HTMLButtonElement;
  max.textContent = `MAX ${view.max}`;
  fill.textContent = view.fill > 0 ? `FILL ${view.fill}` : 'FILL OFF';
  door.textContent = { open: 'LISTED', private: 'UNLISTED', pass: 'PASSCODE' }[doorOf(view)];
  start.disabled = !canStart(view);
  text.textContent = `TEXT ${textSpeedLabel(controls.textSpeed)}`;
  anim.textContent = controls.animations ? 'ANIM ON' : 'ANIM OFF';
  fog.textContent = `FOG ${controls.fogSecs}s`;

  max.onclick = () => relay.setMax(nextMax(view.max));
  fill.onclick = () => {
    controls.fill = !controls.fill;
    renderRoomPanel(controls, mySeat, relay, onStart, started);
  };
  door.onclick = () => {
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
  };
  const redraw = () => renderRoomPanel(controls, mySeat, relay, onStart, started);
  text.onclick = () => {
    controls.textSpeed = nextTextSpeed(controls.textSpeed);
    redraw();
  };
  anim.onclick = () => {
    controls.animations = !controls.animations;
    redraw();
  };
  fog.onclick = () => {
    controls.fogSecs = nextFog(controls.fogSecs);
    redraw();
  };
  start.onclick = onStart;
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
function paceOptions(): { safariSecs?: number; fogSecs?: number } | undefined {
  if (!import.meta.env.DEV || !new URLSearchParams(location.hash.slice(1)).has('quick')) return undefined;
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
): {
  bots: Bots;
  seats: number[];
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
  const sectionOf = new Map(maps.map((m) => [m.id, m.section]));
  const idByRef = new Map(maps.map((m) => [`${m.group}:${m.num}`, m.id]));
  let ring: { sx: number; sy: number; r: number } | undefined;
  const bots = new Bots({
    world,
    targets,
    mapRef: (id) => refById.get(id),
    send,
    rng: mulberry32(seed ^ 0x51ce),
    sendTo,
    inside: (id) => sectionInside(WORLD.sections[sectionOf.get(id) ?? ''], ring),
    loot: {
      all: () =>
        loot
          .all()
          .map((l) => ({ ...l, mapId: idByRef.get(`${l.map.group}:${l.map.num}`) ?? '' }))
          .filter((l) => l.mapId !== ''),
      at: (mapId, x, y) => {
        const ref = refById.get(mapId);
        return ref ? loot.at(ref, x, y) : undefined;
      },
    },
    // The eyeline (POK-238). A bot fights a player the same way a player fights one:
    // whoever sees the other starts it. The team goes over as a `trainer` card first,
    // because the ROM has to build a party before the challenge lands.
    engage: {
      players: () =>
        players()
          .filter((e) => e.alive && !seatsDealt.has(e.seat) && e.map && e.x !== undefined && e.y !== undefined)
          .map((e) => ({
            seat: e.seat,
            mapId: idByRef.get(`${e.map!.group}:${e.map!.num}`) ?? '',
            x: e.x!,
            y: e.y!,
            dir: e.dir as 1 | 2 | 3 | 4,
            busy: busySeats.has(e.seat),
          }))
          .filter((p) => p.mapId !== ''),
    },
    // Where the bot is standing is where its mons came from (POK-237): the drop put
    // it on a route, and that route's own table is what a trainer there would have.
    deal: (bot, atPhase, mapId) => dealParty(seed, bot.seat, atPhase, mapId),
    seed,
    onDuel,
    onEngage,
    centres: () => world.centres(),
    // Bots are on this roster too -- the host applies its own bots' `place` to it --
    // so this is the whole field, which is what the hunt rule wants.
    alive: () => players().filter((e) => e.alive).length,
  });
  const spawns = targets.map((t) => ({ mapId: t.mapId, map: refById.get(t.mapId)!, x: t.x, y: t.y }));
  const dealt = dealBots(seed, fill, takenSeats, spawns);
  const seatsDealt = new Set(dealt.map((b) => b.seat));
  let phase = 0;
  bots.start(dealt, performance.now());
  const id = setInterval(() => bots.tick(performance.now()), BOT_TICK_MS);
  return {
    bots,
    seats: dealt.map((b) => b.seat),
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
      return seatsDealt.has(seat) && mons.length > 0 ? { t: 'party', seat, mons } : null;
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
function renderResults(bridge: Bridge, results: Results, seats: number): void {
  const panel = $('#results-panel') as HTMLElement;
  const mine = results.forSeat(bridge.seat, performance.now());
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
    const who = bridge.roster.get(mine.winner);
    parts.push(mine.winner === bridge.seat ? 'you won' : `${who?.name || `P${mine.winner}`} won`);
  } else {
    parts.push('a draw');
  }
  ($('#results-line') as HTMLElement).textContent = parts.join(' · ');
}

// ---- spectating (POK-233) -----------------------------------------------------------

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
    button.textContent = entry.name || `P${entry.seat}`;
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

/** The spectator's own pump: re-ask the trainer we watch what they carry (the ask is
 *  also what tells them they are being watched), and mirror how many are watching US
 *  into the corner eye. Returns a disposer. */
function startSpectateLoop(
  emu: Emulator,
  hudBase: number | undefined,
  bridge: Bridge,
  spectate: Spectate,
): () => void {
  const id = setInterval(() => {
    const now = performance.now();
    const ask = spectate.duePeek(bridge.seat, now);
    if (ask) bridge.relay.all(ask);
    // Bots join by walking, not by joining: their seats appear in the roster from a
    // `place`, and there is no relay event to redraw the list on.
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
const DIRECTOR_TICK_MS = 1000; // coarser than the 5s clock/fogSecs cadence director.ts needs

function renderMatchStrip(state: DirectorState): void {
  const panel = $('#room-panel') as HTMLElement;
  const strip = $('#match-strip') as HTMLElement;
  panel.hidden = false;
  strip.hidden = false;
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

/** Packs and pushes every `Msg` that crosses to the ROM (start/clock/ring -- not
 *  `win`, JSON-only per docs/WIRE.md) into one mailbox's in-ring, one slot budget a
 *  frame, retrying next frame while it's full -- the same shape as bridge.ts's own
 *  `flushOutQueue`, reused here because the director's `send` needs exactly that
 *  behaviour for two different mailboxes (solo's own, and the room host's, which
 *  reuses `bridge.mailbox` rather than opening a second one on the same base). */
function createRomPushQueue(emu: Emulator, mailbox: Mailbox): { push: (msg: Msg) => void; dispose: () => void } {
  const queue: BinarySlot[] = [];
  const off = emu.onFrame(() => {
    while (queue.length > 0) {
      const slot = queue[0];
      if (!mailbox.push(slot.type, slot.payload)) return; // ring full; retry next frame
      queue.shift();
    }
  });
  return {
    push(msg) {
      if (crossesToRom(msg.t)) queue.push(...packSlot(msg));
    },
    dispose: off,
  };
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
 *  just a direct push into this ROM's own mailbox (`createRomPushQueue`) and a
 *  Director for the one seat this client owns. `onOut` wires nothing in: a one-seat
 *  match's own out (a real whiteout) never decides a winner (director.ts's own
 *  header comment), so nobody needs to hear about it here. */
function runSolo(emu: Emulator, mailboxBase: number, symbols: Map<string, number> | undefined): void {
  const mailbox = new Mailbox(emu, mailboxBase);
  const rom = createRomPushQueue(emu, mailbox);
  const seatBase = symbols?.get('gBrMySeat');
  if (seatBase !== undefined) writeMySeat(emu, seatBase, 0);

  const director = new Director({
    seats: [0],
    hostSeat: 0,
    seed: Math.floor(Math.random() * 0x7fff_ffff) + 1,
    world: WORLD,
    send: (msg) => rom.push(msg),
    now: () => performance.now(),
    onOut: () => () => {},
  });

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
}

// ---- room: relay + bridge, opted into by the URL hash ------------------------------------

function wireRoom(
  emu: Emulator,
  mailboxBase: number | undefined,
  protocol: number | undefined,
  symbols: Map<string, number> | undefined,
  hash: RoomHash,
  patch?: number,
): void {
  if (mailboxBase === undefined || hash.mode === 'solo') return; // solo: no socket at all

  const panel = $('#room-panel') as HTMLElement;
  const codeEl = $('#room-code') as HTMLElement;
  panel.hidden = false;
  codeEl.textContent =
    hash.mode === 'host'
      ? 'Hosting…'
      : hash.mode === 'quick'
        ? 'Finding a game…'
        : hash.mode === 'daily'
          ? 'Joining the daily…'
          : `Joining ${hash.code}…`;

  const relay = new RelayClient();
  let bridge: Bridge | null = null;
  let director: Director | null = null;
  /** The director's own elimination handler, for `out`s this page makes itself. */
  let localOut: ((seat: number) => void) | null = null;
  let stopDirectorLoop: (() => void) | null = null;
  let isHost = false;
  /** The host's room settings between roster events (POK-241). */
  const controls: RoomControls = { fill: true, roster: null, textSpeed: 3, animations: true, fogSecs: 120 };

  /** `members` comes straight off the relay's roster event when there is one: the
   *  Bridge's own subscription may not have folded it into `bridge.roster` yet -- both
   *  listen to the same event, and this one was registered first -- and starting a
   *  match a seat short makes "N LEFT" wrong and hands the win to the wrong person. */
  const startDirector = (members?: number[]) => {
    if (director || !bridge || !isHost) return;
    const known = bridge.roster.all().map((e) => e.seat);
    const seats = [...new Set([...(members ?? []), ...known])];
    if (seats.length === 0) return;
    const hostSeat = bridge.seat;
    const seed = fixedSeed() ?? Math.floor(Math.random() * 0x7fff_ffff) + 1;
    const rom = createRomPushQueue(emu, bridge.mailbox); // reuses the Bridge's own Mailbox, not a second one on the same base
    // The ticker. The ROM has drawn the window since POK-226 and nothing had ever sent
    // it a line, so a match was silent: people vanished, the fog closed, somebody won,
    // and the only way to know was to be watching the right corner. The host narrates,
    // because the host is the one client that knows the whole match.
    const nameOf = (seat: number) => {
      const row = bridge!.roster.all().find((e) => e.seat === seat);
      return row?.name || `P${seat}`;
    };
    const say = (msg: TickerMsg | null) => {
      if (!msg) return;
      bridge!.relay.all(msg);
      rom.push(msg);
    };
    const seen = new Set<number>(); // seats already announced out, so a repeat is quiet
    // The host speaks for the bots as well as for the clock: same relay, same in-ring,
    // and its own roster too -- nobody hears their own messages come back, so the host
    // would otherwise be the one client that cannot see the bots it is walking.
    bots = startBots(
      (msg) => {
        bridge!.relay.all(msg);
        rom.push(msg);
        bridge!.roster.applyMsg(msg);
        loot.note(msg); // a bot taking a ball takes it off this page's table too
        if (msg.t === 'out') localOut?.(msg.seat);
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
        // bot has the same voice all match on every client that works it out.
        say(Ticker.said(winner, nameOf(winner), voiceFor(seed, winner).win));
        say(Ticker.said(loser, nameOf(loser), voiceFor(seed, loser).lose));
      },
      // Walking up to somebody is the other time a bot has something to say.
      (seat) => say(Ticker.said(seat, nameOf(seat), voiceFor(seed, seat).intro)),
      // How many bots the host is filling to (POK-241's FILL), held to what the room
      // has room for.
      botFill() === 0 ? 0 : Math.max(0, (controls.roster?.max ?? BOT_FILL) - seats.length),
    );
    director = new Director({
      // Bots are contestants, not scenery: leaving them out of the seat list makes
      // "N LEFT" a lie and hands the match to whoever outlasts the humans alone.
      seats: [...seats, ...bots.seats],
      options: paceOptions() ?? {
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
        rom.push(msg); // no-op for `win` -- createRomPushQueue only packs a msg.t crossesToRom() knows
        noteResult(msg); // the host's own `start`/`win` never come back to it over the relay
        if (msg.t === 'ring') bots?.setRing({ sx: msg.sx, sy: msg.sy, r: msg.r }, msg.phase);
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
        const off = bridge!.relay.on('recv', (ev) => {
          try {
            const m = decode(JSON.stringify(ev.m));
            if (m.t === 'out') narrate(m.seat);
          } catch {
            // not a wire.ts Msg at all, or failed validation -- bridge.ts already
            // counts this as a drop; nothing for the director to act on either way.
          }
        });
        return () => {
          localOut = null;
          off?.();
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
    director.start();
    const stopLoop = startDirectorLoop(emu, symbols?.get('gBrHud'), director);
    stopDirectorLoop = () => {
      stopLoop();
      rom.dispose();
      bots?.dispose();
      bots = null;
    };
  };

  const spectate = new Spectate();
  // The ROM only holds the loot for the map it is standing on, and forgets it on the
  // way out; the page holds the match's whole table and hands back the piece that
  // matters every time our own trainer arrives somewhere (POK-232).
  const loot = new Loot();
  let lootMap: string | null = null;
  const results = new Results();
  let fieldSize = 0;
  let recorded = false;
  // Everything that decides a placement crosses this page one way or the other: our
  // own ROM's `out` on the way up, everybody else's on the way in, and the host's own
  // `start`/`win` as it sends them.
  const noteResult = (msg: Msg) => {
    // A bot's fight runs in whoever challenged it: the result is how the host
    // learns it is over and the bot can walk again.
    if (msg.t === 'result') bots?.bots.noteResult(msg.seat);
    // Whoever fought a bot reports what it has left under the bot's own seat: the
    // host walks it, but only that ROM saw the fight.
    if (msg.t === 'party') bots?.bots.setParty(msg.seat, msg.mons);
    if (msg.t === 'start') {
      fieldSize = msg.spawns.length;
      results.start(fieldSize, performance.now());
      recorded = false;
    }
    results.note(msg, performance.now());
    if (msg.t === 'win' && bridge && !recorded) {
      recorded = true;
      const mine = results.forSeat(bridge.seat, performance.now());
      ($('#results-career') as HTMLElement).textContent = careerLine(recordMatch(mine.placement));
      renderResults(bridge, results, fieldSize);
    }
  };
  let stopSpectateLoop: (() => void) | null = null;
  let bots: ReturnType<typeof startBots> | null = null;

  const attach = (seat: number, code: string) => {
    if (bridge) bridge.dispose(); // a re-join after a reconnect must not leave two pumps on one ring
    console.info(`[room] attached as seat ${seat} in ${code}`);
    bridge = new Bridge({ emu, mailboxBase, relay, seat, protocol });
    isHost = hash.mode === 'host'; // known from our own hash, not worth waiting on a roster event
    codeEl.textContent = `Room ${code}`;
    renderRoom(bridge);
    const seatBase = symbols?.get('gBrMySeat');
    if (seatBase !== undefined) writeMySeat(emu, seatBase, seat);
    // And what our ghost looks like to everybody else, which the ROM stamps on every
    // `place` it sends (POK-243).
    const skinBase = symbols?.get('gBrMySkin');
    if (skinBase !== undefined) writeMySkin(emu, skinBase, careerSkin());
    // The gate on relay -> ROM: a bstart starts a replay, and it is a broadcast.
    bridge.setRomFilter((msg) => spectate.wantsFromRelay(msg));
    bridge.setOutObserver((msg) => {
      spectate.noteOutgoing(msg);
      loot.note(msg);
      noteResult(msg);
      noteBusy(msg);
      // Our own ROM's pick never comes back over the relay either.
      if (msg.t === 'pick' && director) {
        bridge!.pushToRom({ t: 'land', ...director.landFor(msg.seat, msg.section) });
      }
      // Our own ROM saying we are out. Nobody hears their own messages come back over
      // the relay, so without this the director never counts this client's own
      // elimination and the match it is running cannot reach a winner.
      if (msg.t === 'out') localOut?.(msg.seat);
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
    bridge.relay.on('recv', (ev) => {
      try {
        const m = decode(JSON.stringify(ev.m));
        loot.note(m);
        noteResult(m);
        noteBusy(m);
        // The drop (POK-223): a trainer chose a section, the host deals them a cell
        // inside it that nobody else has. Only the host answers -- everyone hears the
        // `pick`, and two answers would put two trainers on two different tiles.
        if (m.t === 'pick' && director) {
          const land = director.landFor(m.seat, m.section);
          if (m.seat === bridge!.seat) bridge!.pushToRom({ t: 'land', ...land });
          else bridge!.relay.to(m.seat, { t: 'land', ...land });
        }
        if (m.t === 'peek' && m.target === seat) {
          spectate.notePeek(m.seat, performance.now());
          // Their ROM answers the party; the fight so far is ours to hand over, since
          // the relay never delivered our bstart to somebody who was not in the room.
          for (const part of spectate.streamFor(seat)) bridge!.relay.to(m.seat, part);
        }
        else if (m.t === 'peek') {
          // A bot has no ROM to answer for it, so the host that walks it does.
          const party = bots?.partyFor(m.target);
          if (party) bridge!.relay.to(m.seat, party);
        }
        else if (m.t === 'result') spectate.noteResult(m.seat);
        else if (m.t === 'out') {
          bots?.bots.remove(m.seat); // a bot that is out stops being walked around
          renderSpectate(bridge!, spectate);
        }
      } catch {
        // bridge.ts already counted the drop; nothing to spectate about it either way.
      }
    });
    if (import.meta.env.DEV) {
      // The E2E drives a watch without a click: the strip only exists once you are out.
      const dev = (window as unknown as { __br?: Record<string, unknown> }).__br;
      if (dev) {
        dev.spectate = spectate;
        dev.watch = (target: number | null) => {
          for (const m of spectate.follow(target)) bridge!.pushToRom(m);
          renderSpectate(bridge!, spectate);
        };
      }
    }
    stopSpectateLoop?.();
    stopSpectateLoop = startSpectateLoop(emu, symbols?.get('gBrHud'), bridge, spectate);
    renderSpectate(bridge, spectate);
    if (isHost && autoStarts()) setTimeout(startDirector, AUTO_START_MS);
  };

  ($('#play-again') as HTMLElement).addEventListener('click', () => location.reload());

  relay.on('room_hosted', (ev) => attach(ev.id, ev.code));
  relay.on('room_joined', (ev) => attach(ev.id, ev.code));
  relay.on('roster', (ev) => {
    controls.roster = ev;
    // The buzzer, before the panel is drawn: a director created after the draw would
    // leave the host's controls on screen for the rest of the match.
    if (ev.members.length >= 2 && autoStarts()) startDirector(ev.members.map((m) => m.id));
    if (bridge) renderRoom(bridge);
    if (bridge) renderSpectate(bridge, spectate);
    if (bridge) {
      renderRoomPanel(controls, bridge.seat, relay, () => {
        // START: the host shuts the door and deals the match. This is what the
        // ten-second timer was standing in for.
        relay.lockRoom(true);
        startDirector(ev.members.map((m) => m.id));
        renderRoomPanel(controls, bridge!.seat, relay, () => {}, true);
      }, director !== null);
    }
  });
  relay.on('room_error', (ev) => {
    // Kanto's door: a room on another patch is not one you can play in, and the fix is
    // always the same -- get the build they have, which here means a reload.
    if (ev.reason === 'version') {
      const theirs = ev.host?.patch ?? '?';
      codeEl.textContent = `That room is on patch ${theirs}; you have ${patch ?? '?'}. Reload to update.`;
      return;
    }
    codeEl.textContent = `Couldn't join: ${ev.reason}`;
  });
  // QUICK PLAY found nothing to join: host one and let the bots fill it, which is what
  // Kanto does rather than leaving somebody looking at an empty list (POK-240).
  relay.on('no_open_rooms', () => {
    codeEl.textContent = 'No game going. Hosting one…';
    relay.host({ name: careerName(), open: true, max: BOT_FILL, skin });
  });
  // Everything open is mid-match: WATCH PLAY NEXT. Joining as a spectator gets you the
  // match now and a seat in the next one.
  relay.on('match_in_progress', (ev) => {
    if (!ev.code) return;
    codeEl.textContent = `Watching ${ev.code}…`;
    setRoomHash('join', ev.code);
    relay.join(ev.code, { name: careerName(), skin, spectate: true });
  });
  relay.on('closed', (ev) => {
    codeEl.textContent = `Disconnected: ${ev.reason}`;
    stopDirectorLoop?.();
    stopSpectateLoop?.();
  });

  const relayUrl = (import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL;
  relay.connect(relayUrl);
  // Open, because a room nobody can find is not a lobby (POK-240). JOIN BY CODE still
  // works for one that is not listed; that is what a passcode is for.
  const skin = String(careerSkin());
  // What we are running, so the relay's version gate can do its job (POK-244). Both
  // sides of a link battle must be on the same patch or the block exchange desyncs
  // silently -- and saying nothing means never being refused, which is the wrong end of
  // that trade once there is more than one patch in the world.
  const me = { name: careerName(), skin, patch, protocol };
  if (hash.mode === 'host') relay.host({ ...me, open: true, max: BOT_FILL });
  else if (hash.mode === 'quick') relay.quickJoin(me);
  else if (hash.mode === 'daily') relay.dailyJoin(me);
  else relay.join(hash.code!, { ...me, spectate: hash.mode === 'watch' });
}

// ---- the lobby (POK-240) -----------------------------------------------------------

/** How often the list refreshes. Kanto's lobby was a drawn room that redrew on a timer
 *  too; this is the same beat, and it is also what tells the relay somebody is
 *  browsing (its `browsedAt`, which its own stats read). */
const LOBBY_REFRESH_MS = 3000;

/** Kanto's one screen: every way into a match is a row on it. Resolves with the choice,
 *  having closed the browsing socket first -- SOLO VS BOTS must reach the ROM with no
 *  connection open, which is the whole point of it. */
function runLobby(): Promise<RoomHash> {
  showScreen('lobby');
  const fixed = $('#lobby-rows') as HTMLElement;
  const list = $('#lobby-rooms') as HTMLElement;
  const head = $('#lobby-rooms-head') as HTMLElement;
  const note = $('#lobby-note') as HTMLElement;
  const relay = new RelayClient();
  let online = false;
  let rooms: RoomListing[] = [];

  return new Promise<RoomHash>((resolve) => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const done = (hash: RoomHash) => {
      if (timer) clearInterval(timer);
      relay.close();
      resolve(hash);
    };

    const press = (action: LobbyAction) => {
      switch (action.kind) {
        case 'name': {
          const typed = cleanName(prompt('Your name? (7 characters)') ?? '');
          if (typed) saveProfile({ name: typed });
          render();
          return;
        }
        case 'skin':
          saveProfile({ skin: nextSkin(careerSkin()) });
          render();
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
          if (!/^[A-Z0-9]{4,8}$/.test(code)) {
            note.textContent = code ? `${code} is not a room code.` : '';
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

    const rowButton = (row: LobbyRow): HTMLLIElement => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.disabled = row.disabled === true;
      const label = document.createElement('span');
      label.textContent = row.label;
      btn.appendChild(label);
      if (row.detail) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = row.detail;
        btn.appendChild(sub);
      }
      btn.addEventListener('click', () => press(row.action));
      li.appendChild(btn);
      return li;
    };

    const render = () => {
      const career = loadCareer();
      fixed.replaceChildren(
        ...fixedRows(online, {
          name: careerName(),
          skin: SKINS[careerSkin()],
          record: career.matches > 0 ? careerLine(career) : 'your name',
        }).map(rowButton),
      );
      const roomList = roomRows(rooms);
      list.replaceChildren(...roomList.map(rowButton));
      head.hidden = roomList.length === 0;
      note.textContent = roomList.length === 0 ? emptyNote(online) : '';
    };

    relay.on('closed', () => {
      online = false;
      rooms = [];
      render();
    });
    relay.on('rooms', (ev) => {
      rooms = ev.rooms;
      render();
    });
    render();
    relay.connect((import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL);
    // There is no 'open' event to hang this on, so the refresh tick is also what
    // notices the socket came up. A short first beat so the list is not blank for
    // three seconds on a connection that was ready immediately.
    const beat = () => {
      const up = relay.isOpen();
      if (up !== online) {
        online = up;
        render();
      }
      if (up) relay.listRooms();
    };
    setTimeout(beat, 200);
    timer = setInterval(beat, LOBBY_REFRESH_MS);
  });
}

// ---- wiring -------------------------------------------------------------------------------

function wirePlayScreen(emu: Emulator): void {
  wireKeyboard(emu);
  for (const el of document.querySelectorAll<HTMLElement>('#pad .btn[data-key]')) {
    wireButton(el, el.dataset.key as GbaKey, emu);
  }
  wireDpad($('#dpad-surface') as HTMLElement, emu);
  wireSettings(emu);
  wireFps(emu);
}

async function main(): Promise<void> {
  setVersionLine('—');
  const canvas = $('#canvas') as HTMLCanvasElement;
  const emu = await Emulator.create(canvas);

  await runImportScreen(emu);
  const { bytes, usingPatched, mailboxBase, protocol, symbols, patch } = await runPatchingScreen(emu);

  showScreen('playing');
  if (usingPatched) await emu.startBytes(bytes);
  else await emu.start();

  // Dev only, for the e2e harness (POK-220): solo play never builds a Bridge, so this
  // is the only way in to read the emulator's memory from outside the page.
  if (import.meta.env.DEV) (window as unknown as { __hbr?: unknown }).__hbr = { emu };

  // Which way in decides the boot block -- solo warps straight into the Safari opening
  // (BR_BOOT_SAFARI) while a room waits in Littleroot (BR_BOOT_MAP) -- so the choice has
  // to be made before the ROM is told anything. A hash is that choice already made (a
  // deep link, a rejoin, a test); with no hash, the lobby is where it gets made.
  const roomHash = parseRoomHash() ?? (await runLobby());
  const wantsTestMon = import.meta.env.DEV && new URLSearchParams(location.hash.slice(1)).has('testmon');
  const bootMode =
    (roomHash.mode === 'solo' ? BR_BOOT_SAFARI : BR_BOOT_MAP) | (wantsTestMon ? BR_BOOT_FLAG_TESTMON : 0);

  // BrMailbox_Init zeroes the struct on the ROM's first frame, so the boot block has to
  // land after the magic appears, not before.
  if (mailboxBase !== undefined) {
    await waitForMailbox(emu, mailboxBase);
    writeBootBlock(emu, mailboxBase, careerName(), bootMode, careerSkin());
  }

  wirePlayScreen(emu);
  showScreen('playing');
  if (mailboxBase !== undefined && roomHash.mode === 'solo') runSolo(emu, mailboxBase, symbols);
  else wireRoom(emu, mailboxBase, protocol, symbols, roomHash, patch);
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('shell startup failed', err);
  showScreen('importing');
  const el = $('#import-error') as HTMLElement;
  el.textContent = `Startup failed: ${message}`;
  el.hidden = false;
});
