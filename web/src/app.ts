// The web shell's state machine (POK-213): importing -> patching -> playing.
// Plain DOM, phone-first (see index.html for layout). Everything Emerald/GBA-specific
// goes through emu/index.ts's Emulator wrapper -- this file never touches the core
// directly, per the project CLAUDE.md.

import { Emulator, type GbaKey } from './emu';
import { checkEmerald, isPrePatched } from './rom/emerald';
import { loadRelease, loadSidecars, type ReleaseInfo } from './release';
import type { PatchWorkerRequest, PatchWorkerResponse } from './patch/bps.worker';
import { Mailbox, MAILBOX } from './net/mailbox';
import { RelayClient } from './net/relay';
import { Bridge } from './net/bridge';
import { crossesToRom, packSlot, type BinarySlot } from './net/slots';
import { decode, type Msg } from './net/wire';
import { encodeGen3 } from './text/gen3';
import { writeHudClockSecs, writeHudEyes, writeHudLeft, writeMySeat } from './net/hud';
import { Director, type DirectorState, type DirectorWorld } from './match/director';
import { Spectate } from './match/spectate';
import { Loot } from './match/loot';
import worldData from './data/world.json';
import landingData from './data/landing.json';
import regionmapData from './data/regionmap.json';

// The world data the director deals spawns and picks ring centres from (POK-223/224).
// Cast rather than re-declared: these three JSON files are the exporter's own output
// (DESIGN.md §6), and director.ts only reads the handful of fields it documents on
// `DirectorMapEntry`/`LandingCell`/`RegionSection` -- a wider real shape satisfies it.
const WORLD: DirectorWorld = {
  maps: worldData.maps as DirectorWorld['maps'],
  landing: landingData as DirectorWorld['landing'],
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
const LITTLEROOT = { group: 0, num: 9, x: 5, y: 8 };

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

type Screen = 'importing' | 'patching' | 'playing';
const SCREENS: Screen[] = ['importing', 'patching', 'playing'];

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
  return localStorage.getItem(NAME_STORAGE_KEY) || DEFAULT_NAME;
}

/** Writes gBrMailbox.boot so a fresh game skips the intro/Birch/naming screens and
 *  is already standing in Littleroot -- every driver's own trick (project CLAUDE.md),
 *  used here so a match (or solo play) starts the same way. The ROM clears `mode`
 *  once it has consumed the block. */
function writeBootBlock(emu: Emulator, mailboxBase: number, name: string, mode: number = BR_BOOT_MAP): void {
  const boot = mailboxBase + MAILBOX.OFF_BOOT;
  emu.write(boot + 0, mode, 8);
  emu.write(boot + 1, MALE, 8);
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
  mode: 'host' | 'join';
  code?: string;
}

/** `#host` hosts a room; `#join=CODE` joins one; no hash at all is solo play with no
 *  socket opened (Kanto's rule, project CLAUDE.md). */
function parseRoomHash(): RoomHash | null {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('host')) return { mode: 'host' };
  const code = params.get('join');
  return code && /^[A-Za-z0-9]+$/.test(code) ? { mode: 'join', code: code.toUpperCase() } : null;
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
    if (hudBase !== undefined) writeHudEyes(emu, hudBase, spectate.eyes(now));
  }, SPECTATE_TICK_MS);
  return () => clearInterval(id);
}

// ---- the match director's page-side wiring (POK-222/223/224/228) ------------------------

