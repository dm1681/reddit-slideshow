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

// A media error can be a genuinely bad file or a blip mid-buffer — the element
// reports both the same way. One retry separates them cheaply.
const VIDEO_RETRY_DELAY_MS = 600;

// A gif delivered as mp4 is a still that moves, not a video: it gets the same
// dwell a still gets, and is never cut off part-way through a loop. Advancing
// on `ended` is what made a gallery of gifs flick past — an eight-item gallery
// of 1.2s clips was gone in ten seconds while a single photo sat for five.
const GIF_FALLBACK_DWELL_MS = 5000;

function gifDwellMs() {
  if (typeof SlideshowSettings === "undefined") return GIF_FALLBACK_DWELL_MS;
  const value = SlideshowSettings.get("imageDwellMs");
  return typeof value === "number" ? value : GIF_FALLBACK_DWELL_MS;
}

const VideoRenderer = {
  // onFail, when given, is the caller's escape hatch: the file could not be
  // played even after a retry, and the post is better shown some other way
  // than written off.
  render(post, container, onEnded, onFail) {
    container.innerHTML = "";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    container.appendChild(spinner);

    // Gifs re-encoded as mp4 — gallery items, imgur .gifv. Silent by
    // construction, so a scrub bar is furniture and looping is the point.
    const isGif = post.isGif === true;

    const video = document.createElement("video");
    video.controls = !isGif;
    // A gif always loops; a real video only when nothing is waiting on it to end.
    video.loop = isGif || !onEnded;
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
    let retryTimer = null;
    let gifTimer = null;
    let failureCard = null;
    let retried = false;

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

    // A blip while buffering used to be fatal: the video was wiped and, with
    // auto-advance on, the post skipped two seconds later — even when it was
    // perfectly watchable in the player it came from.
    function handleMediaError() {
      if (cancelled) return;

      const code = video.error ? video.error.code : null;
      if (!retried) {
        retried = true;
        console.warn("[reddit-slideshow] video error, retrying:", post.mediaUrl, "code", code);
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          video.load();
          video.src = post.mediaUrl;
        }, VIDEO_RETRY_DELAY_MS);
        return;
      }

      console.warn("[reddit-slideshow] video unplayable:", post.mediaUrl, "code", code);
      if (onFail) {
        onFail();
        return;
      }
      showError();
    }

    function showError() {
      // Teardown sets src="" on the outgoing <video>, and Firefox reports that
      // as an error a tick later — by which time the container already holds
      // the next slide. Reporting it then would wipe the post the viewer just
      // moved to.
      if (cancelled) return;
      spinner.remove();

      // video.error carries a code Firefox worked out itself — unsupported
      // codec, decode failure, interrupted download — which is better than
      // anything that can be inferred from the URL.
      const code = video.error ? video.error.code : null;
      if (typeof MediaFailure === "undefined") {
        const errDiv = document.createElement("div");
        errDiv.className = "media-error slide-message";
        errDiv.textContent = "Could not load this video";
        container.textContent = "";
        container.appendChild(errDiv);
      } else {
        failureCard = MediaFailure.show(container, {
          post,
          url: post.mediaUrl,
          kind: "video",
          code,
          willAdvance: !!onEnded,
        });
      }

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
      // A looping gif never fires `ended`, so its advance is timed from here —
      // once the duration is known, and only once.
      armGifAdvance();
    });

    video.addEventListener("error", handleMediaError);

    // A gif gets the still dwell, but never less than one full loop: the
    // shortest clip still reads, and a long one is not cut in half.
    function armGifAdvance() {
      if (!isGif || !onEnded || cancelled || gifTimer) return;
      const durationMs =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0;
      gifTimer = setTimeout(() => {
        if (!cancelled) onEnded();
      }, Math.max(gifDwellMs(), durationMs));
    }

    if (onEnded && !isGif) {
      // Guarded like every other advance here: nothing from a torn-down
      // renderer may move the slideshow off the slide that replaced it.
      video.addEventListener("ended", () => {
        if (!cancelled) onEnded();
      });
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
      if (retryTimer) clearTimeout(retryTimer);
      if (gifTimer) clearTimeout(gifTimer);
      if (failureCard) failureCard.cancel();
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
