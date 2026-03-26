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
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file from the project root

### Reloading after changes
Click "Reload" on the extension card in `about:debugging`, or press Ctrl+R in the extension's pages.

## Architecture

- `manifest.json` — Extension manifest defining permissions, content scripts, popup, and background scripts
- `popup/` — Browser action popup UI (entry point for starting a slideshow)
- `slideshow/` — Fullscreen slideshow page that displays Reddit posts sequentially
- `background/` — Background script handling Reddit API calls and state management
- `content/` — Content scripts injected into Reddit pages (if needed for context-aware launching)

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
