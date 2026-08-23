// Boot: pick a source, build the feed, wire the pager and chrome together.
// Demo is the default; `?sub=name` tries the real Reddit listing and falls
// back to demo with a visible message if the first page cannot be fetched
// (in a plain browser that is the normal case — reddit.com sends no CORS
// headers; the packaged app routes fetch through native HTTP instead).
import { detectHls } from "../core/normalize.js";
import { Settings } from "../core/settings.js";
import { createFeed } from "../core/feed.js";
import { createDemoSource } from "../data/demo.js";
import { createRedditSource } from "../data/reddit.js";
import { createChrome } from "./chrome.js";
import { createPager } from "./pager.js";

const canHls = detectHls();

async function pickFeed(toastLater) {
  const params = new URLSearchParams(location.search);
  const sub = (params.get("sub") || "").replace(/^r\//, "").trim();
  if (sub) {
    const feed = createFeed(createRedditSource({ canHls, subreddit: sub }));
    try {
      await feed.start();
      return feed;
    } catch (e) {
      toastLater(`r/${sub} unreachable from here (${e.message}) — showing the demo feed`);
    }
  }
  const feed = createFeed(createDemoSource({ canHls }));
  await feed.start();
  return feed;
}

const pendingToasts = [];
const feed = await pickFeed((msg) => pendingToasts.push(msg));

const chrome = createChrome({
  sourceLabel: feed.source.label,
  isDemo: feed.source.isDemo,
});
pendingToasts.forEach((msg) => chrome.toast(msg));

function openExternal(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener");
}

function permalinkUrl(post) {
  const link = (post && post.permalink) || "";
  if (!link) return "";
  if (/^https?:/.test(link)) return link;
  return `https://www.reddit.com${link.startsWith("/") ? "" : "/"}${link}`;
}

function flagFailed(buttonEl, message) {
  chrome.toast(message);
  if (buttonEl) {
    buttonEl.classList.add("action-failed");
    setTimeout(() => buttonEl.classList.remove("action-failed"), 1500);
  }
}

async function actions(kind, slide, buttonEl) {
  const post = slide && slide.post;
  if (!post) return;
  if (kind === "auto") {
    Settings.set("autoAdvance", !Settings.get("autoAdvance"));
    return;
  }
  if (kind === "open") {
    if (feed.source.isDemo) {
      chrome.toast("Demo post — there is no Reddit page behind it");
      return;
    }
    openExternal(permalinkUrl(post));
    return;
  }
  if (kind === "save") {
    const result = await feed.toggleSave(post);
    if (result.error) flagFailed(buttonEl, result.error);
    return;
  }
  if (kind === "up" || kind === "down") {
    const result = await feed.vote(post, kind === "up" ? 1 : -1);
    if (result.error) flagFailed(buttonEl, result.error);
  }
}
actions.openExternal = openExternal;

const pager = createPager({
  container: document.getElementById("feed"),
  feed,
  chrome,
  actions,
});

pager.start();

// The shot rig drives the app through this handle; harmless in normal use.
window.__reel = {
  pager,
  feed,
  Settings,
  slideH: () => document.getElementById("feed").clientHeight,
  scrollTo: (y, smooth = true) =>
    document.getElementById("feed").scrollTo({ top: y, behavior: smooth ? "smooth" : "auto" }),
};
