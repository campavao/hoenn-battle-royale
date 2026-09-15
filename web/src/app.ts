// The web shell's state machine (POK-213): importing -> patching -> playing.
// Plain DOM, phone-first (see index.html for layout). Everything Emerald/GBA-specific
// goes through emu/index.ts's Emulator wrapper -- this file never touches the core
// directly, per the project CLAUDE.md.

import { Emulator, type GbaKey } from './emu';
import { checkEmerald } from './rom/emerald';
import { loadRelease, type ReleaseInfo } from './release';
import type { PatchWorkerRequest, PatchWorkerResponse } from './patch/bps.worker';
import { MAILBOX } from './net/mailbox';
import { RelayClient } from './net/relay';
import { Bridge } from './net/bridge';
import { encodeGen3 } from './text/gen3';

const MUTE_STORAGE_KEY = 'hbr:muted';
const UNMUTED_VOLUME = 100;
const NAME_STORAGE_KEY = 'hbr:name';
const DEFAULT_NAME = 'CAM';
const DEFAULT_RELAY_URL = 'wss://hoenn-relay-production.up.railway.app';

// The boot block (include/br/br_boot.h): a fresh game, dropped straight into
// Littleroot, skipping the intro/Birch/naming screen every driver and every match
// alike would otherwise have to sit through.
const BR_BOOT_MAP = 1;
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
  if (emu.hasRom()) return; // already imported on this device; nothing to do

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
}

async function runPatchingScreen(emu: Emulator): Promise<PatchResult> {
  showScreen('patching');
  const statusEl = $('#patch-status') as HTMLElement;
  const bannerEl = $('#patch-banner') as HTMLElement;

  statusEl.textContent = 'Checking for a release…';
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

function careerName(): string {
  return localStorage.getItem(NAME_STORAGE_KEY) || DEFAULT_NAME;
}

/** Writes gBrMailbox.boot so a fresh game skips the intro/Birch/naming screens and
 *  is already standing in Littleroot -- every driver's own trick (project CLAUDE.md),
 *  used here so a match (or solo play) starts the same way. The ROM clears `mode`
 *  once it has consumed the block. */
function writeBootBlock(emu: Emulator, mailboxBase: number, name: string): void {
  const boot = mailboxBase + MAILBOX.OFF_BOOT;
  emu.write(boot + 0, BR_BOOT_MAP, 8);
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
  const hash = location.hash.slice(1);
  if (hash === 'host') return { mode: 'host' };
  const joined = /^join=([A-Za-z0-9]+)$/.exec(hash);
  return joined ? { mode: 'join', code: joined[1].toUpperCase() } : null;
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

function wireRoom(emu: Emulator, mailboxBase: number | undefined, protocol: number | undefined): void {
  const hash = parseRoomHash();
  if (!hash || mailboxBase === undefined) return; // solo: no socket at all

  const panel = $('#room-panel') as HTMLElement;
  const codeEl = $('#room-code') as HTMLElement;
  panel.hidden = false;
  codeEl.textContent = hash.mode === 'host' ? 'Hosting…' : `Joining ${hash.code}…`;

  const relay = new RelayClient();
  let bridge: Bridge | null = null;

  const attach = (seat: number, code: string) => {
    bridge = new Bridge({ emu, mailboxBase, relay, seat, protocol });
    codeEl.textContent = `Room ${code}`;
    renderRoom(bridge);
  };

  relay.on('room_hosted', (ev) => attach(ev.id, ev.code));
  relay.on('room_joined', (ev) => attach(ev.id, ev.code));
  relay.on('roster', () => bridge && renderRoom(bridge));
  relay.on('room_error', (ev) => (codeEl.textContent = `Couldn't join: ${ev.reason}`));
  relay.on('closed', (ev) => (codeEl.textContent = `Disconnected: ${ev.reason}`));

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
  const { bytes, usingPatched, mailboxBase, protocol } = await runPatchingScreen(emu);

  showScreen('playing');
  if (usingPatched) await emu.startBytes(bytes);
  else await emu.start();

  if (mailboxBase !== undefined) writeBootBlock(emu, mailboxBase, careerName());

  wirePlayScreen(emu);
  wireRoom(emu, mailboxBase, protocol);
}

main().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('shell startup failed', err);
  showScreen('importing');
  const el = $('#import-error') as HTMLElement;
  el.textContent = `Startup failed: ${message}`;
  el.hidden = false;
});
