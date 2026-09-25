# Deploying Hoenn Battle Royale

Two things run in production: the **site** on Vercel (the shell, the patch and its
sidecars) and the **relay** on Railway. They deploy separately. Everything here runs from
the repo root in **Git Bash** (not the MSYS2 shell: it has no node), from a machine that
has the retail ROM at `C:/Users/cam95/Downloads/Pokemon - Emerald Version (U).gba`.

Check what is live first:

```bash
curl -s https://hoenn-battle-royale.vercel.app/patch/br-version.json
```

`romSha1` is the ROM the site hands out; the version line on the page shows its first
seven characters (`rom b37cbc1`). If yours differs from what you just built, the site is
behind.

## The site (Vercel)

1. **Build the ROM** (agbcc, the release compiler; never `make modern` for a release), in
   the MSYS2 UCRT64 shell:

   ```bash
   MSYSTEM=UCRT64 CHERE_INVOKING=1 /c/msys64/usr/bin/bash.exe -lc 'cd "/c/Users/cam95/Documents/Github/hoenn-battle-royale" && make -j8'
   ```

   Skip this when only `web/` changed: the ROM on disk is still the one the site serves.

2. **Sidecars and the patch**, from Git Bash. This writes `br-symbols.json`,
   `br-version.json` and `hoenn-br.bps` into `web/public/patch/`:

   ```bash
   bash tools/br/dev-patch.sh pokeemerald.map "C:/Users/cam95/Downloads/Pokemon - Emerald Version (U).gba"
   ```

   The patch comes from `tools/br/make-patch.sh`, the same script CI runs for a tag:
   flips at a pinned commit (`tools/br/flips.sh`; the first run clones and builds it in
   the MSYS2 shell, about 15 s), then `tools/br/make-bps.ts` applies it with the page's
   own decoder and refuses it unless retail + patch is this ROM byte for byte and the
   file is under 2 MB. Expect about 0.7 MB. A patch near 10 MB is shifted retail ROM,
   which is what the old same-offset encoder shipped until 2026-09-24.

   Run it after committing, so `br-version.json` names the commit that is going out;
   `release-web.sh` refuses sidecars stamped at any other commit (a build of uncommitted
   changes is stamped `<sha>-dirty`) and a tree with uncommitted changes.

3. **Deploy**:

   ```bash
   bash tools/br/release-web.sh --prod
   ```

   It refuses to publish unless the sidecars and the patch match the ROM on disk and the
   patch is under the ceiling, deploys from the repo
   root (the Vercel project's Root Directory is `web`), and then checks the live site
   serves the three patch files, names this build's `romSha1` and **404s the ROM**
   (`tools/br/verify-site.sh`, which a tag's CI runs too). `live: https://hoenn-battle-royale.vercel.app`
   at the end means it worked.

4. **Prove it** against the real site, with a stock ROM, the way a player arrives:

   ```bash
   cd web && HBR_BASE_ROM="C:/Users/cam95/Downloads/Pokemon - Emerald Version (U).gba" HBR_LIVE_URL="https://hoenn-battle-royale.vercel.app" npx playwright test e2e/live.spec.ts e2e/live-room.spec.ts
   ```

If the Vercel CLI asks you to log in: `npx vercel login`. The project is
`hoenn-battle-royale` in the team `campavaos-projects`. A phone that shows an old version
after a deploy: open the site with `#fresh` on the URL once (drops the service worker and
its caches).

## The emulator core

`web/public/emu/` (mgba.js, mgba.wasm, mgba.d.ts) is tracked and goes out with the shell.
It is thenick775's `feature/wasm` at `tools/br/mgba-wasm/COMMIT` plus
`tools/br/mgba-wasm/hbr-exports.patch` (the EWRAM pointers and, since POK-319, the
picture past the LCD). The tracked files are what the site serves and what the e2e
boots; nothing in CI replaces them. CI's `wasm` job rebuilds the core from the patch on
every push and warns ("wasm core drift") when its sha256s differ from the tracked
ones. When the patch changes, rebuild in WSL and copy the output in before deploying:

```bash
wsl.exe -e bash -lc 'source ~/emsdk/emsdk_env.sh; cd ~/mgba-wasm/build-wasm && make -j8 && cp wasm/mgba.js wasm/mgba.wasm wasm/mgba.d.ts wasm/mgba.wasm.map /mnt/c/Users/cam95/Documents/Github/hoenn-battle-royale/web/public/emu/'
```

The WSL tree at `~/mgba-wasm` keeps the patch as uncommitted changes; `git diff` there
is the patch file, and `git stash && git apply --check <patch> && git stash pop` proves
it still applies to the pinned commit.

## The relay (Railway)

Only when `relay/` changed. A relay deploy restarts it and **drops every room**, so do it
when nobody is playing (`/play.html` shows who is on).

```bash
cd relay && railway up --detach
```

`relay/` is linked to the Railway project `kanto-br-relay`, environment `production`,
service `hoenn-relay`. If the link is gone (`railway status` says so):

```bash
cd relay && railway link --project 34e1da0b-5125-40be-9954-d90fafa3e156 --environment production --service hoenn-relay
```

If the CLI is not logged in: `railway login`. The relay's address is hardcoded in the shell
(`DEFAULT_RELAY_URL` in `web/src/app.ts`, `wss://hoenn-relay-production.up.railway.app`),
so no env var is needed. Watch it come up:

```bash
railway logs
```

The relay's test suite is `cd relay && node --test`. Both sides of a link battle must run
the same patch and the relay gates rooms on `br-version.json`'s `protocol`, so a relay that
raises `minProtocol` needs the site deployed first.

## By tag (CI does all of the above)

```bash
git tag -a v0.2.0 -m "what changed, in a sentence or two"
git push origin v0.2.0
```

`.github/workflows/ci.yml`'s `release` job builds the ROM with agbcc, diffs it against
the baseline pret build into the BPS (no retail ROM needed), attaches the patch and its
sidecars to a GitHub release with the tag's message as the note, deploys the site, and
redeploys the relay only if `relay/` changed since the previous tag. The shell is named
after the tag (`shell 0.2.0` on the version line).

Two repo secrets make it fully automatic (GitHub → Settings → Secrets → Actions):

| secret | from | without it |
|---|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens | the site step warns and skips; run `release-web.sh --prod` by hand |
| `RAILWAY_TOKEN` | Railway account token (set 2026-09-18) | the relay step warns and skips; `railway up` by hand |

## What must never happen

The ROM is never published: not in a release asset, not on the site, not in git.
`.vercelignore`, `vite.config.ts`'s `br-drop-roms` and `web/scripts/no-rom.mjs` each keep
it out on their own, and `release-web.sh` fails the deploy if `/patch/pokeemerald.gba`
answers anything but 404. If you ever see a 200 there, take the deployment down in the
Vercel dashboard before anything else.
