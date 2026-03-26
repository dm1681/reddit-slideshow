# Reddit Slideshow — Firefox Extension Design

## Overview

A Firefox browser extension that lets users view Reddit content in a fullscreen slideshow format. Launches from a browser action popup, displays posts one at a time with navigation controls over a dark cinematic UI. Initially supports images only, with a pluggable renderer system for adding video, text, gallery, and link support later.

## Architecture

**Approach: Hybrid — Content Script + Extension Page**

The content script injects a minimal fullscreen overlay with an iframe pointing to the slideshow extension page. This gives overlay UX with full CSS isolation via the iframe boundary. Pop-out to a separate window reuses the same extension page.

### File Structure

```
reddit-slideshow/
├── manifest.json              # Manifest V2, permissions for reddit.com
├── popup/
│   ├── popup.html             # Browser action popup
│   ├── popup.css
│   └── popup.js               # Detects current subreddit, sends launch message
├── background/
│   └── background.js          # Reddit API fetching, pagination, state management
├── content/
│   └── overlay.js             # Injected into Reddit pages — creates overlay iframe
├── slideshow/
│   ├── slideshow.html         # Standalone extension page (used in iframe + pop-out)
│   ├── slideshow.css          # Dark cinematic styles, fade animations
│   ├── slideshow.js           # Main controller — navigation, auto-advance, UI
│   └── renderers/
│       └── image.js           # Image renderer (first implementation)
└── icons/                     # Extension icons
```

### Communication Flow

1. **Popup** detects current tab's URL → extracts subreddit → sends `startSlideshow` message to **background**
2. **Background** fetches posts from Reddit JSON API → stores in memory → sends `showOverlay` message to **content script**
3. **Content script** injects a fullscreen overlay with an iframe pointing to `slideshow.html`
4. **Slideshow page** communicates with background via `browser.runtime.sendMessage` to get posts, request next batch
5. **Pop-out**: slideshow sends message to background, which calls `browser.windows.create()` with the slideshow URL

## Background Script & Data Layer

### Reddit API Interface

- Endpoint: `https://www.reddit.com/r/{subreddit}/{sort}.json?limit=25&after={token}`
- Parses response into a normalized post format:
  ```
  { id, title, author, subreddit, score, url, thumbnail,
    type: "image"|"video"|"text"|"gallery"|"link",
    mediaUrl, width, height }
  ```
- Filters posts by type (initially only `type === "image"` passes through)

### State Management

- Holds current session: `{ subreddit, sort, posts[], currentIndex, afterToken, loading }`
- Single active session at a time — starting a new one replaces the old

### Pagination

- Initial fetch: loads first 25 posts
- Preemptive trigger: when slideshow requests post at index `length - 5`, background starts fetching next batch
- Appends new posts to the array, deduplicates by post ID
- If fetch returns no `after` token, marks feed as exhausted

### Message API

| Message | Direction | Purpose |
|---------|-----------|---------|
| `startSlideshow { subreddit, sort }` | popup → background | Fetch posts, tell content script to show overlay |
| `getPosts { startIndex, count }` | slideshow → background | Returns slice of posts array |
| `getCurrentState` | slideshow → background | Returns full session state |
| `popOut` | slideshow → background | Opens slideshow in new window, removes overlay |
| `showOverlay` | background → content | Inject the overlay iframe |
| `hideOverlay` | background → content | Remove the overlay |

## Content Script (Overlay)

### Injection

- Runs on `*://*.reddit.com/*` pages
- Does nothing on load — waits for `showOverlay` message from background

### Overlay Creation

- Creates a fixed-position fullscreen div (`z-index: 2147483647`)
- Contains an iframe pointing to `browser.runtime.getURL("slideshow/slideshow.html")`
- iframe fills the entire overlay, no borders
- Black background as fallback while iframe loads

### Overlay Removal

- Listens for `hideOverlay` message from background (triggered by close or pop-out)
- Removes the overlay div from the DOM
- Escape key sends a close message through to background

## Slideshow Page & Renderer System

### Slideshow Controller

- On load, sends `getCurrentState` to background to get posts and current index
- Manages navigation state: current index, auto-advance on/off, timer interval
- Delegates rendering to the appropriate renderer based on `post.type`
- Detects its display mode via URL parameter (`?mode=overlay` vs `?mode=popout`) — overlay mode sends close/popout messages to background; pop-out mode just closes the window on close

### Navigation

- Left/right arrow keys and on-screen arrow buttons
- Auto-advance toggle with configurable interval (default 5s)
- Progress indicator: `3 / 25` (updates as more posts load)
- Close button: sends `hideOverlay` or closes window in pop-out mode
- Pop-out button: sends `popOut` to background

### Fade Behavior

- All controls (top bar, arrows, post info) toggle a CSS class on a 2-second idle timer
- Mouse movement or keypress resets timer and shows controls
- CSS transitions handle fade (opacity over ~300ms)
- Cursor hides when controls fade

### Renderer Interface

- Each renderer: `render(post, container)` → populates the container element
- Returns a cleanup function for teardown when navigating away
- Falls back to an "unsupported type" placeholder for unrecognized types

### Image Renderer (Initial Implementation)

- Creates an `<img>` element with `src` set to `post.mediaUrl`
- Styled with `object-fit: contain`, `max-width: 100%`, `max-height: 100vh` — scales to fit without cropping
- Loading spinner while image loads, fades in on complete
- Preloads the next image in the background for instant transitions

## Popup

### Layout

- Simple vertical stack: subreddit input, sort dropdown, start button
- Compact — ~300px wide popup

### Auto-detection

- On open, queries active tab's URL
- If matches `reddit.com/r/{subreddit}`, pre-fills input with label "Current: r/EarthPorn"
- If not on Reddit, empty input with placeholder "e.g. earthporn"

### Sort Picker

- Dropdown: Hot, New, Top (All Time), Top (Today), Top (This Week), Rising
- Defaults to Hot

### Start Action

- Validates subreddit name (alphanumeric, underscores, 1-21 chars)
- Sends `startSlideshow { subreddit, sort }` to background
- Closes the popup

### Edge Cases

- Empty input → inline validation message
- Active slideshow → button changes to "Stop Slideshow"

## Visual Design

- **Theme**: Dark cinematic — near-black background (#0a0a0a), light text
- **Controls**: Semi-transparent, fade after 2s idle, reappear on mouse movement
- **Content**: Centered, scaled to fit viewport without cropping
- **Post info**: Title, subreddit, score, author — shown below content, fades with controls
- **Progress bar**: Thin bar at bottom of viewport, subtle blue (#4a9eff)
- **Transitions**: Smooth opacity fades (~300ms) for all interactive elements

## Scope: Phase 1 (This Implementation)

**In scope:**
- Image-only rendering
- Popup with subreddit input, sort picker, auto-detection
- Overlay mode with iframe
- Pop-out to separate window
- Keyboard and on-screen navigation
- Auto-advance with configurable timer
- Preemptive pagination
- Fade-on-idle controls
- Progress indicator

**Out of scope (future phases):**
- Video renderer (v.redd.it, gifv, embedded)
- Text/self post renderer
- Gallery renderer (multi-image posts)
- External link renderer (preview cards)
- Thumbnail filmstrip for jumping to specific posts
- Saved/favorite subreddits in popup
- Full URL input (multireddit, user pages, search results)
