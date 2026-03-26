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
  assert(results.totalElements === 10, `Found 10 shreddit-post elements (got ${results.totalElements})`);
  assert(results.posts.length === 8, `Scraped 8 supported posts (got ${results.posts.length})`);

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
  assert(p7 && p7.type === "image", "Post 7 type is image (gallery fallback)");
  assert(p7 && p7.mediaUrl.includes("preview.redd.it"), "Post 7 mediaUrl from preview image");

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

  assert(afterScroll.totalElements === 11, `Found 11 elements after scroll (got ${afterScroll.totalElements})`);
  assert(afterScroll.posts.length === 9, `Scraped 9 posts after scroll (got ${afterScroll.posts.length})`);

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
  assert(typeCounts.image === 5, `5 image posts (got ${typeCounts.image})`);
  assert(typeCounts.embed === 3, `3 embed posts (got ${typeCounts.embed})`);
  assert(typeCounts.video === 1, `1 video post (got ${typeCounts.video})`);

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

  await browser.close();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
