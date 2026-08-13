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

// What a URL on its own says about the media — no DOM, so it can be applied
// to a post's own content-href or to a link found inside it.
function classifyUrl(url) {
  if (!url) return null;

  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) {
    return { type: "image", mediaUrl: url };
  }

  // Bare v.redd.it base URL — the video renderer resolves the actual rendition
  // from DASHPlaylist.mpd. Filenames can't be guessed: Reddit renamed
  // DASH_<res>.mp4 to CMAF_<res>.mp4 and direct guesses 403.
  if (/v\.redd\.it/.test(url)) {
    return { type: "video", mediaUrl: url.replace(/\/+$/, "") };
  }

  const embedUrl = getEmbedUrl(url);
  if (embedUrl) {
    // Special case: imgur mp4 is a direct video
    if (embedUrl.endsWith(".mp4")) {
      return { type: "video", mediaUrl: embedUrl };
    }
    return { type: "embed", mediaUrl: embedUrl, originalUrl: url };
  }

  return null;
}

// A real https video src in the DOM (e.g. packaged-media) plays directly.
// Reddit's own player uses blob: MSE URLs — useless outside the page.
function findPlayableVideo(el) {
  const video = el.querySelector("video source, video[src]");
  const src = video ? video.getAttribute("src") || video.src : null;
  return src && /^https?:/.test(src) ? { type: "video", mediaUrl: src } : null;
}

function classifyPost(el) {
  const postType = el.getAttribute("post-type") || "";
  const contentHref = el.getAttribute("content-href") || "";

  // Image posts
  if (postType === "image" && contentHref) {
    return { type: "image", mediaUrl: contentHref };
  }

  // Checked before the URL: for a Reddit-hosted video a real https src in the
  // DOM beats the bare v.redd.it base, which costs the renderer a manifest
  // fetch to resolve.
  if (postType === "video" || /v\.redd\.it/.test(contentHref)) {
    const direct = findPlayableVideo(el);
    if (direct) return direct;
  }

  const byHref = classifyUrl(contentHref);
  if (byHref) return byHref;

  // Some wrappers keep the media a level down — the embedded copy's own
  // content-href, or a plain link to the host.
  for (const node of el.querySelectorAll("[content-href], a[href]")) {
    const href = node.getAttribute("content-href") || node.getAttribute("href") || "";
    if (!href || href === contentHref) continue;
    const nested = classifyUrl(href);
    if (nested) return nested;
  }

  const embedded = findPlayableVideo(el);
  if (embedded) return embedded;

  // Crossposts point content-href at the ORIGINAL post's permalink and carry
  // no media at all — the DOM holds only links and community icons. They used
  // to be dropped silently. Flagged here, fetched in resolvePendingPosts.
  if (postType === "crosspost" && /^(https?:\/\/[^/]*reddit\.com)?\/r\//.test(contentHref)) {
    return { type: "crosspost", mediaUrl: null, crosspostHref: contentHref };
  }

  // Galleries keep their image list in the post's JSON, not the DOM. Flagged
  // before the image fallback below, which would otherwise reduce a whole
  // gallery to whichever preview thumbnail happened to be rendered.
  if (postType === "gallery" || /reddit\.com\/gallery\//.test(contentHref)) {
    const galleryHref = el.getAttribute("permalink") || contentHref;
    if (galleryHref) {
      return { type: "gallery", mediaUrl: null, galleryHref };
    }
  }

  // Fallback: find best image in the post DOM
  // Prefer i.redd.it (direct CDN, stable) over preview.redd.it (resized, has auth tokens)
  const directImg = el.querySelector('img[src*="i.redd.it"]');
  if (directImg) {
    return { type: "image", mediaUrl: directImg.src };
  }
  const previewImg = el.querySelector(
    'img[src*="preview.redd.it"], img[src*="i.imgur.com"], img[src*="external-preview"]'
  );
  if (previewImg) {
    return { type: "image", mediaUrl: previewImg.src };
  }

  return null;
}

