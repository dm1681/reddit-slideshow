// Viz-driven-dev step 3: regenerate the SAME scenes the mockup promised, from
// the real running app, so expected and real can be compared honestly.
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { launchPhone, ffmpegPath } from "./shot-rig.mjs";

const BASE = process.env.REEL_URL || "http://localhost:4173/";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "docs/design/mobile/screens");
mkdirSync(outDir, { recursive: true });

// Phone-realistic autoplay policy so the sound pill shows, as on device.
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(record) {
  const { browser, context } = await launchPhone(record ? { record } : {});
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(2200);
  return { browser, context, page };
}

// ---- stills, matching the mockup scenes one for one ----
{
  const { browser, page } = await newPage();

  // 1 · feed: the video post, upvoted like the mockup frame
  await page.evaluate(() => {
    document.querySelector(".slide.active .rail .btn.up").click();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, "real-1-feed.png") });
  console.log("shot real-1-feed.png");

  // 2 · frozen mid-swipe between slide 1 and 2 (same trick as the mockup:
  // snap off, hold the scroll position)
  await page.evaluate(() => {
    const feed = document.getElementById("feed");
    feed.style.scrollSnapType = "none";
    feed.scrollTop = feed.clientHeight * 0.45;
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, "real-2-swipe.png") });
  console.log("shot real-2-swipe.png");
  await page.evaluate(() => {
    const feed = document.getElementById("feed");
    feed.style.scrollSnapType = "";
  });

  // 3 · the 18+ gate
  await page.evaluate(() => window.__reel.pager.scrollToIndex(3));
  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(outDir, "real-3-gate.png") });
  console.log("shot real-3-gate.png");

  // 4 · settings sheet over the image slide
  await page.evaluate(() => window.__reel.pager.scrollToIndex(1));
  await page.waitForTimeout(1100);
  await page.click("#gear");
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(outDir, "real-4-settings.png") });
  console.log("shot real-4-settings.png");

  await browser.close();
}

// ---- the real-swipe video: same choreography as the expected one ----
{
  const videoTmp = path.join(outDir, ".video-tmp");
  const { browser, context, page } = await newPage(videoTmp);
  await settle(1200);
  for (const i of [1, 2, 3, 4]) {
    await page.evaluate((idx) => window.__reel.pager.scrollToIndex(idx), i);
    await page.waitForTimeout(i === 3 ? 2100 : 1500);
  }
  await page.waitForTimeout(600);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  await browser.close();

  const finalWebm = path.join(outDir, "real-swipe.webm");
  renameSync(webm, finalWebm);
  rmSync(videoTmp, { recursive: true, force: true });

  const ffmpeg = ffmpegPath();
  if (ffmpeg) {
    const mp4 = path.join(outDir, "real-swipe.mp4");
    execFileSync(ffmpeg, [
      "-y", "-i", finalWebm,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium",
      "-movflags", "+faststart", "-an", mp4,
    ]);
    rmSync(finalWebm);
    console.log("recorded real-swipe.mp4");
  }
}
