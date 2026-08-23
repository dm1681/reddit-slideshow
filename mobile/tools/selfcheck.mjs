// Functional self-check: drives the served app in phone-shaped Chromium and
// asserts the ported invariants actually hold in the running feed —
// above all the gate's network rule: a masked post's media file is NEVER
// requested until the viewer reveals it.
//
// Launches with --autoplay-policy=user-gesture-required so the audible-
// autoplay path behaves like a phone, not like permissive headless defaults.
import { chromium } from "playwright";

const BASE = process.env.REEL_URL || "http://localhost:4173/";
const failures = [];
let checks = 0;

function check(name, ok, detail = "") {
  checks++;
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const launchArgs = { args: ["--autoplay-policy=user-gesture-required"] };
let browser;
try {
  browser = await chromium.launch(launchArgs);
} catch {
  browser = await chromium.launch({
    ...launchArgs,
    executablePath: "/opt/pw-browsers/chromium",
  });
}
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

const requested = [];
page.on("request", (r) => requested.push(r.url()));
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const snap = () =>
  page.evaluate(() => {
    const active = document.querySelector(".slide.active");
    const video = active && active.querySelector("video");
    return {
      slides: document.querySelectorAll(".slide:not(.endslide)").length,
      counter: document.getElementById("counter").textContent,
      activeClass: active ? active.className : null,
      activeId: active ? active.dataset.postId : null,
      video: video
        ? { paused: video.paused, muted: video.muted, src: video.currentSrc }
        : null,
      soundPill: !!(active && active.querySelector(".soundhint")),
      gatecard: !!(active && active.querySelector(".gatecard")),
      videoCount: document.querySelectorAll("video").length,
    };
  });

const goTo = async (index) => {
  await page.evaluate((i) => window.__reel.pager.scrollToIndex(i), index);
  await page.waitForTimeout(900);
};

await page.goto(BASE);
await page.waitForTimeout(2200);

// ---- boot ----
{
  const s = await snap();
  check("boots with slides", s.slides >= 8, JSON.stringify(s));
  check("honest counter with +", /^1 \/ \d+\+$/.test(s.counter), s.counter);
  check("first slide is the video post", s.activeId === "t3_demo01", s.activeId);
  check("video is playing", s.video && s.video.paused === false);
  check(
    "audible autoplay fell back to muted + sound pill",
    s.video && s.video.muted === true && s.soundPill === true,
    JSON.stringify({ muted: s.video && s.video.muted, pill: s.soundPill })
  );
}

// ---- tap restores sound (the extension's restore-on-gesture rule) ----
{
  await page.mouse.click(195, 420);
  await page.waitForTimeout(400);
  const s = await snap();
  check("tap restored sound instead of pausing", s.video && s.video.muted === false && s.video.paused === false, JSON.stringify(s.video));
  check("sound pill cleared", s.soundPill === false);
}

// ---- toggling auto-advance must not restart or pause the playing video ----
{
  const before = await page.evaluate(() => {
    const v = document.querySelector(".slide.active video");
    return v.currentTime;
  });
  await page.evaluate(() => window.__reel.Settings.set("autoAdvance", true));
  await page.waitForTimeout(350);
  await page.evaluate(() => window.__reel.Settings.set("autoAdvance", false));
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => {
    const v = document.querySelector(".slide.active video");
    return { t: v.currentTime, paused: v.paused };
  });
  check(
    "auto on/off left playback running, no reset to 0",
    after.paused === false && after.t > before,
    JSON.stringify({ before, after })
  );
}

// ---- optimistic vote + save on the active slide ----
{
  await page.evaluate(() => {
    document.querySelector(".slide.active .rail .btn.up").click();
    document.querySelector(".slide.active .rail .btn.save").click();
  });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    upOn: document.querySelector(".slide.active .rail .btn.up").classList.contains("on"),
    savedLbl: document.querySelector(".slide.active .rail .btn.save .lbl").textContent,
    post: window.__reel.feed.posts[0],
  }));
  check("upvote is optimistic", s.upOn && s.post.likes === true);
  check("save is optimistic", s.savedLbl === "Saved" && s.post.saved === true);

  // Pressing the same button again must take the action back — this is the
  // regression the frozen-post-reference bug caused: the second press used to
  // recompute the toggle from pre-first-press state.
  await page.evaluate(() => {
    document.querySelector(".slide.active .rail .btn.up").click();
    document.querySelector(".slide.active .rail .btn.save").click();
  });
  await page.waitForTimeout(500);
  const undo = await page.evaluate(() => ({
    upPressed: document.querySelector(".slide.active .rail .btn.up").getAttribute("aria-pressed"),
    savedLbl: document.querySelector(".slide.active .rail .btn.save .lbl").textContent,
    post: window.__reel.feed.posts[0],
  }));
  check("second press retracts the vote", undo.upPressed === "false" && undo.post.likes === null, JSON.stringify(undo.post && { likes: undo.post.likes }));
  check("second press unsaves", undo.savedLbl === "Save" && undo.post.saved === false);
}

