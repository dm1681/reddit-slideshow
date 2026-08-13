// Regression test: redgifs posts must reach the viewer as an audible <video>.
//
// They used to play through the cross-origin embed iframe — redgifs' own
// player, which always boots muted and cannot be unmuted from outside — for the
// whole first batch, because the slideshow snapshots its post list before the
// background finishes resolving them. This covers the two halves of the fix
// that only exist in the DOM:
//
//   1. The video renderer's audio handling: the volume choice survives the
//      fresh <video> every slide builds, silent clips start muted, and a
//      blocked audible autoplay gets muted playback plus a prompt rather than a
//      stalled video.
//   2. The slideshow's `postsUpdated` listener: a late resolution swaps the
//      post in, but re-renders only when the post on screen actually changed,
//      so it never restarts playback under the viewer.
//
// The background half — resolving and broadcasting — is covered by
// test-start-race.js, which needs no DOM.
//
// Runs in Firefox, since the extension is Firefox-only. Fixtures are
// VP8/Vorbis WebM so decoding never depends on system codecs.
//
// One thing is simulated rather than real: Playwright's Firefox build allows
// autoplay unconditionally — `media.autoplay.default=1` has no effect on it —
// so the block is imposed at the play() boundary instead, rejecting an audible
// start with NotAllowedError until the document has user activation. That is
// the rule Firefox applies and the only part of it the renderer can see.
//
// Run via: node test/test-audio-continuity.js

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");

const VIDEO_RENDERER = fs.readFileSync(path.join(ROOT, "slideshow", "renderers", "video.js"), "utf8");
const IMAGE_RENDERER = fs.readFileSync(path.join(ROOT, "slideshow", "renderers", "image.js"), "utf8");
const EMBED_RENDERER = fs.readFileSync(path.join(ROOT, "slideshow", "renderers", "embed.js"), "utf8");
const SLIDESHOW_JS = fs.readFileSync(path.join(ROOT, "slideshow", "slideshow.js"), "utf8");

const AUTOPLAY_ALLOWED = { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 };

// Firefox refuses an audible start until the document has been interacted
// with, and surfaces that as a rejected play() promise. Muted playback is
// always allowed, and a gesture lifts the block for the rest of the page.
// navigator.userActivation is no help here — Playwright's Firefox reports a
// document as already activated — so activation is tracked from real events.
// Capture phase, so it is set before the renderer's own gesture handler runs
// and calls play() during that same dispatch.
const BLOCK_AUDIBLE_AUTOPLAY = `
(function () {
  let activated = false;
  const activate = (e) => { if (e.isTrusted) activated = true; };
  document.addEventListener("pointerdown", activate, true);
  document.addEventListener("keydown", activate, true);

  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!this.muted && !activated) {
      return Promise.reject(
        new DOMException("play() failed because the user didn't interact with the document first", "NotAllowedError")
      );
    }
    return realPlay.call(this);
  };
})();
`;

// The renderers only need the container; the rest are the ids slideshow.js
// looks up on load.
const PAGE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>renderer harness</title></head>
<body style="margin:0">
  <div id="top-bar"><span id="progress">0 / 0</span>
    <button id="upvote-btn"></button>
    <button id="downvote-btn"></button>
    <button id="save-btn"></button>
    <button id="auto-advance-btn"></button>
    <button id="popout-btn"></button>
    <button id="close-btn"></button>
  </div>
  <button id="prev-btn"></button>
  <button id="next-btn"></button>
  <div id="content-container" style="position:relative;width:640px;height:360px"></div>
  <div id="post-info"><div id="post-title" style="padding:20px">title</div><div id="post-meta"></div></div>
  <div id="progress-bar"><div id="progress-bar-fill"></div></div>
