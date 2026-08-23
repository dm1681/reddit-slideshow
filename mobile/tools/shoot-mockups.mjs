// Hypothesis artifacts: phone-framed stills + an expected-swipe video, rendered
// from the mockup BEFORE the app exists (viz-driven-dev step 1).
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { launchPhone, ffmpegPath } from "./shot-rig.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mockup = path.join(root, "docs/design/mobile/mockups/reel.html");
const outDir = path.join(root, "docs/design/mobile/screens");
mkdirSync(outDir, { recursive: true });

const SCENES = [
  ["1-feed", "feed"],
  ["2-swipe", "swipe"],
  ["3-gate", "gate"],
  ["4-settings", "settings"],
];

const url = (scene) => `file://${mockup}?scene=${scene}`;

// ---- stills ----
{
  const { browser, context } = await launchPhone();
  const page = await context.newPage();
  for (const [name, scene] of SCENES) {
    await page.goto(url(scene));
    await page.waitForTimeout(450); // fonts + emoji rasterisation
    await page.screenshot({ path: path.join(outDir, `expected-${name}.png`) });
    console.log(`shot expected-${name}.png`);
  }
  await browser.close();
}

// ---- expected-swipe video: scripted swipe through the mockup feed ----
{
  const videoTmp = path.join(outDir, ".video-tmp");
  const { browser, context } = await launchPhone({ record: videoTmp });
  const page = await context.newPage();
  await page.goto(url("feed"));
  await page.waitForTimeout(1200);
  const h = await page.evaluate(() => window.__reel.slideH());
  for (const i of [1, 2, 3, 4]) {
    await page.evaluate(
      ([y]) => window.__reel.scrollTo(y),
      [h * i]
    );
    // dwell a beat longer on the gate slide so the card can be read
    await page.waitForTimeout(i === 3 ? 2100 : 1500);
  }
  await page.waitForTimeout(600);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  await browser.close();

  const finalWebm = path.join(outDir, "expected-swipe.webm");
  renameSync(webm, finalWebm);
  rmSync(videoTmp, { recursive: true, force: true });

  const ffmpeg = ffmpegPath();
  if (ffmpeg) {
    const mp4 = path.join(outDir, "expected-swipe.mp4");
    execFileSync(ffmpeg, [
      "-y", "-i", finalWebm,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium",
      "-movflags", "+faststart", "-an", mp4,
    ]);
    rmSync(finalWebm);
    console.log("recorded expected-swipe.mp4");
  } else {
    console.log("recorded expected-swipe.webm (ffmpeg-static not installed; kept webm)");
  }
}
