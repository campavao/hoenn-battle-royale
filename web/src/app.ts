// The web shell's state machine (POK-213): importing -> patching -> playing.
// Plain DOM, phone-first (see index.html for layout). Everything Emerald/GBA-specific
// goes through emu/index.ts's Emulator wrapper -- this file never touches the core
// directly, per the project CLAUDE.md.

import { KEY_BIT, Emulator, type GbaKey } from './emu';
import { checkEmerald, isPrePatched } from './rom/emerald';
import { loadRelease, loadSidecars, type ReleaseInfo } from './release';
import type { PatchWorkerRequest, PatchWorkerResponse } from './patch/bps.worker';
import { Mailbox, MAILBOX } from './net/mailbox';
import { RelayClient, type RoomListing, type RosterEvent } from './net/relay';
import { Bridge } from './net/bridge';
import { BR_CONT_FLAG, BR_MSG, crossesToRom, packSlot, reassembleSlots, unpackSlot, type BinarySlot } from './net/slots';
import { decode, type Msg, type PackedMon } from './net/wire';
import { encodeGen3 } from './text/gen3';
import { writeHudClockSecs, writeHudEyes, writeHudLeft, writeMySeat, writeMySkin } from './net/hud';
import { DEFAULT_SAFARI_SECS, Director, type DirectorState, type DirectorWorld } from './match/director';
import { Spectate } from './match/spectate';
import { Loot } from './match/loot';
import { Results } from './match/results';
import { Bots } from './bots/brain';
import { dealBots, MAX_SEATS } from './bots/roster';
import type { Bot } from './bots/roster';
import { nextVoice, voiceFor, voiceOf } from './bots/lines';
import * as Ticker from './match/ticker';
import { emptyNote, fixedRows, isRoomCode, roomRows, type LobbyAction, type LobbyRow } from './match/lobby';
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
  nextSafari,
  safariLabel,
} from './match/room';
import type { RosterEntry } from './match/roster';
import type { TickerMsg, MapRef } from './net/wire';
import { World, type WorldMap } from './bots/world';
import { sectionInside } from './match/ring';
import { dealParty, speciesName } from './bots/party';
import { MatchLog, saveMatch } from './match/log';
import { dealBag } from './bots/bag';
import { ProxyDuels } from './bots/proxy';
import { mulberry32 } from './match/clock';
import {
  careerLine,
  cleanName,
  loadCareer,
  nextLockedSkin,
  nextSkin,
  ordinal,
  recordMatch,
  saveProfile,
  SKINS,
} from './match/career';
import { loadStats, recordSolo, setStatsOff, statFlushed, statMessage } from './match/stats';
import worldData from './data/world.json';
import { LANDING } from './match/landing';
import { SAFARI_CELLS } from './match/safari';
import { cardFor } from './match/card';
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

/** The line under the buttons, when no pad has taken it over. */
const KEY_LEGEND =
  'Arrows move · Z = A · X = B · A = L · S = R · Enter = START · Shift = SELECT · a gamepad works too';

