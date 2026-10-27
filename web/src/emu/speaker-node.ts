// The page's side of the core's speaker (HBR-59): an AudioContext, the worklet that reads
// the core's sound ring (speaker-worklet.ts), and the ticks it sends back for the audio
// meter. The main thread only sets it up, pauses it and hears ticks: no sound passes
// through it, so a busy page no longer makes the speaker crackle.

import workletUrl from './speaker-worklet.ts?worker&url';
import type { SpeakerMessage } from './speaker-worklet';
import type { SpeakerTick } from './speaker';

/** What the speaker needs of the core. */
export interface SpeakerCore {
  _brAudioWorkletAt?(rate: number): number;
  HEAPU8: Uint8Array;
}

/** With the context running and a game unpaused, this long with no sound out of the
 *  ring is a speaker that will not play: say so (the audio meter's `starved`). */
const STARVED_MS = 2000;

/** How long a context gets to take a tap's resume() before the next tap remakes it. */
const RESUME_WAIT_MS = 1000;

/** The worklet on a context, reading the ring at `ring` in `memory`. */
async function wire(context: AudioContext, memory: SharedArrayBuffer, ring: number): Promise<AudioWorkletNode> {
  await context.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(context, 'hbr-speaker', { numberOfInputs: 0, outputChannelCount: [2] });
  node.port.postMessage({ memory, ring } satisfies SpeakerMessage);
  node.connect(context.destination);
  return node;
}

export class Speaker {
  private listeners = new Set<(tick: SpeakerTick) => void>();
  private paused = true;
  /** When the ring last had sound, or the speaker last unpaused. */
  private soundAt = 0;
  /** When the worklet last ticked: one whose process() never runs sends none at all. */
  private tickAt = 0;
  /** No sound for STARVED_MS while it should have had some: warned once. */
  starved = false;
  /** When a tap last asked the context to resume, while it still has not: a tap a second
   *  past that one makes a new context. 0 when none is pending. */
  private resumeAt = 0;
  private remaking = false;
  /** Contexts made again after one would not resume. */
  remade = 0;

  private constructor(
    private context_: AudioContext,
    private node: AudioWorkletNode,
    private readonly memory: SharedArrayBuffer,
    private readonly ring: number,
  ) {
    this.attach(context_, node);
    // No tick at all is no sound too, and nothing else would say so.
    setInterval(() => {
      if (this.checkStarved(performance.now() - this.tickAt)) {
        const silent: SpeakerTick = { frames: 0, played: 0, late: false, cut: false, skipped: 0, heard: false, dropped: 0 };
        for (const l of this.listeners) l(silent);
      }
    }, 1000);
  }

  /** The context playing now: a new one after a remake. */
  get context(): AudioContext {
    return this.context_;
  }

  private attach(context: AudioContext, node: AudioWorkletNode): void {
    this.context_ = context;
    this.node = node;
    // Ticks stop while a context is suspended: the wait for sound starts when it runs.
    context.addEventListener('statechange', () => {
      if (context !== this.context_) return;
      if (context.state === 'running') {
        this.soundAt = this.tickAt = performance.now();
        this.resumeAt = 0;
      }
    });
    node.port.onmessage = (e: MessageEvent<SpeakerTick>) => {
      const now = performance.now();
      this.tickAt = now;
      if (e.data.played > 0) this.soundAt = now;
      else this.checkStarved(now - this.soundAt);
      for (const l of this.listeners) l(e.data);
    };
  }

  /** Whether `quietMs` without sound, now, made the speaker starved (once). */
  private checkStarved(quietMs: number): boolean {
    if (this.paused || this.starved || this.context_.state !== 'running' || quietMs <= STARVED_MS) return false;
    this.starved = true;
    console.warn('hbr: the speaker has had no sound from the core for 2 s');
    return true;
  }

  /** The core's speaker on a worklet, or null where it cannot be: an older core, a
   *  browser without AudioWorklet, memory that is not shared, or a worklet that would not
   *  take it. Must run before the core's first loadGame. The core is told to leave SDL's
   *  audio closed only once the worklet holds the ring, so on any failure SDL plays. */
  static async open(core: SpeakerCore): Promise<Speaker | null> {
    if (!core._brAudioWorkletAt || typeof AudioWorkletNode === 'undefined') return null;
    const memory = core.HEAPU8.buffer;
    if (typeof SharedArrayBuffer === 'undefined' || !(memory instanceof SharedArrayBuffer)) return null;
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
      // The ring's address, with nothing switched yet (a rate of 0).
      const ring = core._brAudioWorkletAt(0);
      const node = await wire(context, memory, ring);
      core._brAudioWorkletAt(context.sampleRate);
      const speaker = new Speaker(context, node, memory, ring);
      speaker.resumeOnGesture();
      return speaker;
    } catch (err) {
      console.warn('hbr: no AudioWorklet speaker, SDL plays instead', err);
      void context?.close().catch(() => {});
      return null;
    }
  }

  /** A browser starts an AudioContext suspended until the player touches the page, and
   *  iOS interrupts one for a call or another app's sound -- and can leave it interrupted,
   *  where resume() waits for an end that never comes (2026-10-27: an iPhone's sound
   *  stopped for good mid-match). A context still not running a second after a tap asked
   *  it to is made again at the next tap, inside that tap, where iOS lets one start. */
  private resumeOnGesture(): void {
    const resume = (tapped = true) => {
      const context = this.context_;
      const state: string = context.state;
      if (state !== 'suspended' && state !== 'interrupted') return;
      const now = performance.now();
      if (this.resumeAt && now - this.resumeAt > RESUME_WAIT_MS) {
        this.remake();
        return;
      }
      if (tapped && !this.resumeAt) this.resumeAt = now;
      void context.resume().catch(() => {});
    };
    for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'] as const) {
      document.addEventListener(type, () => resume(), { capture: true, passive: true });
    }
    // Back from another app: try without a tap, which iOS allows a context that ran.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (this.context_.state as string) !== 'running') {
        void this.context_.resume().catch(() => {});
      }
    });
    resume(false);
  }

  /** A new context and worklet on the same ring, at the old rate (the core resamples to
   *  it and cannot be told another once a game runs). Made and resumed synchronously, so
   *  inside the tap that asked for it. */
  private remake(): void {
    if (this.remaking) return;
    const old = this.context_;
    const oldNode = this.node;
    let context: AudioContext;
    try {
      context = new AudioContext({ latencyHint: 'interactive', sampleRate: old.sampleRate });
    } catch (err) {
      console.warn('hbr: could not make the speaker a new AudioContext', err);
      return;
    }
    this.remaking = true;
    void context.resume().catch(() => {});
    wire(context, this.memory, this.ring).then(
      (node) => {
        node.port.postMessage({ paused: this.paused } satisfies SpeakerMessage);
        this.attach(context, node);
        this.resumeAt = (context.state as string) === 'running' ? 0 : performance.now();
        this.soundAt = this.tickAt = performance.now();
        this.remade++;
        console.warn(`hbr: the speaker's AudioContext was ${old.state}; made a new one`);
        oldNode.disconnect();
        void old.close().catch(() => {});
      },
      (err) => {
        console.warn('hbr: the speaker could not be made again', err);
        void context.close().catch(() => {});
      },
    ).finally(() => {
      this.remaking = false;
    });
  }

  /** Paused, the worklet plays silence and counts nothing, and waits for a lead of sound
   *  again after. It starts paused: no game yet. */
  pause(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.soundAt = this.tickAt = performance.now();
    this.node.port.postMessage({ paused } satisfies SpeakerMessage);
  }

  onTick(listener: (tick: SpeakerTick) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
