# Design exploration — polish & usability

Four visual directions for the extension, drawn as renderable HTML mockups and
critiqued against the real source. **Nothing here is implemented.**

## Contents

- `mockups/` — standalone HTML for each screen. Open directly in a browser.
  `*-baseline.html` render the *current* CSS with sample content, for comparison.
- `screens/` — rendered screenshots of each mockup.

## Recommendation: Cinema

Cinema is the only direction whose problems are removable rather than structural, and the only one costed at medium effort. Its critic list is dominated by three moves that can be deleted without touching the thesis: the ambient colour bleed (which has no source pixels for video or embed posts — CSS background-image cannot take a <video>, and embeds are cross-origin — so it silently degrades to black on the majority of content), the camera slate (redundant with the console's own counter, and on screen ~30% of the time at a 4s dwell), and the removal of the nav arrows (a hard dead end on embeds, where the cross-origin iframe swallows keydown and the arrows are today's only escape hatch). Delete those three and what remains — one labelled, scrimmed glass console plus a `?` overlay carrying keys, settings and a filmstrip — is a strictly better version of the current four-scattered-widgets composition, and it fixes chrome legibility, ARIA naming, focus and shortcut discoverability in one component instead of four. The other three fail at the centre, not the edges. Native's permanent 400px rail IS the direction: it costs ~44% of image area on landscape (996x560 vs today's 1280x720), every mockup shows portrait to hide that, and its rail measures ~732-756px of fixed content against ~770px of real inner height in the actual 1200x800 pop-out — with `.rail{overflow:hidden}` it clips the auto-advance dock silently. Deck's thesis is numeric honesty and its headline numbers cannot exist: refill is `scrollAndScrape` polling the user's live DOM every 500ms, so nothing knows how many posts are coming until after the wait; its sort segmentation has no data source because the extension never calls a listing API; and the hero mockup's own numbers don't reconcile (18+25+12=55 against everyone else's 43). Ambient's central mechanic — freezing the lap rather than resetting it — needs the renderer contract replaced, which I confirmed returns a bare cleanup closure in all three renderers (image.js:72, video.js:243, embed.js:70) while startAutoAdvance/stopAutoAdvance both call renderCurrentPost(); and its premise of unattended hours-long playback is contradicted by an architecture that refills by scrolling the user's real browsing tab and growing its DOM permanently. The decisive observation, though, is that the layout choice is the least important decision here. Every high-severity audit item — NSFW gating, zero focus rules, zero ARIA, auto-advance dying at the boundary, the popup double-bind, discarded error strings, dropped text posts — is direction-agnostic, and the single highest-value change in the deck (harvesting the /api/info.json response attachUserState already makes and throws away) unblocks features in all four. Pick the cheapest chrome that fixes legibility, then spend the budget on the list below.

## Ranking

### 1. Cinema (`cinema`)

**Best for.** The actual product — a media-first browse accelerator running over your own Reddit tab — at the lowest cost, and the only option that leaves budget for the direction-agnostic fixes.

Recommended, with three deletions. Drop the ambient bleed (no pixel source for video/embed; a 90px full-viewport blur over a decoding element inside an iframe layered on a live Reddit page). Drop the camera slate (duplicates the console counter 700px away; not transient at a 4s dwell). Keep prev/next as two chevrons inside the console — deleting them strands the user on every embed post, where the iframe eats keydown. Critically, do not reserve 176px permanently for chrome that is hidden most of the time: that is the direction's one genuine self-contradiction, and it dissolves the moment the console sits on its own scrim, which is what a scrim is for. Then pull Deck's settings drawer and Native's open-ended queue bar into the `?` overlay.

### 2. Reddit Native (`native`)

**Best for.** A user who wants comments, flair, age and score alongside the image — a reading-and-context product rather than a lightbox. Also the right pick if you want the idle fade gone permanently rather than repaired.

Second, and the safest choice if context matters more to you than image size. Its thesis kills the entire idle-fade bug class by construction — no fade, no unrecoverable-over-iframe state, no pointer-events:none click-through — which is four audit items deleted rather than patched. But it is large, it never shows the landscape case it penalises, and it does not hold its own thesis: the prev/next arrows are position:absolute inside the stage at rgba(10,14,16,.55) with a backdrop blur, i.e. chrome over media, readable only because the mockup chose a 481px-wide portrait. It also ships a worse disabled Save than the code it replaces (opacity:.55, no disabled attribute, no aria-disabled, still focusable, announced as enabled — today's slideshow.js sets saveBtn.disabled properly). Needs responsive breakpoints and a scrollable rail before it can survive the real 1200x800 pop-out.

### 3. Ambient (`ambient`)

**Best for.** A wall display or lean-back second monitor. Harvest its typography and control labelling wholesale into whatever you build; treat the sweep as a later phase behind the renderer rewrite.

Third by buildability, first by idea density. Highest usability score in the set and the most stealable details: page-level scrims under the chrome, a two-line wrapped title, worded buttons with key chips, an accent focus ring deliberately different from the active-state colour. But the signature mechanic is blocked on a renderer-contract rewrite, and Space today literally destroys the media element (a video restarts at 0:00). Two deeper mismatches: the perimeter lap cannot be drawn honestly for embeds (a blind 15s timer racing a postMessage 'ended'), and the badge asserting 'sound on' is false forever on an unattended display, since Firefox blocks audible autoplay until a gesture nobody will make. Its own popup also puts every piece of new first-run guidance below AA contrast and makes none of its controls focusable — in the direction whose loudest claim is that no focus rule exists.

### 4. Deck (`deck`)

**Best for.** Harvesting. Take the settings drawer as the `?` overlay's settings tab, the failure card, the keycaps printed on buttons, and the explicit end-of-queue state. Leave the four fixed rails behind.

Fourth. Do not build it; do mine it. Feasibility 2/5 is earned: the buffer telemetry ('buffering 12', '+12 arriving') invents a count the architecture cannot produce, sort segmentation has no data source, and the numbers contradict each other inside a single screenshot — fatal for a direction premised on every number meaning what it says. It spends 264px of permanent chrome, which on a 1366x768 laptop collapses the stage to ~336px. It regresses the contrast bug it cites as a defect (--dim2 #6C7A87 on #12161B is 4.22:1, worse than the 4.42:1 it replaces, at 9-10.5px instead of 12px), and its .switch/.chkbx controls are spans — unfocusable, unannounced. But the settings drawer is the best single screen in the whole deck, and the failure card carrying the real error string is the highest-value idea any critic surfaced.

## Worth doing whichever direction wins

- **[S]** Harvest the /api/info.json response that attachUserState already fetches and discards. It keeps only `saved` and `likes` from a cookie-scoped batch of up to 100 ids; the same response carries over_18, spoiler, selftext, num_comments, created_utc, link_flair_text, thumbnail and preview.images[].resolutions. Add them to the state.set() map. Zero new requests, zero new permissions — this one change unblocks NSFW gating, text posts, filmstrip thumbnails, comment counts, flair and post age for every direction.
  - Files: `content/overlay.js (attachUserState, ~L434-462)`

- **[M]** Ship the NSFW/spoiler gate, and gate it by withholding the media URL rather than by CSS blur — filter:blur() still downloads and decodes the full adult image, which is a cosmetic screen, not a gate. Read over_18/spoiler from info.json AND read the nsfw/spoiler attributes off shreddit-post during scrape, because the info.json catch block swallows failures silently and continues with an empty state map — meaning adult media would paint full screen exactly when the fetch broke. Fail closed. This is an AMO shippability item, not a nicety: the manifest requests redgifs host permission and background.js carries a dedicated redgifs resolver.
  - Files: `content/overlay.js (classifyPost/scrapePosts, attachUserState); slideshow/slideshow.js; slideshow/renderers/image.js, video.js, embed.js; slideshow/slideshow.css`

- **[S]** Fix the popup double-bind. startSlideshow is attached with addEventListener at popup.js:79 and never removed, while the Stop handler is assigned to .onclick at L65 — so clicking 'Stop Slideshow' runs startSlideshow (new session + window.close()) AND the stop handler. After one stop-then-start cycle Start fires twice and the background rebuilds `session` twice. Collapse to a single handler with a mode flag, and make checkActiveSession re-enable the button so an active session opened from a non-Reddit tab is not a disabled Stop button.
  - Files: `popup/popup.js`

- **[S]** Guard the global keydown handler BEFORE adding any focusable control. The bare switch(e.key) has no modifier, target or repeat check: Ctrl+S saves to Reddit and opens the browser Save dialog; Space on a focused button fires native activation plus toggleAutoAdvance for a net no-op that reads as a dead key; holding an arrow tears down and rebuilds a media element per repeat. Bail on ctrlKey/metaKey/altKey, bail on e.target.closest('button, input, [role]') for Space and arrows, guard e.repeat. This is a prerequisite for the focus ring, not a follow-up — every direction adds controls that collide here.
  - Files: `slideshow/slideshow.js (~L437)`

- **[M]** Add :focus-visible rings and real ARIA. Verified zero :focus rules in 239 lines of slideshow.css and zero aria-/role attributes in slideshow.html or popup.html; Firefox's default ring over rgba(255,255,255,.1) on black is invisible. Use a 2px light outline with a dark halo at 2px offset, in a colour that is never the active/selected colour — over arbitrary media you otherwise cannot distinguish focus from selection. Give every control a text label so state lives in the accessible name ('Save' -> 'Saved') plus aria-pressed, not only a CSS class. Add aria-live to the title/counter region so slide changes are announced.
  - Files: `slideshow/slideshow.html; slideshow/slideshow.css; slideshow/slideshow.js (updateActionButtons); popup/popup.html; popup/popup.css`

- **[S]** Stop expressing position as a percentage of a growing denominator. updateProgress divides by posts.length, which grows on every refill, so the bar genuinely jumps backwards (18/20 -> 19/43). Delete #progress-bar-fill and render `14 / 43+` with the `+` present whenever !exhausted. The `+` alone fixes the reported bug in one expression; a filmstrip or tick rail is an optional upgrade on top, not the fix.
  - Files: `slideshow/slideshow.js (updateProgress, ~L299); slideshow/slideshow.css`

- **[S]** Fix auto-advance dying at the queue boundary. autoAdvanceNext does nothing at all when on the last post with !exhausted — it neither advances, stops, nor retries — while the button still reads '⏱ Auto'. Re-arm from the refill callback in checkPreemptiveFetch, show a visible 'waiting on more posts' state, and stop calling renderCurrentPost() from stopAutoAdvance, which currently announces the end of the queue by replaying the final video from scratch.
  - Files: `slideshow/slideshow.js (autoAdvanceNext ~L365, checkPreemptiveFetch ~L310, startAutoAdvance/stopAutoAdvance ~L375-387)`

- **[S]** Route the real error string into visible UI. flagActionFailed already receives 'Not signed in to Reddit' / 'Reddit returned 403' / 'The Reddit tab is gone — reopen the slideshow' and throws it at console.warn, then flashes a 1px red border for 1500ms that the 2s idle fade may already have set to opacity 0. Render a persistent dismissible card with an action. Also detect signed-out state up front — getModhash() already hits /api/me.json and discards data.data.name — so vote/save can be explained before it fails rather than after.
  - Files: `slideshow/slideshow.js (flagActionFailed, vote, toggleSave); content/overlay.js (getModhash, attachUserState)`

- **[M]** Make the vote move the score, and fix the race that will eat it. vote() does an optimistic `likes` update with rollback but never touches `score`, so the number sits frozen while the arrow lights up. Add the delta to the same setPostState call — and do it together with applyPosts, which replaces the whole posts array with the background's copy, so a redgifs resolution broadcast landing mid-vote silently reverts the optimistic state and nothing re-renders to correct it. Keep the existing 4.3k formatting: the score is Reddit's fuzzed display value, so '4,312 +1' asserts precision that does not exist.
  - Files: `slideshow/slideshow.js (vote, setPostState, applyPosts)`

- **[S]** Render the permalink. It is scraped on both the new-Reddit (overlay.js:191) and old-Reddit paths, carried through the entire pipeline, and used by nothing — there is currently no route back to the post or its comments at all. One 'Open post (O)' control plus browser.tabs.create.
  - Files: `slideshow/slideshow.html; slideshow/slideshow.js; background/background.js`

- **[S]** Give the title a scrim and let it wrap. #post-title is white-space:nowrap with ellipsis and no title attribute, and #post-info sits on bare media with no gradient — so over a bright r/pics frame the title and the whole control bar vanish. Add a 2-line clamp on a bottom gradient plus a title attribute, and drop user-select:none on the title so it can be copied. Make the scrim a page-level layer beneath the chrome, not a child of the media element, or it will not cover chrome that extends past a portrait frame.
  - Files: `slideshow/slideshow.css (#post-title L165-173, #post-info, #top-bar); slideshow/slideshow.js`

- **[S]** Contrast and numeric pass. #post-meta is #777 on #0a0a0a — 4.42:1 at 12px, below AA — and the same #777 carries all six error/empty states, which are the only content on screen when they appear. Lift to roughly #9a9a9a. The disabled nav arrow at opacity 0.2 resolves to about 1.5:1. Add font-variant-numeric: tabular-nums at the root so counters and scores stop jittering, and add the missing @media (prefers-reduced-motion: reduce) block.
  - Files: `slideshow/slideshow.css`

- **[S]** Repair or delete the idle fade — but never leave pointer-events:none on it. Today the 2s timer fires before the first post renders; only mousemove and keydown reset it; a cross-origin embed iframe swallows mousemove so controls cannot be recovered by pointer at all; and the invisible bar is click-through into the embedded player. Minimum fix: reset on pointerdown/click/wheel/touch/focus and the iframe's load, use a ~6s first-run timeout, exclude the title from the fade, and drop pointer-events:none. Native and Deck delete the mechanism outright, which is a net deletion killing four audit items.
  - Files: `slideshow/slideshow.js (resetIdleTimer, IDLE_TIMEOUT ~L392); slideshow/slideshow.css (body.idle rules)`

- **[M]** Popup preflight. Add a cheap scanOnly message running scrapePosts() only (pure synchronous DOM read, no fetches) returning {count, skipped.length, subreddit, sort parsed from the tab URL}. The background already returns postCount and the popup discards it, so a zero-post scrape reports success, closes the popup, and drops the user onto a black fullscreen — the worst bug in the current UX. Label the number as approximate: resolvePendingPosts later expands one gallery into N posts and drops unresolvable crossposts. Also delete the ~28 dead lines of popup.css styling label/input/select (L28-53) for elements popup.html no longer contains, and the .error negative margin left behind by them.
  - Files: `content/overlay.js (new scanOnly handler); background/background.js; popup/popup.js; popup/popup.css (L28-53, L88)`

- **[M]** Make auto-advance dwell configurable, persisted in localStorage rather than browser.storage. IMAGE_DURATION_MS (5s) and the embed timer (15s, while the code comment claims 30s) are hardcoded closures surfaced only as '⏱ Off'/'⏱ Auto'. The manifest has no `storage` permission and adding one is a permission change on a listed AMO add-on — but the popup and slideshow share the moz-extension://<id> origin, and video.js:37 already persists the audio preference exactly this way. Also state 'videos play to the end' in words, since that behaviour currently looks arbitrary.
  - Files: `slideshow/renderers/image.js (IMAGE_DURATION_MS ~L29); slideshow/renderers/embed.js (~L28); slideshow/slideshow.js; popup/popup.js; popup/popup.html`

- **[M]** Focus the slideshow iframe on load and stop the parent page stealing Escape. Nothing focuses the injected overlay, so keyboard navigation is dead until the user clicks inside, and the first arrow or Escape goes to the Reddit page behind — where overlay.js:573 has its own Escape listener that closes the session outright with no confirmation. Call window.focus() on load, gate the parent listener on iframe focus (or remove it and let the iframe own Escape), and aria-hide/inert the underlying page so Tab does not walk out of the slideshow.
  - Files: `slideshow/slideshow.js; content/overlay.js (~L573, createOverlay)`

- **[L]** Make text/self posts a real type. classifyPost returns null for them, there is no `text` key in the renderers map, and no selftext is scraped — so a text-heavy subreddit yields a black 'No posts found' screen, directly contradicting CLAUDE.md's promise of 'images, videos, text posts'. selftext arrives free in the info.json harvest. Build the body with a ~80-line markdown-subset parser creating DOM nodes directly (paragraphs, blockquote, lists, strong/em); never innerHTML selftext_html into an extension-origin page holding reddit.com host permissions. Give it a short dwell with the full post one keypress away, not a reading-length-sized dwell.
  - Files: `content/overlay.js (classifyPost); slideshow/slideshow.js (renderers map); new slideshow/renderers/text.js; slideshow/slideshow.css`


## Suggested order

1. Land the pure bug fixes first, before any redesign, because three of them will otherwise be re-introduced by the new UI: the popup double-bind (popup/popup.js), the keydown guard for modifiers/target/repeat (slideshow.js:437), the auto-advance boundary death (autoAdvanceNext), and the applyPosts vote race. None touch layout, all are S, all four are live shipping bugs.

2. Harvest the info.json fields in attachUserState. One change, no new requests, no new permissions — and it is the hard dependency for NSFW gating, text posts, filmstrip thumbnails, comment counts and flair. Do it before choosing chrome, because it determines what any chrome can actually display.

3. Ship the NSFW/spoiler gate on top of it, withholding the media URL rather than blurring a fully-downloaded image, with the shreddit-post attribute read as the fail-closed fallback for when the info.json fetch dies. Treat this as the release gate: the extension currently strips a click-through Reddit itself enforces, while requesting redgifs host permission.

4. Do the accessibility floor as one pass: real <button> elements with text labels, aria-pressed, aria-live on the title/counter, and one :focus-visible rule in a colour that is never the active-state colour. Plus window.focus() on load and the parent-Escape gate. Only safe after step 1's keydown guard.

5. Do the legibility floor as one pass: title scrim as a page-level layer, 2-line clamp with a title attribute, #post-meta and the six error states off #777, tabular-nums, prefers-reduced-motion. Cheap, and it makes the next step's design decisions visible against real media.

6. Replace the progress bar with `14 / 43+`, add an explicit end-of-queue state, and repair the idle fade (reset on pointerdown/wheel/click/focus, ~6s first run, never pointer-events:none, title excluded). Everything through this point is direction-agnostic and worth cutting as a release on its own.

7. Now build Cinema's console: one scrimmed glass panel replacing the top bar, the two floating arrows, the bottom caption and the hairline bar — with prev/next chevrons kept inside it, no 176px stage reservation, and no ambient bleed. Add 'Open post (O)' here, since permalink is already in hand.

8. Build the `?` overlay as the second and last surface: key legend, playback settings (dwell interval persisted to localStorage, fit/fill, NSFW policy, sound), using Deck's settings-drawer layout. This retires tooltip-only shortcut discovery and the hardcoded dwell times together.

9. Add the filmstrip inside the `?` overlay only — never as permanent chrome — sourced from the info.json preview resolutions with an onerror fallback to a typed placeholder card. Drop the duration badges; no data source exists short of one JSON fetch per video post. Make tiles click-to-jump, or do not draw them.

10. Text posts last, as a distinct project: classifier branch, selftext from the harvest, a new renderers/text.js with a hand-rolled markdown-subset DOM builder, and its own dwell rule. Design the text frame against the real stage first — none of the four decks drew it convincingly.

11. Only after all of the above: consider the renderer contract rewrite (render() returning {destroy, pause, resume, duration, elapsed}) if you want Ambient's freeze-in-place pause, deadline-based dwell, or any honest continuous timer. It touches all three renderers plus the controller and buys nothing until the list above is done.


## Risks

- NSFW gating that depends only on info.json fails open. The existing catch block swallows fetch errors and continues with an empty state map, so a rate-limited or signed-out fetch means adult media paints instantly at full screen — precisely the case the gate exists for. The shreddit-post attribute read is not belt-and-braces, it is the actual guard, and the code must fail closed when both sources are silent.

- Thumbnails rot. preview.redd.it URLs are signed and expire, so a filmstrip opened deep into a long session shows broken frames. Prefer i.redd.it and the plain `thumbnail` field, and set onerror to swap in a typed placeholder card rather than leaving a broken-image glyph.

- Any filmstrip fights the current render model. The slideshow deliberately renders one post at a time, lazily; a strip needs decoded thumbnails for posts the user has not reached. Budget a bounded thumbnail cache, and expect gallery posts — which expand one-per-image — to make the strip longer than users predict.

- Adding focusable controls before guarding the keydown handler is an immediate regression, not a future one. Space on a focused button already fires both native activation and toggleAutoAdvance for a visible dead key, and arrows will navigate slides while a segmented control is focused. Order matters: guard first, ring second.

- Every mockup was drawn at 1440x900; the real pop-out is 1200x800 (background.js:289) and resizable smaller. Combined with html,body{overflow:hidden}, fixed-height chrome clips silently — the mockups literally could not have surfaced this. Whatever ships needs a measured worst-case pass in the actual pop-out, and the in-page overlay is 100vh of the browser viewport, which on a 1366x768 laptop is roughly 600px.

- Refill scrolls the user's real browsing tab. handleGetPosts -> loadMore -> scrollAndScrape sets body overflow to auto, scrolls the live page to the bottom, and re-querySelectorAlls the whole DOM every ~20 posts, growing that tab permanently. This rules out unattended long-running use without an architecture change, and it means the tab dying kills refill, vote and save at once — a failure state none of the four directions designed.

- Any exception from loadMore sets session.exhausted = true permanently, with no retry and no message. Building visible buffer telemetry on that plumbing produces confident, wrong UI: the state machine has to distinguish loading / retrying / genuinely exhausted before any indicator can be honest.

- Popup preflight counts will not match what starts. resolvePendingPosts expands one gallery into N posts and silently drops crossposts it cannot resolve, each behind an 8s-timeout fetch, and a Firefox popup is destroyed on any focus loss, so expensive work started there is discarded. Report an approximate number or none — a precise pre-flight figure the pipeline then contradicts recreates the exact dishonesty these redesigns set out to kill.

- Do not ship a sort control. Three of the four popups offer Hot/New/Top/Rising, and the extension never calls Reddit's listing API — it scrapes whatever page the user is on. Switching sort means navigating the user's own tab and destroying their scroll position, or moving to background listing fetches, which forfeits the same-origin cookie access that makes attachUserState, gated subreddits, and vote/save work at all.

- Use localStorage on the extension origin, not browser.storage. The manifest has no `storage` permission and adding one is a permission change on a listed AMO add-on; the popup and slideshow already share moz-extension://<id>, and video.js:37 uses exactly this trick for the audio preference.

- Optimistic score arithmetic on a fuzzed number. Reddit rounds and obfuscates the displayed score, so rendering '4,312 +1' asserts a precision the platform deliberately withholds. Show vote state emphatically and the delta quietly, and keep the existing k-formatting.

- Auto-advance interacts badly with two features being added at once: a gated NSFW frame will sit as a grey rectangle for the full dwell and then advance, forever; and a long text post will freeze the queue. Both need an explicit rule (pause on gate, short dwell on text) or the features actively waste the user's time.

- Native video controls are on (video.js:160) and are chrome over media that no direction reconciles with. Any bottom-anchored console lands directly above Firefox's own control bar, giving two stacked strips — and a countdown ring is meaningless for video, where advance is event-driven off 'ended', not timed.

- Effort creep is the largest risk to the recommendation itself. Cinema is 'medium' only if the bleed, the slate and the arrow removal are actually dropped. Reinstate any one and it converges on the same large budget as the other three — at which point Native's simpler no-fade-by-construction thesis becomes the better buy.


## Audit findings (high severity)

- **NSFW/spoiler handling** — There is no NSFW or spoiler handling of any kind. The scraper never reads the `nsfw` or `spoiler` attributes that `shreddit-post` exposes, so no such field ever reaches the slideshow — and the renderers therefore paint adult or spoiler-tagged media instantly, unblurred, at full screen. Reddit's own feed gates these behind a click-through; this extension removes that gate. The manifest explicitly requests host permission for redgifs (manifest.json:27) and the background carries a dedicated redgifs resolver (background.js:31-48), so an adult host is a first-class target of the product while having zero content gating.
  - Evidence: `content/overlay.js:183-200 (post object literal — no nsfw/spoiler/over_18 field scraped); manifest.json:27; background/background.js:31-48`

- **Popup — event binding** — The Stop-session path double-binds the button. `startSlideshow` is attached with addEventListener at line 79 and is never removed; the Stop handler is then assigned to `.onclick` at line 65. Both fire on a single click. So clicking 'Stop Slideshow' runs startSlideshow (creating a brand-new session and calling window.close()) AND the stop handler. After a stop-then-start cycle, line 70 re-adds startSlideshow while the line-79 listener is still attached, so Start now fires twice and the background rebuilds `session` twice.
  - Evidence: `popup/popup.js:65-71 vs popup/popup.js:79; background/background.js:156 rebuilds session on each startSlideshow`

- **End of queue / auto-advance** — Auto-advance dies silently at the queue boundary and never recovers. `autoAdvanceNext` does nothing at all when on the last post and `exhausted` is false — it neither advances nor stops nor retries, and nothing in `checkPreemptiveFetch` re-triggers it when new posts land. The button keeps reading '⏱ Auto' while the slideshow has permanently stopped advancing. When `exhausted` IS true it calls `stopAutoAdvance()`, which calls `renderCurrentPost()` — restarting the final post's media from scratch, so the end of the queue is announced by the last video replaying itself.
  - Evidence: `slideshow/slideshow.js:365-373 (autoAdvanceNext); slideshow/slideshow.js:382-387 (stopAutoAdvance re-renders); slideshow/slideshow.js:330-335 (refill never resumes advance)`

- **Accessibility — focus states** — There is not a single `:focus` or `:focus-visible` rule anywhere in either stylesheet. slideshow.css styles only `:hover` and `:disabled`; popup.css styles `input:focus`/`select:focus` for elements that no longer exist in popup.html and has no `button:focus` at all. Firefox's default focus ring over `rgba(255,255,255,0.1)` buttons on a black background is effectively invisible, so a keyboard user cannot tell which of the eight controls is focused.
  - Evidence: `slideshow/slideshow.css:69,124,136 (hover/disabled only, no focus rule in 239 lines); popup/popup.css:49-51 (targets non-existent input/select); popup/popup.html:8-18`

- **Accessibility — ARIA and screen readers** — The slideshow is entirely silent to assistive technology. No `role`, `aria-label`, `aria-pressed`, or `aria-live` appears in slideshow.html. Every control is a bare glyph — '▲','▼','☆','⏱ Off','↗','✕','‹','›' — announced as e.g. 'black up-pointing triangle button'. Toggle state is conveyed only by a CSS class plus a glyph swap, with no `aria-pressed`. The progress counter and the post title/meta change on every navigation with no live region, so a screen reader user gets no announcement that the slide changed.
  - Evidence: `slideshow/slideshow.html:12-19, :24-25, :31-34 (no ARIA attributes anywhere); slideshow/slideshow.js:221-226 (state via class + glyph only); slideshow/slideshow.js:300 (progress not a live region)`

- **Idle fade over embeds** — The idle timer resets only on `mousemove` and `keydown` on the slideshow document. A cross-origin embed iframe swallows all mouse events, so while any `embed`-type post is on screen the controls fade after 2s and CANNOT be brought back by moving the mouse — the user must press a key. Worse, `body.idle .controls` sets `pointer-events: none`, so the invisible top bar and arrows are click-through and the user's recovery click lands inside the embedded player instead.
  - Evidence: `slideshow/slideshow.js:409-410 (only mousemove/keydown); slideshow/slideshow.css:26-29 (opacity 0 + pointer-events none); slideshow/renderers/embed.js:11-15 (iframe fills container)`

- **Vote/save feedback** — The only failure feedback for a rejected vote or save is a 1px red border for 1500ms plus a console.warn. The actual, useful error string — 'Not signed in to Reddit', 'The Reddit tab is gone — reopen the slideshow' — is passed into `flagActionFailed` and then thrown away to the console. A signed-out user pressing S sees the star flick on, flick off, and a faint outline they will likely miss entirely; if the failure lands after the 2s idle timeout the button is at opacity 0 and there is no feedback whatsoever.
  - Evidence: `slideshow/slideshow.js:229-233 (message goes to console only); slideshow/slideshow.css:95-97 (border-color only); content/overlay.js:395 (the discarded message); slideshow/slideshow.css:26-29 (may be invisible)`

- **Text/self posts** — Text posts are silently dropped — `classifyPost` returns null for them, there is no `text` key in the renderer map, and no `selftext` field is ever scraped. This directly contradicts the project's own documentation, which states the extension displays 'images, videos, text posts' and lists 'text/self posts' as a media type to handle. Consequence: on a text-heavy subreddit every post is filtered out, the popup reports success and closes, and the user is left on a black screen reading 'No posts found'.
  - Evidence: `content/overlay.js:90-152 (returns null; no selftext scraped); slideshow/slideshow.js:36-40 (renderer map: image/video/embed only); CLAUDE.md:7 and CLAUDE.md:66; test/test-scraping.js:103 asserts the drop as correct`

- **Vote state race** — An optimistic vote can be silently reverted by an unrelated background broadcast. `applyPosts` replaces the entire `posts` array with the background's copy and then calls `updateActionButtons()`. If a redgifs resolution broadcast lands in the window between the optimistic local update and `relayToTab` writing the result into the session copy, the button reverts to the pre-vote state — and since the vote then succeeds, nothing ever re-renders to correct it. The `changed` guard only gates re-rendering, not the wholesale state overwrite.
  - Evidence: `slideshow/slideshow.js:100-122 (posts replaced, then updateActionButtons at :122); slideshow/slideshow.js:271 (optimistic set); background/background.js:264-274 (session write-back happens later)`

- **Keyboard — modifier and focus collisions** — The global keydown handler ignores modifiers and focus context. `case "s"` fires on Ctrl+S/Cmd+S, toggling the Reddit save AND opening the browser's Save Page dialog. Space is handled globally with preventDefault, so pressing Space while any button is focused fires both the native button activation and `toggleAutoAdvance()` — toggling twice for a net no-op, which reads to the user as a dead key. There is also no `e.repeat` guard, so holding the arrow key tears down and rebuilds a media element per repeat.
  - Evidence: `slideshow/slideshow.js:437-465 (no modifier/focus/repeat checks); :445-447 (Space); :457-459 (S)`

- **Overlay focus management** — When the overlay iframe is injected nothing focuses it, and the underlying Reddit page is never made inert or aria-hidden. Keyboard navigation therefore does not work until the user clicks inside the slideshow — the first Escape or arrow press goes to the Reddit page behind the overlay. Tabbing also walks straight out of the slideshow into the hidden page's links, with no focus trap.
  - Evidence: `content/overlay.js:515-531 (iframe appended, never focused; no inert/aria-hidden on host content)`
