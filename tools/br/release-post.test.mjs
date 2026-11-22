// node --test tools/br/release-post.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { changes, post, sections, unnamed, DISCORD_MAX } from "./release-post.mjs";

const GENERATED = `## What's Changed
* Spectating: leaders as themselves and gone once beaten, short borderless glow by @campavao in https://github.com/campavao/hoenn-battle-royale/pull/417
* Play log reads a relay's last stretch after a redeploy (lost leaderboard win) by @campavao in https://github.com/campavao/hoenn-battle-royale/pull/420


**Full Changelog**: https://github.com/campavao/hoenn-battle-royale/compare/v0.3.135...v0.3.136`;

test("GitHub's generated notes become bullets, with no handle, link or Full Changelog", () => {
  assert.deepEqual(changes(GENERATED), [
    "Spectating: leaders as themselves and gone once beaten, short borderless glow",
    "Play log reads a relay's last stretch after a redeploy (lost leaderboard win)",
  ]);
});

test("the post is the version and the changes, with no play link (Cam, 11-22)", () => {
  const text = post("v0.3.136", GENERATED);
  assert.equal(text, "**Hoenn Battle Royale v0.3.136** is live.\n• Spectating: leaders as themselves and gone once beaten, short borderless glow\n• Play log reads a relay's last stretch after a redeploy (lost leaderboard win)");
  assert.ok(!/vercel\.app|https?:/.test(text));
});

test("an author's own notes go as they are, bullets or lines", () => {
  assert.deepEqual(changes("- Berries open the party\nThe minimap shows FLY"), ["Berries open the party", "The minimap shows FLY"]);
  assert.equal(post("v1", ""), "**Hoenn Battle Royale v1** is live.");
});

test("never the owner's name", () => {
  assert.equal(unnamed("A berry opens the party (Cam, 11-22: no YES/NO)"), "A berry opens the party");
  assert.equal(unnamed("Cam's notes from the play-test"), "a player's notes from the play-test");
  assert.ok(!/\bCam\b/.test(post("v1", "* Fixes from Cam's video by @campavao in https://x/pull/1")));
});

test("a long list is cut to fit Discord, saying how many more", () => {
  const body = Array.from({ length: 80 }, (_, i) => `* Change number ${i} with a fairly long title to fill the post up by @x in https://x/pull/${i}`).join("\n");
  const text = post("v2", body);
  assert.ok(text.length <= DISCORD_MAX, String(text.length));
  assert.match(text, /…and \d+ more$/);
});

const GROUPED = `<!-- Release notes generated using configuration in .github/release.yml at hoenn-battle-royale -->

## What's Changed
### Gameplay
* Cracked floors give way by @campavao in https://github.com/campavao/hoenn-battle-royale/pull/423
### UI
* A FLY wing on the minimap by @campavao in https://github.com/campavao/hoenn-battle-royale/pull/418
### Bug fixes
* The leaderboard no longer misses wins by @campavao in https://github.com/campavao/hoenn-battle-royale/pull/420
### Behind the scenes
* Release posts group their changes by @campavao in https://github.com/campavao/hoenn-battle-royale/pull/426


**Full Changelog**: https://github.com/campavao/hoenn-battle-royale/compare/v0.3.137...v0.3.138`;

test("grouped notes post under their headings, with nothing behind the scenes (Cam, 11-22)", () => {
  assert.deepEqual(sections(GROUPED).map((s) => s.title), ["Gameplay", "UI", "Bug fixes"]);
  assert.equal(post("v0.3.138", GROUPED),
    "**Hoenn Battle Royale v0.3.138** is live.\n\n**Gameplay**\n• Cracked floors give way\n\n**UI**\n• A FLY wing on the minimap\n\n**Bug fixes**\n• The leaderboard no longer misses wins");
});

test("a release with only behind-the-scenes changes posts the version alone", () => {
  assert.equal(post("v9", "## What's Changed\n### Behind the scenes\n* CI tidy by @x in https://x/pull/1"), "**Hoenn Battle Royale v9** is live.");
});

test("a long grouped list is cut to fit, saying how many more", () => {
  const body = ["### Gameplay", ...Array.from({ length: 60 }, (_, i) => `* Gameplay change ${i} with a fairly long title to fill the post by @x in https://x/pull/${i}`),
    "### UI", ...Array.from({ length: 30 }, (_, i) => `* UI change ${i} by @x in https://x/pull/${i}`)].join("\n");
  const text = post("v3", body);
  assert.ok(text.length <= DISCORD_MAX, String(text.length));
  const shown = (text.match(/^• /gm) ?? []).length;
  assert.ok(text.endsWith(`…and ${90 - shown} more`), text.slice(-40));
});
