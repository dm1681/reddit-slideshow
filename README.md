# Reddit Slideshow

A Firefox extension that turns any Reddit listing into a fullscreen slideshow.
It scrapes posts from the page you are already looking at — no Reddit API calls,
no account, no auth — and plays images, videos, galleries and embeds one at a
time with keyboard navigation and auto-advance.

## Installing

The extension is published on addons.mozilla.org. Install it from its AMO
listing like any other Firefox extension — Firefox handles installation and
updates natively, on every machine, with nothing to configure.

Requires **Firefox 140 or newer** (the current ESR line). Older builds will
refuse to install it rather than installing something that half-works.

This source repository is private; only the built extension is public.

### Why signing is unavoidable

Firefox refuses to permanently install an extension that Mozilla has not
signed, and this is not configurable on the release or beta channels — the
`xpinstall.signatures.required` pref only has an effect on Developer Edition,
Nightly and ESR. `about:debugging` → *Load Temporary Add-on* works for
development, but the add-on is removed on every browser restart.

### A note on v0.1.0

v0.1.0 was published to the **unlisted** channel and is attached to its GitHub
Release. A version's channel is fixed permanently at submission, so it could
not be converted — v0.1.1 was published to the listed channel instead. Because
the add-on ID is unchanged, an existing v0.1.0 install updates in place from
AMO rather than appearing twice.

Version numbers are unique across both channels, so a number burned on one
channel cannot be reused on the other.

## Releasing a new version

```sh
npm run bump patch          # or minor / major / an explicit 1.2.3
git commit -am "chore: release v0.1.1"
git tag -a v0.1.1 -m "v0.1.1"
git push --follow-tags   # --follow-tags pushes annotated tags only
```

The tag triggers `.github/workflows/release.yml`, which runs the tests, lints
against AMO's validator, publishes to the AMO **listed** channel, and attaches
the signed `.xpi` to a GitHub Release as a convenience copy.

`npm run bump` refuses to move the version backwards, because AMO will not
re-sign a version number it has already issued.

`amo-metadata.json` holds the AMO listing fields — categories, summary,
description, and licence. AMO requires them on a first listed submission, and
passing the file on every release keeps the published listing in step with the
repo. Category slugs and licence slugs are validated by AMO and are not free
text; the valid sets come from
[the categories API](https://addons.mozilla.org/api/v5/addons/categories/) and
[the licence list](https://mozilla.github.io/addons-server/topics/api/licenses.html).

If AMO approval outruns the workflow's 30-minute wait, `web-ext` gives up
*after* the submission has already gone through. The release still publishes;
only the GitHub copy of the `.xpi` is skipped. Never retry by re-tagging the
same version — AMO will reject it as already submitted. Bump instead.

### One-time setup: AMO API credentials

Signing needs Mozilla add-on API credentials.

1. Sign in at [addons.mozilla.org](https://addons.mozilla.org/) and go to
   [Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/).
2. Generate a key. You get a **JWT issuer** (`user:12345:67`) and a **JWT
   secret**, shown once.
3. Add them as repository secrets:

```sh
gh secret set AMO_JWT_ISSUER
gh secret set AMO_JWT_SECRET
```

The secret signs code as you — treat it like a password. It is never needed
locally unless you want to sign by hand.

### Signing locally instead of in CI

```sh
export AMO_JWT_ISSUER='user:12345:67'
export AMO_JWT_SECRET='...'
npm run sign
```

This publishes for real — `--channel listed` makes the version public. The
signed `.xpi` lands in `web-ext-artifacts/`.

## Updates

Firefox updates listed add-ons from AMO natively. There is nothing to host and
no `update_url` in the manifest — AMO would reject one on a listed submission.

`scripts/make-update-manifest.js` generates an `updates.json` for the
self-hosted case. It is unused while the add-on is listed, and kept only so
that switching back to self-distribution does not mean rebuilding it.

## Development

```sh
npm install
npm test           # Playwright-driven DOM scraping + integration tests
npm run lint       # AMO validator
npm run build      # unsigned .zip in web-ext-artifacts/
npm start          # launch Firefox with the extension loaded, live-reloading
```

`npm start` uses a persistent profile (`reddit-slideshow-dev`), so Reddit
logins survive across runs.

To load a working copy by hand: `about:debugging#/runtime/this-firefox` →
*Load Temporary Add-on…* → pick `manifest.json`. This lasts until you restart
Firefox.

### What ships in the XPI

`web-ext-config.cjs` controls packaging. Only the runtime source is included —
tests, docs, scripts and local tool output are excluded. Verify a build with:

```sh
npm run build && unzip -l web-ext-artifacts/reddit_slideshow-*.zip
```

## Architecture

| Path | Role |
| --- | --- |
| `manifest.json` | MV2 manifest — permissions, add-on ID, entry points |
| `content/overlay.js` | Scrapes and classifies posts from the live Reddit DOM |
| `background/background.js` | Session state, message API, redgifs resolution |
| `slideshow/` | Fullscreen player and per-type renderers |
| `popup/` | Toolbar button UI that starts a slideshow |

Media handling worth knowing about:

- **v.redd.it** renditions are discovered from `DASHPlaylist.mpd`, never
  guessed. Reddit renamed `DASH_<res>.mp4` to `CMAF_<res>.mp4`, and guessed
  filenames return 403.
- **redgifs** posts resolve to a direct MP4 through the redgifs API, off the
  startup path — a slow or hung API degrades to an embed instead of blocking
  the slideshow from opening.
