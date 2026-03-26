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
    let retries = 0;
    const MAX_RETRIES = 2;

    img.addEventListener("load", () => {
      spinner.remove();
      img.classList.add("loaded");
      if (onEnded) {
        timer = setTimeout(onEnded, 5000);
      }
    });

    img.addEventListener("error", () => {
      if (retries < MAX_RETRIES) {
        retries++;
        // Retry after a short delay
        setTimeout(() => {
          img.src = "";
          img.src = post.mediaUrl;
        }, 500 * retries);
      } else {
        spinner.remove();
        const errDiv = document.createElement("div");
        errDiv.style.cssText = "color:#777;font-size:14px;";
        errDiv.textContent = "Failed to load image";
        container.innerHTML = "";
        container.appendChild(errDiv);
        if (onEnded) {
          timer = setTimeout(onEnded, 2000);
        }
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
