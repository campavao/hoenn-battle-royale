// `#battleview`: the page-drawn battle on its own, playing a canned log, so a spec or a look at it
// needs no match (as `#solo` is for the match). `#battleview&follow=1&at=<ms>&hold` follows side 1,
// starts <ms> in, and holds there (nolv leaves the level out, as the ROM's battle does in a match;
// wild plays the fight with a wild POKeMON);
// the view is on `window.__battleview`.
import { BattleView } from './battleview';
import { CANNED_LOG, WILD_LOG } from './fixtures/battlelog-canned';
import type { RomArt } from './romart';

export function openDevBattleView(art: RomArt, hash: string): BattleView {
  const q = new URLSearchParams(hash.replace(/^#battleview&?/, ''));
  const host = document.createElement('div');
  host.id = 'battleview-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#101418;';
  document.body.appendChild(host);
  // &behind: a plain picture to show through the ground's sky, as the field does in a match.
  const field = document.createElement('canvas');
  field.width = 240;
  field.height = 160;
  const g = field.getContext('2d')!;
  g.fillStyle = '#304838';
  g.fillRect(0, 0, 240, 160);
  g.fillStyle = '#486050';
  for (let i = 0; i < 240; i += 16) g.fillRect(i, 0, 8, 160);
  const view = new BattleView(host, { art, ...(q.has('behind') ? { behind: () => field } : {}) }, { follow: q.get('follow') === '1' ? 1 : 0, autoplay: !q.has('hold'), levels: !q.has('nolv') });
  const at = Number(q.get('at')) || 0;
  view.play(q.has('wild') ? WILD_LOG : CANNED_LOG, at);
  if (q.has('hold')) view.seek(at);
  (window as unknown as { __battleview: BattleView }).__battleview = view;
  return view;
}
