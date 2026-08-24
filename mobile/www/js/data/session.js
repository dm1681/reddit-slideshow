// The session source: posts captured from a real, signed-in Reddit tab by
// tools/reddit-scrape-probe.js and handed to the local server's bridge.
//
// This is the only route to live content that works (see the research doc):
// Reddit's public endpoints answer scripted clients with a bot check, so the
// posts have to come from a session a human cleared. The probe runs the
// extension's own scraper, so what arrives here is already the extension's
// post shape — this module's job is to translate that into the shape Reel's
// renderers expect, and to resolve Reddit-hosted video to something a <video>
// element can actually play.
const PAGE_SIZE = 8;

// A bare v.redd.it base carries no playable file; the rendition has to be read
// out of the DASH manifest (filenames cannot be guessed — Reddit renamed
// DASH_<res>.mp4 to CMAF_<res>.mp4 and guesses 403). The manifest fetch is
// cross-origin, so it goes through the local server rather than the page.
const BARE_VREDDIT = /^https?:\/\/v\.redd\.it\/[\w-]+\/?$/;

async function resolveVideo(post) {
  if (post.type !== "video" || !BARE_VREDDIT.test(post.mediaUrl || "")) return post;
  try {
    const resp = await fetch(`media/vreddit?u=${encodeURIComponent(post.mediaUrl)}`);
    if (!resp.ok) throw new Error(String(resp.status));
    const data = await resp.json();
    if (!data.url) throw new Error("no rendition");
    // Reddit's DASH keeps audio in a separate stream, so a rendition on its
    // own is silent. Said plainly here so the player never promises sound it
    // cannot deliver, and never waits for a gesture to unmute nothing.
    return { ...post, mediaUrl: data.url, hasAudio: false };
  } catch (e) {
    // Unplayable as a video — shown as a link card rather than a broken frame.
    return { ...post, type: "link", mediaUrl: null };
  }
}

// The extension's post shape predates Reel's renderers: it has an "embed" type
// (a cross-origin player, which does not belong in a swipe feed) and no
// text/link distinction. Everything else carries over untouched — including
// the nsfw/spoiler flags, which are only ever read, never cleared.
function adapt(post) {
  let type = post.type;
  let mediaUrl = post.mediaUrl || null;

  if (type === "embed") {
    type = "link";
    mediaUrl = null;
  } else if (!mediaUrl) {
    type = post.selftext ? "text" : "link";
  }

  let domain = post.domain || "";
  if (!domain && post.originalUrl) {
    try {
      domain = new URL(post.originalUrl).hostname.replace(/^www\./, "");
    } catch (e) {
      domain = "";
    }
  }

  // The extension expands a gallery into one post per image and encodes the
  // position in the title as "(2/3)"; keep that visible as Reel's chip.
  const gallery = /\((\d+)\/(\d+)\)\s*$/.exec(post.title || "");

  return {
    ...post,
    type,
    mediaUrl,
    domain,
    linkPreview: post.thumbnail || "",
    galleryIndex: gallery ? Number(gallery[1]) : null,
    galleryCount: gallery ? Number(gallery[2]) : null,
  };
}

export function createSessionSource() {
  let all = null;
  let capturedAt = null;
  let label = "session";

  async function load() {
    if (all) return all;
    const resp = await fetch("session/feed");
    if (!resp.ok) throw new Error(`session bridge returned ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data.posts) || data.posts.length === 0) {
      throw new Error("no session feed captured yet — run the probe first");
    }
    all = data.posts.map(adapt);
    capturedAt = data.capturedAt;
    label = data.source || "session";
    return all;
  }

  return {
    id: "session",
    get label() {
      return label;
    },
    isDemo: false,
    get capturedAt() {
      return capturedAt;
    },

    async page(after) {
      const posts = await load();
      const start = after ? parseInt(after, 10) : 0;
      const slice = posts.slice(start, start + PAGE_SIZE);
      const resolved = await Promise.all(slice.map(resolveVideo));
      const next = start + PAGE_SIZE;
      return { posts: resolved, after: next < posts.length ? String(next) : null };
    },

    // Writes would need the Reddit session this app does not hold; the probe
    // only reads. Saying so beats a button that silently does nothing.
    async vote() {
      return { error: "Voting needs the Reddit tab — captured feeds are read-only" };
    },
    async save() {
      return { error: "Saving needs the Reddit tab — captured feeds are read-only" };
    },
  };
}
