// The bundled demo source. Serves the fixture listing through the SAME
// normalize pipeline a real listing takes — only the transport is fake. Pages
// are deliberately small so the infinite-feed plumbing (prefetch, honest
// "n / total+" counter, end-of-queue) is exercised with 8 posts.
import { normalizeListing } from "../core/normalize.js";

const PAGE_SIZE = 3;
const PAGE_DELAY_MS = 350;

export function createDemoSource({ canHls }) {
  let children = null;

  async function loadFixture() {
    if (children) return children;
    const resp = await fetch("demo/feed.json");
    const listing = await resp.json();
    children = listing.data.children;

    // The fixture's timestamps are frozen; shift them so the newest post
    // always reads "3h" and the rest keep their relative ages.
    const newest = Math.max(...children.map((c) => c.data.created_utc || 0));
    const shift = Date.now() / 1000 - 3 * 3600 - newest;
    children.forEach((c) => {
      if (c.data.created_utc) c.data.created_utc += shift;
    });
    return children;
  }

  return {
    id: "demo",
    label: "demo feed",
    isDemo: true,

    // after: index of the next wire child to serve, as a string cursor.
    async page(after) {
      const all = await loadFixture();
      const start = after ? parseInt(after, 10) : 0;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      const slice = all.slice(start, start + PAGE_SIZE);
      let { posts } = normalizeListing(
        { data: { children: slice, after: null } },
        { canHls }
      );
      // The normalizer rightly marks fallback-URL videos silent — real
      // v.redd.it fallback MP4s carry no audio track. The demo files DO (they
      // stand in for the HLS stream a device would get), so correct the flag
      // here, in the transport, not in the shared pipeline.
      posts = posts.map((p) =>
        p.type === "video" && !p.isGif ? { ...p, hasAudio: true } : p
      );
      const next = start + PAGE_SIZE;
      return { posts, after: next < all.length ? String(next) : null };
    },

    // Writes are local-only in demo mode; they resolve so the optimistic UI
    // settles, and none of it goes anywhere.
    async vote() {
      await new Promise((r) => setTimeout(r, 200));
      return { success: true };
    },
    async save() {
      await new Promise((r) => setTimeout(r, 200));
      return { success: true };
    },
  };
}
