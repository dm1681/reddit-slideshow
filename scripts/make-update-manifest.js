#!/usr/bin/env node
// Generate updates.json — the manifest Firefox polls to discover new versions
// of a self-hosted (unlisted) add-on.
//
// Firefox fetches this URL anonymously, roughly once a day, and compares the
// listed version against the installed one. It must be reachable with no
// authentication, which is why it cannot live in a private repo.
//
// Usage: node scripts/make-update-manifest.js <base-url>
//   base-url  Where the signed XPI files are served from, no trailing slash.
//             e.g. https://github.com/dm1681/reddit-slideshow-releases/releases/download

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const addonId = manifest.browser_specific_settings?.gecko?.id;
const version = manifest.version;
const minVersion = manifest.browser_specific_settings?.gecko?.strict_min_version;

if (!addonId) {
  console.error("manifest.json has no browser_specific_settings.gecko.id — cannot self-host updates.");
  process.exit(1);
}

const baseUrl = (process.argv[2] || "").replace(/\/+$/, "");
if (!baseUrl) {
  console.error("Usage: node scripts/make-update-manifest.js <base-url>");
  console.error("  e.g. node scripts/make-update-manifest.js https://github.com/you/repo/releases/download");
  process.exit(1);
}

// The release job renames whatever web-ext produced to this fixed pattern, so
// the download URL is predictable rather than dependent on web-ext internals.
const artifact = `reddit-slideshow-${version}.xpi`;

// A single entry is enough. Firefox only asks "is there a version newer than
// the one installed?", so any machine on any older version updates straight to
// this one. Listing historical versions would only matter for pinning old
// Firefox builds to old add-on versions.
const entry = {
  version,
  update_link: `${baseUrl}/v${version}/${artifact}`,
  ...(minVersion && {
    applications: { gecko: { strict_min_version: minVersion } },
  }),
};

const outPath = path.join(ROOT, "updates.json");
fs.writeFileSync(
  outPath,
  JSON.stringify({ addons: { [addonId]: { updates: [entry] } } }, null, 2) + "\n"
);

console.log(`Wrote updates.json — ${addonId} @ ${version}`);
console.log(`  update_link: ${entry.update_link}`);
