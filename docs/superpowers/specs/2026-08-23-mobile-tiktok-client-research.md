# Research: turning Reddit Slideshow into a standalone TikTok-style mobile Reddit client

Date: 2026-08-23. Scope: Reddit API rules as of 2026, v.redd.it playback on mobile, framework
options, app-store policy risk, and what in this repo survives the port.

**How to read the citations.** Every claim links to the source it was checked against.
Claims marked **[VERIFIED]** were confirmed against a primary source fetched during this
research. Claims marked **[UNVERIFIED]** could not be confirmed because this environment's
egress proxy blocks the primary page (all reddit.com/redditinc.com/reddithelp.com domains,
support.google.com, apps.apple.com, f-droid.org, developer.mozilla.org's site, w3.org, and
web.archive.org were all refused at the proxy — the URL is given so it can be checked from a
normal network). Where a blocked site's content lives in a public GitHub/GitLab source repo,
the source repo was fetched instead and counts as verified.

---

## Executive summary

1. **The API, not the code, is the hard part.** A personal-use client is workable: register an
   "installed app" (no client secret), authenticate with OAuth, stay inside the free
   ~100 queries/min budget. But as of 2026 Reddit reportedly gates *all* Data API access
   behind an explicit approval request (June 2026 "Responsible Builder Policy" —
   [UNVERIFIED], primary page blocked), and the plain `.json` scraping this extension leans
   on is against the rules Reddit has published since the OAuth era and is throttled/blocked
   for unauthenticated callers.
2. **Video is a solved problem if you use `hls_url`.** Reddit's own published types
   ([VERIFIED] via Reddit's `@devvit/protos` npm package) give every hosted video a
   `hls_url`, a `dash_url`, and a video-only `fallback_url`. HLS plays natively on both iOS
   (AVPlayer) and Android (ExoPlayer/Media3); DASH is Android-only. Feed the players
   `HLSPlaylist.m3u8` and both platforms get video *with audio* — which this extension never
   had (it picks a video-only DASH rendition; see §5).
3. **Store risk is real and concentrated in two rules:** Apple 5.2.2 (you must be
   "specifically permitted" to use a third-party service — [VERIFIED] verbatim) and both
   stores' NSFW rules (NSFW must be off/hidden by default; Apple requires the opt-in toggle
   to live *on your website*, not in-app — [VERIFIED] verbatim). Surviving third-party
   clients (Narwhal: subscription; Infinity: open source with the API key stripped from the
   repo — [VERIFIED]) show the coexistence pattern.
4. **Recommendation:** React Native + Expo, Android-first, personal sideloaded build before
   any store submission. It reuses the most pure-JS logic from this repo, gets real native
   video players (not a WebView), and defers the two existential risks (Reddit approval,
   store review) to a phase where the app already works. Details and phases at the end.

---

## 1. Reddit API for third-party mobile clients (post-2023, as of 2026)

### Terms documents

