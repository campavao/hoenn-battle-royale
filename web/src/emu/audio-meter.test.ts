import { describe, expect, it } from 'vitest';
import { AudioMeter, STARVED_TAIL, ending, silentTail, tapNode, type AudioTick, type Heard } from './audio-meter';

/** A stereo buffer of `n` samples, all sound, with the last `silent` of them zero. */
function buffer(n: number, silent = 0, sound = 0.25) {
  const channels = [0, 1].map(() => {
    const data = new Float32Array(n).fill(sound);
    data.fill(0, n - silent);
    return data;
  });
  return { numberOfChannels: 2, length: n, sampleRate: 48000, getChannelData: (c: number) => channels[c] };
}

/** A ScriptProcessorNode as SDL leaves it: its own callback fills the output. */
function sdlNode(fill: (out: ReturnType<typeof buffer>) => void) {
  const node = {
    onaudioprocess(this: unknown, e: AudioProcessingEvent) {
      fill(e.outputBuffer as unknown as ReturnType<typeof buffer>);
    },
  } as unknown as ScriptProcessorNode;
  return node;
}

function event(out: ReturnType<typeof buffer>, playbackTime: number) {
  return { outputBuffer: out, playbackTime } as unknown as AudioProcessingEvent;
}

describe('the audio meter (POK-247)', () => {
  it("reads a zero-filled tail after sound as the core's short buffer", () => {
    expect(silentTail(buffer(1024, 40))).toBe(40);
    expect(silentTail(buffer(1024))).toBe(0);
    // Silence all the way through is a quiet song or a paused device, not a short one.
    expect(silentTail(buffer(1024, 1024))).toBe(0);
    // One channel with sound to the end is sound to the end.
    const mixed = buffer(1024, 40);
    mixed.getChannelData(1).fill(0.1);
    expect(silentTail(mixed)).toBe(0);
  });

  it('a quiet passage ending on zeros is the music; a cut from sound is the core', () => {
    expect(ending(buffer(1024, 40))).toEqual({ flat: true, starved: true });
    // One or two steps of a quiet song, and then its own zeros: nothing was cut.
    expect(ending(buffer(1024, 40, 1 / 32768))).toEqual({ flat: true, starved: false });
    expect(ending(buffer(1024, STARVED_TAIL - 1))).toEqual({ flat: false, starved: false });
  });

  it("counts a callback whose buffer was due before it ran as late, after SDL's own callback ran", () => {
    const ctx = { currentTime: 10, sampleRate: 48000, state: 'running' as AudioContextState };
    let filled = 0;
    const node = sdlNode(() => void filled++);
    const ticks: AudioTick[] = [];
    let t = 0;
    tapNode(node, ctx, (tick) => void ticks.push(tick), () => (t += 21));

    node.onaudioprocess!.call(node, event(buffer(1024), 10.02)); // on time
    node.onaudioprocess!.call(node, event(buffer(1024), 9.99)); // its play time passed
    expect(filled).toBe(2);
    expect(ticks.map((k) => k.late)).toEqual([false, true]);
    expect(ticks[0].bufferMs).toBeCloseTo(21.33, 1);
    expect(ticks[0].state).toBe('running');
  });

  it("counts a callback more than two buffers after the last as late: Chromium's playbackTime is never behind", () => {
    const ctx = { currentTime: 0, sampleRate: 48000, state: 'running' as AudioContextState };
    const node = sdlNode(() => {});
    const ticks: AudioTick[] = [];
    const at = [0, 21, 42, 150, 151];
    tapNode(node, ctx, (tick) => void ticks.push(tick), () => at.shift()!);
    for (let i = 0; i < 5; i++) node.onaudioprocess!.call(node, event(buffer(1024), 1)); // stamped ahead, always
    expect(ticks.map((k) => k.late)).toEqual([false, false, false, true, false]);
  });

  it('counts a buffer the core could not fill as starved', () => {
    const ctx = { currentTime: 0, sampleRate: 48000, state: 'running' as AudioContextState };
    const node = sdlNode((out) => {
      // sdl-audio.c: `available < len` -> the rest is memset to zero.
      for (let c = 0; c < 2; c++) out.getChannelData(c).fill(0, 1024 - STARVED_TAIL);
    });
    const ticks: AudioTick[] = [];
    tapNode(node, ctx, (tick) => void ticks.push(tick));
    node.onaudioprocess!.call(node, event(buffer(1024), 1));
    expect(ticks[0].starved).toBe(true);
  });

  it('adds up a window, the longest gap with it, and starts the next from nothing', () => {
    let emit: (tick: AudioTick) => void = () => {};
    const source: Heard = {
      onAudio: (l) => {
        emit = l;
        return () => {};
      },
    };
    const meter = new AudioMeter(source);
    expect(meter.stats().state).toBe('none');
    const tick = (at: number, late = false, starved = false): AudioTick => ({ at, bufferMs: 21.3, late, starved, flat: starved, state: 'running' });
    emit(tick(0));
    emit(tick(21, true));
    emit(tick(90, false, true)); // two buffers missed
    emit(tick(111));
    expect(meter.stats()).toEqual({ callbacks: 4, late: 1, starved: 1, flat: 1, maxGapMs: 69, bufferMs: 21.3, state: 'running' });
    emit(tick(132));
    // The gap from the last window's final callback still counts.
    expect(meter.stats()).toEqual({ callbacks: 1, late: 0, starved: 0, flat: 0, maxGapMs: 21, bufferMs: 21.3, state: 'running' });
  });
});
