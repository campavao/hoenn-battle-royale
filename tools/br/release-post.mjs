// The release's post in the community Discord's #announcements (ci.yml's "Announce the release in
// Discord"): the version and what changed, inline. Cam, 11-22: "can we show the change log inline?
// I don't think we also need the play link since it's the same every time."
//
//   node tools/br/release-post.mjs <tag> < release-body.md   -> the post's text on stdout
//
// The body is the GitHub release's: an author's own notes, or GitHub's generated list
// ("* <PR title> by @who in <url>", "**Full Changelog**: ..."). Nobody's handle, link or the
// owner's name goes to Discord: the server's text never names him.

/** Discord's limit for a message's content. */
export const DISCORD_MAX = 2000;

/** The owner's name out of a line: "(Cam, 11-22: ...)" asides go, and the name in prose becomes
 *  a player's. */
export function unnamed(line) {
  return line
    .replace(/\s*\((?:[^()]*\bCam\b[^()]*)\)/g, "")
    .replace(/\bCam's\b/g, "a player's")
    .replace(/\bCam\b/g, "a player")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The changes as bullets, from a release body. */
export function changes(body) {
  const out = [];
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^#+\s/.test(line) || /^\*\*Full Changelog\*\*/i.test(line) || /^\*\*New Contributors\*\*/i.test(line)) continue;
    if (/made their first contribution/i.test(line)) continue;
    // GitHub's generated "* title by @who in https://.../pull/N".
    line = line.replace(/\s+by @[\w-]+ in https?:\/\/\S+$/, "");
    line = line.replace(/^[-*•]\s+/, "");
    // Any other link or handle.
    line = line.replace(/<?https?:\/\/\S+>?/g, "").replace(/(^|\s)@[\w-]+/g, "$1");
    line = unnamed(line);
    if (line) out.push(line);
  }
  return out;
}

/** The whole post: the version, then each change as a bullet, cut to fit Discord. */
export function post(tag, body) {
  const head = `**Hoenn Battle Royale ${tag}** is live.`;
  const list = changes(body);
  if (!list.length) return head;
  let text = head;
  for (let i = 0; i < list.length; i++) {
    const next = `${text}\n• ${list[i]}`;
    const more = list.length - i - 1;
    const tail = more ? `\n…and ${more} more` : "";
    if ((next + tail).length > DISCORD_MAX) {
      const left = list.length - i;
      return `${text}\n…and ${left} more`.slice(0, DISCORD_MAX);
    }
    text = next;
  }
  return text;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("release-post.mjs")) {
  const tag = process.argv[2] ?? "";
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => { body += d; });
  process.stdin.on("end", () => { process.stdout.write(post(tag, body)); });
}
