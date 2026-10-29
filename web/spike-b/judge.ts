// Bot-vs-bot fights, on this page (POK-238 for spike B). A bot has no ROM and the relay
// runs none, so when two bots meet the room hands the fight to one trainer's page, which
// fights it out in a second, hidden copy of the ROM (src/bots/proxy.ts, the live match's
// own) and says who won. Never a coin flip: no answer, and both bots walk on.
import { Emulator } from '../src/emu';
import { MAILBOX } from '../src/net/mailbox';
import { ProxyDuels, type DuelOutcome, type DuelSide } from '../src/bots/proxy';
import type { BstartMsg, TurnMsg } from '../src/net/wire';
import type { RomFiles } from './rom';

/** br_boot.h's BR_BOOT_MAP: a fresh game in Littleroot, nobody in the party. */
const BOOT_MAP = 1;

export type Judge = (a: DuelSide, b: DuelSide) => Promise<DuelOutcome | null>;

/** `onStream`: the fight as it is fought (ProxyDuels' own), for whoever watches either bot. */
export function makeJudge({ rom, sym }: RomFiles, onStream?: (msg: BstartMsg | TurnMsg, sides: [number, number]) => void): Judge {
  const mailboxBase = sym('gBrMailbox');
  let proxy: ProxyDuels | null = null;
  return (a, b) => {
    proxy ??= new ProxyDuels({
      mailboxBase,
      boot: async () => {
        // Headless: a second core with a window would take the first one's canvas.
        const hidden = document.createElement('canvas');
        hidden.width = 240;
        hidden.height = 160;
        const emu = await Emulator.create(hidden, undefined, true);
        await emu.startBytes(rom);
        emu.setVolume(0);
        emu.setSpeed(8); // nobody watches it
        return emu;
      },
      restart: async (e) => {
        await (e as Emulator).reboot();
        (e as Emulator).setVolume(0);
      },
      writeBoot: (e, base) => {
        // Littleroot (0,9) at 5,8, named PROXY.
        const boot = [BOOT_MAP, 0, 0, 9, 5, 0, 8, 0, 0xca, 0xcc, 0xc9, 0xd2, 0xd3, 0xff];
        e.bytes(base + MAILBOX.OFF_BOOT, boot.length).set(boot);
      },
      onNote: (what) => console.info('[spike proxy]', what),
      onStream,
    });
    return proxy.fight(a, b);
  };
}
