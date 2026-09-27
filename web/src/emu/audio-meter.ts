// What the speaker heard (POK-247): every audio callback of the core, and which of them
// crackled.
//
// There is no worklet. The core's sound is SDL2's ScriptProcessorNode, which asks the
// MAIN thread for its next buffer -- 1024 samples at 48 kHz, about 21 ms -- so any task
// on the page longer than that can make the speaker click, and nothing measured it. Two
// ways a buffer goes wrong, and both are counted here:
//
//   late  the page was too busy to run the callback in time, and the output skipped.
//         Two ways to see it: the buffer's `playbackTime` is already behind the
//         context's clock, or -- Chromium, which stamps playbackTime when the event
//         runs, so it is never behind -- more than two buffers' time passed since the
//         last callback, and a ScriptProcessorNode has only two.
//   cut   sound stopped dead inside the buffer: a stretch of it, then digital silence.
//         mGBA's SDL callback fills whatever the core could not supply with zeros
//         (sdl-audio.c, `available < len`), which is one cut, at the end; a dropout in
//         the game's own output is another, anywhere. Music fades; it does not drop to
//         exact zero sixteen samples at a time. The first soaks found the second kind:
//         a player who was out heard, in every 800-sample frame, ~173 samples of sound
//         and ~627 of silence -- the ROM's follow starting its warp, and SE_EXIT, again
//         every frame (br_spectate.c FollowTick; e2e/out-watch.spec.ts holds it).
//
// Pure over the Web Audio types, so it runs under vitest with a hand-made event.

/** One callback, as heard. */
export interface AudioTick {
  /** When it ran, in performance.now() time. */
  at: number;
  /** Its buffer's length, ms. */
  bufferMs: number;
  late: boolean;
  cut: boolean;
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

/** Samples of unbroken sound a cut must stop: music at a level worth hearing is almost
 *  never exactly zero on every channel at once. */
export const CUT_SOUND = 64;
/** ...at least this loud somewhere in them, 1/512 of full scale: quiet music is mostly
 *  zeros, and its silences are its own. */
export const CUT_LEVEL = 1 / 512;
/** Samples of digital silence, on every channel, that make it a cut. */
export const CUT_SILENCE = 16;

type Buffer = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'getChannelData'>;

/** Does sound stop dead anywhere in the buffer: CUT_SOUND samples of it, reaching
 *  CUT_LEVEL, and then CUT_SILENCE of silence? */
export function cutOff(buffer: Buffer): boolean {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let sound = 0;
  let peak = 0;
  let silence = 0;
  let heard = false; // the sound run before this silence was one worth cutting
  for (let i = 0; i < buffer.length; i++) {
    let loudest = 0;
    for (const d of channels) loudest = Math.max(loudest, Math.abs(d[i]));
    if (loudest === 0) {
      if (silence === 0) heard = sound >= CUT_SOUND && peak >= CUT_LEVEL;
      if (++silence >= CUT_SILENCE && heard) return true;
      sound = 0;
      peak = 0;
    } else {
      silence = 0;
      sound++;
      peak = Math.max(peak, loudest);
    }
  }
  return false;
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
    emit({ at, bufferMs, late, cut: cutOff(out), state: ctx.state });
  };
}

/** What a window of callbacks came to. */
export interface AudioStats {
  callbacks: number;
  late: number;
  cut: number;
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
  private cut = 0;
  private maxGap = 0;
  private lastAt: number | null = null;
  private bufferMs = 0;
  private state: AudioStats['state'] = 'none';

  constructor(source: Heard) {
    source.onAudio((tick) => {
      this.callbacks++;
      if (tick.late) this.late++;
      if (tick.cut) this.cut++;
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
      cut: this.cut,
      maxGapMs: this.maxGap,
      bufferMs: this.bufferMs,
      state: this.state,
    };
    if (reset) {
      this.callbacks = 0;
      this.late = 0;
      this.cut = 0;
      this.maxGap = 0;
    }
    return out;
  }
}
