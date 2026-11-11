#!/bin/sh
# Opens the browser that does the applying: Chrome, in a profile of its own.
#
# A dedicated profile is the point: applications open in background tabs here instead of
# landing in the middle of whatever you were doing in your own windows.
#
# This used to hand Chrome the extension on the command line (--load-extension). Chrome
# removed that switch from its ordinary builds in 2025, and silently: the browser still opened,
# just without the extension, and the site then said "not connected" with nothing to explain
# it. The extension is now loaded once, by hand, into this profile — Chrome keeps it after that.
#
# Double-click this file. Sign in once; the browser remembers you.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PROFILE="$HOME/.qaddim-browser"
SITE="https://sultanhad.github.io/qaddim/"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -x "$CHROME" ] || { echo "لم أجد Google Chrome في /Applications."; read -r _; exit 1; }
[ -d "$HERE/extension" ] || { echo "لم أجد مجلد extension بجانب هذا الملف."; read -r _; exit 1; }

mkdir -p "$PROFILE"

# A profile can only be opened once at a time; a leftover lock stops the next launch.
pkill -f "user-data-dir=$PROFILE" 2>/dev/null || true
rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie" 2>/dev/null || true

open_chrome() {
  "$CHROME" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check "$@" >/dev/null 2>&1 &
}

if [ -f "$PROFILE/.extension-loaded" ]; then
  echo "يفتح متصفّح التقديم…"
  open_chrome "$SITE"
  echo "✓ فُتح. اتركه مفتوحاً؛ الطابور يُفرَّغ وحده."
  exit 0
fi

open_chrome "chrome://extensions" "$SITE"
cat <<STEPS

أول مرة فقط — حمّل الإضافة في النافذة التي فُتحت:

  ١. في تبويب chrome://extensions فعّل  Developer mode  (أعلى اليمين)
  ٢. اضغط  Load unpacked  واختر هذا المجلد:
       $HERE/extension
  ٣. انتقل لتبويب قدّم، سجّل دخولك، وفعّل «قدّم عني تلقائياً» من الضبط

STEPS
printf 'بعد ما تظهر «الإضافة متصلة» في صفحة الوظائف، اضغط Enter هنا… '
read -r _
touch "$PROFILE/.extension-loaded"
echo "✓ تمام. من الآن الضغطة المزدوجة تفتحه جاهزاً."
