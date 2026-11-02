// Who draws over the map's cover: the ROM puts a sprite above BG1 by its height, not by what
// it stands near (sElevationToPriority, event_object_movement.c), so somebody on Meteor Falls'
// bridge is on the planks and somebody surfing under it is under them.
import { ELEVATION_TO_PRIORITY } from '../src/field-extra';

const H_TRANSITION = 0;
const H_BRIDGE = 15;
const H_GROUND = 3;

export class Heights {
  private readonly last = new Map<number, number>();

  constructor(private readonly height: (map: string, x: number, y: number) => number) {}

  /** ObjectEventUpdateElevation: a transition or a bridge cell keeps the height you came with.
   *  A spot on a bridge may say which level, for somebody first seen there. */
  over(id: number, s: { map: string; x: number; y: number; z?: number }): boolean {
    const h = this.height(s.map, s.x, s.y);
    if (h !== H_TRANSITION && h !== H_BRIDGE) this.last.set(id, h);
    else if (s.z !== undefined) this.last.set(id, s.z);
    return ELEVATION_TO_PRIORITY[this.last.get(id) ?? H_GROUND] <= 1;
  }
}
