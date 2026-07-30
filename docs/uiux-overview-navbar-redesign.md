# Sendloom UI/UX — Overview + Sidebar/Navbar Redesign

Source of truth for the minimal B2B SaaS redesign of the **Overview page** (`/workspace`)
and the **app sidebar/navbar**. Any future change to these surfaces must follow the
tokens and rules in this file. Do not invent new fonts, sizes, colors, radii, or button
shapes — extend this document first, then implement.

Status: active. Branch: `redesign/minimal-overview-navbar`.

---

## 1. Scope

In scope:

- **Overview page redesign** — `/workspace`, rendered by
  `src/components/dashboard/overview-command-center.tsx` and its child presentational
  components (summary cards, analytics pulse, sequence panel, activity feed, loading
  skeleton).
- **Sidebar/navbar redesign** — both the **expanded** sidebar and the **collapsed**
  icon rail (`src/components/nav.tsx`, `src/components/session-controls.tsx`, and the
  shell/sidebar rules in `src/app/globals.css`).
- **Light and dark theme behavior** for every surface listed above, including hover,
  focus, active, disabled, and empty states.
- Presentation-only token layer shared by these surfaces.

Out of scope for this document (untouched by the redesign):

- Any backend or feature behavior change.
- Any other page's visual language. Other routes keep their current look; the shared
  sidebar changes because it is literally the same component on every app route, which
  is intended.

## 2. Non-goals

- **No backend changes** — no services, workers, schedulers, Gmail/Redis logic.
- **No route changes** — every href, route, and redirect stays exactly as it is.
- **No API changes** — no new endpoints, no changed payloads, no new fetches.
- **No database changes** — no Prisma schema edits, no migrations.
- **No feature removal** — every metric, action, link, filter, and state that exists
  today still exists after the redesign.
- **No new analytics/tracking behavior** — no new events, beacons, or telemetry.
- **No AI-agent files committed** — see §13.

## 3. Design direction

Minimal, professional B2B SaaS. Benchmarked against the *quality level* of modern
outreach/data tools such as hunter.io: calm whitespace, neutral surfaces, thin borders,
simple hierarchy, restrained color. **Nothing from Hunter is copied** — no brand, logo,
assets, exact colors, or copy. Sendloom branding (name, mark, green) stays.

Principles:

1. **Flat over glassy.** No frosted glass, no layered gradients on surfaces, no glow
   halos, no shine sweeps, no decorative grid overlays.
2. **Hairline borders do the work.** A 1px border plus a neutral surface separates
   content. Shadows are near-invisible and used only to lift a card off the page.
3. **High whitespace, clear hierarchy.** One page title, section titles at 18px, and
   uppercase micro-labels for card metadata. Never more than three type sizes in one card.
4. **Restrained color.** Sendloom green is an accent, not a background. It marks the
   primary action, the active nav item, and positive status — nothing else. Status colors
   (success/warning/danger/info) only appear on real status.
5. **Less noise.** Remove decorative pulses, animated eyebrows, hover lift transforms,
   and oversized display type. Motion is limited to color/opacity transitions and the
   existing reduced-motion guards stay.
6. **Uniform cards.** Metric cards share one padding scale, one radius, one border, one
   label/value/meta rhythm, and equal heights within a row.
7. **Dark theme is grey/charcoal**, never pure black, never neon.

## 4. Typography tokens

One font stack for the whole dashboard — the app already sets Inter globally on `:root`
in `src/app/globals.css`, so the redesign **inherits it** and does not re-declare a font
per component:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Sizes (implemented as tokens; `rem` values assume the 16px root):

