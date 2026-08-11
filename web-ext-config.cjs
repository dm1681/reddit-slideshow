// web-ext configuration — controls what ships inside the signed XPI.
//
// Everything not needed at runtime is excluded. The XPI is what Mozilla
// reviews and what installs on every machine, so keeping it to just the
// extension source keeps signing fast and the review surface small.
module.exports = {
  ignoreFiles: [
    "node_modules",
    "test",
    "docs",
    "scripts",
    ".github",
    ".superpowers",
    ".playwright-mcp",
    // Local tool output. Its graph.html carries inline and remote scripts that
    // trip AMO's validator, and none of it belongs in a shipped add-on.
    "graphify-out",
    "web-ext-artifacts",
    "package.json",
    "package-lock.json",
    "web-ext-config.cjs",
    "amo-metadata.json",
    "updates.json",
    "CLAUDE.md",
    "README.md",
    "*.md",
    ".env",
  ],
  build: {
    overwriteDest: true,
  },
  run: {
    // Reuse a dedicated profile so logins and prefs survive between runs.
    keepProfileChanges: true,
    firefoxProfile: "reddit-slideshow-dev",
    profileCreateIfMissing: true,
    startUrl: ["https://www.reddit.com/r/aww/"],
  },
};
