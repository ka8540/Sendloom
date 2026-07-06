# Startup splash — "The Outreach Loom"

The full-screen cinematic boot overlay shown while the public site initializes.

## Where it is mounted

`src/app/layout.tsx` renders `<PublicLoadScreen />` (a sibling of `{children}`)
and injects the synchronous `loadScreenInitScript` in the body. The splash is a
fixed overlay above the real, already server-rendered page — the page is never
gated behind it.

| File | Role |
| --- | --- |
| `src/lib/load-screen.ts` | Splash paths + the synchronous boot script that sets `html[data-load-screen]`. |
| `src/components/public-load-screen.tsx` | Mount gate — decides once whether to render the splash. |
| `src/components/startup-splash.tsx` | The cinematic composition. |
| `src/components/use-startup-readiness.ts` | Readiness-driven lifecycle + broad stage copy. |
| `src/components/startup-splash-core.ts` | Pure timing / stage / particle / copy logic (unit-tested). |
| `src/components/startup-splash.module.css` | Theme-token styling, motion, responsive, reduced-motion. |

## Visual concept

Scattered company / person / email / message signals flow along curved paths and
weave together beneath a large kinetic **SENDLOOM** wordmark (SEND solid, LOOM
constructed as an accent outline); one clean path continues out (TRACK). The
brand workflow **FIND / PERSONALIZE / SEND / TRACK** is distributed across the
composition, with a layered backdrop (gradient, emerald glow, faint grid, woven
arcs, particles, vignette) and a segmented readiness readout. It is visual brand
storytelling, not a claim that the loader is really searching or sending.

## When it appears

On a true full-page load of a splash path (`/`, `/login`, `/signup`). The
synchronous boot script decides per load and sets `html[data-load-screen]`;
`globals.css` keeps the overlay hidden (no flash) until it says `show`. It does
**not** replay during client-side navigation, remounts, theme changes, or
query-string changes — the gate decides once on first mount and the root layout
persists across soft navigations. No storage/cooldown: it is brief, so it may
appear on every hard refresh.

## Readiness / dismissal

Dismissal is driven by **app readiness + wall-clock time**, never by an animation
completing. The real page is interactive as soon as `useStartupReadiness`'s
effect runs (React has mounted); from there it holds for a brief minimum, then
plays a short exit.

- Minimum visible: `MIN_VISIBLE_MS = 1000ms`.
- Maximum safety ceiling: `MAX_VISIBLE_MS = 2600ms` — always removed by then, so
  it can never get stuck.
- Exit: `EXIT_MS = 420ms`, then the overlay unmounts.

Broad stage copy ("Connecting the signals" → "Shaping the workflow" → "Sendloom
is ready") advances on time thresholds — no fake percentage.

## Hidden-tab reconciliation

Dismissal and stage advance use `setTimeout` + `Date.now()` — never
`requestAnimationFrame` or animation callbacks (browsers freeze those in
background tabs). On `visibilitychange` / `focus` / `pageshow` the hook recomputes
elapsed time, reconciles the stage, and dismisses immediately if the minimum
already elapsed. Nothing resets, re-mounts, or restarts. Timers and listeners are
cleaned up on unmount.

## Reduced motion

`prefers-reduced-motion: reduce` resolves the whole composition to its finished,
crisp state (wordmark, nodes, drawn paths all visible) and removes path travel,
particle drift, sweeps, and the pulse — keeping a premium static design. Timing is
unchanged, so it never stays visible longer.

## Performance

CSS/SVG only: keyframes, transforms, opacity, and `stroke-dashoffset` (paths use
`pathLength="100"` so dash math is size-independent). ≤22 particles, capped and
reduced on smaller viewports via CSS. No WebGL / canvas / video / new dependency
(the previous Three.js + GSAP splash was removed). Colours are `globals.css`
tokens, so dark and light both work with no theme flash (theme is resolved by
`themeInitScript` before the splash renders).
