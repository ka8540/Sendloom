# Startup splash — the command-center boot sequence

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
| `src/components/startup-splash.tsx` | The command-center composition. |
| `src/components/use-startup-readiness.ts` | Readiness-driven lifecycle + broad stage copy. |
| `src/components/startup-splash-core.ts` | Pure timing / stage / module / particle logic (unit-tested). |
| `src/components/startup-splash.module.css` | Theme-token styling, motion, responsive, reduced-motion. |

## Visual concept

A calm outreach command center powering on. The desktop composition is
asymmetric:

- **Left:** the brand lockup — the real Sendloom logo tile, an
  "OUTREACH OPERATIONS" eyebrow, and a wide-tracked **SENDLOOM** command title
  framed by technical corner brackets. A thin emerald scan line sweeps across
  the title once; beneath it a spec rule carries tick marks and an accent
  segment that advances with the boot stage, plus the product story in one
  quiet line (Import → Enrich → Template → Sequence → Send → Track).
- **Right:** an operations map. Six module panels — Import (lead rows),
  Enrich (person node receiving data), Template (message card with a merge
  token), Sequence (timeline rail), Send (Gmail envelope with paced arcs),
  Track (reply loop) — dock into orbit around a central Sendloom core (loom
  threads + envelope chevron, the product mark's own motifs). Thin routing
  spokes draw in toward the core, paced pulses circulate the orbit, a send
  pulse leaves the core and a reply pulse returns along the Track spoke.
- **Bottom:** a boot footer with three stage ticks, one honest stage line with
  a blinking caret, and a controlled send rail carrying evenly spaced pulses
  right with a single reply blip returning.
- **Mobile (≤640px):** a separate vertical composition — compact centered
  lockup, then the six modules as docked rows on a live spine with a pulse
  travelling down and a reply returning up. Not a shrunken desktop.

It is visual brand storytelling, not a claim that the loader is really
searching or sending.

## When it appears

On a true full-page load of a splash path (`/`, `/login`, `/signup`). The
synchronous boot script decides per load and sets `html[data-load-screen]`;
`globals.css` keeps the overlay hidden (no flash) until it says `show`. It does
**not** replay during client-side navigation, remounts, theme changes, or
query-string changes — the gate decides once on first mount and the root layout
persists across soft navigations.

### 30-minute cooldown

Once the splash has actually been shown, hard refreshes of the splash paths
within 30 minutes skip it entirely — the page appears immediately with no
overlay, no timers, no listeners, and no particle animation. The boot script
reads/writes `localStorage["sendloom:startup-splash:last-shown-at"]`
(`STARTUP_SPLASH_COOLDOWN_MS = 30 * 60 * 1000`) synchronously before first
paint, so a skip can never flash the overlay:

- the stamp is written **once, at the moment the script commits to showing**
  (so rapid refreshes during the animation don't replay it);
- a skipped splash never refreshes the stamp;
- missing/malformed/future stamps and unavailable or throwing storage
  (private mode, storage denial) all fall back safely to *showing* the splash;
- non-splash routes (`/workspace`, `/prospects`, …) never show it and never
  write the stamp;
- cross-tab: `storage` events fire only in other tabs, so a tab whose splash is
  visible dismisses early when another tab stamps the key
  (`useStartupReadiness`'s `onStorage`).

`src/lib/load-screen.ts` exports the key/TTL plus
`isStartupSplashCooldownActive()` / `markStartupSplashShown()`; the inline boot
script mirrors them (same interpolated constants) because it must stay
self-contained.

## Readiness / dismissal

Dismissal is driven by **app readiness + wall-clock time**, never by an animation
completing. The real page is interactive as soon as `useStartupReadiness`'s
effect runs (React has mounted); from there it holds for a brief minimum, then
plays a short exit.

- Minimum visible: `MIN_VISIBLE_MS = 800ms`.
- Maximum safety ceiling: `MAX_VISIBLE_MS = 2200ms` — always removed by then, so
  it can never get stuck.
- Exit: `EXIT_MS = 320ms` (a CSS opacity transition; removal is a timer, not a
  `transitionend` listener), then the overlay unmounts.

Broad stage copy ("Assembling your outreach engine" → "Connecting leads,
messages, and send controls" → "Opening the command center") advances on time
thresholds — no fake percentage. The stage also drives the footer ticks and the
spec-rule segment via `data-stage`, so "progress" is wall-clock state, not an
animation.

## Hidden-tab reconciliation

Dismissal and stage advance use `setTimeout` + `Date.now()` — never
`requestAnimationFrame` or animation callbacks (browsers freeze those in
background tabs). On `visibilitychange` / `focus` / `pageshow` the hook recomputes
elapsed time, reconciles the stage, and dismisses immediately if the minimum
already elapsed. Nothing resets, re-mounts, or restarts. Timers and listeners are
cleaned up on unmount.

## Reduced motion

`prefers-reduced-motion: reduce` resolves the whole composition to its finished
state (title, panels, core, spokes, footer all visible) and removes travelling
pulses, particle drift, the scan, and the caret — keeping a premium static
design. Timing is unchanged, so it never stays visible longer.

## Performance

CSS/SVG only: keyframes, transforms, opacity, `stroke-dashoffset` (paths use
`pathLength="100"` so dash math is size-independent), and one
`background-position` rail. ≤14 particles (12 desktop / 8 tablet / 5 mobile),
capped and reduced on smaller viewports via CSS. No WebGL / canvas / video /
new dependency (the original Three.js + GSAP splash was removed). Colours are
`globals.css` tokens, so dark and light both work with no theme flash (theme is
resolved by `themeInitScript` before the splash renders).
