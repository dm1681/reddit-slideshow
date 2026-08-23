// The real Reddit source. Listing reads work signed-out over the public JSON
// endpoints; votes/saves need OAuth, which is deliberately NOT built yet —
// registration is gated on the Responsible Builder question in
// docs/superpowers/specs/2026-08-23-mobile-tiktok-client-research.md.
//
// In the packaged app, Capacitor's native HTTP (CapacitorHttp) patches
// window.fetch to native networking, which is what makes reddit.com reachable
// at all — a plain web origin is CORS-blocked. In a desktop browser this
// source only works behind a proxy, so the app falls back to demo mode when
// the first page fails.
import { normalizeListing } from "../core/normalize.js";

const LIMIT = 25;

export function createRedditSource({ canHls, subreddit }) {
  const base = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}.json`;

  return {
    id: `r/${subreddit}`,
    label: `r/${subreddit}`,
    isDemo: false,

    async page(after) {
      const url = new URL(base);
      url.searchParams.set("raw_json", "1");
      url.searchParams.set("limit", String(LIMIT));
      if (after) url.searchParams.set("after", after);

      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) {
        throw new Error(`Reddit returned ${resp.status}`);
      }
      const listing = await resp.json();
      return {
        ...normalizeListing(listing, { canHls }),
      };
    },

    async vote() {
      return { error: "Voting needs Reddit sign-in — not built yet (API registration pending)" };
    },
    async save() {
      return { error: "Saving needs Reddit sign-in — not built yet (API registration pending)" };
    },
  };
}
