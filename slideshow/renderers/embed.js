// Reddit Slideshow — embed renderer (iframes for third-party content)

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
      timer = setTimeout(advance, 15000);
    }

    iframe.addEventListener("load", () => {
      spinner.remove();
      iframe.style.opacity = "1";
      // Start the fallback timer AFTER iframe loads, so the full 15s is viewing time
      startFallbackTimer();
    });

    // If iframe doesn't fire load within 5s, show it anyway and start timer
    setTimeout(() => {
      if (spinner.parentNode) {
        spinner.remove();
        iframe.style.opacity = "1";
      }
      startFallbackTimer();
    }, 5000);

    container.appendChild(iframe);

    if (onEnded) {
      messageHandler = (event) => {
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
