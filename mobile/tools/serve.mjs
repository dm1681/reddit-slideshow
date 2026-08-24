// Self-host server for www/ — no dependencies, so `npm run serve` works
// straight after clone. Serves the app AND proxies Reddit listing reads at
// /reddit/..., which is what makes a hosted (LAN/Tailscale) install work at
// all: reddit.com sends no CORS headers to web origins, so the browser can
// only fetch listings same-origin. Running the proxy on your own box keeps
// the traffic on your residential IP, one person's volume, no third party.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www");
const port = Number(process.env.PORT || 4173);
// Test hook: selfcheck points this at a local mock so the live-listing path
// can be exercised where reddit.com is unreachable.
const upstream = (process.env.REDDIT_UPSTREAM || "https://www.reddit.com").replace(/\/+$/, "");

// Reddit's own guidance: identify honestly, and cache rather than hammer.
const USER_AGENT = "web:reel-selfhost:v0.1.0 (personal self-hosted client)";
const CACHE_TTL_MS = 60_000;
const cache = new Map();

// Only subreddit listings, nothing else, so the proxy can't be used as a
// general relay. Query is rebuilt from a whitelist for the same reason.
const LISTING_PATH = /^\/r\/[A-Za-z0-9_]{1,50}(?:\/(?:hot|new|top|rising))?\.json$/;
const QUERY_KEYS = ["raw_json", "limit", "after", "t"];

async function proxyReddit(req, res, url) {
  const target = url.pathname.replace(/^\/reddit/, "");
  if (!LISTING_PATH.test(target)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "only subreddit listing paths are proxied" }));
    return;
  }
  const query = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    if (url.searchParams.has(key)) query.set(key, url.searchParams.get(key));
  }
  const full = `${upstream}${target}?${query}`;

  const hit = cache.get(full);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    res.writeHead(hit.status, { "content-type": "application/json", "x-reel-cache": "hit" });
    res.end(hit.body);
    return;
  }

  try {
    const resp = await fetch(full, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await resp.text();

    // Reddit answers scripted clients with an HTML bot-check page rather than
    // JSON — measured 2026-08-23: HTTP 403 and ~190KB of HTML for curl, Node
    // fetch, and automated browsers alike. Detected here so the app can say
    // what actually happened instead of reporting a parse error.
    let isJson = false;
    try { JSON.parse(body); isJson = true; } catch (e) { isJson = false; }
    if (!isJson) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: "reddit_bot_wall",
        upstreamStatus: resp.status,
        detail:
          "Reddit served an HTML bot-check page instead of JSON. Public listing " +
          "endpoints are closed to scripted clients; this needs OAuth or an " +
          "in-app WebView you sign into. See mobile/README.md.",
      }));
      return;
    }

    // Cache successes AND 429s: repeating a rate-limited request faster is
    // exactly what must not happen.
    if (resp.ok || resp.status === 429) {
      cache.set(full, { at: Date.now(), status: resp.status, body });
    }
    res.writeHead(resp.status, { "content-type": "application/json" });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `upstream unreachable: ${e.message}` }));
  }
}

// ---- session bridge -------------------------------------------------------
// Reddit's public endpoints are closed to scripted clients (see README), so
// real posts can only come from a session a human has cleared and signed into.
// The probe in tools/reddit-scrape-probe.js runs the extension's scraper in
// such a tab and POSTs the result here; the app then reads it back as a feed.
// Nothing here talks to Reddit — it only holds what the browser handed over.
const sessionFile = path.join(root, "demo", ".session-feed.json");
let sessionFeed = { posts: [], capturedAt: null, source: null };

try {
  sessionFeed = JSON.parse(await readFile(sessionFile, "utf8"));
} catch (e) {
  // nothing captured yet — the app falls back to the demo feed
}

// The probe runs on the reddit.com origin and posts here, so this endpoint is
// deliberately cross-origin. It is bound to this machine and holds only what
// the browser just scraped, which is the scope this header matches.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-allow-private-network": "true",
  "access-control-max-age": "600",
};

function handleSession(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/session/feed") {
    res.writeHead(200, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify(sessionFeed));
    return;
  }

  if (req.method === "POST" && url.pathname === "/session/ingest") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // A scraped feed is tens of KB; anything vastly larger is not ours.
      if (raw.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw);
        const posts = Array.isArray(body.posts) ? body.posts : [];
        if (!posts.length) throw new Error("no posts in payload");
        sessionFeed = {
          posts,
          capturedAt: new Date().toISOString(),
          source: typeof body.source === "string" ? body.source : "reddit session",
        };
        await mkdir(path.dirname(sessionFile), { recursive: true });
        await writeFile(sessionFile, JSON.stringify(sessionFeed));
        console.log("[session] captured " + posts.length + " posts from " + sessionFeed.source);
        res.writeHead(200, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ ok: true, posts: posts.length }));
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json", ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify({ error: "unknown session route" }));
}

// Resolve a bare v.redd.it base to a playable rendition by reading its DASH
// manifest. Ported from the extension's video renderer, which learned the hard
// way that rendition filenames must be discovered, never guessed (Reddit
// renamed DASH_<res>.mp4 to CMAF_<res>.mp4 and every guessed name 403s).
// Server-side because the manifest fetch is cross-origin from the app page.
async function handleVreddit(req, res, url) {
  const base = (url.searchParams.get("u") || "").replace(/\/+$/, "");
  if (!/^https:\/\/v\.redd\.it\/[\w-]+$/.test(base)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "expected a v.redd.it base url" }));
    return;
  }
  try {
    const resp = await fetch(base + "/DASHPlaylist.mpd", {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error("manifest returned " + resp.status);
    const xml = await resp.text();

    // Video-only AdaptationSets, highest bandwidth wins. Audio lives in its
    // own set, so a rendition picked here is silent by construction.
    let best = null;
    for (const set of xml.split("<AdaptationSet").slice(1)) {
      const head = set.slice(0, set.indexOf(">"));
      if (!/contentType="video"/.test(head) && !/mimeType="video/.test(set.slice(0, 400))) continue;
      for (const rep of set.split("<Representation").slice(1)) {
        const bw = Number((/bandwidth="(\d+)"/.exec(rep) || [])[1] || 0);
        const file = (/<BaseURL>([^<]+)<\/BaseURL>/.exec(rep) || [])[1];
        if (file && (!best || bw > best.bw)) best = { bw, file: file.trim() };
      }
    }
    if (!best) throw new Error("no video rendition in manifest");

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ url: base + "/" + best.file, bandwidth: best.bw }));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/media/vreddit") {
    return handleVreddit(req, res, url);
  }

  if (url.pathname.startsWith("/session")) {
    return handleSession(req, res, url);
  }

  if (url.pathname.startsWith("/reddit/")) {
    return proxyReddit(req, res, url);
  }

  try {
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) throw new Error("outside root");
    if (url.pathname === "/" || url.pathname === "") file = path.join(root, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(port, () => {
  console.log(`Reel self-host server:`);
  console.log(`  local  http://localhost:${port}/`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) {
        console.log(`  LAN    http://${a.address}:${port}/`);
      }
    }
  }
  console.log(`  live subreddits: append ?sub=EarthPorn (proxied via this box)`);
});