// ---- moving on pauses the video (active-page discipline) ----
{
  await goTo(1);
  const s = await page.evaluate(() => {
    const first = document.querySelector('[data-post-id="t3_demo01"] video');
    return { firstPaused: first ? first.paused : "gone", active: document.querySelector(".slide.active").dataset.postId };
  });
  check("previous video paused when it left the screen", s.firstPaused === true || s.firstPaused === "gone", JSON.stringify(s));
  check("image slide active", s.active === "t3_demo02");
}

// ---- the gate: media never fetched while masked ----
{
  await goTo(2); // gif slide; gate becomes the mounted neighbour
  await goTo(3); // the 18+ post
  const s = await snap();
  check("18+ post shows the gate card", s.gatecard === true, s.activeClass);
  check("no media element exists on the gated slide", !s.video);
  const fetched = requested.some((u) => u.includes("refinery"));
  check("gated file was NEVER requested while masked", !fetched);

  // Reveal: the file may load only now.
  await page.evaluate(() => document.querySelector(".slide.active .reveal").click());
  await page.waitForTimeout(1200);
  const after = await snap();
  const fetchedNow = requested.some((u) => u.includes("refinery"));
  check("reveal mounts the video", !!after.video, JSON.stringify(after));
  check("reveal is what triggers the fetch", fetchedNow);
}

// ---- gallery expansion shares one Reddit post ----
{
  await goTo(4);
  const s = await page.evaluate(() => {
    const posts = window.__reel.feed.posts;
    const galleryPosts = posts.filter((p) => p.redditId === "t3_demo05");
    return {
      count: galleryPosts.length,
      chip: document.querySelector(".slide.active .chip.gallery")?.textContent,
    };
  });
  check("gallery expanded one-post-per-image", s.count === 3, String(s.count));
  check("gallery chip says 1 / 3", s.chip === "Gallery 1 / 3", s.chip);

  await page.evaluate(() => document.querySelector(".slide.active .rail .btn.save").click());
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() =>
    window.__reel.feed.posts.filter((p) => p.redditId === "t3_demo05").map((p) => p.saved)
  );
  check("saving one gallery image saves all siblings", saved.every(Boolean), JSON.stringify(saved));
}

// ---- spoiler gate uses the same machinery ----
{
  await goTo(7);
  const s = await snap();
  check("spoiler post is gated too", s.gatecard === true && s.activeId === "t3_demo06", JSON.stringify({ id: s.activeId, gate: s.gatecard }));
  const fetchedFinale = requested.some((u) => u.includes("finale"));
  check("spoiler image not fetched while masked", !fetchedFinale);
}

// ---- text and link slides ----
{
  await goTo(8);
  const text = await page.evaluate(() => ({
    id: document.querySelector(".slide.active").dataset.postId,
    hasBody: !!document.querySelector(".slide.active .textbody p"),
  }));
  check("text post renders selftext", text.id === "t3_demo07" && text.hasBody, JSON.stringify(text));

  await goTo(9);
  const link = await page.evaluate(() => ({
    id: document.querySelector(".slide.active").dataset.postId,
    domain: document.querySelector(".slide.active .linkdomain")?.textContent,
    thumb: !!document.querySelector(".slide.active .linkthumb"),
  }));
  check("link post renders as a card with domain + preview", link.id === "t3_demo08" && link.domain === "example.com" && link.thumb, JSON.stringify(link));
}

// ---- exhausted feed: honest counter, end card ----
{
  const s = await snap();
  check("counter dropped the + once exhausted", /^10 \/ 10$/.test(s.counter), s.counter);
  const end = await page.evaluate(() => !!document.querySelector(".endslide"));
  check("end card exists after exhaustion", end);
}

