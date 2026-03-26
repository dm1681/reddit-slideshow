# Reddit Slideshow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Firefox extension that displays Reddit posts as a fullscreen slideshow with dark cinematic UI, image rendering, and preemptive pagination.

**Architecture:** Hybrid content script + extension page. Content script injects a fullscreen overlay containing an iframe to the slideshow extension page. Background script handles Reddit API, state, and messaging. Popup launches the slideshow.

**Tech Stack:** Firefox Manifest V2 WebExtension, vanilla JavaScript, no build step. Manual testing via `about:debugging#/runtime/this-firefox`.

**Testing approach:** This is a browser extension — no automated test runner. Each task ends with a manual verification step: reload the extension in `about:debugging` and check specific behavior. The extension console is accessible from the `about:debugging` extension card ("Inspect" button).

---

## File Structure

```
reddit-slideshow/
├── manifest.json              # Manifest V2 — permissions, scripts, popup, icons
├── icons/
│   ├── icon-48.png            # Toolbar icon
│   └── icon-96.png            # Extension management icon
├── popup/
│   ├── popup.html             # Browser action popup (subreddit input, sort, start)
│   ├── popup.css              # Popup styles — dark theme, compact layout
│   └── popup.js               # Auto-detect subreddit, validate, send startSlideshow
├── background/
│   └── background.js          # Reddit API fetch, post normalization, state, message API
├── content/
│   └── overlay.js             # Inject/remove fullscreen overlay iframe on Reddit pages
└── slideshow/
    ├── slideshow.html         # Slideshow page (loaded in iframe and pop-out window)
    ├── slideshow.css          # Dark cinematic theme, fade animations, layout
    ├── slideshow.js           # Controller: navigation, auto-advance, idle fade, mode detection
    └── renderers/
        └── image.js           # Image renderer: render, cleanup, preload
```

---

### Task 1: Extension Skeleton + Manifest

