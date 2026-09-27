// world.json and landing.json are fetched on demand (match/landing.ts's worldReady()), and
// the tests read HOENN and LANDING at module level, as the page never does before it has
// waited. Every test file starts with them in.
import { worldReady } from './src/match/landing';

await worldReady();
