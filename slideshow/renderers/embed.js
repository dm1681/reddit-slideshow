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

    // Embeds can't signal when done — use a timer fallback if auto-advancing
    let timer = null;
    if (onEnded) {
      // Give embeds a generous duration (30s) since we can't detect their end
      timer = setTimeout(onEnded, 30000);
    }

    return () => {
      if (timer) clearTimeout(timer);
      iframe.src = "about:blank";
      container.innerHTML = "";
    };
  },

  preload(post) {
    // No preloading for embeds
  },
};
