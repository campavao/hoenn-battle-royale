// What relay/world/service.js is: the service and the maps it walks.
import type { WorldMap } from '../../src/bots/world';
import type { PatchTable } from '../../src/bots/patches';
import worldJson from '../data/world.json';
import patchJson from '../../src/data/patches.json';

export { WorldService } from './service';
export const MAPS = (worldJson as { maps: WorldMap[] }).maps;
export const PATCHES = patchJson as unknown as PatchTable;
