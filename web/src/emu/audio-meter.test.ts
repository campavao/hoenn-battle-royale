import { describe, expect, it } from 'vitest';
import { AudioMeter, CUT_SILENCE, cutOff, tapNode, type AudioTick, type Heard } from './audio-meter';

/** A stereo buffer of `n` samples, all sound, with the last `silent` of them zero. */
function buffer(n: number, silent = 0, sound = 0.25) {
  const channels = [0, 1].map(() => {
    const data = new Float32Array(n).fill(sound);
    data.fill(0, n - silent);
    return data;
  });
  return { numberOfChannels: 2, length: n, sampleRate: 48000, getChannelData: (c: number) => channels[c] };
}

/** Both channels set by `at(i)`. */
function shaped(n: number, at: (i: number) => number) {
  const out = buffer(n);
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = at(i);
  }
  return out;
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
  it("hears the core's zero-fill: sound, then silence to the end", () => {
    expect(cutOff(buffer(1024, 40))).toBe(true);
    expect(cutOff(buffer(1024, CUT_SILENCE - 1))).toBe(false);
    expect(cutOff(buffer(1024))).toBe(false);
    // Silence all the way through is a quiet song or a paused device, not a cut.
    expect(cutOff(buffer(1024, 1024))).toBe(false);
  });

  it('hears a dropout anywhere in the buffer: what a player who is out heard, every frame', () => {
    // The probe's shape: ~173 samples of sound, then ~627 of silence, per 800-sample frame.
    expect(cutOff(shaped(1024, (i) => ((i + 244) % 800 < 173 ? 0.17 : 0)))).toBe(true);
  });

  it('a quiet passage, and a sound too short to be music, are not cuts', () => {
    // One step of a quiet song, then its own zeros.
    expect(cutOff(buffer(1024, 40, 1 / 32768))).toBe(false);
    // A click between silences.
    expect(cutOff(shaped(1024, (i) => (i % 578 < 3 ? 0.3 : 0)))).toBe(false);
    // Music crossing zero on both channels for a sample or two.
    expect(cutOff(shaped(1024, (i) => (i % 97 < 2 ? 0 : 0.2)))).toBe(false);
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

  it('reads the buffer SDL filled, not the one it was handed', () => {
    const ctx = { currentTime: 0, sampleRate: 48000, state: 'running' as AudioContextState };
    const node = sdlNode((out) => {
      // sdl-audio.c: `available < len` -> the rest is memset to zero.
      for (let c = 0; c < 2; c++) out.getChannelData(c).fill(0, 1024 - CUT_SILENCE);
    });
    const ticks: AudioTick[] = [];
    tapNode(node, ctx, (tick) => void ticks.push(tick));
    node.onaudioprocess!.call(node, event(buffer(1024), 1));
    expect(ticks[0].cut).toBe(true);
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
    const tick = (at: number, late = false, cut = false): AudioTick => ({ at, bufferMs: 21.3, late, cut, state: 'running' });
    emit(tick(0));
    emit(tick(21, true));
    emit(tick(90, false, true)); // two buffers missed
    emit(tick(111));
    expect(meter.stats()).toEqual({ callbacks: 4, late: 1, cut: 1, maxGapMs: 69, bufferMs: 21.3, state: 'running' });
    emit(tick(132));
    // The gap from the last window's final callback still counts.
    expect(meter.stats()).toEqual({ callbacks: 1, late: 0, cut: 0, maxGapMs: 21, bufferMs: 21.3, state: 'running' });
  });
});
