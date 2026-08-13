// Regression test: auto-advance must be driven only by the slide on screen.
//
// Every renderer schedules work — a still's five seconds, an embed's blind
// fallback, a failed load's grace period — and every one of them used to
// survive its own teardown. The image renderer was the worst of it: cleanup
// sets src="" which fires `error`, that scheduled a retry, the retry restored
// the src, the load fired, and a five-second advance was armed against
// whichever slide had replaced it. A gallery armed one per image, so
// auto-advance grew more erratic the longer it ran, and arrow-key navigation
// inherited advances belonging to posts already left behind.
//
// The invariant, for every renderer: after cleanup() nothing advances, ever.
// Which is also what makes arrow keys behave — each new slide is timed from
// its own load, not from what came before.
//
// Timers run on Playwright's fake clock so five- and fifteen-second waits cost
// nothing. Video end is real playback, which a fake clock cannot produce.
//
// Run via: node test/test-auto-advance.js

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");

const IMAGE_RENDERER = fs.readFileSync(path.join(ROOT, "slideshow", "renderers", "image.js"), "utf8");
const VIDEO_RENDERER = fs.readFileSync(path.join(ROOT, "slideshow", "renderers", "video.js"), "utf8");
const EMBED_RENDERER = fs.readFileSync(path.join(ROOT, "slideshow", "renderers", "embed.js"), "utf8");

const PAGE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>auto-advance harness</title></head>
<body style="margin:0">
  <div id="content-container" style="position:relative;width:640px;height:360px"></div>
