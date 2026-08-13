// Shared test helper: build a slideshow page from the REAL markup.
//
// Two suites drive slideshow.js against a DOM, and both used to keep their own
// hand-copied snapshot of slideshow.html. Those snapshots rot the moment the
// markup changes — silently, because a missing element only shows up as a
// TypeError deep inside an assertion about something else. The controller's DOM
// contract is slideshow.html, so that is what the tests read.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Everything inside <body>, minus the <script> tags: the suites inject the
// scripts themselves, in their own order, after stubbing the WebExtension
// globals the controller expects to find on load.
function slideshowBody() {
  const html = fs.readFileSync(path.join(ROOT, "slideshow", "slideshow.html"), "utf8");
  const start = html.indexOf(">", html.indexOf("<body")) + 1;
  const body = html.slice(start, html.lastIndexOf("</body>"));
  return body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
}

// A complete page around that body. `css` inlines the real stylesheet; without
// it the only styling is `extraStyle`, which is what suites that just need the
// elements to exist should use.
function slideshowPage({ css = "", extraStyle = "", title = "slideshow harness" } = {}) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>${css}${extraStyle}</style>
</head><body style="margin:0">
${slideshowBody()}
</body></html>`;
}

module.exports = { slideshowBody, slideshowPage };
