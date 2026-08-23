// URL → media classification. Ported from the extension's content/overlay.js;
// pure functions, no DOM.

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
  "streamable.com": (url) => {
    const match = url.match(/streamable\.com\/(\w+)/);
    return match ? `https://streamable.com/e/${match[1]}` : null;
  },
  "imgur.com": (url) => {
    if (/\.(gifv|mp4)$/i.test(url)) {
      return url.replace(/\.gifv$/i, ".mp4");
    }
    return null;
  },
};

export function getEmbedUrl(contentHref) {
  try {
    const urlObj = new URL(contentHref, "https://www.reddit.com/");
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

// What a URL on its own says about the media. Returns null when it says
// nothing — the caller falls back to previews or a link card.
export function classifyUrl(url) {
  if (!url) return null;

  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(url)) {
    return { type: "image", mediaUrl: url };
  }

  // Bare v.redd.it base URL with no reddit_video block to go with it. The
  // renditions cannot be guessed (the DASH_* → CMAF_* rename 403'd every
  // guessed filename), so this stays a link card unless the listing gave us
  // the real URLs.
  if (/v\.redd\.it/.test(url)) {
    return null;
  }

  const embedUrl = getEmbedUrl(url);
  if (embedUrl) {
    if (embedUrl.endsWith(".mp4")) {
      // A .gifv is a gif imgur re-encoded as mp4 — silent, looping. A bare
      // .mp4 could genuinely carry audio, so it is left alone.
      if (/\.gifv(\?|$)/i.test(url)) {
        return { type: "video", mediaUrl: embedUrl, isGif: true, hasAudio: false };
      }
      return { type: "video", mediaUrl: embedUrl };
    }
    // Cross-origin embed players don't fit a swipe feed; shown as a link card
    // that opens the original.
    return { type: "link", mediaUrl: null, originalUrl: url };
  }

  return null;
}
