// A team made to order, put into a page's ROM the way a reload brings a saved one back.
import { expect, type Page } from '@playwright/test';

const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];

export interface Craft { species: number; name: string; level: number; moves: number[]; hp: number; stats: [number, number, number, number, number]; personality: number }

/** A party of struct Pokemon as the ROM keeps it (pokemon.h): the 48 bytes of substructs
 *  XORed with personality ^ otId, summed into the checksum. Level is the rung the ROM lifts
 *  it from. */
export function craftParty(mons: Craft[]): Buffer {
  const party = Buffer.alloc(600);
  mons.forEach((m, i) => {
    const o = i * 100, otId = 0x1234abcd;
    party.writeUInt32LE(m.personality >>> 0, o);
    party.writeUInt32LE(otId, o + 4);
    party.fill(0xff, o + 8, o + 18);
    [...m.name].forEach((c, k) => { party[o + 8 + k] = 0xbb + c.charCodeAt(0) - 65; });
    party[o + 18] = 2; // English
    party.fill(0xff, o + 20, o + 27);
    const plain = Buffer.alloc(48);
    const at = (sub: string) => 12 * ORDERS[m.personality % 24].indexOf(sub);
    plain.writeUInt16LE(m.species, at('G'));
    plain.writeUInt32LE(m.level ** 3, at('G') + 4);
    plain[at('G') + 9] = 70;
    m.moves.forEach((mv, k) => { plain.writeUInt16LE(mv, at('A') + 2 * k); plain[at('A') + 8 + k] = 25; });
    plain.writeUInt16LE(m.level | (0x0b << 7) | (4 << 11), at('M') + 2); // met at its level, in Emerald, a Poke Ball
    plain.writeUInt32LE(0x0a5294a5 >>> 0, at('M') + 4); // IVs of 5s
    let sum = 0;
    for (let h = 0; h < 24; h++) sum = (sum + plain.readUInt16LE(h * 2)) & 0xffff;
    party.writeUInt16LE(sum, o + 28);
    const key = (m.personality ^ otId) >>> 0;
    for (let w = 0; w < 12; w++) party.writeUInt32LE((plain.readUInt32LE(w * 4) ^ key) >>> 0, o + 32 + w * 4);
    party[o + 84] = m.level;
    party.writeUInt16LE(m.hp, o + 86);
    party.writeUInt16LE(m.hp, o + 88);
    m.stats.forEach((v, k) => party.writeUInt16LE(v, o + 90 + 2 * k));
  });
  return party;
}

export async function giveTeam(page: Page, mons: Craft[]): Promise<void> {
  const party = craftParty(mons).toString('base64');
  const ok = await page.evaluate(async ([party, count]) => {
    const rom = (window as any).__spike.rom;
    const j = JSON.parse(await rom.save());
    j.party = party;
    j.count = count;
    return rom.load(JSON.stringify(j));
  }, [party, mons.length] as [string, number]);
  expect(ok, 'the team went in').toBe(true);
}
