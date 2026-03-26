// Reddit Slideshow — image renderer

const ImageRenderer = {
  /**
   * Render an image post into the container.
   * @param {Object} post - Normalized post object
   * @param {HTMLElement} container - The #content-container element
   * @returns {Function} cleanup - Call to tear down this render
   */
  render(post, container) {
    // Clear previous content
    container.innerHTML = "";

    // Show loading spinner
    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    // Create image
    const img = document.createElement("img");
    img.alt = post.title;

    img.addEventListener("load", () => {
      spinner.remove();
      img.classList.add("loaded");
    });

    img.addEventListener("error", () => {
      spinner.remove();
      container.innerHTML = `<div style="color:#777;font-size:14px;">Failed to load image</div>`;
    });

    img.src = post.mediaUrl;
    container.appendChild(img);

    // Cleanup function
    return () => {
      img.src = "";
      container.innerHTML = "";
    };
  },

  /**
   * Preload an image so it's cached for instant display.
   * @param {Object} post - Normalized post object
   */
  preload(post) {
    if (!post || !post.mediaUrl) return;
    const img = new Image();
    img.src = post.mediaUrl;
  },
};
