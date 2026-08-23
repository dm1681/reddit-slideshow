# Reel — TikTok-style mobile client

A vertical-swipe, fullscreen-media Reddit feed grown out of the Reddit
Slideshow extension. The web core lives in `www/` (plain ES modules, no build
step — same ethos as the extension); Capacitor wraps it into a native Android/
iOS app. Background and decisions:
`../docs/superpowers/specs/2026-08-23-mobile-tiktok-client-research.md`.

## Try it in a browser (demo feed)

```sh
cd mobile
npm install
npm run serve        # http://localhost:4173/
```

The bundled demo feed is 8 posts in Reddit's real listing wire shape — video
with audio, image, silent gif loop, an 18+ post, a 3-image gallery, a spoiler,
a text post, a link card — with media generated offline (VP9/Opus WebM).
Swipe / arrow keys / Space (auto-advance). `?sub=EarthPorn` tries a live
subreddit listing; in a plain browser that is CORS-blocked by reddit.com and
falls back to the demo with a toast — the packaged app routes `fetch` through
native HTTP instead (`CapacitorHttp`).

## Run it on a phone (Android)

Requires Android Studio (or SDK + JDK) on your machine:

```sh
cd mobile
npm install
npx cap add android    # generates android/ (gitignored; one command to regen)
npx cap run android    # build + install on a connected device
```

`npx cap sync` re-copies `www/` after changes. iOS is the same dance with
`@capacitor/ios` and a Mac.

## What's deliberately NOT here yet

- **Reddit sign-in (OAuth)** — and with it real votes/saves. Blocked on the
  research doc's open question #1: what Reddit's June-2026 Responsible Builder
  Policy requires before registering an installed app. The vote/save UI is
  fully wired (optimistic + rollback) against the source interface; the demo
  source accepts writes locally, the Reddit source refuses them with an
  honest message.
- **Comments** — the 💬 button opens the post on reddit.com.
- **redgifs/embed resolution** — terms question, see research doc.

## Invariants carried over from the extension

- **The gate**: adult/spoiler posts render a card and the media URL is
  withheld — never a blur, and the file is never fetched while masked
  (`npm test` asserts this from the network log). Flags are OR'd from every
  source and only ever added.
- **Cleanup contract**: an inactive page is paused, muted, and schedules
  nothing; every timer dies with its slide.
- **Honest progress**: `n / total+` until the feed is truly exhausted.
- **Gif ≠ video**: silent, looping, advances after max(dwell, one full loop).

## Tests & viz artifacts

- `npm test` — 33 behavioral checks driven through phone-shaped Chromium
  (`tools/selfcheck.mjs`); needs `npm run serve` running.
- `npm run shoot:mockups` / `shoot:real` / `shoot:compare` — regenerate the
  expected/real/side-by-side artifacts in `../docs/design/mobile/screens/`.
- `npm run demo:media` — regenerate the bundled demo media offline.
