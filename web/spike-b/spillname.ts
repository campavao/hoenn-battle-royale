import { speciesName } from '../src/bots/party';
import type { Spill } from './shared/room';

/** What a bag or ball on the ground is called: the POKeMON alone in it (Cam, 11-03; the tag
 *  draws it too), a lone item, or whose bag it is. An event's pieces have no owner (name ''),
 *  so they read "'s bag" (Cam, 11-10: "in the tooltip say 's bag"). `bagWord` is the suffix of
 *  a trainer's: "'s BAG" on the tag, "'s bag" in the watch bar. */
export function spillName(s: Pick<Spill, 'name' | 'bag'>, bagWord: string, itemName: (id: number) => string): string {
  const mons = s.bag.mons ?? [];
  if (mons.length && !s.bag.items.length && !s.bag.money) return `${speciesName(mons[0].species)}${mons.length > 1 ? ` +${mons.length - 1}` : ''}`;
  if (s.name) return `${s.name}${bagWord}`;
  if (!mons.length && !s.bag.money && s.bag.items.length === 1) return itemName(s.bag.items[0].id) || 'Item';
  return bagWord.includes('BAG') ? 'SUPPLIES' : 'Supplies';
}
