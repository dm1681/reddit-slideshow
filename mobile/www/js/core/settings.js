// Persisted playback settings. Direct port of the extension's settings.js:
// same coerce/persist/notify shape, same "defaults are always safe — in
// particular maskNsfw stays on" rule for anything that fails to parse.
const KEY = "reel.settings";

const DEFAULTS = {
  autoAdvance: false,
  imageDwellMs: 5000,
  // On by default: the feed removes the click-through Reddit itself puts in
  // front of adult and spoiler posts.
  maskNsfw: true,
};

const NUMERIC_RANGE = { imageDwellMs: [1000, 60000] };

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
    // No storage, or an unparseable older value — defaults are safe.
  }
  return values;
}

const values = load();
const listeners = new Set();

function notify(key, value) {
  listeners.forEach((fn) => {
    try {
      fn(key, value);
    } catch (e) {
      // A misbehaving listener must not stop the others being told.
    }
  });
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(values));
  } catch (e) {
    // Storage unavailable — the choice still holds for this session.
  }
}

export const Settings = {
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
    notify(key, next);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  DEFAULTS,
};

// The audio preference lives outside any one <video> (each slide mounts a
// fresh element) and outside Settings: exactly the extension's split, where a
// mute we imposed for autoplay is never written back as the user's choice.
const AUDIO_KEY = "reel.audio";

export const audioPref = (function loadAudioPref() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUDIO_KEY));
    if (stored) {
      return {
        muted: stored.muted === true,
        volume: typeof stored.volume === "number" ? Math.min(1, Math.max(0, stored.volume)) : 1,
      };
    }
  } catch (e) {
    // Sound on is the sane default
  }
  return { muted: false, volume: 1 };
})();

export function saveAudioPref() {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(audioPref));
  } catch (e) {
    // Storage unavailable — holds for this session only
  }
}
