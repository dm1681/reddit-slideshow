// One slide per post. Every media rule here is ported from the extension's
// renderers, translated from "one live slide" to "pager with mounted
// neighbours": mount() may attach media while off-screen, but only activate()
// plays anything, and after deactivate()/unmount() NOTHING advances, plays,
// or schedules — the renderer-cleanup contract, enforced with cancelled flags
// exactly like the originals.
import { isGated, gateReason, reveal, GATE_DWELL_MS } from "../core/gate.js";
import { Settings, audioPref, saveAudioPref } from "../core/settings.js";
import { formatScore, formatCount, formatAge } from "../core/format.js";

const VIDEO_RETRY_DELAY_MS = 600;
const IMAGE_MAX_RETRIES = 2;
const ERROR_ADVANCE_MS = 2000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function imageDwellMs() {
  const value = Settings.get("imageDwellMs");
  return typeof value === "number" ? value : 5000;
}

// ---------------------------------------------------------------- rail + meta
function buildChrome(slide, post, ctx) {
  const rail = el("div", "rail");

  const mkBtn = (cls, glyph, label) => {
    const btn = el("button", `btn ${cls}`);
    btn.append(el("span", "disc", glyph));
    if (label !== undefined) btn.append(el("span", "lbl", label));
    rail.append(btn);
    return btn;
  };

  const up = mkBtn("up", "▲");
  up.setAttribute("aria-label", "Upvote");
  const score = el("div", "vote-score", formatScore(post.score));
  rail.append(score);
  const down = mkBtn("down", "▼");
  down.setAttribute("aria-label", "Downvote");
  const comments = mkBtn("comments", "💬", formatCount(post.numComments) || "—");
  comments.setAttribute("aria-label", "Open post and comments");
  const save = mkBtn("save", "☆", "Save");
  save.setAttribute("aria-label", "Save to Reddit");
  const auto = mkBtn("auto", "⏱", "Off");
  auto.setAttribute("aria-label", "Toggle auto-advance");

  up.addEventListener("click", () => ctx.onAction("up", up));
  down.addEventListener("click", () => ctx.onAction("down", down));
  save.addEventListener("click", () => ctx.onAction("save", save));
  comments.addEventListener("click", () => ctx.onAction("open", comments));
  auto.addEventListener("click", () => ctx.onAction("auto", auto));

  const meta = el("div", "meta");
  const chips = el("div", "chips");
  if (post.nsfw) chips.append(el("span", "chip adult", "18+"));
  if (post.spoiler) chips.append(el("span", "chip spoiler", "Spoiler"));
  if (post.galleryCount) {
    chips.append(el("span", "chip gallery", `Gallery ${post.galleryIndex} / ${post.galleryCount}`));
  }
  if (post.flair) chips.append(el("span", "chip", post.flair));
  if (chips.children.length) meta.append(chips);
  const title = el("div", "title", post.title || "(untitled post)");
  meta.append(title);
  const parts = [];
  if (post.subreddit) parts.push(`r/${post.subreddit}`);
  if (post.author) parts.push(`u/${post.author}`);
  const age = formatAge(post.createdUtc);
  if (age) parts.push(age);
  meta.append(el("div", "sub", parts.join(" · ")));

  slide.append(el("div", "scrim-top"), el("div", "scrim-bottom"), rail, meta);

  return {
    // State lives in the accessible name as well as the colour.
    refreshActions(fresh) {
      up.classList.toggle("on", fresh.likes === true);
      up.setAttribute("aria-pressed", String(fresh.likes === true));
      down.classList.toggle("on", fresh.likes === false);
      down.setAttribute("aria-pressed", String(fresh.likes === false));
      save.classList.toggle("on", fresh.saved === true);
      save.setAttribute("aria-pressed", String(fresh.saved === true));
      save.querySelector(".disc").textContent = fresh.saved ? "★" : "☆";
      save.querySelector(".lbl").textContent = fresh.saved ? "Saved" : "Save";
    },
    refreshAuto(state) {
      auto.classList.toggle("on", state !== "off");
      auto.setAttribute("aria-pressed", String(state !== "off"));
      auto.querySelector(".lbl").textContent =
        state === "off" ? "Off" : state === "waiting" ? "Wait…" : "Auto";
    },
  };
}