| Token | Role | Value |
| --- | --- | --- |
| `--ui-text-page-title` | Page title (desktop) | `2.5rem` / 40px |
| — | Page title (medium ≤ 1200px) | `2rem` / 32px |
| — | Page title (small ≤ 900px) | `1.75rem` / 28px |
| `--ui-text-section` | Section title | `1.125rem` / 18px |
| `--ui-text-metric` | Card metric number | `2rem` / 32px |
| `--ui-text-label` | Card title/label | `0.75rem` / 12px, uppercase, `letter-spacing: 0.06em` |
| `--ui-text-body` | Body text | `0.875rem` / 14px |
| `--ui-text-secondary` | Secondary text | `0.8125rem` / 13px |
| `--ui-text-nav` | Sidebar nav text | `0.875rem` / 14px |
| `--ui-text-button` | Button text | `0.875rem` / 14px, weight 600 |
| `--ui-text-chip` | Chip text | `0.75rem` / 12px, weight 600 |

The page title is responsive via one clamp that lands on the three values above:
`clamp(1.75rem, 2.4vw + 1rem, 2.5rem)`, with explicit breakpoint overrides where a hard
32px/28px step is wanted.

Line heights:

| Token | Role | Value |
| --- | --- | --- |
| `--ui-leading-title` | Page title | `1.05` |
| `--ui-leading-section` | Section title | `1.3` |
| `--ui-leading-body` | Body | `1.5` |
| `--ui-leading-label` | Label | `1.2` |

Weights: 400 body, 500 secondary emphasis, 600 buttons/labels/nav, 650–700 metrics and
titles. Nothing heavier than 700. Letter-spacing is `-0.02em` on the page title and
metric numbers, `0.06em` on uppercase labels, and `0` everywhere else.

Numbers in metrics use `font-variant-numeric: tabular-nums` so values do not jitter when
they refresh.

## 5. Color tokens

Semantic tokens only — components never hardcode a hex. All tokens are declared in the
three theme blocks of `src/app/globals.css` (`:root`, `:root[data-theme="dark"]`, and
`@media (prefers-color-scheme: dark) :root:not([data-theme])`) so an unset theme
preference resolves correctly.

### Light theme

| Token | Value | Use |
| --- | --- | --- |
| `--ui-bg` | `#F6F7F9` | App page background (soft neutral grey, not blue-heavy) |
| `--ui-surface` | `#FFFFFF` | Card/panel surface |
| `--ui-surface-elevated` | `#FFFFFF` | Menus, popovers, sticky headers |
| `--ui-surface-subtle` | `#F7F8FA` | Inset areas, table headers, tile fills |
| `--ui-surface-hover` | `#F1F3F6` | Row/nav hover |
| `--ui-border` | `#E3E7ED` | Default hairline border |
| `--ui-border-strong` | `#D5DBE3` | Emphasised border, input border |
| `--ui-text-strong` | `#16202E` | Headings, metric numbers |
| `--ui-text-body` | `#3C4657` | Body copy |
| `--ui-text-muted` | `#6B7788` | Labels, meta, secondary text |
| `--ui-accent` | `#167C5A` | Sendloom green — primary action, active nav |
| `--ui-accent-hover` | `#12674A` | Primary hover/darken |
| `--ui-accent-contrast` | `#FFFFFF` | Text on accent |
| `--ui-accent-soft` | `#ECF4F1` | Accent tint background (active nav, soft chips) |
| `--ui-success` | `#167C5A` | Positive status |
| `--ui-success-soft` | `#E9F3EF` | Positive chip background |
| `--ui-warning` | `#A9670C` | Attention status |
| `--ui-warning-soft` | `#FBF1E3` | Attention chip background |
| `--ui-danger` | `#B4453F` | Failure status (soft red, not fire-engine) |
| `--ui-danger-soft` | `#FAEDEC` | Failure chip background |
| `--ui-info` | `#3B6EA8` | Neutral informational status (muted blue) |
| `--ui-info-soft` | `#EDF2F8` | Info chip background |
| `--ui-focus-ring` | `rgba(22, 124, 90, 0.28)` | Focus ring color |
| `--ui-shadow-card` | `0 1px 2px rgba(16, 24, 40, 0.04)` | Card lift |
| `--ui-shadow-overlay` | `0 8px 24px rgba(16, 24, 40, 0.10)` | Menus/popovers only |

