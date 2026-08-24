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

## Self-host on your LAN or tailnet (recommended for daily use)

The serve script is a self-host server, not just a dev convenience: it serves
the app **and proxies Reddit listing reads at `/reddit/`**, so the browser
fetches same-origin and the CORS wall never comes up. Traffic to reddit.com
leaves from the box you run it on — your residential IP, one person's volume,
a 60s cache, an honest User-Agent, and only `r/{sub}.json` listing paths are
proxied (nothing else relays).

> **Live Reddit does not currently work through this proxy — and will not for
> any scripted client.** Measured from a residential connection on 2026-08-23:
> `https://www.reddit.com/r/<sub>.json` returns **HTTP 403** with a ~190 KB
> HTML challenge page instead of JSON — for curl, for Node `fetch`, with an
> honest User-Agent and with a browser one alike; `old.reddit.com/....json`
> 302s to a login wall (`reason=lor2`); the plain HTML page returns 200 but is
> a JavaScript bot-check shell containing **zero** `shreddit-post` elements;
> and a real automated Chromium with JS enabled is served that same challenge
> page. The extension in this repo still works because it runs inside your
> own human-driven, logged-in Firefox, which has cleared that challenge and
> carries your cookies — a self-hosted proxy has neither.
>
> So `?sub=...` reports the failure and falls back to the demo feed. Real
> content needs OAuth against `oauth.reddit.com`, or an in-app WebView where
> you sign in yourself and the feed is read from the DOM (what the extension
> does). See "Live content: what actually reaches Reddit" in the research doc.

```sh
cd mobile && npm install && npm run serve
# it prints your LAN URL, e.g. http://192.168.1.20:4173/
```

- **Phone on the same Wi-Fi**: open the LAN URL — the demo feed works fully.
  `?sub=EarthPorn` exercises the real listing path, which today ends at the
  bot wall above and falls back to the demo with a message.
- **From anywhere via Tailscale**: on the host, `tailscale serve 4173` — you
  get an `https://<machine>.<tailnet>.ts.net` URL with a real certificate.
  HTTPS is also what unlocks **Add to Home Screen as a standalone app**: the
  manifest + service worker are in place, but browsers only install PWAs from
  a secure context (plain `http://<lan-ip>` runs fine, it just won't install
  standalone or work offline).
- Installed over HTTPS, the app shell and demo work offline.
- Once a live path lands, iOS Safari plays Reddit video with audio natively
  (it picks `hls_url`); browsers without native HLS would get the silent
  fallback rendition — hls.js is the known fix, not built yet.

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

## Live Reddit content: the WebView path

Reddit's public listing endpoints are closed to scripted clients (see the
self-host note above), so live content cannot come from a proxy. The route
that does work is the extension's: read posts out of a Reddit page a signed-in
human is looking at — on mobile, an in-app WebView the user signs into once.

`docs/superpowers/specs/2026-08-23-webview-spike.md` has the spike: an iframe
is impossible (`X-Frame-Options: SAMEORIGIN`), a fresh session must clear a
human check itself, and the extension's scrape pipeline ports **unchanged**
(proven by extracting and running it).

`npm run probe` regenerates `tools/reddit-scrape-probe.js` — a read-only
console snippet that reports what a WebView-based Reel would see from your own
logged-in session. Paste it into DevTools on a Reddit feed to check the
browser half yourself.

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
