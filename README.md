# Reddit Slideshow

A Firefox extension that turns any Reddit listing into a fullscreen slideshow.
It scrapes posts from the page you are already looking at — no Reddit API calls,
no account, no auth — and plays images, videos, galleries and embeds one at a
time with keyboard navigation and auto-advance.

## Installing on another machine

Firefox refuses to permanently install an extension that Mozilla has not signed.
This is not configurable on the release or beta channels: the
`xpinstall.signatures.required` pref only has an effect on Developer Edition,
Nightly and ESR. `about:debugging` → *Load Temporary Add-on* works, but the
add-on is removed on every browser restart.

So the extension is distributed as an **unlisted** add-on: Mozilla signs the
package but never lists it publicly, and the signed `.xpi` is attached to a
GitHub Release here.

### Install

1. Open the [latest release](../../releases/latest) and download
   `reddit-slideshow-<version>.xpi`.
2. In Firefox, open `about:addons`.
3. Click the gear icon → **Install Add-on From File…** and pick the `.xpi`.

Dragging the `.xpi` onto a Firefox window also works.

Requires **Firefox 140 or newer** (the current ESR line). Older builds will
refuse to install it rather than installing something that half-works.

> This repository is private, so GitHub release downloads require you to be
> signed in. Step 1 must happen in a logged-in browser; a bare `curl` of the
> asset URL returns a 404.

### Automatic updates

Firefox polls an add-on's `update_url` anonymously, with no auth header, so a
private repository cannot serve updates — the request 404s. Auto-update
therefore needs the two small update files on a public host, while this
source repository stays private. See [Enabling auto-update](#enabling-auto-update)
below. Until that is set up, updating means downloading the new `.xpi` and
installing it over the old one, which Firefox handles in place.

## Releasing a new version

```sh
npm run bump patch          # or minor / major / an explicit 1.2.3
git commit -am "chore: release v0.1.1"
git tag v0.1.1
git push --follow-tags
```

The tag triggers `.github/workflows/release.yml`, which runs the tests, lints
against AMO's validator, submits to AMO for signing, and publishes the signed
`.xpi` plus `updates.json` as a GitHub Release.

`npm run bump` refuses to move the version backwards, because AMO will not
re-sign a version number it has already issued.

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

The signed `.xpi` lands in `web-ext-artifacts/`. Unlisted submissions go
through automated review, which usually completes in a few minutes.

## Enabling auto-update

Auto-update needs `updates.json` and the `.xpi` files reachable without
authentication. The usual arrangement is a second, **public** repository that
holds only releases, leaving this source repo private:

1. Create a public repo, e.g. `reddit-slideshow-releases`.
2. Point the release job at it by setting a repository variable:
   ```sh
   gh variable set UPDATE_BASE_URL \
     --body "https://github.com/dm1681/reddit-slideshow-releases/releases/download"
   ```
   and change the `Publish release` step to target that repo (`gh release
   create --repo dm1681/reddit-slideshow-releases`).
3. Add the matching `update_url` to `manifest.json`:
   ```json
   "browser_specific_settings": {
     "gecko": {
       "id": "reddit-slideshow@dm1681.github.io",
       "update_url": "https://github.com/dm1681/reddit-slideshow-releases/releases/latest/download/updates.json"
     }
   }
   ```

The `update_url` is baked into the installed add-on, so it only takes effect
from the first build that carries it — install that build manually once, and
every later version arrives on its own.

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