### Dark theme

Greyish charcoal. **Never `#000`. Never neon.** Warning and danger must not glow.

| Token | Value | Use |
| --- | --- | --- |
| `--ui-bg` | `#22262D` | App page background |
| `--ui-sidebar-bg` | `#262B34` | Sidebar background |
| `--ui-surface` | `#2D333D` | Card/panel surface |
| `--ui-surface-elevated` | `#343B46` | Menus, popovers, raised tiles |
| `--ui-surface-subtle` | `#282E37` | Inset areas |
| `--ui-surface-hover` | `#333A45` | Row/nav hover |
| `--ui-border` | `#3F4754` | Default hairline border |
| `--ui-border-strong` | `#4B5462` | Emphasised border |
| `--ui-text-strong` | `#E9ECF1` | Near-white, not pure white |
| `--ui-text-body` | `#C3CAD5` | Soft grey body |
| `--ui-text-muted` | `#8F9BAC` | Blue-grey muted |
| `--ui-accent` | `#4EB289` | Softened Sendloom green |
| `--ui-accent-hover` | `#5CC095` | Hover |
| `--ui-accent-contrast` | `#10201A` | Text on accent |
| `--ui-accent-soft` | `rgba(78, 178, 137, 0.14)` | Accent tint |
| `--ui-success` | `#57B892` | Positive status |
| `--ui-success-soft` | `rgba(87, 184, 146, 0.14)` | Positive chip |
| `--ui-warning` | `#CE9A5B` | Attention status (matte, no glow) |
| `--ui-warning-soft` | `rgba(206, 154, 91, 0.14)` | Attention chip |
| `--ui-danger` | `#D08A83` | Failure status (soft, no glow) |
| `--ui-danger-soft` | `rgba(208, 138, 131, 0.14)` | Failure chip |
| `--ui-info` | `#7EA3CC` | Info status |
| `--ui-info-soft` | `rgba(126, 163, 204, 0.14)` | Info chip |
| `--ui-focus-ring` | `rgba(78, 178, 137, 0.34)` | Focus ring |
| `--ui-shadow-card` | `0 1px 2px rgba(0, 0, 0, 0.24)` | Card lift |
| `--ui-shadow-overlay` | `0 10px 28px rgba(0, 0, 0, 0.36)` | Menus/popovers only |

Light sidebar background is `--ui-surface` (`#FFFFFF`) with a right hairline; dark uses
`--ui-sidebar-bg` (`#262B34`), one step darker than the card surface so the rail reads as
chrome rather than content.

Rules:

- Never write a raw hex in a component stylesheet — use a token.
- Never use accent green as a large fill. Fill is for buttons, the active-nav tint, and
  small status marks.
- Status color must always be paired with text; color is never the only signal.

## 6. Spacing tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ui-page-pad-x` | `32px` desktop, `24px` ≤1200px, `16px` ≤900px | Page horizontal padding |
| `--ui-page-pad-y` | `28px` desktop, `20px` small | Page vertical padding |
| `--ui-gap-section` | `24px` | Gap between page sections |
| `--ui-pad-card-lg` | `24px` | Large card padding |
| `--ui-pad-card` | `20px` | Normal card padding |
| `--ui-pad-card-sm` | `16px` | Compact card padding |
| `--ui-gap-grid` | `20px` | Card grid gap |
| `--ui-gap-stack` | `12px` | Vertical rhythm inside a card |
| `--ui-nav-item-h` | `44px` | Sidebar item height |
| `--ui-nav-item-pad-x` | `14px` | Sidebar item horizontal padding |
| `--ui-gap-button` | `10px` | Gap between buttons and between a button's icon and label |
| `--ui-chip-h` | `26px` | Chip height |