**Files:**
- Create: `manifest.json`
- Create: `icons/icon-48.png`
- Create: `icons/icon-96.png`
- Create: `background/background.js` (empty placeholder)
- Create: `content/overlay.js` (empty placeholder)
- Create: `popup/popup.html` (minimal placeholder)
- Create: `popup/popup.css` (empty)
- Create: `popup/popup.js` (empty)
- Create: `slideshow/slideshow.html` (minimal placeholder)
- Create: `slideshow/slideshow.css` (empty)
- Create: `slideshow/slideshow.js` (empty)
- Create: `slideshow/renderers/image.js` (empty)

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifest_version": 2,
  "name": "Reddit Slideshow",
  "version": "0.1.0",
  "description": "View Reddit posts in a fullscreen slideshow",
  "icons": {
    "48": "icons/icon-48.png",
    "96": "icons/icon-96.png"
  },
  "permissions": [
    "activeTab",
    "tabs",
    "*://*.reddit.com/*",
    "https://www.reddit.com/*"
  ],
  "browser_action": {
    "default_icon": "icons/icon-48.png",
    "default_title": "Reddit Slideshow",
    "default_popup": "popup/popup.html"
  },
  "background": {
    "scripts": ["background/background.js"]
  },
  "content_scripts": [
    {
      "matches": ["*://*.reddit.com/*"],
      "js": ["content/overlay.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    "slideshow/slideshow.html"
  ]
}
```

- [ ] **Step 2: Create placeholder icons**

Generate simple 48x48 and 96x96 PNG icons. These are colored squares as temporary placeholders — they just need to exist so Firefox loads the extension without errors.

Create `icons/icon-48.png` and `icons/icon-96.png` as small solid-color PNG files. Use this approach:

```bash
# If ImageMagick is available:
convert -size 48x48 xc:#4a9eff icons/icon-48.png
convert -size 96x96 xc:#4a9eff icons/icon-96.png

# Otherwise, create minimal valid PNGs programmatically with Python or Node,
# or download any 48x48 and 96x96 PNG placeholders.
```

- [ ] **Step 3: Create placeholder files for all modules**

Create these files with minimal content so the extension loads without errors:

`background/background.js`:
```js
// Reddit Slideshow — background script
console.log("Reddit Slideshow background loaded");
```

`content/overlay.js`:
```js
// Reddit Slideshow — content script (overlay)
console.log("Reddit Slideshow content script loaded");
```

`popup/popup.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="app">
    <h1>Reddit Slideshow</h1>
    <p>Coming soon...</p>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

`popup/popup.css`:
```css
/* Reddit Slideshow — popup styles */
```

`popup/popup.js`:
```js
// Reddit Slideshow — popup script
```

`slideshow/slideshow.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="slideshow.css">
</head>
<body>
  <div id="slideshow">Slideshow placeholder</div>
  <script src="renderers/image.js"></script>
  <script src="slideshow.js"></script>
</body>
</html>
```

`slideshow/slideshow.css`:
```css
/* Reddit Slideshow — slideshow styles */
```

`slideshow/slideshow.js`:
```js
// Reddit Slideshow — slideshow controller
```

`slideshow/renderers/image.js`:
```js
// Reddit Slideshow — image renderer
```

- [ ] **Step 4: Add .gitignore**

Create `.gitignore`:
```
.superpowers/
```

- [ ] **Step 5: Verify — load extension in Firefox**

1. Open Firefox, navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `manifest.json` from the project root
4. Expected: Extension card appears with name "Reddit Slideshow", blue icon, no errors
5. Click the extension icon in the toolbar → popup appears with "Coming soon..."
6. Click "Inspect" on the extension card → console shows "Reddit Slideshow background loaded"

- [ ] **Step 6: Commit**

```bash
git add manifest.json icons/ background/ content/ popup/ slideshow/ .gitignore
git commit -m "feat: extension skeleton with manifest, placeholders, and icons"
```

---

### Task 2: Background Script — Reddit API + State

**Files:**
- Modify: `background/background.js`

This task implements the Reddit API fetching, post normalization, and session state. No message API yet — that comes in Task 3.

- [ ] **Step 1: Implement post type detection and normalization**

Write the `normalizePost` function in `background/background.js`. This takes a raw Reddit API post object and returns our normalized format.

Replace the contents of `background/background.js` with:

```js
// Reddit Slideshow — background script

// --- Post normalization ---

function detectPostType(rawPost) {
  if (rawPost.is_gallery) return "gallery";
  if (rawPost.is_video) return "video";
  if (rawPost.is_self) return "text";
  if (rawPost.post_hint === "image") return "image";
  // Check URL for common image extensions
  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(rawPost.url)) return "image";
  return "link";
}

function extractMediaUrl(rawPost) {
  // Direct image URL
  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(rawPost.url)) {
    return rawPost.url;
  }
  // Reddit preview image (URL is HTML-encoded by Reddit API)
  if (rawPost.preview && rawPost.preview.images && rawPost.preview.images[0]) {
    return rawPost.preview.images[0].source.url.replace(/&amp;/g, "&");
  }
  return rawPost.url;
}

function normalizePost(rawPost) {
  const data = rawPost.data;
  const type = detectPostType(data);
  const source = data.preview && data.preview.images && data.preview.images[0]
    ? data.preview.images[0].source
    : null;

  return {
    id: data.id,
    title: data.title,
    author: data.author,
    subreddit: data.subreddit,
    score: data.score,
    url: data.url,
    permalink: data.permalink,
    thumbnail: data.thumbnail,
    type,
    mediaUrl: extractMediaUrl(data),
    width: source ? source.width : null,
    height: source ? source.height : null,
  };
}

// --- Reddit API ---

async function fetchRedditPosts(subreddit, sort, afterToken = null) {
  // Build URL — sort values like "top_all" need to split into path + query param
  let path = sort;
  let timeParam = "";
  if (sort.startsWith("top_")) {
    path = "top";
    timeParam = `&t=${sort.replace("top_", "")}`;
  }

  let url = `https://www.reddit.com/r/${subreddit}/${path}.json?limit=25&raw_json=1${timeParam}`;
  if (afterToken) {
    url += `&after=${afterToken}`;
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "firefox:reddit-slideshow:v0.1.0" },
  });

  if (!response.ok) {
    throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const posts = json.data.children.map(normalizePost);
  const after = json.data.after; // null if no more pages

  return { posts, after };
}

// --- Session state ---

let session = null;

function createSession(subreddit, sort) {
  session = {
    subreddit,
    sort,
    posts: [],
    currentIndex: 0,
    afterToken: null,
    loading: false,
    exhausted: false,
  };
  return session;
}

function getSession() {
  return session;
}

async function loadPosts(subreddit, sort) {
  const sess = createSession(subreddit, sort);
  sess.loading = true;

  try {
    const result = await fetchRedditPosts(subreddit, sort);
    sess.posts = result.posts;
    sess.afterToken = result.after;
    if (!result.after) sess.exhausted = true;
  } finally {
    sess.loading = false;
  }

  return sess;
}

async function loadMorePosts() {
  if (!session || session.loading || session.exhausted) return;

  session.loading = true;
  try {
    const result = await fetchRedditPosts(session.subreddit, session.sort, session.afterToken);
    // Deduplicate by post ID and filter to images (Phase 1)
    const existingIds = new Set(session.posts.map((p) => p.id));
    const newPosts = result.posts
      .filter((p) => p.type === "image")
      .filter((p) => !existingIds.has(p.id));
    session.posts.push(...newPosts);
    session.afterToken = result.after;
    if (!result.after) session.exhausted = true;
  } finally {
    session.loading = false;
  }
}

