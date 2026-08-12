// Reddit Slideshow — background script

// --- Session state ---

let session = null;

// --- Redgifs API (resolve direct MP4 URLs) ---

let redgifsToken = null;
let redgifsTokenExpiry = 0;

async function getRedgifsToken() {
  if (redgifsToken && Date.now() < redgifsTokenExpiry) {
    return redgifsToken;
  }
  const resp = await fetch("https://api.redgifs.com/v2/auth/temporary");
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
          return { ...post, type: "video", mediaUrl: resolved.url, hasAudio: resolved.hasAudio };
        }
      } catch (e) {
        // API failed — keep as embed fallback
      }
    }
  }
  return post;
}

async function resolvePosts(posts) {
  return Promise.all(posts.map(resolvePost));
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
      // API (it can be slow or hang; the fetches have no timeout). Until
      // resolution lands, redgifs posts render via the embed fallback.
      const sess = session;
      resolvePosts(result.posts)
        .then((resolved) => {
          if (session === sess) {
            session.posts = resolved;
            console.log("[reddit-slideshow] resolved posts:", resolved.length, "types:", resolved.map(p => p.type).join(","));
            // The slideshow snapshots posts when it loads, which happens before
            // this resolution lands — without the push it would keep showing
            // redgifs through the muted embed player for the whole first batch.
            browser.runtime
              .sendMessage({ type: "postsUpdated", posts: resolved })
              .catch(() => {
                // No slideshow listening (closed or not open yet) — harmless
              });
          }
        })
        .catch((e) => {
          console.error("[reddit-slideshow] resolvePosts failed:", e);
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
        let newPosts = result.posts.filter((p) => !existingIds.has(p.id));
        if (newPosts.length === 0) {
          session.exhausted = true;
        } else {
          newPosts = await resolvePosts(newPosts);
          session.posts.push(...newPosts);
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
