// Reddit Slideshow — persisted playback settings
//
// localStorage, not browser.storage. The manifest has no `storage` permission
// and adding one is a permission change on a listed AMO add-on, which costs a
// review and a scary prompt for every existing user. The popup and the
// slideshow both run on moz-extension://<id>, so they share this origin and
// see the same values — video.js already persists the audio preference this
// way.
//
// Everything here is a preference the viewer set deliberately, so it is meant
// to outlive the session.

const SlideshowSettings = (function () {
  const KEY = "reddit-slideshow.settings";

  // Timings the code used to hardcode: 5s in image.js, 15s in embed.js behind
  // a comment claiming 30s. Neither was reachable from any UI.
  const DEFAULTS = {
    imageDwellMs: 5000,
    embedDwellMs: 15000,
    // Blur adult and spoiler-tagged posts until the viewer asks to see them.
    // On by default because the slideshow removes the click-through Reddit
    // itself puts in front of this content.
    maskNsfw: true,
  };

  const NUMERIC_RANGE = { imageDwellMs: [1000, 60000], embedDwellMs: [3000, 120000] };

  function coerce(key, value) {
    const fallback = DEFAULTS[key];
    if (typeof fallback === "boolean") return value === true;
    if (typeof fallback === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
      const [min, max] = NUMERIC_RANGE[key] || [-Infinity, Infinity];
      return Math.min(max, Math.max(min, value));
    }
    return fallback;
  }

  function load() {
    const values = { ...DEFAULTS };
    try {
      const stored = JSON.parse(localStorage.getItem(KEY));
      if (stored && typeof stored === "object") {
        for (const key of Object.keys(DEFAULTS)) {
          if (key in stored) values[key] = coerce(key, stored[key]);
        }
      }
    } catch (e) {
      // No storage, or a value written by an older build that no longer
      // parses. Defaults are always safe — in particular maskNsfw stays on.
    }
    return values;
  }

  const values = load();
  const listeners = new Set();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(values));
    } catch (e) {
      // Storage unavailable (private window, quota). The choice still holds
      // for this session, it just will not be remembered.
    }
  }

  return {
    get(key) {
      return values[key];
    },

    all() {
      return { ...values };
    },

    set(key, value) {
      if (!(key in DEFAULTS)) return;
      const next = coerce(key, value);
      if (values[key] === next) return;
      values[key] = next;
      persist();
      listeners.forEach((fn) => {
        try {
          fn(key, next);
        } catch (e) {
          // A misbehaving listener must not stop the others being told.
        }
      });
    },

    // Called with (key, value) whenever a setting changes, so the console and
    // the Reel panel stay in step without polling.
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    DEFAULTS,
  };
})();

// The renderers are loaded standalone by test/test-auto-advance.js, without
// this file. They fall back to their own constants when the global is absent,
// so this must stay an optional dependency rather than a required one.
if (typeof window !== "undefined") window.SlideshowSettings = SlideshowSettings;
