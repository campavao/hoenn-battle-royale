// The engine's account of a fight (Showdown's protocol, `|move|p1a: M0|Toxic|p2a: M1`) as a
// BattleEvent log (battlelog.ts) that reads the way Emerald prints a battle. The wording is the
// game's own; so is the order, where Showdown's differs: a hit's bar drains first, and then it is
// "A critical hit!" and "It's super effective!".
//
// A line this does not know says nothing: its HP still moves, so the watcher's bars stay right,
// and `unknown` lists it for the test that sweeps fights for gaps.
import type { BattleEvent, Side } from './battlelog';
import { abilityName, heldName, moveName } from './simnames';

export interface LogNames {
  /** Each side's trainer name. */
  trainers: [string, string];
  /** A card slot's name, by side: the species as the ROM spells it. */
  mon: (side: Side, slot: number) => string;
  /** A move's number, for the flash (0 for none known). */
  moveNum: (name: string) => number;
  /** The far side is a wild mon, with no trainer to send it out: "Wild ZIGZAGOON". */
  wild?: boolean;
}

/** The ROM's status1 bits, what the battle view reads (include/constants/battle.h): sleep in the
 *  low three (its turns; 1 is as asleep as any), then one bit each. TOXIC is its own bit, 0x80, with
 *  POISON's clear. */
export const STATUS_BITS: Record<string, number> = { '': 0, slp: 1, psn: 8, brn: 16, frz: 32, par: 64, tox: 128, fnt: 0 };

const STAT: Record<string, string> = { atk: 'ATTACK', def: 'DEFENSE', spa: 'SP. ATK', spd: 'SP. DEF', spe: 'SPEED', accuracy: 'accuracy', evasion: 'evasiveness' };

const STATUS_START: Record<string, (n: string) => string> = {
  slp: (n) => `${n} fell asleep!`,
  psn: (n) => `${n} was poisoned!`,
  tox: (n) => `${n} is badly poisoned!`,
  brn: (n) => `${n} was burned!`,
  frz: (n) => `${n} was frozen solid!`,
  par: (n) => `${n} is paralyzed! It may be unable to move!`,
};

const CANT: Record<string, (n: string, move: string) => string> = {
  slp: (n) => `${n} is fast asleep.`,
  frz: (n) => `${n} is frozen solid!`,
  par: (n) => `${n} is paralyzed! It can't move!`,
  flinch: (n) => `${n} flinched!`,
  recharge: (n) => `${n} must recharge!`,
  Attract: (n) => `${n} is immobilized by love!`,
  Disable: (n, m) => `${n}'s ${m} is disabled!`,
  Taunt: (n, m) => `${n} can't use ${m} after the TAUNT!`,
  Imprison: (n, m) => `${n} can't use the sealed ${m}!`,
  Truant: (n) => `${n} is loafing around!`,
  nopp: () => `But there was no PP left for the move!`,
  Damp: () => `But it failed!`,
  'Focus Punch': (n) => `${n} lost its focus and couldn't move!`,
};

const PREPARE: Record<string, (n: string) => string> = {
  Fly: (n) => `${n} flew up high!`,
  Dig: (n) => `${n} dug a hole!`,
  Dive: (n) => `${n} hid underwater!`,
  Bounce: (n) => `${n} sprang up!`,
  'Solar Beam': (n) => `${n} took in sunlight!`,
  'Razor Wind': (n) => `${n} whipped up a whirlwind!`,
  'Skull Bash': (n) => `${n} lowered its head!`,
  'Sky Attack': (n) => `${n} is glowing!`,
};

const WEATHER: Record<string, [start: string, upkeep: string]> = {
  RainDance: ['It started to rain!', 'Rain continues to fall.'],
  SunnyDay: ['The sunlight got bright!', 'The sunlight is strong.'],
  Sandstorm: ['A sandstorm brewed!', 'The sandstorm rages.'],
  Hail: ['It started to hail!', 'Hail continues to fall.'],
};
const WEATHER_END: Record<string, string> = { RainDance: 'The rain stopped.', SunnyDay: 'The sunlight faded.', Sandstorm: 'The sandstorm subsided.', Hail: 'The hail stopped.' };

