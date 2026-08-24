# Spike: can a mobile in-app WebView feed Reel real Reddit content?

Date: 2026-08-23. Follows the "Live content" measurements in
`2026-08-23-mobile-tiktok-client-research.md`, which established that Reddit's
public listing endpoints return a bot-check page to every scripted client, so
a self-hosted proxy can never serve real posts.

**Question.** The extension works by reading posts out of a Reddit page the
user is already looking at. Can a phone app do the same — host reddit.com in
an in-app WebView the user signs into, inject the extension's scraper, and
render the results in Reel's swipe UI?

**Answer: yes in principle, with one hard design constraint and one piece of
plumbing that must be built. Nothing found here blocks it.**

## What was measured

| Check | Result | Consequence |
|---|---|---|
| `X-Frame-Options` on reddit.com | **`SAMEORIGIN`** | An `<iframe>` of Reddit inside the Capacitor page is **impossible**. The WebView must be a *native* view (Android `WebView`, iOS `WKWebView`), not an iframe. |
| Mobile UA on a scripted fetch | Same 8 KB bot shell, 0 posts | The device's UA does not help a background fetch. Nothing is gained by faking it. |
| Real Chrome, headed, fresh profile, human-shaped | **"Reddit - Prove your humanity"** — an explicit CAPTCHA | A *fresh* session must clear a human check. A hidden/background WebView would stall on a challenge it cannot pass. |
| Extension pipeline lifted verbatim out of `content/overlay.js` and run against mock Reddit DOM | 11 posts scraped → 9 resolved, typed image/video/embed, no errors | The scrape → resolve → enrich pipeline **ports unchanged**. It is not rewritten for mobile; it is injected. |

The CAPTCHA was not bypassed and must not be: the app's design has the *user*
clear it, which is exactly what a human does when they open Reddit anyway.

## The design this implies

1. **A user-facing WebView, not a hidden one.** "Connect Reddit" opens a real,
   visible in-app browser at reddit.com. The user signs in and clears any human
   check themselves, once. Their session cookie then lives in the app's WebView
   cookie jar, exactly as it lives in the browser the extension runs in.
2. **Script injection into a third-party page** is the one piece of plumbing to
   build. `@capacitor/browser` is **ruled out** — it uses Chrome Custom Tabs /
   `SFSafariViewController`, which by design cannot be injected into. The
   options are a community plugin that exposes `executeScript` (e.g.
   `@capgo/inappbrowser`) or a small custom Capacitor plugin wrapping
   `WebView.evaluateJavascript` on Android and `WKUserScript` on iOS.
3. **The injected payload already exists.** `mobile/tools/make-scrape-probe.mjs`
   extracts the pipeline from `content/overlay.js` using the same boundary the
   scraping tests use, so the injected bundle can never drift from the
   extension's real logic. Posts come back over the plugin's message bridge and
   render in Reel's pager.
4. **Pagination is the extension's trick**: scroll the WebView to the bottom and
   let Reddit's own infinite scroll fetch the next batch, then re-read the DOM.
5. **Enrichment and actions come free**, because inside that WebView the
   requests are same-origin and carry the user's cookies: `/api/info.json` for
   comment counts, flair, `over_18`, saved/vote state, and the modhash
   endpoints for vote/save. This is what the demo currently fakes.

## What is still unproven

- Whether a **signed-in mobile WebView** is served the real feed rather than a
  challenge. The browser half is proven (the extension does it daily); the
  device half needs an APK on a real phone — the first thing to check once one
  exists. `mobile/tools/reddit-scrape-probe.js` is the exact payload to try.
- Whether Reddit treats an Android WebView session differently from Firefox.

## Verify the browser half yourself (30 seconds)

`mobile/tools/reddit-scrape-probe.js` is generated, read-only, and reports what
a WebView-based Reel would see from your own session:

1. Open a Reddit feed you are signed in to and scroll once so posts render.
2. DevTools (F12) → Console → paste the whole file → Enter.

It prints posts found, a type breakdown, how many carry media, how many are
adult/spoiler, and — the tell for the enrichment path — whether
`/api/info.json` answered. It never votes, saves, or writes anything.

Regenerate it after any change to the extension's scraper:
`cd mobile && npm run probe`.

## Store note

Nothing here changes the App Store analysis: guideline 5.2.2 still applies to
an unofficial client however it obtains content, and this approach reads the
user's own logged-in session rather than an authorized API — which is the
extension's existing posture, and a weaker position for store review than
OAuth, not a stronger one. It is the right answer for a personal sideloaded or
self-hosted build; it is not the answer that gets past App Review.
