# Startup splash

The full-screen boot overlay shown while the public site initializes.

## Where it is mounted

`src/app/layout.tsx` renders `<PublicLoadScreen />` (a sibling of `{children}`)
and injects the synchronous `loadScreenInitScript` in the body. The splash is a
fixed overlay above the real, already server-rendered page — the page is never
gated behind it.

| File | Role |
| --- | --- |
| `src/lib/load-screen.ts` | Splash paths + the synchronous boot script that sets `html[data-load-screen]`. |
| `src/components/public-load-screen.tsx` | Mount gate — decides once whether to render the splash. |
| `src/components/startup-splash.tsx` | The "Signal Loom" visual. |
| `src/components/use-startup-readiness.ts` | Readiness-driven lifecycle (loading → exiting → done). |
| `src/components/startup-splash-core.ts` | Pure timing/particle/copy logic (unit-tested). |
| `src/components/startup-splash.module.css` | Theme-token styling, motion, responsive, reduced-motion. |

## When it appears

On a true full-page load of a splash path (`/`, `/login`, `/signup`). The
synchronous boot script decides per load and sets `html[data-load-screen]`;
`globals.css` keeps the overlay hidden (no flash) until it says `show`. It does
**not** replay during client-side navigation, remounts, theme changes, or
query-string changes — the gate decides once on first mount and the root layout
persists across soft navigations. There is no storage/cooldown: it is brief, so
it may appear on every hard refresh.

## Readiness / dismissal

Dismissal is driven by **app readiness**, never by a decorative animation
completing. The real page is interactive as soon as `useStartupReadiness`'s
effect runs (React has mounted); from there the only rule is to hold for a brief
minimum, then fade out.

- Minimum visible: `MIN_VISIBLE_MS = 500ms` (no flash).
- Maximum safety ceiling: `MAX_VISIBLE_MS = 2500ms` — the overlay is always
  removed by then, so it can never get stuck.
- Exit fade: `EXIT_MS = 320ms`, then the overlay is unmounted.

## Hidden-tab reconciliation

Dismissal uses `setTimeout` + a monotonic clock — never `requestAnimationFrame`
or animation callbacks (browsers freeze those in background tabs). If the minimum
elapsed while the tab was hidden, `visibilitychange` / `focus` / `pageshow`
reconcile and dismiss immediately on return. Nothing resets, re-mounts, or
restarts. Timers and listeners are cleaned up on unmount.

## Reduced motion

`prefers-reduced-motion: reduce` disables particle drift, the mark flow, the
core ping, and the sweeping progress bar (a calm static indicator remains).
Dismissal timing is unchanged, so it never stays visible longer.

## Performance

CSS-only motion (transform/opacity), ≤16 particles capped and reduced on smaller
viewports via CSS, no WebGL / canvas / video / new dependency, and the previous
Three.js + GSAP splash was removed. Colours are `globals.css` tokens, so dark and
light both work with no theme flash (theme is resolved by `themeInitScript`
before the splash renders).
