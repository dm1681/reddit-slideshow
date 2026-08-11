// Regression test: v.redd.it videos must resolve via DASHPlaylist.mpd.
// Reddit renamed renditions from DASH_<res>.mp4 to CMAF_<res>.mp4 (June 2026)
// and direct requests to the old names return 403 — so filename guessing is
// dead. The scraper hands the renderer a bare v.redd.it URL; the renderer
// fetches the playlist and picks the highest-bandwidth video rendition.
// Run via: node test/test-vreddit.js

const fs = require("fs");
const path = require("path");

const CONTENT_SCRIPT = fs.readFileSync(path.join(__dirname, "..", "content", "overlay.js"), "utf8");
const VIDEO_RENDERER = fs.readFileSync(path.join(__dirname, "..", "slideshow", "renderers", "video.js"), "utf8");

// Trimmed from a real v.redd.it DASHPlaylist.mpd (June 2026 CMAF era)
const SAMPLE_MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT8.198S" type="static">
  <Period duration="PT8.198S" id="0">
    <AdaptationSet contentType="video" id="0" maxHeight="854" maxWidth="480">
      <Representation bandwidth="830982" codecs="avc1.4d401e" height="640" id="2" mimeType="video/mp4" width="360">
        <BaseURL>CMAF_360.mp4</BaseURL>
      </Representation>
      <Representation bandwidth="1192132" codecs="avc1.4d401f" height="854" id="3" mimeType="video/mp4" width="480">
        <BaseURL>CMAF_480.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" id="1">
      <Representation audioSamplingRate="48000" bandwidth="65946" codecs="mp4a.40.2" id="4" mimeType="audio/mp4">
        <BaseURL>CMAF_AUDIO_64.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

function extractScrapeCode() {
  const marker = "// --- Scroll to load more ---";
  let section = CONTENT_SCRIPT.substring(0, CONTENT_SCRIPT.indexOf(marker)).trim();
  section = section.replace(/^\/\/[^\n]*\n+let overlayElement[^\n]*\nlet savedOverflow[^\n]*\n+\/\/ --- DOM scraping ---\n*/m, "");
  return section;
}

let passed = 0;
let failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}`); failed++; }
}

async function main() {
  const playwright = require("playwright");
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("about:blank");

  // ================================================================
  // TEST 1: classifyPost hands v.redd.it posts over as bare base URLs
  // ================================================================
  console.log("Test: classifyPost for v.redd.it posts");

  const classifyResults = await page.evaluate((code) => {
    // eval is safe here: our own extension source read from disk.
    eval(code);

    function make(html) {
      const div = document.createElement("div");
      // innerHTML is safe here: fixture markup from string literals below,
      // in a throwaway about:blank test page — no untrusted input.
      div.innerHTML = html;
      return div.firstElementChild;
    }

    return {
      bare: classifyPost(make(
        `<shreddit-post id="t3_x" post-type="video" content-href="https://v.redd.it/abc123"></shreddit-post>`
      )),
      withBlobPlayer: classifyPost(make(
        `<shreddit-post id="t3_y" post-type="video" content-href="https://v.redd.it/def456">
           <video src="blob:https://www.reddit.com/0000-1111"></video>
         </shreddit-post>`
      )),
      withDirectMp4: classifyPost(make(
        `<shreddit-post id="t3_z" post-type="video" content-href="https://v.redd.it/ghi789">
           <video src="https://packaged-media.redd.it/ghi789/m2-res_854p.mp4?token=t"></video>
         </shreddit-post>`
      )),
    };
  }, extractScrapeCode());

  const { bare, withBlobPlayer, withDirectMp4 } = classifyResults;
  assert(bare && bare.type === "video", "Bare v.redd.it post classified as video");
  assert(
    bare && bare.mediaUrl === "https://v.redd.it/abc123",
    `Bare v.redd.it mediaUrl is the base URL, no filename guess (got ${bare && bare.mediaUrl})`
  );
  assert(
    withBlobPlayer && withBlobPlayer.mediaUrl === "https://v.redd.it/def456",
    `blob: player src ignored, base URL used (got ${withBlobPlayer && withBlobPlayer.mediaUrl})`
  );
  assert(
    withDirectMp4 && withDirectMp4.mediaUrl.startsWith("https://packaged-media.redd.it/"),
    `Real https mp4 src from DOM is kept (got ${withDirectMp4 && withDirectMp4.mediaUrl})`
  );

  // ================================================================
  // TEST 2: VideoRenderer resolves bare v.redd.it URL via the MPD
  // ================================================================
  console.log("\nTest: VideoRenderer resolves rendition from DASHPlaylist.mpd");

  let mpdRequested = false;
  await page.route("https://v.redd.it/**", (route) => {
    const url = route.request().url();
    // ACAO header: the test page fetches cross-origin; the real extension
    // has host permission for *.redd.it and doesn't need it.
    const cors = { "access-control-allow-origin": "*" };
    if (url.endsWith("/DASHPlaylist.mpd")) {
      mpdRequested = true;
      return route.fulfill({ status: 200, contentType: "application/dash+xml", headers: cors, body: SAMPLE_MPD });
    }
    // Rendition files: respond OK so the <video> element doesn't error the test
    return route.fulfill({ status: 200, contentType: "video/mp4", headers: cors, body: "" });
  });

  await page.setContent(`<div id="content-container"></div>`);
  await page.addScriptTag({ content: VIDEO_RENDERER });

  const videoSrc = await page.evaluate(async () => {
    const container = document.getElementById("content-container");
    // The mock rendition (empty body) makes the <video> fire `error` right
    // after src is set, which removes it from the DOM — so capture the src
    // the instant it appears rather than polling.
    const srcPromise = new Promise((resolve) => {
      const obs = new MutationObserver(() => {
        const v = container.querySelector("video");
        if (v && v.getAttribute("src")) {
          obs.disconnect();
          resolve(v.getAttribute("src"));
        }
      });
      obs.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
      setTimeout(() => {
        obs.disconnect();
        resolve(`(no video src after 5s — container says: ${container.textContent})`);
      }, 5000);
    });
    VideoRenderer.render(
      { id: "t3_x", title: "vid", type: "video", mediaUrl: "https://v.redd.it/abc123" },
      container,
      null
    );
    return srcPromise;
  });

  assert(mpdRequested, "Renderer fetched DASHPlaylist.mpd");
  assert(
    videoSrc === "https://v.redd.it/abc123/CMAF_480.mp4",
    `Renderer picked highest-bandwidth video rendition (got ${videoSrc})`
  );

  // ================================================================
  // TEST 3: direct mp4 URLs still play without an MPD fetch
  // ================================================================
  console.log("\nTest: direct mp4 mediaUrl bypasses MPD resolution");

  mpdRequested = false;
  const directSrc = await page.evaluate(async () => {
    const container = document.getElementById("content-container");
    VideoRenderer.render(
      { id: "t3_d", title: "direct", type: "video", mediaUrl: "https://i.imgur.com/cat.mp4" },
      container,
      null
    );
    for (let i = 0; i < 20; i++) {
      const v = container.querySelector("video");
      if (v && v.getAttribute("src")) return v.getAttribute("src");
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  });

  assert(directSrc === "https://i.imgur.com/cat.mp4", `Direct mp4 src set immediately (got ${directSrc})`);
  assert(!mpdRequested, "No MPD fetch for direct mp4");

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
