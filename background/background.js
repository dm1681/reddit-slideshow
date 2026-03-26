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
  return (data.gif && data.gif.urls && (data.gif.urls.hd || data.gif.urls.sd)) || null;
}

// --- Resolve embed posts to direct video URLs ---

async function resolvePost(post) {
  // Redgifs embeds → direct video
  if (post.type === "embed" && post.originalUrl) {
    const match = post.originalUrl.match(/redgifs\.com\/(?:watch|ifr)\/(\w+)/i);
    if (match) {
      try {
        const mp4Url = await resolveRedgifsUrl(match[1]);
        if (mp4Url) {
          return { ...post, type: "video", mediaUrl: mp4Url };
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

async function handleStartSlideshow() {
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
      try {
        session.posts = await resolvePosts(result.posts);
        console.log("[reddit-slideshow] resolved posts:", session.posts.length, "types:", session.posts.map(p => p.type).join(","));
      } catch (e) {
        console.error("[reddit-slideshow] resolvePosts failed:", e);
        session.posts = result.posts;
      }
    }
    return { success: true, postCount: session.posts.length };
  } catch (e) {
    console.error("[reddit-slideshow] scrapeAndStart error:", e);
    session = null;
    return { error: "Could not start slideshow. Make sure you're on a Reddit page." };
  }
}

async function handleGetCurrentState() {
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
