# Discover search processing experience

The full-page "loading" experience shown while a Discover search runs its
pipeline (`/prospects/[searchId]`, non-terminal / failed states). It replaces the
old spinner-in-a-card with a premium, background-safe progress composition.

## Why it exists / the hidden-tab fix

The Discover pipeline (`ProspectSearchService.processSearch`: resolve company →
find people → classify roles → infer email pattern → ready) runs **server-side**
and records each transition on the `ProspectSearch` row.

Previously the UI fired a single long `processProspectSearch` mutation and showed
a spinner driven by a client `processing` boolean — **no polling, no
reconciliation**. So progress appeared to stall when the tab was backgrounded,
and a refresh/navigation lost all progress even though the server kept working.

The fix treats the database status as the single source of truth:

- **Start** (explicit user action only) fires the mutation with
  `keepalive: true` so the server finishes even if the tab is closed. The
  progress display never depends on that response.
- **Observe** via `useProspectProcessingSync`, which polls the lightweight
  `PROSPECT_SEARCH_STATUS_QUERY` on a calm foreground interval, slows right down
  when the tab is hidden, and reconciles **immediately** on `visibilitychange`,
  `focus`, `online`, and `pageshow`. It backs off on transient errors, treats
  offline as *reconnecting* (never failure), and stops at a terminal status.
- **Reconnect** on mount/refresh reads status by route id and **never
  auto-starts** — no duplicate work.

No new queue/worker/job system was introduced; the pipeline itself is unchanged.

## Files

| File | Role |
| --- | --- |
| `prospect-processing.ts` | Pure, DOM-free state machine, stage map, poll/backoff math, particle budget, copy. Unit-tested. |
| `use-prospect-processing-sync.ts` | Background-safe status poller + reconciliation listeners. Owns no progress value. |
| `prospect-processing-experience.tsx` | The premium composition (signature orbit visual, status panel, stage trail, particle field, failure state). |
| `prospect-processing.module.css` | Theme-token-only styling; transform/opacity motion; reduced-motion + responsive rules. |

## State model

One explicit phase, mapped centrally in `resolveProcessingPhase`:
`INITIALIZING` → `RUNNING` → `COMPLETED` / `FAILED`, plus `RECONNECTING`
(offline / transient) and `CANCELLED`. Terminal backend truth always wins, so
impossible combinations (e.g. completed-and-retrying) cannot occur.

## Progress truthfulness

Progress is **stage-based**, never fabricated: the ring/meter advance only when
the backend reports the next status, and they reach 100% only at `READY`. Within
a stage a decorative shimmer conveys "working" without inventing a percentage.

## Performance

CSS-only particles (≤18, fewer on mobile, 0 under reduced-motion), no WebGL/
canvas/rAF, `transform`/`opacity` only, decorative animation pauses when the tab
is hidden. All colour comes from `globals.css` tokens, so dark/light both work.
