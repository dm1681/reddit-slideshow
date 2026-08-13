// Reddit Slideshow — the Reel: keyboard legend and playback settings.
//
// The shortcuts used to exist only as title attributes on glyph buttons, so
// they were discoverable by hovering one control at a time and no other way,
// and the dwell times were hardcoded constants no UI could reach at all.
//
// Exposed as a global rather than wired directly into slideshow.js so the
// controller can stay the thing that owns the slideshow, and this can stay the
// thing that owns a panel.

const Reel = (function () {
  const KEYS = [
    [["←", "→"], "Previous / next post"],
    [["Space"], "Auto-advance on / off"],
    [["↑", "↓"], "Upvote / downvote"],
    [["S"], "Save or unsave"],
    [["O"], "Open the post on Reddit"],
    [["R"], "Reveal a hidden post"],
    [["?"], "This panel"],
    [["Esc"], "Close the slideshow"],
  ];

  // Offered rather than free-typed: a spinner invites 0.2s, and every value
  // here is one somebody would actually pick.
  const DWELL_CHOICES = {
    imageDwellMs: [2000, 3000, 5000, 8000, 15000],
    embedDwellMs: [10000, 15000, 30000, 60000],
  };

  const root = document.getElementById("reel");
  const panel = document.getElementById("reel-panel");
  const closeBtn = document.getElementById("reel-close");
  const keyList = document.getElementById("reel-keys");
  const maskToggle = document.getElementById("mask-toggle");
  const openers = [];

  let lastFocused = null;

  function seconds(ms) {
    return ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`;
  }

  function buildKeys() {
    for (const [keys, description] of KEYS) {
      const dt = document.createElement("dt");
      keys.forEach((key) => {
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        dt.appendChild(kbd);
      });
      const dd = document.createElement("dd");
      dd.textContent = description;
      keyList.append(dt, dd);
    }
  }

  function buildChips() {
    for (const group of root.querySelectorAll(".chips")) {
      const setting = group.dataset.setting;
      for (const value of DWELL_CHOICES[setting] || []) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.setAttribute("role", "radio");
        chip.dataset.value = String(value);
        chip.textContent = seconds(value);
        chip.addEventListener("click", () => SlideshowSettings.set(setting, value));
        group.appendChild(chip);
      }
    }
  }

  // One function for the whole panel, run on open and on every settings
  // change, so the controls can never drift from what is stored.
  function syncFromSettings() {
    for (const group of root.querySelectorAll(".chips")) {
      const current = SlideshowSettings.get(group.dataset.setting);
      for (const chip of group.children) {
        const on = Number(chip.dataset.value) === current;
        chip.setAttribute("aria-checked", String(on));
        // Only the selected chip is a tab stop; arrow keys move within the
        // group, which is how a radiogroup is meant to behave.
        chip.tabIndex = on ? 0 : -1;
      }
    }
    maskToggle.setAttribute("aria-checked", String(SlideshowSettings.get("maskNsfw")));
  }

  function chipArrowNav(e) {
    if (!e.key.startsWith("Arrow")) return;
    const group = e.target.closest(".chips");
    if (!group) return;
    const chips = [...group.children];
    const index = chips.indexOf(e.target);
    if (index < 0) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = chips[(index + step + chips.length) % chips.length];
    e.preventDefault();
    e.stopPropagation();
    next.focus();
    next.click();
  }

  function isOpen() {
    return !root.hidden;
  }

  function open() {
    if (isOpen()) return;
    lastFocused = document.activeElement;
    syncFromSettings();
    root.hidden = false;
    openers.forEach((btn) => btn.setAttribute("aria-expanded", "true"));
    closeBtn.focus();
  }

  function close() {
    if (!isOpen()) return;
    root.hidden = true;
    openers.forEach((btn) => btn.setAttribute("aria-expanded", "false"));
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  // A modal that lets Tab escape is not modal. The panel is small enough that
  // a plain wrap is honest and cheap.
  function trapTab(e) {
    if (e.key !== "Tab") return;
    const focusable = [...panel.querySelectorAll("button:not([disabled])")].filter(
      (el) => el.tabIndex >= 0
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function init(options) {
    buildKeys();
    buildChips();
    syncFromSettings();
    SlideshowSettings.onChange(syncFromSettings);

    maskToggle.addEventListener("click", () => {
      SlideshowSettings.set("maskNsfw", !SlideshowSettings.get("maskNsfw"));
    });

    closeBtn.addEventListener("click", close);
    // Clicking the backdrop, but not the panel itself.
    root.addEventListener("click", (e) => {
      if (e.target === root) close();
    });
    panel.addEventListener("keydown", (e) => {
      chipArrowNav(e);
      trapTab(e);
    });

    if (options && options.opener) {
      openers.push(options.opener);
      options.opener.addEventListener("click", toggle);
    }
  }

  return { init, open, close, toggle, isOpen };
})();

if (typeof window !== "undefined") window.Reel = Reel;
