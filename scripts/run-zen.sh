#!/usr/bin/env bash
# Run the extension in Zen instead of Firefox.
#
# Zen is a Firefox fork, so web-ext can drive it as long as it is pointed at
# the binary inside the app bundle. It runs against a real Zen profile — the
# Reddit login and everyday setup are already there — resolved by name out of
# Zen's profiles.ini, since web-ext's own name lookup only knows Firefox's
# profile directory.
set -euo pipefail

ZEN_BIN="${ZEN_BIN:-/Applications/Zen.app/Contents/MacOS/zen}"
ZEN_PROFILE_NAME="${ZEN_PROFILE_NAME:-Zevs}"
ZEN_PROFILES_DIR="${ZEN_PROFILES_DIR:-$HOME/Library/Application Support/zen}"

if [ ! -x "$ZEN_BIN" ]; then
  echo "Zen binary not found at: $ZEN_BIN" >&2
  echo "Set ZEN_BIN to the executable inside the app bundle, e.g." >&2
  echo "  ZEN_BIN=/path/to/Zen.app/Contents/MacOS/zen npm run start:zen" >&2
  exit 1
fi

INI="$ZEN_PROFILES_DIR/profiles.ini"
if [ ! -f "$INI" ]; then
  echo "Zen profiles.ini not found at: $INI" >&2
  echo "Set ZEN_PROFILES_DIR to the directory that holds it." >&2
  exit 1
fi

# Paths in profiles.ini are relative to the profiles dir unless IsRelative=0.
ZEN_PROFILE="${ZEN_PROFILE:-$(
  awk -v want="$ZEN_PROFILE_NAME" -v root="$ZEN_PROFILES_DIR" '
    /^\[/ { name = ""; path = ""; rel = 1; next }
    {
      key = $0; sub(/=.*/, "", key)
      val = $0; sub(/^[^=]*=/, "", val)
      if (key == "Name") name = val
      else if (key == "Path") path = val
      else if (key == "IsRelative") rel = val
      if (name == want && path != "") {
        print (rel == 0 ? path : root "/" path)
        exit
      }
    }
  ' "$INI"
)}"

if [ -z "$ZEN_PROFILE" ] || [ ! -d "$ZEN_PROFILE" ]; then
  echo "No Zen profile named '$ZEN_PROFILE_NAME' in $INI. Available:" >&2
  awk -F= '$1 == "Name" { print "  " $2 }' "$INI" >&2
  echo "Pick one with: ZEN_PROFILE_NAME='Default Profile' npm run start:zen" >&2
  exit 1
fi

# Firefox locks a profile to one instance, so a running Zen on this profile
# makes the launch fail with nothing useful in the output.
if pgrep -f "MacOS/zen" | xargs -I{} ps -o args= -p {} 2>/dev/null | grep -qF -- "$ZEN_PROFILE"; then
  echo "Zen is already running on the '$ZEN_PROFILE_NAME' profile." >&2
  echo "Quit Zen first — a profile can only be open in one instance." >&2
  exit 1
fi

echo "Zen profile: $ZEN_PROFILE_NAME ($ZEN_PROFILE)"

# Opt-in WebDriver BiDi. Bound to localhost by Firefox, and only while the
# browser is running, but it does give anything on this machine control of a
# logged-in browser — hence off unless asked for.
DEBUG_ARGS=()
if [ -n "${ZEN_DEBUG_PORT:-}" ]; then
  echo "Remote agent (WebDriver BiDi) on 127.0.0.1:$ZEN_DEBUG_PORT"
  # Equals form on purpose: `--args --remote-…` makes web-ext's parser treat
  # the value as another one of its own flags.
  DEBUG_ARGS=("--args=--remote-debugging-port=$ZEN_DEBUG_PORT")
fi

# --keep-profile-changes runs against the profile in place instead of copying
# it, which is the point here: the existing Reddit login is what makes the
# slideshow worth testing. web-ext does write dev prefs into it.
# "${DEBUG_ARGS[@]+...}" rather than "${DEBUG_ARGS[@]}": macOS ships bash 3.2,
# where expanding an empty array under `set -u` is an "unbound variable" error
# rather than nothing at all. That fired on every run without ZEN_DEBUG_PORT —
# which is the normal way to use this. Fixed in bash 4.4, so it never showed up
# anywhere with a newer bash on PATH.
exec npx web-ext run \
  --source-dir . \
  --firefox "$ZEN_BIN" \
  --firefox-profile "$ZEN_PROFILE" \
  --keep-profile-changes \
  ${DEBUG_ARGS[@]+"${DEBUG_ARGS[@]}"} \
  "$@"
