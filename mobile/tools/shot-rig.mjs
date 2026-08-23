// Shared screenshot rig: phone-shaped Chromium via Playwright.
// The container ships browsers at PLAYWRIGHT_BROWSERS_PATH; if the installed
// playwright version disagrees with that build, fall back to the pinned binary.
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);

export const PHONE = { width: 390, height: 844 };

export async function launchPhone({ record } = {}) {
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  }
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ...(record ? { recordVideo: { dir: record, size: PHONE } } : {}),
  });
  return { browser, context };
}

export function ffmpegPath() {
  // ffmpeg-static ships a full build (libx264/aac); playwright's carries VP8 only.
  try {
    return require("ffmpeg-static");
  } catch {
    return null;
  }
}