/** A `|-start|` line's volatile. */
const START: Record<string, (n: string, arg: string, of: string) => string> = {
  confusion: (n) => `${n} became confused!`,
  Substitute: (n) => `${n} made a SUBSTITUTE!`,
  'move: Leech Seed': (n) => `${n} was seeded!`,
  Encore: (n) => `${n} got an ENCORE!`,
  'move: Taunt': (n) => `${n} fell for the TAUNT!`,
  Taunt: (n) => `${n} fell for the TAUNT!`,
  Attract: (n) => `${n} fell in love!`,
  Disable: (n, m) => `${n}'s ${m} was disabled!`,
  Nightmare: (n) => `${n} fell into a NIGHTMARE!`,
  Curse: (n, _a, of) => `${of} cut its own HP and laid a CURSE on ${n}!`,
  'move: Focus Energy': (n) => `${n} is getting pumped!`,
  Foresight: (n, _a, of) => `${of} identified ${n}!`,
  'move: Yawn': (n, _a, of) => `${of} made ${n} drowsy!`,
  Uproar: (n) => `${n} caused an UPROAR!`,
  'move: Ingrain': (n) => `${n} planted its roots!`,
  Ingrain: (n) => `${n} planted its roots!`,
  'move: Bide': (n) => `${n} is storing energy!`,
  Bide: (n) => `${n} is storing energy!`,
  'move: Imprison': (n) => `${n} sealed the opponent's move(s)!`,
  Torment: (n) => `${n} was subjected to TORMENT!`,
  typechange: (n, t) => `${n} transformed into the ${t.toUpperCase()} type!`,
  perish3: () => '',
  'Mud Sport': () => "Electricity's power was weakened!",
  'move: Mud Sport': () => "Electricity's power was weakened!",
  'Water Sport': () => "Fire's power was weakened!",
  'move: Water Sport': () => "Fire's power was weakened!",
  Charge: (n) => `${n} began charging power!`,
  Stockpile: () => '',
  Mimic: (n, m) => `${n} learned ${m}!`,
};

const END: Record<string, (n: string) => string> = {
  confusion: (n) => `${n} snapped out of confusion!`,
  Substitute: (n) => `${n}'s SUBSTITUTE faded!`,
  Encore: (n) => `${n}'s ENCORE ended!`,
  Disable: (n) => `${n} is disabled no more!`,
  Uproar: (n) => `${n} calmed down.`,
  Bide: (n) => `${n} unleashed energy!`,
  'move: Bide': (n) => `${n} unleashed energy!`,
};

const SINGLE: Record<string, (n: string) => string> = {
  Protect: (n) => `${n} protected itself!`,
  Detect: (n) => `${n} protected itself!`,
  Endure: (n) => `${n} braced itself!`,
  'move: Endure': (n) => `${n} braced itself!`,
  'move: Protect': (n) => `${n} protected itself!`,
  'Focus Punch': (n) => `${n} is tightening its focus!`,
  'move: Focus Punch': (n) => `${n} is tightening its focus!`,
  Snatch: (n) => `${n} waits for a target to make a move!`,
  'move: Snatch': (n) => `${n} waits for a target to make a move!`,
  'Magic Coat': (n) => `${n} shrouded itself in MAGIC COAT!`,
  'move: Magic Coat': (n) => `${n} shrouded itself in MAGIC COAT!`,
  'move: Follow Me': (n) => `${n} became the center of attention!`,
  'Follow Me': (n) => `${n} became the center of attention!`,
};

/** How a side condition starts and stops. `team` is "Your team" or "The foe's team" in the ROM's
 *  own prefix (ATK_PREFIX2: "Foe's team" on the far side). */
