// What Emerald calls things, where Showdown's name in capitals is not it. Names are all this is: a
// watcher reads "Foe GLOOM used POISONPOWDER!" as the game would print it.

const MOVES: Record<string, string> = {
  doubleslap: 'DOUBLESLAP', thunderpunch: 'THUNDERPUNCH', visegrip: 'VICEGRIP', sandattack: 'SAND-ATTACK',
  sonicboom: 'SONICBOOM', bubblebeam: 'BUBBLEBEAM', solarbeam: 'SOLARBEAM', poisonpowder: 'POISONPOWDER',
  thundershock: 'THUNDERSHOCK', selfdestruct: 'SELFDESTRUCT', softboiled: 'SOFTBOILED', highjumpkick: 'HI JUMP KICK',
  feintattack: 'FAINT ATTACK', dynamicpunch: 'DYNAMICPUNCH', dragonbreath: 'DRAGONBREATH', hiddenpower: 'HIDDEN POWER',
  extremespeed: 'EXTREMESPEED', ancientpower: 'ANCIENTPOWER', smellingsalts: 'SMELLINGSALT', featherdance: 'FEATHERDANCE',
  grasswhistle: 'GRASSWHISTLE',
};
const ABILITIES: Record<string, string> = { compoundeyes: 'COMPOUNDEYES', lightningrod: 'LIGHTNINGROD' };
const HELD: Record<string, string> = {
  brightpowder: 'BRIGHTPOWDER', silverpowder: 'SILVERPOWDER', deepseatooth: 'DEEPSEATOOTH', deepseascale: 'DEEPSEASCALE',
  blackglasses: 'BLACKGLASSES', nevermeltice: 'NEVERMELTICE', twistedspoon: 'TWISTEDSPOON', upgrade: 'UP-GRADE',
};

const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export const moveName = (name: string): string => MOVES[id(name)] ?? name.toUpperCase();
export const abilityName = (name: string): string => ABILITIES[id(name)] ?? name.toUpperCase();
export const heldName = (name: string): string => HELD[id(name)] ?? name.toUpperCase();

/** What each held item id in the ROM's table is in the engine (include/constants/items.h order;
 *  the seven with no effect in a fight are left out). */
const HOLD_FROM = 133;
const HOLD: readonly string[] = (
  'cheriberry chestoberry pechaberry rawstberry aspearberry leppaberry oranberry persimberry lumberry sitrusberry figyberry wikiberry ' +
  'magoberry aguavberry iapapaberry razzberry blukberry nanabberry wepearberry pinapberry pomegberry kelpsyberry qualotberry hondewberry ' +
  'grepaberry tamatoberry cornnberry magostberry rabutaberry nomelberry spelonberry pamtreberry watmelberry durinberry belueberry ' +
  'liechiberry ganlonberry salacberry petayaberry apicotberry lansatberry starfberry enigmaberry - - - brightpowder whiteherb machobrace - ' +
  'quickclaw - mentalherb choiceband kingsrock silverpowder - - souldew deepseatooth deepseascale - - focusband - scopelens metalcoat ' +
  'leftovers dragonscale lightball softsand hardstone miracleseed blackglasses blackbelt magnet mysticwater sharpbeak poisonbarb ' +
  'nevermeltice spelltag twistedspoon charcoal dragonfang silkscarf upgrade shellbell seaincense laxincense luckypunch metalpowder thickclub stick'
).split(' ');

export function heldId(item: number): string {
  const name = HOLD[item - HOLD_FROM];
  return name && name !== '-' ? name : '';
}

/** A trainer's bag item, as the AI can use it in a fight. */
export interface BagItem {
  name: string;
  /** HP it gives back; Infinity is the whole bar. */
  heal?: number;
  /** Statuses it cures ('all' with confusion too). */
  cures?: readonly string[];
  /** The stage it raises. */
  boost?: 'atk' | 'def' | 'spe' | 'spa' | 'accuracy';
  /** Its own effect. */
  special?: 'direhit' | 'guardspec';
}

const ALL = ['slp', 'psn', 'tox', 'brn', 'frz', 'par', 'confusion'];
/** Item ids from include/constants/items.h, effects from the game's public item data. */
export const BAG_ITEMS: Readonly<Record<number, BagItem>> = {
  13: { name: 'POTION', heal: 20 },
  14: { name: 'ANTIDOTE', cures: ['psn', 'tox'] },
  15: { name: 'BURN HEAL', cures: ['brn'] },
  16: { name: 'ICE HEAL', cures: ['frz'] },
  17: { name: 'AWAKENING', cures: ['slp'] },
  18: { name: 'PARLYZ HEAL', cures: ['par'] },
  19: { name: 'FULL RESTORE', heal: Infinity, cures: ALL },
  20: { name: 'MAX POTION', heal: Infinity },
  21: { name: 'HYPER POTION', heal: 200 },
  22: { name: 'SUPER POTION', heal: 50 },
  23: { name: 'FULL HEAL', cures: ALL },
  26: { name: 'FRESH WATER', heal: 50 },
  27: { name: 'SODA POP', heal: 60 },
  28: { name: 'LEMONADE', heal: 80 },
  29: { name: 'MOOMOO MILK', heal: 100 },
  30: { name: 'ENERGYPOWDER', heal: 50 },
  31: { name: 'ENERGY ROOT', heal: 200 },
  32: { name: 'HEAL POWDER', cures: ALL },
  38: { name: 'LAVA COOKIE', cures: ALL },
  44: { name: 'BERRY JUICE', heal: 20 },
  73: { name: 'GUARD SPEC.', special: 'guardspec' },
  74: { name: 'DIRE HIT', special: 'direhit' },
  75: { name: 'X ATTACK', boost: 'atk' },
  76: { name: 'X DEFEND', boost: 'def' },
  77: { name: 'X SPEED', boost: 'spe' },
  78: { name: 'X ACCURACY', boost: 'accuracy' },
  79: { name: 'X SPECIAL', boost: 'spa' },
  133: { name: 'CHERI BERRY', cures: ['par'] },
  134: { name: 'CHESTO BERRY', cures: ['slp'] },
  135: { name: 'PECHA BERRY', cures: ['psn', 'tox'] },
  136: { name: 'RAWST BERRY', cures: ['brn'] },
  137: { name: 'ASPEAR BERRY', cures: ['frz'] },
  139: { name: 'ORAN BERRY', heal: 10 },
  140: { name: 'PERSIM BERRY', cures: ['confusion'] },
  141: { name: 'LUM BERRY', cures: ALL },
  142: { name: 'SITRUS BERRY', heal: 30 },
};
