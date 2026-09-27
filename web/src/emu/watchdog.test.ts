import { describe, expect, it } from 'vitest';
import { fakeCore } from './fake-core';
import { EWRAM_BASE, Emulator } from './index';
import { TICK_MS, Watchdog, readStall, stallLine, watch, type StallKind, type StallReport, type Watched } from './watchdog';

/** An emulator as the watchdog sees it, with the page's holds as plain fields. */
function fakeEmu() {
  const frames = new Set<() => void>();
  const crashes = new Set<() => void>();
  const emu = {
    running: true as boolean,
    paused: false as boolean,
    pauses: 0,
    onFrame(l: () => void) {
      frames.add(l);
      return () => void frames.delete(l);
    },
    onCrash(l: () => void) {
      crashes.add(l);
      return () => void crashes.delete(l);
    },
    isRunning() {
      return this.running;
    },
    isPaused() {
      return this.paused;
    },
  } satisfies Watched & { running: boolean; paused: boolean; pauses: number };
  return { emu, frame: () => frames.forEach((l) => l()), crash: () => crashes.forEach((l) => l()) };
}

/** A page: 60 frames a second, each bumping the ROM's heartbeat, and a tick every
 *  TICK_MS. `run(ms, { frames: false })` is a core that stopped; `beating: false` a ROM
 *  stuck inside one pass of its main loop. */
function page(opts: { heartbeat?: boolean } = {}) {
  const { emu, frame, crash } = fakeEmu();
  const s = { clock: 0, beat: 100, visible: true, stalls: [] as StallKind[], backs: 0 };
  const dog = new Watchdog({
    emu,
    heartbeat: opts.heartbeat === false ? undefined : () => s.beat,
    visible: () => s.visible,
    now: () => s.clock,
    onStall: (kind) => void s.stalls.push(kind),
    onBack: () => void s.backs++,
  });
  let sinceTick = 0;
  const run = (ms: number, { frames = true, beating = true } = {}) => {
    const step = 1000 / 60;
    for (let t = 0; t + step / 2 < ms; t += step) {
      s.clock += step;
      if (frames) {
        if (beating) s.beat++;
        frame();
      }
      sinceTick += step;
      if (sinceTick + step / 2 >= TICK_MS) {
        sinceTick -= TICK_MS;
        dog.tick();
      }
    }
  };
  return { s, emu, dog, run, crash };
}

