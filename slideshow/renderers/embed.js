// Reddit Slideshow — embed renderer (iframes for third-party content)
// Embeds don't auto-advance — we can't detect when cross-origin content finishes.
// User must manually advance past embeds (arrow keys or click).

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

    // No auto-advance for embeds — user must manually advance
    // (we can't detect when cross-origin iframe content finishes)

    return () => {
      iframe.src = "about:blank";
      container.innerHTML = "";
    };
  },

  preload(post) {
    // No preloading for embeds
  },
};
