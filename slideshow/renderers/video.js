// Reddit Slideshow — video renderer

// Resolve a bare v.redd.it URL to its best playable rendition by reading the
// DASH manifest (rendition filenames changed before — CMAF_* era — so they are
// discovered, never guessed). Returns null if the manifest is unavailable.
async function resolveVredditUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  const resp = await fetch(`${base}/DASHPlaylist.mpd`);
  if (!resp.ok) return null;
  const xml = new DOMParser().parseFromString(await resp.text(), "application/xml");

  let best = null;
  xml.querySelectorAll("Representation").forEach((rep) => {
    const adaptation = rep.closest("AdaptationSet");
    const contentType = adaptation ? adaptation.getAttribute("contentType") || "" : "";
    const mime = rep.getAttribute("mimeType") || "";
    if (contentType !== "video" && !mime.startsWith("video")) return;

    const baseUrlEl = rep.querySelector("BaseURL");
    if (!baseUrlEl) return;

    const bandwidth = parseInt(rep.getAttribute("bandwidth") || "0", 10);
    if (!best || bandwidth > best.bandwidth) {
      best = { bandwidth, file: baseUrlEl.textContent.trim() };
    }
  });

  return best ? `${base}/${best.file}` : null;
}

const VideoRenderer = {
  render(post, container, onEnded) {
    container.innerHTML = "";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.loop = !onEnded; // Only loop if auto-advance is off
    video.muted = false;
    video.playsInline = true;
    video.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;opacity:0;transition:opacity 0.3s ease;";

    let cancelled = false;

    function showError() {
      spinner.remove();
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#777;font-size:14px;";
      errDiv.textContent = "Failed to load video";
      container.innerHTML = "";
      container.appendChild(errDiv);
    }

    video.addEventListener("loadeddata", () => {
      spinner.remove();
      video.style.opacity = "1";
    });

    video.addEventListener("error", showError);

    if (onEnded) {
      video.addEventListener("ended", onEnded);
    }

    container.appendChild(video);

    // Bare v.redd.it URLs need rendition discovery via the DASH manifest;
    // anything else is a direct file and plays as-is.
    if (/^https?:\/\/v\.redd\.it\/[\w-]+\/?$/.test(post.mediaUrl)) {
      resolveVredditUrl(post.mediaUrl)
        .then((url) => {
          if (cancelled) return;
          if (url) {
            video.src = url;
          } else {
            showError();
          }
        })
        .catch(() => {
          if (!cancelled) showError();
        });
    } else {
      video.src = post.mediaUrl;
    }

    return () => {
      cancelled = true;
      video.pause();
      video.src = "";
      container.innerHTML = "";
    };
  },

  preload(post) {
    // No preloading for video
  },
};
