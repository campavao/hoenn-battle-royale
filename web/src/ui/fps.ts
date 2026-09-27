// The readout in the corner: frames a second, how long they took, and how many frame
// listeners have thrown (POK-331 #29, POK-247).
//
// The emulator catches a listener that throws, so the frame carries on, and reports only
// its first throw (emu/index.ts): the listener is still called every frame, and may fail
// every frame, while the page looks fine and a piece of it -- the mailbox pump, the field
// painter, a bot loop -- quietly does nothing. The console had the first throw; the
// readout says so where somebody trying the page is already looking.
//
// And what a phone needs measured (POK-247): the time between emulated frames as a
// histogram -- the p95 the ticket's acceptance is written in, not a frames-a-second
// average that hides every hitch -- the page's own share of each frame, the speaker's
// late and cut buffers (emu/audio-meter.ts), the JS heap where the browser tells, and
// what the proxy duel instance is doing. In DEV always; in a build with `#perf`.

import type { ProxyCounts } from '../bots/proxy';
import { AudioMeter, type AudioStats, type Heard } from '../emu/audio-meter';

/** What the meter needs of the emulator. */
export interface Metered {
  onFrame(listener: () => void): () => void;
  onListenerError(listener: (err: unknown) => void): () => void;
  /** The page's own work in each frame, ms (Emulator.onFrameWork). */
  onFrameWork?(listener: (ms: number) => void): () => void;
  /** Goes up across a pause, a boot or a stop: the gap over one is not a frame. */
  readonly pauses?: number;
}

/** Fixed bins, so a window costs the same however long it runs, and a quantile is good
 *  to a bin's width -- half a millisecond for a frame, which is all a p95 of 16.7 against
 *  a 20 ms target needs. Past the last bin, only the count and the true max are kept. */
export class Histogram {
  private readonly bins: Uint32Array;
  count = 0;
  sum = 0;
  max = 0;

  constructor(
    private readonly width: number,
    size: number,
  ) {
    this.bins = new Uint32Array(size + 1);
  }

  add(ms: number): void {
    const bin = Math.min(this.bins.length - 1, Math.max(0, Math.floor(ms / this.width)));
    this.bins[bin]++;
    this.count++;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
  }

  /** The q-th quantile, to the upper edge of its bin and never past the largest seen;
   *  0 with nothing in it. */
  quantile(q: number): number {
    if (this.count === 0) return 0;
    const want = Math.max(1, Math.ceil(q * this.count));
    let seen = 0;
    for (let i = 0; i < this.bins.length; i++) {
      seen += this.bins[i];
      if (seen >= want) return i === this.bins.length - 1 ? this.max : Math.min(this.max, (i + 1) * this.width);
    }
    return this.max;
  }

  clear(): void {
    this.bins.fill(0);
    this.count = 0;
    this.sum = 0;
    this.max = 0;
  }
}

/** A window of frames. Times in ms. */
export interface FrameStats {
  frames: number;
  fps: number;
  /** Between one emulated frame and the next, as the page sees them arrive. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** The page's own part of a frame: every listener, and the present. */
  work: { mean: number; p95: number; max: number };
  /** Frame listeners that have thrown so far (not per window: each is heard once). */
  threw: number;
}

export class FrameMeter {
  private frames = 0;
  private errors = 0;
  private since: number;
  private readonly gaps = new Histogram(0.5, 200);
  private readonly work = new Histogram(0.1, 200);
  private lastFrame: number | null = null;
  private lastPauses = 0;

  constructor(
    private readonly emu: Metered,
    private readonly now: () => number = () => performance.now(),
    /** Hearing the errors takes them off the console, which is where the emulator puts
     *  them with nobody listening: so they go back there as well. */
    log: (err: unknown) => void = (err) => console.error('[emu] a frame listener threw; the frame carries on without it', err),
  ) {
    this.since = now();
    this.lastPauses = emu.pauses ?? 0;
    emu.onFrame(() => {
      this.frames++;
      const t = this.now();
      const pauses = this.emu.pauses ?? 0;
      if (this.lastFrame !== null && pauses === this.lastPauses) this.gaps.add(t - this.lastFrame);
      this.lastFrame = t;
      this.lastPauses = pauses;
    });
    emu.onFrameWork?.((ms) => this.work.add(ms));
    emu.onListenerError((err) => {
      this.errors++;
      log(err);
    });
  }

