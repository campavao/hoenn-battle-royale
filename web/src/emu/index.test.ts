import { describe, expect, it, vi } from 'vitest';
import { fakeCore } from './fake-core';
import { ALL_KEYS, EWRAM_BASE, Emulator, IWRAM_BASE, KEY_BIT, type GbaKey } from './index';

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

  // A reboot's loadGame returns before the core thread swaps cores: the old core's last
  // frames still run the listeners, and a view made there must not outlive the frame.
  it("a core that moves its RAM after loadGame returned is followed from the next frame", async () => {
    const { emu, m, frame } = await make();
    let wramAt = 0x1000;
    m._brWramPtr = () => wramAt;
    await emu.start(new Uint8Array([1]));
    m.HEAPU8[0x1000 + 4] = 0x11;
    const seen: number[] = [];
    emu.onFrame(() => seen.push(emu.read(EWRAM_BASE + 4, 8)));
    await emu.reboot();
    frame(); // the old core's last frame, still reporting the old RAM
    wramAt = 0x5000; // ...and now the new core is up somewhere else
    m.HEAPU8[0x5000 + 4] = 0x55;
    frame();
    expect(seen).toEqual([0x11, 0x55]);
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

  describe('what a phone needs measured (POK-247)', () => {
    it("times the page's own share of each frame, the present included", async () => {
      const { emu, m, frame } = await make();
      let clock = 0;
      const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
      try {
        m._brPresent = () => void (clock += 2);
        emu.onFrame(() => void (clock += 3));
        const work: number[] = [];
        emu.onFrameWork((ms) => void work.push(ms));
        await emu.start(new Uint8Array([1]));
        frame();
        frame();
        expect(work).toEqual([5, 5]);
      } finally {
        now.mockRestore();
      }
    });

    it("hears the core's audio output from the first frame SDL has opened it, and again after a boot", async () => {
      const { emu, m, frame } = await make();
      const ctx = { currentTime: 1, sampleRate: 48000, state: 'running' } as AudioContext;
      const out = { numberOfChannels: 1, length: 1024, sampleRate: 48000, getChannelData: () => new Float32Array(1024).fill(0.5) };
      const node = () => ({ onaudioprocess: () => {} }) as unknown as ScriptProcessorNode;
      const play = (n: ScriptProcessorNode, playbackTime: number) =>
        n.onaudioprocess!.call(n, { outputBuffer: out, playbackTime } as unknown as AudioProcessingEvent);
      const heard: boolean[] = [];
      emu.onAudio((tick) => void heard.push(tick.late));
      await emu.start(new Uint8Array([1]));
      frame(); // no audio opened yet: nothing to hear, nothing thrown

      const first = node();
      m.SDL2 = { audio: { scriptProcessorNode: first }, audioContext: ctx };
      frame();
      frame(); // the same node is not wrapped twice
      play(first, 1.02);
      play(first, 0.9);
      expect(heard).toEqual([false, true]);

      // A boot opens the audio again, on a node of its own.
      await emu.reboot();
      const second = node();
      m.SDL2 = { audio: { scriptProcessorNode: second }, audioContext: ctx };
      frame();
      play(second, 0.5);
      expect(heard).toEqual([false, true, true]);
    });

    it('turns rewind and the auto-save state off before the core loads anything', async () => {
      // Rewind was a full savestate every frame, diffed on a thread of its own, and the
      // auto-save a SAVESTATE_ALL on the main thread every 30 s synced to IndexedDB --
      // in both cores, for a page that never rewinds and deletes the auto-save anyway.
      const core = fakeCore();
      const order: string[] = [];
      core.m.setCoreSettings = (settings) => void order.push(`settings ${JSON.stringify(settings)}`);
      const load = core.m.loadGame;
      core.m.loadGame = (p, o) => (order.push('load'), load(p, o));
      const emu = await Emulator.create({} as HTMLCanvasElement, async () => core.m);
      await emu.start(new Uint8Array([1]));
      await emu.reboot();
      expect(order).toEqual(['settings {"rewindEnable":false,"autoSaveStateEnable":false,"restoreAutoSaveStateOnLoad":false}', 'load', 'load']);
    });

    it('a headless core keeps its sound paused after every boot and every resume; a shown one plays', async () => {
      const heard: string[] = [];
      const hidden = fakeCore();
      hidden.m.pauseAudio = () => void heard.push('hidden');
      const emu = await Emulator.create({} as HTMLCanvasElement, async () => hidden.m, true);
      await emu.startBytes(new Uint8Array([1]));
      hidden.frame(); // SDL opened the audio as the thread started, and resumed it
      hidden.frame();
      expect(heard).toEqual(['hidden']);
      emu.pause();
      emu.resume(); // resumeGame resumes SDL's audio too
      hidden.frame();
      await emu.reboot();
      hidden.frame();
      expect(heard).toEqual(['hidden', 'hidden', 'hidden']);

      const shown = fakeCore();
      shown.m.pauseAudio = () => void heard.push('shown');
      const visible = await Emulator.create({} as HTMLCanvasElement, async () => shown.m);
      await visible.startBytes(new Uint8Array([1]));
      shown.frame();
      expect(heard).not.toContain('shown');
    });

    it('counts every stop the page makes, so a meter skips the gap across it', async () => {
      const { emu } = await make();
      await emu.start(new Uint8Array([1]));
      const booted = emu.pauses;
      emu.pause();
      emu.resume();
      expect(emu.pauses).toBe(booted + 1);
      await emu.reboot();
      emu.stop();
      expect(emu.pauses).toBe(booted + 3);
    });
  });

  describe('what a watchdog reads (POK-328)', () => {
    it('says it is paused from pause() to resume(), and a boot starts it running', async () => {
      const { emu } = await make();
      await emu.start(new Uint8Array([1]));
      expect(emu.isPaused()).toBe(false);
      emu.pause();
      expect(emu.isPaused()).toBe(true);
      emu.resume();
      expect(emu.isPaused()).toBe(false);
      emu.pause();
      await emu.reboot();
      expect(emu.isPaused()).toBe(false);
    });

    it('counts the frame listeners that have thrown, each once', async () => {
      const { emu, frame } = await make();
      emu.onListenerError(() => {});
      emu.onFrame(() => {
        throw new Error('one');
      });
      emu.onFrame(() => {
        throw new Error('two');
      });
      emu.onFrame(() => {});
      await emu.start(new Uint8Array([1]));
      expect(emu.threw).toBe(0);
      frame();
      frame();
      expect(emu.threw).toBe(2);
    });
  });

  it('returns screenshot bytes', async () => {
    const { emu } = await make();
    await emu.start(new Uint8Array([1]));
    expect(emu.screenshot()).toEqual(new Uint8Array([0x89, 0x50]));
  });
});
