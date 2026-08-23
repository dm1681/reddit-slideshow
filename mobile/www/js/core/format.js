// Display formatting. Ported from slideshow.js.

// Reddit fuzzes the displayed score, so presenting it to more precision than
// Reddit does would be inventing accuracy.
export function formatScore(score) {
  if (typeof score !== "number" || !score) return "";
  return score >= 1000 ? `${(score / 1000).toFixed(1)}k` : String(score);
}

export function formatCount(n) {
  if (typeof n !== "number" || n < 0) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatAge(createdUtc) {
  if (typeof createdUtc !== "number" || !createdUtc) return "";
  const hours = (Date.now() / 1000 - createdUtc) / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}