const AUTO_START_MS = 10_000; // "for now": a room starts 10s after hosting, or once 2+ seats
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
): void {
  const hash = parseRoomHash();
  if (!hash || mailboxBase === undefined) return; // solo: no socket at all

  const panel = $('#room-panel') as HTMLElement;
  const codeEl = $('#room-code') as HTMLElement;
  panel.hidden = false;
  codeEl.textContent = hash.mode === 'host' ? 'Hosting…' : `Joining ${hash.code}…`;

  const relay = new RelayClient();
  let bridge: Bridge | null = null;
  let director: Director | null = null;
  let stopDirectorLoop: (() => void) | null = null;
  let isHost = false;

  const startDirector = () => {
    if (director || !bridge || !isHost) return;
    const seats = bridge.roster.all().map((e) => e.seat);
    if (seats.length === 0) return;
    const hostSeat = bridge.seat;
    const rom = createRomPushQueue(emu, bridge.mailbox); // reuses the Bridge's own Mailbox, not a second one on the same base
    director = new Director({
      seats,
      hostSeat,
      seed: Math.floor(Math.random() * 0x7fff_ffff) + 1,
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
      },
      now: () => performance.now(),
      onOut: (handler) =>
        bridge!.relay.on('recv', (ev) => {
          try {
            const m = decode(JSON.stringify(ev.m));
            if (m.t === 'out') handler(m.seat);
          } catch {
            // not a wire.ts Msg at all, or failed validation -- bridge.ts already
            // counts this as a drop; nothing for the director to act on either way.
          }
        }),
    });
    director.start();
    const stopLoop = startDirectorLoop(emu, symbols?.get('gBrHud'), director);
    stopDirectorLoop = () => {
      stopLoop();
      rom.dispose();
    };
  };

  const spectate = new Spectate();
  // The ROM only holds the loot for the map it is standing on, and forgets it on the
  // way out; the page holds the match's whole table and hands back the piece that
  // matters every time our own trainer arrives somewhere (POK-232).
  const loot = new Loot();
  let lootMap: string | null = null;
  let stopSpectateLoop: (() => void) | null = null;

  const attach = (seat: number, code: string) => {
    if (bridge) bridge.dispose(); // a re-join after a reconnect must not leave two pumps on one ring
    console.info(`[room] attached as seat ${seat} in ${code}`);
    bridge = new Bridge({ emu, mailboxBase, relay, seat, protocol });
    isHost = hash.mode === 'host'; // known from our own hash, not worth waiting on a roster event
    codeEl.textContent = `Room ${code}`;
    renderRoom(bridge);
    const seatBase = symbols?.get('gBrMySeat');
    if (seatBase !== undefined) writeMySeat(emu, seatBase, seat);
    // The gate on relay -> ROM: a bstart starts a replay, and it is a broadcast.
    bridge.setRomFilter((msg) => spectate.wantsFromRelay(msg));
    bridge.setOutObserver((msg) => {
      spectate.noteOutgoing(msg);
      loot.note(msg);
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
        if (m.t === 'peek' && m.target === seat) {
          spectate.notePeek(m.seat, performance.now());
          // Their ROM answers the party; the fight so far is ours to hand over, since
          // the relay never delivered our bstart to somebody who was not in the room.
          for (const part of spectate.streamFor(seat)) bridge!.relay.to(m.seat, part);
        }
        else if (m.t === 'result') spectate.noteResult(m.seat);
        else if (m.t === 'out') renderSpectate(bridge!, spectate);
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
    if (isHost) setTimeout(startDirector, AUTO_START_MS);
  };

  relay.on('room_hosted', (ev) => attach(ev.id, ev.code));
  relay.on('room_joined', (ev) => attach(ev.id, ev.code));
  relay.on('roster', (ev) => {
    if (bridge) renderRoom(bridge);
    if (bridge) renderSpectate(bridge, spectate);
    if (ev.members.length >= 2) startDirector();
  });
  relay.on('room_error', (ev) => (codeEl.textContent = `Couldn't join: ${ev.reason}`));
  relay.on('closed', (ev) => {
    codeEl.textContent = `Disconnected: ${ev.reason}`;
    stopDirectorLoop?.();
    stopSpectateLoop?.();
  });

  const relayUrl = (import.meta.env.VITE_RELAY_URL as string | undefined) || DEFAULT_RELAY_URL;
  relay.connect(relayUrl);
  if (hash.mode === 'host') relay.host({ name: careerName(), open: false });
  else relay.join(hash.code!, { name: careerName() });
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
  const { bytes, usingPatched, mailboxBase, protocol, symbols } = await runPatchingScreen(emu);

  showScreen('playing');
  if (usingPatched) await emu.startBytes(bytes);
  else await emu.start();

  // Dev only, for the e2e harness (POK-220): solo play never builds a Bridge, so this
  // is the only way in to read the emulator's memory from outside the page.
  if (import.meta.env.DEV) (window as unknown as { __hbr?: unknown }).__hbr = { emu };

  // No hash at all is solo (project CLAUDE.md's rule, app.ts's own parseRoomHash) --
  // decided before the boot block, since solo warps straight into the Safari opening
  // (BR_BOOT_SAFARI) instead of Littleroot (BR_BOOT_MAP): there is no room to wait for.
  const roomHash = parseRoomHash();
  const wantsTestMon = import.meta.env.DEV && new URLSearchParams(location.hash.slice(1)).has('testmon');
  const bootMode = (roomHash ? BR_BOOT_MAP : BR_BOOT_SAFARI) | (wantsTestMon ? BR_BOOT_FLAG_TESTMON : 0);

  // BrMailbox_Init zeroes the struct on the ROM's first frame, so the boot block has to
  // land after the magic appears, not before.
  if (mailboxBase !== undefined) {
    await waitForMailbox(emu, mailboxBase);
    writeBootBlock(emu, mailboxBase, careerName(), bootMode);
  }

  wirePlayScreen(emu);
  if (mailboxBase !== undefined && !roomHash) runSolo(emu, mailboxBase, symbols);
  else wireRoom(emu, mailboxBase, protocol, symbols);
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('shell startup failed', err);
  showScreen('importing');
  const el = $('#import-error') as HTMLElement;
  el.textContent = `Startup failed: ${message}`;
  el.hidden = false;
});
