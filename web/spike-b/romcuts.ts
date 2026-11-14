// Which of the ROM's pictures each of the page's picture paths names (src/art/pictures.ts), cut
// with romart.ts. The paths are the ones the site used to ship files at, and each cut is laid
// out as that file was (web/e2e/art.spec.ts holds it to the old file's hash):
//
//   /field-maps/MAP_<id>[.cover|.border].png   a map's ground, the cover over people, its border
//   /field-maps/fill/<x>_<y>.png, sea.png        the menu's backdrop between the maps, 512 px a
//                                                piece (tools/br/export-menu-pan.py bake_fill)
//   /field-sprites/<gfx>.png                     an object's sprite sheet; 1000 SURF's blob; fog
//   /mon-pics/<species>[s].png                   a species' still front picture, s for shiny
//   /trainer-pics/<pic>.png                      a trainer's front picture
//   /ui/<name>.png                               the font, the frame, the message box, the signs,
//                                                the item and type icons, the TRAINER CARD,
//                                                HOW TO PLAY's pictures (howtoart.ts)
import spritesData from '../src/data/sprites.json';
import type { Cutter } from '../src/art/pictures';
import type { RomArt } from './romart';
import { SEA_METATILE, type WorldFill } from './worldfill';
import { howtoSheet } from './howtoart';

const SHEETS = spritesData as Record<string, { frames: number }>;
/** export-sprites.py's key for SURF's blob, past every object gfx id. */
const SURF_BLOB = 1000;
/** OBJ_EVENT_GFX_BRENDAN_NORMAL: the blob wears the surfer's palette, and his and May's agree. */
const GFX_BRENDAN = 0;
/** MAPPOPUP_THEME_*, in order. */
const POPUP_THEMES = ['wood', 'marble', 'stone', 'brick', 'underwater', 'stone2'];
/** Each skin's portrait (br_ghosts.c sSkinGraphics' order), a TRAINER_PIC_*: the class that
 *  dresses like the skin's sheet; the rivals are the same two people. */
export const SKIN_PICS = [71, 72, 71, 72, 0, 22, 29, 30, 7, 66, 9, 24, 51, 52, 53, 77];
/** include/constants/items.h ITEMS_COUNT: the item sheet's ids (spike-b/shared/items.ts has it too). */
const ITEMS_COUNT = 377;
/** A piece of the menu's fill, in cells. */
const FILL_CELLS = 32;
/** What a fill cell with no map of its own is drawn with (export-menu-pan.py START). */
const FILL_HOME = 'MAP_LITTLEROOT_TOWN';

export interface CutDeps {
  /** A map's group and number by its MAP_ id. */
  mapRef(id: string): { group: number; num: number } | undefined;
  /** The world's fill (spike-b/data/world-fill.json), null until it has loaded. */
  fill(): WorldFill | null;
}

export function romCutter(art: RomArt, deps: CutDeps): Cutter {
  // A map's three layers are cut together: keep the last map's while its others are asked for.
  let lastMap: { id: string; art: ReturnType<RomArt['map']> } | null = null;
  const fillPiece = (name: string): HTMLCanvasElement | null | undefined => {
    const home = deps.mapRef(FILL_HOME);
    if (!home) return null;
    if (name === 'sea') return art.cells(FILL_CELLS, FILL_CELLS, () => ({ ...home, id: SEA_METATILE }));
    const m = /^(\d+)_(\d+)$/.exec(name);
    if (!m) return null;
    const fill = deps.fill();
    if (!fill) return undefined;
    const gx0 = fill.x0 + Number(m[1]) * FILL_CELLS, gy0 = fill.y0 + Number(m[2]) * FILL_CELLS;
    return art.cells(FILL_CELLS, FILL_CELLS, (x, y) => {
      const t = fill.metatile(gx0 + x, gy0 + y);
      const ref = t?.ref ? deps.mapRef(t.ref) : home;
      return ref ? { ...ref, id: t ? t.id : SEA_METATILE } : null;
    });
  };

  return (path) => {
    let m: RegExpExecArray | null;
    if ((m = /^\/field-maps\/fill\/([\w]+)\.png$/.exec(path))) return fillPiece(m[1]);
    if ((m = /^\/field-maps\/(MAP_\w+?)(\.cover|\.border)?\.png$/.exec(path))) {
      const ref = deps.mapRef(m[1]);
      if (!ref) return null;
      if (lastMap?.id !== m[1]) lastMap = { id: m[1], art: art.map(ref.group, ref.num) };
      return m[2] === '.cover' ? lastMap.art.cover : m[2] === '.border' ? lastMap.art.border : lastMap.art.ground;
    }
    if ((m = /^\/field-sprites\/(\w+)\.png$/.exec(path))) {
      if (m[1] === 'fog') return art.fog();
      const gfx = Number(m[1]);
      if (gfx === SURF_BLOB) return art.surfBlob(GFX_BRENDAN);
      const sheet = SHEETS[m[1]];
      return sheet && gfx < SURF_BLOB ? art.sprite(gfx, sheet.frames) : null;
    }
    if ((m = /^\/mon-pics\/(\d+)(s?)\.png$/.exec(path))) return art.monStill(Number(m[1]), m[2] === 's');
    if ((m = /^\/trainer-pics\/(\d+)\.png$/.exec(path))) return art.trainerPic(Number(m[1]), false);
    if ((m = /^\/ui\/popup-(\w+)\.png$/.exec(path))) return art.mapPopup(POPUP_THEMES.indexOf(m[1]));
    switch (path) {
      case '/ui/font-normal.png': return art.fontMask();
      case '/ui/frame-1.png': return art.windowFrame();
      case '/ui/message-box.png': return art.messageBox();
      case '/ui/items.png': return art.itemIcons(ITEMS_COUNT);
      case '/ui/types.png': return art.typeIcons();
      case '/ui/trainer-card.png': return art.trainerCards();
      case '/ui/card-badges.png': return art.cardBadges();
      case '/ui/trainer-pics.png': return art.trainerStrip(SKIN_PICS);
      case '/ui/howto-sheet.png': return howtoSheet(art, deps.mapRef);
      default: return null;
    }
  };
}
