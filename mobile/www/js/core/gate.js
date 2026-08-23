// The adult/spoiler gate. Ported semantics, verbatim rules:
// - gating works by WITHHOLDING mediaUrl from the renderer, never by blur —
//   a blur means the file has already been downloaded and decoded;
// - a gated post is never preloaded or mounted as an off-screen neighbour;
// - revealing is per post and lasts the session; the global mask switch is a
//   Setting and is remembered between sessions.
import { Settings } from "./settings.js";

const revealed = new Set();

export function gateReason(post) {
  if (!post) return null;
  if (post.nsfw) return "Adult";
  if (post.spoiler) return "Spoiler";
  return null;
}

export function isGated(post) {
  return !!post && !!gateReason(post) && Settings.get("maskNsfw") && !revealed.has(post.id);
}

export function reveal(post) {
  if (post) revealed.add(post.id);
}

// Short, so auto-advance does not stall on a wall of gate cards — but not
// instant, or the viewer never sees what was skipped.
export const GATE_DWELL_MS = 2500;