// ------------------------------------------------------------------ failures
function failureCard(stage, message, ctx, onRetry) {
  const card = el("div", "failcard");
  card.append(el("p", "failmsg", message));
  const retry = el("button", "failbtn", "Retry");
  retry.addEventListener("click", onRetry);
  card.append(retry);
  const open = el("button", "failbtn ghost", "Open on Reddit");
  open.addEventListener("click", () => ctx.onAction("open", open));
  card.append(open);
  stage.append(card);
  return card;
}

// -------------------------------------------------------------------- mounts
// Each mount function returns a handle:
//   { activate(), deactivate(), destroy() }
// destroy() is the hard teardown; deactivate() must already silence the slide.

function mountVideo(stage, slide, post, ctx) {
  let cancelled = false;
  let active = false;
  let retried = false;
  let timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!cancelled) fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };

  const isGif = post.isGif === true;
  const silent = post.hasAudio === false;

  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.loop = isGif;
  video.muted = silent || audioPref.muted;
  video.volume = audioPref.volume;
  video.className = "media-el";
  // True while the mute was imposed by us rather than chosen — never written
  // back to the preference.
  let autoMuted = silent;

  const spinner = el("div", "loading-spinner");
  stage.append(spinner, video);

  let soundPill = null;
  function showSoundPill() {
    if (soundPill || cancelled) return;
    soundPill = el("button", "soundhint", "🔇 Tap for sound");
    soundPill.addEventListener("click", (e) => {
      e.stopPropagation();
      restoreSound();
    });
    slide.append(soundPill);
  }
  function clearSoundPill() {
    if (soundPill) {
      soundPill.remove();
      soundPill = null;
    }
  }
  function restoreSound() {
    if (cancelled) return;
    autoMuted = false;
    video.muted = audioPref.muted;
    video.volume = audioPref.volume;
    clearSoundPill();
    if (active) video.play().catch(() => {});
  }

  // A mute chip so sound can be turned off without hunting for a system
  // control; this one IS the user's call, so it persists.
  const muteChip = el("button", "mutechip", audioPref.muted ? "🔇" : "🔊");
  if (!isGif && !silent) {
    muteChip.addEventListener("click", (e) => {
      e.stopPropagation();
      audioPref.muted = !video.muted;
      autoMuted = false;
      video.muted = audioPref.muted;
      muteChip.textContent = audioPref.muted ? "🔇" : "🔊";
      clearSoundPill();
      saveAudioPref();
    });
    slide.append(muteChip);
  }

  let progressBar = null;
  if (!isGif) {
    const track = el("div", "vprogress");
    progressBar = el("i");
    track.append(progressBar);
    slide.append(track);
    video.addEventListener("timeupdate", () => {
      if (cancelled || !video.duration) return;
      progressBar.style.width = `${(video.currentTime / video.duration) * 100}%`;
    });
  }

  function attemptPlay() {
    const started = video.play();
    if (!started || typeof started.catch !== "function") return;
    started.catch(() => {
      if (cancelled || video.muted) return;
      // Audible autoplay refused: play muted now, restore sound on a tap.
      autoMuted = true;
      video.muted = true;
      video.play().catch(() => {});
      showSoundPill();
    });
  }

  let failed = null;
  function handleMediaError() {
    if (cancelled) return;
    if (!retried) {
      // A media error can be a bad file or a blip mid-buffer; the element
      // reports both the same way. One retry separates them cheaply.
      retried = true;
      later(() => {
        video.load();
        video.src = post.mediaUrl;
        if (active) attemptPlay();
      }, VIDEO_RETRY_DELAY_MS);
      return;
    }
    spinner.remove();
    video.style.opacity = "0";
    failed = failureCard(stage, "This video would not play", ctx, () => {
      if (cancelled) return;
      failed.remove();
      failed = null;
      retried = false;
      video.style.opacity = "";
      video.src = post.mediaUrl;
      if (active) attemptPlay();
    });
    // A video that never loads never fires `ended`; without this grace,
    // auto-advance would stop here for good.
    if (active && ctx.isAutoOn()) later(() => {
      // auto-advance may have been switched off during the grace window
      if (ctx.isAutoOn()) ctx.onEnded();
    }, ERROR_ADVANCE_MS);
  }

  video.addEventListener("error", () => {
    // Teardown sets src="" and the element reports that as an error a tick
    // later; cancelled guards it, same as the extension.
    if (video.src) handleMediaError();
  });
  video.addEventListener("loadeddata", () => {
    if (cancelled) return;
    spinner.remove();
    video.classList.add("loaded");
  });
  video.addEventListener("ended", () => {
    if (cancelled || !active || isGif) return;
    if (ctx.isAutoOn()) ctx.onEnded();
    else {
      // No auto-advance: a finished video starts over, as loop would have.
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  });

  // Tap: restore sound if we owe it, otherwise pause/play.
  const onTap = () => {
    if (cancelled) return;
    if (autoMuted && !audioPref.muted && !silent) {
      restoreSound();
      return;
    }
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };
  stage.addEventListener("click", onTap);

  video.src = post.mediaUrl;

  // A gif never fires a meaningful `ended`: it advances on the still dwell,
  // never sooner than one full loop.
  function armGifAdvance() {
    if (!isGif || !ctx.isAutoOn()) return;
    const durationMs =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0;
    later(() => {
      if (active && ctx.isAutoOn()) ctx.onEnded();
    }, Math.max(imageDwellMs(), durationMs));
  }

  return {
    activate() {
      active = true;
      if (!failed) attemptPlay();
      if (isGif) {
        if (Number.isFinite(video.duration) && video.duration > 0) armGifAdvance();
        else video.addEventListener("loadedmetadata", armGifAdvance, { once: true });
      }
      if (failed && ctx.isAutoOn()) later(() => {
      // auto-advance may have been switched off during the grace window
      if (ctx.isAutoOn()) ctx.onEnded();
    }, ERROR_ADVANCE_MS);
    },
    deactivate() {
      active = false;
      clearTimers();
      video.pause();
    },
    destroy() {
      cancelled = true;
      clearTimers();
      clearSoundPill();
      stage.removeEventListener("click", onTap);
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}

function mountImage(stage, slide, post, ctx) {
  let cancelled = false;
  let active = false;
  let loaded = false;
  let retries = 0;
  let timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!cancelled) fn();
    }, ms);
    timers.add(t);
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };

  const spinner = el("div", "loading-spinner");
  const img = document.createElement("img");
  img.alt = post.title || "";
  img.className = "media-el";
  stage.append(spinner, img);

  // The dwell is timed from "visible and loaded", so every still gets the
  // same time on screen no matter how long it took to arrive.
  function armDwell() {
    if (!active || !loaded || !ctx.isAutoOn()) return;
    later(() => {
      if (active && ctx.isAutoOn()) ctx.onEnded();
    }, imageDwellMs());
  }

  let failed = null;
  img.addEventListener("load", () => {
    if (cancelled) return;
    spinner.remove();
    loaded = true;
    img.classList.add("loaded");
    armDwell();
  });
  img.addEventListener("error", () => {
    if (cancelled || !img.src) return;
    if (retries < IMAGE_MAX_RETRIES) {
      retries++;
      later(() => {
        img.src = "";
        img.src = post.mediaUrl;
      }, 500 * retries);
      return;
    }
    spinner.remove();
    failed = failureCard(stage, "Could not load this image", ctx, () => {
      if (cancelled) return;
      // A manual retry starts the whole budget again.
      retries = 0;
      failed.remove();
      failed = null;
      img.src = "";
      img.src = post.mediaUrl;
    });
    if (active && ctx.isAutoOn()) later(() => {
      // auto-advance may have been switched off during the grace window
      if (ctx.isAutoOn()) ctx.onEnded();
    }, ERROR_ADVANCE_MS);
  });

  img.src = post.mediaUrl;

  return {
    activate() {
      active = true;
      armDwell();
      if (failed && ctx.isAutoOn()) later(() => {
      // auto-advance may have been switched off during the grace window
      if (ctx.isAutoOn()) ctx.onEnded();
    }, ERROR_ADVANCE_MS);
    },
    deactivate() {
      active = false;
      clearTimers();
    },
    destroy() {
      cancelled = true;
      clearTimers();
      img.src = "";
    },
  };
}

