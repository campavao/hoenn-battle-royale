// What the speaker heard (POK-247): every audio callback of the core, and which of them
// crackled.
//
// There is no worklet. The core's sound is SDL2's ScriptProcessorNode, which asks the
// MAIN thread for its next buffer -- 1024 samples at 48 kHz, about 21 ms -- so any task
// on the page longer than that can make the speaker click, and nothing measured it. Two
// ways a buffer goes wrong, and both are counted here:
//
//   late     the page was too busy to run the callback in time, and the output
//            skipped. Two ways to see it: the buffer's `playbackTime` is already behind
//            the context's clock, or -- Chromium, which stamps playbackTime when the
//            event runs, so it is never behind -- more than two buffers' time passed
//            since the last callback, and a ScriptProcessorNode has only two.
//   starved  the core had fewer samples than the buffer wanted. mGBA's SDL callback
//            fills the rest with zeros (sdl-audio.c, `available < len`), so the tail of
//            a buffer that had sound in it goes flat: the emulator fell behind.
//
// Pure over the Web Audio types, so it runs under vitest with a hand-made event.

/** One callback, as heard. */
export interface AudioTick {
  /** When it ran, in performance.now() time. */
  at: number;
  /** Its buffer's length, ms. */
  bufferMs: number;
  late: boolean;
  starved: boolean;
  state: AudioContextState;
}

/** What a meter listens to (Emulator.onAudio). */
export interface Heard {
  onAudio(listener: (tick: AudioTick) => void): () => void;
}

/** The core's SDL2 audio, as emscripten leaves it on the Module. Made when a game's
 *  thread starts, and made again on every boot. */
export interface SdlAudio {
  audio?: { scriptProcessorNode?: ScriptProcessorNode };
  audioContext?: AudioContext;
}

/** Samples of flat silence a buffer must end on, after sound, to count as starved. A
 *  sample of music crosses zero now and then; sixteen in a row at the very end is the
 *  zero-fill. */
export const STARVED_TAIL = 16;

type Buffer = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'getChannelData'>;

/** How many samples at the end of the buffer are silent on every channel, when
 *  something before them was not; 0 for a buffer with sound to the end, or none at all. */
export function silentTail(buffer: Buffer): number {
  let lastSound = -1;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = data.length - 1; i > lastSound; i--) {
      if (data[i] !== 0) {
        lastSound = i;
        break;
      }
    }
  }
  return lastSound < 0 ? 0 : buffer.length - 1 - lastSound;
}

/** Hears every callback of `node` from now on; the core's own callback runs first and
 *  exactly as before. */
export function tapNode(
  node: ScriptProcessorNode,
  ctx: Pick<AudioContext, 'currentTime' | 'sampleRate' | 'state'>,
  emit: (tick: AudioTick) => void,
  now: () => number = () => performance.now(),
): void {
  const own = node.onaudioprocess;
  let last: number | null = null;
  node.onaudioprocess = function (this: ScriptProcessorNode, e: AudioProcessingEvent) {
    const at = now();
    const out = e.outputBuffer;
    const bufferMs = (out.length * 1000) / (out.sampleRate || ctx.sampleRate);
    const late = e.playbackTime < ctx.currentTime || (last !== null && at - last > 2 * bufferMs);
    last = at;
    own?.call(this, e);
    emit({ at, bufferMs, late, starved: silentTail(out) >= STARVED_TAIL, state: ctx.state });
  };
}

/** What a window of callbacks came to. */
export interface AudioStats {
  callbacks: number;
  late: number;
  starved: number;
  /** The longest wait between two callbacks, ms: past two buffers, one was missed. */
  maxGapMs: number;
  bufferMs: number;
  /** The context's state at the last callback; 'none' before any. A suspended context
   *  runs no callbacks at all (SDL feeds it from a timer), so 0 late means nothing then. */
  state: AudioContextState | 'none';
}

/** Counts callbacks from the moment it is made, a window at a time (FrameMeter's shape:
 *  one per reader, so the overlay and a spec do not reset each other's). */
export class AudioMeter {
  private callbacks = 0;
  private late = 0;
  private starved = 0;
  private maxGap = 0;
  private lastAt: number | null = null;
  private bufferMs = 0;
  private state: AudioStats['state'] = 'none';

  constructor(source: Heard) {
    source.onAudio((tick) => {
      this.callbacks++;
      if (tick.late) this.late++;
      if (tick.starved) this.starved++;
      if (this.lastAt !== null) this.maxGap = Math.max(this.maxGap, tick.at - this.lastAt);
      this.lastAt = tick.at;
      this.bufferMs = tick.bufferMs;
      this.state = tick.state;
    });
  }

  /** The window since the last read (or since the meter was made). */
  stats(reset = true): AudioStats {
    const out: AudioStats = {
      callbacks: this.callbacks,
      late: this.late,
      starved: this.starved,
      maxGapMs: this.maxGap,
      bufferMs: this.bufferMs,
      state: this.state,
    };
    if (reset) {
      this.callbacks = 0;
      this.late = 0;
      this.starved = 0;
      this.maxGap = 0;
    }
    return out;
  }
}
