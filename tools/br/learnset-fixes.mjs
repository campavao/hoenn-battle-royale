#!/usr/bin/env node
// Where the battle engine's Gen 3 level-up lists are not Emerald's. Showdown's data carries one list
// a species, FireRed's for most of Kanto and Johto; the ROM's is src/data/pokemon/level_up_learnsets.h.
// This writes the difference as level and move numbers, public facts and no code, for
// shared/battlesim.ts's movesFor to read over the engine's (tools/br/build-sim.mjs).
//
//   node tools/br/learnset-fixes.mjs           write web/spike-b/shared/learnset-fixes.json
//   node tools/br/learnset-fixes.mjs --check   exit 1 if it is not what the headers say now
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'web/spike-b/shared/learnset-fixes.json');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/** include/constants/moves.h: MOVE_X to its number. */
function moveNumbers() {
  const nums = new Map();
  for (const m of read('include/constants/moves.h').matchAll(/^#define (MOVE_\w+)\s+(\d+)\s*$/gm)) nums.set(m[1], Number(m[2]));
  return nums;
}

/** The headers' lists, by the name of the array: [level, move, level, move...], in their order. */
function romLists(nums) {
  const lists = new Map();
  for (const m of read('src/data/pokemon/level_up_learnsets.h').matchAll(/static const u16 (\w+)\[\] = \{([\s\S]*?)\};/g)) {
    const row = [];
    for (const e of m[2].matchAll(/LEVEL_UP_MOVE\(\s*(\d+),\s*(MOVE_\w+)\)/g)) {
      if (!nums.has(e[2])) throw new Error(`no number for ${e[2]}`);
      row.push(Number(e[1]), nums.get(e[2]));
    }
    lists.set(m[1], row);
  }
  return lists;
}

/** SPECIES_MR_MIME as Showdown's id, mrmime. */
const engineId = (name) => name.replace(/^SPECIES_/, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every species the pointers header gives a list: its engine id, and its list. */
function romSpecies() {
  const lists = romLists(moveNumbers());
  const rows = new Map();
  for (const m of read('src/data/pokemon/level_up_learnset_pointers.h').matchAll(/\[(SPECIES_\w+)\]\s*=\s*(\w+)/g)) {
    if (m[1] === 'SPECIES_NONE') continue;
    const row = lists.get(m[2]);
    if (!row) throw new Error(`no list ${m[2]} for ${m[1]}`);
    rows.set(engineId(m[1]), row);
  }
  return rows;
}

const pairs = (row) => {
  const p = [];
  for (let i = 0; i < row.length; i += 2) p.push(`${row[i]}:${row[i + 1]}`);
  return p;
};

/** Those whose list in the engine is not the ROM's, the order among a level's moves counted: the
 *  walk teaches in that order, so a tie can pick another four. */
async function build() {
  const { LEVEL_UP } = await import(pathToFileURL(resolve(root, 'web/spike-b/shared/engine/gen3.mjs')).href);
  const fixes = {};
  for (const [id, row] of romSpecies()) {
    const theirs = LEVEL_UP[id];
    if (!theirs) continue; // the empty slots between Celebi and Treecko
    if (pairs(theirs).join() !== pairs(row).join()) fixes[id] = row;
  }
  return fixes;
}

const fixes = await build();
const text = `{\n${Object.keys(fixes).sort().map((k) => `"${k}":${JSON.stringify(fixes[k])}`).join(',\n')}\n}\n`;
if (process.argv.includes('--check')) {
  let was = '';
  try { was = readFileSync(out, 'utf8').replace(/\r\n/g, '\n'); } catch { /* none yet */ }
  if (was !== text) {
    console.error('web/spike-b/shared/learnset-fixes.json is stale: node tools/br/learnset-fixes.mjs');
    process.exit(1);
  }
} else {
  writeFileSync(out, text);
  console.log(`wrote web/spike-b/shared/learnset-fixes.json: ${Object.keys(fixes).length} species`);
}