function mountDwellOnly(post, ctx, build) {
  // text posts, link cards, and the gate share one lifecycle: static content
  // plus a dwell when auto-advance is on.
  let active = false;
  let timer = null;
  const dwell = build.dwellMs;
  return {
    activate() {
      active = true;
      if (ctx.isAutoOn()) {
        timer = setTimeout(() => {
          if (active && ctx.isAutoOn()) ctx.onEnded();
        }, dwell);
      }
    },
    deactivate() {
      active = false;
      clearTimeout(timer);
      timer = null;
    },
    destroy() {
      active = false;
      clearTimeout(timer);
    },
  };
}

function mountText(stage, slide, post, ctx) {
  const card = el("article", "textcard");
  card.append(el("h2", "texttitle", post.title));
  const body = el("div", "textbody");
  // Plain paragraphs on purpose: selftext is untrusted markdown and this app
  // has no sanitiser; text renders as text.
  String(post.selftext || "")
    .split(/\n{2,}/)
    .slice(0, 40)
    .forEach((p) => body.append(el("p", null, p)));
  card.append(body);
  stage.append(card);
  return mountDwellOnly(post, ctx, { dwellMs: imageDwellMs() });
}

function mountLink(stage, slide, post, ctx) {
  const card = el("div", "linkcard");
  if (post.linkPreview) {
    const img = document.createElement("img");
    img.className = "linkthumb";
    img.alt = "";
    img.src = post.linkPreview;
    card.append(img);
  }
  card.append(el("div", "linkdomain", post.domain || "external link"));
  card.append(el("h2", "linktitle", post.title));
  const open = el("button", "failbtn", "Open link");
  open.addEventListener("click", () => ctx.openExternal(post.originalUrl));
  card.append(open);
  stage.append(card);
  return mountDwellOnly(post, ctx, { dwellMs: imageDwellMs() });
}