## 7. Radius tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ui-radius-panel` | `16px` | Page panels / large cards |
| `--ui-radius-card` | `14px` | Small cards, tiles |
| `--ui-radius-button` | `10px` | Standard buttons |
| `--ui-radius-pill` | `999px` | Pill buttons (only where the control is a filter/toggle) |
| `--ui-radius-chip` | `999px` | Chips, status dots, meters |
| `--ui-radius-nav` | `12px` | Sidebar active/hover item |
| `--ui-radius-control` | `8px` | Inputs, selects, icon buttons |

## 8. Button system

| Token | Value |
| --- | --- |
| `--ui-btn-h` | `40px` (primary and secondary) |
| `--ui-btn-h-sm` | `32px` (small) |
| `--ui-btn-icon` | `36px` (square icon button) |
| `--ui-btn-pad-x` | `16px` (primary/secondary, i.e. `padding: 0 16px`) |
| `--ui-btn-pad-x-sm` | `12px` |

Rules:

- **Primary** — `background: var(--ui-accent)`, `color: var(--ui-accent-contrast)`,
  no border, `--ui-radius-button`, 14px/600 text. Hover darkens to
  `--ui-accent-hover`. No gradient, no glow, no translate on hover.
- **Secondary** — `background: var(--ui-surface)` (light) / `var(--ui-surface-elevated)`
  (dark charcoal), `1px solid var(--ui-border)`, `color: var(--ui-text-strong)`.
  Hover fills with `--ui-surface-hover` and darkens the border to `--ui-border-strong`.
- **Ghost/tertiary** — transparent background, no border, muted text, hover fills with
  `--ui-surface-hover`.
- **Icon button** — 36×36, `--ui-radius-control`, transparent by default, hover fills
  with `--ui-surface-hover`.
- Icons inside buttons are 16px, `--ui-gap-button` from the label.
- **Focus**: `outline: none` plus `box-shadow: 0 0 0 3px var(--ui-focus-ring)`. Every
  interactive control must show it. Never remove focus styling.
- **Disabled**: `opacity: 0.55`, `cursor: not-allowed`, no hover change.
- No random gradients. The only accepted fills are a flat token color or a flat surface.
- Button sizing is identical on the Overview page and in sidebar actions.

## 9. Sidebar/navbar rules

Both states share one component and one set of tokens; only widths and label visibility
change. Collapsed-state persistence (cookie + `localStorage` + the pre-paint
`html[data-sidebar-collapsed]` script) is **behavior and must not be modified**.

### Expanded sidebar

- Width `272px`. Background `--ui-surface` (light) / `--ui-sidebar-bg` (dark), right
  hairline `1px solid var(--ui-border)`, no blur, no shadow.
- Header row: Sendloom logo mark (32px) + wordmark (16px/600) on one line, with the
  collapse toggle as a 36px icon button on the right of the same row.
- The product subtitle is **hidden in the sidebar** — it crowded the rail and added a
  second type size to the header. Keep the string in the component (it still describes
  the surface for admins vs operators) but do not render it as a visible third line.
- Nav items: Overview, Finder, Discover, Imports, Templates, Sequences — in that order,
  unchanged hrefs. Admin keeps its own list unchanged.
- Item: height `--ui-nav-item-h` (44px), horizontal padding `--ui-nav-item-pad-x` (14px),
  radius `--ui-radius-nav` (12px), 14px/500 text, 18px icon, 12px icon→label gap.
  Icons and labels align on one baseline grid across every item.
- States: rest = transparent + `--ui-text-body`; hover = `--ui-surface-hover` +
  `--ui-text-strong`; **active** = `--ui-accent-soft` background, `--ui-text-strong`
  label, `--ui-accent` icon, and a 3px accent bar on the inner edge. No border, no
  shadow, no scale — clear but not oversized.
- Footer: theme toggle, hairline divider, Account, Log out. Same 44px item metrics as
  the main nav.

### Collapsed sidebar

- Width `76px`. Icon-only rail, items centered, 44×44 square with `--ui-radius-nav`.
- Identical active-state logic and identical active styling (accent tint + accent icon);
  the inner accent bar is kept so the two states read the same.
