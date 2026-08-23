// The vertical pager. This is the architectural translation the extension
// couldn't provide: ~3 slides stay mounted (previous/current/next) so the
// swipe has real content on both sides, and PAGE-ACTIVENESS — not
// mount/unmount — decides what plays. An inactive page is paused, silent, and
// schedules nothing; a gated page never receives its media URL at all.
import { createSlide } from "./slides.js";
import { isGated } from "../core/gate.js";
import { Settings } from "../core/settings.js";

// The refill can be slow; a single miss means "not yet", not "never".
const AWAIT_MORE_RETRY_MS = 1500;

export function createPager({ container, feed, chrome, actions }) {
  const slides = [];
  let activeIndex = -1;
  let waiting = false;
  let waitTimer = null;
  let endSlide = null;

  const autoOn = () => Settings.get("autoAdvance");
  const autoState = () => (!autoOn() ? "off" : waiting ? "waiting" : "on");

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = slides.findIndex((s) => s && s.el === entry.target);
        if (idx >= 0) setActive(idx);
        else if (endSlide && entry.target === endSlide) onEndSlideVisible();
      }
    },
    { root: container, threshold: 0.6 }
  );

  function slideCtx(index) {
    return {
      isAutoOn: autoOn,
      onEnded: () => {
        // Guarded like every advance in the extension: only the slide that is
        // actually current may move the feed.
        if (index === activeIndex) advance();
      },
      onAction: (kind, buttonEl) => actions(kind, slides[index], buttonEl),
      openExternal: actions.openExternal,
    };
  }

  function ensureSlides() {
    const posts = feed.posts;
    for (let i = slides.length; i < posts.length; i++) {
      const slide = createSlide(posts[i], slideCtx(i));
      slide.chrome.refreshAuto(autoState());
      slides.push(slide);
      container.appendChild(slide.el);
      observer.observe(slide.el);
    }
    if (feed.exhausted && !endSlide && posts.length) {
      endSlide = document.createElement("section");
      endSlide.className = "slide endslide";
      endSlide.innerHTML = "";
      const card = document.createElement("div");
      card.className = "endcard";
      const h = document.createElement("h2");
      h.textContent = "You're all caught up";
      const p = document.createElement("p");
      p.textContent = `End of ${feed.source.label} — ${posts.length} posts.`;
      const btn = document.createElement("button");
      btn.className = "failbtn";
      btn.textContent = "Back to the top";
      btn.addEventListener("click", () => scrollToIndex(0));
      card.append(h, p, btn);
      endSlide.append(card);
      container.appendChild(endSlide);
      observer.observe(endSlide);
    }
  }

  // Mount the window, activate the current, silence everything else.
  function applyWindow() {
    slides.forEach((slide, i) => {
      const inWindow = Math.abs(i - activeIndex) <= 1;
      if (inWindow) {
        if (!slide.mounted) slide.mount();
      } else if (slide.mounted) {
        slide.deactivate();
        slide.unmount();
      }
      if (i !== activeIndex) slide.deactivate();
    });
    const current = slides[activeIndex];
    if (current) current.activate();
  }

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    stopWaiting();
    applyWindow();
    chrome.update({ index, total: feed.posts.length, exhausted: feed.exhausted });
    feed.ensure(index);
  }

  function onEndSlideVisible() {
    const current = slides[activeIndex];
    if (current) current.deactivate();
    chrome.update({
      index: feed.posts.length - 1,
      total: feed.posts.length,
      exhausted: true,
      atEnd: true,
    });
  }

  function scrollToIndex(index) {
    container.scrollTo({ top: index * container.clientHeight, behavior: "smooth" });
  }

  function stopWaiting() {
    waiting = false;
    clearTimeout(waitTimer);
    waitTimer = null;
    refreshAutoLabels();
  }

  function waitForMore() {
    clearTimeout(waitTimer);
    feed.ensure(activeIndex);
    waitTimer = setTimeout(() => {
      if (autoOn() && waiting) waitForMore();
    }, AWAIT_MORE_RETRY_MS);
  }

  // Running off the end used to stop the extension's auto-advance in silence;
  // the ported rules: more coming → hold visibly and resume by itself;
  // truly exhausted → stop WITHOUT touching the current slide (re-rendering
  // would restart its media) and land on the end card.
  function advance() {
    if (!autoOn()) return;
    if (activeIndex < slides.length - 1) {
      stopWaiting();
      scrollToIndex(activeIndex + 1);
      return;
    }
    if (feed.exhausted) {
      Settings.set("autoAdvance", false);
      if (endSlide) container.scrollTo({ top: endSlide.offsetTop, behavior: "smooth" });
      return;
    }
    waiting = true;
    refreshAutoLabels();
    waitForMore();
  }

  function refreshAutoLabels() {
    const state = autoState();
    slides.forEach((s) => s.mounted && s.chrome.refreshAuto(state));
    chrome.setAutoState(state);
  }

  feed.onUpdate(() => {
    ensureSlides();
    // Refresh optimistic action state on whatever is mounted.
    slides.forEach((slide, i) => {
      if (slide.mounted) slide.chrome.refreshActions(feed.posts[i] || slide.post);
    });
    chrome.update({ index: activeIndex, total: feed.posts.length, exhausted: feed.exhausted });
    if (waiting && activeIndex < slides.length - 1) {
      stopWaiting();
      advance();
    } else if (waiting && feed.exhausted) {
      stopWaiting();
      advance();
    }
  });

  Settings.onChange((key) => {
    if (key === "autoAdvance") {
      // Re-arm or disarm the current slide's timers without restarting its
      // media: deactivate() cancels, activate() re-arms from now.
      const current = slides[activeIndex];
      if (current && current.active) {
        current.deactivate();
        current.activate();
      }
      stopWaiting();
      refreshAutoLabels();
    }
    if (key === "maskNsfw") {
      // The mask changed under mounted slides: remount any whose gating no
      // longer matches what is on screen. The revealed set survives.
      slides.forEach((slide) => {
        if (!slide.mounted) return;
        const gatedNow = isGated(slide.post);
        const showsGate = slide.el.classList.contains("gated");
        if (gatedNow !== showsGate) {
          const wasActive = slide.active;
          slide.deactivate();
          slide.unmount();
          slide.mount();
          if (wasActive) slide.activate();
        }
      });
    }
  });

  // Desktop/dev conveniences; guarded so focused controls keep their keys.
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target;
    if (target && typeof target.closest === "function" &&
        target.closest("button, input, select, textarea, [role=\"button\"]")) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (activeIndex < slides.length - 1) scrollToIndex(activeIndex + 1);
      else if (endSlide) container.scrollTo({ top: endSlide.offsetTop, behavior: "smooth" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (activeIndex > 0) scrollToIndex(activeIndex - 1);
    } else if (e.key === " ") {
      e.preventDefault();
      Settings.set("autoAdvance", !Settings.get("autoAdvance"));
    }
  });

  return {
    start() {
      ensureSlides();
      if (slides.length) setActive(0);
    },
    scrollToIndex,
    get activeIndex() {
      return activeIndex;
    },
    get slides() {
      return slides;
    },
  };
}
