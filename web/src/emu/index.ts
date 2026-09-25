// The emulator, as the shell sees it (POK-212).
//
// Wraps the mGBA wasm core served from /emu/mgba.js (thenick775/mgba feature/wasm plus
// tools/br/mgba-wasm/hbr-exports.patch). The core runs on its own pthread; the page
// reads the GBA's work RAM through a Uint8Array view over the shared wasm heap, and
// gets a callback on the main thread after every emulated frame. That callback is
// where the mailbox is drained (POK-216).
//
// Everything Emerald-specific stays out of here; this file knows GBA memory, keys,
// files and frames, nothing about save blocks or the match.

export type GbaKey = 'a' | 'b' | 'select' | 'start' | 'right' | 'left' | 'up' | 'down' | 'r' | 'l';

/** Bit positions match mGBA's GBA_KEY_* order, so a mask round-trips to the harness. */
export const KEY_BIT: Record<GbaKey, number> = {
  a: 0, b: 1, select: 2, start: 3, right: 4, left: 5, up: 6, down: 7, r: 8, l: 9,
};
export const ALL_KEYS = Object.keys(KEY_BIT) as GbaKey[];

export const EWRAM_BASE = 0x02000000;
export const EWRAM_SIZE = 0x40000;
export const IWRAM_BASE = 0x03000000;
export const IWRAM_SIZE = 0x8000;

/** The subset of the core's Module contract this wrapper uses. */
export interface CoreModule {
  FSInit(): Promise<void>;
  FSSync(): Promise<void>;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
    stat(path: string): unknown;
    readdir(path: string): string[];
  };
  loadGame(romPath: string, savePathOverride?: string): boolean;
  quitGame(): void;
  pauseGame(): void;
  resumeGame(): void;
  buttonPress(name: string): void;
  buttonUnpress(name: string): void;
  setVolume(percent: number): void;
  getVolume(): number;
  setFastForwardMultiplier(multiplier: number): void;
  saveState(slot: number): boolean;
  loadState(slot: number): boolean;
  screenshot(fileName?: string): boolean;
  addCoreCallbacks(cb: {
    videoFrameEndedCallback?: (() => void) | null;
    coreCrashedCallback?: (() => void) | null;
  }): void;
  _brWramPtr(): number;
  _brIwramPtr(): number;
  /** The picture past the LCD (POK-319): a band of pixels on each side, drawn by the
   *  core from the same registers. Older cores lack it. */
  _brSetViewport?(left: number, top: number, right: number, bottom: number): void;
  /** Present the frame to the canvas from the frame-ended callback, where the core
   *  thread is paused: what the page drew in that callback and the picture are then
   *  the same frame. Older cores lack it and present on their own tick. */
  _brPresent?(): void;
  HEAPU8: Uint8Array;
}

