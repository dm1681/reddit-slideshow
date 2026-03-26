// Reddit Slideshow — content script (overlay + DOM scraping)

let overlayElement = null;
let savedOverflow = null;

// --- DOM scraping ---

function scrapePosts() {
  const posts = [];
  const seen = new Set();

  // New Reddit: <shreddit-post> elements
  document.querySelectorAll("shreddit-post").forEach((el) => {
    const id = el.getAttribute("id") || el.getAttribute("thingid");
    if (!id || seen.has(id)) return;
    seen.add(id);

    const title = el.getAttribute("post-title") || "";
    const author = el.getAttribute("author") || "";
    const subreddit = (el.getAttribute("subreddit-prefixed-name") || "").replace(/^r\//, "");
    const score = parseInt(el.getAttribute("score") || "0", 10);
    const permalink = el.getAttribute("permalink") || "";
    const contentHref = el.getAttribute("content-href") || "";
    const postType = el.getAttribute("post-type") || "";

    // Determine image URL based on post-type attribute and content
    let mediaUrl = null;

    // post-type="image" — content-href is the direct image URL
    if (postType === "image" && contentHref) {
      mediaUrl = contentHref;
    }

    // Fallback: check content-href for image extensions
    if (!mediaUrl && /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(contentHref)) {
      mediaUrl = contentHref;
    }

    // Fallback: look for preview/full images inside the post element
    if (!mediaUrl) {
      const img = el.querySelector(
        'img[src*="i.redd.it"], img[src*="preview.redd.it"], img[src*="i.imgur.com"], img[src*="external-preview"]'
      );
      if (img) {
        mediaUrl = img.src;
      }
    }

    if (mediaUrl) {
      posts.push({
        id,
        title,
        author,
        subreddit,
        score,
        permalink,
        type: "image",
        mediaUrl,
        url: contentHref,
      });
    }
  });

  // Old Reddit: .thing elements
  if (posts.length === 0) {
    document.querySelectorAll('.thing[data-type="link"]').forEach((el) => {
      const id = el.getAttribute("data-fullname") || "";
      if (!id || seen.has(id)) return;
      seen.add(id);

      const title = (el.querySelector("a.title") || {}).textContent || "";
      const author = el.getAttribute("data-author") || "";
      const subreddit = el.getAttribute("data-subreddit") || "";
      const score = parseInt(el.getAttribute("data-score") || "0", 10);
      const permalink = (el.querySelector("a.comments") || {}).getAttribute("href") || "";
      const dataUrl = el.getAttribute("data-url") || "";

      let mediaUrl = null;
      if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(dataUrl)) {
        mediaUrl = dataUrl;
      }
      if (!mediaUrl) {
        const img = el.querySelector(
          'img[src*="i.redd.it"], img[src*="preview.redd.it"], img[src*="i.imgur.com"]'
        );
        if (img && img.src) {
          mediaUrl = img.src;
        }
      }

      if (mediaUrl) {
        posts.push({
          id,
          title,
          author,
          subreddit,
          score,
          permalink,
          type: "image",
          mediaUrl,
          url: dataUrl,
        });
      }
    });
  }

  return posts;
}

// --- Scroll to load more ---

async function scrollAndScrape() {
  // Temporarily allow scrolling if overlay is up
  const currentOverflow = document.body.style.overflow;
  document.body.style.overflow = "auto";

  const beforeCount = document.querySelectorAll(
    "shreddit-post, .thing[data-type='link']"
  ).length;

  // Scroll to bottom to trigger Reddit's infinite scroll
  window.scrollTo(0, document.body.scrollHeight);

  // Wait for new content to appear (up to 5 seconds)
  const posts = await new Promise((resolve) => {
    let attempts = 0;
    const check = setInterval(() => {
      const currentCount = document.querySelectorAll(
        "shreddit-post, .thing[data-type='link']"
      ).length;
      attempts++;
      if (currentCount > beforeCount || attempts > 10) {
        clearInterval(check);
        resolve(scrapePosts());
      }
    }, 500);
  });

  // Restore overflow
  document.body.style.overflow = currentOverflow;

  return posts;
}

// --- Overlay ---

function createOverlay() {
  if (overlayElement) return;

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

  savedOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
}

function removeOverlay() {
  if (!overlayElement) return;

  overlayElement.remove();
  overlayElement = null;
  document.body.style.overflow = savedOverflow;
}

// --- Message handling ---

browser.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "scrapeAndStart":
      return handleScrapeAndStart();
    case "loadMore":
      return handleLoadMore();
    case "hideOverlay":
      removeOverlay();
      return Promise.resolve({ success: true });
    default:
      return false;
  }
});

async function handleScrapeAndStart() {
  const posts = scrapePosts();
  await browser.runtime.sendMessage({ type: "postsScraped", posts });
  createOverlay();
  return { success: true, postCount: posts.length };
}

async function handleLoadMore() {
  const posts = await scrollAndScrape();
  return { posts };
}

// Listen for Escape key to close overlay
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlayElement) {
    browser.runtime.sendMessage({ type: "closeSlideshow" });
    removeOverlay();
  }
});
