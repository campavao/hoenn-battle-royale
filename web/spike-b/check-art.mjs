// Spike B: are the pictures romart.ts cuts from the ROM the ones we ship?
//
//   npx vite --port 5199 &   then   node spike-b/check-art.mjs
//
// Needs web/public/spike-rom/rom.gba + br-symbols.json (gitignored). Renders every
// outdoor map in world.json (ground, cover, border) and every object sprite sheet from
// the ROM in a headless browser and diffs them against web/public/field-maps and
// field-sprites at the ROM's own 5-bit colour. Exits 1 on any difference.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
if (!existsSync(new URL('../public/spike-rom/rom.gba', import.meta.url))) { console.log('skip: no web/public/spike-rom/rom.gba'); process.exit(0); }
const b = await chromium.launch(); const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', String(e)));
await p.goto('http://localhost:5199/spike-b/index.html?bots=0'); await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const { RomArt } = await import('/spike-b/romart.ts');
  const world = (await import('/src/data/world.json')).default;
  const sheets = (await import('/src/data/sprites.json')).default;
  const rom = new Uint8Array(await (await fetch('/spike-rom/rom.gba')).arrayBuffer());
  const syms = await (await fetch('/spike-rom/br-symbols.json')).json();
  const t0 = performance.now();
  const art = new RomArt(rom, (n) => Number(syms[n]));
  const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
  const pix = (src, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(src, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const diff = (a, bb) => { let n = 0; for (let i = 0; i < a.length; i += 4) { const ta = a[i+3] === 0, tb = bb[i+3] === 0; if (ta !== tb) { n++; continue; } if (ta) continue; if ((a[i]>>3)!==(bb[i]>>3)||(a[i+1]>>3)!==(bb[i+1]>>3)||(a[i+2]>>3)!==(bb[i+2]>>3)) n++; } return n; };
  const out = []; let renderMs = 0;
  for (const m of world.maps.filter((m) => m.outdoor)) {
    const s = performance.now(); const a = art.map(m.group, m.num); renderMs += performance.now() - s;
    const res = [];
    for (const [k, suf] of [['ground', ''], ['cover', '.cover'], ['border', '.border']]) {
      let ref; try { ref = await load(`/field-maps/${m.id}${suf}.png`); } catch { res.push(k + ':noref'); continue; }
      const cv = a[k];
      if (ref.width !== cv.width || ref.height !== cv.height) { res.push(`${k}:size ${cv.width}x${cv.height} vs ${ref.width}x${ref.height}`); continue; }
      const d = diff(pix(cv, cv.width, cv.height), pix(ref, cv.width, cv.height));
      if (d) res.push(`${k}:${d}px`);
    }
    out.push(m.id + ' ' + (res.join(' ') || 'exact'));
  }
  const sp = []; let spriteMs = 0, bad = 0, n = 0;
  for (const [g, info] of Object.entries(sheets)) {
    if (Number(g) >= 1000) continue;
    n++;
    const s = performance.now(); const cv = art.sprite(Number(g), info.frames); spriteMs += performance.now() - s;
    let ref; try { ref = await load(`/field-sprites/${g}.png`); } catch { sp.push(g + ':noref'); continue; }
    if (ref.width !== cv.width) { sp.push(`${g}:size`); bad++; continue; }
    const d = diff(pix(cv, cv.width, cv.height), pix(ref, cv.width, cv.height));
    if (d) { sp.push(`${g} ${info.name}:${d}px`); bad++; }
  }
  return { maps: out, mapMs: renderMs, sprites: n, spriteBad: bad, spriteMs, sp: sp.slice(0, 20), total: performance.now() - t0 };
});
const bad = r.maps.filter((m) => !m.endsWith(' exact'));
console.log(`${r.maps.length - bad.length}/${r.maps.length} outdoor maps exact (ground, cover, border), ${r.sprites - r.spriteBad}/${r.sprites} sprite sheets exact`);
for (const m of [...bad, ...r.sp]) console.log('  ' + m);
await b.close();
process.exit(bad.length || r.spriteBad ? 1 : 0);
