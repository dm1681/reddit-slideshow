// Builds the expected-vs-real comparison artifacts: labelled side-by-side
// stills (HTML composed, Chromium rasterised) and a side-by-side video.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { launchPhone, ffmpegPath } from "./shot-rig.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.join(root, "docs/design/mobile/screens");
mkdirSync(dir, { recursive: true });

const SCENES = [
  ["1-feed", "Video post"],
  ["2-swipe", "Mid-swipe"],
  ["3-gate", "18+ gate — media withheld"],
  ["4-settings", "Settings sheet"],
];

const dataUri = (file) =>
  `data:image/png;base64,${readFileSync(path.join(dir, file)).toString("base64")}`;

{
  const { browser, context } = await launchPhone();
  const page = await context.newPage();

  // Label strips for the comparison video — this ffmpeg build has no
  // drawtext, so the text is rasterised here and overlaid there.
  for (const [file, text, colour] of [
    ["label-expected.png", "EXPECTED — MOCKUP", "#d9c2ff"],
    ["label-real.png", "REAL — RUNNING APP", "#9df2e6"],
  ]) {
    await page.setViewportSize({ width: 300, height: 40 });
    await page.setContent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;` +
      `background:rgba(0,0,0,.62);border-radius:8px;overflow:hidden">` +
      `<span style="font:700 15px system-ui;letter-spacing:.12em;color:${colour}">${text}</span></body>`
    );
    await page.screenshot({ path: path.join(dir, file), omitBackground: false });
  }

  for (const [name, caption] of SCENES) {
    await page.setViewportSize({ width: 816, height: 950 });
    await page.setContent(`
      <body style="margin:0;background:#0c0d10;font:600 14px system-ui;color:#fff">
        <div style="display:flex;gap:12px;padding:12px 12px 0">
          <div style="flex:1;text-align:center">
            <div style="padding:8px 0;color:#b785f5;letter-spacing:.12em;font-size:12px">EXPECTED — MOCKUP</div>
            <img src="${dataUri(`expected-${name}.png`)}" style="width:100%;border-radius:14px;border:1px solid #2a2d33">
          </div>
          <div style="flex:1;text-align:center">
            <div style="padding:8px 0;color:#00e0c6;letter-spacing:.12em;font-size:12px">REAL — RUNNING APP</div>
            <img src="${dataUri(`real-${name}.png`)}" style="width:100%;border-radius:14px;border:1px solid #2a2d33">
          </div>
        </div>
        <div style="text-align:center;padding:10px;color:#9aa3ad;font-weight:500">${caption}</div>
      </body>`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(dir, `compare-${name}.png`), fullPage: true });
    console.log(`made compare-${name}.png`);
  }
  await browser.close();
}

// side-by-side video: expected left, real right, label strips overlaid
{
  const ffmpeg = ffmpegPath();
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", path.join(dir, "expected-swipe.mp4"),
    "-i", path.join(dir, "real-swipe.mp4"),
    "-i", path.join(dir, "label-expected.png"),
    "-i", path.join(dir, "label-real.png"),
    "-filter_complex",
    "[0:v][2:v]overlay=x=(W-w)/2:y=16[l];" +
    "[1:v][3:v]overlay=x=(W-w)/2:y=16[r];" +
    "[l][r]hstack=shortest=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "medium",
    "-movflags", "+faststart", "-an",
    path.join(dir, "compare-swipe.mp4"),
  ]);
  execFileSync("rm", [path.join(dir, "label-expected.png"), path.join(dir, "label-real.png")]);
  console.log("made compare-swipe.mp4");
}
