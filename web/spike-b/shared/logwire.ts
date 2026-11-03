// A battle log off the wire (battlelog.ts's events): what the relay accepts from a fighter's page
// and what a page accepts from the relay. A log comes from a network, so every event is rebuilt
// from the fields it is allowed to have, whole numbers in range and text of a sane length, or
// dropped. Nothing here throws: a bad event is a missing event, never a crash.

import type { BattleEvent, LogMon, LogSide, Side } from './battlelog';

/** Events in one message, at most: a turn is a dozen. */
export const LOG_MSG_EVENTS = 80;
/** A message from a phone, at most (characters): the relay's socket takes 4096 bytes a frame and
 *  hangs up on one more (relay/world.js maxPayload), so a page cuts its events into messages of
 *  this much (chunkEvents) and the relay turns away a longer one. */
export const LOG_MSG_CHARS = 3800;
/** A line of the message box, at most: Emerald's box holds two lines of about 30. */
export const LOG_TEXT_MAX = 160;
/** One fight's log kept for a watcher who comes in late, at most. A long fight is a few KB. */
export const LOG_STREAM_EVENTS = 1500;
export const LOG_STREAM_CHARS = 96 * 1024;

const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;

/** Printable text only, as many characters as `max`. */
function line(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

const sideOf = (v: unknown): Side | undefined => (v === 0 || v === 1 ? v : undefined);

function monOf(m: unknown): LogMon | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const o = m as Record<string, unknown>;
  const species = int(o.species, 1, 1023), level = int(o.level, 1, 100), hp = int(o.hp, 0, 9999), maxHp = int(o.maxHp, 1, 9999), status = int(o.status, 0, 255);
  if (species === undefined || level === undefined || hp === undefined || maxHp === undefined || status === undefined) return undefined;
  const gender = int(o.gender, 0, 2), nick = line(o.nickname, 12);
  return {
    species, level, hp: Math.min(hp, maxHp), maxHp, status,
    ...(o.shiny === true ? { shiny: true } : {}),
    ...(gender !== undefined ? { gender } : {}),
    ...(nick ? { nickname: nick } : {}),
  };
}

function sideTeam(s: unknown): LogSide | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Record<string, unknown>;
  const seat = int(o.seat, 0, 0x7fffffff), skin = int(o.skin, 0, 255), name = line(o.name, 24);
  if (seat === undefined || skin === undefined || name === undefined || !Array.isArray(o.team) || o.team.length > 6) return undefined;
  const team: LogMon[] = [];
  for (const m of o.team) {
    const mon = monOf(m);
    if (!mon) return undefined;
    team.push(mon);
  }
  return { seat, name, skin, team };
}

/** One event rebuilt from its allowed fields, or undefined. */
export function cleanEvent(raw: unknown): BattleEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  switch (o.e) {
    case 'start': {
      const a = sideTeam(o.a), b = sideTeam(o.b), map = line(o.map, 64);
      return a && b && map !== undefined ? { e: 'start', a, b, map } : undefined;
    }
    case 'send': {
      const side = sideOf(o.side), slot = int(o.slot, 0, 5);
      return side !== undefined && slot !== undefined ? { e: 'send', side, slot } : undefined;
    }
    case 'back': {
      const side = sideOf(o.side);
      return side !== undefined ? { e: 'back', side } : undefined;
    }
    case 'text': {
      const text = line(o.text, LOG_TEXT_MAX);
      return text ? { e: 'text', text } : undefined;
    }
    case 'hit': {
      const side = sideOf(o.side), move = int(o.move, 0, 0xffff);
      return side !== undefined ? { e: 'hit', side, ...(move ? { move } : {}) } : undefined;
    }
    case 'hp': {
      const side = sideOf(o.side), hp = int(o.hp, 0, 9999);
      return side !== undefined && hp !== undefined ? { e: 'hp', side, hp } : undefined;
    }
    case 'status': {
      const side = sideOf(o.side), status = int(o.status, 0, 255);
      return side !== undefined && status !== undefined ? { e: 'status', side, status } : undefined;
    }
    case 'faint': {
      const side = sideOf(o.side);
      return side !== undefined ? { e: 'faint', side } : undefined;
    }
    case 'end': {
      const winner = int(o.winner, 0, 0x7fffffff);
      return winner !== undefined ? { e: 'end', winner } : undefined;
    }
    default:
      return undefined;
  }
}

/** `events` cut into runs that each fit a message (LOG_MSG_CHARS, with `extra` characters of
 *  envelope), in order. An event that alone is too big goes by itself (the relay drops it). */
export function chunkEvents(events: readonly BattleEvent[], extra = 40, max = LOG_MSG_EVENTS): BattleEvent[][] {
  const out: BattleEvent[][] = [];
  let run: BattleEvent[] = [], chars = extra;
  for (const ev of events) {
    const n = JSON.stringify(ev).length + 1;
    if (run.length && (chars + n > LOG_MSG_CHARS || run.length >= max)) { out.push(run); run = []; chars = extra; }
    run.push(ev);
    chars += n;
  }
  if (run.length) out.push(run);
  return out;
}

/** The events of a message, each rebuilt, the bad ones dropped, at most `max`. Not an array:
 *  nothing. */
export function cleanEvents(raw: unknown, max = LOG_MSG_EVENTS): BattleEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: BattleEvent[] = [];
  for (let i = 0; i < raw.length && out.length < max; i++) {
    const ev = cleanEvent(raw[i]);
    if (ev) out.push(ev);
  }
  return out;
}