describe('the watchdog (POK-328)', () => {
  it('calls a core that stops making frames, 3 s after its last one', () => {
    const { s, run } = page();
    run(2000);
    run(2900, { frames: false });
    expect(s.stalls).toEqual([]);
    run(700, { frames: false });
    expect(s.stalls).toEqual(['core']);
  });

  it('calls a ROM whose heartbeat stops while the frames go on, after 180 of them', () => {
    const { s, run } = page();
    run(1000);
    run(2800, { beating: false });
    expect(s.stalls).toEqual([]);
    run(700, { beating: false });
    expect(s.stalls).toEqual(['rom']);
  });

  it('calls a crash at once, and nothing after it, the frames coming back or not', () => {
    const { s, run, crash } = page();
    run(1000);
    crash();
    expect(s.stalls).toEqual(['crash']);
    run(5000, { frames: false });
    run(5000);
    expect(s.stalls).toEqual(['crash']);
    expect(s.backs).toBe(0);
  });

  it('calls a stop once, however long it lasts', () => {
    const { s, run } = page();
    run(1000);
    run(20_000, { frames: false });
    expect(s.stalls).toEqual(['core']);
  });

  it('says nothing while the page holds the core, and counts from the resume', () => {
    // The boot block's hold: the core paused from the mailbox answering until the lobby
    // has chosen a way in -- minutes, if the player takes them.
    const { s, emu, run } = page();
    run(1000);
    emu.paused = true;
    emu.pauses++;
    run(60_000, { frames: false });
    expect(s.stalls).toEqual([]);
    emu.paused = false;
    run(2500, { frames: false });
    expect(s.stalls, 'the frames it held were not a stop').toEqual([]);
    run(1000, { frames: false });
    expect(s.stalls, 'a core that never came back from it is').toEqual(['core']);
  });

  it('says nothing while the tab is hidden, and counts from when it shows', () => {
    const { s, run } = page();
    run(1000);
    s.visible = false;
    run(30_000, { frames: false });
    expect(s.stalls).toEqual([]);
    s.visible = true;
    run(2500, { frames: false });
    expect(s.stalls).toEqual([]);
    run(1000, { frames: false });
    expect(s.stalls).toEqual(['core']);
  });

  it('says nothing across a reboot, and waits for the new ROM to move its heartbeat', () => {
    const { s, emu, run } = page();
    run(1000);
    // PLAY AGAIN: the core rebuilt, no frames for a moment, then a ROM whose EWRAM still
    // holds the last run's heartbeat until BrMailbox_Init clears it.
    emu.pauses++;
    run(2900, { frames: false });
    run(5000, { beating: false });
    expect(s.stalls).toEqual([]);
    run(1000);
    expect(s.stalls).toEqual([]);
    run(3500, { beating: false });
    expect(s.stalls, 'and once it has, a stop is a stop again').toEqual(['rom']);
  });

  it('says nothing when its own tick comes late: the page was not running either', () => {
    // A long task on the main thread, or a throttled tab: no tick, and no frame
    // delivered, for five seconds. The frames were not the ones that stopped.
    const { s, dog, run } = page();
    run(1000);
    s.clock += 5000;
    dog.tick();
    run(1000);
    expect(s.stalls).toEqual([]);
  });

  it('never calls a stop on an emulator that is not running', () => {
    const { s, emu, run } = page();
    run(1000);
    emu.running = false;
    emu.pauses++;
    run(10_000, { frames: false });
    expect(s.stalls).toEqual([]);
  });

  it('takes the verdict back when the game comes back, and calls the next stop too', () => {
    const { s, run } = page();
    run(1000);
    run(4000, { frames: false });
    expect(s.stalls).toEqual(['core']);
    run(2000);
    expect(s.backs).toBe(1);
    run(4000, { frames: false });
    expect(s.stalls).toEqual(['core', 'core']);
  });

  it('does not take a ROM stop back for frames alone: the heartbeat has to move', () => {
    const { s, run } = page();
    run(1000);
    run(10_000, { beating: false });
    expect(s.stalls).toEqual(['rom']);
    expect(s.backs).toBe(0);
    run(2000);
    expect(s.backs).toBe(1);
  });

  it('with no heartbeat to read, watches the core alone', () => {
    const { s, run } = page({ heartbeat: false });
    run(1000);
    run(10_000, { beating: false });
    expect(s.stalls).toEqual([]);
    run(4000, { frames: false });
    expect(s.stalls).toEqual(['core']);
    run(2000);
    expect(s.backs).toBe(1);
  });
});

// A symbol table and a ROM mid-battle, on the emulator itself.
const SYMBOLS = new Map<string, number>([
  ['gMain', 0x03000100],
  ['gSaveBlock1Ptr', 0x03000800],
  ['gBrMatch', 0x02000300],
  ['gBrMailbox', 0x02000400],
  ['CB2_Overworld', 0x080862fc],
  ['CB2_BattleMain', 0x08038420],
]);

