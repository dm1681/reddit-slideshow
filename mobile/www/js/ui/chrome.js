// Global chrome: tick strip, counter, top bar, settings sheet, toasts.
// The counter keeps the extension's honesty rule: the denominator grows on
// refill, so it reads "n / total+" with the + present until exhausted.
import { Settings } from "../core/settings.js";

// At most this many ticks; past that each tick stands for a bucket of posts.
const TICK_MAX = 48;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createChrome({ sourceLabel, isDemo }) {
  const ticks = document.getElementById("ticks");
  const counter = document.getElementById("counter");
  const sourceEl = document.getElementById("source-label");
  const gear = document.getElementById("gear");
  const dim = document.getElementById("dim");
  const sheet = document.getElementById("sheet");
  const toastEl = document.getElementById("toast");

  sourceEl.textContent = sourceLabel;
  if (isDemo) {
    const badge = el("span", "demo", "DEMO");
    sourceEl.after(badge);
  }

  let state = { index: 0, total: 0, exhausted: false, atEnd: false };

  function renderTicks() {
    ticks.textContent = "";
    const total = state.total;
    if (total < 2) return;
    const count = Math.min(total, TICK_MAX);
    const current = Math.min(count - 1, Math.floor((state.index / total) * count));
    for (let i = 0; i < count; i++) {
      const tick = document.createElement("i");
      if (i === current && !state.atEnd) tick.className = "current";
      else if (i < current || state.atEnd) tick.className = "seen";
      ticks.appendChild(tick);
    }
  }

  function update(next) {
    state = { atEnd: false, ...state, ...next };
    if (next.atEnd === undefined) state.atEnd = false;
    const shown = Math.min(state.index + 1, state.total);
    counter.textContent = state.atEnd
      ? `${state.total} / ${state.total}`
      : `${shown} / ${state.total}${state.exhausted ? "" : "+"}`;
    renderTicks();
  }

  // ---- settings sheet ----
  const autoToggle = document.getElementById("set-auto");
  const dwellRange = document.getElementById("set-dwell");
  const dwellValue = document.getElementById("set-dwell-value");
  const maskToggle = document.getElementById("set-mask");

  function syncSheet() {
    autoToggle.classList.toggle("on", Settings.get("autoAdvance"));
    autoToggle.setAttribute("aria-pressed", String(Settings.get("autoAdvance")));
    maskToggle.classList.toggle("on", Settings.get("maskNsfw"));
    maskToggle.setAttribute("aria-pressed", String(Settings.get("maskNsfw")));
    dwellRange.value = String(Settings.get("imageDwellMs"));
    dwellValue.textContent = `${Math.round(Settings.get("imageDwellMs") / 1000)}s`;
  }

  autoToggle.addEventListener("click", () =>
    Settings.set("autoAdvance", !Settings.get("autoAdvance")));
  maskToggle.addEventListener("click", () =>
    Settings.set("maskNsfw", !Settings.get("maskNsfw")));
  dwellRange.addEventListener("input", () => {
    Settings.set("imageDwellMs", Number(dwellRange.value));
  });
  Settings.onChange(syncSheet);
  syncSheet();

  function openSheet() {
    dim.hidden = false;
    sheet.hidden = false;
  }
  function closeSheet() {
    dim.hidden = true;
    sheet.hidden = true;
  }
  gear.addEventListener("click", openSheet);
  dim.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) closeSheet();
  });

  // ---- toast: the real error string, visibly, instead of a console.warn ----
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
      toastTimer = setTimeout(() => {
        toastEl.hidden = true;
      }, 300);
    }, 2600);
  }

  return {
    update,
    toast,
    openSheet,
    closeSheet,
    setAutoState() {
      // rail buttons carry the visible auto state; the sheet just mirrors
      syncSheet();
    },
  };
}
