// Reddit Slideshow — slideshow controller

(async function () {
  // --- Mode detection ---
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "overlay"; // "overlay" or "popout"

  // --- DOM references ---
  const contentContainer = document.getElementById("content-container");
  const progress = document.getElementById("progress");
  const postTitle = document.getElementById("post-title");
  const postMeta = document.getElementById("post-meta");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const closeBtn = document.getElementById("close-btn");
  const popoutBtn = document.getElementById("popout-btn");
  const autoAdvanceBtn = document.getElementById("auto-advance-btn");

  // --- State ---
  let posts = [];
  let currentIndex = 0;
  let cleanupCurrentRender = null;
  let autoAdvanceOn = false;
  let exhausted = false;
  let fetchInProgress = false;

  // --- Renderer map ---
  const renderers = {
    image: ImageRenderer,
    video: VideoRenderer,
    embed: EmbedRenderer,
  };

  // --- Fetch initial state from background ---
  async function init() {
    try {
      const state = await browser.runtime.sendMessage({ type: "getCurrentState" });
      if (state.error) {
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "color:#777;font-size:14px;";
        errDiv.textContent = state.error;
        contentContainer.innerHTML = "";
        contentContainer.appendChild(errDiv);
        return;
      }
      posts = state.posts;
      currentIndex = state.currentIndex || 0;
      exhausted = state.exhausted || false;

      if (posts.length === 0) {
        const noPostsDiv = document.createElement("div");
        noPostsDiv.style.cssText = "color:#777;font-size:14px;";
        noPostsDiv.textContent = "No posts found";
        contentContainer.innerHTML = "";
        contentContainer.appendChild(noPostsDiv);
        return;
      }

      renderCurrentPost();
    } catch (e) {
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#777;font-size:14px;";
      errDiv.textContent = "Error loading slideshow";
      contentContainer.innerHTML = "";
      contentContainer.appendChild(errDiv);
    }
  }

  // --- Background push: posts resolved after this page snapshotted them ---
  // Redgifs embeds become direct videos here. Re-render only when the post on
  // screen actually changed, so a background update never restarts playback of
  // something the user is already watching.
  browser.runtime.onMessage.addListener((message) => {
    if (message.type !== "postsUpdated" || !Array.isArray(message.posts)) return;

    const before = posts[currentIndex];
    posts = message.posts;
    const after = posts[currentIndex];

    const changed =
      before && after && before.id === after.id &&
      (before.type !== after.type || before.mediaUrl !== after.mediaUrl);

    if (changed) {
      renderCurrentPost();
    } else {
      updateProgress();
      updateNavButtons();
    }
  });

  // --- Rendering ---
  function renderCurrentPost() {
    const post = posts[currentIndex];
    if (!post) return;

    // Cleanup previous render
    if (cleanupCurrentRender) {
      cleanupCurrentRender();
      cleanupCurrentRender = null;
    }

    // Get renderer for post type
    const renderer = renderers[post.type];
    const onEnded = autoAdvanceOn ? () => autoAdvanceNext() : null;
    if (renderer) {
      cleanupCurrentRender = renderer.render(post, contentContainer, onEnded);
    } else {
      const unsupportedDiv = document.createElement("div");
      unsupportedDiv.style.cssText = "color:#777;font-size:14px;";
      unsupportedDiv.textContent = `Unsupported content type: ${post.type}`;
      contentContainer.innerHTML = "";
      contentContainer.appendChild(unsupportedDiv);
    }

    // Update UI
    updatePostInfo(post);
    updateProgress();
    updateNavButtons();

    // Preload next image
    preloadNext();

    // Check if we need more posts
    checkPreemptiveFetch();
  }

  function updatePostInfo(post) {
    postTitle.textContent = post.title;
    const parts = [];
    if (post.subreddit) parts.push(`r/${post.subreddit}`);
    if (post.score) {
      const scoreFormatted = post.score >= 1000
        ? `${(post.score / 1000).toFixed(1)}k`
        : post.score;
      parts.push(`${scoreFormatted} ↑`);
    }
    if (post.author) parts.push(`u/${post.author}`);
    postMeta.textContent = parts.join(" · ");
  }

  function updateProgress() {
    progress.textContent = `${currentIndex + 1} / ${posts.length}`;
    const pct = posts.length > 0 ? ((currentIndex + 1) / posts.length) * 100 : 0;
    progressBarFill.style.width = `${pct}%`;
  }

  function updateNavButtons() {
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex >= posts.length - 1 && exhausted;
  }

  function preloadNext() {
    const nextPost = posts[currentIndex + 1];
    if (nextPost) {
      const renderer = renderers[nextPost.type];
      if (renderer && renderer.preload) {
        renderer.preload(nextPost);
      }
    }
  }

  // --- Preemptive fetch ---
  async function checkPreemptiveFetch() {
    if (currentIndex >= posts.length - 5 && !exhausted && !fetchInProgress) {
      fetchInProgress = true;
      try {
        const result = await browser.runtime.sendMessage({
          type: "getPosts",
          startIndex: posts.length,
          count: 25,
        });
        if (result && !result.error && result.posts) {
          posts = result.posts;
          exhausted = result.exhausted || false;
          updateProgress();
          updateNavButtons();
        }
      } catch (e) {
        // Non-critical — continue with what we have
      } finally {
        fetchInProgress = false;
      }
    }
  }

  // --- Navigation ---
  function goNext() {
    if (currentIndex < posts.length - 1) {
      currentIndex++;
      renderCurrentPost();
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentPost();
    }
  }

  // --- Auto-advance (event-driven) ---
  // Videos/gifs advance when they finish playing.
  // Images advance after a 5s timer.
  // Embeds advance after a 30s timer (can't detect end).
  // Toggling auto-advance re-renders the current post to attach/detach the onEnded callback.

  function autoAdvanceNext() {
    if (!autoAdvanceOn) return;
    if (currentIndex < posts.length - 1) {
      currentIndex++;
      renderCurrentPost();
    } else if (exhausted) {
      stopAutoAdvance();
    }
  }

  function startAutoAdvance() {
    autoAdvanceOn = true;
    autoAdvanceBtn.textContent = "⏱ Auto";
    // Re-render current post to attach onEnded callback
    renderCurrentPost();
  }

  function stopAutoAdvance() {
    autoAdvanceOn = false;
    autoAdvanceBtn.textContent = "⏱ Off";
    // Re-render to remove onEnded callback (videos will loop again)
    renderCurrentPost();
  }

  function toggleAutoAdvance() {
    if (autoAdvanceOn) {
      stopAutoAdvance();
    } else {
      startAutoAdvance();
    }
  }

  // --- Idle fade ---
  let idleTimer = null;
  const IDLE_TIMEOUT = 2000;

  function resetIdleTimer() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      document.body.classList.add("idle");
    }, IDLE_TIMEOUT);
  }

  document.addEventListener("mousemove", resetIdleTimer);
  document.addEventListener("keydown", resetIdleTimer);
  resetIdleTimer();

  // --- Close / Pop-out ---
  async function closeSlideshow() {
    if (mode === "popout") {
      window.close();
    } else {
      await browser.runtime.sendMessage({ type: "closeSlideshow" });
    }
  }

  async function popOut() {
    await browser.runtime.sendMessage({ type: "popOut" });
    // If we're in overlay mode, the overlay will be removed by background
  }

  // --- Event listeners ---
  prevBtn.addEventListener("click", goPrev);
  nextBtn.addEventListener("click", goNext);
  closeBtn.addEventListener("click", closeSlideshow);
  popoutBtn.addEventListener("click", popOut);
  autoAdvanceBtn.addEventListener("click", toggleAutoAdvance);

  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowLeft":
        goPrev();
        break;
      case "ArrowRight":
        goNext();
        break;
      case " ":
        e.preventDefault();
        toggleAutoAdvance();
        break;
      case "Escape":
        closeSlideshow();
        break;
    }
  });

  // Hide pop-out button in pop-out mode (already popped out)
  if (mode === "popout") {
    popoutBtn.style.display = "none";
  }

  // --- Initialize ---
  init();
})();
