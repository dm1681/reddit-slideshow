// Reddit Slideshow — popup script

const startBtn = document.getElementById("start-btn");
const errorMsg = document.getElementById("error-msg");
const detected = document.getElementById("detected");
const detectedLabel = document.getElementById("detected-label");

// --- Detect current Reddit page ---
async function detectPage() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;

    const url = tabs[0].url || "";
    if (/reddit\.com/.test(url)) {
      const match = url.match(/reddit\.com\/r\/([a-zA-Z0-9_]+)/);
      if (match) {
        detectedLabel.textContent = `Current page: r/${match[1]}`;
      } else {
        detectedLabel.textContent = "Current page: Reddit Home";
      }
      detected.style.display = "block";
    } else {
      // Not on Reddit
      startBtn.disabled = true;
      errorMsg.textContent = "Navigate to a Reddit page first.";
      errorMsg.style.display = "block";
    }
  } catch (e) {
    // Can't access tab info
  }
}

// --- Start slideshow ---
async function startSlideshow() {
  errorMsg.style.display = "none";
  startBtn.disabled = true;
  startBtn.textContent = "Loading...";

  try {
    const result = await browser.runtime.sendMessage({ type: "startSlideshow" });
    if (result && result.error) {
      errorMsg.textContent = result.error;
      errorMsg.style.display = "block";
      startBtn.disabled = false;
      startBtn.textContent = "Start Slideshow";
    } else {
      window.close();
    }
  } catch (e) {
    errorMsg.textContent = "Failed to start slideshow. Make sure you're on a Reddit page.";
    errorMsg.style.display = "block";
    startBtn.disabled = false;
    startBtn.textContent = "Start Slideshow";
  }
}

// --- Check for active session ---
async function checkActiveSession() {
  try {
    const state = await browser.runtime.sendMessage({ type: "getCurrentState" });
    if (state && !state.error) {
      startBtn.textContent = "Stop Slideshow";
      startBtn.classList.add("stop");
      startBtn.onclick = async () => {
        await browser.runtime.sendMessage({ type: "closeSlideshow" });
        startBtn.textContent = "Start Slideshow";
        startBtn.classList.remove("stop");
        startBtn.onclick = null;
        startBtn.addEventListener("click", startSlideshow);
      };
    }
  } catch (e) {
    // No active session
  }
}

// --- Event listeners ---
startBtn.addEventListener("click", startSlideshow);

// --- Init ---
detectPage();
checkActiveSession();
