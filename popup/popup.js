// Reddit Slideshow — popup script

const subredditInput = document.getElementById("subreddit-input");
const sortSelect = document.getElementById("sort-select");
const startBtn = document.getElementById("start-btn");
const errorMsg = document.getElementById("error-msg");
const detected = document.getElementById("detected");
const detectedLabel = document.getElementById("detected-label");

// --- Auto-detect subreddit from current tab ---
async function detectSubreddit() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;

    const url = tabs[0].url || "";
    const match = url.match(/reddit\.com\/r\/([a-zA-Z0-9_]+)/);
    if (match) {
      const subreddit = match[1];
      subredditInput.value = subreddit;
      detectedLabel.textContent = `Current: r/${subreddit}`;
      detected.style.display = "block";
    }
  } catch (e) {
    // No permission or not on Reddit — that's fine
  }
}

// --- Validation ---
function validateSubreddit(name) {
  if (!name || name.trim() === "") {
    return "Please enter a subreddit name";
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9_]{1,21}$/.test(trimmed)) {
    return "Subreddit names can only contain letters, numbers, and underscores (max 21 chars)";
  }
  return null;
}

// --- Start slideshow ---
async function startSlideshow() {
  const subreddit = subredditInput.value.trim();
  const sort = sortSelect.value;

  const validationError = validateSubreddit(subreddit);
  if (validationError) {
    errorMsg.textContent = validationError;
    errorMsg.style.display = "block";
    return;
  }

  errorMsg.style.display = "none";
  startBtn.disabled = true;
  startBtn.textContent = "Loading...";

  try {
    await browser.runtime.sendMessage({
      type: "startSlideshow",
      subreddit,
      sort,
    });
    window.close();
  } catch (e) {
    errorMsg.textContent = "Failed to start slideshow. Make sure you're on a Reddit page.";
    errorMsg.style.display = "block";
    startBtn.disabled = false;
    startBtn.textContent = "Start Slideshow";
  }
}

// --- Event listeners ---
startBtn.addEventListener("click", startSlideshow);

subredditInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    startSlideshow();
  }
});

subredditInput.addEventListener("input", () => {
  errorMsg.style.display = "none";
});

// --- Init ---
detectSubreddit();
