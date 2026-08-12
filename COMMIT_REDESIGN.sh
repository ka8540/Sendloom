#!/usr/bin/env bash
#
# One-shot commit for the public-surface redesign.
#
# The sandbox that produced these changes cannot delete files inside the mounted
# folder, so two things were left behind that this script clears:
#
#   .git/index.lock   stale zero-byte lock from the branch checkout (no git
#                     process is running; it is safe to remove)
#   csscheck.cjs      throwaway postcss validation script
#   .fuse_hidden*     old file versions left by in-place edits on the mount
#
# Run from the repo root:  bash COMMIT_REDESIGN.sh
#
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Clearing sandbox leftovers"
rm -f .git/index.lock
rm -f csscheck.cjs
find src -name '.fuse_hidden*' -delete

echo "==> Confirming branch"
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "redesign/premium-public-surface" ]; then
  echo "    Expected redesign/premium-public-surface, found '$branch'. Stopping." >&2
  exit 1
fi
echo "    on $branch"

echo "==> Staging"
git add \
  src/app/globals.css \
  src/app/landing.module.css \
  src/app/auth.module.css \
  src/app/legal.module.css \
  src/app/layout.tsx \
  src/app/page.tsx \
  src/app/faq/page.tsx \
  src/components/auth-page.tsx \
  src/components/legal-page.tsx

echo "==> Committing"
git commit -F - <<'MSG'
Redesign public surface with a real design-token system

Applies a premium, intentional visual system to the marketing/public pages
(landing, auth, legal, FAQ) without touching any application logic.

Bugs found during the audit:

- globals.css declared `Inter` as the root font but no Inter was ever loaded,
  so every surface silently fell back to system-ui. Geist is now loaded and
  wired properly via next/font.
- Display type used "Iowan Old Style", a macOS-only system serif. Windows and
  Linux visitors were served Georgia, so the brand's most prominent type was
  inconsistent by platform. Replaced with Instrument Serif as a real webfont.
- `:focus-visible` on every landing CTA was grouped with `:hover` and set
  `outline: none` with only a 2px lift, leaving keyboard users with no visible
  focus indicator (WCAG 2.4.7 failure). Focus now has its own explicit ring.
- No skip-to-content link existed anywhere on the site.
- No `prefers-reduced-motion` handling existed.

Design system (new token layer in globals.css):

- Type scale replacing ~30 ad-hoc sizes (0.74/0.76/0.78/0.82/0.84rem...)
- Tracking, leading, weight and measure tokens
- 4px spacing rhythm with asymmetric section padding (optical correction)
- Radius scale replacing 20 unrelated values
- Two-part tinted elevation carrying the page hue instead of flat black
- Motion curves - no `linear` or `ease-in-out` remains in the public CSS
- Named z-index layers

Visual changes:

- Primary CTA: three-stop 135deg gradient + gloss overlay -> flat accent with
  a tinted contact shadow
- Hero accent word: animated green-to-blue gradient -> single hue, italic,
  held still
- Eyebrows: Bebas Neue condensed display -> Geist Mono at 11px with open
  tracking
- Capability tags: pill -> square, mono, so they read as data not buttons
- Legal prose: measure capped, callouts changed from tinted boxes to a left
  accent rule
- Arbitrary weights (650/680/720/760/800) collapsed to a 3-step scale

Verified: tsc --noEmit passes, all four stylesheets parse under postcss, every
CSS-module class referenced in TSX still resolves, and every token referenced
is defined.
MSG

echo
echo "==> Done"
git log --oneline -1
echo
echo "Now run:  npm run dev    and check / /login /signup /faq /terms /privacy"
echo "Remove this script when you're happy:  rm COMMIT_REDESIGN.sh"