/** Pixels the core draws past the LCD on each side (POK-319). */
export interface Band {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** `brHeadless`: an instance that draws to nothing. A page's SECOND core must be one:
 *  emscripten's SDL names its canvas by the selector "#canvas", whichever element the
 *  module was given, so a second instance with a window resizes the first's canvas to
 *  its own size the moment it loads a game (the picture past the LCD squashed into the
 *  LCD's box after the first bot fight, on every browser, 2026-09-18). */
export type CoreFactory = (opts: { canvas: HTMLCanvasElement; brHeadless?: boolean }) => Promise<CoreModule>;

const ROM_PATH = '/data/games/emerald.gba';
// A patched image boots from a separate path so start() never overwrites the
// player's original, stored ROM with the patched bytes (POK-213). Outside /data, which
// is the IndexedDB mount: the image is rebuilt from the BPS on every launch, so storing
// it was 16 MiB written per boot and a whole game left behind by 'Forget stored ROM'
// (POK-330 #40). Same basename as before, so the core's save and auto-save names --
// /data/saves/patched.sav, /autosave/patched_auto.ss -- do not move.
const PATCHED_ROM_PATH = '/patched.gba';
/** Where every boot before POK-330 #40 left the patched image, in IndexedDB. */
const LEGACY_PATCHED_PATH = '/data/games/patched.gba';
const SCREENSHOT_PATH = '/data/screenshots/shot.png';
const AUTOSAVE_DIR = '/autosave';

/** Loads the core script raw from public/emu, outside Vite's import analysis. */
export async function loadCoreFactory(url = '/emu/mgba.js'): Promise<CoreFactory> {
  const importRaw = new Function('u', 'return import(u)') as (u: string) => Promise<{ default: CoreFactory }>;
  return (await importRaw(url)).default;
}

export class Emulator {
  private held = 0;
  private frameListeners = new Set<() => void>();
  /** Listeners that have thrown, so each is reported once and not sixty times a second. */
  private failedListeners = new WeakSet<() => void>();
  private errorListeners = new Set<(err: unknown) => void>();
  /** What boot() last loaded, so reboot() can load it again. */
  private bootedPath: string | null = null;
  private crashListeners = new Set<() => void>();
  private running = false;
  private band: Band | null = null;

  private constructor(private readonly m: CoreModule) {}

  /** Instantiates the core against a canvas and mounts its IndexedDB-backed filesystem.
   *  `headless` for any core but the page's first: it draws to nothing (see CoreFactory). */
  static async create(canvas: HTMLCanvasElement, factory?: CoreFactory, headless = false): Promise<Emulator> {
    const f = factory ?? (await loadCoreFactory());
    const m = await f({ canvas, brHeadless: headless });
    await m.FSInit();
    const emu = new Emulator(m);
    await emu.dropLegacyPatched();
    return emu;
  }

  /** The patched image an older shell stored in IndexedDB (POK-330 #40): gone the first
   *  time a newer one starts, and a no-op every time after. */
  private async dropLegacyPatched(): Promise<void> {
    try {
      this.m.FS.unlink(LEGACY_PATCHED_PATH);
    } catch {
      return; // never stored, or already dropped
    }
    await this.m.FSSync();
  }

  // ---- ROM storage: the player's own ROM, imported once, kept in the core's IDBFS ----

  hasRom(): boolean {
    try {
      this.m.FS.stat(ROM_PATH);
      return true;
    } catch {
      return false;
    }
  }

  async importRom(bytes: Uint8Array): Promise<void> {
    this.m.FS.writeFile(ROM_PATH, bytes);
    await this.m.FSSync();
  }

  async forgetRom(): Promise<void> {
    // The legacy patched copy too: it is a whole game, and the button says the ROM is gone.
    for (const path of [ROM_PATH, LEGACY_PATCHED_PATH]) {
      try {
        this.m.FS.unlink(path);
      } catch {
        /* nothing stored */
      }
    }
    await this.m.FSSync();
  }

  /** Reads back the stored original ROM's bytes (e.g. to feed the BPS patcher). */
  readRom(): Uint8Array {
    return this.m.FS.readFile(ROM_PATH);
  }

  // ---- the picture past the LCD (POK-319) --------------------------------------------

  /** Ask the core to draw a band past the LCD on every boot from now on. Takes effect
   *  at the next boot (the core sizes its texture when it loads a game). Returns what
   *  the core will draw, or null when this core cannot. */
  setViewport(band: Band | null): Band | null {
    if (!band || !this.m._brSetViewport) {
      this.band = null;
      return null;
    }
    this.band = { ...band };
    return this.band;
  }

  /** The band the core draws past the LCD: null on a core without the export or when
   *  none was asked for. The canvas is (240 + left + right) x (160 + top + bottom) with
   *  the LCD at (left, top). */
  get viewport(): Band | null {
    return this.band;
  }

  // ---- running --------------------------------------------------------------------

  /** Boots the stored ROM (or the bytes given, which are also stored as the ROM). */
  async start(bytes?: Uint8Array): Promise<void> {
    if (bytes) await this.importRom(bytes);
    if (!this.hasRom()) throw new Error('no ROM stored');
    await this.boot(ROM_PATH);
  }

  /** Boots arbitrary bytes -- typically a BPS-patched image -- from a separate path,
   * leaving the stored original ROM at rest untouched. Use this instead of start()
   * whenever `bytes` is a patched copy rather than the player's own ROM file. The copy
   * lives in memory only: nothing is synced to IndexedDB. */
  async startBytes(bytes: Uint8Array): Promise<void> {
    this.m.FS.writeFile(PATCHED_ROM_PATH, bytes);
    await this.boot(PATCHED_ROM_PATH);
  }

  /** Power-cycles whatever is loaded, from the same file. PLAY AGAIN keeps the room
   *  (POK-258), so the match after it cannot be a page reload: the socket, the bridge
   *  and every frame listener have to survive, and only the ROM starts over. */
  async reboot(): Promise<void> {
    if (!this.bootedPath) throw new Error('nothing booted yet');
    await this.boot(this.bootedPath);
  }

  private async boot(path: string): Promise<void> {
    this.bootedPath = path;
    // The core auto-saves a state every 30 s and restores it on the next loadGame of
    // the same file. A match must always start from power-on, so drop those first.
    try {
      for (const f of this.m.FS.readdir(AUTOSAVE_DIR)) {
        if (f !== '.' && f !== '..') this.m.FS.unlink(`${AUTOSAVE_DIR}/${f}`);
      }
    } catch {
      /* no autosave dir yet */
    }
    // The band is a load-time size: the core builds its texture in loadGame.
    if (this.m._brSetViewport) {
      const b = this.band ?? { left: 0, top: 0, right: 0, bottom: 0 };
      this.m._brSetViewport(b.left, b.top, b.right, b.bottom);
    }
    if (!this.m.loadGame(path)) throw new Error('loadGame failed');
    this.running = true;
    // addCoreCallbacks is a no-op until a core exists, so this must follow loadGame.
    this.m.addCoreCallbacks({
      // This runs inside a synchronous proxy from the core's thread: a throw out of it
      // never completes the call, and the core waits on it for good -- the game frozen,
      // the mailbox undrained, nothing on screen (POK-330 #35). So no listener's bug
      // gets out of here, and the picture is presented whatever happened.
      videoFrameEndedCallback: () => {
        try {
          for (const l of this.frameListeners) {
            try {
              l();
            } catch (err) {
              this.listenerFailed(l, err);
            }
          }
        } finally {
          // The listeners drew around the picture for this frame; now the picture.
          this.m._brPresent?.();
        }
      },
      coreCrashedCallback: () => {
        this.running = false;
        for (const l of this.crashListeners) l();
      },
    });
  }

  stop(): void {
    if (!this.running) return;
    this.m.quitGame();
    this.running = false;
  }

  pause(): void {
    this.m.pauseGame();
  }

  resume(): void {
    this.m.resumeGame();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Fires on the main thread after every emulated frame. Returns an unsubscribe. */
  onFrame(listener: () => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onCrash(listener: () => void): () => void {
    this.crashListeners.add(listener);
    return () => this.crashListeners.delete(listener);
  }

  /** Hears the first throw of each frame listener (the listener stays subscribed). With
   *  nobody listening, it goes to the console. Returns an unsubscribe. */
  onListenerError(listener: (err: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private listenerFailed(l: () => void, err: unknown): void {
    if (this.failedListeners.has(l)) return;
    this.failedListeners.add(l);
    if (!this.errorListeners.size) {
      console.error('[emu] a frame listener threw; the frame carries on without it', err);
      return;
    }
    for (const report of this.errorListeners) {
      try {
        report(err);
      } catch {
        /* a reporter's own bug is not the frame's */
      }
    }
  }

  // ---- input ------------------------------------------------------------------------

  press(key: GbaKey): void {
    const bit = 1 << KEY_BIT[key];
    if (this.held & bit) return;
    this.held |= bit;
    this.m.buttonPress(key);
  }

  release(key: GbaKey): void {
    const bit = 1 << KEY_BIT[key];
    if (!(this.held & bit)) return;
    this.held &= ~bit;
    this.m.buttonUnpress(key);
  }

  /** Sets the whole key state from a bitmask (KEY_BIT order); only changed keys are sent. */
  setKeys(mask: number): void {
    for (const key of ALL_KEYS) {
      if (mask & (1 << KEY_BIT[key])) this.press(key);
      else this.release(key);
    }
  }

  keys(): number {
    return this.held;
  }

  // ---- memory -----------------------------------------------------------------------
  // Views over the shared heap. Take them fresh each time: the heap buffer can only
  // change if the core is torn down, but it costs nothing and keeps callers honest.

  /** EWRAM, 256 KiB, mapped at 0x02000000. */
  wram(): Uint8Array {
    const p = this.m._brWramPtr();
    if (!p) throw new Error('no GBA core loaded');
    return this.m.HEAPU8.subarray(p, p + EWRAM_SIZE);
  }

  /** IWRAM, 32 KiB, mapped at 0x03000000. */
  iwram(): Uint8Array {
    const p = this.m._brIwramPtr();
    if (!p) throw new Error('no GBA core loaded');
    return this.m.HEAPU8.subarray(p, p + IWRAM_SIZE);
  }

  /** Reads a little-endian value at a GBA bus address in EWRAM or IWRAM. */
  read(addr: number, width: 8 | 16 | 32 = 32): number {
    const [view, off] = this.locate(addr);
    let v = 0;
    for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | view[off + i];
    return v >>> 0;
  }

  write(addr: number, value: number, width: 8 | 16 | 32 = 32): void {
    const [view, off] = this.locate(addr);
    for (let i = 0; i < width / 8; i++) view[off + i] = (value >>> (8 * i)) & 0xff;
  }

  /** Bytes at a GBA bus address, as a view (writes go straight to the core). */
  bytes(addr: number, len: number): Uint8Array {
    const [view, off] = this.locate(addr);
    return view.subarray(off, off + len);
  }

  private locate(addr: number): [Uint8Array, number] {
    if (addr >= EWRAM_BASE && addr < EWRAM_BASE + EWRAM_SIZE) return [this.wram(), addr - EWRAM_BASE];
    if (addr >= IWRAM_BASE && addr < IWRAM_BASE + IWRAM_SIZE) return [this.iwram(), addr - IWRAM_BASE];
    throw new Error(`address 0x${addr.toString(16)} is not in EWRAM or IWRAM`);
  }

  // ---- misc -------------------------------------------------------------------------

  setSpeed(multiplier: number): void {
    this.m.setFastForwardMultiplier(multiplier);
  }

  setVolume(percent: number): void {
    this.m.setVolume(percent);
  }

  saveState(slot = 1): boolean {
    return this.m.saveState(slot);
  }

  loadState(slot = 1): boolean {
    return this.m.loadState(slot);
  }

  /** PNG bytes of the current frame. */
  screenshot(): Uint8Array | null {
    if (!this.m.screenshot(SCREENSHOT_PATH)) return null;
    try {
      return this.m.FS.readFile(SCREENSHOT_PATH);
    } catch {
      return null;
    }
  }
}