function scrapePosts() {
  const posts = [];
  const seen = new Set();
  // Posts the classifier could not place. They are dropped from the slideshow
  // entirely, so they are reported rather than vanishing without a trace.
  const skipped = [];

  // New Reddit: <shreddit-post> elements
  document.querySelectorAll("shreddit-post").forEach((el) => {
    const id = el.getAttribute("id") || el.getAttribute("thingid");
    if (!id || seen.has(id)) return;
    seen.add(id);

    const classified = classifyPost(el);
    if (!classified) {
      // The URLs it did find are reported too: without them there is no way to
      // tell a post with no media from one whose media is somewhere unexpected.
      const candidates = [...el.querySelectorAll("[content-href], a[href], img[src], source[src], video[src]")]
        .map((n) => n.getAttribute("content-href") || n.getAttribute("href") || n.getAttribute("src"))
        .filter(Boolean)
        .slice(0, 8);
      skipped.push(
        `u/${el.getAttribute("author") || "?"} post-type=${el.getAttribute("post-type") || "?"} ` +
          `href=${el.getAttribute("content-href") || "(none)"}\n      found: ${candidates.join("\n      found: ") || "(nothing)"}`
      );
      return;
    }

    posts.push({
      id,
      // The slideshow's id can drift from Reddit's — a gallery becomes one
      // post per image — so the thing Reddit knows it by is kept separately.
      redditId: id,
      title: el.getAttribute("post-title") || "",
      author: el.getAttribute("author") || "",
      subreddit: (el.getAttribute("subreddit-prefixed-name") || "").replace(/^r\//, ""),
      score: parseInt(el.getAttribute("score") || "0", 10),
      permalink: el.getAttribute("permalink") || "",
      type: classified.type,
      mediaUrl: classified.mediaUrl,
      originalUrl: classified.originalUrl || el.getAttribute("content-href") || "",
      // Carried only until resolvePendingPosts fills in the real media from
      // the post's JSON, and stripped there.
      ...(classified.crosspostHref ? { crosspostHref: classified.crosspostHref } : {}),
      ...(classified.galleryHref ? { galleryHref: classified.galleryHref } : {}),
    });
  });

  if (skipped.length) {
    console.log(
      `[reddit-slideshow] scraped ${posts.length} posts, skipped ${skipped.length} the classifier could not place:\n  ` +
        skipped.join("\n  ")
    );
  }

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
          redditId: id,
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

// --- Posts whose media only exists in Reddit's JSON ---

// Crossposts and galleries carry no usable media in the DOM. Their JSON is
// same-origin from here, so the request goes out with the viewer's own cookies
// — which is what makes it work at all for subreddits that need an account.
// Doing this from the background would lose them.
const JSON_TIMEOUT_MS = 8000;

async function fetchPostJson(href) {
  // Absolute, deliberately: a content script's fetch does not resolve a
  // relative URL against the page the way the page itself would — it throws.
  const url = new URL(href, location.origin);
  const jsonUrl = `${url.origin}${url.pathname.replace(/\/?$/, "/")}.json?raw_json=1`;
  const resp = await fetch(jsonUrl, {
    credentials: "include",
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  });
  if (!resp.ok) return null;

  const data = await resp.json();
  const child =
    data && data[0] && data[0].data && data[0].data.children && data[0].data.children[0];
  return child && child.data ? child.data : null;
}

// gallery_data holds the order, media_metadata the URLs. `s` is the source
// rendition: `u` for stills, `gif`/`mp4` for animated ones.
function galleryMediaUrls(data) {
  const items = data && data.gallery_data && data.gallery_data.items;
  const meta = data && data.media_metadata;
  if (!Array.isArray(items) || !meta) return [];

  return items
    .map((item) => {
      const entry = meta[item.media_id];
      const source = entry && entry.s;
      return source ? source.u || source.mp4 || source.gif || null : null;
    })
    .filter(Boolean);
}

// One post per image: a slideshow shows one thing at a time, so a gallery that
// stayed a single post would show only its first image.
function expandGallery(post, urls) {
  const { crosspostHref, galleryHref, ...rest } = post;
  const multiple = urls.length > 1;

  return urls.map((url, i) => ({
    ...rest,
    id: multiple ? `${post.id}-${i + 1}` : post.id,
    title: multiple ? `${post.title} (${i + 1}/${urls.length})` : post.title,
    type: /\.mp4(\?|$)/i.test(url) ? "video" : "image",
    mediaUrl: url,
  }));
}

async function resolveCrosspost(post) {
  try {
    const original = await fetchPostJson(post.crosspostHref);
    if (!original) return null;

    // The original may itself be a gallery.
    const gallery = galleryMediaUrls(original);
    if (gallery.length) return expandGallery(post, gallery);

    const classified = classifyUrl(original.url || "");
    if (!classified) return null;

    const { crosspostHref, ...rest } = post;
    return { ...rest, ...classified };
  } catch (e) {
    // Unreachable or not JSON — the post is dropped rather than shown broken
    return null;
  }
}

async function resolveGallery(post) {
  try {
    const data = await fetchPostJson(post.galleryHref);
    if (!data) return null;

    const urls = galleryMediaUrls(data);
    if (!urls.length) return null;

    return expandGallery(post, urls);
  } catch (e) {
    return null;
  }
}

async function resolvePendingPosts(posts) {
  const resolved = await Promise.all(
    posts.map((post) => {
      if (post.type === "crosspost") return resolveCrosspost(post);
      if (post.type === "gallery") return resolveGallery(post);
      return post;
    })
  );

  // flat(): a gallery resolves to one post per image.
  const kept = resolved.filter(Boolean).flat();
  const lost = posts.filter(
    (p, i) => (p.type === "crosspost" || p.type === "gallery") && !resolved[i]
  ).length;
  if (lost) console.log(`[reddit-slideshow] ${lost} post(s) could not be resolved from JSON`);
  return kept;
}

// --- Reddit actions (save, vote) ---

// Done from the content script because this is the only place that has the
// viewer's session: the requests are same-origin and carry their cookies. The
// legacy endpoints want a modhash, which /api/me.json hands out for the price
// of one request per page.
let modhashPromise = null;

function getModhash() {
  if (!modhashPromise) {
    modhashPromise = fetch(`${location.origin}/api/me.json`, {
      credentials: "include",
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    })
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => (data && data.data && data.data.modhash) || null)
      .catch(() => null);
  }
  return modhashPromise;
}

async function redditAction(path, params) {
  try {
    const modhash = await getModhash();
    if (!modhash) return { error: "Not signed in to Reddit" };

    const resp = await fetch(`${location.origin}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Modhash": modhash,
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });

    if (!resp.ok) {
      // A stale modhash is worth one more try with a fresh one.
      modhashPromise = null;
      return { error: `Reddit returned ${resp.status}` };
    }
    return { success: true };
  } catch (e) {
    return { error: "Could not reach Reddit" };
  }
}

function handleSavePost(message) {
  if (!message.id) return Promise.resolve({ error: "No post id" });
  return redditAction(message.saved ? "/api/save" : "/api/unsave", { id: message.id });
}

function handleVotePost(message) {
  if (!message.id) return Promise.resolve({ error: "No post id" });
  return redditAction("/api/vote", { id: message.id, dir: String(message.dir) });
}

// Whether the viewer has already saved or voted on these posts. One request
// covers a whole batch — /api/info.json takes up to 100 ids — so the slideshow
// can show the real state instead of guessing.
const INFO_BATCH_SIZE = 100;

async function attachUserState(posts) {
  const ids = [...new Set(posts.map((p) => p.redditId).filter((id) => /^t3_\w+$/.test(id)))];
  if (!ids.length) return posts;

  const state = new Map();
  for (let i = 0; i < ids.length; i += INFO_BATCH_SIZE) {
    const batch = ids.slice(i, i + INFO_BATCH_SIZE);
    try {
      const resp = await fetch(
        `${location.origin}/api/info.json?id=${batch.join(",")}&raw_json=1`,
        { credentials: "include", signal: AbortSignal.timeout(JSON_TIMEOUT_MS) }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      const children = (data && data.data && data.data.children) || [];
      children.forEach((child) => {
        const d = child.data || {};
        state.set(d.name, { saved: d.saved === true, likes: d.likes === undefined ? null : d.likes });
      });
    } catch (e) {
      // Not signed in, or Reddit is unhappy — the buttons still work, they
      // just start from an unknown state.
    }
  }

  return posts.map((post) => {
    const found = state.get(post.redditId);
    return found ? { ...post, ...found } : post;
  });
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
    case "savePost":
      return handleSavePost(message);
    case "votePost":
      return handleVotePost(message);
    case "hideOverlay":
      removeOverlay();
      return Promise.resolve({ success: true });
    default:
      return false;
  }
});

async function handleScrapeAndStart() {
  const posts = await attachUserState(await resolvePendingPosts(scrapePosts()));
  createOverlay();
  return { success: true, posts };
}

async function handleLoadMore() {
  const posts = await attachUserState(await resolvePendingPosts(await scrollAndScrape()));
  return { posts };
}

// Listen for Escape key to close overlay
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlayElement) {
    browser.runtime.sendMessage({ type: "closeSlideshow" });
    removeOverlay();
  }
});
