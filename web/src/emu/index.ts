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

import { tapNode, type AudioTick, type SdlAudio } from './audio-meter';

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
  /** The sprite window (POK-329): the 256 rows around the LCD where each OAM y has one
   *  reading. Band rows draw a sprite once at its true rows, and past the window only
   *  512-row BGs and the weather. (0, 0) clears it. Older cores lack it, and repeat
   *  everything every 256 rows. */
  _brSetSpriteBand?(top: number, bottom: number): void;
  /** The window the loaded core draws with, `top << 16 | bottom`, or -1 for none. */
  _brSpriteWindow?(): number;
  /** The picture's ABGR8888 pixels in the heap -- the texture's top-left, the LCD at
   *  (left, top) inside it -- and its pixels a row; 0 with no game. */
  _brPicturePtr?(): number;
  _brPictureStride?(): number;
  /** Present the frame to the canvas from the frame-ended callback, where the core
   *  thread is paused: what the page drew in that callback and the picture are then
   *  the same frame. Older cores lack it and present on their own tick. */
  _brPresent?(): void;
  HEAPU8: Uint8Array;
  /** SDL2's audio output, once a game's thread has opened it (audio-meter.ts). */
  SDL2?: SdlAudio;
  /** The renderer's settings, which every loadGame after the call takes. */
  setCoreSettings?(settings: { rewindEnable?: boolean; autoSaveStateEnable?: boolean; restoreAutoSaveStateOnLoad?: boolean }): void;
  /** Silences SDL's output without pausing the game; resumeGame undoes it. */
  pauseAudio?(): void;
  /** SDL's own keyboard and mouse events into the core, through mGBA's key map: on (true)
   *  until told otherwise. */
  toggleInput?(enabled: boolean): void;
}

/** Pixels the core draws past the LCD on each side (POK-319). */
export interface Band {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The sprite window (POK-329): the rows above and below the LCD, 96 between them, in
 *  which the ROM keeps every sprite's 8-bit OAM y to one reading. A band that reaches
 *  past it needs a core that knows it; any other core draws rows 256 apart alike. */
export interface SpriteBand {
  top: number;
  bottom: number;
}

/** A GBA has 256 rows of OAM y; the LCD is 160 of them. */
const SPRITE_WINDOW_ROWS = 256 - 160;

/** The picture as the core drew it, for tests (POK-329): RGBA, `width` x `height`, the
 *  LCD's top-left at (`left`, `top`). */
export interface Picture {
  width: number;
  height: number;
  left: number;
  top: number;
  data: Uint8Array;
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
  private workListeners = new Set<(ms: number) => void>();
  private audioListeners = new Set<(tick: AudioTick) => void>();
  /** The output node audio-meter.ts is listening to; SDL makes a new one every boot. */
  private tappedAudio: ScriptProcessorNode | null = null;
  private halts = 0;
  /** A headless core's sound has been paused since its last boot or resume. */
  private quiet = false;
  /** What boot() last loaded, so reboot() can load it again. */
  private bootedPath: string | null = null;
  private crashListeners = new Set<() => void>();
  private running = false;
  /** Held by pause() and not yet resume()d: its frames stopped on purpose (POK-328). */
  private paused = false;
  /** Frame listeners that have thrown, each counted at its first throw. */
  private threwCount = 0;
  /** The band the page asked for, and the sprite window (POK-319, POK-329). */
  private askedBand: Band | null = null;
  private sprites: SpriteBand | null = null;
  /** The band the loaded game's texture was made with: null, the LCD alone. */
  private bootedBand: Band | null = null;
  /** Games loaded so far: a boot can change the band under whoever laid out with it. */
  private loads = 0;
  /** EWRAM and IWRAM over the heap, made once per boot (see wram()). */
  private views: { heap: Uint8Array; buffer: ArrayBufferLike; ewram: Uint8Array | null; iwram: Uint8Array | null } | null = null;

  private constructor(
    private readonly m: CoreModule,
    /** Draws to nothing: the proxy's core (see CoreFactory). */
    readonly headless = false,
  ) {}