console.log("Reddit Slideshow background loaded");
```

- [ ] **Step 2: Verify — test API fetch from background console**

1. Reload the extension in `about:debugging`
2. Click "Inspect" on the extension card to open the background console
3. In the console, run:
   ```js
   fetchRedditPosts("earthporn", "hot").then(r => console.log(r.posts.length, "posts", r.posts[0]))
   ```
4. Expected: logs `25 "posts"` followed by a normalized post object with `id`, `title`, `type`, `mediaUrl`, etc.
5. Also test normalization:
   ```js
   fetchRedditPosts("earthporn", "hot").then(r => console.log(r.posts.filter(p => p.type === "image").length, "images"))
   ```
6. Expected: a number of image-type posts (varies, but should be > 0)

- [ ] **Step 3: Commit**

```bash
git add background/background.js
git commit -m "feat: background script with Reddit API fetch, post normalization, and session state"
```

---

### Task 3: Background Script — Message API

**Files:**
- Modify: `background/background.js`

Add the message listener that handles all inter-component communication.

- [ ] **Step 1: Add message listener**

Append to the end of `background/background.js` (before the `console.log` line):

```js
// --- Message API ---

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case "startSlideshow":
      return handleStartSlideshow(message, sender);
    case "getCurrentState":
      return handleGetCurrentState();
    case "getPosts":
      return handleGetPosts(message);
    case "popOut":
      return handlePopOut(sender);
    case "closeSlideshow":
      return handleCloseSlideshow();
    default:
      return Promise.resolve({ error: "Unknown message type" });
  }
});

async function handleStartSlideshow(message, sender) {
  const { subreddit, sort } = message;
  await loadPosts(subreddit, sort);

  // Filter to image-only for Phase 1
  session.posts = session.posts.filter((p) => p.type === "image");

  // Send showOverlay to the active tab's content script
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    session.tabId = tabs[0].id;
    await browser.tabs.sendMessage(tabs[0].id, { type: "showOverlay" });
  }

  return { success: true, postCount: session.posts.length };
}

async function handleGetCurrentState() {
  if (!session) {
    return { error: "No active session" };
  }
  return {
    subreddit: session.subreddit,
    sort: session.sort,
    posts: session.posts,
    currentIndex: session.currentIndex,
    exhausted: session.exhausted,
  };
}

async function handleGetPosts(message) {
  if (!session) return { error: "No active session" };

  const { startIndex, count } = message;
  const posts = session.posts.slice(startIndex, startIndex + count);

  // Preemptive fetch: if requesting near the end, load more and return updated list
  if (startIndex + count >= session.posts.length - 5) {
    await loadMorePosts();
  }

  return { posts: session.posts, total: session.posts.length, exhausted: session.exhausted };
}

async function handlePopOut(sender) {
  if (!session) return { error: "No active session" };

  // Open slideshow in new window
  const slideshowUrl = browser.runtime.getURL("slideshow/slideshow.html?mode=popout");
  await browser.windows.create({
    url: slideshowUrl,
    type: "popup",
    width: 1200,
    height: 800,
  });

  // Remove overlay from the original tab
  if (session.tabId) {
    await browser.tabs.sendMessage(session.tabId, { type: "hideOverlay" });
  }

  return { success: true };
}

async function handleCloseSlideshow() {
  if (session && session.tabId) {
    try {
      await browser.tabs.sendMessage(session.tabId, { type: "hideOverlay" });
    } catch (e) {
      // Tab may have been closed — ignore
    }
  }
  session = null;
  return { success: true };
}
```

- [ ] **Step 2: Verify — test message API from background console**

1. Reload extension in `about:debugging`
2. Open background console ("Inspect")
3. Run:
   ```js
   browser.runtime.sendMessage({ type: "startSlideshow", subreddit: "earthporn", sort: "hot" }).then(console.log)
   ```
4. Expected: logs `{ success: true, postCount: N }` where N > 0. May also log an error about sendMessage to tab (content script not ready yet) — that's expected.
5. Then run:
   ```js
   browser.runtime.sendMessage({ type: "getCurrentState" }).then(console.log)
   ```
6. Expected: returns session object with posts array

- [ ] **Step 3: Commit**

```bash
git add background/background.js
git commit -m "feat: background message API — start, getState, getPosts, popOut, close"
```

---

### Task 4: Content Script — Overlay

**Files:**
- Modify: `content/overlay.js`

- [ ] **Step 1: Implement overlay injection and removal**

Replace the contents of `content/overlay.js`:

```js
// Reddit Slideshow — content script (overlay)

let overlayElement = null;