/** Half throw. A stick is not a D-pad and a resting one is never quite zero. */
const STICK = 0.5;
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
      pad.buttons.forEach((button, i) => {
        const key = gamepadMap[i];
        if (key && button.pressed) now.add(key);
      });
      const x = (pad.axes[0] ?? 0) - (base[0] ?? 0);
      const y = (pad.axes[1] ?? 0) - (base[1] ?? 0);
      if (x <= -STICK) now.add('left');
      else if (x >= STICK) now.add('right');
      if (y <= -STICK) now.add('up');
      else if (y >= STICK) now.add('down');
      // The tenth axis is where a DirectInput pad puts its D-pad. Only there, and
      // only on a pad that has one: a resting stick reads 0, which decodes to "down".
      if (pad.axes.length >= 10) for (const key of hatKeys(pad.axes[9])) now.add(key);
    }
    for (const key of now) if (!held.has(key)) emu.press(key);
    for (const key of held) if (!now.has(key)) emu.release(key);
    held = now;
    // What the pad is doing, on screen. A pad the page cannot see, a pad it has mapped
    // wrong and a pad with a stuck axis all look identical from the sofa; this is the
    // difference, and it is the line that would have found the stuck axis in seconds.
    if (padLine !== null) {
      const keys = [...held].join(' ');
      padLine.textContent = `${padName}${keys ? ` -- ${keys}` : ''}`;
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
    cancel = null;
    line.textContent = note;
    button.textContent = 'Remap pad';
  };

  const run = () => {
    const taken: Record<number, GbaKey> = {};
    let i = 0;
    const ask = () => {
      if (i >= REMAP_ORDER.length) {
        gamepadMap = taken;
        try {
          localStorage.setItem(REMAP_KEY, JSON.stringify(taken));
        } catch {
          // Private window or storage off: the mapping still holds for this session.
        }
        stop('Pad remapped.');
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
    try {
      localStorage.removeItem(REMAP_KEY);
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

/** The last team each seat was seen carrying, from any `party` that crossed this page.
 *  Kept for one thing (POK-243): the champion's own ROM sends its party as the parade
 *  starts, and the results screen is the shell's half of that parade. A `party` is
 *  otherwise an answer to a spectator's peek and belongs to whoever asked. */
const lastParty = new Map<number, PackedMon[]>();

/** The hidden instance that fights bot-vs-bot duels for real (POK-238). Module state
 *  rather than an argument because it is made at boot, long before there is a room, and
 *  only the host will ever ask it anything -- it boots its emulator lazily, on the first
 *  duel, so a page that never runs bots never pays for it. Null on an unpatched ROM,
 *  which has no BrDuel to talk to. */
let proxyDuels: ProxyDuels | null = null;

/** Which of the four trainer sprites is your ghost on everybody else's screen. */
function careerSkin(): number {
  return loadCareer().skin ?? 0;
}

/** Which voice (bots/lines.ts) this seat speaks with when its own duels get
 *  announced (POK-243). */
function careerVoice(): number {
  return loadCareer().voice ?? 0;
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
  // `watch=CODE` is a seat-less door into a room (POK-260): the mode has always been
  // in the type and in the join, and nothing ever produced it, so the one deep link a
  // spectator could use fell through to the lobby.
  const watch = params.get('watch');
  if (watch && /^[A-Za-z0-9]+$/.test(watch)) return { mode: 'watch', code: watch.toUpperCase() };
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

/** Set while this client is the one who may show somebody the door (POK-241).
 *
 *  Module state rather than an argument, because the roster is redrawn from two places
 *  -- the room screen, which knows, and the spectate loop, which does not -- and the
 *  loop's redraw every tick would otherwise quietly take the host's KICK away again. */
let roomKick: RelayClient | null = null;

/** The room, as everybody in it sees it. */
function renderRoom(bridge: Bridge): void {
  const canKick = roomKick !== null;
  const relay = roomKick;
  const list = $('#room-roster') as HTMLElement;
  const card = $('#trainer-card') as HTMLElement;
  list.innerHTML = '';
  for (const entry of bridge.roster.all()) {
    const li = document.createElement('li');
    const label = entry.name || `P${entry.seat}`;
    // A name is a button now (POK-268): Kanto's drawn lobby opens a trainer's card on
    // A, and this is the same idea in the shape this front end has.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'roster-name';
    button.textContent = `${label}${entry.isMe ? ' (you)' : ''}${entry.alive ? '' : ' -- OUT'}`;
    button.addEventListener('click', () => {
      if (card.dataset.seat === String(entry.seat) && !card.hidden) {
        card.hidden = true;
        card.dataset.seat = '';
        return;
      }
      const mapId = entry.map ? mapIdOf(entry.map) : undefined;
      card.innerHTML = '';
      for (const line of cardFor(entry, mapId)) {
        const row = document.createElement('div');
        row.className = 'card-line';
        row.textContent = line.label ? `${line.label}: ${line.value}` : line.value;
        card.appendChild(row);
      }
      // The host's one power over another seat, and it lives on the card rather than
      // as a row of buttons beside every name (POK-241).
      if (canKick && relay && !entry.isMe) {
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
  // A card left open on somebody who has gone is a card about nobody.
  if (card.dataset.seat && !bridge.roster.all().some((e) => String(e.seat) === card.dataset.seat)) {
    card.hidden = true;
    card.dataset.seat = '';
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
  const safari = $('#room-safari') as HTMLButtonElement;
  max.textContent = `MAX ${view.max}`;
  fill.textContent = view.fill > 0 ? `FILL ${view.fill}` : 'FILL OFF';
  door.textContent = { open: 'LISTED', private: 'UNLISTED', pass: 'PASSCODE' }[doorOf(view)];
  start.disabled = !canStart(view);
  text.textContent = `TEXT ${textSpeedLabel(controls.textSpeed)}`;
  anim.textContent = controls.animations ? 'ANIM ON' : 'ANIM OFF';
  fog.textContent = `FOG ${controls.fogSecs}s`;
  safari.textContent = safariLabel(controls.safariSecs);

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
  // How long the opening lasts, including not at all (POK-241). Zero is Kanto's own
  // escape hatch: no Safari, straight to a dealt drop.
  safari.onclick = () => {
    controls.safariSecs = nextSafari(controls.safariSecs);
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
  where: (seat: number) => { map: MapRef; x: number; y: number } | undefined;
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
      bagAt: (key) => loot.bagAt(key),
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
    // Two bots meeting is fought for real in the hidden instance when there is one
    // (POK-238); `duel.ts`'s seeded resolver is what answers when there is not.
    settle: proxyDuels
      ? (a, b) => (proxyDuels as ProxyDuels).fight(a, b)
      : undefined,
    // Where the bot is standing is where its mons came from (POK-237): the drop put
    // it on a route, and that route's own table is what a trainer there would have.
    deal: (bot, atPhase, mapId) => dealParty(seed, bot.seat, atPhase, mapId, bot.grade),
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
      .map((b) => {
        const at = r.where(b.seat);
        const mapId = at ? idByRef.get(`${at.map.group}:${at.map.num}`) : undefined;
        return at && mapId ? { ...b, map: at.map, mapId, x: at.x, y: at.y } : b;
      });
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
  const id = setInterval(() => bots.tick(performance.now()), BOT_TICK_MS);
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
function renderResults(bridge: Bridge, results: Results, seats: number, seed?: number): void {
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
  // The seed last, because it is the question anybody asks about a round afterwards
  // and the round is written down under it (POK-248, match/log.ts).
  if (seed !== undefined) parts.push(`seed ${seed}`);
  ($('#results-line') as HTMLElement).textContent = parts.join(' · ');
  renderFame(bridge, mine.winner);
}

/** The champion's team under the result (POK-243, Kanto's Hall of Fame parade). The
 *  ROM's own parade runs on the winner's screen; everybody else gets this, which is
 *  the only place the room ever sees what actually took the match. Silent when the
 *  champion's `party` never arrived -- a bot's never does, since a bot has no ROM to
 *  send one. */
function renderFame(bridge: Bridge, winner: number | undefined): void {
  const el = $('#results-fame') as HTMLElement;
  const party = winner === undefined ? undefined : lastParty.get(winner);

  if (winner === undefined || !party || party.length === 0) {
    el.hidden = true;
    return;
  }
  const who = winner === bridge.seat ? 'YOUR TEAM' : `${bridge.roster.get(winner)?.name || `P${winner}`}'S TEAM`;
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
const DIRECTOR_TICK_MS = 1000; // coarser than the 5s clock/fogSecs cadence director.ts needs

/** The same strip, for a client that is not running the match (POK-268). The host's is
 *  drawn by the director's own loop, so until now RING / N LEFT / the clock appeared on
 *  exactly one page in the room and everybody else had to read their ROM's corner.
 *
 *  Everything here arrived in messages every client hears -- which is the same reason a
 *  promoted host can pick a match up mid-flight (POK-252). */
function renderGuestStrip(
  bridge: Bridge,
  match: { ringPhase: number; ringR: number; centre?: { place?: string }; clockLeft: number; clockAt: number; seed: number },
  now: number,
): void {
  const strip = $('#match-strip') as HTMLElement;
  // A watcher arrives mid-match and never hears the START, so the seed is not the test
  // for "is there a match": what it has is the late burst the host sent it, a ring and
  // a clock (POK-260).
  if (match.seed === 0 && match.ringPhase === 0 && match.clockLeft === 0) {
    strip.hidden = true;
    return;
  }
  ($('#room-panel') as HTMLElement).hidden = false;
  strip.hidden = false;
  // The CLOCK lands every five seconds; the seconds in between are counted off here,
  // the same way the ROM counts them off against its own frame timer.
  const gone = Math.floor(Math.max(0, now - match.clockAt) / 1000);
  const left = Math.max(0, match.clockLeft - gone);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const alive = bridge.roster.all().filter((e) => e.alive).length;
  const phaseLabel =
    match.ringPhase <= 0 ? 'SAFARI' : `RING ${match.ringR} (${match.centre?.place ?? '?'})`;
  // A watcher's roster fills up as people move, so "0 left" is only ever "nobody has
  // moved yet" -- say nothing rather than something wrong.
  const standing = alive > 0 ? ` · ${alive} left` : '';
  strip.textContent = `${phaseLabel}${standing} · ${mm}:${ss}`;
}

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
  // The relay cannot see this: no socket opens for solo play, ever (that is the whole
  // point of the mode). The count rides along on whatever real connection comes next
  // (POK-243, match/stats.ts) -- a local bump now, nothing that touches the network.
  recordSolo();
  const mailbox = new Mailbox(emu, mailboxBase);
  const rom = createRomPushQueue(emu, mailbox);
  const seatBase = symbols?.get('gBrMySeat');
  if (seatBase !== undefined) writeMySeat(emu, seatBase, 0);

  let out: ((seat: number) => void) | null = null;
  const log = new MatchLog();
  const director = new Director({
    seats: [0],
    // `#quick` is a dev pace, and solo is where a change gets looked at first -- it had
    // no way to ask for it, so every solo look cost the full two-minute opening.
    options: paceOptions(),
    hostSeat: 0,
    seed: Math.floor(Math.random() * 0x7fff_ffff) + 1,
    world: WORLD,
    send: (msg) => {
      rom.push(msg);
      // Solo rounds are written down too (POK-248): a match nobody else saw is the
      // one whose seed is hardest to come by afterwards.
      log.note(msg, performance.now());
      if (msg.t === 'win') {
        const round = log.current(performance.now());
        if (round) saveMatch(round);
      }
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
  emu.onFrame(() => {
    if (mailbox.isAwake()) drainRom(mailbox, fromRom);
  });
}

/** Everything the ROM has pushed since the last frame, as wire.ts messages: the same
 *  poll -> regroup -> reassemble -> unpack that bridge.ts does on its way to the relay,
 *  for the callers that have no relay to send it to. */
function drainRom(mailbox: Mailbox, handle: (msg: Msg) => void): void {
  const raw = mailbox.poll();
  let i = 0;
  while (i < raw.length) {
    // A message is a base slot followed by its BR_CONT_FLAG continuations.
    const group: BinarySlot[] = [raw[i++]];
    while (i < raw.length && (raw[i].type & BR_CONT_FLAG) !== 0) group.push(raw[i++]);
    try {
      const done = reassembleSlots(group);
      if (done.type === BR_MSG.NONE || done.type === BR_MSG.ECHO) continue;
      handle(unpackSlot(done.type, done.payload));
    } catch {
      // A gap or a slot that is not a message we know: the ROM does not resend, and
      // there is nothing here to act on either way.
    }
  }
}

// ---- room: relay + bridge, opted into by the URL hash ------------------------------------

/** Drops the room out of the URL and reloads, which lands on the lobby (parseRoomHash
 *  returns null with no room in the hash). The way out of anywhere. */
function backToLobby(): void {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const k of ['host', 'join', 'quick', 'solo', 'daily']) params.delete(k);
  const rest = params.toString().replace(/=(?=&|$)/g, '');
  location.hash = rest;
  location.reload();
}

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
  const controls: RoomControls = {
    fill: true, roster: null, textSpeed: 3, animations: true, fogSecs: 120,
    safariSecs: DEFAULT_SAFARI_SECS,
  };

  /** `members` comes straight off the relay's roster event when there is one: the
   *  Bridge's own subscription may not have folded it into `bridge.roster` yet -- both
   *  listen to the same event, and this one was registered first -- and starting a
   *  match a seat short makes "N LEFT" wrong and hands the win to the wrong person. */
  const startDirector = (members?: number[], takeOver = false) => {
    if (director || !bridge || !isHost) return;
    const known = bridge.roster.all().map((e) => e.seat);
    // Watchers are in the room but not in the match (POK-260). Seating one deals it a
    // drop it will never take and counts it among the living, so the match cannot
    // reach a winner -- a spectator never counts, which is Kanto's rule too.
    const watching = new Set((controls.roster?.members ?? []).filter((m) => m.spectate).map((m) => m.id));
    const seats = [...new Set([...(members ?? []), ...known])].filter((seat) => !watching.has(seat));
    if (seats.length === 0) return;
    const hostSeat = bridge.seat;
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
              ? { map: row.map, x: row.x, y: row.y }
              : undefined;
          },
        }
      : undefined;
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
    // The seed's voice for anyone, except this client's own seat, which speaks with
    // whatever its profile picked (POK-243) -- see the onDuel/onEngage callbacks below.
    const myVoice = (seat: number, matchSeed: number) =>
      seat === bridge!.seat ? voiceOf(careerVoice()) : voiceFor(matchSeed, seat);
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
      botFill() === 0 ? 0 : Math.max(0, (controls.roster?.max ?? BOT_FILL) - seats.length),
      resume,
      paceOptions()?.safariSecs ?? controls.safariSecs,
    );
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
        rom.push(msg); // no-op for `win` -- createRomPushQueue only packs a msg.t crossesToRom() knows
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
    if (takeOver) {
      // The old host's tab went away and the relay handed us the room (POK-252).
      // Everybody already has a `start`, a drop and a ring, so dealing again would
      // restart the match under them: pick up what the wire already said instead.
      director.resume({
        ringPhase: match.ringPhase,
        centre: match.centre,
        secsLeftInPhase: match.clockLeft,
        out: [...match.out, ...gone],
      });
      // And the room is told about the ones who walked out, so every roster agrees
      // with the count this page is now keeping.
      for (const seat of gone) {
        bridge!.relay.all({ t: 'out', seat });
        rom.push({ t: 'out', seat });
        bridge!.roster.applyMsg({ t: 'out', seat });
      }
      say(Ticker.said(hostSeat, nameOf(hostSeat), 'I HAVE THE CLOCK.'));
    } else {
      director.start();
    }
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
  /** Everything a promoted client needs to pick the match up (POK-252). All of it
   *  arrives in messages every client hears, so a guest is always ready to take over
   *  without anybody having sent it anything special. */
  const match = {
    seed: 0,
    seats: [] as number[],
    ringPhase: 0,
    centre: undefined as { sx: number; sy: number; place?: string } | undefined,
    /** The ring's radius, for the strip a guest draws for itself (POK-268). */
    ringR: 0,
    clockLeft: 0,
    /** When that clockLeft arrived, so the seconds between the five-second CLOCKs can
     *  be counted off locally rather than standing still. */
    clockAt: 0,
    out: new Set<number>(),
  };
  let fieldSize = 0;
  let recorded = false;
  const log = new MatchLog();
  // Everything that decides a placement crosses this page one way or the other: our
  // own ROM's `out` on the way up, everybody else's on the way in, and the host's own
  // `start`/`win` as it sends them.
  const noteResult = (msg: Msg) => {
    // The match, as anybody in the room can see it.
    if (msg.t === 'start') {
      match.seed = msg.seed;
      match.seats = msg.spawns.map((s) => s.seat);
    } else if (msg.t === 'ring') {
      match.ringPhase = msg.phase;
      match.centre = { sx: msg.sx, sy: msg.sy, place: msg.place };
      match.ringR = msg.r;
      match.clockLeft = 0;
      match.clockAt = performance.now();
    } else if (msg.t === 'clock') {
      match.clockLeft = msg.left;
      match.clockAt = performance.now();
    } else if (msg.t === 'out') {
      match.out.add(msg.seat);
    }
    // A bot's fight runs in whoever challenged it: the result is how the host
    // learns it is over and the bot can walk again.
    if (msg.t === 'result') bots?.bots.noteResult(msg.seat);
    // Whoever fought a bot reports what it has left under the bot's own seat: the
    // host walks it, but only that ROM saw the fight.
    if (msg.t === 'party') {
      bots?.bots.setParty(msg.seat, msg.mons);
      lastParty.set(msg.seat, msg.mons);
      // The champion's own party arrives after the `win` that put the results on
      // screen -- their ROM sends it as the parade starts (POK-243) -- so the panel
      // is drawn again rather than waiting for a team that came too late.
      if (recorded && bridge) renderResults(bridge, results, fieldSize, match.seed);
    }
    // And what it spent out of its bag in there (POK-237), for the same reason: the
    // host walks the bot, but only the ROM that fought it saw the items go.
    if (msg.t === 'spent') bots?.bots.noteSpent(msg.seat, msg.items);
    if (msg.t === 'start') {
      fieldSize = msg.spawns.length;
      results.start(fieldSize, performance.now());
      recorded = false;
    }
    results.note(msg, performance.now());
    // ...and the round is written down as it happens (POK-248). The same messages
    // placement is derived from, kept in a shape the round can be read back from.
    log.note(msg, performance.now(), (seat) => bridge?.roster.get(seat)?.name || `P${seat}`);
    // The match is over: the door opens again (POK-258). START locked the room to keep
    // latecomers out of a running match, and leaving it locked is what turned the end
    // of a match into everybody scattering -- a reload could not get back in.
    if (msg.t === 'win' && director) relay.lockRoom(false);
    if (msg.t === 'win' && bridge && !recorded) {
      recorded = true;
      const round = log.current(performance.now());
      if (round) saveMatch(round);
      const mine = results.forSeat(bridge.seat, performance.now());
      ($('#results-career') as HTMLElement).textContent = careerLine(recordMatch(mine.placement));
      renderResults(bridge, results, fieldSize, match.seed);
    }
  };
  let stopSpectateLoop: (() => void) | null = null;
  let stopGuestStrip: (() => void) | null = null;
  /** In the room to look, not to play (POK-260). Set when this client asks to watch,
   *  and reasserted from the relay's own roster, which is the authority on it. */
  let amWatching = false;
  /** Seats this client has already caught up on the running match. */
  const greeted = new Set<number>();
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
    // Willing to run the match if the host's tab goes away (POK-252). Every client
    // says this the moment it has a ROM and a seat; the relay promotes the
    // longest-standing one that has. Nobody ever said it before, so `heirOf` never
    // found anybody and a host leaving closed the room on everybody in it.
    relay.canHost(true);
    // The gate on relay -> ROM: a bstart starts a replay, and it is a broadcast.
    bridge.setRomFilter((msg) => spectate.wantsFromRelay(msg));
    // A watcher is furniture: its ROM is walking around Littleroot and nobody in the
    // match should see a ghost of it, or hear it claim a seat (POK-260).
    bridge.setOutFilter(() => !amWatching);
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
      if (msg.t === 'out') {
        localOut?.(msg.seat);
        // And we withdraw from the succession: a trainer who is out should not be the
        // one still running the match everybody else is in (POK-252).
        if (msg.seat === bridge?.seat && !director) relay.canHost(false);
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
    bridge.relay.on('recv', (ev) => {
      try {
        const m = decode(JSON.stringify(ev.m));
        // What the trainer we are watching just took (POK-268). Drawn here rather than
        // sent: a `pickup` reaches the whole room, and only the page following that
        // seat has any business saying so. The describe() has to happen before the
        // loot table forgets the piece, which loot.note() does on this same message.
        if (m.t === 'pickup' && bridge && spectate.watchingSeat() === m.seat) {
          const what = loot.describe(m.key);
          const row = bridge.roster.all().find((e) => e.seat === m.seat);
          const line = what ? Ticker.took(m.seat, row?.name || `P${m.seat}`, what) : null;
          if (line) bridge.pushToRom(line);
        }
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
    stopSpectateLoop = startSpectateLoop(emu, symbols?.get('gBrHud'), bridge, spectate);
    // A second's cadence, like the director's own loop. It stands down the moment this
    // client becomes the one running the match, which draws the real one.
    stopGuestStrip?.();
    const guestStrip = setInterval(() => {
      if (!director && bridge) renderGuestStrip(bridge, match, performance.now());
    }, 1000);
    stopGuestStrip = () => clearInterval(guestStrip);
    renderSpectate(bridge, spectate);
    if (isHost && autoStarts()) setTimeout(startDirector, AUTO_START_MS);
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
  const leave = $('#room-leave') as HTMLButtonElement;
  leave.hidden = true;
  leave.addEventListener('click', () => backToLobby());

  const playAgainButton = $('#play-again') as HTMLButtonElement;
  playAgainButton.addEventListener('click', () => {
    void (async () => {
      playAgainButton.disabled = true;
      try {
        stopDirectorLoop?.();
        stopDirectorLoop = null;
        director = null;
        await emu.reboot();
        if (mailboxBase !== undefined) {
          await waitForMailbox(emu, mailboxBase);
          writeBootBlock(emu, mailboxBase, careerName(), BR_BOOT_MAP, careerSkin());
        }
        recorded = false;
        // Whoever we were watching is not in a match any more.
        for (const m of spectate.follow(null)) bridge?.pushToRom(m);
        ($('#results-panel') as HTMLElement).hidden = true;
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
        playAgainButton.disabled = false;
      }
    })();
  });

  relay.on('room_hosted', (ev) => attach(ev.id, ev.code));
  relay.on('room_joined', (ev) => attach(ev.id, ev.code));
  relay.on('roster', (ev) => {
    controls.roster = ev;
    // Who may kick, for every redraw between now and the next roster event.
    roomKick = ev.host === bridge?.seat ? relay : null;
    // The relay says who is watching; believe it over what we asked for.
    if (bridge) amWatching = ev.members.some((m) => m.id === bridge!.seat && m.spectate === true);
    // Promoted. The relay moves `host` on the roster and says nothing else about it
    // (POK-252), so this is where a guest finds out it is now running the match.
    if (bridge && ev.host === bridge.seat && !isHost) {
      isHost = true;
      console.info('[room] promoted to host');
      startDirector(ev.members.map((m) => m.id), match.seed !== 0);
    }
    // Somebody arrived while the match is running: tell them where the fog is, now
    // (POK-260). Kanto calls this the late start -- a watcher who has to wait for the
    // next ring to learn the state spends up to two minutes looking at nothing.
    if (director && bridge) {
      const state = director.state;
      for (const m of ev.members) {
        if (m.id === bridge.seat || greeted.has(m.id)) continue;
        greeted.add(m.id);
        if (!state.ring) continue;
        relay.to(m.id, {
          t: 'ring',
          seat: bridge.seat,
          phase: state.ring.phase,
          sx: state.ring.sx,
          sy: state.ring.sy,
          r: state.ring.r,
          place: state.ring.place,
        });
        relay.to(m.id, { t: 'clock', seat: bridge.seat, left: state.clockLeft });
      }
    }
    // The buzzer, before the panel is drawn: a director created after the draw would
    // leave the host's controls on screen for the rest of the match.
    if (ev.members.length >= 2 && autoStarts()) startDirector(ev.members.map((m) => m.id));
    if (bridge) renderRoom(bridge);
    leave.hidden = isHost;
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
  relay.on('room_error', (ev) => {
    // Kanto's door: a room on another patch is not one you can play in, and the fix is
    // always the same -- get the build they have, which here means a reload.
    if (ev.reason === 'version') {
      const theirs = ev.host?.patch ?? '?';
      codeEl.textContent = `That room is on patch ${theirs}; you have ${patch ?? '?'}. Reload to update.`;
      return;
    }
    // A door that will not open is a dead end unless the page says where else to go.
    // `locked` is the common one: a room mid-match, which is exactly what you rejoin
    // if you reload an old link.
    const FATAL = ['locked', 'full', 'not_found', 'removed', 'passcode', 'server_full'];
    codeEl.textContent = `Couldn't join: ${ev.reason}`;
    if (FATAL.includes(ev.reason)) {
      const note = $('#room-note') as HTMLElement;
      note.textContent = '';
      const back = document.createElement('button');
      back.type = 'button';
      back.textContent = 'BACK TO LOBBY';
      back.addEventListener('click', () => backToLobby());
      note.appendChild(back);
    }
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
    amWatching = true;
    relay.join(ev.code, { name: careerName(), skin, spectate: true });
  });
  relay.on('closed', (ev) => {
    codeEl.textContent = `Disconnected: ${ev.reason}`;
    stopDirectorLoop?.();
    stopSpectateLoop?.();
  });

  // A hidden tab gets its timers throttled, and on the host those timers ARE the
  // match: the director's clock and the bots' walking both ride setInterval. Nothing
  // breaks -- the clock is wall-clock and catches up on return -- but the match
  // freezes and then lurches for everybody, and only the host can do anything about
  // it (POK-247).
  //
  // The page cannot tell them while it is hidden, so the title does: it is the one
  // thing a backgrounded tab still shows. On the way back, the room's own line says
  // how long everybody was waiting.
  const baseTitle = document.title;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (!director) return;
    const note = $('#room-note') as HTMLElement;
    if (document.hidden) {
      hiddenAt = performance.now();
      document.title = `PAUSED - ${baseTitle}`;
      return;
    }
    document.title = baseTitle;
    const secs = Math.round((performance.now() - hiddenAt) / 1000);
    note.textContent =
      hiddenAt > 0 && secs >= 2
        ? `This tab was hidden for ${secs}s -- you are the host, so the match was waiting on it.`
        : '';
    hiddenAt = 0;
  });

  const relayUrl = (import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL;
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
        case 'skin': {
          const career = loadCareer();
          saveProfile({ skin: nextSkin(career.skin ?? 0, career.wins) });
          render();
          return;
        }
        case 'voice':
          saveProfile({ voice: nextVoice(careerVoice()) });
          render();
          return;
        case 'stats':
          setStatsOff(!loadStats().off);
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
          // The relay never issues 0/O/1/I/L -- they read alike at a glance -- so a
          // code with one of those in it, or the wrong length, could not be real
          // (POK-240). Catching that here beats waiting on the relay's `not_found`.
          if (!isRoomCode(code)) {
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
      const locked = nextLockedSkin(career.wins);
      fixed.replaceChildren(
        ...fixedRows(online, {
          name: careerName(),
          skin: SKINS[careerSkin()],
          skinNote: locked ? `${SKINS[locked.skin]} at ${locked.wins} wins` : 'your sprite',
          voice: voiceOf(careerVoice()).win,
          statsOn: !loadStats().off,
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
  wireGamepad(emu);
  wireRemap();
  for (const el of document.querySelectorAll<HTMLElement>('#pad .btn[data-key]')) {
    wireButton(el, el.dataset.key as GbaKey, emu);
  }
  wireDpad($('#dpad-surface') as HTMLElement, emu);
  wireSettings(emu);
  wireFps(emu);
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

async function main(): Promise<void> {
  registerServiceWorker();
  void askToKeepStorage();
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

  // The proxy's own instance is not booted here -- only made available. It costs a
  // second wasm core and a second copy of the ROM, so it is paid for on the first bot
  // -vs-bot meeting, in the one tab that runs the bots (POK-238).
  if (usingPatched && mailboxBase !== undefined) {
    proxyDuels = new ProxyDuels({
      mailboxBase,
      boot: async () => {
        const hidden = document.createElement('canvas');
        hidden.width = 240;
        hidden.height = 160;
        const other = await Emulator.create(hidden);
        await other.startBytes(bytes);
        other.setVolume(0); // it is not on screen and it is not to be heard
        other.setSpeed(8); // ...and it is in a hurry: a duel is a fight nobody watches
        return other;
      },
      writeBoot: (e, base) => writeBootBlock(e as Emulator, base, PROXY_NAME),
      onNote: (what) => console.info('[proxy]', what),
    });
  }

  // Input first, and before anything that waits: the wiring used to sit after the
  // mailbox handshake and the lobby, so between the ROM starting and the match being
  // chosen there was a running game that answered to nothing at all.
  wirePlayScreen(emu);

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
