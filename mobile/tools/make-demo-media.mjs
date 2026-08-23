// Generates the bundled demo media entirely offline (the build environment
// cannot reach Reddit, and the demo feed must work with no network at all).
// Videos are VP9+Opus WebM: the only codec family this container's Chromium,
// Android WebView, and the recording pipeline all agree on. Real Reddit
// content is untouched by this choice — on device it streams HLS/MP4.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../www/demo/media");
mkdirSync(out, { recursive: true });

// ---------- videos ----------
const vid = (name, args) => {
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args,
    path.join(out, name)]);
  console.log("made", name);
};

// 1 · a "real video" with an audio track (soft chord with tremolo)
vid("dog-snow.webm", [
  "-f", "lavfi", "-i",
  "gradients=s=540x960:d=6:speed=0.35:c0=0xffd9a0:c1=0xf4906b:c2=0x7a3d5e:c3=0x241a33",
  "-f", "lavfi", "-i",
  "sine=frequency=220:duration=6,tremolo=f=4:d=0.4,volume=0.35",
  "-f", "lavfi", "-i",
  "sine=frequency=277:duration=6,tremolo=f=5:d=0.5,volume=0.22",
  "-filter_complex", "[1:a][2:a]amix=inputs=2[a];[0:v]vignette=PI/5[v]",
  "-map", "[v]", "-map", "[a]",
  "-c:v", "libvpx-vp9", "-b:v", "450k", "-c:a", "libopus", "-b:a", "64k",
]);

// 2 · a silent gif-style loop: short, no audio track at all
vid("espresso-loop.webm", [
  "-f", "lavfi", "-i",
  "gradients=s=540x960:d=2.4:speed=0.9:c0=0xd8a25f:c1=0x7c4a26:c2=0x2a180d",
  "-vf", "vignette=PI/4.5",
  "-c:v", "libvpx-vp9", "-b:v", "400k", "-an",
]);

// 3 · the adult-gated clip (dark, with a low rumble) — the gate test asserts
//     this file is NEVER requested while the post is masked
vid("refinery.webm", [
  "-f", "lavfi", "-i",
  "gradients=s=540x960:d=5:speed=0.25:c0=0x2a0a05:c1=0x571f0d:c2=0x0c0505:c3=0x1c0e04",
  "-f", "lavfi", "-i", "sine=frequency=80:duration=5,tremolo=f=2:d=0.6,volume=0.3",
  "-vf", "vignette=PI/5",
  "-c:v", "libvpx-vp9", "-b:v", "450k", "-c:a", "libopus", "-b:a", "48k",
]);

// ---------- images (SVG scenes rasterised by Chromium) ----------
const svg = {
  "dolomites.jpg": [1080, 1440, `
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2b2d63"/><stop offset=".45" stop-color="#7b6bb0"/>
        <stop offset=".72" stop-color="#f3a184"/><stop offset="1" stop-color="#46243c"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1440" fill="url(#sky)"/>
    <circle cx="540" cy="880" r="120" fill="#ffe8c9" opacity=".85"/>
    <polygon points="0,1440 0,1050 260,760 430,1010 560,860 780,1440" fill="#2a1e3f" opacity=".92"/>
    <polygon points="380,1440 620,830 800,1080 940,900 1080,1160 1080,1440" fill="#1d1430"/>
    <polygon points="600,860 660,940 560,950" fill="#f8e9ff" opacity=".7"/>
    <polygon points="250,790 320,900 190,910" fill="#f8e9ff" opacity=".6"/>`],
  "finale.jpg": [1080, 1080, `
    <defs>
      <radialGradient id="g" cx=".5" cy=".4" r=".9">
        <stop offset="0" stop-color="#3d2a63"/><stop offset=".6" stop-color="#1b1233"/>
        <stop offset="1" stop-color="#0a0716"/>
      </radialGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#g)"/>
    <g stroke="#b785f5" stroke-width="7" fill="none" opacity=".8">
      <path d="M140 760 L360 520 L520 640 L720 360 L940 460"/>
    </g>
    <g fill="#ffb02e"><circle cx="720" cy="360" r="18"/></g>
    <g fill="#e8dcff" opacity=".5">
      <circle cx="360" cy="520" r="12"/><circle cx="520" cy="640" r="12"/>
      <circle cx="940" cy="460" r="12"/><circle cx="140" cy="760" r="12"/>
    </g>`],
  "leica-1.jpg": [1080, 1350, leica("#4a4f57", "#101215", 300)],
  "leica-2.jpg": [1080, 1350, leica("#565049", "#151210", 420)],
  "leica-3.jpg": [1080, 1350, leica("#3f4a52", "#0e1316", 540)],
  "tech-thumb.jpg": [640, 360, `
    <defs>
      <linearGradient id="t" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b2740"/><stop offset="1" stop-color="#0e4d46"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#t)"/>
    <g stroke="#00e0c6" stroke-width="2" opacity=".55">
      ${Array.from({ length: 8 }, (_, i) => `<line x1="${80 * i}" y1="0" x2="${80 * i}" y2="360"/>`).join("")}
      ${Array.from({ length: 5 }, (_, i) => `<line x1="0" y1="${90 * i}" x2="640" y2="${90 * i}"/>`).join("")}
    </g>
    <circle cx="320" cy="180" r="64" fill="none" stroke="#9df2e6" stroke-width="6"/>`],
};

function leica(hi, lo, lensY) {
  return `
    <defs>
      <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/>
      </linearGradient>
      <radialGradient id="lens" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#1b2c3d"/><stop offset=".55" stop-color="#0a1119"/>
        <stop offset=".8" stop-color="#212a33"/><stop offset="1" stop-color="#05070a"/>
      </radialGradient>
    </defs>
    <rect width="1080" height="1350" fill="url(#b)"/>
    <rect x="140" y="${lensY - 130}" width="800" height="430" rx="34" fill="#22262c" stroke="#565c66" stroke-width="5"/>
    <circle cx="540" cy="${lensY + 85}" r="150" fill="url(#lens)" stroke="#6a7280" stroke-width="8"/>
    <circle cx="540" cy="${lensY + 85}" r="64" fill="#0d1622"/>
    <circle cx="500" cy="${lensY + 45}" r="18" fill="#dfe8f2" opacity=".55"/>
    <rect x="180" y="${lensY - 106}" width="180" height="56" rx="12" fill="#181b20"/>`;
}

{
  let browser;
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
  const page = await browser.newPage();
  for (const [name, [w, h, body]] of Object.entries(svg)) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(
      `<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg></body>`
    );
    await page.screenshot({ path: path.join(out, name), type: "jpeg", quality: 82 });
    console.log("made", name);
  }
  await browser.close();
}
