// Reddit Slideshow — slideshow controller

(async function () {
  // --- Mode detection ---
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "overlay"; // "overlay" or "popout"

  // --- DOM references ---
  const contentContainer = document.getElementById("content-container");
  const progress = document.getElementById("progress");
  const ticks = document.getElementById("ticks");
  const railNote = document.getElementById("rail-note");
  const postTitle = document.getElementById("post-title");
  const postMeta = document.getElementById("post-meta");
  const scoreEl = document.getElementById("score");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const closeBtn = document.getElementById("close-btn");
  const popoutBtn = document.getElementById("popout-btn");
  const autoAdvanceBtn = document.getElementById("auto-advance-btn");
  const saveBtn = document.getElementById("save-btn");
  const openBtn = document.getElementById("open-btn");
  const upvoteBtn = document.getElementById("upvote-btn");
  const downvoteBtn = document.getElementById("downvote-btn");
  const reelBtn = document.getElementById("reel-btn");
  const fullscreenBtn = document.getElementById("fullscreen-btn");

  // The Reel is optional: the controller works without it, and the standalone
  // harnesses do not load it.
  const reelOpen = () => typeof Reel !== "undefined" && Reel.isOpen();

  // --- State ---
  let posts = [];
  let currentIndex = 0;
  let cleanupCurrentRender = null;
  let autoAdvanceOn = false;
  let exhausted = false;
  let fetchInProgress = false;
  let initialized = false;
  // An update that arrived before init finished, held back so init's own
  // (older) snapshot cannot overwrite it.
  let pendingPosts = null;

  // --- Adult / spoiler gate ---
  //
  // Reddit puts a click-through in front of this content and the slideshow
  // removed it, painting adult media unblurred at full screen — while the
  // manifest asks for redgifs host permission and the background carries a
  // dedicated redgifs resolver. So the gate is not a nicety.
  //
  // It works by withholding the URL, not by blurring. filter:blur() still
  // downloads and decodes the whole image; it is a cosmetic screen over
  // content that has already arrived, not a gate.
  //
  // Revealing is per post and lasts the session. The global switch is in the
  // Reel panel and the popup, and is remembered between sessions.
  const revealed = new Set();

  function maskEnabled() {
    return typeof SlideshowSettings === "undefined" || SlideshowSettings.get("maskNsfw");
  }

  function gateReason(post) {
    if (!post) return null;
    if (post.nsfw) return "Adult";
    if (post.spoiler) return "Spoiler";
    return null;
  }

  function isGated(post) {
    return !!post && !!gateReason(post) && maskEnabled() && !revealed.has(post.id);
  }

  // Short, so a session with the mask on does not stall on a wall of grey
  // cards — but not instant, or the viewer never sees what was skipped.
  const GATE_DWELL_MS = 2500;

  function renderGate(post, onEnded) {
    const reason = gateReason(post);

    const card = document.createElement("div");
    card.className = "gate";

    const tag = document.createElement("span");
    tag.className = "gate-tag";
    tag.textContent = reason === "Adult" ? "18+ Adult" : "Spoiler";
    card.appendChild(tag);

    const heading = document.createElement("p");
    heading.className = "gate-title";
    heading.textContent = post.title || "(untitled post)";
    card.appendChild(heading);

    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "gate-reveal";
    reveal.textContent = "Reveal this post  (R)";
    reveal.addEventListener("click", revealCurrent);
    card.appendChild(reveal);

    const note = document.createElement("p");
    note.className = "gate-note";
    note.textContent = "Hidden because it is tagged " + reason.toLowerCase() +
      ". Turn the mask off for good in the Reel panel (?).";
    card.appendChild(note);

    contentContainer.textContent = "";
    contentContainer.appendChild(card);

    let timer = null;
    let cancelled = false;
    if (onEnded) {
      timer = setTimeout(() => {
        if (!cancelled) onEnded();
      }, GATE_DWELL_MS);
    }

    // Same contract as a renderer: after cleanup, nothing advances.
    return () => {
      cancelled = true;
      clearTimeout(timer);
      contentContainer.textContent = "";
    };
  }

  function revealCurrent() {
    const post = posts[currentIndex];
    if (!post || !isGated(post)) return;
    revealed.add(post.id);
    renderCurrentPost();
  }

  function toggleMask() {
    if (typeof SlideshowSettings === "undefined") return;
    SlideshowSettings.set("maskNsfw", !SlideshowSettings.get("maskNsfw"));
  }

  // Errors and empty states are the only thing on screen when they appear, so
  // they get real type rather than 12px of #777 on black.
  function showMessage(text) {
    const div = document.createElement("div");
    div.className = "slide-message";
    div.textContent = text;
    contentContainer.textContent = "";
    contentContainer.appendChild(div);
  }

  // --- Renderer map ---
  const renderers = {
    image: ImageRenderer,
    video: VideoRenderer,
    embed: EmbedRenderer,
  };

  // --- Fetch initial state from background ---
  async function init() {
    try {
      const state = await browser.runtime.sendMessage({ type: "getCurrentState" });
      if (state.error) {
        showMessage(state.error);
        return;
      }
      posts = state.posts;
      currentIndex = state.currentIndex || 0;
      exhausted = state.exhausted || false;

      // An update that landed while this was in flight is the fresher list —
      // taking state.posts over it would put the embed fallbacks back.
      initialized = true;
      if (pendingPosts) {
        posts = pendingPosts;
        pendingPosts = null;
      }

      if (posts.length === 0) {
        showMessage(
          "No posts found on this page. Scroll the Reddit tab so some posts have loaded, then start the slideshow again."
        );
        return;
      }

      renderCurrentPost();
      pullUntilResolved();
    } catch (e) {
      showMessage("Error loading slideshow");
    }
  }

  // --- Posts resolved after this page snapshotted them ---
  // Redgifs embeds become direct videos here, arriving either as a push from
  // the background or through the pull below.
  function applyPosts(next) {
    if (!Array.isArray(next) || next.length === 0) return;

    // Nothing is on screen yet — hold it for init, which would otherwise
    // overwrite it with the snapshot it is already fetching.
    if (!initialized) {
      pendingPosts = next;
      return;
    }

    const before = posts[currentIndex];
    posts = mergeLocalState(next);
    const after = posts[currentIndex];

    // Re-render only when the post on screen actually changed, so an update
    // never restarts playback of something the viewer is already watching.
    const changed =
      before && after && before.id === after.id &&
      (before.type !== after.type || before.mediaUrl !== after.mediaUrl);

    console.log(
      "[reddit-slideshow] posts updated:",
      posts.length,
      "index", currentIndex,
      before ? `${before.type}→${after && after.type}` : "(nothing on screen)",
      changed ? "re-rendering" : "no change on screen"
    );

    if (changed) {
      renderCurrentPost();
    } else {
      updateProgress();
      updateNavButtons();
      updateActionButtons();
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "postsUpdated") applyPosts(message.posts);
  });

  // A push can be missed — sent before this page was listening, or not
  // delivered at all — and the first batch would then sit on the muted embed
  // player for the whole session. So ask, too, while anything is unresolved.
  const PULL_DELAYS_MS = [500, 1500, 3000, 6000, 10000];

  async function pullUntilResolved() {
    for (const delay of PULL_DELAYS_MS) {
      if (!posts.some((p) => p.type === "embed")) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const state = await browser.runtime.sendMessage({ type: "getCurrentState" });
        if (state && !state.error) applyPosts(state.posts);
      } catch (e) {
        // Background not answering — try again on the next delay
      }
    }
  }

  // --- Rendering ---
  function renderCurrentPost() {
    const post = posts[currentIndex];
    if (!post) return;

    // Moving off the last post leaves the end-of-queue state behind.
    document.body.classList.remove("at-end");

    // Cleanup previous render
    if (cleanupCurrentRender) {
      cleanupCurrentRender();
      cleanupCurrentRender = null;
    }

    // Get renderer for post type
    const renderer = renderers[post.type];
    const onEnded = autoAdvanceOn ? () => autoAdvanceNext() : null;
    const gated = isGated(post);
    if (gated) {
      // Deliberately before the renderer: nothing must be handed the media URL
      // for a gated post, or the file is fetched and decoded regardless.
      cleanupCurrentRender = renderGate(post, onEnded);
    } else if (renderer) {
      // A resolved video keeps the player it was resolved from, so a file that
      // will not play falls back to that instead of costing the post.
      const onFail =
        post.type === "video" && post.embedUrl
          ? () => renderEmbedFallback(post, onEnded)
          : null;
      cleanupCurrentRender = renderer.render(post, contentContainer, onEnded, onFail);
    } else {
      showMessage(`Unsupported content type: ${post.type}`);
    }

    // A video carries Firefox's own control bar along its bottom edge, which
    // would otherwise sit underneath the console. Only videos pay the
    // clearance; a still keeps the whole frame.
    // Only a video with a native control bar needs the clearance. A gif has
    // controls off, so it keeps the whole frame.
    document.body.classList.toggle(
      "media-video",
      !gated && post.type === "video" && post.isGif !== true
    );
    // An embed is a cross-origin iframe: it eats mousemove, so the idle fade
    // has no way to know the viewer is still there and no way to be undone by
    // pointer. The chrome stays put for these.
    document.body.classList.toggle("media-embed", !gated && post.type === "embed");
    if (!gated && post.type === "embed") resetIdleTimer();

    // Update UI
    updatePostInfo(post);
    updateProgress();
    updateNavButtons();
    updateActionButtons();

    // Preload next image
    preloadNext();

    // Check if we need more posts
    checkPreemptiveFetch();
  }

  // The direct file could not be played even after a retry. The post came from
  // an embeddable host, so hand it to that player rather than showing an error
  // and — with auto-advance on — skipping past it.
  function renderEmbedFallback(post, onEnded) {
    console.warn("[reddit-slideshow] falling back to the embed player for", post.mediaUrl);
    if (cleanupCurrentRender) {
      cleanupCurrentRender();
      cleanupCurrentRender = null;
    }
    cleanupCurrentRender = EmbedRenderer.render(
      { ...post, type: "embed", mediaUrl: post.embedUrl },
      contentContainer,
      onEnded
    );
  }

  // --- Reddit actions ---
  // The buttons show what Reddit says, then move as soon as they are pressed
  // and roll back if Reddit refuses — waiting on a round trip to acknowledge a
  // save makes the slideshow feel broken.

  // State lives in the accessible name as well as the colour. A CSS class and
  // a swapped glyph told a sighted user everything and a screen-reader user
  // nothing — "black star button" either way, pressed or not.
  function updateActionButtons() {
    const post = posts[currentIndex];
    const known = !!(post && post.redditId);

    saveBtn.disabled = !known;
    upvoteBtn.disabled = !known;
    downvoteBtn.disabled = !known;

    const saved = !!(post && post.saved);
    saveBtn.setAttribute("aria-pressed", String(saved));
    saveBtn.querySelector(".glyph").textContent = saved ? "★" : "☆";
    saveBtn.querySelector(".text").textContent = saved ? "Saved" : "Save";
    saveBtn.title = saved ? "Unsave from Reddit (S)" : "Save to Reddit (S)";

    upvoteBtn.setAttribute("aria-pressed", String(!!(post && post.likes === true)));
    downvoteBtn.setAttribute("aria-pressed", String(!!(post && post.likes === false)));

    const url = post ? permalinkUrl(post) : "";
    openBtn.disabled = !url;
  }

  function flagActionFailed(button, message) {
    console.warn("[reddit-slideshow]", message);
    button.classList.add("action-failed");
    setTimeout(() => button.classList.remove("action-failed"), 1500);
  }

  // What this page believes about posts the viewer has acted on, keyed by
  // Reddit fullname.
  //
  // The background broadcasts its own copy of the whole post list every time a
  // redgifs resolution lands, and applyPosts used to install it wholesale.
  // That raced with the optimistic vote/save: a broadcast arriving between the
  // button moving and Reddit answering reverted the change, and — because the
  // post on screen had not otherwise changed — nothing re-rendered to correct
  // it. The vote looked accepted, then quietly wasn't.
  //
  // Both the optimistic write and its rollback go through setPostState, so
  // whatever ends up here is this page's settled view and outranks anything
  // the background sends afterwards.
  const localState = new Map();

  function mergeLocalState(list) {
    if (localState.size === 0) return list;
    return list.map((p) =>
      localState.has(p.redditId) ? { ...p, ...localState.get(p.redditId) } : p
    );
  }

  // Every expanded gallery image is the same Reddit post, so saving one saves
  // them all — they are updated together or the buttons would disagree.
  function setPostState(redditId, changes) {
    localState.set(redditId, { ...(localState.get(redditId) || {}), ...changes });
    posts = posts.map((p) => (p.redditId === redditId ? { ...p, ...changes } : p));
  }

  async function toggleSave() {
    const post = posts[currentIndex];
    if (!post || !post.redditId) return;

    const saved = !post.saved;
    setPostState(post.redditId, { saved });
    updateActionButtons();

    const result = await browser.runtime
      .sendMessage({ type: "savePost", id: post.redditId, saved })
      .catch(() => ({ error: "Could not reach the background script" }));

    if (!result || result.error) {
      setPostState(post.redditId, { saved: !saved });
      updateActionButtons();
      flagActionFailed(saveBtn, (result && result.error) || "Save failed");
    }
  }

  async function vote(dir) {
    const post = posts[currentIndex];
    if (!post || !post.redditId) return;

    const previous = post.likes === undefined ? null : post.likes;
    const wanted = dir === 1 ? true : false;
    // Pressing the same arrow again takes the vote back, as Reddit's own
    // buttons do.
    const next = previous === wanted ? null : wanted;
    const sentDir = next === null ? 0 : next ? 1 : -1;

    setPostState(post.redditId, { likes: next });
    updateActionButtons();

    const result = await browser.runtime
      .sendMessage({ type: "votePost", id: post.redditId, dir: sentDir })
      .catch(() => ({ error: "Could not reach the background script" }));

    if (!result || result.error) {
      setPostState(post.redditId, { likes: previous });
      updateActionButtons();
      flagActionFailed(dir === 1 ? upvoteBtn : downvoteBtn, (result && result.error) || "Vote failed");
    }
  }

  // Reddit fuzzes the displayed score, so this is a rounded number by the time
  // it reaches us — presenting it to more precision than Reddit does would be
  // inventing accuracy.
  function formatScore(score) {
    if (typeof score !== "number" || !score) return "";
    return score >= 1000 ? `${(score / 1000).toFixed(1)}k` : String(score);
  }

  function formatAge(createdUtc) {
    if (typeof createdUtc !== "number" || !createdUtc) return "";
    const hours = (Date.now() / 1000 - createdUtc) / 3600;
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
  }

  function updatePostInfo(post) {
    postTitle.textContent = post.title;
    // Clamped to two lines, so the whole thing is kept on the hover.
    postTitle.title = post.title || "";

    scoreEl.textContent = formatScore(post.score);

    postMeta.textContent = "";
    if (post.flair) {
      const flair = document.createElement("span");
      flair.className = "flair";
      flair.textContent = post.flair;
      postMeta.appendChild(flair);
    }

    const parts = [];
    if (post.subreddit) parts.push(`r/${post.subreddit}`);
    if (post.author) parts.push(`u/${post.author}`);
    if (typeof post.numComments === "number") {
      parts.push(`${post.numComments} ${post.numComments === 1 ? "comment" : "comments"}`);
    }
    const age = formatAge(post.createdUtc);
    if (age) parts.push(age);
    postMeta.appendChild(document.createTextNode(parts.join(" · ")));
  }

  // At most this many ticks, whatever the queue length. Past that each tick
  // stands for a bucket of posts: still an honest position, just a coarser
  // one. A tick per post would be a hairline nobody can read by post 300.
  const TICK_MAX = 48;

  function renderTicks() {
    ticks.textContent = "";
    const total = posts.length;
    if (total < 2) return;

    const count = Math.min(total, TICK_MAX);
    const current = Math.min(count - 1, Math.floor((currentIndex / total) * count));
    for (let i = 0; i < count; i++) {
      const tick = document.createElement("i");
      if (i === current) tick.className = "current";
      else if (i < current) tick.className = "seen";
      ticks.appendChild(tick);
    }
  }

  function updateProgress() {
    const total = posts.length;
    // The denominator grows on every refill, so a percentage genuinely ran
    // backwards (18/20 became 19/43 in one keypress) and read as a completion
    // meter it could never fill. A trailing "+" says the same thing honestly.
    progress.textContent = `${Math.min(currentIndex + 1, total)} / ${total}${exhausted ? "" : "+"}`;

    railNote.textContent = document.body.classList.contains("at-end")
      ? "end of queue"
      : awaitingMore
        ? "waiting for more posts"
        : exhausted
          ? ""
          : "more arriving";

    renderTicks();
  }

  function updateNavButtons() {
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex >= posts.length - 1 && exhausted;
  }

  function preloadNext() {
    const nextPost = posts[currentIndex + 1];
    // A gated post is not preloaded: fetching it in advance would download the
    // very thing the gate exists to withhold.
    if (nextPost && !isGated(nextPost)) {
      const renderer = renderers[nextPost.type];
      if (renderer && renderer.preload) {
        renderer.preload(nextPost);
      }
    }
  }

  // --- Preemptive fetch ---
  async function checkPreemptiveFetch() {
    if (currentIndex >= posts.length - 5 && !exhausted && !fetchInProgress) {
      fetchInProgress = true;
      try {
        const result = await browser.runtime.sendMessage({
          type: "getPosts",
          startIndex: posts.length,
          count: 25,
        });
        if (result && !result.error && result.posts) {
          posts = mergeLocalState(result.posts);
          exhausted = result.exhausted || false;
          updateProgress();
          updateNavButtons();
        }
      } catch (e) {
        // Non-critical — continue with what we have
      } finally {
        fetchInProgress = false;
        // Auto-advance may be parked at the boundary waiting for exactly this.
        resumeIfWaiting();
      }
    }
  }

  // --- Navigation ---
  function goNext() {
    if (currentIndex < posts.length - 1) {
      currentIndex++;
      renderCurrentPost();
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentPost();
    }
  }

  // --- Auto-advance (event-driven) ---
  // Videos/gifs advance when they finish playing.
  // Images advance after a 5s timer.
  // Embeds advance after a 30s timer (can't detect end).
  // Toggling auto-advance re-renders the current post to attach/detach the onEnded callback.

  // Running off the end of the queue used to stop auto-advance for good, in
  // silence: on the last post with more still coming, autoAdvanceNext did
  // nothing at all — it neither advanced, stopped, nor retried — while the
  // button went on claiming "Auto" over a slideshow that had quietly halted.
  let awaitingMore = false;
  let awaitingTimer = null;
  // The refill scrolls the user's real browsing tab, so a single miss means
  // "not yet", not "never".
  const AWAIT_MORE_RETRY_MS = 1500;

  function updateAutoAdvanceButton() {
    const label = !autoAdvanceOn ? "⏱ Off" : awaitingMore ? "⏱ Waiting…" : "⏱ Auto";
    autoAdvanceBtn.textContent = label;
    autoAdvanceBtn.setAttribute("aria-pressed", String(autoAdvanceOn));
    autoAdvanceBtn.title = awaitingMore
      ? "Waiting for more posts to load"
      : autoAdvanceOn
        ? "Auto-advance on — press Space to pause"
        : "Auto-advance off — press Space to start";
  }

  function stopAwaiting() {
    awaitingMore = false;
    clearTimeout(awaitingTimer);
    awaitingTimer = null;
  }

  function waitForMore() {
    clearTimeout(awaitingTimer);
    checkPreemptiveFetch();
    awaitingTimer = setTimeout(() => {
      if (autoAdvanceOn && awaitingMore) waitForMore();
    }, AWAIT_MORE_RETRY_MS);
  }

  // Called by checkPreemptiveFetch once a refill lands, so a hold at the
  // boundary resumes by itself instead of needing a keypress.
  function resumeIfWaiting() {
    if (!awaitingMore) return;
    if (currentIndex < posts.length - 1 || exhausted) {
      stopAwaiting();
      autoAdvanceNext();
    }
  }

  function autoAdvanceNext() {
    if (!autoAdvanceOn) return;

    if (currentIndex < posts.length - 1) {
      stopAwaiting();
      currentIndex++;
      renderCurrentPost();
      return;
    }

    if (exhausted) {
      // The queue really is over. Stop without re-rendering: re-rendering
      // restarts the current post's media, so the end of the slideshow used to
      // announce itself by replaying the final video from the beginning.
      stopAutoAdvance({ rerender: false });
      document.body.classList.add("at-end");
      updateProgress();
      return;
    }

    // More posts are still on their way. Hold here and pick up where we left
    // off rather than stalling for the rest of the session.
    awaitingMore = true;
    updateAutoAdvanceButton();
    waitForMore();
  }

  function startAutoAdvance() {
    autoAdvanceOn = true;
    stopAwaiting();
    document.body.classList.remove("at-end");
    updateAutoAdvanceButton();
    // Re-render current post to attach onEnded callback
    renderCurrentPost();
  }

  function stopAutoAdvance({ rerender = true } = {}) {
    autoAdvanceOn = false;
    stopAwaiting();
    updateAutoAdvanceButton();
    // Re-render to remove onEnded callback (videos will loop again)
    if (rerender) renderCurrentPost();
  }

  function toggleAutoAdvance() {
    if (autoAdvanceOn) {
      stopAutoAdvance();
    } else {
      startAutoAdvance();
    }
  }

  // --- Idle fade ---
  //
  // Hiding the chrome is the whole point, but it was hiding it in ways there
  // was no way back from:
  //
  // - Only mousemove and keydown reset the timer. A cross-origin embed iframe
  //   swallows both, so while any embed post was on screen the controls faded
  //   after two seconds and could not be brought back by pointer at all.
  // - The 2s timer started before the first post had rendered, so the chrome
  //   was often gone before the viewer had seen it once.
  // - body.idle set pointer-events:none on the controls, which made the
  //   invisible console click-through into whatever was underneath — usually
  //   an embedded player's own controls.
  let idleTimer = null;
  const IDLE_TIMEOUT = 2600;
  // Longer the first time: the opening seconds are when a new viewer is
  // working out what the controls are.
  const IDLE_TIMEOUT_FIRST = 6000;
  let idleTimeout = IDLE_TIMEOUT_FIRST;

  function resetIdleTimer() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // An embed owns the pointer, so fading here would be a one-way door.
      if (document.body.classList.contains("media-embed")) return;
      // Nor while the viewer is reading the panel they just opened.
      if (reelOpen()) return;
      document.body.classList.add("idle");
      idleTimeout = IDLE_TIMEOUT;
    }, idleTimeout);
  }

  // pointerdown/wheel/touch as well as mousemove: any of them is the viewer
  // saying they are still here, and some of them arrive when mousemove cannot.
  for (const event of ["mousemove", "pointerdown", "click", "wheel", "touchstart", "keydown"]) {
    document.addEventListener(event, resetIdleTimer, { passive: true });
  }
  // Tabbing to a control must show the control being tabbed to.
  document.addEventListener("focusin", resetIdleTimer);
  window.addEventListener("focus", resetIdleTimer);
  resetIdleTimer();

  // --- Open the post on Reddit ---
  // `permalink` has been scraped on both the new- and old-Reddit paths and
  // carried through the whole pipeline since the beginning, and nothing has
  // ever rendered it: there was no route from the slideshow back to the post
  // or its comments.
  function permalinkUrl(post) {
    const link = (post && post.permalink) || "";
    if (!link) return "";
    if (/^https?:/.test(link)) return link;
    return `https://www.reddit.com${link.startsWith("/") ? "" : "/"}${link}`;
  }

  async function openPost() {
    const url = permalinkUrl(posts[currentIndex]);
    if (!url) return;
    const result = await browser.runtime
      .sendMessage({ type: "openPost", url })
      .catch(() => ({ error: "Could not reach the background script" }));
    if (!result || result.error) {
      flagActionFailed(openBtn, (result && result.error) || "Could not open the post");
    }
  }

  // --- Fullscreen ---
  //
  // The DOM Fullscreen API in both modes rather than browser.windows.update
  // for the pop-out: one code path, and `fullscreenchange` means the button
  // state is read from the browser rather than tracked in parallel with it.
  // That matters because fullscreen can end without this code being involved —
  // Escape is handled by the browser and the keydown does not reach the page.
  //
  // documentElement, not #content-container: fullscreening the stage alone
  // would take the console and the Reel panel off screen with it.
  //
  // In overlay mode this only works because the injected iframe is granted
  // `allow="…; fullscreen"`; a frame cannot enter fullscreen unless every
  // ancestor delegates the permission.
  function isFullscreen() {
    return !!document.fullscreenElement;
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) {
        await document.exitFullscreen();
      } else {
        // Requires transient user activation, so this can only ever be reached
        // from a real keypress or click — never restored on load.
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      // Refused (no activation, or the permission was not delegated). The
      // slideshow is perfectly usable windowed, so say so and carry on.
      flagActionFailed(fullscreenBtn, "Fullscreen was refused by the browser");
    }
  }

  function syncFullscreenButton() {
    // Reads the browser's state, not ours: the native video control bar has
    // its own fullscreen button, and Escape exits without telling us.
    const on = isFullscreen();
    fullscreenBtn.setAttribute("aria-pressed", String(on));
    fullscreenBtn.textContent = on ? "⤢" : "⛶";
    fullscreenBtn.title = on ? "Leave fullscreen (F)" : "Fullscreen (F)";
    document.body.classList.toggle("fullscreen", on);
    // Entering or leaving is a deliberate act; show the chrome so the viewer
    // can see what changed before it fades again.
    resetIdleTimer();
  }

  document.addEventListener("fullscreenchange", syncFullscreenButton);

  // --- Close / Pop-out ---
  async function closeSlideshow() {
    if (mode === "popout") {
      window.close();
    } else {
      await browser.runtime.sendMessage({ type: "closeSlideshow" });
    }
  }

  async function popOut() {
    await browser.runtime.sendMessage({ type: "popOut" });
    // If we're in overlay mode, the overlay will be removed by background
  }

  // --- Event listeners ---
  prevBtn.addEventListener("click", goPrev);
  nextBtn.addEventListener("click", goNext);
  closeBtn.addEventListener("click", closeSlideshow);
  popoutBtn.addEventListener("click", popOut);
  autoAdvanceBtn.addEventListener("click", toggleAutoAdvance);
  saveBtn.addEventListener("click", toggleSave);
  openBtn.addEventListener("click", openPost);
  fullscreenBtn.addEventListener("click", toggleFullscreen);
  upvoteBtn.addEventListener("click", () => vote(1));
  downvoteBtn.addEventListener("click", () => vote(-1));

  // The shortcuts are a bare `switch (e.key)`, which claims far more than it
  // means to. Ctrl+S saved to Reddit *and* opened the browser's Save dialog;
  // Space on a focused button fired the button's own activation as well as
  // toggleAutoAdvance, for a net no-op that read as a dead key; and holding an
  // arrow tore down and rebuilt a media element on every repeat.
  //
  // Only Escape survives these guards, because Escape is how you leave.
  function shouldIgnoreKey(e) {
    // Anything with a modifier belongs to the browser or the OS, not to us.
    if (e.ctrlKey || e.metaKey || e.altKey) return true;
    // Key repeat: one press, one slide.
    if (e.repeat) return true;

    const target = e.target;
    if (!target || typeof target.closest !== "function") return false;
    // A focused control owns Space and the arrows — that is how buttons,
    // sliders and the like are operated. Typing owns everything.
    if (target.closest("input, textarea, select, [contenteditable=\"true\"]")) return true;
    if (target.closest("button, [role=\"button\"], [role=\"switch\"], [role=\"radio\"]")) {
      return e.key === " " || e.key === "Enter" || e.key.startsWith("Arrow");
    }
    return false;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Escape dismisses the panel first. Closing the whole slideshow because
      // the viewer wanted to put a settings panel away would be a rude
      // surprise.
      // Escape unwinds one layer at a time. The browser usually handles the
      // fullscreen exit itself and never delivers this keydown, but when it
      // does reach us, leaving fullscreen must not also end the session.
      if (reelOpen()) Reel.close();
      else if (isFullscreen()) document.exitFullscreen().catch(() => {});
      else closeSlideshow();
      return;
    }
    if (shouldIgnoreKey(e)) return;

    // With the panel up, its own controls own the keyboard.
    if (reelOpen()) {
      if (e.key === "?") Reel.close();
      return;
    }

    switch (e.key) {
      case "ArrowLeft":
        goPrev();
        break;
      case "ArrowRight":
        goNext();
        break;
      case " ":
        e.preventDefault();
        toggleAutoAdvance();
        break;
      case "ArrowUp":
        e.preventDefault();
        vote(1);
        break;
      case "ArrowDown":
        e.preventDefault();
        vote(-1);
        break;
      case "s":
      case "S":
        toggleSave();
        break;
      case "o":
      case "O":
        openPost();
        break;
      case "r":
      case "R":
        revealCurrent();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "?":
        Reel.toggle();
        break;
    }
  });

  // The global mask switch lives in the Reel panel and the popup, so the
  // change can arrive from outside this module. Re-render so the post on
  // screen obeys it immediately rather than on the next slide.
  if (typeof SlideshowSettings !== "undefined") {
    SlideshowSettings.onChange((key) => {
      if (key === "maskNsfw") renderCurrentPost();
    });
  }

  // Hide pop-out button in pop-out mode (already popped out)
  if (mode === "popout") {
    popoutBtn.style.display = "none";
  }

  // --- Initialize ---
  // In overlay mode this page is an iframe injected into reddit.com, and
  // nothing focused it. Keyboard navigation was dead until the viewer clicked
  // inside, and the first arrow or Escape went to the Reddit page behind —
  // where the content script's own Escape listener closed the session outright.
  function claimFocus() {
    try {
      window.focus();
      document.body.focus({ preventScroll: true });
    } catch (e) {
      // Focus can be refused; the click-to-focus path still works.
    }
  }

  updateAutoAdvanceButton();
  syncFullscreenButton();
  if (typeof Reel !== "undefined") Reel.init({ opener: reelBtn });
  claimFocus();
  init();
})();