const SIDE_START: Record<string, (team: string) => string> = {
  Reflect: (t) => `${t}'s REFLECT raised DEFENSE!`,
  'move: Reflect': (t) => `${t}'s REFLECT raised DEFENSE!`,
  'Light Screen': (t) => `${t}'s LIGHT SCREEN raised SP. DEF!`,
  'move: Light Screen': (t) => `${t}'s LIGHT SCREEN raised SP. DEF!`,
  Spikes: () => `SPIKES were scattered all around the opponent's side!`,
  'move: Spikes': () => `SPIKES were scattered all around the opponent's side!`,
  Safeguard: (t) => `${t}'s party is covered by a veil!`,
  'move: Safeguard': (t) => `${t}'s party is covered by a veil!`,
  Mist: (t) => `${t} became shrouded in MIST!`,
  'move: Mist': (t) => `${t} became shrouded in MIST!`,
};
const SIDE_END: Record<string, (team: string) => string> = {
  Reflect: (t) => `${t}'s REFLECT wore off!`,
  'Light Screen': (t) => `${t}'s LIGHT SCREEN wore off!`,
  Safeguard: (t) => `${t}'s party is no longer protected by SAFEGUARD!`,
  Mist: (t) => `${t}'s MIST wore off!`,
};

const bare = (s: string) => s.replace(/^(move|ability|item): /, '');

export interface Translated {
  log: BattleEvent[];
  /** Protocol lines nothing was said for, by their tag and first word: a test's list of gaps. */
  unknown: string[];
}

/** `lines` is battle.log, from after the two players are named. `start` is pushed first by the
 *  caller; this adds what the fight said and the 'end'. */
