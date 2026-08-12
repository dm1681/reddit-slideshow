// Regression test: the slideshow iframe loads (and asks getCurrentState) while
// the background is still resolving posts — it must receive the scraped posts,
// not an empty session. Bug: slideshow showed "No posts found" whenever the
// redgifs API round-trips lost the race against the local iframe load.
//
// Runs the REAL background.js with a mocked `browser` API.
// Run via: node test/test-start-race.js

const fs = require("fs");
const path = require("path");

const BACKGROUND_SRC = fs.readFileSync(
  path.join(__dirname, "..", "background", "background.js"),
  "utf8"
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK_POSTS = [
  {
    id: "t3_aaa",
    title: "Redgifs embed post",
    type: "embed",
    mediaUrl: "https://www.redgifs.com/ifr/abc",
    originalUrl: "https://www.redgifs.com/watch/abc",
  },
  {
    id: "t3_bbb",
    title: "Plain image post",
    type: "image",
    mediaUrl: "https://i.redd.it/b.jpg",
    originalUrl: "https://i.redd.it/b.jpg",
  },
];

// How long the mocked redgifs API takes per request. The real slideshow iframe
// loads from a local moz-extension:// URL in tens of ms, far faster than this.
const REDGIFS_LATENCY_MS = 150;

function buildHarness({ scrapeDelayMs = 0 } = {}) {
  const listeners = [];
  const broadcasts = [];

  const browser = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      getURL: (p) => `moz-extension://test/${p}`,
      // Extension-wide broadcast to the open slideshow page
      sendMessage: async (msg) => { broadcasts.push(msg); },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (tabId, msg) => {
        if (msg.type === "scrapeAndStart") {
          if (scrapeDelayMs) await sleep(scrapeDelayMs);
          return { success: true, posts: JSON.parse(JSON.stringify(MOCK_POSTS)) };
        }
        if (msg.type === "loadMore") return { posts: [] };
        return { success: true };
      },
    },
    windows: { create: async () => ({}) },
  };

  // Slow redgifs API mock
  const fetchMock = async (url) => {
    await sleep(REDGIFS_LATENCY_MS);
    if (url.includes("/auth/temporary")) {
      return { ok: true, json: async () => ({ token: "tok", expires_in: 3600 }) };
    }
    if (url.includes("/v2/gifs/")) {
      return {
        ok: true,
        json: async () => ({
          gif: { hasAudio: true, urls: { hd: "https://media.redgifs.com/abc.mp4" } },
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  // Evaluate the REAL background script with mocked globals.
  // new Function is safe here: the body is our own background.js read from
  // disk (same injection pattern as the other test harnesses) — no untrusted
  // or interpolated input.
  const fn = new Function("browser", "fetch", BACKGROUND_SRC);
  fn(browser, fetchMock);

  if (listeners.length !== 1) {
    throw new Error(`Expected 1 onMessage listener, got ${listeners.length}`);
  }
  const dispatch = (msg) => listeners[0](msg, { tab: { id: 1 } });
  return { dispatch, broadcasts };
}

let passed = 0;
let failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}`); failed++; }
}

async function main() {
  // ================================================================
  // TEST 1: getCurrentState during slow redgifs resolution
  // ================================================================
  console.log("Test: getCurrentState races slow redgifs resolution");
  {
    const { dispatch } = buildHarness();

    const startPromise = dispatch({ type: "startSlideshow" });

    // The content script creates the overlay iframe BEFORE its scrapeAndStart
    // response even reaches the background. 20ms in, the iframe has loaded and
    // asks for state — while the redgifs API calls (150ms each) are in flight.
    await sleep(20);
    const state = await dispatch({ type: "getCurrentState" });

    assert(!state.error, `No error from getCurrentState (got ${state.error || "none"})`);
    assert(
      state.posts && state.posts.length === MOCK_POSTS.length,
      `Slideshow receives all ${MOCK_POSTS.length} posts during resolution (got ${state.posts ? state.posts.length : "none"})`
    );

    const startResult = await startPromise;
    assert(startResult.success, "startSlideshow reports success");
    assert(
      startResult.postCount === MOCK_POSTS.length,
      `startSlideshow reports ${MOCK_POSTS.length} posts (got ${startResult.postCount})`
    );
  }

  // ================================================================
  // TEST 2: getCurrentState before scrapeAndStart response arrives
  // ================================================================
  console.log("\nTest: getCurrentState races the scrape response itself");
  {
    const { dispatch } = buildHarness({ scrapeDelayMs: 100 });

    const startPromise = dispatch({ type: "startSlideshow" });
    await sleep(10); // iframe asks for state before the scrape response lands
    const state = await dispatch({ type: "getCurrentState" });

    assert(
      state.posts && state.posts.length === MOCK_POSTS.length,
      `Slideshow receives all ${MOCK_POSTS.length} posts despite slow scrape (got ${state.posts ? state.posts.length : state.error})`
    );
    await startPromise;
  }

  // ================================================================
  // TEST 3: redgifs resolution still lands (lazily) in the session
  // ================================================================
  console.log("\nTest: redgifs posts eventually resolve to direct MP4");
  {
    const { dispatch } = buildHarness();

    await dispatch({ type: "startSlideshow" });
    await sleep(REDGIFS_LATENCY_MS * 2 + 100); // token + gif lookup + margin

    const state = await dispatch({ type: "getCurrentState" });
    const redgifsPost = state.posts && state.posts.find((p) => p.id === "t3_aaa");
    assert(!!redgifsPost, "Redgifs post present in session");
    assert(
      redgifsPost && redgifsPost.type === "video" && redgifsPost.mediaUrl.endsWith(".mp4"),
      `Redgifs post resolved to direct MP4 (got type=${redgifsPost && redgifsPost.type}, url=${redgifsPost && redgifsPost.mediaUrl})`
    );
    assert(
      redgifsPost && redgifsPost.hasAudio === true,
      "Resolved post carries hasAudio from the redgifs API"
    );
  }

  // ================================================================
  // TEST 4: resolved posts are pushed to the already-open slideshow
  // ================================================================
  // The slideshow snapshots posts when it loads — before resolution lands. With
  // no push it kept rendering redgifs through the muted embed player until a
  // preemptive refill happened to replace the list.
  console.log("\nTest: resolved posts are broadcast to the open slideshow");
  {
    const { dispatch, broadcasts } = buildHarness();

    await dispatch({ type: "startSlideshow" });
    assert(broadcasts.length === 0, "No broadcast before resolution completes");

    await sleep(REDGIFS_LATENCY_MS * 2 + 100);

    const update = broadcasts.find((m) => m.type === "postsUpdated");
    assert(!!update, "postsUpdated broadcast sent after resolution");
    const pushed = update && update.posts.find((p) => p.id === "t3_aaa");
    assert(
      pushed && pushed.type === "video",
      `Broadcast carries the resolved video post (got type=${pushed && pushed.type})`
    );
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
