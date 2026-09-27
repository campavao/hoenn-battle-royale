// POK-247: a player who is out watches somebody, and hears the game while they do.
//
// The soak found it on the audio meter: while the host was out, every 800-sample frame
// of the core's output was ~173 samples of one flat level and ~627 of exact zero -- a
// 60 Hz buzz, on every buffer. It was the ROM. Going out starts the watch (autoWatch),
// the watched trainer was on another map, and the ROM's follow asked for the warp there
// again every frame, before the warp's own task could run: each ask began a new fade
// the frame the last one ended, so the task never saw one ended, and started SE_EXIT
// from the top again, so every frame's sound was the same few ms of it and then
// nothing. The screen stayed black and the watch never arrived.
//
// So this goes out the way a player does most -- nothing caught by the Safari's buzzer,
// in a room of bots -- and checks the two halves: the ROM gets onto the map of the
// trainer it follows, and the speaker hears sound, not a sound stopping dead in every
// buffer. The warp itself is pinned headless in tools/br/drivers/spectate-follow-warp.txt.
import { test, expect } from '@playwright/test';
import { loadSymbols, romExists, romHashParam, romPath, startWith } from './symbols';

const BR_PHASE_OUT = 3;
const BR_NO_SEAT = 0xff;
/** include/br/br_config.h: BR_MAX_SEATS. */
const MAX_SEATS = 32;
/** include/br/br_spectate.h: struct BrSpectate. */
const SPECTATE_FOLLOW = 8;
/** include/br/br_ghosts.h: struct BrSeat, 16 bytes a seat. */
const SEAT_SIZE = 16;
const SEAT_MAP_GROUP = 2;
const SEAT_MAP_NUM = 3;
/** SaveBlock1's location.mapGroup and mapNum. */
const SB1_MAP_GROUP = 4;
const SB1_MAP_NUM = 5;

type Ram = { read(addr: number, width: 8 | 16 | 32): number };
interface AudioStats {
  callbacks: number;
  late: number;
  cut: number;
  state: string;
}
interface OutWindow {
  __br: { mailbox: { ram: Ram } };
  __hbr: { perf(): { sample(reset?: boolean): { audio: AudioStats } } };
  __outProbe?: { sample(reset?: boolean): { audio: AudioStats } };
}

test.beforeAll(() => {
  test.skip(!romExists(), `no ROM at ${romPath()} -- set HBR_ROM or place pokeemerald.gba at the repo root, then run tools/br/dev-patch.sh`);
});

