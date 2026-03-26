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

// Extract the scrapePosts function source from overlay.js for injection
function extractScrapeFunction() {
  const src = fs.readFileSync(CONTENT_SCRIPT, "utf8");
  // Extract the scrapePosts function body
  const match = src.match(/function scrapePosts\(\)\s*\{[\s\S]*?^}/m);
  if (!match) throw new Error("Could not extract scrapePosts from overlay.js");
  return match[0];
}

async function main() {
  const { server, port } = await startServer();
  const url = `http://localhost:${port}/`;
  console.log(`Mock server at ${url}\n`);

  let playwright;
  try {
    playwright = require("playwright");
  } catch (e) {
    console.log("Install playwright: npm install playwright");
    server.close();
    process.exit(1);
  }

  const scrapeFnSource = extractScrapeFunction();

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url);

  // Inject scrapePosts and run it
  const results = await page.evaluate((fnSrc) => {
    eval(fnSrc); // defines scrapePosts in this scope
    return {
      totalElements: document.querySelectorAll("shreddit-post").length,
      posts: scrapePosts(),
    };
  }, scrapeFnSource);

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}`); failed++; }
  }

  // --- Initial scrape tests ---
  console.log("Test: Initial scrape (before scroll)");
  assert(results.totalElements === 7, `Found 7 shreddit-post elements (got ${results.totalElements})`);
  // Expected: posts 1,2,3,5,6 have images. Post 4 (text) and 7 (redgifs link, no img) skipped.
  assert(results.posts.length === 5, `Scraped 5 image posts (got ${results.posts.length})`);

  const p1 = results.posts.find((p) => p.id === "t3_post001");
  assert(!!p1, "Post 1 found (post-type=image)");
  assert(p1 && p1.title === "Beautiful sunset over the mountains", "Post 1 title correct");
  assert(p1 && p1.author === "photographer42", "Post 1 author correct");
  assert(p1 && p1.subreddit === "pics", "Post 1 subreddit correct");
  assert(p1 && p1.score === 12453, "Post 1 score correct");
  assert(p1 && p1.mediaUrl === "https://i.redd.it/sunset-mountains-01.jpg", "Post 1 mediaUrl from content-href (post-type=image)");

  const p2 = results.posts.find((p) => p.id === "t3_post002");
  assert(!!p2, "Post 2 found (post-type=image)");
  assert(p2 && p2.mediaUrl === "https://i.redd.it/cat-adorable-02.jpeg", "Post 2 mediaUrl from content-href");

  const p3 = results.posts.find((p) => p.id === "t3_post003");
  assert(!!p3, "Post 3 found (gallery with i.redd.it img fallback)");
  assert(p3 && p3.mediaUrl.includes("i.redd.it"), "Post 3 mediaUrl from img fallback");

  const p4 = results.posts.find((p) => p.id === "t3_post004");
  assert(!p4, "Post 4 skipped (text post, no image)");

  const p5 = results.posts.find((p) => p.id === "t3_post005");
  assert(!!p5, "Post 5 found (imgur link with .jpg extension)");
  assert(p5 && p5.mediaUrl.includes("i.imgur.com"), "Post 5 mediaUrl from content-href (.jpg extension)");

  const p6 = results.posts.find((p) => p.id === "t3_post006");
  assert(!!p6, "Post 6 found (post-type=image)");
  assert(p6 && p6.mediaUrl === "https://i.redd.it/aurora-06.webp", "Post 6 mediaUrl from content-href");

  const p7 = results.posts.find((p) => p.id === "t3_post007");
  assert(!p7, "Post 7 skipped (redgifs link, no image element)");

  // --- Scroll tests ---
  console.log("\nTest: After scroll (infinite scroll simulation)");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  const afterScroll = await page.evaluate((fnSrc) => {
    eval(fnSrc);
    return {
      totalElements: document.querySelectorAll("shreddit-post").length,
      posts: scrapePosts(),
    };
  }, scrapeFnSource);

  assert(afterScroll.totalElements === 9, `Found 9 elements after scroll (got ${afterScroll.totalElements})`);
  assert(afterScroll.posts.length === 7, `Scraped 7 image posts after scroll (got ${afterScroll.posts.length})`);

  const p8 = afterScroll.posts.find((p) => p.id === "t3_post008");
  assert(!!p8, "Post 8 found after scroll");
  assert(p8 && p8.title === "Misty morning in the forest", "Post 8 title correct");
  assert(p8 && p8.mediaUrl === "https://i.redd.it/misty-forest-08.jpg", "Post 8 mediaUrl correct");

  const p9 = afterScroll.posts.find((p) => p.id === "t3_post009");
  assert(!!p9, "Post 9 found after scroll");

  // --- Deduplication test ---
  console.log("\nTest: Deduplication");
  const ids = afterScroll.posts.map((p) => p.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, "No duplicate post IDs");

  // Summary
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

  await browser.close();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