- Labels are hidden with CSS only; the DOM does not change, so no layout jump and no
  re-render on toggle.
- Tooltips use the existing native `title` attribute already present on collapsed items
  (presentation only, no new dependency).
- The shell grid transition (`grid-template-columns`) is the only motion; nothing inside
  the rail animates position.

## 10. Overview page layout rules

Keep **all** existing data and actions. Nothing in this list may be removed:

- Active / running / queued counts
- Sent 24h metric
- Attention / review metric
- Create Sequence action
- Import List action
- Analytics pulse / delivered / issues
- Sequence health
- Active sequences card
- Lists ready card
- Templates live card
- Gmail send window card
- Every existing link, action, empty state, filter, pagination, and refresh behavior

Layout:

1. **Hero (one block).** The Overview stays a *single* bordered panel — identity and
   stat tiles on the left, the action + analytics card on the right. It must not be split
   into sibling sections (a prior split layout was explicitly rejected and is pinned by
   tests; see §12).
   - `--ui-radius-panel`, `1px solid var(--ui-border)`, flat `--ui-surface`,
     `--ui-shadow-card`, `--ui-pad-card-lg` padding.
   - Header: small uppercase eyebrow (12px label token, no animated dot), page title at
     the page-title token, one 14px line of copy.
   - Three stat tiles in a uniform row: 12px uppercase label, 32px metric number, 13px
     meta line. Equal height, `--ui-radius-card`, `--ui-surface-subtle` fill, hairline
     border. The attention tile switches its number and meta to warning tokens when
     something needs review; otherwise it reads as neutral/positive.
2. **Analytics card.** Reads as a professional analytics panel: flat surface, hairline
   sub-section dividers, no grid overlay, no backdrop blur. The donut, metric rows, and
   health rail keep every interaction (hover preview, click to pin, keyboard activation,
   Escape to close, links to filtered Sequences views).
3. **Summary row.** Four uniform metric cards (Active sequences, Lists ready, Templates
   live, Gmail send window) in one grid — `--ui-gap-grid`, `--ui-radius-card`, equal
   heights, identical internal rhythm: icon + status chip row, label, 32px value, unit,
   visual, footer link row.
4. **Main grid.** Recent sequences panel + activity feed, same card treatment.
5. Section headers are one 12px uppercase kicker + one 18px title + one 13px line.

Responsive behavior and the app-shell spacing are preserved: the hero collapses to one
column, the summary grid steps 4 → 2 → 1, and the main grid stacks, at the existing
breakpoints.

## 11. Dark mode rules

- Grey/charcoal only. `--ui-bg` is `#22262D`; **no `#000`** anywhere.
- No neon green — dark accent is the softened `#4EB289`.
- Warning and danger are matte; no glow, no saturated fill.
- Every card, button, chip, tile, meter, divider, and sidebar state must resolve through
  tokens so both themes are covered by construction.
- No light-only border, shadow, or `rgba(255,255,255,…)` inset may survive into dark
  mode. If a value cannot be expressed as a token, it does not ship.
- Contrast targets: body text ≥ 4.5:1 against its surface, muted text ≥ 4:1, and every
  focus ring visible on both themes.

## 12. Implementation checklist

Before touching UI files:

1. Read `README.md` (product surface, Overview section).
2. Read `DOCUMENTATION.md` (§16 UI/UX Documentation).
3. Read this file.
4. Locate the current Overview/dashboard/sidebar components.
5. Confirm which files are presentational only.
6. Confirm which files must not be touched.

Files involved in this redesign:

- `src/app/(app)/layout.tsx` — app shell (read-only reference; the collapsed-state script
  is behavior)
- `src/app/globals.css` — token layer + shell/sidebar/nav rules
- `src/components/nav.tsx`, `src/components/session-controls.tsx`,
  `src/components/theme-switcher.tsx` — sidebar composition
