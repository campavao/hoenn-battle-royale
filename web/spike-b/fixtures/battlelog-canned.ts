// A fight as a log, for the view's specs and the `#battleview` dev page: no match, no art. SHARPEDO
// (the near side's) against POOCHYENA, which falls and is followed by TREECKO. The species are the
// ROM's own numbers (constants/species.h) and the lines are as Emerald words them.
import type { BattleEvent, LogMon } from '../shared/battlelog';

const SHARPEDO = 331, POOCHYENA = 286, TREECKO = 277;
const mon = (species: number, level: number, hp: number, gender: number, extra: Partial<LogMon> = {}): LogMon => ({ species, level, hp, maxHp: hp, status: 0, gender, ...extra });

/** A wild one: nobody sends it out, and it is there as the fight opens. */
export const WILD_LOG: BattleEvent[] = [
  {
    e: 'start',
    a: { seat: 1, name: 'SHELLY', skin: 5, team: [mon(SHARPEDO, 5, 23, 1)] },
    b: { seat: -2, name: 'POOCHYENA', skin: 0, team: [mon(POOCHYENA, 3, 15, 0)], wild: true },
    map: 'MAP_ROUTE117',
  },
  { e: 'text', text: 'Wild POOCHYENA appeared!' },
  { e: 'send', side: 1, slot: 0 },
  { e: 'text', text: 'Go! SHARPEDO!' },
  { e: 'send', side: 0, slot: 0 },
  { e: 'text', text: 'SHARPEDO used BITE!' },
  { e: 'hit', side: 1, move: 44 },
  { e: 'hp', side: 1, hp: 0 },
  { e: 'faint', side: 1 },
  { e: 'text', text: 'Wild POOCHYENA fainted!' },
  { e: 'end', winner: 1 },
];

export const CANNED_LOG: BattleEvent[] = [
  {
    e: 'start',
    a: { seat: 1, name: 'BRENDAN', skin: 0, team: [mon(SHARPEDO, 5, 23, 0)] },
    b: { seat: 2, name: 'LASS ROSE', skin: 15, team: [mon(POOCHYENA, 5, 19, 1), mon(TREECKO, 5, 19, 0)] },
    map: 'MAP_ROUTE117',
  },
  { e: 'text', text: 'LASS ROSE sent out POOCHYENA!' },
  { e: 'send', side: 1, slot: 0 },
  { e: 'text', text: 'Go! SHARPEDO!' },
  { e: 'send', side: 0, slot: 0 },
  { e: 'text', text: 'SHARPEDO used BITE!' },
  { e: 'hit', side: 1, move: 44 },
  { e: 'hp', side: 1, hp: 8 },
  { e: 'text', text: 'Foe POOCHYENA used TACKLE!' },
  { e: 'hit', side: 0, move: 33 },
  { e: 'hp', side: 0, hp: 18 },
  { e: 'text', text: 'SHARPEDO used BITE!' },
  { e: 'hit', side: 1, move: 44 },
  { e: 'hp', side: 1, hp: 0 },
  { e: 'faint', side: 1 },
  { e: 'text', text: 'Foe POOCHYENA fainted!' },
  { e: 'text', text: 'LASS ROSE sent out TREECKO!' },
  { e: 'send', side: 1, slot: 1 },
  { e: 'text', text: 'Foe TREECKO used LEER!' },
  { e: 'status', side: 0, status: 0x40 },
  { e: 'text', text: 'SHARPEDO used BITE!' },
  { e: 'hit', side: 1, move: 44 },
  { e: 'hp', side: 1, hp: 0 },
  { e: 'faint', side: 1 },
  { e: 'text', text: 'LASS ROSE is out of mons!' },
  { e: 'end', winner: 1 },
];
