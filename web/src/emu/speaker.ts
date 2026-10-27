// The speaker's side of the core's sound ring (HBR-59), run on the audio thread by
// speaker-worklet.ts. The core's thread resamples each frame's sound to the speaker's rate
// and leaves it in `struct BrAudio` (tools/br/mgba-wasm/hbr-exports.patch, main.c), in the
// module's shared memory; this reads it 128 frames at a time, as an AudioWorklet asks.
// Nothing here waits on the page's main thread, which is what made SDL2's
// ScriptProcessorNode crackle whenever the page was busy.
//
// Pure over typed arrays, so it runs under vitest.

/** struct BrAudio's u32 header: frames written and played ever, frames the core had no
 *  room for, the speaker's rate, and the fill the core aims at. */
export const RING_WRITE = 0;
export const RING_READ = 1;
export const RING_DROPPED = 2;
export const RING_RATE = 3;
export const RING_LEAD = 4;
export const RING_HEADER_U32 = 8;
/** BR_AUDIO_RING: stereo frames in the ring. */
export const RING_FRAMES = 8192;

/** What one quantum came to. */
export interface Played {
  /** Frames there was sound for. */
  frames: number;
  /** The ring ran dry while playing: the speaker heard a gap. */
  under: boolean;
  /** Frames of stale sound jumped over: a ring that filled while nobody played it. */
  skipped: number;
}

/** Leads of sound in the ring past which the reader skips to the newest one. */
export const SKIP_LEADS = 3;

/** Reads the ring. `header` is the u32 view at the ring's address, `samples` the s16 view
 *  just past the header. */
export class RingReader {
  /** Waiting for a lead of sound before playing: at the start, after a pause, after the
   *  ring ran dry. */
  private playing = false;

  constructor(
    private readonly header: Uint32Array,
    private readonly samples: Int16Array,
  ) {}

  /** Fills `left` and `right` (one quantum), silence where there is no sound. Paused,
   *  plays nothing and counts nothing, and waits for a lead again after. */
  play(left: Float32Array, right: Float32Array, paused: boolean): Played {
    const want = left.length;
    const write = Atomics.load(this.header, RING_WRITE);
    let read = Atomics.load(this.header, RING_READ);
    const lead = this.header[RING_LEAD] || 1;
    let fill = (write - read) >>> 0;
    if (paused || (!this.playing && fill < lead)) {
      if (paused) this.playing = false;
      left.fill(0);
      right.fill(0);
      return { frames: 0, under: false, skipped: 0 };
    }
    // Far past the lead -- a context that was suspended while the core ran on, or a
    // ring the core filled while nobody played it: the newest lead of it, not stale
    // sound. Past the core's own bursts: four frames of catch-up on top of the lead
    // stay under it.
    let skipped = 0;
    if (fill > SKIP_LEADS * lead || fill > RING_FRAMES) {
      skipped = fill - lead;
      read = (write - lead) >>> 0;
      fill = lead;
    }
    this.playing = true;
    const n = Math.min(want, fill);
    for (let i = 0; i < n; i++) {
      const at = ((read + i) % RING_FRAMES) * 2;
      left[i] = this.samples[at] / 32768;
      right[i] = this.samples[at + 1] / 32768;
    }
    left.fill(0, n);
    right.fill(0, n);
    Atomics.store(this.header, RING_READ, (read + n) >>> 0);
    const under = n < want;
    if (under) this.playing = false;
    return { frames: n, under, skipped };
  }
}

/** Samples of unbroken sound a cut must stop: music at a level worth hearing is almost
 *  never exactly zero on every channel at once (audio-meter.ts's cutOff, streamed). */
export const CUT_SOUND = 64;
export const CUT_LEVEL = 1 / 512;
export const CUT_SILENCE = 16;

/** audio-meter.ts's cutOff over a stream of quanta: sound stopping dead, CUT_SOUND samples
 *  of it reaching CUT_LEVEL and then CUT_SILENCE of silence, across quantum edges too. */
export class CutDetector {
  private sound = 0;
  private peak = 0;
  private silence = 0;
  private heard = false;

  /** Whether a cut ended in these samples. */
  feed(left: Float32Array, right: Float32Array): boolean {
    let cut = false;
    for (let i = 0; i < left.length; i++) {
      const loudest = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      if (loudest === 0) {
        if (this.silence === 0) this.heard = this.sound >= CUT_SOUND && this.peak >= CUT_LEVEL;
        if (++this.silence === CUT_SILENCE && this.heard) cut = true;
        this.sound = 0;
        this.peak = 0;
      } else {
        this.silence = 0;
        this.sound++;
        this.peak = Math.max(this.peak, loudest);
      }
    }
    return cut;
  }
}

/** What the worklet posts to the page every TICK_QUANTA quanta: as many frames as one of
 *  SDL's old callbacks, so the audio meter's counts mean what they did. */
export interface SpeakerTick {
  /** Frames of the tick, played or silent. */
  frames: number;
  /** ...and of those, the ones the ring had sound for. */
  played: number;
  /** A quantum in it ran the ring dry. */
  late: boolean;
  /** Sound stopped dead in it. */
  cut: boolean;
  /** Frames of stale sound jumped over in it. */
  skipped: number;
  /** Any sample in it was not silence: the core's own mix, so volume 0 is never heard. */
  heard: boolean;
  /** The core's dropped count, when the tick was made. */
  dropped: number;
}

export const TICK_QUANTA = 8;
