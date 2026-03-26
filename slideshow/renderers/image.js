// Reddit Slideshow — image renderer

const ImageRenderer = {
  render(post, container, onEnded) {
    container.innerHTML = "";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    const img = document.createElement("img");
    img.alt = post.title;
    let timer = null;

    img.addEventListener("load", () => {
      spinner.remove();
      img.classList.add("loaded");
      // Images have no natural end — use a timer if auto-advance is on
      if (onEnded) {
        timer = setTimeout(onEnded, 5000);
      }
    });

    img.addEventListener("error", () => {
      spinner.remove();
      container.innerHTML = `<div style="color:#777;font-size:14px;">Failed to load image</div>`;
      // Advance past broken images quickly
      if (onEnded) {
        timer = setTimeout(onEnded, 2000);
      }
    });

    img.src = post.mediaUrl;
    container.appendChild(img);

    return () => {
      if (timer) clearTimeout(timer);
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
