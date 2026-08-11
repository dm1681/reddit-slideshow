#!/usr/bin/env node
// Bump the extension version in manifest.json and package.json together.
//
// manifest.json is the source of truth — it is the only one Firefox and AMO
// read. package.json is kept in sync so `npm` and the repo agree, since a
// drifting pair makes it ambiguous which version a release actually shipped.
//
// Usage: node scripts/bump-version.js <patch|minor|major|X.Y.Z>

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const manifestPath = path.join(ROOT, "manifest.json");
const packagePath = path.join(ROOT, "package.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const current = manifest.version;

const arg = process.argv[2];
if (!arg) {
  console.error(`Current version: ${current}`);
  console.error("Usage: node scripts/bump-version.js <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else {
  const parts = current.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    console.error(`Cannot bump non-semver current version "${current}" — pass an explicit X.Y.Z.`);
    process.exit(1);
  }
  const [major, minor, patch] = parts;
  const bumps = {
    major: [major + 1, 0, 0],
    minor: [major, minor + 1, 0],
    patch: [major, minor, patch + 1],
  };
  if (!bumps[arg]) {
    console.error(`Unknown bump "${arg}" — expected patch, minor, major, or X.Y.Z.`);
    process.exit(1);
  }
  next = bumps[arg].join(".");
}

// AMO refuses to sign a version it has already signed, so moving backwards
// or standing still guarantees a failed release rather than a silent no-op.
const cmp = next.localeCompare(current, undefined, { numeric: true });
if (cmp <= 0) {
  console.error(`Refusing to set version ${next} — not greater than current ${current}.`);
  console.error("AMO rejects re-signing a version number it has already issued.");
  process.exit(1);
}

for (const [file, filePath] of [
  ["manifest.json", manifestPath],
  ["package.json", packagePath],
]) {
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  json.version = next;
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
  console.log(`  ${file}: ${current} -> ${next}`);
}

console.log(`\nVersion bumped to ${next}. Next:`);
console.log(`  git commit -am "chore: release v${next}"`);
console.log(`  git tag v${next} && git push --follow-tags`);
