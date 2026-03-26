// Reddit Slideshow — video renderer

const VideoRenderer = {
  render(post, container) {
    container.innerHTML = "";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.muted = false;
    video.playsInline = true;
    video.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;opacity:0;transition:opacity 0.3s ease;";

    video.addEventListener("loadeddata", () => {
      spinner.remove();
      video.style.opacity = "1";
    });

    video.addEventListener("error", () => {
      spinner.remove();
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#777;font-size:14px;";
      errDiv.textContent = "Failed to load video";
      container.innerHTML = "";
      container.appendChild(errDiv);
    });

    video.src = post.mediaUrl;
    container.appendChild(video);

    return () => {
      video.pause();
      video.src = "";
      container.innerHTML = "";
    };
  },

  preload(post) {
    // No preloading for video — too expensive
  },
};