async function onEmulator(headless = false) {
  const core = fakeCore();
  const emu = await Emulator.create({} as HTMLCanvasElement, async () => core.m, headless);
  await emu.start(new Uint8Array([1]));
  emu.write(0x03000100, 0x08085e25, 32); // gMain.callback1
  emu.write(0x03000104, 0x08038421, 32); // gMain.callback2, Thumb
  emu.write(0x03000100 + 0x439, 0x02, 8); // gMain.inBattle
  emu.write(0x03000800, EWRAM_BASE + 0x1000, 32); // gSaveBlock1Ptr
  emu.write(EWRAM_BASE + 0x1004, 14, 8); // ->location.mapGroup
  emu.write(EWRAM_BASE + 0x1005, 0, 8); // ->location.mapNum
  emu.write(0x02000300, 3, 8); // gBrMatch.phase
  const s = { clock: 0, tick: null as (() => void) | null, cleared: false, reports: [] as StallReport[], backs: 0 };
  const stop = watch({
    emu,
    symbols: SYMBOLS,
    onStall: (r) => void s.reports.push(r),
    onBack: () => void s.backs++,
    visible: () => true,
    now: () => s.clock,
    every: (fn, ms) => {
      expect(ms).toBe(TICK_MS);
      s.tick = fn;
      return () => {
        s.cleared = true;
        s.tick = null;
      };
    },
  });
  let sinceTick = 0;
  const run = (ms: number, { frames = true, beating = true } = {}) => {
    const step = 1000 / 60;
    for (let t = 0; t + step / 2 < ms; t += step) {
      s.clock += step;
      if (frames) {
        if (beating) emu.write(0x02000410, emu.read(0x02000410, 32) + 1, 32); // BrFrame
        core.frame();
      }
      sinceTick += step;
      if (sinceTick + step / 2 >= TICK_MS) {
        sinceTick -= TICK_MS;
        s.tick?.();
      }
    }
  };
  return { emu, core, s, run, stop };
}

describe('watching the page emulator (POK-328)', () => {
  it('reads what the ROM was doing into the report, by name where the table has one', async () => {
    const { emu, s, run } = await onEmulator();
    emu.onListenerError(() => {});
    emu.onFrame(() => {
      throw new Error('a listener with a bug');
    });
    run(1000);
    run(4000, { beating: false });
    expect(s.reports).toEqual([
      { kind: 'rom', cb2: 'CB2_BattleMain', cb1: '0x08085E25', map: '14:0', phase: 3, battle: true, threw: 1 },
    ]);
    expect(stallLine(s.reports[0], 'patch 3 · shell 5f24422 · rom d8db607')).toBe(
      'rom · patch 3 · shell 5f24422 · rom d8db607 · cb2 CB2_BattleMain · cb1 0x08085E25 · map 14:0 · phase 3 · in battle · 1 listener threw',
    );
  });

  it('is not fooled by the page pausing it, resuming it or rebooting it (the boot hold, PLAY AGAIN)', async () => {
    const { emu, s, run } = await onEmulator();
    run(1000);
    emu.pause();
    run(20_000, { frames: false });
    emu.resume();
    run(1000);
    // rebootIntoBr: the reboot, the wait for the mailbox, the hold while the boot block goes in.
    await emu.reboot();
    run(1500, { frames: false });
    run(1000);
    emu.pause();
    run(5000, { frames: false });
    emu.resume();
    run(2000);
    expect(s.reports).toEqual([]);
  });

  it('hears the core crash, with what could still be read', async () => {
    const { core, s, run } = await onEmulator();
    run(1000);
    core.crash();
    expect(s.reports.map((r) => r.kind)).toEqual(['crash']);
  });

  it('a stop takes the watch down', async () => {
    const { s, stop, run } = await onEmulator();
    stop();
    expect(s.cleared).toBe(true);
    run(1000);
    run(4000, { frames: false });
    expect(s.reports).toEqual([]);
  });

  it('never watches a headless core: the proxy is paused between duels by design', async () => {
    const { s, run } = await onEmulator(true);
    expect(s.tick).toBeNull();
    run(1000);
    run(10_000, { frames: false });
    expect(s.reports).toEqual([]);
  });

  it('a core with no RAM left to read still gets its report, empty', () => {
    const r = readStall('crash', { read: () => { throw new Error('no GBA core loaded'); }, threw: 0 }, SYMBOLS);
    expect(r).toEqual({ kind: 'crash', cb2: null, cb1: null, map: null, phase: null, battle: null, threw: 0 });
    expect(stallLine(r, 'patch 3')).toBe('crash · patch 3');
    expect(readStall('core', { read: () => 0 }, null)).toEqual({ kind: 'core', cb2: null, cb1: null, map: null, phase: null, battle: null, threw: 0 });
  });
});
