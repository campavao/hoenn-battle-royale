#!/usr/bin/env node
// The battle engine for bot-vs-bot fights (web/spike-b/shared/battlesim.ts): Pokemon Showdown's
// simulator (MIT, @pkmn/sim's extraction), cut to Gen 3 and committed as one file, so neither the
// relay's bundle nor the page's chunk carries all nine generations (6.3 MB) or needs the package
// installed. Showdown's own public data and code only: nothing here reads the ROM or the decomp.
//
//   node tools/br/build-sim.mjs           write web/spike-b/shared/engine/gen3.mjs
//   node tools/br/build-sim.mjs --check   exit 1 if stale
//
// Needs web/node_modules/@pkmn/sim (a devDependency, pinned). Gen 3 inherits from every newer
// generation's mod, so the mods stay; what goes is what a Gen 3 fight never reads: later moves,
// abilities, items and species, every learnset but Gen 3's level-up one, legality, formats,
// descriptions, the team validator and the random-battle tools.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'web/package.json'));
const esbuild = require('esbuild');
const pkg = resolve(root, 'web/node_modules/@pkmn/sim');
const esm = resolve(pkg, 'build/esm').replace(/\\/g, '/');
const out = resolve(root, 'web/spike-b/shared/engine/gen3.mjs');

const LAST = { move: 354, ability: 76, species: 386 };
/** Species a Gen 3 battle can change into; every other forme (Mega, Alola, Gmax...) goes. */
const KEEP_FORMES = /^(castform|deoxys)/;

/** A data table as tsc writes it, `export const X = {` then entries at four spaces: its entries
 *  as [key, text]. Showdown's generated output is regular enough to cut by line. */
function entries(code) {
  const lines = code.split(/\r?\n/);
  const start = lines.findIndex((l) => /^export const \w+ = \{\s*$/.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\};?\s*$/.test(l));
  const list = [];
  let i = start + 1;
  while (i < end) {
    const m = lines[i].match(/^ {4}("?)([^":\s]+)\1: (.*)$/);
    if (!m) { i++; continue; } // a comment between entries
    let j = i;
    // Whole on its one line (`x: null,`, `x: { inherit: true },`), or up to its closing brace.
    if (m[3].endsWith('{')) while (!/^ {4}\},?\s*$/.test(lines[j])) j++;
    list.push([m[2], lines.slice(i, j + 1).join('\n')]);
    i = j + 1;
  }
  return { head: lines.slice(0, start + 1).join('\n'), tail: lines.slice(end).join('\n'), list };
}

function filterTable(code, keep) {
  const t = entries(code);
  if (!t) return code;
  return [t.head, ...t.list.filter(([k, text]) => keep(k, text)).map(([, text]) => text), t.tail].join('\n');
}

const read = (rel) => readFileSync(`${esm}/${rel}`, 'utf8');
const numOf = (text) => Number(text.match(/\n {8}num: (-?\d+)/)?.[1] ?? NaN);
const keepMove = (k, text) => { const n = numOf(text); return n > 0 && n <= LAST.move; };
const keepAbility = (k, text) => { const n = numOf(text); return n >= 0 && n <= LAST.ability && !/isNonstandard: "CAP"/.test(text); };
const keepItem = (k, text) => { const g = text.match(/\n {8}gen: (\d)/); return !g || Number(g[1]) <= 3; };
const keepSpecies = (k, text) => {
  const n = numOf(text);
  if (!(n > 0 && n <= LAST.species)) return false;
  return !/\n {8}forme: /.test(text) || KEEP_FORMES.test(k);
};
const keysOf = (rel, keep) => new Set(entries(read(rel)).list.filter(([k, t]) => keep(k, t)).map(([k]) => k));
const moveKeys = keysOf('data/moves.mjs', keepMove);
const abilityKeys = keysOf('data/abilities.mjs', keepAbility);
const itemKeys = keysOf('data/items.mjs', keepItem);
const speciesKeys = keysOf('data/pokedex.mjs', keepSpecies);

/** The one format a fight runs under: no rules, Gen 3's mod. */
const FORMATS = `export const Formats = [{ name: '[Gen 3] Custom Game', mod: 'gen3', gameType: 'singles', ruleset: [] }];`;