function mountGate(stage, slide, post, ctx) {
  const reason = gateReason(post);
  slide.classList.add("gated");
  const card = el("div", "gatecard");
  card.append(el("span", `gatetag ${reason === "Adult" ? "adult" : "spoiler"}`,
    reason === "Adult" ? "18+ Adult" : "Spoiler"));
  card.append(el("p", "gtitle", post.title || "(untitled post)"));
  const btn = el("button", "reveal", "Reveal this post");
  btn.addEventListener("click", () => {
    reveal(post);
    ctx.remount();
  });
  card.append(btn);
  card.append(el("p", "gatenote",
    `Hidden because it is tagged ${reason.toLowerCase()}. The file has not ` +
    `been downloaded. Turn the mask off for good in Settings.`));
  stage.append(card);
  return mountDwellOnly(post, ctx, { dwellMs: GATE_DWELL_MS });
}

// ------------------------------------------------------------------- assembly
export function createSlide(initialPost, ctx) {
  // The pager reassigns api.post on every feed update, so actions and
  // remounts always read the live object — an optimistic vote/save replaces
  // the post immutably in the store, and computing the next toggle from a
  // frozen creation-time copy made "press again to undo" impossible.
  let post = initialPost;
  const slide = el("section", `slide type-${post.type}`);
  slide.dataset.postId = post.id;
  const stage = el("div", "stage");
  slide.append(stage);
  const chrome = buildChrome(slide, post, ctx);
  chrome.refreshActions(post);

  let handle = null;

  function mountContent() {
    // Deliberately checked here, before any media element exists: nothing may
    // be handed the media URL for a gated post.
    if (isGated(post)) {
      handle = mountGate(stage, slide, post, { ...ctx, remount });
      return;
    }
    slide.classList.remove("gated");
    if (post.type === "video") handle = mountVideo(stage, slide, post, ctx);
    else if (post.type === "image") handle = mountImage(stage, slide, post, ctx);
    else if (post.type === "text") handle = mountText(stage, slide, post, ctx);
    else handle = mountLink(stage, slide, post, ctx);
  }

  function remount() {
    const wasActive = api.active;
    api.unmount();
    api.mount();
    if (wasActive) api.activate();
  }

  const api = {
    el: slide,
    get post() {
      return post;
    },
    set post(next) {
      if (next) post = next;
    },
    chrome,
    active: false,
    mounted: false,
    mount() {
      if (api.mounted) return;
      api.mounted = true;
      mountContent();
    },
    unmount() {
      if (!api.mounted) return;
      api.mounted = false;
      if (handle) handle.destroy();
      handle = null;
      stage.textContent = "";
      // per-slide extras that mounts append outside the stage
      slide.querySelectorAll(".soundhint, .mutechip, .vprogress").forEach((n) => n.remove());
    },
    activate() {
      if (!api.mounted) api.mount();
      if (api.active) return;
      api.active = true;
      slide.classList.add("active");
      if (handle) handle.activate();
    },
    deactivate() {
      if (!api.active) return;
      api.active = false;
      slide.classList.remove("active");
      if (handle) handle.deactivate();
    },
  };
  return api;
}