// ---- auto-advance cascade: image dwell → gif loop → video ended →
// ---- gallery dwells → gate dwell (on the never-revealed spoiler) ----
{
  const arriveAt = async (id, timeout, why) => {
    const ok = await page
      .waitForFunction(
        (want) => {
          const active = document.querySelector(".slide.active");
          return active && active.dataset.postId === want;
        },
        id,
        { timeout }
      )
      .then(() => true)
      .catch(() => false);
    const s = await snap();
    check(why, ok, `expected ${id}, at ${s.activeId}`);
    return ok;
  };

  await goTo(1);
  await page.evaluate(() => {
    window.__reel.Settings.set("imageDwellMs", 2000);
    window.__reel.Settings.set("autoAdvance", true);
  });
  await arriveAt("t3_demo03", 4500, "image auto-advanced after its dwell");
  // gif: dwell = max(imageDwell, one full 2.4s loop)
  await arriveAt("t3_demo04", 5500, "gif advanced after at least one full loop");
  // demo04 was revealed earlier in this session, so it plays as a video and
  // must advance on `ended` (5s clip), not on the gate dwell
  await arriveAt("t3_demo05-1", 8000, "revealed video auto-advanced on ended");
  await arriveAt("t3_demo06", 9000, "gallery images each took their dwell");
  // the spoiler was never revealed: its gate card advances after GATE_DWELL
  // and the media must STILL not be fetched
  await arriveAt("t3_demo07", 4500, "gate card auto-advanced after GATE_DWELL");
  const fetchedFinale = requested.some((u) => u.includes("finale"));
  check("gate auto-advance did not fetch the masked file", !fetchedFinale);

  // Run auto-advance off the end of the exhausted feed: it must switch
  // itself off and land on the end card.
  await arriveAt("t3_demo08", 4500, "text post auto-advanced to the link card");
  const ended = await page
    .waitForFunction(() => window.__reel.Settings.get("autoAdvance") === false, null, { timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  check("auto-advance switched itself off at true exhaustion", ended);
}

// ---- masked media never fetched, full-session sweep ----
{
  const fetchedFinale = requested.some((u) => u.includes("finale"));
  check("spoiler file still never fetched (never revealed)", !fetchedFinale);
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

// ---- self-host live path: app → /reddit/ proxy → (mock) Reddit upstream ----
// reddit.com is not reachable from every dev environment, so the upstream is
// a local mock serving a wire-shaped listing; everything else — the proxy,
// the reddit source, the normalizer, the feed — is the real path.
{
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");

  const APP_PORT = 4180;
  const MOCK_PORT = 4181;

  const listing = {
    kind: "Listing",
    data: {
      after: null,
      children: [
        {
          kind: "t3",
          data: {
            name: "t3_lan01", id: "lan01", title: "A live post through the proxy",
            author: "lan_tester", subreddit: "lantest", score: 42, num_comments: 7,
            created_utc: Date.now() / 1000 - 7200,
            permalink: "/r/lantest/comments/lan01/a_live_post/",
            url: `http://localhost:${APP_PORT}/demo/media/dolomites.jpg`,
            domain: "i.redd.it", over_18: false, spoiler: false,
            post_hint: "image", is_video: false, is_self: false,
          },
        },
        {
          kind: "t3",
          data: {
            name: "t3_lan02", id: "lan02", title: "And a text post",
            author: "lan_tester", subreddit: "lantest", score: 5, num_comments: 1,
            created_utc: Date.now() / 1000 - 3600,
            permalink: "/r/lantest/comments/lan02/and_a_text_post/",
            url: "https://www.reddit.com/r/lantest/comments/lan02/and_a_text_post/",
            domain: "self.lantest", over_18: false, spoiler: false,
            is_video: false, is_self: true, selftext: "Served by the mock upstream.",
          },
        },
      ],
    },
  };

  const mock = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(listing));
  }).listen(MOCK_PORT);

  const serveScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "serve.mjs");
  const app = spawn(process.execPath, [serveScript], {
    env: { ...process.env, PORT: String(APP_PORT), REDDIT_UPSTREAM: `http://localhost:${MOCK_PORT}` },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 700));

  // proxy discipline before the app: only listing paths pass
  const bad = await fetch(`http://localhost:${APP_PORT}/reddit/api/v1/me`);
  check("proxy refuses non-listing paths", bad.status === 400, String(bad.status));
  await fetch(`http://localhost:${APP_PORT}/reddit/r/lantest.json?raw_json=1`);
  const second = await fetch(`http://localhost:${APP_PORT}/reddit/r/lantest.json?raw_json=1`);
  check("proxy caches repeat listing reads", second.headers.get("x-reel-cache") === "hit");

  const live = await context.newPage();
  const liveErrors = [];
  live.on("pageerror", (e) => liveErrors.push(e.message));
  await live.goto(`http://localhost:${APP_PORT}/?sub=lantest`);
  await live.waitForTimeout(2200);
  const s = await live.evaluate(() => ({
    label: document.getElementById("source-label").textContent,
    demoBadge: !!document.querySelector("#topbar .demo"),
    slides: document.querySelectorAll(".slide:not(.endslide)").length,
    counter: document.getElementById("counter").textContent,
    activeType: document.querySelector(".slide.active")?.className,
    imgLoaded: !!document.querySelector(".slide.active img.loaded"),
  }));
  check("live source is labelled r/lantest, no demo badge", s.label === "r/lantest" && !s.demoBadge, JSON.stringify(s));
  check("live listing rendered through proxy + normalizer", s.slides === 2 && /^1 \/ 2$/.test(s.counter), JSON.stringify(s));
  check("live image slide loaded", s.activeType?.includes("type-image") && s.imgLoaded, s.activeType);
  check("no page errors on the live path", liveErrors.length === 0, liveErrors.join(" | "));

  await live.close();
  app.kill();
  mock.close();
}

await browser.close();
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log("FAILURES:", failures.join("; "));
  process.exit(1);
}
