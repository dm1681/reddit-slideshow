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

// Every post gets a fresh <video>, so the user's volume choice has to live
// outside the element or they'd be unmuting on every single slide.
const AUDIO_PREF_KEY = "reddit-slideshow.audio";

const audioPref = (function loadAudioPref() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUDIO_PREF_KEY));
    if (stored) {
      return {
        muted: stored.muted === true,
        volume: typeof stored.volume === "number" ? Math.min(1, Math.max(0, stored.volume)) : 1,
      };
    }
  } catch (e) {
    // No storage (or corrupt value) — sound on is the sane default
  }
  return { muted: false, volume: 1 };
})();

function saveAudioPref() {
  try {
    localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify(audioPref));
  } catch (e) {
    // Storage unavailable — the preference still holds for this session
  }
}

const VideoRenderer = {
  render(post, container, onEnded) {
    container.innerHTML = "";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    const video = document.createElement("video");
    video.controls = true;
    video.loop = !onEnded; // Only loop if auto-advance is off
    video.muted = audioPref.muted;
    video.volume = audioPref.volume;
    video.playsInline = true;
    video.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;opacity:0;transition:opacity 0.3s ease;";

    // A post known to carry no audio track starts muted so the browser's
    // audible-autoplay block never kicks in for a silent clip.
    const silent = post.hasAudio === false;
    if (silent) video.muted = true;

    let cancelled = false;
    // True while the mute was imposed by us (silent clip or autoplay policy)
    // rather than chosen by the user — never write that back to the preference.
    let autoMuted = silent;
    let soundHint = null;
    let gestureHandler = null;
    let errorTimer = null;

    function clearSoundHint() {
      if (soundHint) {
        soundHint.remove();
        soundHint = null;
      }
      if (gestureHandler) {
        document.removeEventListener("pointerdown", gestureHandler);
        document.removeEventListener("keydown", gestureHandler);
        gestureHandler = null;
      }
    }

    // Firefox blocks audible autoplay until the page has seen a user gesture.
    // Rather than leave the video paused, play it muted and restore sound on
    // the next click or keypress — so the user unmutes at most once per page.
    function restoreSoundOnGesture() {
      if (gestureHandler) return;

      soundHint = document.createElement("div");
      soundHint.textContent = "🔇 Click or press a key for sound";
      soundHint.style.cssText =
        // 72px clears the top bar; absolute offsets ignore the container padding.
        "position:absolute;top:72px;left:50%;transform:translateX(-50%);" +
        "background:rgba(0,0,0,0.75);color:#eee;font-size:13px;padding:6px 12px;" +
        "border-radius:4px;pointer-events:none;z-index:5;";
      container.appendChild(soundHint);

      gestureHandler = (event) => {
        // Clicks on the player's own controls are left alone: unmuting here
        // first would let the native mute toggle flip it right back.
        if (event.target === video) return;
        clearSoundHint();
        if (cancelled) return;
        autoMuted = false;
        video.muted = audioPref.muted;
        video.volume = audioPref.volume;
        video.play().catch(() => {});
      };
      document.addEventListener("pointerdown", gestureHandler);
      document.addEventListener("keydown", gestureHandler);
    }

    function attemptPlay() {
      const started = video.play();
      if (!started || typeof started.catch !== "function") return;
      started.catch(() => {
        if (cancelled || video.muted) return;
        autoMuted = true;
        video.muted = true;
        video.play().catch(() => {});
        restoreSoundOnGesture();
      });
    }

    video.addEventListener("volumechange", () => {
      // Ignore the mute we imposed ourselves; anything else is the user's call.
      if (autoMuted && video.muted) return;
      autoMuted = false;
      clearSoundHint();
      audioPref.muted = video.muted;
      audioPref.volume = video.volume;
      saveAudioPref();
    });

    function showError() {
      // Teardown sets src="" on the outgoing <video>, and Firefox reports that
      // as an error a tick later — by which time the container already holds
      // the next slide. Reporting it then would wipe the post the viewer just
      // moved to.
      if (cancelled) return;
      spinner.remove();
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#777;font-size:14px;";
      errDiv.textContent = "Failed to load video";
      container.innerHTML = "";
      container.appendChild(errDiv);

      // A video that never loads never fires `ended`, so auto-advance would
      // stop here for good. Same 2s grace the image renderer gives an error.
      if (onEnded) errorTimer = setTimeout(onEnded, 2000);
    }

    video.addEventListener("loadeddata", () => {
      spinner.remove();
      video.style.opacity = "1";
      // Played explicitly instead of via the autoplay attribute, so a blocked
      // start surfaces as a rejected promise we can fall back from.
      attemptPlay();
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
      // Cleared with the renderer: an advance queued by a dead slide would
      // skip whatever replaced it.
      if (errorTimer) clearTimeout(errorTimer);
      clearSoundHint();
      video.pause();
      video.src = "";
      container.innerHTML = "";
    };
  },

  preload(post) {
    // No preloading for video
  },
};
