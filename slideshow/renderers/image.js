// Reddit Slideshow — image renderer

// How long a still gets on screen when auto-advance is on, and the shorter
// grace given to one that could not be loaded at all.
const IMAGE_DURATION_MS = 5000;
const IMAGE_ERROR_ADVANCE_MS = 2000;

const ImageRenderer = {
  render(post, container, onEnded) {
    container.innerHTML = "";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    const img = document.createElement("img");
    img.alt = post.title;
    let timer = null;
    let retryTimer = null;
    let retries = 0;
    const MAX_RETRIES = 2;
    // Everything below has to check this. Teardown sets src="", which fires
    // `error` on the discarded <img> — that scheduled a retry, the retry
    // restored the src, the load fired, and a five-second advance was armed
    // against whichever slide had replaced this one. A gallery armed one per
    // image, which is why auto-advance grew steadily more erratic.
    let cancelled = false;

    function advanceAfter(ms) {
      if (!onEnded || cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) onEnded();
      }, ms);
    }

    img.addEventListener("load", () => {
      if (cancelled) return;
      spinner.remove();
      img.classList.add("loaded");
      // Timed from the load, so every still gets the same time on screen no
      // matter how long it took to arrive.
      advanceAfter(IMAGE_DURATION_MS);
    });

    img.addEventListener("error", () => {
      if (cancelled) return;

      if (retries < MAX_RETRIES) {
        retries++;
        // Retry after a short delay
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          img.src = "";
          img.src = post.mediaUrl;
        }, 500 * retries);
        return;
      }

      spinner.remove();
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#777;font-size:14px;";
      errDiv.textContent = "Failed to load image";
      container.innerHTML = "";
      container.appendChild(errDiv);
      advanceAfter(IMAGE_ERROR_ADVANCE_MS);
    });

    img.src = post.mediaUrl;
    container.appendChild(img);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      img.src = "";
      container.innerHTML = "";
    };
  },

  preload(post) {
    if (!post || !post.mediaUrl) return;
    const img = new Image();
    img.src = post.mediaUrl;
  },
};
