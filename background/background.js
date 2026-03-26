// Reddit Slideshow — background script (state relay, no external API calls)

// --- Session state ---

let session = null;

// --- Message API ---

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case "startSlideshow":
      return handleStartSlideshow();
    case "postsScraped":
      return handlePostsScraped(message);
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
  // Create fresh session
  session = {
    posts: [],
    currentIndex: 0,
    loading: false,
    exhausted: false,
    tabId: null,
  };

  // Tell the content script to scrape posts and show the overlay
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) {
    return { error: "No active tab" };
  }

  session.tabId = tabs[0].id;

  try {
    const result = await browser.tabs.sendMessage(tabs[0].id, { type: "scrapeAndStart" });
    return { success: true, postCount: session.posts.length };
  } catch (e) {
    session = null;
    return { error: "Could not start slideshow. Make sure you're on a Reddit page." };
  }
}

function handlePostsScraped(message) {
  if (!session) return Promise.resolve({ error: "No active session" });

  const { posts } = message;
  // Deduplicate and append
  const existingIds = new Set(session.posts.map((p) => p.id));
  const newPosts = posts.filter((p) => !existingIds.has(p.id));
  session.posts.push(...newPosts);

  return Promise.resolve({ success: true, total: session.posts.length });
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

  // If near the end, ask content script to scroll and scrape more
  if (startIndex + count >= session.posts.length - 5 && !session.loading && !session.exhausted) {
    session.loading = true;
    try {
      const result = await browser.tabs.sendMessage(session.tabId, { type: "loadMore" });
      if (result && result.posts) {
        const existingIds = new Set(session.posts.map((p) => p.id));
        const newPosts = result.posts.filter((p) => !existingIds.has(p.id));
        if (newPosts.length === 0) {
          // No new posts found after scrolling — likely exhausted
          session.exhausted = true;
        } else {
          session.posts.push(...newPosts);
        }
      }
    } catch (e) {
      // Content script may be gone — mark exhausted
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
