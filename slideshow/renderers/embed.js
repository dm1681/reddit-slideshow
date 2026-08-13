// Reddit Slideshow — embed renderer (iframes for third-party content)

// A cross-origin player cannot be asked when it finished, so auto-advance
// falls back to a blind timer. The comment here used to claim 30s while the
// code said 15s; the viewer can now set it, and this is the default.
const EMBED_DURATION_MS = 15000;

function embedDwellMs() {
  if (typeof SlideshowSettings === "undefined") return EMBED_DURATION_MS;
  const value = SlideshowSettings.get("embedDwellMs");
  return typeof value === "number" ? value : EMBED_DURATION_MS;
}

const EmbedRenderer = {
  render(post, container, onEnded) {
    container.innerHTML = "";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    const iframe = document.createElement("iframe");
    iframe.src = post.mediaUrl;
    iframe.allow = "autoplay; fullscreen";
    iframe.setAttribute("allowfullscreen", "");
    iframe.style.cssText = "width:100%;height:100%;border:none;opacity:0;transition:opacity 0.3s ease;";

    let timer = null;
    let messageHandler = null;
    let advanced = false;

    function advance() {
      if (advanced || !onEnded) return;
      advanced = true;
      onEnded();
    }

    function startFallbackTimer() {
      if (!onEnded || timer) return;
      timer = setTimeout(advance, embedDwellMs());
    }

    iframe.addEventListener("load", () => {
      spinner.remove();
      iframe.style.opacity = "1";
      // Start the fallback timer AFTER the iframe loads, so the whole dwell is
      // viewing time rather than loading time.
      startFallbackTimer();
    });

    // If iframe doesn't fire load within 5s, show it anyway and start timer.
    // Kept so teardown can cancel it: a redgifs embed swapped out for its
    // resolved video would otherwise arm the advance timer from beyond the
    // grave and skip a slide the viewer is watching.
    const revealTimer = setTimeout(() => {
      if (spinner.parentNode) {
        spinner.remove();
        iframe.style.opacity = "1";
      }
      startFallbackTimer();
    }, 5000);

    container.appendChild(iframe);

    if (onEnded) {
      messageHandler = (event) => {
        // Only this player's own events count. Reddit's page scripts and any
        // other frame post messages too, and one that happened to look like an
        // end event would advance a slide out from under the viewer.
        if (event.source !== iframe.contentWindow) return;
        try {
          const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          if (data.event === "onStateChange" && data.info === 0) { advance(); return; }
          if (data.type === "ended" || data.type === "complete" || data.ended === true) { advance(); return; }
        } catch (e) {
          // Not relevant
        }
      };
      window.addEventListener("message", messageHandler);
    }

    return () => {
      advanced = true; // nothing from this teardown renderer may advance
      clearTimeout(revealTimer);
      if (timer) clearTimeout(timer);
      if (messageHandler) window.removeEventListener("message", messageHandler);
      iframe.src = "about:blank";
      container.innerHTML = "";
    };
  },

  preload(post) {
    // No preloading for embeds
  },
};
