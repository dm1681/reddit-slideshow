// Reddit Slideshow — background script

// --- Session state ---

let session = null;

// --- Redgifs API (resolve direct MP4 URLs) ---

let redgifsToken = null;
let redgifsTokenExpiry = 0;

// A redgifs request that never answers used to stall resolution indefinitely.
// Nothing here is worth waiting on longer than this — a post that misses the
// window just stays on its embed fallback.
const REDGIFS_TIMEOUT_MS = 8000;

async function getRedgifsToken() {
  if (redgifsToken && Date.now() < redgifsTokenExpiry) {
    return redgifsToken;
  }
  const resp = await fetch("https://api.redgifs.com/v2/auth/temporary", {
    signal: AbortSignal.timeout(REDGIFS_TIMEOUT_MS),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  redgifsToken = data.token || data.access_token;
  redgifsTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
  return redgifsToken;
}

async function resolveRedgifsUrl(id) {
  const token = await getRedgifsToken();
  if (!token) return null;
  const resp = await fetch(`https://api.redgifs.com/v2/gifs/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Referer: "https://www.redgifs.com/",
    },
    signal: AbortSignal.timeout(REDGIFS_TIMEOUT_MS),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const gif = data.gif;
  if (!gif || !gif.urls) return null;
  // `hd`/`sd` carry the audio track; the `silent` rendition is the muted cut.
  const url = gif.urls.hd || gif.urls.sd;
  return url ? { url, hasAudio: gif.hasAudio !== false } : null;
}

// --- Resolve embed posts to direct video URLs ---

async function resolvePost(post) {
  // Redgifs embeds → direct video
  if (post.type === "embed" && post.originalUrl) {
    const match = post.originalUrl.match(/redgifs\.com\/(?:watch|ifr)\/(\w+)/i);
    if (match) {
      try {
        const resolved = await resolveRedgifsUrl(match[1]);
        if (resolved) {
          return {
            ...post,
            type: "video",
            mediaUrl: resolved.url,
            hasAudio: resolved.hasAudio,
            // Kept so a direct file that will not play can fall back to the
            // player it came from, rather than the post being lost.
            embedUrl: post.mediaUrl,
          };
        }
      } catch (e) {
        // API failed — keep as embed fallback
      }
    }
  }
  return post;
}

// Resolve in place, publishing as each post lands. Promise.all over the whole
// batch made every post hostage to the slowest fetch — and one that hung took
// the entire broadcast with it, leaving every redgifs post on its muted embed
// player for the life of the session.
function resolvePostsInPlace(sess, offset) {
  const tasks = [];
  for (let i = offset; i < sess.posts.length; i++) {
    const index = i;
    const post = sess.posts[index];
    tasks.push(
      resolvePost(post)
        .then((resolved) => {
          if (session !== sess || resolved === post) return;
          sess.posts[index] = resolved;
          broadcastPosts(sess);
        })
        .catch(() => {
          // Resolution failed for this post — it keeps its embed fallback
        })
    );
  }
  return Promise.all(tasks);
}

// Posts resolve one at a time but arrive in bursts, so updates are coalesced
// into a single message rather than one per post.
const BROADCAST_DEBOUNCE_MS = 200;
let broadcastTimer = null;

function broadcastPosts(sess) {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (session !== sess) return;
    console.log(
      "[reddit-slideshow] broadcasting posts:",
      sess.posts.length,
      "types:",
      sess.posts.map((p) => p.type).join(",")
    );
    browser.runtime.sendMessage({ type: "postsUpdated", posts: sess.posts }).catch(() => {
      // No slideshow listening yet — it pulls the list itself on startup
    });
  }, BROADCAST_DEBOUNCE_MS);
}

// --- Message API ---

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case "startSlideshow":
      return handleStartSlideshow();
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

// The slideshow iframe loads (and requests state) while startSlideshow is
// still running — getCurrentState must wait for it, or it reads an empty session.
let startInFlight = null;

function handleStartSlideshow() {
  startInFlight = doStartSlideshow();
  return startInFlight;
}

async function doStartSlideshow() {
  session = {
    posts: [],
    currentIndex: 0,
    loading: false,
    exhausted: false,
    tabId: null,
  };

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) {
    return { error: "No active tab" };
  }

  session.tabId = tabs[0].id;

  try {
    const result = await browser.tabs.sendMessage(tabs[0].id, { type: "scrapeAndStart" });
    console.log("[reddit-slideshow] scrapeAndStart returned", result?.posts?.length, "posts");
    if (result && result.posts) {
      session.posts = result.posts;
      // Resolve redgifs lazily — never block slideshow startup on the redgifs
      // API. Until a post resolves it renders via the embed fallback, and each
      // one that lands is pushed to the slideshow, which snapshotted the list
      // before any of this finished.
      const sess = session;
      resolvePostsInPlace(sess, 0)
        .then(() => {
          if (session !== sess) return;
          console.log(
            "[reddit-slideshow] resolved posts:",
            sess.posts.length,
            "types:",
            sess.posts.map((p) => p.type).join(",")
          );
        })
        .catch((e) => {
          console.error("[reddit-slideshow] resolvePostsInPlace failed:", e);
        });
    }
    return { success: true, postCount: session.posts.length };
  } catch (e) {
    console.error("[reddit-slideshow] scrapeAndStart error:", e);
    session = null;
    return { error: "Could not start slideshow. Make sure you're on a Reddit page." };
  }
}

async function handleGetCurrentState() {
  if (startInFlight) {
    try {
      await startInFlight;
    } catch (e) {
      // Start failed — fall through to the session check below
    }
  }
  if (!session) {
    return { error: "No active session" };
  }
  return {
    posts: session.posts,
    currentIndex: session.currentIndex,
    exhausted: session.exhausted,
  };
}

async function handleGetPosts(message) {
  if (!session) return { error: "No active session" };

  const { startIndex, count } = message;

  if (startIndex + count >= session.posts.length - 5 && !session.loading && !session.exhausted) {
    session.loading = true;
    try {
      const result = await browser.tabs.sendMessage(session.tabId, { type: "loadMore" });
      if (result && result.posts) {
        const existingIds = new Set(session.posts.map((p) => p.id));
        const newPosts = result.posts.filter((p) => !existingIds.has(p.id));
        if (newPosts.length === 0) {
          session.exhausted = true;
        } else {
          // Appended first, resolved after: waiting on redgifs here would hold
          // up the refill the slideshow is already asking for.
          const offset = session.posts.length;
          session.posts.push(...newPosts);
          const sess = session;
          resolvePostsInPlace(sess, offset).catch(() => {
            // Individual failures are already handled per post
          });
        }
      }
    } catch (e) {
      session.exhausted = true;
    } finally {
      session.loading = false;
    }
  }

  return { posts: session.posts, total: session.posts.length, exhausted: session.exhausted };
}

async function handlePopOut(sender) {
  if (!session) return { error: "No active session" };

  const slideshowUrl = browser.runtime.getURL("slideshow/slideshow.html?mode=popout");
  await browser.windows.create({
    url: slideshowUrl,
    type: "popup",
    width: 1200,
    height: 800,
  });

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
      // Tab may have been closed
    }
  }
  session = null;
  return { success: true };
}

console.log("Reddit Slideshow background loaded");
