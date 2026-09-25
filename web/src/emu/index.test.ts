import { describe, expect, it, vi } from 'vitest';
import { ALL_KEYS, EWRAM_BASE, Emulator, IWRAM_BASE, KEY_BIT, type CoreModule, type GbaKey } from './index';

// A fake core: a 1 MiB heap with EWRAM at 0x1000 and IWRAM at 0x50000, a file map,
// and a log of every call, so the wrapper's bookkeeping can be checked without wasm.
function fakeCore() {
  const heap = new Uint8Array(1 << 20);
  const files = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let cb: Parameters<CoreModule['addCoreCallbacks']>[0] = {};
  const m: CoreModule = {
    FSInit: async () => {},
    FSSync: async () => {
      calls.push('sync');
    },
    FS: {
      writeFile: (p, d) => void files.set(p, d),
      readFile: (p) => {
        const f = files.get(p);
        if (!f) throw new Error('ENOENT');
        return f;
      },
      unlink: (p) => {
        if (!files.delete(p)) throw new Error('ENOENT');
      },
      stat: (p) => {
        if (!files.has(p)) throw new Error('ENOENT');
        return {};
      },
      readdir: (dir) => ['.', '..', ...[...files.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => k.slice(dir.length + 1))],
    },
    loadGame: (p) => {
      calls.push(`load ${p}`);
      return files.has(p);
    },
    quitGame: () => calls.push('quit'),
    pauseGame: () => calls.push('pause'),
    resumeGame: () => calls.push('resume'),
    buttonPress: (n) => calls.push(`press ${n}`),
    buttonUnpress: (n) => calls.push(`release ${n}`),
    setVolume: () => {},
    getVolume: () => 1,
    setFastForwardMultiplier: (x) => calls.push(`speed ${x}`),
    saveState: () => true,
    loadState: () => true,
    screenshot: (p) => {
      files.set(p!, new Uint8Array([0x89, 0x50]));
      return true;
    },
    addCoreCallbacks: (c) => {
      cb = c;
    },
    _brWramPtr: () => 0x1000,
    _brIwramPtr: () => 0x50000,
    HEAPU8: heap,
  };
  return { m, heap, files, calls, frame: () => cb.videoFrameEndedCallback?.() };
}

async function make() {
  const canvas = {} as HTMLCanvasElement;
  const core = fakeCore();
  const emu = await Emulator.create(canvas, async () => core.m);
  return { emu, ...core };
}

