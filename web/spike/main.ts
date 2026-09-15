// POK-212 emulator spike. Measures the threaded mGBA wasm core on a real phone and
// proves the EWRAM export by reading the trainer's name straight out of RAM.
//
// Deliberately framework-free and self-contained; nothing here is shell code.

export {};

type Emu = EmscriptenModule & {
  FSInit(): Promise<void>;
  FSSync(): Promise<void>;
  FS: typeof FS;
  loadGame(romPath: string, savePathOverride?: string): boolean;
  pauseGame(): void;
  resumeGame(): void;
  buttonPress(name: string): void;
  buttonUnpress(name: string): void;
  setVolume(percent: number): void;
  setFastForwardMultiplier(multiplier: number): void;
  addCoreCallbacks(cb: { videoFrameEnded?: () => void; video?: () => void }): void;
  // Our exports (candidate A fork). Absent on the stock build.
  _brWramPtr?: () => number;
  _brIwramPtr?: () => number;
  HEAPU8: Uint8Array;
};

const EMERALD_SHA1 = 'f3ae088181bf583e55daf962a92bb46f4f1d07b7';
const ROM_PATH = '/data/games/emerald.gba';

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
const logEl = $('#log') as HTMLPreElement;
const statsEl = $('#stats') as HTMLDivElement;
const log = (s: string) => {
  logEl.textContent = `${s}\n${logEl.textContent ?? ''}`.slice(0, 4000);
};

async function sha1(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let emu: Emu | null = null;

async function boot(): Promise<Emu> {
  if (emu) return emu;
  // Served, not bundled: the threaded runtime spawns its workers from this URL.
  const url = '/spike/vendor/mgba.js';
  const factory = (await import(/* @vite-ignore */ url)).default as (o: { canvas: HTMLCanvasElement }) => Promise<Emu>;
  emu = await factory({ canvas: $('#canvas') });
  await emu.FSInit();
  log(`core up. crossOriginIsolated=${crossOriginIsolated} SAB=${typeof SharedArrayBuffer !== 'undefined'}`);
  log(`exports: brWramPtr=${typeof emu._brWramPtr} brIwramPtr=${typeof emu._brIwramPtr}`);
  return emu;
}

function storedRomExists(m: Emu): boolean {
  try {
    m.FS.stat(ROM_PATH);
    return true;
  } catch {
    return false;
  }
}

// --- fps: count frames the core finishes, sample once a second ------------------
let frames = 0;
let lastT = performance.now();
let lastFrames = 0;
const samples: number[] = [];
function hookFps(m: Emu) {
  const bump = () => {
    frames++;
  };
  try {
    m.addCoreCallbacks({ videoFrameEnded: bump, video: bump });
  } catch (e) {
    log(`addCoreCallbacks failed: ${String(e)}`);
  }
  setInterval(() => {
    const now = performance.now();
    const fps = ((frames - lastFrames) * 1000) / (now - lastT);
    lastFrames = frames;
    lastT = now;
    samples.push(fps);
    if (samples.length > 60) samples.shift();
    const sorted = [...samples].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)] ?? 0;
    statsEl.textContent = `fps ${fps.toFixed(1)}  p5 ${p5.toFixed(1)}  n ${samples.length}`;
  }, 1000);
}

// --- RAM read: trainer name through the exported EWRAM/IWRAM pointers ----------
// Retail Emerald (U): gSaveBlock2Ptr lives at IWRAM 0x03005D90 and points into
// EWRAM; SaveBlock2 starts with playerName[8] in the Gen 3 charmap.
function decodeGen3(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    if (b === 0xff) break;
    if (b >= 0xbb && b <= 0xd4) s += String.fromCharCode(65 + b - 0xbb);
    else if (b >= 0xd5 && b <= 0xee) s += String.fromCharCode(97 + b - 0xd5);
    else if (b >= 0xa1 && b <= 0xaa) s += String.fromCharCode(48 + b - 0xa1);
    else if (b === 0x00) s += ' ';
    else s += '?';
  }
  return s;
}

function readTrainerName(m: Emu): string {
  if (!m._brWramPtr || !m._brIwramPtr) return 'no memory export in this build';
  const wram = m._brWramPtr();
  const iwram = m._brIwramPtr();
  const heap = m.HEAPU8;
  const off = 0x03005d90 - 0x03000000;
  const ptr = heap[iwram + off] | (heap[iwram + off + 1] << 8) | (heap[iwram + off + 2] << 16) | (heap[iwram + off + 3] << 24);
  if ((ptr >>> 24) !== 0x02) return `gSaveBlock2Ptr=0x${(ptr >>> 0).toString(16)} (not EWRAM yet; start a game first)`;
  const name = heap.subarray(wram + (ptr - 0x02000000), wram + (ptr - 0x02000000) + 8);
  return `gSaveBlock2Ptr=0x${(ptr >>> 0).toString(16)} name="${decodeGen3(name)}" raw=${[...name].map((b) => b.toString(16)).join(' ')}`;
}

// --- input -----------------------------------------------------------------------
function wireInput(m: Emu) {
  for (const el of document.querySelectorAll<HTMLElement>('.btn[data-key]')) {
    const key = el.dataset.key!;
    const down = (e: Event) => {
      e.preventDefault();
      el.classList.add('down');
      m.buttonPress(key);
    };
    const up = (e: Event) => {
      e.preventDefault();
      el.classList.remove('down');
      m.buttonUnpress(key);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }
  const keys: Record<string, string> = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    z: 'a', x: 'b', Enter: 'start', Shift: 'select', a: 'l', s: 'r',
  };
  addEventListener('keydown', (e) => keys[e.key] && (e.preventDefault(), m.buttonPress(keys[e.key])));
  addEventListener('keyup', (e) => keys[e.key] && (e.preventDefault(), m.buttonUnpress(keys[e.key])));
  let ff = 1;
  $('#ff').addEventListener('click', () => {
    ff = ff === 1 ? 4 : 1;
    m.setFastForwardMultiplier(ff);
    $('#ff').textContent = `FF x${ff}`;
  });
  $('#ram').addEventListener('click', () => log(readTrainerName(m)));
}

// --- setup flow --------------------------------------------------------------------
async function main() {
  const setup = $('#setup') as HTMLElement;
  const input = $('#rom') as HTMLInputElement;
  const play = $('#play') as HTMLButtonElement;
  let pending: Uint8Array | null = null;

  const m = await boot();
  if (storedRomExists(m)) {
    log('stored ROM found; press Play');
    play.disabled = false;
  }

  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const h = await sha1(bytes);
    log(`${f.name}: ${bytes.length} bytes sha1 ${h} ${h === EMERALD_SHA1 ? '(Emerald U, matches)' : '(NOT the Emerald U baseline; running anyway for the spike)'}`);
    pending = bytes;
    play.disabled = false;
  });

  $('#forget').addEventListener('click', async () => {
    try {
      m.FS.unlink(ROM_PATH);
    } catch {}
    await m.FSSync();
    log('forgot stored ROM');
    play.disabled = !pending;
  });

  play.addEventListener('click', async () => {
    if (pending) {
      m.FS.writeFile(ROM_PATH, pending);
      await m.FSSync();
      log('ROM stored in IndexedDB');
    }
    hookFps(m);
    wireInput(m);
    const ok = m.loadGame(ROM_PATH);
    log(`loadGame → ${ok}`);
    setup.classList.add('hidden');
    m.setVolume(100);
  });
}

main().catch((e) => log(`boot failed: ${e?.stack ?? e}`));