function createOverlay() {
  if (overlayElement) return; // Already showing

  overlayElement = document.createElement("div");
  overlayElement.id = "reddit-slideshow-overlay";
  overlayElement.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2147483647;
    background: #000;
    border: none;
    margin: 0;
    padding: 0;
  `;

  const iframe = document.createElement("iframe");
  iframe.src = browser.runtime.getURL("slideshow/slideshow.html?mode=overlay");
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: none;
    margin: 0;
    padding: 0;
  `;
  iframe.allow = "autoplay";

  overlayElement.appendChild(iframe);
  document.body.appendChild(overlayElement);

  // Prevent scrolling on the underlying page
  document.body.style.overflow = "hidden";
}

function removeOverlay() {
  if (!overlayElement) return;

  overlayElement.remove();
  overlayElement = null;
  document.body.style.overflow = "";
}

// Listen for messages from background
browser.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "showOverlay":
      createOverlay();
      return Promise.resolve({ success: true });
    case "hideOverlay":
      removeOverlay();
      return Promise.resolve({ success: true });
    default:
      return false;
  }
});

// Listen for Escape key to close overlay
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlayElement) {
    browser.runtime.sendMessage({ type: "closeSlideshow" });
    removeOverlay();
  }
});
```

- [ ] **Step 2: Verify — overlay appears on Reddit**

1. Reload extension in `about:debugging`
2. Navigate to `https://www.reddit.com/r/earthporn` in a tab
3. Open the browser console (F12) on that Reddit tab and run:
   ```js
   browser.runtime.sendMessage({ type: "startSlideshow", subreddit: "earthporn", sort: "hot" })
   ```
4. Expected: a black fullscreen overlay appears covering the Reddit page, with "Slideshow placeholder" text visible inside the iframe
5. Press Escape → overlay is removed, Reddit page is visible and scrollable again

- [ ] **Step 3: Commit**

```bash
git add content/overlay.js
git commit -m "feat: content script — overlay injection and removal with Escape key support"
```

---

### Task 5: Slideshow Page — HTML Structure + CSS

**Files:**
- Modify: `slideshow/slideshow.html`
- Modify: `slideshow/slideshow.css`

- [ ] **Step 1: Write the slideshow HTML structure**

Replace `slideshow/slideshow.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reddit Slideshow</title>
  <link rel="stylesheet" href="slideshow.css">
</head>
<body>
  <!-- Top bar: progress, auto-advance, pop-out, close -->
  <div id="top-bar" class="controls">
    <span id="progress">0 / 0</span>
    <div id="top-bar-right">
      <button id="auto-advance-btn" title="Toggle auto-advance">⏱ Off</button>
      <button id="popout-btn" title="Pop out to window">↗</button>
      <button id="close-btn" title="Close slideshow">✕</button>
    </div>
  </div>

  <!-- Navigation arrows -->
  <button id="prev-btn" class="nav-arrow controls" title="Previous (←)">‹</button>
  <button id="next-btn" class="nav-arrow controls" title="Next (→)">›</button>

  <!-- Main content area — renderers populate this -->
  <div id="content-container"></div>

  <!-- Post info -->
  <div id="post-info" class="controls">
    <div id="post-title"></div>
    <div id="post-meta"></div>
  </div>

  <!-- Progress bar -->
  <div id="progress-bar">
    <div id="progress-bar-fill"></div>
  </div>

  <script src="renderers/image.js"></script>
  <script src="slideshow.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the dark cinematic CSS with fade animations**

Replace `slideshow/slideshow.css`:

```css
/* Reddit Slideshow — dark cinematic theme with fade-on-idle controls */

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #0a0a0a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
  cursor: default;
  user-select: none;
}

/* Controls fade on idle */
.controls {
  transition: opacity 0.3s ease;
  opacity: 1;
}

body.idle .controls {
  opacity: 0;
  pointer-events: none;
}

body.idle {
  cursor: none;
}

/* Top bar */
#top-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  z-index: 100;
}

#progress {
  color: #aaa;
  font-size: 14px;
}

#top-bar-right {
  display: flex;
  gap: 8px;
}

#top-bar button {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ccc;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}

#top-bar button:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

#close-btn {
  font-size: 18px;
  padding: 2px 10px;
}

/* Navigation arrows */
.nav-arrow {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #fff;
  font-size: 32px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  transition: background 0.2s, opacity 0.3s ease;
}

.nav-arrow:hover {
  background: rgba(255, 255, 255, 0.25);
}

#prev-btn {
  left: 20px;
}

#next-btn {
  right: 20px;
}

.nav-arrow:disabled {
  opacity: 0.2;
  cursor: default;
}

/* Content container */
#content-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 80px 100px;
}

/* Post info */
#post-info {
  position: fixed;
  bottom: 20px;
  left: 0;
  right: 0;
  text-align: center;
  padding: 0 80px;
  z-index: 100;
}

#post-title {
  font-size: 15px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#post-meta {
  font-size: 12px;
  color: #777;
}

