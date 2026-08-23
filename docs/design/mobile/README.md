# Mobile (Reel) — viz-driven-dev artifacts

Hypothesis-first artifacts for the TikTok-style mobile client build
(`mobile/`). Follows the parent design convention: `mockups/` are standalone
HTML, `screens/` are rendered from them.

- `mockups/reel.html` — the hypothesis mockup. Scenes via `?scene=feed|swipe|gate|settings`.
- `screens/expected-*.png`, `screens/expected-swipe.mp4` — what the app is
  *expected* to look and move like, rendered from the mockup **before any app
  code existed** (`mobile/tools/shoot-mockups.mjs`, 390×844@2x).
- `screens/real-*.png`, `screens/real-swipe.mp4` — the same scenes regenerated
  from the running app (`mobile/tools/shoot-real.mjs`), to confirm or refute
  the hypothesis.
- `screens/compare-*.png` — expected vs real, side by side.