export function translate(lines: readonly string[], names: LogNames, winnerSeat: number, seats: [number, number]): Translated {
  const log: BattleEvent[] = [];
  const unknown: string[] = [];
  const text = (t: string) => { if (t) log.push({ e: 'text', text: t }); };
  /** "p2a: M3" as its side and card slot. */
  const who = (ident: string): { side: Side; slot: number; name: string } => {
    const side = (ident.startsWith('p2') ? 1 : 0) as Side;
    const slot = Number(ident.slice(ident.indexOf('M') + 1));
    const bareName = names.mon(side, slot);
    return { side, slot, name: side === 1 ? `${names.wild ? 'Wild' : 'Foe'} ${bareName}` : bareName };
  };
  const team = (ident: string) => (ident.startsWith('p2') ? "Foe's team" : 'Your team');
  const tag = (parts: string[], key: string): string | undefined => {
    const hit = parts.find((p) => p.startsWith(`[${key}]`));
    return hit === undefined ? undefined : hit.slice(key.length + 2).trim();
  };
  const hpOf = (s: string): { hp: number; status: string } => {
    const [frac, status] = s.split(' ');
    return { hp: Number(frac.split('/')[0]) || 0, status: status ?? '' };
  };
  const unknownLine = (kind: string, what: string) => { unknown.push(`${kind} ${what}`); };

  /** What Emerald says after the bar has moved. */
  let after: string[] = [];
  const flush = () => { for (const t of after) text(t); after = []; };
  let lastMove = 0;
  let lastWeather = '';
  /** What each mon that has been out last had, for its next send. */
  const kept = new Map<string, { hp: number; status: number }>();
  const note = (w: { side: Side; slot: number }, hp?: number, status?: number) => {
    const k = kept.get(`${w.side}:${w.slot}`);
    if (k) { if (hp !== undefined) k.hp = hp; if (status !== undefined) k.status = status; }
  };
  /** Who has just said INTIMIDATE: the next ATTACK down is theirs. */
  let intimidate = '';
  let begun = 0;
  /** Who stands on each side's field, -1 for nobody. */
  const out: [number, number] = [-1, -1];
  /** The first two sends, foe first, as a battle opens. */
  const opening: BattleEvent[][] = [[], []];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // An exact line and a public one: the exact is the one a log wants.
    if (line.startsWith('|split|')) { line = lines[++i] ?? ''; i++; }
    if (!line.startsWith('|')) continue;
    const p = line.split('|').slice(1);
    const kind = p[0];
    if (kind !== '-crit' && kind !== '-supereffective' && kind !== '-resisted' && kind !== '-damage' && kind !== '-ohko' && kind !== '-hitcount') flush();
    switch (kind) {
      case 'switch':
      case 'drag': {
        const w = who(p[1]);
        const { hp, status } = hpOf(p[3] ?? '');
        const trainer = names.trainers[w.side];
        const ev: BattleEvent[] = [];
        const say = (t: string) => ev.push({ e: 'text', text: t });
        // Whoever is still standing there goes back first.
        const was = out[w.side];
        if (was >= 0) {
          if (kind === 'switch') say(w.side === 1 ? `${trainer} withdrew ${names.mon(1, was)}!` : `${names.mon(0, was)}, that's enough! Come back!`);
          ev.push({ e: 'back', side: w.side });
        }
        out[w.side] = w.slot;
        if (kind === 'drag') say(`${w.name} was dragged out!`);
        else if (w.side === 1 && names.wild) say(`Wild ${names.mon(1, w.slot)} appeared!`);
        else say(w.side === 1 ? `${trainer} sent out ${names.mon(1, w.slot)}!` : `Go! ${names.mon(0, w.slot)}!`);
        ev.push({ e: 'send', side: w.side, slot: w.slot });
        // What it comes back with, only if the bench changed it (the start says the rest): an event
        // here would hold the screen for a bar that does not move.
        const now = STATUS_BITS[status] ?? 0;
        const had = kept.get(`${w.side}:${w.slot}`);
        if (had && had.hp !== hp) ev.push({ e: 'hp', side: w.side, hp });
        if (had && had.status !== now) ev.push({ e: 'status', side: w.side, status: now });
        kept.set(`${w.side}:${w.slot}`, { hp, status: now });
        if (begun < 2) {
          opening[w.side] = ev;
          begun++;
          if (begun === 2) log.push(...opening[1], ...opening[0]);
        } else log.push(...ev);
        break;
      }
      case 'bag': {
        // Ours: `|bag|p1|POTION`.
        const side = p[1] === 'p2' ? 1 : 0;
        text(`${names.trainers[side]} used ${p[2]}!`);
        break;
      }
      case 'say':
        // Ours too: what a ball or a RUN comes to.
        text(p[1]);
        break;
      case 'move': {
        const w = who(p[1]);
        lastMove = names.moveNum(p[2]);
        text(`${w.name} used ${moveName(p[2])}!`);
        break;
      }
      case '-damage': {
        const w = who(p[1]);
        const { hp, status } = hpOf(p[2]);
        const from = tag(p, 'from');
        const of = tag(p, 'of');
        if (p.includes('[silent]')) { /* nothing said */ }
        else if (from === undefined) log.push({ e: 'hit', side: w.side, ...(lastMove ? { move: lastMove } : {}) });
        else if (from === 'psn' || from === 'tox') text(`${w.name} is hurt by poison!`);
        else if (from === 'brn') text(`${w.name} is hurt by its burn!`);
        else if (from === 'confusion') text(`It hurt itself in its confusion!`);
        else if (from === 'Sandstorm') text(`${w.name} is buffeted by the sandstorm!`);
        else if (from === 'Hail') text(`${w.name} is pelted by HAIL!`);
        else if (from === 'Recoil' || from === 'recoil') text(`${w.name} is hit with recoil!`);
        else if (from === 'Spikes' || from === 'move: Spikes') text(`${w.name} is hurt by SPIKES!`);
        else if (from === 'Leech Seed' || from === 'move: Leech Seed') text(`${w.name}'s health is sapped by LEECH SEED!`);
        else if (from === 'Curse' || from === 'move: Curse') text(`${w.name} is afflicted by the CURSE!`);
        else if (from === 'Nightmare' || from === 'move: Nightmare') text(`${w.name} is locked in a NIGHTMARE!`);
        else if (from === 'fog') text(`${w.name} is hurt by the fog!`);
        else if (from.startsWith('move: ')) text(`${w.name} is hurt by ${moveName(bare(from))}!`);
        else if (from.startsWith('ability: ')) text(`${of ? who(of).name : w.name}'s ${abilityName(bare(from))} hurt ${w.name}!`);
        else unknownLine(kind, from);
        log.push({ e: 'hp', side: w.side, hp });
        note(w, hp);
        flush();
        break;
      }
      case '-heal': {
        const w = who(p[1]);
        const { hp } = hpOf(p[2]);
        const from = tag(p, 'from');
        const of = tag(p, 'of');
        if (p.includes('[silent]')) { /* the bag's line, or REST's, said it */ }
        else if (from === 'drain' && of) text(`${who(of).name} had its energy drained!`);
        else if (from === undefined) text(`${w.name} regained health!`);
        else if (from.startsWith('item: ')) text(bare(from) === 'Leftovers' || bare(from) === 'Shell Bell' ? `${w.name} restored a little HP using its ${heldName(bare(from))}!` : `${w.name}'s ${heldName(bare(from))} restored health!`);
        else if (from === 'Ingrain' || from === 'move: Ingrain') text(`${w.name} absorbed nutrients with its roots!`);
        else if (from.startsWith('ability: ')) text(bare(from) === 'Rain Dish' ? `${w.name}'s RAIN DISH restored its HP a little!` : `${w.name} restored HP using its ${abilityName(bare(from))}!`);
        else if (from === 'move: Wish' || p.some((x) => x.startsWith('[wisher]'))) text(`${tag(p, 'wisher') ?? w.name}'s WISH came true!`);
        else unknownLine(kind, from);
        log.push({ e: 'hp', side: w.side, hp });
        note(w, hp);
        break;
      }
      case '-sethp': {
        const w = who(p[1]);
        const { hp } = hpOf(p[2]);
        if (tag(p, 'from') === 'move: Pain Split') text('The battlers shared their pain!');
        log.push({ e: 'hp', side: w.side, hp });
        note(w, hp);
        break;
      }
      case '-status': {
        const w = who(p[1]);
        const from = tag(p, 'from');
        if (from === 'move: Rest') text(`${w.name} went to sleep!`);
        else if (from?.startsWith('ability: ') && tag(p, 'of')) {
          const of = who(tag(p, 'of')!).name;
          const verb: Record<string, string> = { psn: 'poisoned', tox: 'poisoned', brn: 'burned', par: 'paralyzed', slp: 'made', frz: 'froze' };
          text(p[2] === 'slp' ? `${of}'s ${abilityName(bare(from))} made ${w.name} sleep!` : `${of}'s ${abilityName(bare(from))} ${verb[p[2]] ?? 'hit'} ${w.name}!`);
        } else text(STATUS_START[p[2]]?.(w.name) ?? '');
        log.push({ e: 'status', side: w.side, status: STATUS_BITS[p[2]] ?? 0 });
        note(w, undefined, STATUS_BITS[p[2]] ?? 0);
        break;
      }
      case '-curestatus': {
        const w = who(p[1]);
        const onField = /^p[12]a/.test(p[1]);
        if (p.includes('[msg]')) {
          const s = p[2];
          text(s === 'slp' ? `${w.name} woke up!` : s === 'frz' ? `${w.name} was defrosted!` : s === 'par' ? `${w.name} was healed of paralysis!` : `${w.name}'s status returned to normal!`);
        } else if (tag(p, 'from')?.startsWith('ability: ')) {
          const name: Record<string, string> = { slp: 'sleep', psn: 'poison', tox: 'poison', brn: 'burn', frz: 'ice', par: 'paralysis' };
          text(`${w.name}'s ${abilityName(bare(tag(p, 'from')!))} cured its ${name[p[2]] ?? 'status'} problem!`);
        } else if (!p.includes('[silent]') && onField) text(`${w.name}'s status returned to normal!`);
        if (onField) log.push({ e: 'status', side: w.side, status: 0 });
        note(w, undefined, 0);
        break;
      }
      case '-cureteam': text('A bell chimed!'); log.push({ e: 'status', side: who(p[1]).side, status: 0 }); break;
      case 'cant': {
        const w = who(p[1]);
        const move = p[3] ? moveName(p[3]) : '';
        const reason = p[2]?.replace(/^(move|ability): /, '');
        const say = CANT[reason ?? ''];
        if (say) text(say(w.name, move)); else unknownLine(kind, reason ?? '');
        break;
      }
      case '-miss': text(`${who(p[1]).name}'s attack missed!`); break;
      case '-fail': case '-notarget': text('But it failed!'); break;
      case '-nothing': text('But nothing happened!'); break;
      case '-crit': after.push('A critical hit!'); break;
      case '-supereffective': after.push("It's super effective!"); break;
      case '-resisted': after.push("It's not very effective..."); break;
      case '-ohko': after.push("It's a one-hit KO!"); break;
      case '-hitcount': after.push(`Hit ${p[2]} time(s)!`); break;
      case '-immune': {
        const w = who(p[1]);
        const from = tag(p, 'from');
        if (from?.startsWith('ability: ')) {
          const a = bare(from);
          text(a === 'Levitate' ? `${w.name} makes GROUND moves miss with LEVITATE!` : `${w.name}'s ${abilityName(a)} made it ineffective!`);
        } else text(`It doesn't affect ${w.name}...`);
        break;
      }
      case '-boost':
      case '-unboost': {
        const w = who(p[1]);
        const n = Number(p[3]);
        const stat = STAT[p[2]] ?? p[2];
        const from = tag(p, 'from');
        if (kind === '-unboost' && intimidate) { text(`${intimidate}'s INTIMIDATE cuts ${w.name}'s ATTACK!`); intimidate = ''; }
        else if (n === 0) text(kind === '-boost' ? `${w.name}'s ${stat} won't go higher!` : `${w.name}'s ${stat} won't go lower!`);
        else text(`${w.name}'s ${stat} ${n >= 2 ? (kind === '-boost' ? 'sharply ' : 'harshly ') : ''}${kind === '-boost' ? 'rose' : 'fell'}!`);
        break;
      }
      case '-setboost': text(`${who(p[1]).name} cut its own HP and maximized ATTACK!`); break;
      case '-clearallboost': text('All stat changes were eliminated!'); break;
      case '-copyboost': text(`${who(p[1]).name} copied ${who(p[2]).name}'s stat changes!`); break;
      case '-weather': {
        const w = p[1];
        const from = tag(p, 'from');
        const of = tag(p, 'of');
        if (w === 'none') { for (const k of Object.keys(WEATHER_END)) if (lastWeather === k) text(WEATHER_END[k]); lastWeather = ''; break; }
        if (p.includes('[upkeep]')) { text(WEATHER[w]?.[1] ?? ''); break; }
        lastWeather = w;
        if (from?.startsWith('ability: ') && of) {
          const a = bare(from), n = who(of).name;
          text(a === 'Drizzle' ? `${n}'s DRIZZLE made it rain!` : a === 'Sand Stream' ? `${n}'s SAND STREAM whipped up a sandstorm!` : a === 'Drought' ? `${n}'s DROUGHT intensified the sun's rays!` : '');
        } else text(WEATHER[w]?.[0] ?? '');
        break;
      }
      case '-sidestart': {
        const say = SIDE_START[p[2]];
        if (say) text(say(team(p[1]))); else unknownLine(kind, p[2]);
        break;
      }
      case '-sideend': {
        const c = bare(p[2]);
        if (c === 'Spikes') { text(`${tag(p, 'of') ? who(tag(p, 'of')!).name : ''} blew away SPIKES!`); break; }
        const say = SIDE_END[c];
        if (say) text(say(team(p[1]))); else unknownLine(kind, p[2]);
        break;
      }
      case '-start': {
        const w = who(p[1]);
        const of = tag(p, 'of') ? who(tag(p, 'of')!).name : '';
        if (p[2] === 'confusion' && p.includes('[fatigue]')) { text(`${w.name} became confused due to fatigue!`); break; }
        if (p[2]?.startsWith('stockpile')) { text(`${w.name} STOCKPILED ${p[2].slice(9)}!`); break; }
        if (p[2]?.startsWith('perish')) { if (p[2] !== 'perish3') text(`${w.name}'s PERISH count fell to ${p[2].slice(6)}!`); break; }
        const say = START[p[2]] ?? START[bare(p[2] ?? '')];
        if (say) text(say(w.name, moveName(bare(p[3] ?? '')), of)); else if (p[2] === 'ability: Flash Fire') text(`${w.name}'s FLASH FIRE raised its FIRE power!`); else unknownLine(kind, p[2]);
        break;
      }
      case '-end': {
        const w = who(p[1]);
        if (p.includes('[silent]') || p[2]?.startsWith('perish') || p[2]?.startsWith('stockpile')) break;
        const say = END[p[2]] ?? END[bare(p[2] ?? '')];
        if (say) text(say(w.name));
        else if (/^move: |^(Bind|Wrap|Clamp|Fire Spin|Sand Tomb|Whirlpool)$/.test(p[2] ?? '')) text(`${w.name} was freed from ${moveName(bare(p[2]))}!`);
        else unknownLine(kind, p[2]);
        break;
      }
      case '-activate': {
        const c = p[2] ?? '';
        const w = p[1] ? who(p[1]) : null;
        const name = bare(c);
        if (c === 'confusion') text(`${w!.name} is confused!`);
        else if (c === 'Substitute' || c === 'move: Substitute') { if (p.includes('[damage]')) text(`The SUBSTITUTE took damage for ${w!.name}!`); else if (p.includes('[block]')) text('But it failed!'); }
        else if (name === 'Protect' || name === 'Detect') text(`${w!.name} protected itself!`);
        else if (name === 'Endure') text(`${w!.name} ENDURED the hit!`);
        else if (name === 'Attract') text(`${w!.name} is in love with ${tag(p, 'of') ? who(tag(p, 'of')!).name : 'its foe'}!`);
        else if (name === 'Destiny Bond') text(`${w!.name} took its attacker with it!`);
        else if (name === 'Mist') text(`${w!.name} is protected by MIST!`);
        else if (name === 'Safeguard') text(`${w!.name}'s party is protected by SAFEGUARD!`);
        else if (name === 'Lock-On' || name === 'Mind Reader') text(`${w!.name} took aim at ${p[3] ? who(p[3].replace('[of] ', '')).name : 'its foe'}!`);
        else if (name === 'Focus Band') text(`${w!.name} hung on using its FOCUS BAND!`);
        else if (name === 'Bide') text(`${w!.name} is storing energy!`);
        else if (name === 'Spite') text(`Reduced ${w!.name}'s ${moveName(p[3] ?? '')} by ${p[4] ?? ''}!`);
        else if (/^(Bind|Wrap|Clamp|Fire Spin|Sand Tomb|Whirlpool)$/.test(name)) text(name === 'Wrap' ? `${w!.name} was WRAPPED by ${tag(p, 'of') ? who(tag(p, 'of')!).name : 'its foe'}!` : name === 'Bind' ? `${w!.name} was squeezed by ${tag(p, 'of') ? who(tag(p, 'of')!).name : 'its foe'}'s BIND!` : name === 'Clamp' ? `${tag(p, 'of') ? who(tag(p, 'of')!).name : 'Its foe'} CLAMPED ${w!.name}!` : name === 'Fire Spin' || name === 'Whirlpool' ? `${w!.name} was trapped in the vortex!` : `${w!.name} was trapped by SAND TOMB!`);
        else if (name === 'Sturdy' || name === 'Liquid Ooze' || name === 'Shed Skin' || name === 'Pressure') { /* its own line follows, or none */ }
        else if (name === 'Trapped') text(`${w!.name} can't escape now!`);
        else unknownLine(kind, c);
        break;
      }
      case '-singleturn':
      case '-singlemove': {
        const w = who(p[1]);
        if (p[2] === 'Destiny Bond' || p[2] === 'move: Destiny Bond') text(`${w.name} is trying to take its foe with it!`);
        else if (p[2] === 'Grudge' || p[2] === 'move: Grudge') text(`${w.name} wants the opponent to bear a GRUDGE!`);
        else if (SINGLE[p[2]]) text(SINGLE[p[2]](w.name));
        else unknownLine(kind, p[2]);
        break;
      }
      case '-prepare': {
        const w = who(p[1]);
        const say = PREPARE[p[2]];
        if (say) text(say(w.name)); else unknownLine(kind, p[2]);
        break;
      }
      case '-ability': {
        const w = who(p[1]);
        if (p[2] === 'Pressure') text(`${w.name} is exerting its PRESSURE!`);
        else if (p[2] === 'Intimidate' && p.includes('boost')) intimidate = w.name;
        else if (tag(p, 'from') === 'ability: Trace' && tag(p, 'of')) text(`${w.name} TRACED ${who(tag(p, 'of')!).name}'s ${abilityName(p[2])}!`);
        else if (p[2] === 'Intimidate' || p[2] === 'Drizzle' || p[2] === 'Drought' || p[2] === 'Sand Stream') { /* the effect's line says it */ }
        else unknownLine(kind, p[2]);
        break;
      }
      case '-item': case '-enditem': {
        const w = who(p[1]);
        if (p.includes('[silent]')) break;
        const from = tag(p, 'from');
        if (kind === '-item' && from?.startsWith('move: ')) text(`${w.name} obtained ${heldName(p[2])}.`);
        else if (kind === '-enditem' && from === 'move: Knock Off') text(`${tag(p, 'of') ? who(tag(p, 'of')!).name : 'Its foe'} knocked off ${w.name}'s ${heldName(p[2])}!`);
        else if (kind === '-enditem' && from === 'move: Thief') { /* the -item says it */ }
        else if (kind === '-enditem' && p.includes('[eat]')) { /* the effect's own line follows */ }
        else if (kind === '-enditem' && p[2] === 'White Herb') text(`${w.name}'s WHITE HERB restored its stats!`);
        else if (kind === '-enditem' && p[2] === 'Mental Herb') text(`${w.name}'s MENTAL HERB cured its infatuation!`);
        else if (kind === '-item' && p[2] === 'Leftovers') { /* */ }
        else unknownLine(kind, p[2]);
        break;
      }
      case '-transform': text(`${who(p[1]).name} transformed into ${who(p[2]).name.replace(/^Foe /, '')}!`); break;
      case '-formechange': if (p[1]) text(`${who(p[1]).name} transformed!`); break;
      case '-fieldstart': if (p[1] === 'move: Mud Sport') text("Electricity's power was weakened!"); else if (p[1] === 'move: Water Sport') text("Fire's power was weakened!"); break;
      case '-fieldactivate': case '-fieldend': break;
      case '-mustrecharge': case '-clearboost': case '-swapboost': case '-invertboost': case '-restoreboost': case '-clearnegativeboost': break;
      case '-swapsideconditions': case '-center': case '-hint': case '-message': case '-combine': case '-waiting': case '-block': case '-primal': case '-burst': case '-zpower': case '-zbroken': break;
      case 'faint': {
        const w = who(p[1]);
        out[w.side] = -1;
        log.push({ e: 'faint', side: w.side });
        text(`${w.name} fainted!`);
        break;
      }
      case 'turn': case 't:': case 'player': case 'teamsize': case 'gametype': case 'gen': case 'tier': case 'rule': case 'start': case 'upkeep': case 'win': case 'tie': case '': case 'callback': case 'debug': case 'request': case 'sideupdate': case 'seed': case 'rated': case 'clearpoke': case 'poke': case 'teampreview': case 'detailschange': case 'replace': case 'swap': case 'title': case 'j': case 'l': case 'n': case 'raw': case 'html': case 'uhtml': case 'message': case 'bigerror': case 'error': break;
      default: unknownLine(kind, p[1] ?? '');
    }
  }
  flush();
  const [seatA, seatB] = seats;
  if (winnerSeat === seatA) text(`${names.trainers[0]} defeated ${names.trainers[1]}!`);
  else if (winnerSeat === seatB) text(`${names.trainers[1]} defeated ${names.trainers[0]}!`);
  log.push({ e: 'end', winner: winnerSeat });
  return { log, unknown };
}
