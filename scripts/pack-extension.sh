#!/bin/sh
# Packs the extension into the site, so the install page can hand it to anyone.
#
# The instructions said "choose the extension folder" — a folder only this repository has.
# Until the extension is in the Chrome Web Store, the site itself is the only place a person
# who signed up can get it from, so every build carries the current copy.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/apps/web/public/qaddim-extension.zip"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -R "$root/extension" "$tmp/qaddim-extension"
rm -rf "$tmp/qaddim-extension/tests"
find "$tmp" -name .DS_Store -delete
rm -f "$out"
(cd "$tmp" && zip -qrX "$out" qaddim-extension)
echo "✓ qaddim-extension.zip ($(du -h "$out" | cut -f1 | tr -d ' '))"
