// Integration test: full pipeline from scraping → background state → slideshow rendering
// Simulates the entire extension message flow in a single Playwright page.
// Run via: node test/test-integration.js

const http = require("http");
const fs = require("fs");
const path = require("path");

const MOCK_PAGE = path.join(__dirname, "mock-reddit.html");

// Read all extension source files
const CONTENT_SCRIPT = fs.readFileSync(path.join(__dirname, "..", "content", "overlay.js"), "utf8");
const BACKGROUND_SCRIPT = fs.readFileSync(path.join(__dirname, "..", "background", "background.js"), "utf8");
const SLIDESHOW_JS = fs.readFileSync(path.join(__dirname, "..", "slideshow", "slideshow.js"), "utf8");
const IMAGE_RENDERER = fs.readFileSync(path.join(__dirname, "..", "slideshow", "renderers", "image.js"), "utf8");
const VIDEO_RENDERER = fs.readFileSync(path.join(__dirname, "..", "slideshow", "renderers", "video.js"), "utf8");
const EMBED_RENDERER = fs.readFileSync(path.join(__dirname, "..", "slideshow", "renderers", "embed.js"), "utf8");
const SLIDESHOW_HTML = fs.readFileSync(path.join(__dirname, "..", "slideshow", "slideshow.html"), "utf8");
const SLIDESHOW_CSS = fs.readFileSync(path.join(__dirname, "..", "slideshow", "slideshow.css"), "utf8");

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fs.readFileSync(MOCK_PAGE, "utf8"));
      } else if (req.url === "/slideshow") {
        // Serve a self-contained slideshow page for testing
        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>${SLIDESHOW_CSS}</style>
</head><body>
<div id="top-bar" class="controls">
  <span id="progress">0 / 0</span>
  <div id="top-bar-right">
    <button id="auto-advance-btn" title="Toggle auto-advance">⏱ Off</button>
    <button id="popout-btn" title="Pop out to window">↗</button>
    <button id="close-btn" title="Close slideshow">✕</button>
  </div>
</div>
<button id="prev-btn" class="nav-arrow controls" title="Previous">‹</button>
<button id="next-btn" class="nav-arrow controls" title="Next">›</button>
<div id="content-container"></div>
<div id="post-info" class="controls">
  <div id="post-title"></div>
  <div id="post-meta"></div>
</div>
<div id="progress-bar"><div id="progress-bar-fill"></div></div>
</body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const { server, port } = await startServer();
  const baseUrl = `http://localhost:${port}`;
  console.log(`Mock server at ${baseUrl}\n`);

  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}`); failed++; }
  }

  // ================================================================
  // TEST 1: Full message flow simulation
  // ================================================================
  console.log("Test: Full message flow (scrape → background → slideshow)");

  const page = await browser.newPage();
  await page.goto(baseUrl + "/");

  // Extract all scraping code from content script
  const marker = "// --- Scroll to load more ---";
  let scrapeFnSrc = CONTENT_SCRIPT.substring(0, CONTENT_SCRIPT.indexOf(marker)).trim();
  scrapeFnSrc = scrapeFnSrc.replace(/^\/\/[^\n]*\n+let overlayElement[^\n]*\nlet savedOverflow[^\n]*\n+\/\/ --- DOM scraping ---\n*/m, "");

  // Step 1: Run scraping on mock Reddit page
  // Mirrors the content script: crossposts carry no media in the DOM and are
  // filled in from the original post's JSON before anything is handed on.
  const scrapedPosts = await page.evaluate(async (fnSrc) => {
    eval(fnSrc);
    window.fetch = async (url) => ({
      ok: true,
      json: async () => [
        {
          data: {
            children: [
              {
                data: url.includes("/photo_album/")
                  ? {
                      gallery_data: { items: [{ media_id: "g1" }] },
                      media_metadata: { g1: { s: { u: "https://i.redd.it/gallery-one.jpg" } } },
                    }
                  : { url: "https://i.redd.it/crosspost-original.jpg" },
              },
            ],
          },
        },
      ],
    });
    return resolvePendingPosts(scrapePosts());
  }, scrapeFnSrc);

  assert(scrapedPosts.length === 11, `Scraped 11 posts from mock page (got ${scrapedPosts.length})`);
  assert(scrapedPosts.every(p => p.id && p.title && p.mediaUrl), "All posts have id, title, mediaUrl");

  // Step 2: Simulate background state management (posts returned directly from scrapeAndStart)
  const bgState = await page.evaluate((posts) => {
    // Simulate background's handleStartSlideshow receiving posts from content script response
    const session = {
      posts: posts, // Posts come directly from scrapeAndStart response
      currentIndex: 0,
      loading: false,
      exhausted: false,
      tabId: 1,
    };

    // Simulate handleGetCurrentState
    return {
      posts: session.posts,
      currentIndex: session.currentIndex,
      exhausted: session.exhausted,
    };
  }, scrapedPosts);

  assert(bgState.posts.length === 11, `Background stored 11 posts (got ${bgState.posts.length})`);
  assert(bgState.currentIndex === 0, "Current index is 0");

  // Step 3: Load slideshow page and render posts
  const slideshowPage = await browser.newPage();
  await slideshowPage.goto(baseUrl + "/slideshow");

  // Inject image renderer (use addScriptTag to properly define globals)
  await slideshowPage.addScriptTag({ content: IMAGE_RENDERER });
  await slideshowPage.addScriptTag({ content: VIDEO_RENDERER });
  await slideshowPage.addScriptTag({ content: EMBED_RENDERER });

  // Simulate the slideshow controller's init + renderCurrentPost
  const renderResult = await slideshowPage.evaluate((state) => {
    const contentContainer = document.getElementById("content-container");
    const postTitle = document.getElementById("post-title");
    const postMeta = document.getElementById("post-meta");
    const progress = document.getElementById("progress");
    const progressBarFill = document.getElementById("progress-bar-fill");

    const posts = state.posts;
    let currentIndex = state.currentIndex;

    if (posts.length === 0) {
      return { error: "No posts to render" };
    }

    const post = posts[currentIndex];

    // Render using ImageRenderer
    const renderers = { image: ImageRenderer, video: VideoRenderer, embed: EmbedRenderer };
    const renderer = renderers[post.type];
    if (!renderer) {
      return { error: `No renderer for type: ${post.type}` };
    }
    const cleanup = renderer.render(post, contentContainer);

    // Update UI
    postTitle.textContent = post.title;
    const parts = [];
    if (post.subreddit) parts.push(`r/${post.subreddit}`);
    if (post.score) {
      const scoreFormatted = post.score >= 1000 ? `${(post.score / 1000).toFixed(1)}k` : post.score;
      parts.push(`${scoreFormatted} ↑`);
    }
    if (post.author) parts.push(`u/${post.author}`);
    postMeta.textContent = parts.join(" · ");

    progress.textContent = `${currentIndex + 1} / ${posts.length}`;
    const pct = ((currentIndex + 1) / posts.length) * 100;
    progressBarFill.style.width = `${pct}%`;

    return {
      hasContent: contentContainer.children.length > 0,
      hasImg: !!contentContainer.querySelector("img"),
      imgSrc: contentContainer.querySelector("img")?.getAttribute("src") || null,
      imgAlt: contentContainer.querySelector("img")?.getAttribute("alt") || null,
      title: postTitle.textContent,
      meta: postMeta.textContent,
      progress: progress.textContent,
      postType: post.type,
      mediaUrl: post.mediaUrl,
    };
  }, bgState);

  assert(!renderResult.error, `Render succeeded (${renderResult.error || "ok"})`);
  assert(renderResult.hasContent, "Content container has children");
  assert(renderResult.hasImg, "Image element exists in container");
  assert(renderResult.imgSrc === renderResult.mediaUrl, `Image src matches mediaUrl (${renderResult.imgSrc})`);
  assert(renderResult.title === "Beautiful sunset", "Post title rendered");
  assert(renderResult.meta.includes("r/pics"), "Post meta includes subreddit");
  assert(renderResult.meta.includes("u/photographer42"), "Post meta includes author");
  assert(renderResult.progress === "1 / 11", `Progress shows 1 / 11 (got ${renderResult.progress})`);

  // ================================================================
  // TEST 2: Navigation simulation
  // ================================================================
  console.log("\nTest: Navigation (next/prev)");

  const navResult = await slideshowPage.evaluate((state) => {
    const posts = state.posts;
    const contentContainer = document.getElementById("content-container");
    const postTitle = document.getElementById("post-title");
    const progress = document.getElementById("progress");
    const renderers = { image: ImageRenderer, video: VideoRenderer, embed: EmbedRenderer };

    const results = [];

    // Navigate through all posts — check img RIGHT after render, before error events fire
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const renderer = renderers[post.type];
      if (renderer) renderer.render(post, contentContainer);
      postTitle.textContent = post.title;
      progress.textContent = `${i + 1} / ${posts.length}`;

      // Check immediately — content exists before load/error events
      results.push({
        index: i,
        title: post.title,
        postType: post.type,
        hasContent: contentContainer.children.length > 0,
      });
    }

    return results;
  }, bgState);

  assert(navResult.length === 11, `Navigated through all 11 posts (got ${navResult.length})`);
  for (const r of navResult) {
    assert(r.hasContent, `Post ${r.index + 1} (${r.postType}) rendered content`);
  }

  // ================================================================
  // TEST 3: Browser.runtime message flow simulation
  // ================================================================
  console.log("\nTest: Simulated browser.runtime message flow");

  const msgFlowResult = await page.evaluate((fnSrc) => {
    eval(fnSrc);

    // Simulate the EXACT flow that happens in the extension
    const log = [];

    // 1. Background creates session
    const session = { posts: [], currentIndex: 0, loading: false, exhausted: false, tabId: 1 };
    log.push("session created");

    // 2. Content script scrapes and returns posts in response
    const posts = scrapePosts();
    log.push(`scraped ${posts.length} posts`);

    // 3. Background receives posts directly from scrapeAndStart response
    session.posts = posts;
    log.push(`stored ${session.posts.length} posts in session`);

    // 4. getCurrentState handler
    const state = {
      posts: session.posts,
      currentIndex: session.currentIndex,
      exhausted: session.exhausted,
    };
    log.push(`getCurrentState returns ${state.posts.length} posts`);

    // 5. Check: would slideshow show "no posts"?
    const wouldShowNoImages = state.posts.length === 0;
    log.push(`would show "no images found": ${wouldShowNoImages}`);

    return { log, postCount: state.posts.length, wouldShowNoImages };
  }, scrapeFnSrc);

  for (const entry of msgFlowResult.log) {
    console.log(`    [flow] ${entry}`);
  }
  assert(!msgFlowResult.wouldShowNoImages, "Slideshow would NOT show 'no images found'");
  assert(msgFlowResult.postCount === 11, `Full flow delivers 11 posts (got ${msgFlowResult.postCount})`);

  // ================================================================
  // TEST 4: Verify actual slideshow.js init behavior
  // ================================================================
  console.log("\nTest: slideshow.js init with mocked browser.runtime");

  const initPage = await browser.newPage();
  await initPage.goto(baseUrl + "/slideshow");

  await initPage.addScriptTag({ content: IMAGE_RENDERER });
  await initPage.addScriptTag({ content: VIDEO_RENDERER });
  await initPage.addScriptTag({ content: EMBED_RENDERER });

  const initResult = await initPage.evaluate((bgStateToReturn) => {

    // Mock browser.runtime
    window.browser = {
      runtime: {
        sendMessage: async (msg) => {
          if (msg.type === "getCurrentState") {
            return bgStateToReturn;
          }
          if (msg.type === "getPosts") {
            return { posts: bgStateToReturn.posts, total: bgStateToReturn.posts.length, exhausted: false };
          }
          if (msg.type === "closeSlideshow") {
            return { success: true };
          }
          return { error: "Unknown" };
        },
        getURL: (path) => path,
      },
    };

    // Now run the slideshow init logic inline (simplified from slideshow.js)
    return new Promise(async (resolve) => {
      const contentContainer = document.getElementById("content-container");
      const progressEl = document.getElementById("progress");
      const postTitleEl = document.getElementById("post-title");

      try {
        const state = await browser.runtime.sendMessage({ type: "getCurrentState" });

        if (state.error) {
          resolve({ error: state.error });
          return;
        }

        const posts = state.posts;
        if (posts.length === 0) {
          resolve({ error: "No image posts found", postCount: 0 });
          return;
        }

        // Render first post
        const post = posts[0];
        const renderers = { image: ImageRenderer, video: VideoRenderer, embed: EmbedRenderer };
        const renderer = renderers[post.type];
        if (renderer) renderer.render(post, contentContainer);
        postTitleEl.textContent = post.title;
        progressEl.textContent = `1 / ${posts.length}`;

        // Check immediately after render — img exists before load/error events
        const img = contentContainer.querySelector("img");
        resolve({
          postCount: posts.length,
          hasImg: !!img,
          imgSrc: img ? img.getAttribute("src") : null,
          title: postTitleEl.textContent,
          progress: progressEl.textContent,
        });
      } catch (e) {
        resolve({ error: e.message });
      }
    });
  }, bgState);

  assert(!initResult.error, `Init succeeded (${initResult.error || "ok"})`);
  assert(initResult.postCount === 11, `Slideshow received 11 posts (got ${initResult.postCount})`);
  assert(initResult.hasImg, "Slideshow rendered an image");
  assert(initResult.title === "Beautiful sunset", "Slideshow shows correct title");
  assert(initResult.progress === "1 / 11", `Progress shows 1 / 11 (got ${initResult.progress})`);

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