/* Progress bar */
#progress-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #222;
  z-index: 100;
}

#progress-bar-fill {
  height: 100%;
  background: #4a9eff;
  border-radius: 0 2px 2px 0;
  transition: width 0.3s ease;
  width: 0%;
}

/* Loading spinner */
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #333;
  border-top-color: #4a9eff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Image styles (used by image renderer) */
#content-container img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.3s ease;
}

#content-container img.loaded {
  opacity: 1;
}
```

- [ ] **Step 3: Verify — check slideshow page layout**

1. Reload extension in `about:debugging`
2. Open `moz-extension://<extension-id>/slideshow/slideshow.html` directly in a tab (find the extension ID from `about:debugging`)
3. Expected: dark black page with top bar (progress "0 / 0", buttons), left/right arrows, empty content area, bottom progress bar
4. The layout should fill the viewport with no scrollbars

- [ ] **Step 4: Commit**

```bash
git add slideshow/slideshow.html slideshow/slideshow.css
git commit -m "feat: slideshow page HTML structure and dark cinematic CSS theme"
```

---

### Task 6: Image Renderer

**Files:**
- Modify: `slideshow/renderers/image.js`

- [ ] **Step 1: Implement the image renderer with preloading**

Replace `slideshow/renderers/image.js`:

```js
// Reddit Slideshow — image renderer

const ImageRenderer = {
  /**
   * Render an image post into the container.
   * @param {Object} post - Normalized post object
   * @param {HTMLElement} container - The #content-container element
   * @returns {Function} cleanup - Call to tear down this render
   */
  render(post, container) {
    // Clear previous content
    container.innerHTML = "";

    // Show loading spinner
    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    // Create image
    const img = document.createElement("img");
    img.alt = post.title;

    img.addEventListener("load", () => {
      spinner.remove();
      img.classList.add("loaded");
    });

    img.addEventListener("error", () => {
      spinner.remove();
      container.innerHTML = `<div style="color:#777;font-size:14px;">Failed to load image</div>`;
    });

    img.src = post.mediaUrl;
    container.appendChild(img);

    // Cleanup function
    return () => {
      img.src = "";
      container.innerHTML = "";
    };
  },

  /**
   * Preload an image so it's cached for instant display.
   * @param {Object} post - Normalized post object
   */
  preload(post) {
    if (!post || !post.mediaUrl) return;
    const img = new Image();
    img.src = post.mediaUrl;
  },
};
```

- [ ] **Step 2: Verify — renderer creates image element**

1. Reload extension, open the slideshow page directly
2. In the console on that page, run:
   ```js
   const container = document.getElementById("content-container");
   const fakePost = { title: "Test", mediaUrl: "https://i.redd.it/test.jpg" };
   ImageRenderer.render(fakePost, container);
   ```