  /** The frames since the last read, and the listeners that have thrown so far. */
  stats(reset = true): FrameStats {
    const now = this.now();
    const out: FrameStats = {
      frames: this.frames,
      fps: (this.frames * 1000) / Math.max(1, now - this.since),
      p50: this.gaps.quantile(0.5),
      p95: this.gaps.quantile(0.95),
      p99: this.gaps.quantile(0.99),
      max: this.gaps.max,
      work: {
        mean: this.work.count ? this.work.sum / this.work.count : 0,
        p95: this.work.quantile(0.95),
        max: this.work.max,
      },
      threw: this.errors,
    };
    if (reset) {
      this.frames = 0;
      this.since = now;
      this.gaps.clear();
      this.work.clear();
    }
    return out;
  }

  /** The line: frames a second since the last read, how long the slow ones took, and
   *  how many listeners have thrown so far -- each counted once, at its first throw,
   *  since that is all the emulator reports. Listeners that have thrown, not ones that
   *  stopped: they are still called. */
  read(): string {
    return frameLine(this.stats());
  }
}

function ms(n: number): string {
  return n.toFixed(0);
}

/** `60 fps · p95 17 · max 34 ms`, and the listeners that threw. */
export function frameLine(s: FrameStats): string {
  const times = s.frames > 1 && s.max > 0 ? ` · p95 ${ms(s.p95)} · max ${ms(s.max)} ms` : '';
  const threw = s.threw === 0 ? '' : ` · ${s.threw} listener${s.threw === 1 ? '' : 's'} threw`;
  return `${s.fps.toFixed(0)} fps${times}${threw}`;
}

/** One reading of everything: a window of frames and audio, and the running totals. */
export interface PerfSample {
  frames: FrameStats;
  audio: AudioStats;
  /** The JS heap, where the browser says (Chromium's performance.memory); null elsewhere. */
  heapMb: number | null;
  proxy: ProxyCounts | null;
}

/** A meter of each kind over one emulator, read together. One per reader: the overlay
 *  keeps two (this second, and since the page opened) and a spec makes its own. */
export class PerfProbe {
  private readonly frameMeter: FrameMeter;
  private readonly audioMeter: AudioMeter;
  private readonly heap: () => number | null;

  constructor(
    emu: Metered & Heard,
    private readonly proxy: () => ProxyCounts | null = () => null,
    opts: { now?: () => number; log?: (err: unknown) => void; heap?: () => number | null } = {},
  ) {
    this.frameMeter = new FrameMeter(emu, opts.now, opts.log);
    this.audioMeter = new AudioMeter(emu);
    this.heap = opts.heap ?? jsHeap;
  }

  sample(reset = true): PerfSample {
    const heap = this.heap();
    return {
      frames: this.frameMeter.stats(reset),
      audio: this.audioMeter.stats(reset),
      heapMb: heap === null ? null : Math.round(heap / (1024 * 1024)),
      proxy: this.proxy(),
    };
  }
}

function jsHeap(): number | null {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

/** The `#perf` readout: this second, then the whole page so far -- the line Cam
 *  screenshots at the end of a match on a phone. */
export function perfLines(now: PerfSample, all: PerfSample): string[] {
  const audio = (a: AudioStats) =>
    a.callbacks === 0 ? `audio ${a.state === 'none' ? 'off' : a.state}` : `audio ${a.late} late ${a.cut} cut`;
  const first = `${frameLine(now.frames)} · work ${now.frames.work.mean.toFixed(1)} ms · ${audio(now.audio)}`;
  const f = all.frames;
  const parts = [
    `all ${f.frames} frames · p95 ${ms(f.p95)} p99 ${ms(f.p99)} max ${ms(f.max)} ms`,
    `work p95 ${f.work.p95.toFixed(1)} ms`,
    audio(all.audio),
  ];
  if (all.heapMb !== null) parts.push(`heap ${all.heapMb} MB`);
  const p = all.proxy;
  if (p) parts.push(p.booted ? `proxy ${p.fought} fought ${p.fellBack} fell back ${p.frames} frames` : 'proxy idle');
  return [first, parts.join(' · ')];
}
