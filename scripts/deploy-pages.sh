#!/bin/sh
# Rebuilds the site and publishes it to the gh-pages branch, which GitHub Pages serves.
#
#   npm run deploy
#
# Each run adds a commit on top of the branch rather than replacing its history: the
# classic Pages builder stalls on a force-push whose history it has never seen.
#
# The build reads .env.local. Only the publishable key reaches the bundle; the service
# key is not part of the front end and never leaves this machine.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

sh "$root/scripts/pack-extension.sh"
cd "$root/apps/web" && npx vite build

origin=$(git -C "$root" remote get-url origin)
work=$(mktemp -d)
if ! git clone -q --branch gh-pages --single-branch "$origin" "$work" 2>/dev/null; then
  git clone -q --depth 1 "$origin" "$work"
  cd "$work" && git checkout -q --orphan gh-pages && git rm -rq --cached . && rm -rf ./*
fi

cd "$work"
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$root/apps/web/dist/." .
touch .nojekyll                      # without it Pages hides the assets/ directory
git add -A
if git diff --cached --quiet; then
  echo "لا تغيير في الناتج المبني"
else
  git commit -q -m "نشر الموقع المبني"
  git push -q origin gh-pages
fi
cd "$root" && rm -rf "$work"
echo "✓ https://sultanhad.github.io/qaddim/"