3. Expected: spinner appears briefly, then either an image loads or "Failed to load image" shows (since it's a fake URL). The important thing is no JS errors and the spinner/error handling works.

- [ ] **Step 3: Commit**

```bash
git add slideshow/renderers/image.js
git commit -m "feat: image renderer with loading spinner, fade-in, error handling, and preload"
```

---

### Task 7: Slideshow Controller — Navigation, Auto-advance, Fade

**Files:**
- Modify: `slideshow/slideshow.js`

This is the main controller: fetches state from background, renders posts, handles keyboard/button navigation, auto-advance timer, idle fade, and mode detection.

- [ ] **Step 1: Implement the slideshow controller**

Replace `slideshow/slideshow.js`:

```js
// Reddit Slideshow — slideshow controller

(async function () {
  // --- Mode detection ---
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "overlay"; // "overlay" or "popout"

  // --- DOM references ---
  const contentContainer = document.getElementById("content-container");
  const progress = document.getElementById("progress");
  const postTitle = document.getElementById("post-title");
  const postMeta = document.getElementById("post-meta");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const closeBtn = document.getElementById("close-btn");
  const popoutBtn = document.getElementById("popout-btn");
  const autoAdvanceBtn = document.getElementById("auto-advance-btn");

  // --- State ---
  let posts = [];
  let currentIndex = 0;
  let cleanupCurrentRender = null;
  let autoAdvanceOn = false;
  let autoAdvanceInterval = 5000; // 5 seconds
  let autoAdvanceTimer = null;
  let exhausted = false;

  // --- Renderer map (extensible for future types) ---
  const renderers = {
    image: ImageRenderer,
  };

  // --- Fetch initial state from background ---
  async function init() {
    try {
      const state = await browser.runtime.sendMessage({ type: "getCurrentState" });
      if (state.error) {
        contentContainer.innerHTML = `<div style="color:#777;font-size:14px;">${state.error}</div>`;
        return;
      }
      posts = state.posts;
      currentIndex = state.currentIndex || 0;
      exhausted = state.exhausted || false;

      if (posts.length === 0) {
        contentContainer.innerHTML = `<div style="color:#777;font-size:14px;">No image posts found</div>`;
        return;
      }

      renderCurrentPost();
    } catch (e) {
      contentContainer.innerHTML = `<div style="color:#777;font-size:14px;">Error loading slideshow</div>`;
    }
  }

  // --- Rendering ---
  function renderCurrentPost() {
    const post = posts[currentIndex];
    if (!post) return;

    // Cleanup previous render
    if (cleanupCurrentRender) {
      cleanupCurrentRender();
      cleanupCurrentRender = null;
    }

    // Get renderer for post type
    const renderer = renderers[post.type];
    if (renderer) {
      cleanupCurrentRender = renderer.render(post, contentContainer);
    } else {
      contentContainer.innerHTML = `<div style="color:#777;font-size:14px;">Unsupported content type: ${post.type}</div>`;
    }

    // Update UI
    updatePostInfo(post);
    updateProgress();
    updateNavButtons();

    // Preload next image
    preloadNext();

    // Check if we need more posts
    checkPreemptiveFetch();
  }

  function updatePostInfo(post) {
    postTitle.textContent = post.title;
    const scoreFormatted = post.score >= 1000
      ? `${(post.score / 1000).toFixed(1)}k`
      : post.score;
    postMeta.textContent = `r/${post.subreddit} · ${scoreFormatted} ↑ · u/${post.author}`;
  }

  function updateProgress() {
    progress.textContent = `${currentIndex + 1} / ${posts.length}`;
    const pct = posts.length > 0 ? ((currentIndex + 1) / posts.length) * 100 : 0;
    progressBarFill.style.width = `${pct}%`;
  }

  function updateNavButtons() {
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex >= posts.length - 1 && exhausted;
  }

  function preloadNext() {
    const nextPost = posts[currentIndex + 1];
    if (nextPost) {
      const renderer = renderers[nextPost.type];
      if (renderer && renderer.preload) {
        renderer.preload(nextPost);
      }
    }
  }

  // --- Preemptive fetch ---
  async function checkPreemptiveFetch() {
    if (currentIndex >= posts.length - 5 && !exhausted) {
      try {
        const result = await browser.runtime.sendMessage({
          type: "getPosts",
          startIndex: posts.length,
          count: 25,
        });
        if (result.posts && result.posts.length > 0) {
          posts.push(...result.posts);
        }
        if (result.total) {
          // Sync total post count
          posts = posts.slice(0, result.total);
        }
        exhausted = result.exhausted || false;
        updateProgress();
        updateNavButtons();
      } catch (e) {
        // Non-critical — just continue with what we have
      }
    }
  }

  // --- Navigation ---
  function goNext() {
    if (currentIndex < posts.length - 1) {
      currentIndex++;
      renderCurrentPost();
      resetAutoAdvance();
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentPost();
      resetAutoAdvance();
    }
  }

  // --- Auto-advance ---
  function startAutoAdvance() {
    autoAdvanceOn = true;
    autoAdvanceBtn.textContent = `⏱ ${autoAdvanceInterval / 1000}s`;
    autoAdvanceTimer = setInterval(() => {
      if (currentIndex < posts.length - 1) {
        goNext();
      } else if (exhausted) {
        stopAutoAdvance();
      }
    }, autoAdvanceInterval);
  }

  function stopAutoAdvance() {
    autoAdvanceOn = false;
    autoAdvanceBtn.textContent = "⏱ Off";
    if (autoAdvanceTimer) {
      clearInterval(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function resetAutoAdvance() {
    if (autoAdvanceOn) {
      clearInterval(autoAdvanceTimer);
      autoAdvanceTimer = setInterval(() => {
        if (currentIndex < posts.length - 1) {
          goNext();
        } else if (exhausted) {
          stopAutoAdvance();
        }
      }, autoAdvanceInterval);
    }
  }

  function toggleAutoAdvance() {
    if (autoAdvanceOn) {
      stopAutoAdvance();
    } else {
      startAutoAdvance();
    }
  }

  // --- Idle fade ---
  let idleTimer = null;
  const IDLE_TIMEOUT = 2000;

  function resetIdleTimer() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      document.body.classList.add("idle");
    }, IDLE_TIMEOUT);
  }

  document.addEventListener("mousemove", resetIdleTimer);
  document.addEventListener("keydown", resetIdleTimer);
  resetIdleTimer();

  // --- Close / Pop-out ---
  async function closeSlideshow() {
    if (mode === "popout") {
      window.close();
    } else {
      await browser.runtime.sendMessage({ type: "closeSlideshow" });
    }
  }

  async function popOut() {
    await browser.runtime.sendMessage({ type: "popOut" });
    // If we're in overlay mode, the overlay will be removed by background
  }

  // --- Event listeners ---
  prevBtn.addEventListener("click", goPrev);
  nextBtn.addEventListener("click", goNext);
  closeBtn.addEventListener("click", closeSlideshow);
  popoutBtn.addEventListener("click", popOut);
  autoAdvanceBtn.addEventListener("click", toggleAutoAdvance);

  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowLeft":
        goPrev();
        break;
      case "ArrowRight":
        goNext();
        break;
      case " ":
        e.preventDefault();
        toggleAutoAdvance();
        break;
      case "Escape":
        closeSlideshow();
        break;
    }
  });

  // Hide pop-out button in pop-out mode (already popped out)
  if (mode === "popout") {
    popoutBtn.style.display = "none";
  }

  // --- Initialize ---
  init();
})();
```

- [ ] **Step 2: Verify — full slideshow flow**

1. Reload extension in `about:debugging`
2. Navigate to `https://www.reddit.com/r/earthporn`
3. Click the extension icon → popup shows "Coming soon..." (popup not wired yet — that's Task 8)
4. Instead, open the browser console on the Reddit page and run:
   ```js
   browser.runtime.sendMessage({ type: "startSlideshow", subreddit: "earthporn", sort: "hot" })
   ```
5. Expected: black overlay appears, images from r/earthporn load and display
6. Test navigation: press ← and → arrow keys to move between posts
7. Test auto-advance: press Spacebar to toggle auto-advance, images should advance every 5 seconds
8. Test fade: stop moving the mouse for 2 seconds — controls should fade out; move mouse — they reappear
9. Test close: press Escape — overlay closes

- [ ] **Step 3: Commit**

```bash
git add slideshow/slideshow.js
git commit -m "feat: slideshow controller — navigation, auto-advance, idle fade, mode detection"
```

---

### Task 8: Popup — UI, Auto-detection, Launch

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`
- Modify: `popup/popup.js`

- [ ] **Step 1: Write the popup HTML**

Replace `popup/popup.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="app">
    <h1>Reddit Slideshow</h1>

    <div id="detected" class="detected" style="display:none;">
      <span id="detected-label"></span>
    </div>

    <label for="subreddit-input">Subreddit</label>
    <input
      type="text"
      id="subreddit-input"
      placeholder="e.g. earthporn"
      autocomplete="off"
      spellcheck="false"
    >
    <div id="error-msg" class="error" style="display:none;"></div>

    <label for="sort-select">Sort by</label>
    <select id="sort-select">
      <option value="hot" selected>Hot</option>
      <option value="new">New</option>
      <option value="top_all">Top (All Time)</option>
      <option value="top_day">Top (Today)</option>
      <option value="top_week">Top (This Week)</option>
      <option value="rising">Rising</option>
    </select>

    <button id="start-btn">Start Slideshow</button>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the popup CSS**

Replace `popup/popup.css`:

```css
/* Reddit Slideshow — popup styles */

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  width: 300px;
  background: #1a1a2e;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
}

#app {
  padding: 16px;
}

h1 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #fff;
}

label {
  display: block;
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

input, select {
  width: 100%;
  padding: 8px 10px;
  background: #0a0a1a;
  border: 1px solid #333;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 14px;
  margin-bottom: 12px;
  outline: none;
}

input:focus, select:focus {
  border-color: #4a9eff;
}

select {
  cursor: pointer;
}

button {
  width: 100%;
  padding: 10px;
  background: #4a9eff;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover {
  background: #3a8eef;
}

button:active {
  background: #2a7edf;
}

.detected {
  background: rgba(74, 158, 255, 0.1);
  border: 1px solid rgba(74, 158, 255, 0.3);
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #4a9eff;
}

.error {
  color: #ff6b6b;
  font-size: 12px;
  margin-top: -8px;
  margin-bottom: 8px;
}

button.stop {
  background: #cc4444;
}

button.stop:hover {
  background: #bb3333;
}
```

- [ ] **Step 3: Write the popup JavaScript**

Replace `popup/popup.js`:

```js
// Reddit Slideshow — popup script

const subredditInput = document.getElementById("subreddit-input");
const sortSelect = document.getElementById("sort-select");
const startBtn = document.getElementById("start-btn");
const errorMsg = document.getElementById("error-msg");
const detected = document.getElementById("detected");
const detectedLabel = document.getElementById("detected-label");

// --- Auto-detect subreddit from current tab ---
async function detectSubreddit() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;

    const url = tabs[0].url || "";
    const match = url.match(/reddit\.com\/r\/([a-zA-Z0-9_]+)/);
    if (match) {
      const subreddit = match[1];
      subredditInput.value = subreddit;
      detectedLabel.textContent = `Current: r/${subreddit}`;
      detected.style.display = "block";
    }
  } catch (e) {
    // No permission or not on Reddit — that's fine
  }
}

// --- Validation ---
function validateSubreddit(name) {
  if (!name || name.trim() === "") {
    return "Please enter a subreddit name";
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9_]{1,21}$/.test(trimmed)) {
    return "Subreddit names can only contain letters, numbers, and underscores (max 21 chars)";
  }
  return null;
}

// --- Start slideshow ---
async function startSlideshow() {
  const subreddit = subredditInput.value.trim();
  const sort = sortSelect.value;

  const validationError = validateSubreddit(subreddit);
  if (validationError) {
    errorMsg.textContent = validationError;
    errorMsg.style.display = "block";
    return;
  }

  errorMsg.style.display = "none";
  startBtn.disabled = true;
  startBtn.textContent = "Loading...";

  try {
    await browser.runtime.sendMessage({
      type: "startSlideshow",
      subreddit,
      sort,
    });
    window.close();
  } catch (e) {
    errorMsg.textContent = "Failed to start slideshow. Make sure you're on a Reddit page.";
    errorMsg.style.display = "block";
    startBtn.disabled = false;
    startBtn.textContent = "Start Slideshow";
  }
}

// --- Event listeners ---
startBtn.addEventListener("click", startSlideshow);

subredditInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    startSlideshow();
  }
});

subredditInput.addEventListener("input", () => {
  errorMsg.style.display = "none";
});

// --- Init ---
detectSubreddit();
```

- [ ] **Step 4: Verify — full end-to-end flow via popup**

1. Reload extension in `about:debugging`
2. Navigate to `https://www.reddit.com/r/earthporn`
3. Click the extension icon → popup opens
4. Expected: subreddit field pre-filled with "earthporn", blue "Current: r/earthporn" label above it
5. Click "Start Slideshow"
6. Expected: popup closes, dark overlay appears with images from r/earthporn
7. Test navigation with arrow keys, auto-advance with Spacebar, Escape to close
8. Also test on a non-Reddit page: open popup, field should be empty with placeholder "e.g. earthporn"
9. Test validation: try starting with empty input → error message appears

- [ ] **Step 5: Commit**

```bash
git add popup/
git commit -m "feat: popup UI with subreddit auto-detection, sort picker, and validation"
```

---

### Task 9: Preemptive Pagination Sync + Pop-out Polish

**Files:**
- Modify: `slideshow/slideshow.js`

The preemptive fetch logic in the controller (Task 7) fires `getPosts` to the background, but there's a sync issue: the background may have loaded more posts after filtering, and the slideshow needs to pull in the updated full list. This task fixes the sync and verifies the pop-out flow end-to-end.

- [ ] **Step 1: Fix preemptive fetch to sync the full post list**

In `slideshow/slideshow.js`, replace the `checkPreemptiveFetch` function. Since `getPosts` now awaits `loadMorePosts` in the background and returns the full updated post list, we just need one call:

```js
  async function checkPreemptiveFetch() {
    if (currentIndex >= posts.length - 5 && !exhausted) {
      try {
        const result = await browser.runtime.sendMessage({
          type: "getPosts",
          startIndex: posts.length,
          count: 25,
        });
        if (result && !result.error && result.posts) {
          posts = result.posts;
          exhausted = result.exhausted || false;
          updateProgress();
          updateNavButtons();
        }
      } catch (e) {
        // Non-critical — continue with what we have
      }
    }
  }
```

- [ ] **Step 2: Verify — pagination and pop-out**

1. Reload extension in `about:debugging`
2. Navigate to Reddit, start slideshow on a subreddit with many image posts (e.g. `earthporn` or `pics`)
3. Navigate forward past post ~20 → new posts should load seamlessly, progress counter updates (e.g., "21 / 50")
4. Click the pop-out button (↗) → slideshow opens in a new window, overlay closes on the Reddit tab
5. In the pop-out window: navigation and auto-advance still work, pop-out button is hidden, Escape/close closes the window

- [ ] **Step 3: Commit**

```bash
git add slideshow/slideshow.js
git commit -m "fix: sync full post list on preemptive fetch, verify pop-out flow"
```

---

## Summary

| Task | Description | Key files |
|------|-------------|-----------|
| 1 | Extension skeleton + manifest | `manifest.json`, all placeholder files |
| 2 | Background — Reddit API + state | `background/background.js` |
| 3 | Background — Message API | `background/background.js` |
| 4 | Content script — Overlay | `content/overlay.js` |
| 5 | Slideshow HTML + CSS | `slideshow/slideshow.html`, `slideshow.css` |
| 6 | Image renderer | `slideshow/renderers/image.js` |
| 7 | Slideshow controller | `slideshow/slideshow.js` |
| 8 | Popup UI | `popup/popup.html`, `popup.css`, `popup.js` |
| 9 | Pagination sync + pop-out polish | `slideshow/slideshow.js` |