// Modules a Gen 3 fight never reads, by path under build/esm.
const STUBS = [
  [/^data\/mods\/(gen1|gen2|gen8bdsp|gen8legends)\/index\.mjs$/, 'export {};'],
  [/^data\/(mods\/\w+\/)?learnsets\.mjs$/, 'export const Learnsets = {};'],
  [/^data\/(mods\/\w+\/)?legality\.mjs$/, 'export const Legality = {};'],
  [/^data\/pokemongo\.mjs$/, 'export const PokemonGoData = {};'],
  [/^data\/text\/abilities\.mjs$/, 'export const AbilitiesText = {};'],
  [/^data\/text\/items\.mjs$/, 'export const ItemsText = {};'],
  [/^data\/text\/moves\.mjs$/, 'export const MovesText = {};'],
  [/^data\/text\/default\.mjs$/, 'export const DefaultText = {};'],
  [/^data\/aliases\.mjs$/, 'export const Aliases = {};'],
  [/^data\/tags\.mjs$/, 'export const Tags = {};'],
  [/^data\/rulesets\.mjs$/, 'export const Rulesets = {};'],
  [/^data\/mods\/\w+\/rulesets\.mjs$/, 'export const Rulesets = {};'],
  [/^data\/formats-data\.mjs$/, 'export const FormatsData = {};'],
  [/^data\/mods\/\w+\/formats-data\.mjs$/, 'export const FormatsData = {};'],
  [/^config\/formats\.mjs$/, FORMATS],
  [/^sim\/teams\.mjs$/, `export const Teams = { pack() { return ''; }, unpack() { return null; } };`],
];
// Tables kept, with what is past Gen 3 out of them.
const TABLES = [
  [/^data\/moves\.mjs$/, keepMove],
  [/^data\/mods\/\w+\/moves\.mjs$/, (k) => moveKeys.has(k)],
  [/^data\/abilities\.mjs$/, keepAbility],
  [/^data\/mods\/\w+\/abilities\.mjs$/, (k) => abilityKeys.has(k)],
  [/^data\/items\.mjs$/, keepItem],
  [/^data\/mods\/\w+\/items\.mjs$/, (k) => itemKeys.has(k)],
  [/^data\/pokedex\.mjs$/, keepSpecies],
  [/^data\/mods\/\w+\/pokedex\.mjs$/, (k) => speciesKeys.has(k)],
];

const cut = {
  name: 'gen3-only',
  setup(build) {
    build.onLoad({ filter: /\.mjs$/ }, (args) => {
      const path = args.path.replace(/\\/g, '/');
      if (!path.startsWith(`${esm}/`)) return undefined;
      const rel = path.slice(esm.length + 1);
      for (const [re, code] of STUBS) if (re.test(rel)) return { contents: code, loader: 'js' };
      const code = readFileSync(args.path, 'utf8');
      for (const [re, keep] of TABLES) if (re.test(rel)) return { contents: filterTable(code, keep), loader: 'js' };
      return { contents: code, loader: 'js' };
    });
  },
};

// Gen 3's level-up learnsets, public data out of Showdown's table: species id to level, move num, ...
const { Learnsets } = await import(pathToFileURL(`${esm}/data/learnsets.mjs`).href);
const { Moves } = await import(pathToFileURL(`${esm}/data/moves.mjs`).href);
const { Pokedex } = await import(pathToFileURL(`${esm}/data/pokedex.mjs`).href);
const gen3Level = (id, move) => {
  const levels = (Learnsets[id]?.learnset?.[move] ?? []).filter((s) => /^3L\d+$/.test(s)).map((s) => Number(s.slice(2)));
  return levels.length ? Math.min(...levels) : 0;
};
/** Where the line before this species learned a move: a species' "level 1" list is its line's. */
const lineLevel = (id, move) => {
  for (let at = Pokedex[id]?.prevo; at; at = Pokedex[toKey(at)]?.prevo) {
    const level = gen3Level(toKey(at), move);
    if (level) return level;
  }
  return 0;
};
const toKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const levelUp = {};
for (const id of [...speciesKeys].sort()) {
  const set = Learnsets[id]?.learnset;
  if (!set) continue;
  const row = [];
  for (const [move, sources] of Object.entries(set)) {
    if (!Moves[move]) continue;
    for (const s of sources) {
      if (/^3L\d+$/.test(s)) row.push({ level: Number(s.slice(2)), num: Moves[move].num, line: lineLevel(id, move), hits: Moves[move].basePower > 0 });
    }
  }
  // Within a level, as the game's tables run: what the line learned first first, an attack before
  // what is not. A walk's ties go to the move taught first, so this picks a few moves of a set.
  row.sort((a, b) => a.level - b.level || a.line - b.line || Number(b.hits) - Number(a.hits) || a.num - b.num);
  if (row.length) levelUp[id] = row.flatMap((r) => [r.level, r.num]);
}

const license = readFileSync(resolve(pkg, 'LICENSE'), 'utf8').trim().replace(/\r/g, '');
const version = JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8')).version;
const entry = `export { Battle } from '${esm}/sim/battle.mjs';
export { Dex, toID } from '${esm}/sim/dex.mjs';
export const LEVEL_UP = ${JSON.stringify(levelUp)};
`;
const r = await esbuild.build({
  stdin: { contents: entry, resolveDir: pkg, loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
  charset: 'utf8',
  absWorkingDir: root,
  plugins: [cut],
  banner: { js: `/*! @license GENERATED by tools/br/build-sim.mjs from @pkmn/sim ${version}, Pokemon Showdown's simulator cut to Gen 3 -- do not edit.\n${license}\n*/` },
});
const text = r.outputFiles[0].text;
if (process.argv.includes('--check')) {
  let now = '';
  try { now = readFileSync(out, 'utf8'); } catch { /* missing */ }
  if (now !== text) { console.error('web/spike-b/shared/engine/gen3.mjs is stale: run node tools/br/build-sim.mjs'); process.exit(1); }
  console.log('web/spike-b/shared/engine/gen3.mjs is fresh');
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote web/spike-b/shared/engine/gen3.mjs (${(text.length / 1024).toFixed(0)} KB)`);
}
