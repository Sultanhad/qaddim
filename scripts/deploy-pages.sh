#!/bin/sh
# Rebuilds the site and publishes it to the gh-pages branch, which GitHub Pages serves.
#
#   sh scripts/deploy-pages.sh
#
# The build reads .env.local for the publishable Supabase key; the service key is never
# part of a browser bundle, so nothing secret leaves this machine.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$root/apps/web" && npx vite build

work=$(mktemp -d)
cp -R "$root/apps/web/dist/." "$work/"
cd "$work"
touch .nojekyll                      # or Pages would hide the assets/ directory
git init -q -b gh-pages
git add -A
git commit -q -m "نشر الموقع المبني"
git push -q -f "$(git -C "$root" remote get-url origin)" gh-pages
rm -rf "$work"

echo "✓ https://sultanhad.github.io/qaddim/"