- **Data API Terms** — https://www.redditinc.com/policies/data-api-terms.
  **[UNVERIFIED — page blocked by this environment's proxy]**, as was the Wayback Machine
  copy. Search-corroborated summary (multiple independent secondary sources, e.g.
  [prowlo.com](https://prowlo.com/blog/reddit-data-api),
  [socialcrawl.dev](https://www.socialcrawl.dev/blog/reddit-data-api-2026)): effective April
  2023; personal/non-commercial use is permitted within the free rate limits; **any
  commercial use requires Reddit's permission and a contract**. TechCrunch reported in May
  2024 that Reddit's Public Content Policy made commercial data use contract-only
  ([techcrunch.com](https://techcrunch.com/2024/05/09/reddit-locks-down-its-public-data-in-new-content-policy-says-use-now-requires-a-contract)) — secondary source.
- **Developer Terms** — https://www.redditinc.com/policies/developer-terms.
  **[UNVERIFIED — blocked]**; not summarized here rather than quoted from memory.
- **Responsible Builder Policy** — https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy.
  **[UNVERIFIED — blocked]**. Multiple search results date it June 5, 2026 and quote the core
  requirement as "You must request access and get explicit approval before accessing any
  Reddit data through our API." Secondary sources further claim self-service app
  registration is closed and approvals take weeks with manual review
  ([redditapis.com](https://www.redditapis.com/reddit-responsible-builder-policy),
  [fetchlayer.dev](https://fetchlayer.dev/blog/reddit-api-closed-2026)) — those sources are
  SEO-blog grade; treat the *existence and date* of the policy as likely and the process
  details as low-confidence until read directly. **This is the single most important thing
  to verify from a normal network before writing any code.**

### Rate limits

- Historical official rule **[VERIFIED]** at the archived Reddit API rules wiki
  ([github.com/reddit-archive/reddit/wiki/API](https://github.com/reddit-archive/reddit/wiki/API)):
  "Clients connecting via OAuth2 may make up to 60 requests per minute," monitored via the
  `X-Ratelimit-Used` / `X-Ratelimit-Remaining` / `X-Ratelimit-Reset` response headers, and
  "Clients must authenticate with OAuth2."
- Current figures — free tier **100 queries/minute per OAuth client id, averaged over a
  10-minute window; ~10 QPM for requests without OAuth** — are attributed to the Reddit Data
  API Wiki at
  https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki and
  https://www.reddit.com/wiki/api. **[UNVERIFIED — both blocked]**; figures corroborated by
  several independent secondary sources
  ([octolens.com](https://octolens.com/blog/reddit-api-pricing),
  [painpointmap.com](https://www.painpointmap.com/blog/reddit-api-rate-limits-guide)).
- Sizing check: 100 QPM is far more than one swiping user needs (one listing call returns up
  to 100 posts), but the limit is **per client id, not per user** [UNVERIFIED, same sources]
  — a widely distributed free app shares one budget, which is exactly the trap the 2023
  pricing was built to monetize.

### OAuth app types and registration

**[VERIFIED]** against the archived official OAuth2 wiki
([github.com/reddit-archive/reddit/wiki/OAuth2](https://github.com/reddit-archive/reddit/wiki/OAuth2)):

- Three app types: web app, **installed app** ("Runs on devices you don't control, such as
  the user's mobile phone. Cannot keep a secret, and therefore, does not receive one"), and
  script.
- Token endpoint `https://www.reddit.com/api/v1/access_token`; authenticated calls go to
  `https://oauth.reddit.com`. Bearer tokens last 1 hour; `duration=permanent` (code flow)
  adds a refresh token; the implicit flow allowed to installed apps never gives permanent
  tokens.
- Userless ("app only") access for installed apps exists via the
  `https://oauth.reddit.com/grants/installed_client` grant plus a `device_id` — i.e. a
  browse-without-login mode is officially provided for.
- Real-world confirmation that installed apps use the **code flow with an empty client
  secret**: Infinity for Reddit's source builds HTTP Basic auth as `CLIENT_ID + ":" + ""`
  and sets `RESPONSE_TYPE = "code"`
  ([APIUtils.java](https://github.com/Docile-Alligator/Infinity-For-Reddit/blob/master/app/src/main/java/ml/docilealligator/infinityforreddit/utils/APIUtils.java)) **[VERIFIED]**.
- Registration historically self-service at `reddit.com/prefs/apps` [the archived wiki and
  2026 how-to guides still describe this — reddit.com blocked, so current state
  **UNVERIFIED**; the Responsible Builder Policy above may now front it with an approval
  form].
- User-Agent rules **[VERIFIED]** (archived API wiki): format
  `<platform>:<app ID>:<version string> (by /u/<reddit username>)`, e.g.
  `android:com.example.myredditapp:v1.2.3 (by /u/kemitche)`; default library UAs are
  "drastically limited"; "NEVER lie about your user-agent… We will ban liars with extreme
  prejudice."

### The 2023 pricing, and what applies to a small free client today

All **[UNVERIFIED at the primary source]** (announcements live on reddit.com, blocked);
consistently reported by contemporaneous press:

- Effective July 1, 2023: **$0.24 per 1,000 API calls** above the free tier; Apollo's
  developer was quoted ~$12,000 per 50M requests ≈ **$20M/year** and shut Apollo down
  June 30, 2023
  ([techcrunch.com](https://techcrunch.com/2023/05/31/popular-reddit-app-apollo-may-go-out-of-business-over-reddits-new-unaffordable-api-pricing/),
  [appleinsider.com](https://appleinsider.com/articles/23/06/08/reddit-app-apollo-is-shutting-down-over-reddits-expensive-api-prices)).
- Exemptions Reddit announced at the time: **mod tools/bots and non-commercial
  accessibility-focused apps** (e.g. RedReader, Dystopia) stayed free [UNVERIFIED,
  secondary]. A hobby TikTok-style client is neither; it would ride the general free tier.
- What a small free client means in practice today: stay under 100 QPM on one client id,
  non-commercial (no ads, no paid tier) to avoid the contract requirement, and expect that
  scale = either per-user API keys (Infinity's self-build model, §4) or a Reddit
  arrangement (Narwhal's subscription model, §4).

### Are the plain `.json` endpoints viable from a distributed mobile app?

No — plan around OAuth from day one.

- The official rules have required OAuth since the archived wiki era ("Clients must
  authenticate with OAuth2" **[VERIFIED]**), and post-2023 unauthenticated traffic is
  reported throttled to ~10 QPM per client/IP and increasingly blocked outright
  [UNVERIFIED, secondary].
- **Live test impossible from here:** `curl https://www.reddit.com/r/videos.json?limit=2&raw_json=1`
  (descriptive UA) failed at this environment's egress proxy (CONNECT 403, policy denial)
  before ever reaching Reddit, so per-IP behavior, response headers, and CORS headers could
  not be observed. That the test could not even be run from a cloud box is itself a fair
  preview of the fragility: unauthenticated `.json` from datacenter/cloud IPs is widely
  reported to get 403/429 responses [UNVERIFIED, e.g.
  [data365.co](https://data365.co/blog/reddit-api-limits)].
- The extension gets away with it because its requests ride the *user's logged-in browser
  session* (same-origin fetches with cookies, residential IP) — none of which a standalone
  app has.

---

## 2. v.redd.it video on mobile

### The `secure_media.reddit_video` shape — verified from Reddit's own published types

Live JSON could not be fetched (reddit.com blocked at the proxy), but Reddit publishes the
shape itself in `@devvit/protos` on npm (v0.14.1, fetched from
[registry.npmjs.org/@devvit/protos](https://registry.npmjs.org/@devvit/protos/latest);
file `types/devvit/plugin/redditapi/common/common_msg.d.ts`) **[VERIFIED]**:

- `SecureMedia { type, oembed?, redditVideo? }` — "Populated when the post media is a video
  hosted on Reddit."
- `RedditVideo` fields, with Reddit's own doc comments:
  - `dashUrl` — "The URL to the DASH playlist file. E.g. `https://v.redd.it/abc123/DASHPlaylist.mpd`"
  - `hlsUrl` — "The URL to the HLS playlist file. E.g. `https://v.redd.it/abc123/HLSPlaylist.m3u8`"
  - `fallbackUrl` — "The direct URL to the video. E.g. `https://v.redd.it/abc123/DASH_1080.mp4?source=fallback`"
  - `isGif`, plus `bitrateKbps`, `duration`, `width`, `height`, `scrubberMediaUrl`,
    `transcodingStatus`.
  - (The listing JSON serves these snake_case: `dash_url`, `hls_url`, `fallback_url`,
    `is_gif` — the camelCase above is the proto/TS rendering of the same fields.
    Snake_case naming corroborated by this repo's scraping of `.json` responses.)
- Post-level `over18` and `spoiler` booleans exist in the same `RedditObject` type
  **[VERIFIED]** — the mobile app can keep this repo's gate semantics on API data alone.

### Fallback MP4s carry no audio

**[VERIFIED against a real captured manifest]**: this repo's regression fixture
(`test/test-vreddit.js`, "Trimmed from a real v.redd.it DASHPlaylist.mpd (June 2026 CMAF
era)") shows the DASH manifest with a **video-only AdaptationSet** (`CMAF_360.mp4`,
`CMAF_480.mp4`) and a **separate audio AdaptationSet** (`CMAF_AUDIO_64.mp4`). The
`DASH_<res>.mp4` / `CMAF_<res>.mp4` files are single-track video renditions — so a bare
`fallback_url` MP4 plays silent. This matches Media3's DASH requirement that "video, audio,
and text must be defined in distinct `AdaptationSet` elements"
([developer.android.com](https://developer.android.com/media/media3/exoplayer/supported-formats))
**[VERIFIED]**. Reddit also renamed renditions (`DASH_720.mp4` → `CMAF_720.mp4`, June 2026)
and old guessed filenames now 403 — recorded in this repo's test header after it broke the
extension. **Consequence: never build on `fallback_url` or filename guessing; use `hls_url`
(both platforms) or `dash_url` (Android).**

### Playback support by platform

- **iOS:** Apple's streaming technology is HLS — "Send live and on-demand audio and video to
  Apple devices… with HTTP Live Streaming (HLS) technology from Apple"
  ([developer.apple.com/streaming/](https://developer.apple.com/streaming/)) **[VERIFIED]**;
  that page and the AVFoundation docs mention no MPEG-DASH support anywhere (absence of
  DASH is an inference from Apple documenting only HLS, not an explicit Apple statement).
  Corroborating that AVPlayer can't take DASH: expo-video's iOS extension point exists
  precisely for "translating DASH into HLS" through a local proxy before handing the URL to
  `AVURLAsset`
  ([expo-video docs source](https://github.com/expo/expo/blob/main/docs/pages/versions/unversioned/sdk/video.mdx))
  **[VERIFIED]**.
- **Android:** ExoPlayer/Media3 supports DASH, HLS, and SmoothStreaming, with the container
  caveats quoted above
  ([developer.android.com](https://developer.android.com/media/media3/exoplayer/supported-formats))
  **[VERIFIED]**. Reddit's demuxed CMAF DASH fits Media3's requirements.
- **Framework implications:**
  - react-native-video: "HLS/DASH streaming" supported ([README](https://github.com/TheWidlarzGroup/react-native-video))
    **[VERIFIED]** — but DASH is an *Android* ExoPlayer extension
    (`RNVideo_useExoplayerDash=true` in `android/gradle.properties`,
    [docs source](https://github.com/TheWidlarzGroup/react-native-video/blob/master/docs/docs/fundamentals/configuration/without-expo.md))
    **[VERIFIED]**; iOS side is AVPlayer (architecture shown in their analytics docs), so
    iOS gets HLS only.
  - expo-video: cross-platform, Android built on Media3 (its known-issues link to
    `androidx/media`), iOS on AVKit/AVPlayer; iOS cache "cannot be used with HLS video
    sources on iOS" ([docs source](https://github.com/expo/expo/blob/main/docs/pages/versions/unversioned/sdk/video.mdx))
    **[VERIFIED]**. Practical rule: give expo-video `hls_url` on both platforms.
  - Flutter `video_player`: "On iOS and macOS, the backing player is AVPlayer… On Android,
    the backing player is ExoPlayer"
    ([README](https://github.com/flutter/packages/blob/main/packages/video_player/video_player/README.md))
    **[VERIFIED]** — same HLS-everywhere / DASH-Android-only picture;
    [media_kit](https://github.com/media-kit/media-kit) (libmpv-based player for Flutter)
    **[VERIFIED it is libmpv-based]** plays both but adds a heavyweight native dependency.
  - WebView `<video>` (Capacitor/PWA): iOS WKWebView plays HLS in `<video>` (Safari's
    native support, per Apple's HLS positioning above), but inline playback needs
    `allowsInlineMediaPlayback` — default is **false on iPhone** and the element needs the
    `playsinline` attribute
    ([developer.apple.com](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/allowsinlinemediaplayback))
    **[VERIFIED]**. Android WebView HLS/DASH behavior was not verified — treat as the
    weakest option for v.redd.it.

### Other media types

- **Galleries**: media lives in post JSON (`gallery_data` order + `media_metadata` URLs), not
  the DOM — this repo already resolves and expands them (`content/overlay.js`,
  `galleryMediaUrls`/`expandGallery`) **[VERIFIED in-repo]**; Reddit's protos include a
  `GalleryMedia {url, width, height, status}` type **[VERIFIED]**. Animated gallery items
  come as `mp4`/`gif` renditions; prefer mp4, treat as silent looping gifs (repo logic).
- **i.redd.it** images are direct, stable CDN URLs; **preview.redd.it** URLs are signed and
  expire — repo comment: "preview.redd.it URLs are signed and expire, so a thumbnail picked
  up at the start of a long session can be dead" **[VERIFIED in-repo, live behavior not
  re-tested]**.
- **imgur `.gifv`** is an MP4 wrapper — rewrite `.gifv` → `.mp4` and play silent/looping
  (repo does exactly this) **[VERIFIED in-repo]**. Imgur/redgifs hotlinking and referer
  policies could not be checked (sites blocked) — **[UNVERIFIED]**; note the repo's redgifs
  resolver already needs a temporary-token API dance and a spoofed `Referer`, which is a
  terms-of-service smell worth re-checking before shipping redgifs support in a store app.

---

## 3. Framework options

| Option | Reuse of this repo | Vertical snap feed | v.redd.it video | Network/CORS | Packaging |
|---|---|---|---|---|---|
| PWA | High (all DOM code) | CSS scroll-snap | HLS iOS-Safari only, no DASH; autoplay limits | **Broken without a proxy** | No store needed; iOS install friction |
| Capacitor | High | CSS scroll-snap | WebView `<video>` (weakest) | CapacitorHttp native fetch | Real store binaries |
| React Native + Expo | Medium (pure JS ports) | pager-view / FlashList | expo-video (Media3/AVPlayer) | Native networking | EAS builds both stores |
| Flutter | Low (rewrite in Dart) | PageView vertical | video_player / media_kit | Native networking | Both stores |
| Fully native | None | VerticalPager / SwiftUI paging | Media3 / AVPlayer directly | Native | Per-platform |

- **PWA.** The critical blocker: browsers enforce CORS, and this extension only works
  because WebExtension host permissions grant "XMLHttpRequest and fetch access to those
  origins **without cross-origin restrictions**" (MDN, verified from the
  [mdn/content source](https://github.com/mdn/content/blob/main/files/en-us/mozilla/add-ons/webextensions/manifest.json/permissions/index.md))
  **[VERIFIED]** — a permission a web page cannot have. Whether reddit.com sends any
  `Access-Control-Allow-Origin` for web origins could not be tested live (proxy block)
  **[UNVERIFIED]**, but the safe design assumption is it does not (if it did, the extension
  would not need host permissions to fetch listings). A pure web app therefore needs a
  server-side proxy for every Reddit call — which turns "no backend" into "run a backend,"
  puts your proxy's IP in front of Reddit's rate limiting, and likely trips the Data API
  terms. Snap paging itself is fine: CSS scroll snap exists to provide "paging and scroll
  positioning" ([MDN guide source](https://github.com/mdn/content/blob/main/files/en-us/web/css/guides/scroll_snap/index.md))
  **[VERIFIED]**.
- **Capacitor.** `CapacitorHttp` "provides native http support via patching `fetch` and
  `XMLHttpRequest` to use native libraries" (opt-in via `CapacitorHttp: { enabled: true }`)
  ([docs source](https://github.com/ionic-team/capacitor-docs/blob/main/docs/apis/http.md))
  **[VERIFIED]** — that genuinely sidesteps CORS for Reddit calls. Paging via scroll-snap
  reuses the most UI code of any native-packaged option. The cost is video: everything runs
  through the WebView `<video>` pipeline (see WKWebView inline-playback caveat above), and
  TikTok-style preloading/instant-start is exactly where WebView video underperforms
  (qualitative judgment, not a cited benchmark).
- **React Native + Expo.** Vertical paging:
  [react-native-pager-view](https://github.com/callstack/react-native-pager-view) has an
  `orientation: vertical` prop **[VERIFIED]**; plain `ScrollView`/`FlatList`
  `pagingEnabled` is documented as "can be used for **horizontal** pagination"
  ([docs source](https://github.com/facebook/react-native-website/blob/main/docs/scrollview.md))
  **[VERIFIED]** — so use pager-view (or FlashList v2, a JS-only, new-architecture-only
  performant list — [README](https://github.com/Shopify/flash-list) **[VERIFIED]**) rather
  than relying on `pagingEnabled` for a vertical feed. Video via expo-video (§2). OAuth via
  [expo-auth-session](https://github.com/expo/expo/blob/main/docs/pages/versions/unversioned/sdk/auth-session.mdx)
  (browser-based OAuth + deep-link scheme redirect — the right shape for a no-secret
  installed app) **[VERIFIED]**. Builds/signing via
  [EAS Build](https://github.com/expo/expo/blob/main/docs/pages/build/introduction.mdx),
  "a hosted service for building app binaries," with internal distribution for
  personal installs **[VERIFIED]**. Networking is native (no browser origin model), so
  Reddit calls need no proxy — [inference from RN architecture; no explicit "no CORS"
  statement was located].
- **Flutter.** `PageView` is "a scrollable list that works page by page" with a
  `scrollDirection` axis parameter (vertical supported)
  ([framework source](https://github.com/flutter/flutter/blob/master/packages/flutter/lib/src/widgets/page_view.dart))
  **[VERIFIED]**; video per §2. Everything from this repo gets rewritten in Dart — worst
  reuse, fine platform.
- **Fully native.** Compose: "To create a pager that scrolls up and down, use
  `VerticalPager`," lazily composed, flings one page at a time
  ([developer.android.com](https://developer.android.com/develop/ui/compose/layouts/pager))
  **[VERIFIED]** + Media3 — the technically ideal Android app. SwiftUI:
  `VideoPlayer(player: AVPlayer)` (iOS 14+)
  ([developer.apple.com](https://developer.apple.com/documentation/avkit/videoplayer))
  **[VERIFIED]**. Two codebases, zero reuse.

---

## 4. App store policy risk

### Apple App Store ([guidelines](https://developer.apple.com/app-store/review/guidelines/), fetched live — all quotes **[VERIFIED]**)

- **1.1.4** bans "overtly sexual or pornographic material" — 'explicit descriptions or
  displays of sexual organs or activities intended to stimulate erotic rather than aesthetic
  or emotional feelings.'
- **1.2 (UGC)** requires: filtering of objectionable material, a reporting mechanism with
  timely responses, user blocking, and published contact info. Key sentence for a Reddit
  client: "If your app includes user-generated content from a web-based service, it may
  display incidental mature 'NSFW' content, provided that the content is **hidden by default
  and only displayed when the user turns it on via your website**." Apps "used primarily for
  pornographic content… do not belong on the App Store."
- **5.2.2**: "If your app uses, accesses, monetizes access to, or displays content from a
  third-party service, ensure that you are **specifically permitted** to do so under the
  service's terms of use. **Authorization must be provided upon request.**" This is the
  existential rule for an unofficial client: Apple can demand proof Reddit allows your app.
  Coexistence evidence: Apollo ran on the App Store 2015–2023 and died from API pricing,
  not 5.2.2 [historical, secondary —
  [techcrunch.com](https://techcrunch.com/2023/05/31/popular-reddit-app-apollo-may-go-out-of-business-over-reddits-new-unaffordable-api-pricing/)];
  Narwhal remains on the App Store as a subscription app whose developer says he has been
  "in communication with Reddit leadership"
  ([techcrunch.com](https://techcrunch.com/2023/10/11/third-party-reddit-app-narwhal-hopes-to-survive-reddits-app-purge-with-a-subscription-plan),
  App Store listing unreachable from here) **[UNVERIFIED]**; Infinity's README links an iOS
  App Store listing (id6759064642) for a community iOS port
  ([README](https://github.com/Docile-Alligator/Infinity-For-Reddit)) — README claim
  **[VERIFIED]**, store presence itself **[UNVERIFIED]** (apps.apple.com blocked). Comet
  was not verified at all. In practice 5.2.2 enforcement against Reddit clients has been
  driven by Reddit's complaints, not Apple's initiative — [inference from the above].
- **TestFlight** (for staying off the store): 100 internal testers, 10,000 external, builds
  expire after 90 days, and the *first* build for an external group goes through App Review
  ([App Store Connect help](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/))
  **[VERIFIED]**. Internal-only testing avoids review but caps at 100 App Store Connect
  users and still needs a $99/yr developer account. EU alternative distribution exists but
  the canonical Apple support page moved (fetch 404'd) — **[UNVERIFIED, not relied on]**.

### Google Play

Primary pages blocked (support.google.com) — all of this is **[UNVERIFIED]**, sourced from
search results pointing at the official articles:

- **UGC policy** ([answer 9876937](https://support.google.com/googleplay/android-developer/answer/9876937)):
  apps with public UGC must provide in-app reporting of users/content and user blocking,
  plus terms of use.
- **Moderation & incidental sexual content in UGC apps**
  ([answer 12923286](https://support.google.com/googleplay/android-developer/answer/12923286)):
  incidental sexual content is allowed only if "hidden by default behind filters that
  require at least two user actions to completely disable"; sexually explicit content is
  disallowed below Mature ratings; apps that promote/recommend sexual content don't qualify
  as "incidental."
- Net effect (both stores): the extension's mask-on-by-default gate is not just portable but
  *required*, and a store build likely ships with NSFW fully disabled, not merely masked.

### Routes that dodge store review

- **Android sideloading**: distribute the signed APK from GitHub Releases — no policy
  gate at all; Infinity ships Patreon APK builds exactly this way
  ([README](https://github.com/Docile-Alligator/Infinity-For-Reddit)) **[VERIFIED]**.
- **F-Droid**: requires the app be FLOSS ("All applications in the repository must be Free,
  Libre and Open Source Software") built from source by F-Droid's 100% FLOSS toolchain, with
  proprietary tracking/ads libraries "strictly forbidden" — verified from the policy's
  GitLab source ([Inclusion Policy](https://gitlab.com/fdroid/fdroid-website/-/raw/master/_docs/Inclusion_Policy.md),
  rendered at f-droid.org) **[VERIFIED]**. A FLOSS client would qualify technically; note
  the bundled-API-key problem (a key in a public repo violates the spirit of per-client
  registration — Infinity ships `CLIENT_ID = ""` in source for this reason **[VERIFIED]**).
- **Personal install only**: Android `adb install` / self-signed APK, iOS free-account
  Xcode sideload (7-day re-sign) or paid-account ad-hoc — no review, no distribution.
  [Common knowledge; iOS re-sign window not verified against an Apple page.]

### What surviving third-party apps demonstrate

- **Narwhal (iOS)**: survived by charging a subscription to cover per-call API fees
  [UNVERIFIED, TechCrunch above].
- **Infinity (Android)**: repo is AGPL-3.0, ships with the Reddit client id **stripped**
  (`CLIENT_ID = ""`), while the developer's Play/Patreon builds carry his key — i.e.
  self-builders register their own installed app **[VERIFIED from source]**.
- **Apollo Reborn** (jailbreak tweak): patches the dead Apollo app to use *user-supplied*
  API keys ([github.com/Apollo-Reborn/Apollo-Reborn](https://github.com/Apollo-Reborn/Apollo-Reborn))
  **[VERIFIED the project exists and states this]**.
- "Now for Reddit" was named in the research brief as a user-supplied-key example, but no
  primary or reliable secondary source was found — **[UNVERIFIED, dropped]**.
- Pattern: Reddit tolerates (a) per-user/self-registered keys at personal scale and
  (b) negotiated paid arrangements. It does not tolerate one free bundled key at scale.

---

## 5. What's reusable from this repo

Read against the actual code. Big caveat first: **the extension is a DOM scraper, not an API
client.** `content/overlay.js` scrapes `<shreddit-post>` elements (old-Reddit `.thing`
fallback), then enriches via same-origin JSON (`{permalink}.json`, `/api/info.json`) riding
the user's cookies; votes/saves go through the legacy modhash endpoints (`/api/vote`,
`/api/save` with `X-Modhash` from `/api/me.json`). None of that transplants: a mobile app
starts from `oauth.reddit.com` listings and the OAuth `/api/vote` / `/api/save` scopes. What
ports is the *domain logic downstream of fetching*.

### Ports directly (pure JS, no extension APIs)

- `content/overlay.js` — `classifyUrl()` (URL → image/video/embed, `.gifv`→`.mp4`,
  v.redd.it detection), `EMBED_HOSTS` table, `galleryMediaUrls()` (gallery_data +
  media_metadata → ordered `{url, animated}` list, mp4-over-gif preference),
  `expandGallery()` (one post per image, `(i/N)` titles, gallery-items-are-silent-gifs
  assertion), `withJsonFlags()` (nsfw/spoiler OR-merge).
- `slideshow/settings.js` — the whole `SlideshowSettings` module minus the `storage`-event
  bridge: defaults, numeric clamping, coercion ("maskNsfw stays on" on parse failure),
  listener plumbing. Swap `localStorage` for AsyncStorage/MMKV behind the same API.
- `slideshow/slideshow.js` — `formatScore()` (don't invent precision over Reddit's fuzzed
  scores), `formatAge()`, the optimistic vote/save state machine (`localState` map +
  `mergeLocalState` + rollback on failure — including the hard-won rule that a background
  refresh must never clobber an optimistic local action), auto-advance queue logic
  (`awaitingMore`/`resumeIfWaiting`/exhausted-stop-without-rerender).
- `background/background.js` — resolve-in-place pattern (`resolvePostsInPlace`: never make
  the batch hostage to the slowest fetch; publish per-post as resolutions land) and the
  debounced broadcast. The redgifs resolver logic is portable JS too (terms caveat in §2).

### Ports with rework (sound logic, DOM-coupled expression)

- `slideshow/renderers/*` — each renderer's *contract and edge-case knowledge* transfers;
  the `<img>`/`<video>`/`<iframe>` manipulation does not. Worth carrying over explicitly:
  retry-once-then-fail (`video.js` `handleMediaError`), retry budget + manual-retry reset
  (`image.js`), gif dwell = `max(imageDwell, one full loop)` (`armGifAdvance`), embed
  fallback when a direct file won't play, blind-timer advance for embeds, error grace
  advance (2s) so auto-advance never wedges on a broken file. In RN these become props/
  effects on a `PostView` component; the *cleanup contract* (below) maps to `useEffect`
  teardown.
- `renderGate()` (slideshow.js) — the gate card UI is DOM, the gating decision logic
  (`gateReason`/`isGated`/`revealed` set/`GATE_DWELL_MS` timed skip) ports as-is.
- `resolveVredditUrl()` (video.js) — DASH-manifest parsing via `DOMParser`; on mobile
  you mostly don't need it (hand `hls_url` to the player), but if kept (e.g. picking a
  rendition for preloading) it needs an XML parser substitute.
- Popup preflight *concept* (scan before committing, approximate counts labeled
  approximate) → becomes a subreddit-picker screen backed by an API call instead of a tab
  scan.

### Must be rewritten (extension-platform-specific)

- All `browser.*` messaging (background ⇄ content ⇄ slideshow three-process architecture
  collapses into one app process — most of `background.js` and the message plumbing simply
  disappears).
- DOM scraping (`scrapePosts`, `scrollAndScrape`, `classifyPost` attribute reads) → OAuth
  listing calls with `after` cursors.
- Cookie/modhash actions (`redditAction`, `getModhash`) → OAuth Bearer + `vote`/`save`
  scopes.
- Host-permission CORS bypass (manifest `permissions` on `*.reddit.com`, `*.redd.it`,
  imgur/redgifs/youtube/gfycat/streamable — [manifest.json](../../../manifest.json)) →
  native networking (free in RN/Flutter/native; CapacitorHttp in Capacitor; impossible in
  a PWA without a proxy).
- `localStorage`-on-extension-origin + `storage` event sync, overlay iframe/`inert`
  focus management, pop-out windows, DOM Fullscreen API, keyboard shortcuts (→ gestures).

### Domain logic worth preserving *exactly*

1. **The adult/spoiler gate**: gate by **withholding `mediaUrl`**, never by blur — "a blur
   means the file has already been downloaded and decoded" (CLAUDE.md + `renderGate`
   comment). `nsfw`/`spoiler` are OR'd from two sources and **only ever added, never
   cleared** — because the secondary source "swallows its own failures, so trusting it
   alone would fail open exactly when it matters." On mobile the two sources become the
   listing item and the detail fetch; same rule. Also: **never preload a gated post**
   (`preloadNext` skips them) — directly reusable in a feed that prefetches next pages.
2. **The renderer cleanup contract** (`test/test-auto-advance.js`): "The invariant, for
   every renderer: **after cleanup() nothing advances, ever.**" Every timer, retry,
   listener, and error path a slide schedules must die with the slide — the test file
   documents exactly how teardown-triggered `error` events used to resurrect timers. In a
   swipe feed this is *more* important, not less (fast swipes churn mounts); it translates
   to: every player/timer lives in the page's effect scope and is cancelled on unmount,
   and the auto-advance callback checks a `cancelled` flag.
3. **Auto-advance rules**: videos advance on `ended`; gifs never on `ended` (dwell =
   `max(setting, one loop)`); images on a dwell timed **from load, not from render**;
   unplayable media still advances after a short grace; at the queue boundary hold in a
   visible "waiting" state, retry the refill, resume automatically; at true exhaustion stop
   **without re-rendering** (re-render restarts the current video). Vote/save stay
   optimistic-with-rollback.
4. **Gallery siblings are one Reddit post.** `expandGallery` gives every image its own feed
   entry (`id` = `${id}-2`, `-3`…) but they all keep the same `redditId`, and
   `setPostState` updates *every* sibling on a vote/save — "they are updated together or
   the buttons would disagree." A mobile feed that expands galleries the same way must keep
   this keyed-by-`redditId` update rule.

### The TikTok delta (not a port — an architectural change)

The controller renders **exactly one live slide**: `renderCurrentPost()` tears the previous
renderer down before mounting the next, and the whole cleanup contract is built on that. A
TikTok-style pager inverts this: ~3 pages stay mounted (previous/current/next) so the swipe
transition has real content on both sides, and *page-activeness* — not mount/unmount —
decides what plays. The repo's rules translate rather than transplant: "after cleanup nothing
advances" becomes "an inactive page is paused, muted, and schedules nothing"; `preloadNext`'s
never-preload-a-gated-post rule now governs which mounted neighbors get their `mediaUrl` at
all; and auto-advance becomes "on ended, animate to the next page" layered over swipe as the
primary gesture. Budget for this as new code that *enforces* the old invariants, not as a
port of `renderCurrentPost`.

---

## Recommended path

**React Native + Expo, Android-first, personal build first.** Justification: (a) largest
direct reuse of this repo's pure-JS domain logic in the same language; (b) real native
players — `hls_url` into expo-video gives both platforms video *with audio*, fixing the
extension's silent-v.redd.it limitation, with `dash_url` as an Android option; (c) native
networking removes the CORS problem the PWA can't solve and Capacitor solves only for
fetches, not for its WebView video pipeline; (d) EAS internal distribution + Android
sideloading give a working personal app with zero store or (foreseeable) Reddit-scale risk
while the open questions resolve. Fully-native Compose is the runner-up if iOS is dropped
permanently.

### Phased plan

1. **Proof of concept (no login).** Verify from a normal network first: current state of
   `reddit.com/prefs/apps` + Responsible Builder approval; then register an **installed
   app**. Expo app: userless `installed_client` token → one subreddit listing →
   pager-view vertical feed → expo-video on `hls_url`, image posts with dwell timer.
   Port `classifyUrl`, gallery expansion, and the gate verbatim (gate ON, no reveal UI yet
   — mediaUrl withheld). Success = smooth swipe through r/videos with audio.
2. **Personal build.** OAuth login (expo-auth-session code flow, empty secret,
   `duration=permanent`), vote/save with the optimistic-rollback port, settings module on
   AsyncStorage, auto-advance with the full rule set, `after`-cursor infinite feed with the
   preemptive-fetch/awaiting-more logic, User-Agent per Reddit's format. Distribute via EAS
   internal / signed APK on GitHub. Stay non-commercial, one user ≈ well under 100 QPM.
3. **Store release (optional, decision gate).** Only if: Reddit approval for a distributed
   client is confirmed in writing (5.2.2 authorization evidence), a per-user-key or
   subscription answer to the shared-100-QPM problem is chosen, NSFW is fully off (not
   masked) in the store build, and UGC requirements (report/block/contact, and Apple's
   website-side NSFW toggle if any mature content remains) are implemented. Android/Play
   first; App Store last. F-Droid is available if the app stays FLOSS and each user builds
   with or supplies their own key.

## Decision addendum (2026-08-23, build session)

The build that followed this research chose **Capacitor (web core + native shell), not React
Native + Expo**, deviating from the recommendation above. Reasons, in order:

1. **Verifiable-by-screenshot in the build environment.** The build ran in a container with
   no Android/iOS toolchain and all Reddit domains blocked at the egress proxy. A Capacitor
   app's UI is a web page: what Playwright's Chromium renders during development is the same
   engine the shipped WebView runs, so every screenshot/video produced along the way shows
   the production UI. An Expo app could only have been previewed via react-native-web, whose
   pager and video components differ from the native ones — the screenshots would show a
   simulation of the app rather than the app.
2. **Reuse.** §3 rates Capacitor's reuse of this repo highest: the renderers' DOM code,
   `settings.js`, and the gate port nearly verbatim instead of being re-expressed as React
   components.
3. **Demo-first was forced anyway.** With Reddit unreachable from the build environment and
   the Responsible Builder question open, the app had to be built against a swappable data
   source (bundled demo fixtures in the Reddit listing wire shape, real listing fetch behind
   the same interface). That architecture is framework-neutral, so the framework choice
   stops being load-bearing.
4. **The RN migration stays open.** The WebView-video-performance concern in §3 is real but
   unbenchmarked; if it disappoints on device, the domain core (`mobile/www/js/core`,
   `data`) ports to RN unchanged and only the pager/renderer layer is rewritten — which is
   the layer RN was going to rewrite anyway.


## Live content: what actually reaches Reddit (measured 2026-08-23)

Open questions 3 and 4 below were tested from the developer's own residential
connection (Windows, home ISP) — the network a self-hosted install would
actually run on. **[VERIFIED by direct measurement]**, and the answer is worse
than the terms alone suggested: Reddit's public read endpoints are closed to
scripted clients entirely, so no proxy design fixes it.

| Request | Result |
|---|---|
| `curl https://www.reddit.com/r/EarthPorn.json` (honest UA per Reddit's format) | **403**, ~190 KB HTML challenge page, not JSON |
| same, browser Chrome UA | **403**, same challenge |
| same, no UA | **403**, same challenge |
| Node `fetch` (what `tools/serve.mjs` uses) | **403**, same challenge |
| `https://old.reddit.com/r/EarthPorn.json` | **302** to `/login/?reason=lor2` (logged-out restriction) |
| `https://oauth.reddit.com/r/EarthPorn.json` (no token) | **403** (expected — needs a Bearer token) |
| `https://www.reddit.com/r/EarthPorn/` (HTML page) | **200**, but an 8 KB JavaScript bot-check shell — **0** `shreddit-post` elements |
| Automated Chromium (Playwright, JS enabled, mobile viewport) | **200**, served the same ~190 KB challenge; `document.title` empty, **0** posts |
| `https://i.redd.it/<file>` | **403** |

Consequences:

1. **The `.json` listing path is dead for any standalone client** — packaged
   app, self-hosted proxy, or PWA. §1's "plan around OAuth from day one" was
   right, and understated: the free unauthenticated tier is not merely
   throttled, it is walled.
2. **HTML scraping does not rescue it either.** The subreddit page served to a
   scripted client carries no posts, so the extension's scraping logic cannot
   simply be pointed at a server-side fetch.
3. **Why the extension still works**: it executes inside the user's own
   human-driven, logged-in Firefox, which has already cleared the bot check and
   carries session cookies. Neither is available to a proxy or a headless
   fetch. This is the sharpest version of §5's warning that the fetching layer
   does not transplant — it does not transplant *at all*.
4. **The two remaining paths to live content**, both real work:
   - **OAuth installed-app** against `oauth.reddit.com` with a Bearer token —
     Reddit's sanctioned route, and a different endpoint from the walled public
     ones. Gated on registration (open question 1).
   - **In-app WebView the user signs into**, with the feed read from the DOM —
     the extension's model ported to mobile. No registration, matches the
     project's existing "scrape the page, no API calls" stance, and keeps
     working exactly as long as the user's own session does.

Nothing else in this document changes; the demo-source architecture already
assumed the data source is swappable, which is what makes either path a
contained change (`mobile/www/js/data/`).

### Open questions

1. What exactly does the June 2026 Responsible Builder Policy require for a *personal*
   installed app — is `prefs/apps` self-service registration still live, or is every client
   id now application-gated? (Primary page was unreachable from this environment.)
2. Will Reddit grant written authorization (for Apple 5.2.2) to a small free client, and on
   what terms — per-user keys, subscription, or refusal?
3. ~~Do unauthenticated requests actually work today?~~ **Answered 2026-08-23
   (see "Live content" above): no — unauthenticated listing reads return an
   HTML bot-check page, from a residential IP, for every client tested.** What
   remains open is the OAuth rate behaviour once a token exists.
4. ~~Does reddit.com send `Access-Control-Allow-Origin` on `.json`?~~ **Moot:
   the endpoint never returns JSON to a scripted caller at all, so CORS is not
   the binding constraint — the bot wall is.**
5. Redgifs/imgur terms for a mobile client (the extension's resolver spoofs a Referer);
   drop, keep, or replace those sources?
6. iOS distribution for personal use: is TestFlight-internal (100 users, no review of
   subsequent builds) acceptable, or is the 7-day free-account re-sign tolerable?