- `src/components/dashboard/overview-command-center.tsx` + `.module.css`
- `src/components/dashboard/overview-summary.tsx` + `.module.css`
- `src/components/dashboard/analytics-pulse.tsx` + `.module.css`
- `src/components/dashboard/overview-loading.tsx` + `.module.css`
- `src/components/dashboard/activity-feed.tsx`, `sequence-panel.tsx`, `sequence-row.tsx`

Must **not** be touched: `prisma/**`, `src/services/**`, `src/workers/**`,
`src/app/api/**`, business/domain logic in `src/lib/**`, migrations, `package.json`
dependencies, environment handling.

### Pinned constraints (existing tests will fail if these break)

These are enforced by `src/components/dashboard/overview-redesign.test.ts`,
`src/manuals/workspaceManual.test.ts`, and `src/components/nav.test.ts`:

- The Overview hero is **one** block: no `<section>` may open between
  `data-overview-tour="page-intro"` and `<OverviewSummary`. The class names `pulseDeck`,
  `startSection`, `statStrip`, and `heroStats` are banned.
- Keep these anchors: `data-overview-tour` values `page-intro`, `workspace-health`,
  `needs-attention`, `recent-sequences`, `view-all-sequences`, `active-sequences`,
  `lists-ready`, `templates-live`, `gmail-send-window`, `gmail-progress`,
  `sender-breakdown`, `recent-sequence-card`, `recent-sequences-pagination`,
  `live-system`, `activity-row`, `delivery-issues`, `sequence-health`.
- Keep the sidebar landmark `nav[aria-label='Main navigation']` and the Overview root as
  a plain `div` child of `main.content` (tour selector
  `main.content > div:not(.content-toolbar)`).
- Keep the helper names `buildSequenceHealth` / `buildActivityItems`, the hero copy
  "Launch, import, or review what needs attention.", the `heroTitle`/`heroActionCard`/
  `heroInsights`/`heroCta` class names, and the loading-skeleton bone names
  (`heroIdentity`, `highlightRow`, `actionCard`, `ctaRow`, `insightStack`, `donutRing`,
  `donutCore`, `metricRow`, `railBar`, `healthChips`, `summaryRow`, `mainGrid`,
  `activityRow`).
- Every redesigned stylesheet keeps its `@media (prefers-reduced-motion: reduce)` block,
  and `.heroCta:focus-visible` stays declared.
- `.nav-footer-divider` keeps `height: 1px`, `var(--line)`, and a `margin`; the collapsed
  divider keeps `width: 1.75rem`.
- No screenshot literals (`8.7K`, `8.2K`, `299`, `155`, `96%`) may appear in the Overview
  sources — not even in comments.

When a redesign intentionally changes a pinned *visual* value (for example the page-title
clamp), update the assertion in the same commit and say so in the PR description. Never
delete a pinned assertion to make a suite pass.

## 13. Git hygiene / AI files

`.gitignore` must cover AI tool artifacts:

```
.claude/
.claude/**
CLAUDE.md
AGENTS.md
.cursor/
.cursor/**
memory.md
.memories/
*.skill.md
skill.md
```

Do not create `AGENTS.md`, `CLAUDE.md`, `memory.md`, `skill.md`, `.claude` files, or any
hidden AI instruction file. The only markdown file this redesign adds is this one.

> Note: the repository's `.gitignore` currently ignores `docs/` wholesale. This file is
> re-included via a negation so the design system is actually tracked; the rest of
> `docs/` stays ignored.

## 14. Validation

After changes:

```bash
npx tsc --noEmit
```

```bash
npm test
```

```bash
npm run lint
```

If a command fails for a pre-existing repo reason, report the exact failure and state
whether the changed files caused it.

## 15. Diff safety check

Every change must end with `git status`, `git diff --stat`, an explicit list of changed
files, and a confirmation that:

- no backend/business-logic file was changed,
- no AI tool file was created,
- Overview functionality and sidebar routes/actions were preserved.
