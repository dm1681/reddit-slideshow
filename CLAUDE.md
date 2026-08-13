# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reddit Slideshow is a Firefox browser extension that lets users view Reddit content (images, videos, text posts) in a fullscreen slideshow format. It extracts posts from any subreddit or feed and presents them one at a time with navigation controls.

## Tech Stack

- **Extension type**: Firefox WebExtension (Manifest V2 for Firefox compatibility)
- **Languages**: JavaScript, HTML, CSS
- **Build**: No build step required — raw WebExtension loaded via `about:debugging`

## Development Setup

### Loading the extension in Firefox
Preferred: `npm start` (web-ext) launches Firefox with the extension loaded and
live-reloads on file changes, using a persistent `reddit-slideshow-dev` profile.

By hand:
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file from the project root

Either way the add-on is **temporary** and disappears on browser restart.
Permanent installs must be signed by Mozilla — see README.md.

### Reloading after changes
Click "Reload" on the extension card in `about:debugging`, or press Ctrl+R in the extension's pages.

### Distribution
Published on AMO in the **listed** (public) channel; releases are cut by tagging
(`npm run bump patch` → tag → push), which triggers `.github/workflows/release.yml`.
See README.md for the full release and install procedure.

A version's AMO channel is fixed permanently at submission and version numbers
are unique across channels — v0.1.0 is unlisted, v0.1.1 onwards are listed.
Never add `update_url` to the manifest: AMO rejects it on listed submissions,
and Firefox already updates listed add-ons natively.

Note `manifest.json` is the version source of truth and carries a stable
`browser_specific_settings.gecko.id`. Never change that ID — Firefox treats a
different ID as a different extension, so updates would install alongside the
old copy instead of replacing it. Use `npm run bump` so manifest and package
versions stay in step.

## Architecture

- `manifest.json` — Extension manifest defining permissions, content scripts, popup, and background scripts
- `popup/` — Browser action popup. Runs a read-only `scanOnly` preflight so it
  can say what is on the page before starting anything.
- `slideshow/` — Fullscreen slideshow page that displays Reddit posts sequentially
  - `slideshow.js` — the controller: navigation, auto-advance, vote/save, the gate
  - `settings.js` — playback preferences, persisted to `localStorage`
  - `reel.js` — the `?` panel: keyboard legend and playback settings
  - `renderers/` — one per media type; each returns a cleanup that must silence
    everything it scheduled (see `test/test-auto-advance.js`)
- `background/` — Background script handling Reddit API calls and state management
- `content/` — Content scripts injected into Reddit pages (if needed for context-aware launching)

### Settings storage

Use `localStorage` on the extension origin, **not** `browser.storage`. The
manifest has no `storage` permission and adding one is a permission change on a
listed AMO add-on — a review plus a prompt for every existing user. The popup
and the slideshow share `moz-extension://<id>`, so they see the same values, and
`settings.js` listens for the `storage` event to pick up a change made by the
other document.

### Adult and spoiler posts

Gated by withholding `mediaUrl` from the renderer, never by CSS blur — a blur
means the file has already been downloaded and decoded. `nsfw`/`spoiler` are
read from both the `shreddit-post` attributes and `/api/info.json` and OR'd
together: the info.json fetch swallows its own failures, so trusting it alone
would fail open exactly when it matters. Never let a new code path clear these
flags; only ever add them.

### Data Flow
1. User triggers slideshow from popup or content script
2. Background script fetches posts from Reddit's JSON API (`https://www.reddit.com/r/{subreddit}.json`)
3. Slideshow page receives post data and renders each post with navigation (next/prev/auto-advance)

## Key Considerations

- Reddit's public JSON API requires no authentication — append `.json` to any listing URL
- Rate limiting: Reddit limits unauthenticated requests; cache responses and batch fetches
- Firefox extensions use Manifest V2 (`browser.*` APIs with promises), not Manifest V3
- Media types to handle: images (jpg/png/gif), videos (v.redd.it, gifv), galleries, text/self posts, and external links
- Cross-origin requests require `permissions` in manifest.json for reddit.com domains
