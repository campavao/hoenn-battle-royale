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

/** GitHub's groups (.github/release.yml) that stay off Discord: work players never see. */
export const UNPOSTED = new Set(["Behind the scenes"]);

/** One change as a player reads it: no handle, link or owner's name. "" for a line that is none. */
function clean(raw) {
  let line = raw.trim();
  if (!line || /^#+\s/.test(line) || /^\*\*Full Changelog\*\*/i.test(line) || /^\*\*New Contributors\*\*/i.test(line)) return "";
  if (/made their first contribution/i.test(line)) return "";
  // GitHub's generated "* title by @who in https://.../pull/N".
  line = line.replace(/\s+by @[\w-]+ in https?:\/\/\S+$/, "");
  line = line.replace(/^[-*•]\s+/, "");
  // Any other link or handle.
  line = line.replace(/<?https?:\/\/\S+>?/g, "").replace(/(^|\s)@[\w-]+/g, "$1");
  return unnamed(line);
}

/** The changes by group (Cam, 11-22: "sections like UI, Gameplay, Bug fix"): GitHub's "### Gameplay"
 *  groups from each PR's label, or one untitled group for notes with none. "Behind the scenes"
 *  is left out. */
export function sections(body) {
  const out = [];
  let at = { title: "", items: [] };
  for (const raw of String(body ?? "").split(/\r?\n/)) {
    const head = /^#{3,}\s+(.+?)\s*$/.exec(raw.trim());
    if (head) {
      if (at.items.length) out.push(at);
      at = { title: head[1], items: [] };
      continue;
    }
    const line = clean(raw);
    if (line) at.items.push(line);
  }
  if (at.items.length) out.push(at);
  return out.filter((s) => !UNPOSTED.has(s.title));
}

/** The changes as bullets, from a release body, every group's in order. */
export function changes(body) {
  return sections(body).flatMap((s) => s.items);
}

/** The whole post: the version, then each group under its heading with its changes as bullets,
 *  cut to fit Discord. */
export function post(tag, body) {
  const head = `**Hoenn Battle Royale ${tag}** is live.`;
  const lines = [];
  for (const g of sections(body)) {
    if (g.title) lines.push({ text: `\n**${g.title}**`, change: false });
    for (const item of g.items) lines.push({ text: `• ${item}`, change: true });
  }
  const total = lines.filter((l) => l.change).length;
  if (!total) return head;
  let text = head, shown = 0;
  for (const l of lines) {
    const next = `${text}\n${l.text}`;
    const left = total - shown - (l.change ? 1 : 0);
    const tail = left ? `\n…and ${left} more` : "";
    if ((next + tail).length > DISCORD_MAX) return `${text}\n…and ${total - shown} more`.slice(0, DISCORD_MAX);
    text = next;
    if (l.change) shown++;
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