</body></html>`;

// Renders a post and settles before assertions, so nothing races the media
// pipeline or the play() promise the muted fallback hangs off.
const HARNESS_JS = `
window.__renderAndSettle = async function (post) {
  const container = document.getElementById("content-container");
  if (window.__cleanup) window.__cleanup();
  window.__cleanup = VideoRenderer.render(post, container);
  const video = container.querySelector("video");
  await new Promise((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.addEventListener("loadeddata", resolve, { once: true });
    video.addEventListener("error", resolve, { once: true });
    setTimeout(resolve, 5000);
  });
  // attemptPlay only reacts once the rejection lands, so give it a turn.
  await new Promise((r) => setTimeout(r, 400));
  return {
    muted: video.muted,
    volume: video.volume,
    paused: video.paused,
    readyState: video.readyState,
    hint: (container.querySelector("div[style*='translateX']") || {}).textContent || null,
    stored: localStorage.getItem("reddit-slideshow.audio"),
  };
};
`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split("?")[0];
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(PAGE_HTML);
        return;
      }
      const fixture = path.join(FIXTURES, path.basename(url));
      if (url.endsWith(".webm") && fs.existsSync(fixture)) {
        const body = fs.readFileSync(fixture);
        res.writeHead(200, { "Content-Type": "video/webm", "Content-Length": body.length });
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

function audioPost(id) {
  return { id, type: "video", title: `post ${id}`, mediaUrl: "/audio.webm", hasAudio: true };
}

const RESOLVED_POSTS = [
  { id: "t3_aaa", type: "video", title: "redgifs post", mediaUrl: "/audio.webm", hasAudio: true },
  { id: "t3_bbb", type: "image", title: "second", mediaUrl: "/nope.png" },
];

async function newHarnessPage(browser, baseUrl) {
  const page = await browser.newPage();
  await page.goto(baseUrl + "/");
  await page.addScriptTag({ content: VIDEO_RENDERER });
  await page.addScriptTag({ content: HARNESS_JS });
  return page;
}

async function main() {
  const { server, port } = await startServer();
  const baseUrl = `http://localhost:${port}`;
  console.log(`Fixture server at ${baseUrl}\n`);

  const playwright = require("playwright");

  const permissive = await playwright.firefox.launch({
    headless: true,
    firefoxUserPrefs: AUTOPLAY_ALLOWED,
  });

  try {
    // ================================================================
    // TEST 1: the volume choice survives the next slide
    // ================================================================
    // Each post builds a fresh <video>, so without an out-of-element
    // preference the viewer re-unmutes on every single slide.
    console.log("Test: audio preference persists across slides");
    {
      const page = await newHarnessPage(permissive, baseUrl);

      const first = await page.evaluate((p) => window.__renderAndSettle(p), audioPost("a"));
      assert(first.readyState >= 2, `Fixture video loaded (readyState=${first.readyState})`);
      assert(first.muted === false, "First video starts unmuted");
      assert(first.paused === false, "First video is playing");

      // Stands in for the viewer dragging the native volume slider.
      await page.evaluate(() => {
        document.querySelector("video").volume = 0.35;
      });

      const second = await page.evaluate((p) => window.__renderAndSettle(p), audioPost("b"));
      // Tearing down the previous <video> fires a late error event; if its
      // handler is still live it wipes the slide that replaced it.
      assert(second.readyState >= 2, "Leaving a video slide does not break the next one");
      assert(second.volume === 0.35, `Next slide keeps volume 0.35 (got ${second.volume})`);
      assert(second.muted === false, "Next slide stays unmuted");

      await page.evaluate(() => {
        document.querySelector("video").muted = true;
      });

      const third = await page.evaluate((p) => window.__renderAndSettle(p), audioPost("c"));
      assert(third.muted === true, "Next slide keeps the viewer's mute");

      // Persisted, so the choice also survives closing and reopening.
      await page.reload();
      await page.addScriptTag({ content: VIDEO_RENDERER });
      await page.addScriptTag({ content: HARNESS_JS });
      const reloaded = await page.evaluate((p) => window.__renderAndSettle(p), audioPost("d"));
      assert(
        reloaded.muted === true && reloaded.volume === 0.35,
        `Preference survives a page load (muted=${reloaded.muted}, volume=${reloaded.volume})`
      );

      await page.close();
    }

    // ================================================================
    // TEST 2: a silent clip starts muted without losing the preference
    // ================================================================
    // hasAudio comes from the redgifs API. Muting a silent clip keeps it clear
    // of the audible-autoplay block, but it is our mute, not the viewer's.
    console.log("\nTest: silent posts start muted, preference untouched");
    {
      const page = await newHarnessPage(permissive, baseUrl);

      await page.evaluate((p) => window.__renderAndSettle(p), audioPost("a"));
      const silent = await page.evaluate((p) => window.__renderAndSettle(p), {
        id: "s",
        type: "video",
        title: "silent",
        mediaUrl: "/silent.webm",
        hasAudio: false,
      });
      assert(silent.muted === true, "Silent post starts muted");
      assert(
        !silent.stored || JSON.parse(silent.stored).muted === false,
        `Auto-mute is not written to the preference (stored=${silent.stored})`
      );

      const afterSilent = await page.evaluate((p) => window.__renderAndSettle(p), audioPost("e"));
      assert(afterSilent.muted === false, "The post after a silent one plays with sound");

      await page.close();
    }

    // ================================================================
    // TEST 3: blocked audible autoplay degrades to muted playback
    // ================================================================
    // The old code left the video paused. Now it plays muted, says so, and
    // restores sound on the first click or keypress anywhere on the page.
    console.log("\nTest: blocked audible autoplay falls back to muted playback");
    {
      const page = await permissive.newPage();
      await page.goto(baseUrl + "/");
      await page.addScriptTag({ content: BLOCK_AUDIBLE_AUTOPLAY });
      await page.addScriptTag({ content: VIDEO_RENDERER });
      await page.addScriptTag({ content: HARNESS_JS });

      const blocked = await page.evaluate((p) => window.__renderAndSettle(p), audioPost("a"));
      assert(blocked.paused === false, "Video plays despite the autoplay block");
      assert(blocked.muted === true, "Blocked video falls back to muted");
      assert(
        blocked.hint && blocked.hint.includes("for sound"),
        `Viewer is prompted for sound (got ${JSON.stringify(blocked.hint)})`
      );
      assert(
        !blocked.stored || JSON.parse(blocked.stored).muted === false,
        `Policy mute is not written to the preference (stored=${blocked.stored})`
      );

      // A real click, so Firefox registers genuine user activation. Clicking
      // the video itself is deliberately ignored by the handler, so this aims
      // elsewhere on the page.
      await page.click("#post-title");
      await page.waitForTimeout(400);

      const restored = await page.evaluate(() => {
        const container = document.getElementById("content-container");
        const video = container.querySelector("video");
        return {
          muted: video.muted,
          paused: video.paused,
          hint: !!container.querySelector("div[style*='translateX']"),
        };
      });
      assert(restored.muted === false, "Sound is restored on the first gesture");
      assert(restored.paused === false, "Video keeps playing after the gesture");
      assert(restored.hint === false, "Prompt is removed once sound is restored");

      await page.close();
    }

    // ================================================================
    // TEST 4: a late resolution swaps the post in without interrupting
    // ================================================================
    // The real slideshow controller, driven through the message its listener
    // expects from the background.
    console.log("\nTest: postsUpdated swaps the post in, re-rendering only on a change");
    {
      const page = await permissive.newPage();
      await page.goto(baseUrl + "/");

      // The controller runs on load, so the browser stub has to exist first.
      await page.evaluate(() => {
        window.__listeners = [];
        window.browser = {
          runtime: {
            sendMessage: async (msg) => (msg.type === "getCurrentState" ? window.__state : {}),
            onMessage: { addListener: (fn) => window.__listeners.push(fn) },
            getURL: (p) => p,
          },
        };
        window.__state = {
          posts: [
            {
              id: "t3_aaa",
              type: "embed",
              title: "redgifs post",
              // Stands in for the cross-origin redgifs player; what matters is
              // that it is an iframe, not what it loads.
              mediaUrl: "about:blank",
            },
            { id: "t3_bbb", type: "image", title: "second", mediaUrl: "/nope.png" },
          ],
          currentIndex: 0,
          exhausted: true,
        };
      });

      await page.addScriptTag({ content: IMAGE_RENDERER });
      await page.addScriptTag({ content: VIDEO_RENDERER });
      await page.addScriptTag({ content: EMBED_RENDERER });
      await page.addScriptTag({ content: SLIDESHOW_JS });
      await page.waitForTimeout(300);

      const before = await page.evaluate(
        () => !!document.querySelector("#content-container iframe")
      );
      assert(before, "Unresolved redgifs post renders as the embed iframe");

      // The background finishes resolving and broadcasts. It updates its own
      // session first, so a getCurrentState pull sees the same list.
      const swapped = await page.evaluate(async (resolved) => {
        window.__state.posts = resolved;
        window.__listeners.forEach((fn) => fn({ type: "postsUpdated", posts: resolved }));
        await new Promise((r) => setTimeout(r, 1500));
        const video = document.querySelector("#content-container video");
        if (video) video.__marked = true;
        return {
          hasVideo: !!video,
          hasIframe: !!document.querySelector("#content-container iframe"),
          muted: video ? video.muted : null,
          paused: video ? video.paused : null,
        };
      }, RESOLVED_POSTS);
      assert(swapped.hasVideo, "Resolved post re-renders as a native <video>");
      assert(!swapped.hasIframe, "The muted embed iframe is gone");
      assert(swapped.muted === false, "The swapped-in video plays with sound");
      assert(swapped.paused === false, "The swapped-in video is playing");

      // A second, identical broadcast must not touch what is on screen.
      const repeat = await page.evaluate(async (same) => {
        const previous = document.querySelector("#content-container video");
        const timeBefore = previous.currentTime;
        window.__listeners.forEach((fn) => fn({ type: "postsUpdated", posts: same }));
        await new Promise((r) => setTimeout(r, 500));
        const after = document.querySelector("#content-container video");
        return {
          sameElement: !!after && after.__marked === true,
          advanced: !!after && after.currentTime >= timeBefore,
          paused: !!after && after.paused,
        };
      }, RESOLVED_POSTS);
      assert(repeat.sameElement, "An unchanged post keeps the same <video> element");
      assert(repeat.advanced, "Playback position is not reset");
      assert(!repeat.paused, "Playback is not interrupted");

      await page.close();
    }
    // ================================================================
    // TEST 5: a video that fails to load must not strand auto-advance
    // ================================================================
    // Auto-advance rides the `ended` event, which a video that never loads
    // never fires — so the slideshow used to stop there permanently.
    console.log("\nTest: a failed video still advances when auto-advance is on");
    {
      const page = await newHarnessPage(permissive, baseUrl);

      const advanced = await page.evaluate(async () => {
        const container = document.getElementById("content-container");
        let advances = 0;
        const cleanup = VideoRenderer.render(
          { id: "broken", type: "video", title: "broken", mediaUrl: "/does-not-exist.webm" },
          container,
          () => advances++
        );
        await new Promise((r) => setTimeout(r, 3000));
        const text = container.textContent;
        cleanup();
        return { advances, text };
      });

      assert(advanced.text.includes("Failed to load"), `Broken video reports the failure (got ${JSON.stringify(advanced.text)})`);
      assert(advanced.advances === 1, `Auto-advance moves on from a broken video (advanced ${advanced.advances} times)`);

      // The queued advance belongs to a slide that no longer exists.
      const afterTeardown = await page.evaluate(async () => {
        const container = document.getElementById("content-container");
        let advances = 0;
        const cleanup = VideoRenderer.render(
          { id: "broken2", type: "video", title: "broken", mediaUrl: "/also-missing.webm" },
          container,
          () => advances++
        );
        await new Promise((r) => setTimeout(r, 300));
        cleanup();
        await new Promise((r) => setTimeout(r, 3000));
        return advances;
      });

      assert(afterTeardown === 0, `A torn-down slide never advances (advanced ${afterTeardown} times)`);

      await page.close();
    }
  } finally {
    await permissive.close();
    server.close();
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