</body></html>`;

// Counts advances and hands back a cleanup, so each case reads as: render,
// do something, then ask how many times it advanced.
const HARNESS_JS = `
window.__advances = 0;
window.__render = function (renderer, post) {
  const container = document.getElementById("content-container");
  if (window.__cleanup) window.__cleanup();
  window.__advances = 0;
  window.__cleanup = renderer.render(post, container, () => window.__advances++);
};
`;

const MIME = { ".webm": "video/webm", ".png": "image/png" };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split("?")[0];
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(PAGE_HTML);
        return;
      }
      // A blank page for embeds to load, same-origin so `load` actually fires.
      if (url === "/embed") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<!DOCTYPE html><body>embed</body>");
        return;
      }
      const fixture = path.join(FIXTURES, path.basename(url));
      const type = MIME[path.extname(url)];
      if (type && fs.existsSync(fixture)) {
        const body = fs.readFileSync(fixture);
        res.writeHead(200, { "Content-Type": type, "Content-Length": body.length });
        res.end(body);
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

const imagePost = (id, url = "/still.png") => ({ id, type: "image", title: id, mediaUrl: url });

// The fake clock fires timers instantly, but an image retry's reload is a real
// network request. Jumping the clock alone never lets that reload land — which
// would hide the very bug these tests exist for, since the leak only shows
// when a reload completes after teardown. So the clock is nudged in steps with
// real time in between.
async function settle(page, total = 8000, step = 600) {
  for (let elapsed = 0; elapsed < total; elapsed += step) {
    await page.clock.runFor(step);
    await page.waitForTimeout(120);
  }
}

async function newPage(browser, baseUrl, { fakeClock = true } = {}) {
  const page = await browser.newPage();
  if (fakeClock) await page.clock.install();
  await page.goto(baseUrl + "/");
  await page.addScriptTag({ content: IMAGE_RENDERER });
  await page.addScriptTag({ content: VIDEO_RENDERER });
  await page.addScriptTag({ content: EMBED_RENDERER });
  await page.addScriptTag({ content: HARNESS_JS });
  return page;
}

async function main() {
  const { server, port } = await startServer();
  const baseUrl = `http://localhost:${port}`;
  console.log(`Fixture server at ${baseUrl}\n`);

  const playwright = require("playwright");
  const browser = await playwright.firefox.launch({
    headless: true,
    firefoxUserPrefs: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 },
  });

  try {
    // ================================================================
    // TEST 1: a still gets its full time, once
    // ================================================================
    console.log("Test: a still advances once, after its own five seconds");
    {
      const page = await newPage(browser, baseUrl);
      await page.evaluate(() => window.__render(ImageRenderer, { id: "a", type: "image", title: "a", mediaUrl: "/still.png" }));
      await page.waitForFunction(() => !!document.querySelector("img.loaded"));

      await page.clock.runFor(4000);
      assert((await page.evaluate(() => window.__advances)) === 0, "Has not advanced at 4s");

      await page.clock.runFor(1500);
      assert((await page.evaluate(() => window.__advances)) === 1, "Advanced at 5s");

      await page.clock.runFor(30000);
      assert((await page.evaluate(() => window.__advances)) === 1, "Advances exactly once, not repeatedly");

      await page.close();
    }

    // ================================================================
    // TEST 2: the leak — a torn-down still must never advance
    // ================================================================
    // Teardown sets src="" which fires `error`; that used to schedule a retry,
    // whose reload fired `load`, which armed a five-second advance against the
    // slide that had replaced this one.
    console.log("\nTest: a still torn down early never advances");
    {
      const page = await newPage(browser, baseUrl);
      await page.evaluate(() => window.__render(ImageRenderer, { id: "a", type: "image", title: "a", mediaUrl: "/still.png" }));
      await page.waitForFunction(() => !!document.querySelector("img.loaded"));

      await page.clock.runFor(1000);
      await page.evaluate(() => window.__cleanup());
      await settle(page, 12000);

      assert((await page.evaluate(() => window.__advances)) === 0, "No advance after teardown, even a minute later");
      await page.close();
    }

    // ================================================================
    // TEST 3: every still gets the same time, regardless of what preceded it
    // ================================================================
    // "Galleries aren't showing for a uniform amount of time" was this: a
    // leftover timer from an earlier image cut the next one short.
    console.log("\nTest: consecutive stills each get the full five seconds");
    {
      const page = await newPage(browser, baseUrl);

      // Three in a row, as a gallery does, each left after a second.
      for (const id of ["g1", "g2"]) {
        await page.evaluate((post) => window.__render(ImageRenderer, post), imagePost(id));
        await page.waitForFunction(() => !!document.querySelector("img.loaded"));
        await page.clock.runFor(1000);
      }

      await page.evaluate((post) => window.__render(ImageRenderer, post), imagePost("g3"));
      await page.waitForFunction(() => !!document.querySelector("img.loaded"));

      await page.clock.runFor(4000);
      assert(
        (await page.evaluate(() => window.__advances)) === 0,
        "Third still is not cut short by the two before it"
      );

      await page.clock.runFor(1500);
      assert((await page.evaluate(() => window.__advances)) === 1, "Third still advances on its own five seconds");

      await page.close();
    }

    // ================================================================
    // TEST 4: a still that cannot load retries, then advances
    // ================================================================
    console.log("\nTest: an unloadable still retries, then advances on the error grace");
    {
      const page = await newPage(browser, baseUrl);
      await page.evaluate((post) => window.__render(ImageRenderer, post), imagePost("bad", "/missing.png"));

      // Two retries, at 500ms and 1000ms. Each reload is a real request, so
      // the clock is nudged forward in steps with real time in between for the
      // 404 to actually come back.
      let failedShown = false;
      for (let i = 0; i < 12 && !failedShown; i++) {
        await page.clock.runFor(600);
        await page.waitForTimeout(120);
        failedShown = await page.evaluate(() =>
          document.getElementById("content-container").textContent.includes("Failed")
        );
      }
      assert(failedShown, "Reports the failure after its retries");

      await page.clock.runFor(2500);
      assert((await page.evaluate(() => window.__advances)) === 1, "Advances after the error grace");
      await page.close();
    }

    // ================================================================
    // TEST 5: a still torn down mid-retry never advances
    // ================================================================
    // The retry timer was never cleared, so it fired after teardown, restored
    // the src, and armed an advance from a renderer that no longer existed.
    console.log("\nTest: a still torn down mid-retry never advances");
    {
      const page = await newPage(browser, baseUrl);
      await page.evaluate((post) => window.__render(ImageRenderer, post), imagePost("bad", "/missing.png"));

      await page.clock.runFor(600); // first retry scheduled and fired
      await page.evaluate(() => window.__cleanup());
      await settle(page, 12000);

      assert((await page.evaluate(() => window.__advances)) === 0, "No advance from a torn-down retry");
      await page.close();
    }

    // ================================================================
    // TEST 6: an embed's fallback timer dies with it
    // ================================================================
    console.log("\nTest: a torn-down embed never advances");
    {
      const page = await newPage(browser, baseUrl);
      await page.evaluate(() => window.__render(EmbedRenderer, { id: "e", type: "embed", title: "e", mediaUrl: "/embed" }));

      await page.clock.runFor(1000);
      await page.evaluate(() => window.__cleanup());
      await settle(page, 20000);

      assert((await page.evaluate(() => window.__advances)) === 0, "No advance from a torn-down embed");
      await page.close();
    }

    // ================================================================
    // TEST 7: an embed ignores end events from other windows
    // ================================================================
    // Reddit's own scripts postMessage constantly; one shaped like an end
    // event used to advance the slide.
    console.log("\nTest: an embed ignores end events it did not send");
    {
      const page = await newPage(browser, baseUrl);
      await page.evaluate(() => window.__render(EmbedRenderer, { id: "e", type: "embed", title: "e", mediaUrl: "/embed" }));

      await page.evaluate(() => {
        window.postMessage({ type: "ended" }, "*");
        window.postMessage({ ended: true }, "*");
        window.postMessage(JSON.stringify({ event: "onStateChange", info: 0 }), "*");
      });
      await page.clock.runFor(1000);

      assert((await page.evaluate(() => window.__advances)) === 0, "Foreign end events are ignored");
      await page.close();
    }

    // ================================================================
    // TEST 8: video advances on real playback ending, and not before
    // ================================================================
    // Real time here: no fake clock can make a video finish.
    console.log("\nTest: a video advances when playback actually ends");
    {
      const page = await newPage(browser, baseUrl, { fakeClock: false });
      await page.evaluate(() => window.__render(VideoRenderer, { id: "v", type: "video", title: "v", mediaUrl: "/audio.webm", hasAudio: true }));

      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2;
      });
      const duration = await page.evaluate(() => document.querySelector("video").duration);
      assert(duration > 1, `Fixture is long enough to be meaningful (${duration.toFixed(2)}s)`);

      await page.waitForTimeout(700);
      assert((await page.evaluate(() => window.__advances)) === 0, "Has not advanced partway through");

      await page.waitForFunction(() => window.__advances > 0, null, { timeout: 8000 }).catch(() => {});
      const state = await page.evaluate(() => ({
        advances: window.__advances,
        at: document.querySelector("video") ? document.querySelector("video").currentTime : null,
      }));
      assert(state.advances === 1, `Advanced once, at the end (advances=${state.advances}, t=${state.at})`);

      await page.close();
    }

    // ================================================================
    // TEST 9: a video torn down mid-playback never advances
    // ================================================================
    console.log("\nTest: a video torn down mid-playback never advances");
    {
      const page = await newPage(browser, baseUrl, { fakeClock: false });
      await page.evaluate(() => window.__render(VideoRenderer, { id: "v", type: "video", title: "v", mediaUrl: "/audio.webm", hasAudio: true }));
      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2;
      });

      await page.waitForTimeout(300);
      await page.evaluate(() => window.__cleanup());
      await page.waitForTimeout(4000);

      assert((await page.evaluate(() => window.__advances)) === 0, "No advance after teardown");
      await page.close();
    }

    // ================================================================
    // TEST 10: leaving a still for a video gives the video its own run
    // ================================================================
    // This is arrow-key navigation: the timing of the slide you land on must
    // come from that slide, never from the one you left.
    console.log("\nTest: navigating from a still to a video hands timing to the video");
    {
      const page = await newPage(browser, baseUrl, { fakeClock: false });
      await page.evaluate(() => window.__render(ImageRenderer, { id: "i", type: "image", title: "i", mediaUrl: "/still.png" }));
      await page.waitForFunction(() => !!document.querySelector("img.loaded"));
      await page.waitForTimeout(300);

      // The arrow key: straight to the next post.
      await page.evaluate(() => window.__render(VideoRenderer, { id: "v", type: "video", title: "v", mediaUrl: "/audio.webm", hasAudio: true }));
      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2;
      });

      // Comfortably past the still's five seconds, short of the clip's end.
      await page.waitForTimeout(1200);
      const early = await page.evaluate(() => window.__advances);
      assert(early === 0, `Video is not cut short by the still it replaced (advances=${early})`);

      await page.close();
    }
    // ================================================================
    // TEST 11: an unplayable video retries, then falls back to its player
    // ================================================================
    // A blip mid-buffer looks exactly like a bad file, so one retry separates
    // them. If it really cannot be played the post is handed to the player it
    // was resolved from, rather than shown as an error and skipped.
    console.log("\nTest: an unplayable video retries, then falls back");
    {
      const page = await newPage(browser, baseUrl, { fakeClock: false });

      const withFallback = await page.evaluate(async () => {
        const container = document.getElementById("content-container");
        let failed = 0;
        const cleanup = VideoRenderer.render(
          { id: "v", type: "video", title: "v", mediaUrl: "/missing.webm", embedUrl: "/embed" },
          container,
          null,
          () => failed++
        );
        await new Promise((r) => setTimeout(r, 3000));
        const text = container.textContent;
        cleanup();
        return { failed, showsError: text.includes("Failed") };
      });

      assert(withFallback.failed === 1, `Falls back exactly once (got ${withFallback.failed})`);
      assert(!withFallback.showsError, "Does not show an error when a fallback exists");

      // With no fallback the old behaviour stands: report it, then move on.
      const withoutFallback = await page.evaluate(async () => {
        const container = document.getElementById("content-container");
        let advances = 0;
        const cleanup = VideoRenderer.render(
          { id: "v2", type: "video", title: "v2", mediaUrl: "/missing.webm" },
          container,
          () => advances++
        );
        await new Promise((r) => setTimeout(r, 4000));
        const text = container.textContent;
        cleanup();
        return { advances, showsError: text.includes("Failed") };
      });

      assert(withoutFallback.showsError, "Reports the failure when there is nothing to fall back to");
      assert(withoutFallback.advances === 1, `Still advances so auto-advance is not stranded (got ${withoutFallback.advances})`);

      await page.close();
    }

    // ================================================================
    // TEST 12: a gif is timed like a still, not like a video
    // ================================================================
    // Gallery items and .gifv are gifs re-encoded as mp4. Advancing them on
    // `ended` meant an eight-item gallery of 1.2s clips was gone in ten
    // seconds, while a single photo next to it sat for five. They loop, and
    // they get the still dwell — but never less than one full play.
    console.log("\nTest: a gif loops and takes the still dwell, not `ended`");
    {
      const page = await newPage(browser, baseUrl, { fakeClock: false });
      await page.evaluate(() =>
        window.__render(VideoRenderer, {
          id: "g", type: "video", title: "g", mediaUrl: "/silent.webm", isGif: true, hasAudio: false,
        })
      );
      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2;
      });

      const shape = await page.evaluate(() => {
        const v = document.querySelector("video");
        return { loop: v.loop, controls: v.controls, muted: v.muted, duration: v.duration };
      });
      assert(shape.loop === true, "A gif loops even with auto-advance waiting on it");
      assert(shape.controls === false, "A gif has no scrub bar");
      assert(shape.muted === true, "A gif starts muted, so no 'click for sound' prompt for silence");
      assert(shape.duration < 4, `Fixture is shorter than the dwell (${shape.duration.toFixed(2)}s)`);

      // Well past the clip's own end: advancing here would be the `ended`
      // behaviour this replaces.
      await page.waitForTimeout(3000);
      assert(
        (await page.evaluate(() => window.__advances)) === 0,
        "Has not advanced at the end of the first loop"
      );

      await page.waitForFunction(() => window.__advances > 0, null, { timeout: 6000 }).catch(() => {});
      assert(
        (await page.evaluate(() => window.__advances)) === 1,
        "Advances once, on the dwell"
      );

      await page.close();
    }

    // ================================================================
    // TEST 13: a torn-down gif never advances
    // ================================================================
    // The gif path adds a timer of its own, and every timer in this file has
    // to die with the renderer that armed it.
    console.log("\nTest: a gif torn down before its dwell never advances");
    {
      const page = await newPage(browser, baseUrl, { fakeClock: false });
      await page.evaluate(() =>
        window.__render(VideoRenderer, {
          id: "g", type: "video", title: "g", mediaUrl: "/silent.webm", isGif: true, hasAudio: false,
        })
      );
      await page.waitForFunction(() => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2;
      });

      await page.waitForTimeout(300);
      await page.evaluate(() => window.__cleanup());
      await page.waitForTimeout(6000);

      assert((await page.evaluate(() => window.__advances)) === 0, "No advance after teardown");
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
