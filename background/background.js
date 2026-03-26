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

console.log("Reddit Slideshow background loaded");
