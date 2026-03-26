// Reddit Slideshow — content script (overlay + DOM scraping)

let overlayElement = null;
let savedOverflow = null;

// --- DOM scraping ---

// Known embed hosts and their embed URL patterns
const EMBED_HOSTS = {
  "redgifs.com": (url) => {
    const match = url.match(/redgifs\.com\/(?:watch|ifr)\/(\w+)/);
    return match ? `https://www.redgifs.com/ifr/${match[1]}` : null;
  },
  "youtube.com": (url) => {
    const match = url.match(/[?&]v=([\w-]+)/);
    return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1` : null;
  },
  "youtu.be": (url) => {
    const match = url.match(/youtu\.be\/([\w-]+)/);
    return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1` : null;
  },
  "gfycat.com": (url) => {
    const match = url.match(/gfycat\.com\/(\w+)/);
    return match ? `https://gfycat.com/ifr/${match[1]}` : null;
  },
  "streamable.com": (url) => {
    const match = url.match(/streamable\.com\/(\w+)/);
    return match ? `https://streamable.com/e/${match[1]}` : null;
  },
  "imgur.com": (url) => {
    // Imgur gifv or video
    if (/\.(gifv|mp4)$/i.test(url)) {
      return url.replace(/\.gifv$/i, ".mp4");
    }
    return null;
  },
};

function getEmbedUrl(contentHref) {
  try {
    const urlObj = new URL(contentHref);
    const hostname = urlObj.hostname.replace(/^www\./, "");
    for (const [host, transformer] of Object.entries(EMBED_HOSTS)) {
      if (hostname === host || hostname.endsWith("." + host)) {
        return transformer(contentHref);
      }
    }
  } catch (e) {
    // Invalid URL
  }
  return null;
}

function classifyPost(el) {
  const postType = el.getAttribute("post-type") || "";
  const contentHref = el.getAttribute("content-href") || "";

  // Image posts
  if (postType === "image" && contentHref) {
    return { type: "image", mediaUrl: contentHref };
  }

  // Check content-href for direct image URLs
  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(contentHref)) {
    return { type: "image", mediaUrl: contentHref };
  }

  // Reddit-hosted video
  if (postType === "video" || /v\.redd\.it/.test(contentHref)) {
    // Try to find video source in the DOM
    const video = el.querySelector("video source, video[src]");
    const videoSrc = video ? (video.getAttribute("src") || video.src) : null;
    if (videoSrc) {
      return { type: "video", mediaUrl: videoSrc };
    }
    // Fallback: construct HLS URL from v.redd.it link
    if (contentHref.includes("v.redd.it")) {
      return { type: "video", mediaUrl: contentHref + "/DASH_720.mp4" };
    }
  }

  // Check for embeddable links (redgifs, youtube, etc.)
  const embedUrl = getEmbedUrl(contentHref);
  if (embedUrl) {
    // Special case: imgur mp4 is a direct video
    if (embedUrl.endsWith(".mp4")) {
      return { type: "video", mediaUrl: embedUrl };
    }
    return { type: "embed", mediaUrl: embedUrl, originalUrl: contentHref };
  }

  // Gallery — grab first image from DOM
  if (postType === "gallery") {
    const img = el.querySelector(
      'img[src*="i.redd.it"], img[src*="preview.redd.it"]'
    );
    if (img) {
      return { type: "image", mediaUrl: img.src };
    }
  }

  // Fallback: any redd.it/imgur image in the post
  const img = el.querySelector(
    'img[src*="i.redd.it"], img[src*="preview.redd.it"], img[src*="i.imgur.com"], img[src*="external-preview"]'
  );
  if (img) {
    return { type: "image", mediaUrl: img.src };
  }

  return null;
}

function scrapePosts() {
  const posts = [];
  const seen = new Set();

  // New Reddit: <shreddit-post> elements
  document.querySelectorAll("shreddit-post").forEach((el) => {
    const id = el.getAttribute("id") || el.getAttribute("thingid");
    if (!id || seen.has(id)) return;
    seen.add(id);

    const classified = classifyPost(el);
    if (!classified) return;

    posts.push({
      id,
      title: el.getAttribute("post-title") || "",
      author: el.getAttribute("author") || "",
      subreddit: (el.getAttribute("subreddit-prefixed-name") || "").replace(/^r\//, ""),
      score: parseInt(el.getAttribute("score") || "0", 10),
      permalink: el.getAttribute("permalink") || "",
      type: classified.type,
      mediaUrl: classified.mediaUrl,
      originalUrl: classified.originalUrl || el.getAttribute("content-href") || "",
    });
  });

  // Old Reddit fallback
  if (posts.length === 0) {
    document.querySelectorAll('.thing[data-type="link"]').forEach((el) => {
      const id = el.getAttribute("data-fullname") || "";
      if (!id || seen.has(id)) return;
      seen.add(id);

      const dataUrl = el.getAttribute("data-url") || "";
      let type = "image";
      let mediaUrl = null;

      if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(dataUrl)) {
        mediaUrl = dataUrl;
      } else if (/\.(mp4|gifv)(\?.*)?$/i.test(dataUrl)) {
        type = "video";
        mediaUrl = dataUrl.replace(/\.gifv$/i, ".mp4");
      } else {
        const embedUrl = getEmbedUrl(dataUrl);
        if (embedUrl) {
          type = embedUrl.endsWith(".mp4") ? "video" : "embed";
          mediaUrl = embedUrl;
        }
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
          title: (el.querySelector("a.title") || {}).textContent || "",
          author: el.getAttribute("data-author") || "",
          subreddit: el.getAttribute("data-subreddit") || "",
          score: parseInt(el.getAttribute("data-score") || "0", 10),
          permalink: (el.querySelector("a.comments") || {}).getAttribute("href") || "",
          type,
          mediaUrl,
          originalUrl: dataUrl,
        });
      }
    });
  }

  return posts;
}

// --- Scroll to load more ---

async function scrollAndScrape() {
  const currentOverflow = document.body.style.overflow;
  document.body.style.overflow = "auto";

  const beforeCount = document.querySelectorAll(
    "shreddit-post, .thing[data-type='link']"
  ).length;

  window.scrollTo(0, document.body.scrollHeight);

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
  createOverlay();
  return { success: true, posts };
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
