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

    iframe.addEventListener("load", () => {
      spinner.remove();
      iframe.style.opacity = "1";
    });

    // Timeout fallback — some embeds don't fire load reliably
    setTimeout(() => {
      if (spinner.parentNode) {
        spinner.remove();
        iframe.style.opacity = "1";
      }
    }, 3000);

    container.appendChild(iframe);

    let timer = null;
    let messageHandler = null;

    if (onEnded) {
      // Listen for postMessage from embed iframes that signal video end
      // Some players (like redgifs) post messages we can use
      messageHandler = (event) => {
        try {
          const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          // YouTube iframe API sends {"event":"onStateChange","info":0} when video ends (0 = ended)
          if (data.event === "onStateChange" && data.info === 0) {
            onEnded();
            return;
          }
          // Generic: look for "ended", "complete", "finished" signals
          if (data.type === "ended" || data.type === "complete" || data.ended === true) {
            onEnded();
            return;
          }
        } catch (e) {
          // Not JSON or not relevant — ignore
        }
      };
      window.addEventListener("message", messageHandler);

      // Fallback timer — if no end signal received, advance after 15s
      timer = setTimeout(onEnded, 15000);
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
