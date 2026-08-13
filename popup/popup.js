// Reddit Slideshow — popup script

const startBtn = document.getElementById("start-btn");
const errorMsg = document.getElementById("error-msg");
const preflight = document.getElementById("preflight");
const sourceEl = document.getElementById("source");
const countEl = document.getElementById("count");
const breakdownEl = document.getElementById("breakdown");
const maskToggle = document.getElementById("mask-toggle");

// One button, one handler, one flag. Start and Stop used to be bound
// separately — addEventListener for start, .onclick for stop — so a click on
// "Stop Slideshow" ran both: it started a fresh session (and closed the popup)
// as well as stopping the old one.
let running = false;
// Whether this tab could host a slideshow. An active session can still be
// stopped from a tab that could not start one.
let canStart = false;

function setRunning(next) {
  running = next;
  startBtn.textContent = next ? "Stop Slideshow" : "Start Slideshow";
  startBtn.classList.toggle("stop", next);
  startBtn.disabled = next ? false : !canStart;
}

function showError(text) {
  errorMsg.textContent = text;
  errorMsg.hidden = false;
}

function clearError() {
  errorMsg.hidden = true;
}

const TYPE_LABEL = { image: "images", video: "video", embed: "embeds" };

// What is on the page, before the viewer commits to it. The background already
// returned a post count and the popup threw it away, so a scrape that found
// nothing reported success, closed the popup, and dropped the user onto a
// black fullscreen — the worst thing the old popup did.
async function runPreflight() {
  let scan;
  try {
    scan = await browser.runtime.sendMessage({ type: "scanOnly" });
  } catch (e) {
    scan = { error: "Could not read this page" };
  }

  if (!scan || scan.error) {
    showError(
      scan && scan.error === "Not a Reddit page"
        ? "Open a Reddit page first — a subreddit, your home feed, or a user page."
        : (scan && scan.error) || "Could not read this page"
    );
    return;
  }

  canStart = scan.count > 0;
  sourceEl.textContent = scan.subreddit ? `r/${scan.subreddit}` : "Reddit feed";

  if (scan.count === 0) {
    countEl.textContent = "No posts loaded on this page yet.";
    showError("Scroll the page so some posts have loaded, then reopen this.");
  } else {
    // "About", and it means it: resolvePendingPosts expands one gallery into
    // several posts and drops crossposts it cannot resolve, so the number that
    // starts is rarely the number counted here.
    countEl.textContent = `About ${scan.count} ${scan.count === 1 ? "post" : "posts"} ready · more load as you scroll`;
  }

  breakdownEl.textContent = "";
  for (const [type, n] of Object.entries(scan.counts || {})) {
    const chip = document.createElement("span");
    chip.textContent = `${n} ${TYPE_LABEL[type] || type}`;
    breakdownEl.appendChild(chip);
  }

  preflight.hidden = false;
}

// --- Start / stop ---
async function startSlideshow() {
  clearError();
  startBtn.disabled = true;
  startBtn.textContent = "Loading...";

  try {
    const result = await browser.runtime.sendMessage({ type: "startSlideshow" });
    if (result && result.error) {
      showError(result.error);
      setRunning(false);
      return;
    }
    if (result && result.postCount === 0) {
      showError("Nothing on this page could be shown as a slideshow.");
      setRunning(false);
      return;
    }
    window.close();
  } catch (e) {
    showError("Failed to start slideshow. Make sure you're on a Reddit page.");
    setRunning(false);
  }
}

async function stopSlideshow() {
  clearError();
  startBtn.disabled = true;
  try {
    await browser.runtime.sendMessage({ type: "closeSlideshow" });
  } catch (e) {
    // The background is already gone — the session is over either way.
  }
  setRunning(false);
}

// --- Check for active session ---
async function checkActiveSession() {
  try {
    const state = await browser.runtime.sendMessage({ type: "getCurrentState" });
    // A running session is stoppable from anywhere, including a tab that could
    // not have started one — so this re-enables the button preflight disabled.
    if (state && !state.error) setRunning(true);
  } catch (e) {
    // No active session
  }
}

// --- Adult / spoiler mask ---
// The popup and the slideshow share the moz-extension://<id> origin, so this
// is the same stored value the slideshow reads.
function syncMask() {
  maskToggle.setAttribute("aria-checked", String(SlideshowSettings.get("maskNsfw")));
}

maskToggle.addEventListener("click", () => {
  SlideshowSettings.set("maskNsfw", !SlideshowSettings.get("maskNsfw"));
});
SlideshowSettings.onChange(syncMask);

// --- Event listeners ---
startBtn.addEventListener("click", () => {
  if (startBtn.disabled) return;
  return running ? stopSlideshow() : startSlideshow();
});

// --- Init ---
(async function init() {
  syncMask();
  setRunning(false);
  await runPreflight();
  setRunning(running);
  await checkActiveSession();
})();
