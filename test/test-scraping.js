// Test runner for the content script's scraping logic
// Run via: node test/test-scraping.js

const http = require("http");
const fs = require("fs");
const path = require("path");

const MOCK_PAGE = path.join(__dirname, "mock-reddit.html");
const CONTENT_SCRIPT = path.join(__dirname, "..", "content", "overlay.js");

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fs.readFileSync(MOCK_PAGE, "utf8"));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

// Extract all scraping code from overlay.js (everything before scroll section)
function extractScrapeCode() {
  const src = fs.readFileSync(CONTENT_SCRIPT, "utf8");
  const marker = "// --- Scroll to load more ---";
  const idx = src.indexOf(marker);
  if (idx === -1) throw new Error("Could not find scraping section boundary in overlay.js");
  let section = src.substring(0, idx).trim();
  // Remove module-level vars
  section = section.replace(/^\/\/[^\n]*\n+let overlayElement[^\n]*\nlet savedOverflow[^\n]*\n+\/\/ --- DOM scraping ---\n*/m, "");
  return section;
}

async function main() {
  const { server, port } = await startServer();
  const url = `http://localhost:${port}/`;
  console.log(`Mock server at ${url}\n`);

  const playwright = require("playwright");
  const scrapeCode = extractScrapeCode();

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url);

  const results = await page.evaluate((code) => {
    eval(code);
    return {
      totalElements: document.querySelectorAll("shreddit-post").length,
      posts: scrapePosts(),
    };
  }, scrapeCode);

  let passed = 0;
  let failed = 0;
  function assert(condition, name) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}`); failed++; }
  }

  // --- Initial scrape ---
  console.log("Test: Initial scrape (before scroll)");
  // 10 posts in DOM, but post 6 (text) and post 9 (unknown link) should be skipped = 8 posts
  assert(results.totalElements === 13, `Found 13 shreddit-post elements (got ${results.totalElements})`);
  assert(results.posts.length === 11, `Scraped 11 supported posts (got ${results.posts.length})`);

  // Post 1: image
  const p1 = results.posts.find(p => p.id === "t3_post001");
  assert(!!p1, "Post 1 found");
  assert(p1 && p1.type === "image", "Post 1 type is image");
  assert(p1 && p1.mediaUrl === "https://i.redd.it/sunset-01.jpg", "Post 1 mediaUrl correct");
  assert(p1 && p1.title === "Beautiful sunset", "Post 1 title correct");

  // Post 2: image
  const p2 = results.posts.find(p => p.id === "t3_post002");
  assert(!!p2, "Post 2 found");
  assert(p2 && p2.type === "image", "Post 2 type is image");

  // Post 3: YouTube embed
  const p3 = results.posts.find(p => p.id === "t3_post003");
  assert(!!p3, "Post 3 found (YouTube)");
  assert(p3 && p3.type === "embed", "Post 3 type is embed");
  assert(p3 && p3.mediaUrl.includes("youtube.com/embed/dQw4w9WgXcQ"), "Post 3 YouTube embed URL correct");

  // Post 4: youtu.be embed
  const p4 = results.posts.find(p => p.id === "t3_post004");
  assert(!!p4, "Post 4 found (youtu.be)");
  assert(p4 && p4.type === "embed", "Post 4 type is embed");
  assert(p4 && p4.mediaUrl.includes("youtube.com/embed/abc123def"), "Post 4 youtu.be embed URL correct");

  // Post 5: redgifs embed
  const p5 = results.posts.find(p => p.id === "t3_post005");
  assert(!!p5, "Post 5 found (redgifs)");
  assert(p5 && p5.type === "embed", "Post 5 type is embed");
  assert(p5 && p5.mediaUrl.includes("redgifs.com/ifr/friendlylittlecat"), "Post 5 redgifs embed URL correct");

  // Post 6: text — should be skipped
  const p6 = results.posts.find(p => p.id === "t3_post006");
  assert(!p6, "Post 6 skipped (text post)");

  // Post 7: gallery with image fallback
  const p7 = results.posts.find(p => p.id === "t3_post007");
  assert(!!p7, "Post 7 found (gallery)");
  assert(p7 && p7.type === "gallery", `Post 7 is flagged as a gallery (got ${p7 && p7.type})`);
  assert(p7 && p7.galleryHref === "/r/pics/comments/abc007/photo_album/", `Post 7 keeps its permalink for resolution (got ${p7 && p7.galleryHref})`);

  // Post 8: imgur gifv → video
  const p8 = results.posts.find(p => p.id === "t3_post008");
  assert(!!p8, "Post 8 found (imgur gifv)");
  assert(p8 && p8.type === "video", "Post 8 type is video (gifv→mp4)");
  assert(p8 && p8.mediaUrl.endsWith(".mp4"), "Post 8 mediaUrl converted to mp4");

  // Post 9: unknown external link — should be skipped
  const p9 = results.posts.find(p => p.id === "t3_post009");
  assert(!p9, "Post 9 skipped (unknown external link)");

  // Post 10: direct image link
  const p10 = results.posts.find(p => p.id === "t3_post010");
  assert(!!p10, "Post 10 found (direct .jpg link)");
  assert(p10 && p10.type === "image", "Post 10 type is image");

  // --- Scroll test ---
  console.log("\nTest: After scroll");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  const afterScroll = await page.evaluate((code) => {
    eval(code);
    return {
      totalElements: document.querySelectorAll("shreddit-post").length,
      posts: scrapePosts(),
    };
  }, scrapeCode);

  assert(afterScroll.totalElements === 14, `Found 14 elements after scroll (got ${afterScroll.totalElements})`);
  assert(afterScroll.posts.length === 12, `Scraped 12 posts after scroll (got ${afterScroll.posts.length})`);

  const p11 = afterScroll.posts.find(p => p.id === "t3_post011");
  assert(!!p11, "Post 11 found after scroll");
  assert(p11 && p11.type === "image", "Post 11 type is image");

  // --- Deduplication ---
  console.log("\nTest: Deduplication");
  const ids = afterScroll.posts.map(p => p.id);
  assert(ids.length === new Set(ids).size, "No duplicate post IDs");

  // --- Type distribution ---
  console.log("\nTest: Type distribution");
  const typeCounts = {};
  afterScroll.posts.forEach(p => { typeCounts[p.type] = (typeCounts[p.type] || 0) + 1; });
  assert(typeCounts.image === 4, `4 image posts (got ${typeCounts.image})`);
  assert(typeCounts.gallery === 1, `1 unresolved gallery (got ${typeCounts.gallery})`);
  assert(typeCounts.embed === 4, `4 embed posts (got ${typeCounts.embed})`);
  assert(typeCounts.video === 2, `2 video posts (got ${typeCounts.video})`);
  assert(typeCounts.crosspost === 1, `1 unresolved crosspost (got ${typeCounts.crosspost})`);

  // --- Resolution from Reddit's JSON ---
  // Crossposts and galleries carry no usable media in the DOM: a crosspost has
  // only the original's permalink, a gallery only one preview thumbnail. Both
  // are filled in from the post's JSON, which is same-origin from the content
  // script and so goes out with the viewer's cookies.
  console.log("\nTest: Crossposts and galleries resolve via Reddit's JSON");
  const resolvedViaJson = await page.evaluate(async (fnSrc) => {
    eval(fnSrc);

    const requested = [];
    window.fetch = async (url) => {
      requested.push(url);
      const gallery = url.includes("/photo_album/");
      return {
        ok: true,
        json: async () => [
          {
            data: {
              children: [
                {
                  data: gallery
                    ? {
                        gallery_data: {
                          items: [{ media_id: "a1" }, { media_id: "b2" }, { media_id: "c3" }],
                        },
                        media_metadata: {
                          a1: { s: { u: "https://i.redd.it/one.jpg" } },
                          b2: { s: { u: "https://i.redd.it/two.jpg" } },
                          c3: { s: { mp4: "https://i.redd.it/three.mp4" } },
                        },
                      }
                    : { url: "https://www.redgifs.com/watch/resolvedcrosspost" },
                },
              ],
            },
          },
        ],
      };
    };

    const scraped = scrapePosts();
    const resolved = await resolvePendingPosts(scraped);
    const crosspost = resolved.find((p) => p.id === "t3_post014");
    return {
      requested,
      scrapedCount: scraped.length,
      resolvedCount: resolved.length,
      crosspost: crosspost && { type: crosspost.type, mediaUrl: crosspost.mediaUrl, leftover: "crosspostHref" in crosspost },
      gallery: resolved
        .filter((p) => String(p.id).startsWith("t3_post007"))
        .map((p) => ({ id: p.id, type: p.type, mediaUrl: p.mediaUrl, title: p.title, leftover: "galleryHref" in p })),
    };
  }, scrapeCode);

  // Absolute, not relative: a content script's fetch throws on a relative URL
  // rather than resolving it against the page.
  assert(
    resolvedViaJson.requested.length === 2 &&
      resolvedViaJson.requested.every((u) => /^https?:\/\/[^/]+\/r\//.test(u) && u.endsWith("/.json?raw_json=1")),
    `Both fetches use an absolute URL (got ${JSON.stringify(resolvedViaJson.requested)})`
  );
  assert(
    resolvedViaJson.crosspost &&
      resolvedViaJson.crosspost.type === "embed" &&
      resolvedViaJson.crosspost.mediaUrl === "https://www.redgifs.com/ifr/resolvedcrosspost",
    `Crosspost resolves to the original's media (got ${JSON.stringify(resolvedViaJson.crosspost)})`
  );
  assert(
    resolvedViaJson.crosspost && !resolvedViaJson.crosspost.leftover,
    "Resolved crosspost drops its crosspostHref marker"
  );

  // One post per image — a slideshow shows one thing at a time, so a gallery
  // left as a single post would only ever show its first image.
  assert(
    resolvedViaJson.gallery.length === 3,
    `Gallery expands to one post per image (got ${resolvedViaJson.gallery.length})`
  );
  assert(
    resolvedViaJson.gallery.every((p, i) => p.id === `t3_post007-${i + 1}`),
    `Expanded gallery posts get distinct ids (got ${resolvedViaJson.gallery.map((p) => p.id).join(",")})`
  );
  assert(
    resolvedViaJson.gallery[0].mediaUrl === "https://i.redd.it/one.jpg" &&
      resolvedViaJson.gallery[2].mediaUrl === "https://i.redd.it/three.mp4",
    `Gallery keeps the order from gallery_data (got ${resolvedViaJson.gallery.map((p) => p.mediaUrl).join(",")})`
  );
  assert(
    resolvedViaJson.gallery[2].type === "video",
    `An mp4 gallery item renders as video (got ${resolvedViaJson.gallery[2].type})`
  );
  assert(
    resolvedViaJson.gallery[0].title.endsWith("(1/3)"),
    `Expanded posts are numbered (got ${JSON.stringify(resolvedViaJson.gallery[0].title)})`
  );
  assert(
    resolvedViaJson.gallery.every((p) => !p.leftover),
    "Expanded gallery posts drop the galleryHref marker"
  );
  assert(
    resolvedViaJson.resolvedCount === resolvedViaJson.scrapedCount + 2,
    `Gallery adds two posts (${resolvedViaJson.scrapedCount} → ${resolvedViaJson.resolvedCount})`
  );

  // Anything whose JSON cannot be read is dropped, not shown broken.
  const unresolvable = await page.evaluate(async (fnSrc) => {
    eval(fnSrc);
    window.fetch = async () => ({ ok: false, json: async () => ({}) });
    const scraped = scrapePosts();
    const resolved = await resolvePendingPosts(scraped);
    return {
      dropped: scraped.length - resolved.length,
      stillThere: resolved.some((p) => p.id === "t3_post014" || p.id === "t3_post007"),
    };
  }, scrapeCode);

  assert(unresolvable.dropped === 2, `Unresolvable crosspost and gallery are dropped (dropped ${unresolvable.dropped})`);
  assert(!unresolvable.stillThere, "Neither reaches the slideshow")

  // --- Reddit actions (save / vote) ---
  // These run in the content script because that is the only place where the
  // request is same-origin and carries the viewer's cookies.
  console.log("\nTest: save and vote go to Reddit with the session's modhash");
  const actions = await page.evaluate(async (fnSrc) => {
    eval(fnSrc);

    const calls = [];
    window.fetch = async (url, opts) => {
      calls.push({ url, method: (opts && opts.method) || "GET", headers: (opts && opts.headers) || {}, body: opts && opts.body });
      if (url.includes("/api/me.json")) {
        return { ok: true, json: async () => ({ data: { modhash: "MODHASH123" } }) };
      }
      return { ok: true, json: async () => ({}), text: async () => "{}" };
    };

    const saved = await handleSavePost({ id: "t3_abc", saved: true });
    const unsaved = await handleSavePost({ id: "t3_abc", saved: false });
    const voted = await handleVotePost({ id: "t3_abc", dir: 1 });

    return { calls, saved, unsaved, voted };
  }, scrapeCode);

  const posted = actions.calls.filter((c) => c.method === "POST");
  assert(actions.saved.success === true, `Save reports success (got ${JSON.stringify(actions.saved)})`);
  assert(
    posted[0] && posted[0].url.endsWith("/api/save") && posted[0].body === "id=t3_abc",
    `Save posts the id to /api/save (got ${posted[0] && posted[0].url} body=${posted[0] && posted[0].body})`
  );
  assert(
    posted[0] && posted[0].headers["X-Modhash"] === "MODHASH123",
    "Save carries the session modhash"
  );
  assert(posted[1] && posted[1].url.endsWith("/api/unsave"), `Unsaving uses /api/unsave (got ${posted[1] && posted[1].url})`);
  assert(
    posted[2] && posted[2].url.endsWith("/api/vote") && posted[2].body.includes("dir=1"),
    `Voting posts a direction (got ${posted[2] && posted[2].body})`
  );
  // The modhash costs one request, not one per action.
  assert(
    actions.calls.filter((c) => c.url.includes("/api/me.json")).length === 1,
    `The modhash is fetched once and reused (got ${actions.calls.filter((c) => c.url.includes("/api/me.json")).length})`
  );

  console.log("\nTest: a signed-out viewer gets an error, not a silent no-op");
  const signedOut = await page.evaluate(async (fnSrc) => {
    eval(fnSrc);
    let posts = 0;
    window.fetch = async (url, opts) => {
      if (opts && opts.method === "POST") posts++;
      if (url.includes("/api/me.json")) return { ok: true, json: async () => ({ data: {} }) };
      return { ok: true, json: async () => ({}) };
    };
    const result = await handleSavePost({ id: "t3_abc", saved: true });
    return { result, posts };
  }, scrapeCode);

  assert(!!signedOut.result.error, `Reports an error when signed out (got ${JSON.stringify(signedOut.result)})`);
  assert(signedOut.posts === 0, "Sends nothing to Reddit when there is no modhash");

  console.log("\nTest: saved and vote state is attached to scraped posts");
  const userState = await page.evaluate(async (fnSrc) => {
    eval(fnSrc);
    const requested = [];
    window.fetch = async (url) => {
      requested.push(url);
      return {
        ok: true,
        json: async () => ({
          data: {
            children: [
              { data: { name: "t3_post001", saved: true, likes: true } },
              { data: { name: "t3_post002", saved: false, likes: null } },
            ],
          },
        }),
      };
    };

    // Two slides from one gallery post share a Reddit id, so both must pick up
    // the same saved state or the button would flicker between images.
    const posts = [
      { id: "t3_post001", redditId: "t3_post001", type: "image" },
      { id: "t3_post001-2", redditId: "t3_post001", type: "image" },
      { id: "t3_post002", redditId: "t3_post002", type: "image" },
      { id: "local-only", redditId: undefined, type: "image" },
    ];
    const withState = await attachUserState(posts);
    return { requested, withState };
  }, scrapeCode);

  assert(
    userState.requested.length === 1 && userState.requested[0].includes("id=t3_post001,t3_post002"),
    `Asks for every post in one request, de-duplicated (got ${JSON.stringify(userState.requested)})`
  );
  assert(
    userState.withState[0].saved === true && userState.withState[0].likes === true,
    "Saved and vote state land on the post"
  );
  assert(
    userState.withState[1].saved === true,
    "Both slides of one gallery post carry the same saved state"
  );
  assert(
    userState.withState[2].saved === false && userState.withState[3].saved === undefined,
    "Posts Reddit knows nothing about are left alone"
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

  await browser.close();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