describe('Emulator', () => {
  it('stores the ROM once and boots it', async () => {
    const { emu, calls } = await make();
    expect(emu.hasRom()).toBe(false);
    await expect(emu.start()).rejects.toThrow('no ROM');
    await emu.start(new Uint8Array([1, 2, 3]));
    expect(emu.hasRom()).toBe(true);
    expect(calls).toEqual(['sync', 'load /data/games/emerald.gba']);
    await emu.forgetRom();
    expect(emu.hasRom()).toBe(false);
  });

  it('drops the core auto-save state before booting', async () => {
    const { emu, files } = await make();
    files.set('/autosave/patched.ss', new Uint8Array([1]));
    await emu.start(new Uint8Array([1]));
    expect(files.has('/autosave/patched.ss')).toBe(false);
  });

  it('reads back the stored ROM bytes', async () => {
    const { emu } = await make();
    const bytes = new Uint8Array([5, 6, 7]);
    await emu.start(bytes);
    expect(emu.readRom()).toEqual(bytes);
  });

  it('boots patched bytes from a separate path, leaving the stored ROM untouched', async () => {
    const { emu, calls, files } = await make();
    const original = new Uint8Array([1, 2, 3]);
    await emu.start(original);
    calls.length = 0; // drop the initial-boot log; only care about startBytes from here

    const patched = new Uint8Array([9, 9, 9, 9]);
    await emu.startBytes(patched);

    expect(calls).toEqual(['load /patched.gba']);
    expect(files.get('/patched.gba')).toEqual(patched);
    expect(emu.readRom()).toEqual(original);
    expect(emu.isRunning()).toBe(true);
  });

  it('never stores the patched image in IndexedDB: nothing under /data but the ROM, no sync (POK-330 #40)', async () => {
    const { emu, calls, files } = await make();
    await emu.start(new Uint8Array([1, 2, 3]));
    calls.length = 0;
    await emu.startBytes(new Uint8Array([9, 9]));
    await emu.reboot();
    expect(calls).not.toContain('sync');
    expect([...files.keys()].filter((p) => p.startsWith('/data/'))).toEqual(['/data/games/emerald.gba']);
  });

  it('drops the patched copy an older shell stored, once, and Forget takes it too (POK-330 #40)', async () => {
    const core = fakeCore();
    core.files.set('/data/games/patched.gba', new Uint8Array([7]));
    await Emulator.create({} as HTMLCanvasElement, async () => core.m);
    expect(core.files.has('/data/games/patched.gba')).toBe(false);
    expect(core.calls).toEqual(['sync']);

    // A second start finds nothing to drop and writes nothing.
    core.calls.length = 0;
    const emu = await Emulator.create({} as HTMLCanvasElement, async () => core.m);
    expect(core.calls).toEqual([]);

    // An old copy that reappears (another tab on an old shell) goes with the ROM.
    await emu.start(new Uint8Array([1]));
    core.files.set('/data/games/patched.gba', new Uint8Array([7]));
    await emu.forgetRom();
    expect([...core.files.keys()].filter((p) => p.startsWith('/data/'))).toEqual([]);
  });

  it('sends only key transitions', async () => {
    const { emu, calls } = await make();
    emu.press('a');
    emu.press('a');
    emu.setKeys((1 << KEY_BIT.a) | (1 << KEY_BIT.right));
    emu.setKeys(0);
    expect(calls).toEqual(['press a', 'press right', 'release a', 'release right']);
    expect(emu.keys()).toBe(0);
    expect(ALL_KEYS).toHaveLength(10);
  });

  it('reads and writes EWRAM and IWRAM through the heap views', async () => {
    const { emu, heap } = await make();
    heap[0x1000 + 0x10] = 0x78;
    heap[0x1000 + 0x11] = 0x56;
    heap[0x1000 + 0x12] = 0x34;
    heap[0x1000 + 0x13] = 0x12;
    expect(emu.read(EWRAM_BASE + 0x10)).toBe(0x12345678);
    expect(emu.read(EWRAM_BASE + 0x10, 16)).toBe(0x5678);
    expect(emu.read(EWRAM_BASE + 0x13, 8)).toBe(0x12);
    emu.write(IWRAM_BASE + 0x5d90, 0x0200c9bc);
    expect(heap[0x50000 + 0x5d90]).toBe(0xbc);
    expect(emu.read(IWRAM_BASE + 0x5d90)).toBe(0x0200c9bc);
    const view = emu.bytes(EWRAM_BASE + 0x10, 4);
    view[0] = 0xff;
    expect(heap[0x1010]).toBe(0xff);
    expect(() => emu.read(0x08000000)).toThrow('not in EWRAM');
  });

  describe('the keyboard (POK-330 #56)', () => {
    const MAP = { ArrowUp: 'up', z: 'a' } as const;
    const key = (type: string, k: string, repeat = false) => Object.assign(new Event(type, { cancelable: true }), { key: k, repeat });
    async function bound(divert?: (key: GbaKey, repeat: boolean) => boolean) {
      const got = await make();
      const win = new EventTarget();
      const doc = Object.assign(new EventTarget(), { hidden: false });
      const unbind = got.emu.bindKeyboard(MAP, divert, { win, doc });
      got.calls.length = 0;
      return { ...got, win, doc, unbind };
    }

    it('a release reaches the core even while a drawn screen has the presses', async () => {
      let drawn = false;
      const taken: GbaKey[] = [];
      const { win, calls } = await bound((k, repeat) => {
        if (!drawn) return false;
        if (!repeat) taken.push(k);
        return true;
      });
      win.dispatchEvent(key('keydown', 'ArrowUp')); // walking...
      drawn = true; // ...when the room screen comes up
      win.dispatchEvent(key('keydown', 'z'));
      win.dispatchEvent(key('keyup', 'ArrowUp'));
      expect(taken).toEqual(['a']);
      expect(calls).toEqual(['press up', 'release up']);
    });

    it('lets go of everything when the window blurs or the tab hides', async () => {
      const { emu, win, doc, calls } = await bound();
      win.dispatchEvent(key('keydown', 'ArrowUp'));
      emu.press('b'); // a pad or the touch layer, holding its own
      win.dispatchEvent(new Event('blur'));
      expect(emu.keys()).toBe(0);
      expect(calls).toEqual(['press up', 'press b', 'release b', 'release up']);

      win.dispatchEvent(key('keydown', 'z'));
      doc.dispatchEvent(new Event('visibilitychange')); // shown: nothing to do
      expect(emu.keys()).toBe(1 << KEY_BIT.a);
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(emu.keys()).toBe(0);
    });

    it('ignores keys it does not map, and unbinds', async () => {
      const { emu, win, calls, unbind } = await bound();
      const other = key('keydown', 'q');
      win.dispatchEvent(other);
      expect(other.defaultPrevented).toBe(false);
      unbind();
      win.dispatchEvent(key('keydown', 'z'));
      expect(emu.keys()).toBe(0);
      expect(calls).toEqual([]);
    });
  });

  it('keeps its RAM views between reads, and remakes them for a new core or a new heap (POK-330 #65)', async () => {
    const { emu, m } = await make();
    let wramAt = 0x1000;
    let asked = 0;
    m._brWramPtr = () => (asked++, wramAt);
    await emu.start(new Uint8Array([1]));
    m.HEAPU8[0x1000 + 4] = 0x2a;
    for (let i = 0; i < 100; i++) expect(emu.read(EWRAM_BASE + 4, 8)).toBe(0x2a);
    expect(asked).toBe(1);

    // A reboot builds a new core, whose RAM can be anywhere.
    wramAt = 0x3000;
    m.HEAPU8[0x3000 + 4] = 0x33;
    await emu.reboot();
    expect(emu.read(EWRAM_BASE + 4, 8)).toBe(0x33);
    expect(asked).toBe(2);

    // Memory growth replaces the heap under the same pointers.
    const grown = new Uint8Array(2 << 20);
    grown[0x3000 + 4] = 0x44;
    m.HEAPU8 = grown;
    expect(emu.read(EWRAM_BASE + 4, 8)).toBe(0x44);

    // A stopped core has no RAM to read.
    emu.stop();
    wramAt = 0;
    expect(() => emu.read(EWRAM_BASE + 4, 8)).toThrow('no GBA core loaded');
  });

  it('delivers frame callbacks registered after loadGame', async () => {
    const { emu, frame } = await make();
    let n = 0;
    const off = emu.onFrame(() => n++);
    frame(); // before start: no core, no callback registered
    await emu.start(new Uint8Array([1]));
    frame();
    frame();
    off();
    frame();
    expect(n).toBe(2);
  });

  it('a throwing frame listener stops neither the others nor the present, and is logged once (POK-330 #35)', async () => {
    const { emu, m, frame } = await make();
    let presents = 0;
    m._brPresent = () => void presents++;
    let after = 0;
    emu.onFrame(() => {
      throw new Error('bad pointer');
    });
    emu.onFrame(() => void after++);
    await emu.start(new Uint8Array([1]));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // A throw out of this callback is a core thread blocked for good.
      expect(() => frame()).not.toThrow();
      frame();
      frame();
      expect(after).toBe(3);
      expect(presents).toBe(3);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  it('onListenerError hears each listener\'s first throw instead of the console', async () => {
    const { emu, frame } = await make();
    const heard: string[] = [];
    emu.onFrame(() => {
      throw new Error('one');
    });
    emu.onFrame(() => {
      throw new Error('two');
    });
    emu.onListenerError((err) => heard.push((err as Error).message));
    await emu.start(new Uint8Array([1]));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      frame();
      frame();
      expect(heard).toEqual(['one', 'two']);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('returns screenshot bytes', async () => {
    const { emu } = await make();
    await emu.start(new Uint8Array([1]));
    expect(emu.screenshot()).toEqual(new Uint8Array([0x89, 0x50]));
  });
});
