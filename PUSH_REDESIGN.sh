#!/usr/bin/env bash
#
# Finish and push the public-surface redesign.
#
# The commit already exists: 9a4f326 on redesign/premium-public-surface.
# It was made from a temporary git index, because the sandbox that produced the
# changes could not delete files inside this folder and a stale .git/index.lock
# was blocking the normal path. Two consequences this script fixes:
#
#   1. The real .git/index is stale, so `git status` shows the committed files
#      as "MM". A mixed reset refreshes the index from HEAD. Your working tree
#      already matches the commit, so nothing is lost.
#   2. Leftover junk the sandbox could not unlink: the stale lock, a throwaway
#      postcss check script, .fuse_hidden* files from in-place edits, and
#      tmp_obj_* scratch files in .git/objects (git ignores these, but they
#      are clutter).
#
# The push itself has to run here rather than in the sandbox, which has no SSH
# key for github.com:ka8540/Sendloom.git.
#
# Run from the repo root:  bash PUSH_REDESIGN.sh
#
set -euo pipefail

cd "$(dirname "$0")"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "redesign/premium-public-surface" ]; then
  echo "Expected branch redesign/premium-public-surface, found '$branch'. Stopping." >&2
  exit 1
fi

echo "==> Clearing the stale lock"
rm -f .git/index.lock

echo "==> Refreshing the index from HEAD"
git reset --quiet

echo "==> Removing sandbox leftovers"
rm -f csscheck.cjs
find src -name '.fuse_hidden*' -delete
find .git/objects -name 'tmp_obj_*' -delete

echo "==> Working tree should now be clean:"
if [ -z "$(git status --porcelain -- src/)" ]; then
  echo "    clean"
else
  echo "    unexpected changes under src/ — review before pushing:" >&2
  git status --short -- src/
  exit 1
fi

echo "==> Commit being pushed"
git log --oneline -1

echo "==> Pushing"
git push -u origin redesign/premium-public-surface

echo
echo "==> Done. Open a PR:"
echo "    https://github.com/ka8540/Sendloom/compare/master...redesign/premium-public-surface"
echo
echo "Before merging, run locally (the sandbox is Linux, your node_modules is macOS):"
echo "    npm run build"
echo "    npm test"
echo
echo "Then remove this script:  rm PUSH_REDESIGN.sh"