  /** Instantiates the core against a canvas and mounts its IndexedDB-backed filesystem.
   *  `headless` for any core but the page's first: it draws to nothing (see CoreFactory). */
  static async create(canvas: HTMLCanvasElement, factory?: CoreFactory, headless = false): Promise<Emulator> {
    const f = factory ?? (await loadCoreFactory());
    const m = await f({ canvas, brHeadless: headless });
    // Nothing here rewinds, and every boot deletes the auto-save anyway (boot()), so
    // neither runs (POK-247): rewind was a whole savestate every frame, diffed on a
    // thread of its own, and the auto-save a SAVESTATE_ALL on the main thread every
    // 30 s, synced to IndexedDB -- in both cores. They are the renderer's settings, so
    // every loadGame from here on, PLAY AGAIN's included, keeps them.
    m.setCoreSettings?.({ rewindEnable: false, autoSaveStateEnable: false, restoreAutoSaveStateOnLoad: false });
    await m.FSInit();
    const emu = new Emulator(m, headless);
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
   *  at the next boot (the core sizes its texture when it loads a game), so a game
   *  already running keeps drawing the band it was booted with (viewport). Returns what
   *  the next boot will draw, or null when this core cannot. */
  setViewport(band: Band | null): Band | null {
    this.askedBand = band ? { ...band } : null;
    return this.nextBand();
  }

  /** The sprite window the band is drawn with, on every boot from now on (POK-329): the
   *  rows above and below the LCD, 96 between them, where the ROM keeps each sprite's
   *  OAM y to one reading. Anything else is no window. A core without the export draws
   *  rows 256 apart alike, so it is asked for no more band than the window: past it,
   *  that core would show the ring, the HUD and every sprite a second time. A running
   *  core takes the window at once (it sizes nothing). Returns the window the core will
   *  use, or null. */
  setSpriteBand(window: SpriteBand | null): SpriteBand | null {
    const ok = window && window.top >= 0 && window.bottom >= 0 && window.top % 8 === 0 && window.bottom % 8 === 0
      && window.top + window.bottom === SPRITE_WINDOW_ROWS;
    this.sprites = ok ? { top: window.top, bottom: window.bottom } : null;
    if (this.running) this.applySpriteBand();
    return this.spriteBand;
  }

  /** The window into the core, or none: (0, 0) clears one it holds. */
  private applySpriteBand(): void {
    const w = this.spriteBand;
    this.m._brSetSpriteBand?.(w?.top ?? 0, w?.bottom ?? 0);
  }

  /** The sprite window the core draws the band with: null on a core without the export
   *  or when none was asked for. */
  get spriteBand(): SpriteBand | null {
    return this.m._brSetSpriteBand && this.sprites ? { ...this.sprites } : null;
  }

  /** The band the core draws past the LCD: the one the loaded game was booted with --
   *  a band asked for since is the next boot's -- or, before any, the one the first boot
   *  will draw. Null on a core without the export or when none was asked for. The canvas
   *  is (240 + left + right) x (160 + top + bottom) with the LCD at (left, top). */
  get viewport(): Band | null {
    if (this.bootedPath) return this.bootedBand ? { ...this.bootedBand } : null;
    return this.nextBand();
  }

  /** Games loaded so far, for anyone laid out with a boot's band (field.ts). */
  get boots(): number {
    return this.loads;
  }

  /** What the next boot draws: the band asked for -- on a core without the sprite window,
   *  no more of it than the window. */
  private nextBand(): Band | null {
    const b = this.askedBand;
    if (!b || !this.m._brSetViewport) return null;
    const w = this.sprites;
    if (!w || this.m._brSetSpriteBand) return { ...b };
    return { ...b, top: Math.min(b.top, w.top), bottom: Math.min(b.bottom, w.bottom) };
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
    this.halts++;
    this.quiet = false;
    // loadGame starts a core thread of its own, running.
    this.paused = false;
    // A core left to its defaults auto-saves a state every 30 s and restores it on the
    // next loadGame of the same file. create() turns both off, but a shell from before
    // POK-247 left those files in IndexedDB, and a match must always start from
    // power-on, so drop them first.
    try {
      for (const f of this.m.FS.readdir(AUTOSAVE_DIR)) {
        if (f !== '.' && f !== '..') this.m.FS.unlink(`${AUTOSAVE_DIR}/${f}`);
      }
    } catch {
      /* no autosave dir yet */
    }
    // The band is a load-time size: the core builds its texture in loadGame.
    const b = this.nextBand();
    this.m._brSetViewport?.(b?.left ?? 0, b?.top ?? 0, b?.right ?? 0, b?.bottom ?? 0);
    // ...and the sprite window it is drawn with, or none, clearing one a boot before
    // this left in the core.
    this.applySpriteBand();
    this.bootedBand = b;
    this.loads++;
    // loadGame builds a new core, and its RAM with it: the old views point at nothing.
    this.views = null;
    if (!this.m.loadGame(path)) throw new Error('loadGame failed');
    // The keyboard is the page's alone (bindKeyboard). Left on, SDL hears it too, through
    // mGBA's own map -- X is A there and Z is B, the page's the other way round -- so X
    // pressed A a frame after the page's B, and Z B after its A: B closing the START menu
    // opened the party screen (picture.spec, 2026-09-27), and a drawn screen's keys
    // reached the game under it (POK-330 #56). Once SDL is up, so after loadGame, and on
    // every boot.
    this.m.toggleInput?.(false);
    this.running = true;
    // addCoreCallbacks is a no-op until a core exists, so this must follow loadGame.
    this.m.addCoreCallbacks({
      // This runs inside a synchronous proxy from the core's thread: a throw out of it
      // never completes the call, and the core waits on it for good -- the game frozen,
      // the mailbox undrained, nothing on screen (POK-330 #35). So no listener's bug
      // gets out of here, and the picture is presented whatever happened.
      videoFrameEndedCallback: () => {
        const started = this.workListeners.size ? performance.now() : -1;
        // The views are remade once a frame, not once a boot. loadGame returns before the
        // core thread has swapped cores, so the old core's last frames still run
        // listeners, and a read there kept the dead core's RAM for the whole next match:
        // the replay's mailbox never woke and PLAY AGAIN hung on the results panel.
        this.views = null;
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
        try {
          this.afterFrame(started);
        } catch {
          /* a meter's bug is not the frame's */
        }
      },
      coreCrashedCallback: () => {
        this.running = false;
        this.views = null;
        this.halts++;
        for (const l of this.crashListeners) l();
      },
    });
  }

  stop(): void {
    if (!this.running) return;
    this.m.quitGame();
    this.running = false;
    this.views = null;
    this.halts++;
  }

  pause(): void {
    this.m.pauseGame();
    this.paused = true;
    this.halts++;
  }

  resume(): void {
    this.m.resumeGame();
    this.paused = false;
    this.quiet = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** The page is holding it still (pause() without a resume() since): the boot block's
   *  hold, a reboot's. A watchdog does not call that a stop (watchdog.ts). */
  isPaused(): boolean {
    return this.paused;
  }

  /** Fires on the main thread after every emulated frame. Returns an unsubscribe. */
  onFrame(listener: () => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** After every frame, how long the page's own part of it took on the main thread,
   *  in ms: the frame listeners and the present. The core thread waits on all of it
   *  (POK-247). Returns an unsubscribe. */
  onFrameWork(listener: (ms: number) => void): () => void {
    this.workListeners.add(listener);
    return () => this.workListeners.delete(listener);
  }

  /** Every callback of the core's audio output, late, cut or fine (audio-meter.ts).
   *  Heard from the first frame after SDL opens it, and again after every boot. */
  onAudio(listener: (tick: AudioTick) => void): () => void {
    this.audioListeners.add(listener);
    return () => this.audioListeners.delete(listener);
  }

  /** Goes up whenever the frames stop for a reason of the page's own -- a pause, a
   *  boot, a stop, a crash -- so a meter does not read the gap across one as a frame. */
  get pauses(): number {
    return this.halts;
  }

  private afterFrame(started: number): void {
    // Nobody hears a headless core, and SDL feeds its speaker on the main thread -- the
    // proxy's at 8x, through a sinc resampler, 47 times a second (POK-247). SDL opens
    // and resumes it when the core's thread starts, and resumeGame resumes it, so it is
    // paused again at the first frame after either.
    if (this.headless && !this.quiet) {
      this.quiet = true;
      this.m.pauseAudio?.();
    }
    if (started >= 0) {
      const ms = performance.now() - started;
      for (const l of this.workListeners) l(ms);
    }
    if (!this.audioListeners.size) return;
    const sdl = this.m.SDL2;
    const node = sdl?.audio?.scriptProcessorNode;
    if (!node || !sdl.audioContext || node === this.tappedAudio) return;
    this.tappedAudio = node;
    tapNode(node, sdl.audioContext, (tick) => {
      for (const l of this.audioListeners) l(tick);
    });
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

  /** How many frame listeners have thrown so far, each once. */
  get threw(): number {
    return this.threwCount;
  }

  private listenerFailed(l: () => void, err: unknown): void {
    if (this.failedListeners.has(l)) return;
    this.failedListeners.add(l);
    this.threwCount++;
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

  /** Lets go of every key the core holds, whoever pressed it. */
  releaseAll(): void {
    this.setKeys(0);
  }

  /** A keyboard, as GBA keys (POK-330 #56). A press can be taken by something drawn
   *  over the game (`divert` returns true); a release always reaches the core, since
   *  letting go of a key that is not down is nothing -- a key held as a drawn screen
   *  came up used to stay down into the next match. And every key is let go when the
   *  page loses the player (the window blurs, the tab hides): the keyup for a key held
   *  across that lands somewhere this page never hears. Returns an unbind. */
  bindKeyboard(
    map: Readonly<Record<string, GbaKey>>,
    divert: (key: GbaKey, repeat: boolean) => boolean = () => false,
    on: { win: EventTarget; doc: EventTarget & { readonly hidden: boolean } } = { win: window, doc: document },
  ): () => void {
    const keyOf = (e: Event): GbaKey | undefined => {
      const key = map[(e as KeyboardEvent).key] as GbaKey | undefined;
      if (key) e.preventDefault();
      return key;
    };
    const down = (e: Event) => {
      const key = keyOf(e);
      if (key && !divert(key, (e as KeyboardEvent).repeat)) this.press(key);
    };
    const up = (e: Event) => {
      const key = keyOf(e);
      if (key) this.release(key);
    };
    const away = () => this.releaseAll();
    const hidden = () => {
      if (on.doc.hidden) this.releaseAll();
    };
    on.win.addEventListener('keydown', down);
    on.win.addEventListener('keyup', up);
    on.win.addEventListener('blur', away);
    on.doc.addEventListener('visibilitychange', hidden);
    return () => {
      on.win.removeEventListener('keydown', down);
      on.win.removeEventListener('keyup', up);
      on.win.removeEventListener('blur', away);
      on.doc.removeEventListener('visibilitychange', hidden);
    };
  }

  // ---- memory -----------------------------------------------------------------------
  // Views over the shared heap, made once per boot and kept (POK-330 #65): the frame
  // listeners make ~290 reads a frame while the core thread waits on them, and a wasm
  // call plus two allocations for each was all overhead. A view is dropped when the
  // core is rebuilt, stopped or crashes (its RAM moves with it), and remade when the
  // heap itself is replaced (memory growth).

  private heapViews(): NonNullable<Emulator['views']> {
    const heap = this.m.HEAPU8;
    const v = this.views;
    if (v && v.heap === heap && v.buffer === heap.buffer) return v;
    return (this.views = { heap, buffer: heap.buffer, ewram: null, iwram: null });
  }

  /** EWRAM, 256 KiB, mapped at 0x02000000. */
  wram(): Uint8Array {
    const v = this.heapViews();
    if (v.ewram) return v.ewram;
    const p = this.m._brWramPtr();
    if (!p) throw new Error('no GBA core loaded');
    return (v.ewram = v.heap.subarray(p, p + EWRAM_SIZE));
  }

  /** IWRAM, 32 KiB, mapped at 0x03000000. */
  iwram(): Uint8Array {
    const v = this.heapViews();
    if (v.iwram) return v.iwram;
    const p = this.m._brIwramPtr();
    if (!p) throw new Error('no GBA core loaded');
    return (v.iwram = v.heap.subarray(p, p + IWRAM_SIZE));
  }

  /** Reads a little-endian value at a GBA bus address in EWRAM or IWRAM. */
  read(addr: number, width: 8 | 16 | 32 = 32): number {
    const view = this.viewAt(addr);
    const off = addr - (addr >= IWRAM_BASE ? IWRAM_BASE : EWRAM_BASE);
    let v = 0;
    for (let i = width / 8 - 1; i >= 0; i--) v = (v << 8) | view[off + i];
    return v >>> 0;
  }

  write(addr: number, value: number, width: 8 | 16 | 32 = 32): void {
    const view = this.viewAt(addr);
    const off = addr - (addr >= IWRAM_BASE ? IWRAM_BASE : EWRAM_BASE);
    for (let i = 0; i < width / 8; i++) view[off + i] = (value >>> (8 * i)) & 0xff;
  }

  /** Bytes at a GBA bus address, as a view (writes go straight to the core). */
  bytes(addr: number, len: number): Uint8Array {
    const off = addr - (addr >= IWRAM_BASE ? IWRAM_BASE : EWRAM_BASE);
    return this.viewAt(addr).subarray(off, off + len);
  }

  private viewAt(addr: number): Uint8Array {
    if (addr >= EWRAM_BASE && addr < EWRAM_BASE + EWRAM_SIZE) return this.wram();
    if (addr >= IWRAM_BASE && addr < IWRAM_BASE + IWRAM_SIZE) return this.iwram();
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

  /** The picture as the core drew it, band and all, copied out of the heap: what the
   *  e2e holds the band to (POK-329), in DEV only. Take it in a frame listener, where
   *  the core's thread is paused; anywhere else the core may be halfway into the next
   *  frame. Null on a core without the exports, or with nothing loaded. */
  picture(): Picture | null {
    if (!import.meta.env.DEV) return null;
    const ptr = this.m._brPicturePtr?.() ?? 0;
    const stride = this.m._brPictureStride?.() ?? 0;
    if (!ptr || !stride) return null;
    const b = this.bootedBand ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const width = 240 + b.left + b.right;
    const height = 160 + b.top + b.bottom;
    const data = new Uint8Array(width * height * 4);
    const heap = this.m.HEAPU8;
    for (let y = 0; y < height; y++) data.set(heap.subarray(ptr + y * stride * 4, ptr + (y * stride + width) * 4), y * width * 4);
    return { width, height, left: b.left, top: b.top, data };
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
