#!/bin/sh
# Opens a browser that already has the applying extension in it.
#
# Chrome will not let anything install an unpacked extension into a running profile, and
# tampering with its preference files is both fragile and the sort of thing malware does.
# A dedicated profile is better anyway: applications open in background tabs here instead of
# landing in the middle of whatever you were doing.
#
# Double-click this file. Sign in once; the browser remembers you after that.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PROFILE="$HOME/.qaddim-browser"
SITE="https://qaddim.netlify.app"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -x "$CHROME" ] || { echo "لم أجد Google Chrome في /Applications."; read -r _; exit 1; }
[ -d "$HERE/extension" ] || { echo "لم أجد مجلد extension بجانب هذا الملف."; read -r _; exit 1; }

mkdir -p "$PROFILE"

# A profile can only be opened once at a time; a leftover lock stops the next launch.
pkill -f "user-data-dir=$PROFILE" 2>/dev/null || true
rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie" 2>/dev/null || true

echo "يفتح متصفّح التقديم…"
"$CHROME" \
  --user-data-dir="$PROFILE" \
  --load-extension="$HERE/extension" \
  --disable-extensions-except="$HERE/extension" \
  --no-first-run \
  --no-default-browser-check \
  "$SITE" >/dev/null 2>&1 &

echo "✓ فُتح. سجّل دخولك مرة واحدة، وفعّل «قدّم عني تلقائياً» من الضبط."