test('a player out at the buzzer is taken to the trainer they watch, and hears the game there', async ({ browser }) => {
  test.setTimeout(600_000);
  const sym = loadSymbols();
  const ctx = await browser.newContext();
  try {
    const host = await ctx.newPage();
    // #fast: a 25-second opening. Nothing is thrown, so nothing is caught, and the
    // buzzer puts us out (Kanto's rule) with the room's bots still in it.
    await host.goto(`/#host&fast&seed=20260916&testmon&rom=${romHashParam()}`);
    await host.waitForFunction(() => (window as unknown as Partial<OutWindow>).__hbr !== undefined, undefined, { timeout: 90_000 });
    await startWith(host, 1);
    await host.waitForFunction(
      ([addr, out]) => (window as unknown as Partial<OutWindow>).__br?.mailbox.ram.read(addr, 8) === out,
      [sym.gBrMatch, BR_PHASE_OUT] as const,
      { timeout: 150_000 },
    );

    // Out is watching (autoWatch): the ROM follows somebody, and gets onto their map.
    // A bot can walk off it between our warp and our arrival, so this waits for the two
    // to agree rather than for the first warp.
    const where = async () =>
      host.evaluate(
        ({ spectate, seats, sb1, mySeat, off }) => {
          const ram = (window as unknown as OutWindow).__br.mailbox.ram;
          const follow = ram.read(spectate + off.follow, 8);
          const me = ram.read(mySeat, 8);
          const save = ram.read(sb1, 32);
          // A core rebooting at the match's end has no save block yet: nowhere, not a throw.
          const ours = save === 0 ? 'none' : `${ram.read(save + off.sbGroup, 8)}.${ram.read(save + off.sbNum, 8)}`;
          const mapOf = (seat: number) => `${ram.read(seats + seat * off.seat + off.group, 8)}.${ram.read(seats + seat * off.seat + off.num, 8)}`;
          // Everybody the ROM has a row for, somewhere other than here: who to watch next.
          const elsewhere: number[] = [];
          for (let seat = 0; seat < off.seats; seat++) {
            if (seat !== follow && seat !== me && ram.read(seats + seat * off.seat, 8) !== 0 && mapOf(seat) !== ours) elsewhere.push(seat);
          }
          return { follow, ours, theirs: follow === off.none ? null : mapOf(follow), elsewhere };
        },
        {
          spectate: sym.gBrSpectate,
          seats: sym.gBrSeats,
          sb1: sym.gSaveBlock1Ptr,
          mySeat: sym.gBrMySeat,
          off: {
            follow: SPECTATE_FOLLOW,
            none: BR_NO_SEAT,
            seats: MAX_SEATS,
            seat: SEAT_SIZE,
            group: SEAT_MAP_GROUP,
            num: SEAT_MAP_NUM,
            sbGroup: SB1_MAP_GROUP,
            sbNum: SB1_MAP_NUM,
          },
        },
      );
    const onField = () =>
      host.evaluate(
        ([main, cb2]) => ((window as unknown as OutWindow).__br.mailbox.ram.read(main + 4, 32) & ~1) === cb2,
        [sym.gMain, sym.CB2_Overworld] as const,
      );
    // Onto the map of the trainer it follows. A watch can be a fight first -- following a
    // trainer who is in one is watching it on the battle screen (POK-300), a bot's at the
    // pace the proxy fought it -- so only time on the field counts: 30 s there, off the
    // map it follows, is a follow that is stuck (the old warp loop was all field frames).
    const arrive = async () => {
      let stuck = 0;
      for (const end = Date.now() + 240_000; Date.now() < end && stuck <= 30_000; ) {
        const w = await where();
        if (w.theirs !== null && w.ours === w.theirs) return;
        stuck = (await onField()) ? stuck + 250 : 0;
        await host.waitForTimeout(250);
      }
      const w = await where();
      expect(JSON.stringify({ ...w, elsewhere: undefined }), 'on the map of the trainer it follows').toBe(JSON.stringify({ ...w, ours: w.theirs, elsewhere: undefined }));
    };
    await arrive();

    // Then somebody on another map, picked from the field -- NEXT on the strip, as a
    // player would: the same warp, asked from a map the ROM followed somebody onto.
    const { elsewhere } = await where();
    expect(elsewhere.length).toBeGreaterThan(0);
    await host.evaluate((seat) => (window as unknown as { __br: { watch(seat: number): void } }).__br.watch(seat), elsewhere[0]);
    await arrive();

    // And the speaker, from a second after we got there (the new map's music starting
    // is not the question). Watching, a match cuts a few buffers in a hundred -- a
    // song's own stops, a sound effect ending on silence, the watched trainer's next
    // warp; out, before the fix, every buffer was cut.
    await host.waitForTimeout(1_000);
    await host.evaluate(() => {
      const w = window as unknown as OutWindow;
      w.__outProbe = w.__hbr.perf();
    });
    await host.waitForTimeout(6_000);
    const audio = await host.evaluate(() => (window as unknown as OutWindow).__outProbe!.sample().audio);
    console.log(`out, watching: ${JSON.stringify(await where())}, audio ${audio.callbacks} callbacks ${audio.cut} cut ${audio.late} late (${audio.state})`);
    expect(audio.state).toBe('running');
    expect(audio.callbacks).toBeGreaterThan(100);
    expect(audio.cut).toBeLessThan(audio.callbacks / 4);
  } finally {
    await ctx.close();
  }
});
