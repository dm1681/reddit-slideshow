// Reddit listing JSON → the app's post shape. This replaces the extension's
// whole DOM-scraping pipeline: one listing response carries everything the
// scrape + info.json + per-post fetches used to assemble.
//
// Post shape (the extension's, minus scrape-only fields):
//   { id, redditId, title, author, subreddit, score, permalink,
//     nsfw, spoiler, type: image|video|text|link, mediaUrl, poster?,
//     isGif?, hasAudio?, selftext, numComments, createdUtc, flair,
//     thumbnail, domain, originalUrl }
// Galleries expand to one post per image; every expanded item keeps the same
// redditId, so acting on one acts on all of them.
import { classifyUrl } from "./classify.js";

// nsfw/spoiler are only ever added, never cleared: whichever source says
// "adult" wins, and two silent sources must not read as "safe". On mobile the
// sources are the listing item and (for crossposts) the wrapper around it.
export function withFlags(post, data) {
  return {
    ...post,
    nsfw: post.nsfw === true || (data && data.over_18 === true),
    spoiler: post.spoiler === true || (data && data.spoiler === true),
  };
}

// gallery_data holds the order, media_metadata the URLs. `e` is Reddit's own
// declaration of what an item is, which beats sniffing the extension — an
// animated item delivered as mp4 is a silent looping gif, not a video.
function galleryItems(data) {
  const items = data && data.gallery_data && data.gallery_data.items;
  const meta = data && data.media_metadata;
  if (!Array.isArray(items) || !meta) return [];

  return items
    .map((item) => {
      const entry = meta[item.media_id];
      const source = entry && entry.s;
      if (!source) return null;
      const animated = entry.e === "AnimatedImage" || !!(source.mp4 || source.gif);
      const url = animated
        ? source.mp4 || source.gif || source.u
        : source.u || source.mp4 || source.gif;
      return url ? { url, animated } : null;
    })
    .filter(Boolean);
}

// One post per image: the feed shows one thing at a time, so a gallery that
// stayed a single post would show only its first image.
function expandGallery(post, items) {
  const multiple = items.length > 1;
  return items.map((item, i) => {
    const asMp4 = /\.mp4(\?|$)/i.test(item.url);
    // A Reddit gallery cannot contain audio at all, so this is asserted
    // rather than guessed.
    const isGif = item.animated && asMp4;
    return {
      ...post,
      id: multiple ? `${post.id}-${i + 1}` : post.id,
      galleryIndex: multiple ? i + 1 : null,
      galleryCount: multiple ? items.length : null,
      type: asMp4 ? "video" : "image",
      mediaUrl: item.url,
      ...(isGif ? { isGif: true, hasAudio: false } : {}),
    };
  });
}

// preview.redd.it URLs are signed and expire; the smallest rendition is all a
// placeholder needs. `thumbnail` is sometimes a placeholder word, not a URL.
function previewThumbnail(d) {
  const images = d && d.preview && d.preview.images;
  const first = Array.isArray(images) && images[0];
  const resolutions = first && first.resolutions;
  if (Array.isArray(resolutions) && resolutions.length) {
    const smallest = resolutions.reduce((a, b) => ((a.width || 0) <= (b.width || 0) ? a : b));
    if (smallest && smallest.url) return smallest.url;
  }
  return /^https?:|^demo\//.test(d.thumbnail || "") ? d.thumbnail : "";
}

function previewSource(d) {
  const images = d && d.preview && d.preview.images;
  const first = Array.isArray(images) && images[0];
  return (first && first.source && first.source.url) || "";
}

function base(d) {
  return {
    id: d.name,
    redditId: d.name,
    title: d.title || "",
    author: d.author || "",
    subreddit: d.subreddit || "",
    score: typeof d.score === "number" ? d.score : 0,
    permalink: d.permalink || "",
    nsfw: d.over_18 === true,
    spoiler: d.spoiler === true,
    saved: d.saved === true,
    likes: d.likes === undefined ? null : d.likes,
    selftext: typeof d.selftext === "string" ? d.selftext : "",
    numComments: typeof d.num_comments === "number" ? d.num_comments : null,
    createdUtc: typeof d.created_utc === "number" ? d.created_utc : null,
    flair: d.link_flair_text || "",
    thumbnail: previewThumbnail(d),
    domain: d.domain || "",
    originalUrl: d.url || "",
    galleryIndex: null,
    galleryCount: null,
  };
}

// Media resolution for one listing item. `canHls` is the platform's answer to
// canPlayType('application/vnd.apple.mpegurl'): iOS/Android WebViews play HLS
// natively and get the stream with audio; a browser that cannot gets the
// fallback MP4, which for v.redd.it is video-only by construction — renditions
// are never guessed from filenames (the DASH_*→CMAF_* rename 403'd guesses).
function classifyListing(d, { canHls }) {
  const rv = d.secure_media && d.secure_media.reddit_video;
  if (rv && (rv.hls_url || rv.fallback_url)) {
    const useHls = canHls && rv.hls_url;
    return {
      type: "video",
      mediaUrl: useHls ? rv.hls_url : rv.fallback_url || rv.hls_url,
      ...(rv.is_gif ? { isGif: true, hasAudio: false } : {}),
      ...(!useHls && !rv.is_gif ? { hasAudio: false } : {}),
      duration: typeof rv.duration === "number" ? rv.duration : null,
    };
  }

  if (d.is_self) {
    return { type: "text", mediaUrl: null };
  }

  const byUrl = classifyUrl(d.url || "");
  if (byUrl && byUrl.type !== "link") return byUrl;

  if (d.post_hint === "image") {
    return { type: "image", mediaUrl: d.url };
  }

  // Anything left renders as a link card: external article, embed host,
  // unknown. The preview image (when Reddit has one) is the card's art.
  return {
    type: "link",
    mediaUrl: null,
    linkPreview: previewSource(d),
  };
}

function normalizeChild(d, opts) {
  // Crossposts carry no media of their own; the parent has it. The wrapper
  // can be tame while the post it points at is not, so flags merge OR-wise.
  const parent = Array.isArray(d.crosspost_parent_list) && d.crosspost_parent_list[0];
  if (parent) {
    const inner = normalizeChild({ ...parent, name: d.name }, opts);
    return inner.map((post) =>
      withFlags(
        { ...post, subreddit: d.subreddit || post.subreddit, permalink: d.permalink || post.permalink },
        d
      )
    );
  }

  const post = base(d);

  const gallery = galleryItems(d);
  if (gallery.length) {
    return expandGallery(post, gallery);
  }

  return [{ ...post, ...classifyListing(d, opts) }];
}

// Listing response → { posts, after }. Children that aren't posts (t5s in a
// mixed listing, promos) are dropped.
export function normalizeListing(listing, opts = {}) {
  const data = (listing && listing.data) || {};
  const children = Array.isArray(data.children) ? data.children : [];
  const posts = children
    .filter((c) => c && c.kind === "t3" && c.data && c.data.name)
    .flatMap((c) => normalizeChild(c.data, opts));
  return { posts, after: data.after || null };
}

export function detectHls() {
  try {
    const v = document.createElement("video");
    return v.canPlayType("application/vnd.apple.mpegurl") !== "";
  } catch (e) {
    return false;
  }
}
