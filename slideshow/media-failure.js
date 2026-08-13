// Reddit Slideshow — the card shown when media will not load.
//
// "Failed to load image" told the viewer nothing they could not already see,
// and left them with nowhere to go. Most of these failures have a specific,
// knowable cause — an expired preview signature, a deleted file, a codec
// Firefox will not touch — and all of them have a recovery: the post itself.
//
// Shared by the renderers rather than each hand-rolling a grey div. Actions
// are raised as DOM events so the renderers keep their existing signature and
// stay loadable standalone by the tests.

const MediaFailure = (function () {
  // Only hosts the manifest grants access to can be probed. Anything else
  // fails CORS, which is indistinguishable from being offline — and reporting
  // "check your connection" to someone whose connection is fine is worse than
  // saying less.
  const PROBEABLE = /(^|\.)(redd\.it|reddit\.com|imgur\.com|redgifs\.com|gfycat\.com|streamable\.com)$/i;
  const PROBE_TIMEOUT_MS = 4000;

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  // Reddit signs preview URLs and they stop working after a while, so this is
  // the failure a long session hits most: the image was fine when the queue
  // was built and is not fine now.
  function isExpiringPreview(host) {
    return /(^|\.)(preview|external-preview)\.redd\.it$/i.test(host);
  }

  // What can be said from the URL alone, before anything is asked of the
  // network. Rendered immediately; refine() sharpens it if a probe answers.
  function describe(url, kind) {
    const host = hostOf(url);
    const noun = kind === "video" ? "video" : "image";

    if (!host) {
      return { heading: `This post has no usable ${noun} link.`, detail: "" };
    }
    if (isExpiringPreview(host)) {
      return {
        heading: "This preview link has expired.",
        detail:
          "Reddit signs preview URLs and they stop working after a while. The post itself still has the full-size version.",
      };
    }
    if (/(^|\.)i\.redd\.it$/i.test(host)) {
      return {
        heading: `Reddit could not serve this ${noun}.`,
        detail: "It may have been deleted, or the post may have been removed.",
      };
    }
    if (/(^|\.)imgur\.com$/i.test(host)) {
      return {
        heading: `Imgur could not serve this ${noun}.`,
        detail: "Imgur removes hosted files fairly often, especially older ones.",
      };
    }
    return {
      heading: `${host} could not serve this ${noun}.`,
      detail: "The host it is stored on did not return the file.",
    };
  }

  // A status code turns a guess into a fact.
  function describeStatus(status, url, kind) {
    const host = hostOf(url);
    const noun = kind === "video" ? "video" : "image";

    if (status === 403) {
      return isExpiringPreview(host)
        ? {
            heading: "This preview link has expired.",
            detail: `${host} refused it (403). Reddit signs preview URLs and they stop working after a while — the post still has the full-size version.`,
          }
        : {
            heading: `${host} refused the request (403).`,
            detail: "The file may be private, or restricted to signed-in viewers.",
          };
    }
    if (status === 404 || status === 410) {
      return {
        heading: `This ${noun} is gone (${status}).`,
        detail: `${host} no longer has the file. It was probably deleted after the post went up.`,
      };
    }
    if (status === 429) {
      return {
        heading: "Rate-limited.",
        detail: `${host} is asking for fewer requests (429). Slowing down or waiting a moment usually clears it.`,
      };
    }
    if (status >= 500) {
      return {
        heading: `${host} is having trouble (${status}).`,
        detail: "Nothing wrong on this end — the host is failing to serve the file.",
      };
    }
    return null;
  }

  // Firefox reports these on the media element itself, and they say things a
  // status code cannot.
  function describeMediaCode(code, url) {
    const host = hostOf(url);
    if (code === 4) {
      return {
        heading: "Firefox cannot play this video.",
        detail: `The format or codec is not supported${host ? ` (from ${host})` : ""}.`,
      };
    }
    if (code === 3) {
      return {
        heading: "This video is damaged.",
        detail: "The file downloaded but could not be decoded.",
      };
    }
    if (code === 2) {
      return {
        heading: "The download was interrupted.",
        detail: `The connection to ${host || "the host"} dropped part-way through.`,
      };
    }
    return null;
  }

  async function probe(url) {
    const host = hostOf(url);
    if (!host || !PROBEABLE.test(host)) return null;
    try {
      const resp = await fetch(url, {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return { status: resp.status };
    } catch (e) {
      // Reached nothing at all. Distinguishable from a refusal, and worth
      // saying, because the fix is completely different.
      return { offline: true };
    }
  }

  function button(label, hint, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "media-error-action";
    el.textContent = label;
    if (hint) {
      const kbd = document.createElement("span");
      kbd.className = "media-error-key";
      kbd.textContent = hint;
      el.appendChild(kbd);
    }
    el.addEventListener("click", onClick);
    return el;
  }

  // Renders the card and returns a handle. The description is upgraded in
  // place if a probe comes back — the viewer gets something useful at once
  // rather than a spinner while the diagnosis is worked out, and something
  // precise a moment later if it can be had.
  function show(container, options) {
    const { post, url, kind = "image", code = null, willAdvance = false, onRetry = null } = options;

    const card = document.createElement("div");
    card.className = "media-error";

    const tag = document.createElement("span");
    tag.className = "media-error-tag";
    tag.textContent = kind === "video" ? "Video unavailable" : "Image unavailable";
    card.appendChild(tag);

    const headingEl = document.createElement("p");
    headingEl.className = "media-error-heading";
    card.appendChild(headingEl);

    const detailEl = document.createElement("p");
    detailEl.className = "media-error-detail";
    card.appendChild(detailEl);

    function apply(description) {
      if (!description) return;
      headingEl.textContent = description.heading;
      detailEl.textContent = description.detail || "";
    }

    apply(describeMediaCode(code, url) || describe(url, kind));

    const actions = document.createElement("div");
    actions.className = "media-error-actions";
    if (onRetry) actions.appendChild(button("Try again", null, onRetry));
    if (post && post.permalink) {
      actions.appendChild(
        button("Open post", "O", () => {
          // Raised rather than called: the renderers do not know about the
          // background, and should not have to.
          document.dispatchEvent(new CustomEvent("slideshow:openpost", { bubbles: true }));
        })
      );
    }
    if (actions.children.length) card.appendChild(actions);

    if (willAdvance) {
      const note = document.createElement("p");
      note.className = "media-error-note";
      note.textContent = "Moving on shortly.";
      card.appendChild(note);
    }

    // The failing URL, last and quiet. Useless to most people, and the first
    // thing anyone debugging this will want.
    if (url) {
      const src = document.createElement("p");
      src.className = "media-error-url";
      src.textContent = url;
      src.title = url;
      card.appendChild(src);
    }

    container.textContent = "";
    container.appendChild(card);

    let done = false;
    // Only worth asking when the media element could not say why itself.
    if (!code) {
      probe(url).then((result) => {
        if (done || !result) return;
        if (result.offline) {
          apply({
            heading: "Could not reach the server.",
            detail: `Nothing answered at ${hostOf(url) || "the host"}. This is usually a connection problem rather than a missing file.`,
          });
          return;
        }
        // A 2xx here means the file is fine and the element still refused it —
        // so do not overwrite a description with a cheerful non-answer.
        apply(describeStatus(result.status, url, kind));
      });
    }

    return {
      // Called by the renderer's cleanup, so a probe that lands after the
      // slide is gone cannot rewrite a card that no longer exists.
      cancel() {
        done = true;
      },
    };
  }

  return { show, describe, describeStatus, describeMediaCode };
})();

if (typeof window !== "undefined") window.MediaFailure = MediaFailure;
