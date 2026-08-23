// App icons rasterised from the same mark the favicon uses.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../www/icons");
mkdirSync(out, { recursive: true });

const mark = (size, radius) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="${radius}" fill="#000"/>
    <rect x="2" y="2" width="60" height="60" rx="${radius - 1}" fill="none" stroke="#101418" stroke-width="2"/>
    <path d="M24 17 v30 l24 -15 z" fill="#00e0c6"/>
  </svg>`;

let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }); }
const page = await browser.newPage();

for (const [name, size, radius] of [
  ["icon-192.png", 192, 14],
  ["icon-512.png", 512, 14],
  // iOS applies its own corner mask, so the touch icon ships square-ish
  ["apple-touch-icon.png", 180, 0],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${mark(size, radius)}</body>`);
  await page.screenshot({ path: path.join(out, name), omitBackground: true });
  console.log("made", name);
}
await browser.close();
