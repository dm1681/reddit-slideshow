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

// In the packaged app, CapacitorHttp makes a direct reddit.com fetch work; in
// a browser (LAN/Tailscale self-host) the same fetch is CORS-blocked, so the
// serve.mjs host proxies listings at /reddit/ and we go same-origin.
function isNative() {
  return !!(
    typeof window !== "undefined" &&
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform()
  );
}

export function createRedditSource({ canHls, subreddit }) {
  const sub = encodeURIComponent(subreddit);
  const base = isNative()
    ? `https://www.reddit.com/r/${sub}.json`
    : `reddit/r/${sub}.json`;

  return {
    id: `r/${subreddit}`,
    label: `r/${subreddit}`,
    isDemo: false,

    async page(after) {
      const query = new URLSearchParams({ raw_json: "1", limit: String(LIMIT) });
      if (after) query.set("after", after);

      const resp = await fetch(`${base}?${query}`, {
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
