// Reddit Slideshow — popup script

const startBtn = document.getElementById("start-btn");
const errorMsg = document.getElementById("error-msg");
const detected = document.getElementById("detected");
const detectedLabel = document.getElementById("detected-label");

// One button, one handler, one flag. Start and Stop used to be bound
// separately — addEventListener for start, .onclick for stop — so a click on
// "Stop Slideshow" ran both: it started a fresh session (and closed the popup)
// as well as stopping the old one. After a stop-then-start cycle the start
// listener was attached twice and the background rebuilt `session` twice.
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
  errorMsg.style.display = "block";
}

function clearError() {
  errorMsg.style.display = "none";
}

// --- Detect current Reddit page ---
async function detectPage() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;

    const url = tabs[0].url || "";
    if (/reddit\.com/.test(url)) {
      const match = url.match(/reddit\.com\/r\/([a-zA-Z0-9_]+)/);
      detectedLabel.textContent = match
        ? `Current page: r/${match[1]}`
        : "Current page: Reddit Home";
      detected.style.display = "block";
      canStart = true;
    } else {
      showError("Navigate to a Reddit page first.");
    }
  } catch (e) {
    // Can't access tab info — leave the button disabled rather than promising
    // a start that cannot happen.
  }
  setRunning(running);
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
    // not have started one — so this re-enables the button detectPage disabled.
    if (state && !state.error) setRunning(true);
  } catch (e) {
    // No active session
  }
}

// --- Event listeners ---
startBtn.addEventListener("click", () => {
  if (startBtn.disabled) return;
  return running ? stopSlideshow() : startSlideshow();
});

// --- Init ---
(async function init() {
  await detectPage();
  await checkActiveSession();
})();
