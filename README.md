# Sendloom

Sendloom is a full-stack outreach operations app for small teams that want one place to import a list, find missing emails, write the message, connect Gmail, launch the sequence, and watch the run move.

The live product surface today is organized around:

- `Overview`
- `Finder`
- `Imports`
- `Templates`
- `Sequences`
- `Eligibility verification`
- `Legal / Anti-Abuse`
- `Admin` for admin users

The UI is branded as **Sendloom**. The npm package name in `package.json` is still `mergepilot`, and that mismatch is expected in the current codebase.

## Product Surface Today

### Overview

The operator landing surface is `/workspace`.

It shows:

- high-level metrics for active sequences, imports, and templates
- recent sequence cards with progress, delivery state, and last activity
- live-refresh behavior while runs are queued or running
- quick entry points back into the current work

#### Recent sequences filters

The "Recent sequences" panel ("Jump into the work that moved last") exposes a row
of client-side filters that narrow the visible sequence cards without a page
reload:

- **Search** — matches against the sequence name and its `list · template · sender` summary.
- **Status** — running, completed, needs attention, scheduled, draft.
- **Focus** — all recent, running now, validated, needs attention.
- **Type** — schedule type of the sequence (see below).
- **Sort** — latest activity, progress, or name.

**Type (schedule-type) filter.** Filters cards by how the sequence was scheduled:

| Option | Shows |
| --- | --- |
| All types | every sequence (default) |
| Send immediately | sequences launched right away / immediate mode |
| Schedule once | sequences scheduled to send one time |
| Repeat schedule | recurring / repeating scheduled sequences |

How it combines: all five filters are applied together (logical AND) and then the
result is sorted. The Type filter stacks with Search, Status, Focus, and Sort, and
changing any filter resets pagination to the first page. Relaunch, remove, and
open-detail row actions are unaffected.

Implementation notes / data assumptions:

- The filter reads `Campaign.scheduleType` (`"immediate" | "once" | "recurring"`),
  the same column written by the campaign builder and scheduling APIs.
- Values are normalized in the dashboard data layer by `normalizeScheduleType`
  (`src/components/dashboard/overview-command-center.tsx`) into the closed
  `SequenceScheduleType` union (`src/components/dashboard/types.ts`). Legacy or
  missing values (`null`) fall back to `"immediate"`, so older sequences group
  under **Send immediately** and never break the UI.
- The filtering itself lives in `SequencePanel`
  (`src/components/dashboard/sequence-panel.tsx`) and reuses the existing toolbar
  dropdown styles, so light and dark mode and spacing stay consistent with the
  other filters.

### Finder

The Finder workspace is a first-class part of the current nav and appears before Imports.

It supports:

- Hunter-powered email finder lookups by name and domain
- Hunter-powered domain search
- per-user Hunter API key storage
- domain search history

### Imports

Imports are still the first operational step for most users.

The current imports flow supports:

- CSV/XLSX upload
- column detection
- lightweight preview rows
- template-field selection
- mapping review and edits

### Templates

Templates are created and edited inside `/templates`.

Current template capabilities:

- `PLAIN_TEXT`, `HTML`, and `JSON` formats
- live preview
- merge-variable detection
- AI help for subject/body enhancement
- spam-risk cleanup flow
- plain-text body rendering that preserves paragraphs, bullet lists, and numbered lists when users paste email copy directly into the editor

### Sequences

The active sequence workspace lives under `/campaigns`, with `/sequences` acting as an alias/redirect surface.

Current sequence behavior includes:

- sequence creation from import + mapping + template + sender
- immediate, one-time, and recurring schedules
- Gmail sender selection through Google OAuth-connected profiles
- validation before launch
- launch, pause, resume, relaunch, and delete actions
- attachment support
- recipient-level activity with pagination
- replies, delivery state, opens, and failures on the detail screen

### Admin

Admin users access a dedicated control center through sidebar sub-navigation that appears automatically when signed in as an admin. The admin area is split into four focused sub-pages:

- **Overview** (`/admin`) — aggregate metrics (total users, active sessions, restricted accounts, admin count), a user-status donut chart, top domains by sender count, and a live system health strip with a shortcut to the full health report.
- **User Management** (`/admin/users`) — searchable, paginated user table with a sticky inspector panel. Click any user row to inspect their account details, session status, data counts, and apply per-user controls (restrict API access, imports, templates, launches, and AI enhancements) or delete the account.
- **Restrictions** (`/admin/restrictions`) — a dedicated picker-and-panel view for managing per-user access restrictions and reviewing which controls are active on each account.
- **System Health** (`/admin/system-health`) — live runtime check cards for Database, Redis, Storage/R2, Google OAuth, Mail Provider, and Cron. Includes a **Recheck** button that re-fetches all service statuses on demand without a page reload.

### Eligibility Verification And Anti-Abuse

Sendloom now gates the authenticated operator app behind an eligibility and policy confirmation step for non-admin users.

Current behavior:

- new or unverified non-admin users are redirected from the app shell to `/verify-eligibility`
- users must confirm they are 18 or older
- users must accept the Terms of Service, Privacy Policy, and Anti-Abuse Policy before accessing the operator workspace
- ineligible users can self-report through the verification screen, which marks the account as blocked
- blocked or restricted accounts are denied authenticated API access with user-facing error messages
- verification, ineligibility, restriction, and unrestriction events are recorded in the audit log

The public legal surface now includes:

- `/terms` with adult eligibility and lawful-use language
- `/privacy` with age/eligibility data handling notes
- `/abuse` with prohibited-use, enforcement, reporting, and no-minors rules

### Hidden/Internal Surfaces

The codebase still contains suppression models, APIs, and UI components, but suppression management is not part of the active operator navigation anymore.

Current behavior:

- `/suppressions` redirects to `/workspace`
- suppression data and APIs still exist in the backend
- provider events and invalid-recipient handling can still feed suppression data internally

## Typical Operator Flow

```mermaid
flowchart LR
    A["Sign up or sign in"] --> B["Confirm 18+ eligibility and accept policies"]
    B --> C["Upload CSV/XLSX"]
    C --> D["Review columns and template fields"]
    D --> E["Use Finder for missing emails if needed"]
    E --> F["Write template in plain text, HTML, or JSON"]
    F --> G["Connect Gmail sender with Google OAuth"]
    G --> H["Create and validate sequence, attach resumes/files"]
    H --> I["Launch now / once / recurring"]
    I --> J["Track run progress in Overview and sequence detail"]
    J --> K["Watch recipients, opens, replies, retries, and failures"]
    C -. import file stored .-> S["Object storage: local uploads or Cloudflare R2"]
    H -. attachments stored .-> S
    I -. attachments read at send time .-> S
```

## What Feels Different In The Current App

- One calm operator surface instead of separate list, finder, sender, and launch tools.
- Gmail-based sending stays central to the current product story.
- Overview cards refresh while launches are active, so recent sequence progress does not depend on a manual reload.
- Replies are matched back from connected Gmail accounts and surfaced on sequence detail pages.
- Plain-text templates now behave more like real email composition, including paragraph, ordered-list, and unordered-list handling.
- Finder is a main workflow surface, not an afterthought.
- Eligibility, policy acceptance, and anti-abuse enforcement are now part of the core onboarding and access-control path.

## Notable Current Behaviors

### Sending and tracking

- Gmail sending currently goes through connected Google OAuth sender profiles.
- The send pipeline appends an open-tracking pixel to rendered HTML email output.
- Open and click tracking routes still exist in the app.
- Unsubscribe and suppression plumbing still exists in the codebase, but the operator-facing suppression dashboard is hidden from the active app flow.

### Eligibility, policy acceptance, and account restrictions

- Non-admin users must complete `/verify-eligibility` before entering the app shell.
- Verification records `adultVerifiedAt`, `termsAcceptedAt`, `privacyAcceptedAt`, `antiAbuseAcceptedAt`, `policyVersion`, and `ageGateVersion` on the `User`.
- Users who select "I am not eligible" are marked with `eligibilityBlockedAt` and `eligibilityBlockedReason = "self_reported_underage"`.
- `requireApiUser()` denies API access when the account is globally API-disabled, blocked for ineligibility, restricted by an admin, or missing policy confirmation.
- Capability-specific API gates still apply for imports, templates, campaign launches, and AI enhancement.
- Admins can restrict or unrestrict non-admin users through `PATCH /api/admin/users/[id]` using `action: "restrict"` or `action: "unrestrict"`.
- Admin accounts and the acting admin's own account are protected from restriction/deletion flows in the dashboard APIs.
- Restricted accounts store `restrictedAt` and `restrictedReason`; admin, restriction, unrestriction, and policy-acceptance actions are audit logged.
- The database migration `20260612235800_user_compliance_fields` adds the compliance and restriction columns required by Prisma and the auth flow.

### Gmail daily send safety limit

Sendloom stops sending before Gmail starts rejecting. Each successful Gmail send is
recorded in the `SendLedger` table; before every send attempt the worker checks the
rolling 24-hour count for that sender and blocks if the safety cap is hit.

- **Default cap**: 450 successful sends per rolling 24 hours.
- **Override**: set `GMAIL_DAILY_SEND_SAFETY_LIMIT` in your environment (e.g. `GMAIL_DAILY_SEND_SAFETY_LIMIT=450`). Missing or invalid values fall back to 450.
- **Scope**: tracked per connected Gmail sender (`SenderProfile`), because Gmail's
  quota is per-mailbox. A user-level rollup is also surfaced on the Overview page.
- **Rolling window**, not midnight reset: the system looks at the last 24 hours from
  now. `resetAt` is the oldest counted successful send + 24 hours — at that moment
  enough capacity frees up for sending to resume.
- **What counts**: confirmed Gmail sends (initial and follow-up) recorded via
  `recordSendOnLedger`. Failed sends, retry attempts that failed, suppressed,
  invalid, or skipped recipients are **not** counted.

### Gmail send pacing (large sequences)

The daily safety cap above protects the rolling 24h volume; pacing protects the
per-minute rate. The two are **separate and both enforced** — pacing only
delays/requeues jobs, it never changes how the rolling 24h cap is counted. Gmail's
anti-abuse limiter trips well below the API's documented per-second quota, so each
connected sender is paced independently:

- **Rate**: `GMAIL_SENDS_PER_MINUTE` (default `3`) — Sendloom sends at most this
  many Gmail emails **per minute per connected sender** (`SenderProfile`). Enforced
  by an atomic Redis per-minute window (`gmail-send-rate:sender:<id>`) so concurrent
  workers/processes can never over-send. Missing/invalid values fall back to 3.
- **Shared across parallel sequences**: every active sequence for the same sender
  shares that sender's 3/min window. Different senders get their own independent
  windows (sender A sending does not slow sender B).
- **Fair scheduling**: when several sequences for one sender compete, the scheduler
  splits the window round-robin (≈1 send per sequence per minute at 3/min with 3
  active sequences) and rotates which sequence goes first, so no sequence starves.
- **Waiting, not failing**: when the per-minute window is full, the recipient stays
  queued with a future `nextRetryAt` and a `GMAIL_SENDER_PACING` marker (shown as
  "Queued / waiting for the send window"). Gmail is **not** called, `retryCount` is
  **not** incremented, and the job is **never** marked failed or permanent — it
  simply sends in the next window.
- **Concurrency**: `GMAIL_SENDER_CONCURRENCY` (default `2`) — caps simultaneous
  worker sends so a single mailbox never bursts concurrent requests. Concurrency
  never bypasses pacing: the per-sender window gate is atomic.
- **On throttle**: even with pacing, Gmail may occasionally return a rate/quota/
  temporary error (HTTP 429/5xx, `userRateLimitExceeded`, `quotaExceeded`,
  `Backend Error`, "try again later", etc.). It is classified as retryable — the
  recipient is retried with backoff or the run is paused, **never** marked as a
  permanent recipient rejection. The real provider code/reason/status is stored in
  the recipient job's diagnostic metadata (never tokens or message bodies).

This dramatically reduces Gmail throttling on large sequences and protects sender
reputation, but does not guarantee Gmail will never rate-limit.

> Earlier builds used 120/min, then 30/min — both still let large sequences
> (100+ recipients) trip Gmail's rate limiter partway through. 3/min keeps a single
> mailbox far under the limit. Raise `GMAIL_SENDS_PER_MINUTE` only if you have
> verified headroom for the sending mailbox.
- **Blocking behavior**: when the cap is hit during a send, the affected
  `CampaignRun` is set to `PAUSED` with `progressSnapshot.pauseReason = "DAILY_SEND_LIMIT"`
  and `pauseResumesAt = <resetAt ISO>`. The in-flight recipient job stays `PENDING`
  (not `FAILED`) so it picks up automatically on resume.
- **Auto-resume**: `processPendingCampaignWork` (run on every Overview render and
  every scheduler tick) calls `resumeCampaignRunsBlockedByDailyLimit`, which releases
  any run whose `pauseResumesAt` has passed. Manual pauses are left alone — they
  carry no `DAILY_SEND_LIMIT` reason.
- **Concurrency safety**: a Redis sorted-set + Lua script reserves capacity
  atomically before the Gmail call, so the 10 worker fibers cannot collectively
  blow past the cap. The DB ledger remains the source of truth; Redis only
  guards the race window between "decide to send" and "ledger write".
- **UI surfaces**: Overview has a dedicated send-window card (per sender);
  blocked sequences show "Paused by Gmail safety limit · resumes …" on the row
  and a compact alert on the sequence detail page. No recipient is marked
  "Failed/Permanent" because of the safety limit.

### Replies

- Reply counts are part of the sequence detail view.
- Reply syncing is tied to connected Gmail senders.
- The cron flow also syncs replies when it processes campaign work.

### Template rendering

- Plain text supports pasted email body structure better than before.
- Blank lines become paragraphs.
- Lines starting with `-`, `*`, or `•` render as bullet lists.
- Lines starting with `1.`, `2.`, `3.` or `1)` render as ordered lists.

### Sequence monitoring

- Overview cards show processed-recipient progress and refresh while a run is live.
- Sequence detail pages show recipient activity, replies, delivered totals, and attention states.

## Architecture Overview

```mermaid
flowchart TD
    UI["Next.js App Router UI"] --> API["Route handlers in src/app/api"]
    UI --> SSR["Server-rendered product pages"]
    API --> Services["Business logic in src/services"]
    SSR --> Services
    Services --> Lib["Shared helpers in src/lib"]
    Services --> Prisma["Prisma ORM"]
    Prisma --> Postgres["PostgreSQL"]
    Services --> Redis["Redis"]
    Redis --> Workers["BullMQ workers and scheduler"]
    Services --> Storage["Object storage helper (src/lib/storage.ts)"]
    Storage --> Local["Local uploads directory (development)"]
    Storage --> R2["Cloudflare R2 S3-compatible API (production)"]
    R2 --> R2Imports["Imports bucket: CSV/XLSX files"]
    R2 --> R2Attach["Attachments bucket: resumes and sequence files"]
    Services --> Google["Google OAuth + Gmail send/reply sync"]
    Services --> Hunter["Hunter API"]
    Services --> OpenAI["OpenAI Responses API"]
    Cron["/api/cron/campaigns"] --> Services
```

### Runtime shape

- **Frontend:** Next.js App Router + React
- **API:** route handlers in `src/app/api`
- **Domain logic:** `src/services`
- **Shared infrastructure/domain helpers:** `src/lib`
- **Persistence:** Prisma + PostgreSQL
- **Rate limiting and queueing:** Redis + BullMQ
- **Object storage:** Local uploads in development or Cloudflare R2 in production
- **Email transport:** Gmail OAuth through Nodemailer
- **Enrichment:** Hunter
- **AI assistance:** OpenAI Responses API

## Sequence Diagrams

These diagrams trace the main flows the app performs, from the browser through the API routes, services, and external systems.

### Sign up and log in

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant API as /api/auth/signup or /login
    participant RL as Redis (rate limit)
    participant DB as PostgreSQL
    User->>UI: Enter email and password
    UI->>API: POST credentials
    API->>RL: rateLimit(ip / email)
    RL-->>API: allowed
    API->>DB: find or create User (bcrypt hash)
    DB-->>API: user record
    API->>UI: Set signed session cookie (JWT)
    UI-->>User: Redirect to /verify-eligibility, /workspace, or /admin
```

### Confirm eligibility and policies

```mermaid
sequenceDiagram
    actor User
    participant UI as /verify-eligibility
    participant Verify as /api/auth/verify-eligibility
    participant Block as /api/auth/report-ineligible
    participant DB as PostgreSQL
    participant Audit as AuditLog
    User->>UI: Confirm adult eligibility and policy acceptance
    alt Eligible adult user
        UI->>Verify: POST confirmations + CSRF token
        Verify->>DB: Set adult/policy timestamps and versions
        Verify->>Audit: Record compliance.policy_accepted
        Verify-->>UI: success
        UI-->>User: Redirect to /workspace
    else User reports under 18
        UI->>Block: POST self-reported ineligibility
        Block->>DB: Set eligibilityBlockedAt and reason
        Block->>Audit: Record compliance.eligibility_blocked
        Block-->>UI: blocked
        UI-->>User: Show access unavailable state
    end
```

### Connect a Gmail sender (Google OAuth)

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant Connect as /api/auth/google/connect
    participant Google as Google OAuth
    participant CB as /api/auth/google/callback
    participant DB as PostgreSQL
    User->>UI: Click "Connect Gmail"
    UI->>Connect: GET connect route
    Connect-->>UI: Redirect to Google consent (state cookie set)
    UI->>Google: Approve Gmail send + profile scopes
    Google-->>CB: Redirect with code and state
    CB->>CB: Verify state cookie matches
    CB->>Google: Exchange code for tokens
    Google-->>CB: Access token and refresh token
    CB->>Google: Fetch Google profile
    CB->>DB: Upsert SenderProfile with refresh token
    CB-->>UI: Redirect back with gmail=connected
```

### Import a CSV/XLSX audience

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant API as POST /api/imports
    participant Svc as createImport()
    participant Parse as parseSpreadsheet()
    participant Store as Object storage (local dir / R2 imports bucket)
    participant DB as PostgreSQL
    User->>UI: Choose a CSV or XLSX file
    UI->>API: multipart/form-data upload
    API->>Svc: createImport(file, userId)
    Svc->>Parse: Parse columns and rows
    Parse-->>Svc: columns, rows, sample rows
    Svc->>Store: uploadObject(imports bucket, scoped key)
    Store-->>Svc: storage key
    Svc->>DB: Create Import + ImportColumn/Row + Mapping
    DB-->>Svc: import record
    Svc-->>UI: Import id and detected columns
```

### Find a missing email (Finder)

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant API as POST /api/email-finder
    participant DB as PostgreSQL
    participant Hunter as Hunter API
    User->>UI: Enter first name, last name, company domain
    UI->>API: POST lookup request
    API->>DB: Get the user's decrypted Hunter API key
    DB-->>API: API key
    API->>Hunter: findHunterEmail(name, domain)
    Hunter-->>API: Candidate emails and confidence
    API-->>UI: Results
```

### Write a template with AI assistance

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant API as POST /api/templates/enhance
    participant OpenAI as OpenAI Responses API
    User->>UI: Click "Enhance with AI" on subject or body
    UI->>API: POST field type, current text, context
    API->>API: Rate limit and build prompt
    API->>OpenAI: POST /v1/responses
    OpenAI-->>API: Rewritten subject or body
    API->>API: Validate template body format
    API-->>UI: Enhanced text
    UI-->>User: Updated copy in the editor
```

### Create a sequence with attachments

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant API as POST /api/campaigns
    participant Store as Object storage (local dir / R2 attachments bucket)
    participant Svc as createCampaignDraft()
    participant DB as PostgreSQL
    User->>UI: Pick import, mapping, template, sender, then attach resumes/files
    UI->>API: multipart form (fields + attachment files)
    API->>API: Validate auth and attachment size limits
    loop Each attachment
        API->>Store: uploadObject(attachments bucket, scoped key)
        Store-->>API: storage key
    end
    API->>Svc: createCampaignDraft(payload + attachment keys)
    Svc->>DB: Create Campaign (templateSnapshot stores attachment keys)
    DB-->>Svc: campaign
    Svc-->>UI: Campaign id
```

### Launch a sequence and send email

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant API as POST /api/campaigns/[id]/launch
    participant Svc as launchCampaign()
    participant Proc as processPendingCampaignWork()
    participant DB as PostgreSQL
    participant Store as Object storage (local dir / R2 attachments bucket)
    participant Gmail as Gmail API
    User->>UI: Click Launch
    UI->>API: POST launch
    API->>Svc: launchCampaign(id, userId)
    Svc->>DB: Validate campaign, create CampaignRun + RecipientJobs
    DB-->>Svc: run
    API-->>UI: Run accepted
    Note over API,Proc: Work continues in the background via after()
    Proc->>DB: Load pending RecipientJobs
    loop Each recipient
        Proc->>Store: getObjectBuffer(attachment keys)
        Store-->>Proc: Attachment bytes
        Proc->>Gmail: Send rendered email + attachments
        Gmail-->>Proc: Message id
        Proc->>DB: Update RecipientJob (SENT / FAILED)
    end
```

### Download a sequence attachment

```mermaid
sequenceDiagram
    actor User
    participant UI as Browser
    participant API as GET /api/campaigns/[id]/attachments/[index]
    participant DB as PostgreSQL
    participant Store as Object storage (local dir / R2 attachments bucket)
    User->>UI: Click an attachment on the sequence detail page
    UI->>API: GET attachment route
    API->>API: requireApiUser (session check)
    API->>DB: Find Campaign where id AND userId (ownership check)
    DB-->>API: campaign or none
    alt Not the owner / not found
        API-->>UI: 404 Not found
    else Owner
        API->>Store: getObjectBuffer(attachments bucket, key)
        Store-->>API: File bytes
        API-->>UI: File stream with Content-Disposition
    end
```

### Track an email open

```mermaid
sequenceDiagram
    actor Recipient
    participant Inbox as Email client
    participant API as GET /track/open/[token]
    participant DB as PostgreSQL
    Recipient->>Inbox: Open the email
    Inbox->>API: Request the tracking pixel
    API->>API: verifyTrackingToken(token)
    API->>DB: Update RecipientJob status = OPENED
    API-->>Inbox: 1x1 transparent GIF
```

### Scheduled processing and reply sync (cron)

```mermaid
sequenceDiagram
    participant Cron as Vercel Cron
    participant API as /api/cron/campaigns
    participant Proc as processPendingCampaignWork()
    participant Replies as syncConnectedSenderReplies()
    participant DB as PostgreSQL
    participant Gmail as Gmail API
    Cron->>API: GET /api/cron/campaigns (CRON_SECRET)
    API->>API: Authorize the cron secret
    API->>Proc: Advance due and scheduled campaign work
    Proc->>DB: Process scheduled runs and recipient jobs
    Proc->>Gmail: Send any pending emails
    API->>Replies: syncConnectedSenderReplies()
    Replies->>Gmail: Fetch new replies per connected sender
    Replies->>DB: Store InboundReply records
    API-->>Cron: Summary of runs, jobs, and replies
```

## Tech Stack

| Layer | Technology | Why it is here |
| --- | --- | --- |
| Web app | Next.js 15 + React 19 | App Router pages, SSR, and route handlers |
| Language | TypeScript | Shared types and logic across UI and backend |
| Database | PostgreSQL + Prisma | Campaign, import, template, sender, reply, and tracking data |
| Queueing | Redis + BullMQ | Rate-window support and background processing hooks |
| Auth | JWT session cookie + bcrypt + Google OAuth | Local auth plus Google login/sender connection |
| Sending | Nodemailer + Gmail OAuth2 | Send from connected Gmail accounts |
| AI | OpenAI Responses API | Subject/body enhancement and spam cleanup |
| Enrichment | Hunter API | Finder and domain search |
| File ingest | `xlsx` + CSV parsing | Spreadsheet upload and normalization |
| File/object storage | Local filesystem (development) or Cloudflare R2 (production) | Stores import spreadsheets and sequence attachments/resumes |
| Tests | Vitest | Library-level regression coverage |

## Main Routes

### Public routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/signup` | Account creation |
| `/login` | Sign in |
| `/faq` | Frequently asked questions |
| `/privacy` | Privacy page |
| `/terms` | Terms page |
| `/abuse` | Anti-Abuse Policy |
| `/track/open/[token]` | Open tracking pixel |
| `/track/click/[token]` | Click tracking redirect |
| `/unsubscribe/[token]` | Legacy unsubscribe/compliance route |

### Authenticated routes

| Route | Purpose |
| --- | --- |
| `/workspace` | Overview dashboard / operator command center |
| `/finder` | Finder and domain search |
| `/imports` | Audience upload and mapping workflow |
| `/templates` | Template editor and preview workspace |
| `/campaigns` | Main sequence list and builder |
| `/campaigns/[id]` | Sequence detail, setup, monitoring, and launch controls |
| `/verify-eligibility` | Adult eligibility, terms/privacy, and anti-abuse confirmation gate |
| `/sequences` | Redirect alias to `/campaigns` |
| `/sequences/[id]` | Alias for sequence detail |
| `/admin` | Admin overview — metrics, user-status chart, and health strip |
| `/admin/users` | User management — searchable table and per-user inspector panel |
| `/admin/restrictions` | Restrictions — per-user access control picker and panel |
| `/admin/system-health` | System health — live runtime check cards with Recheck button |
| `/suppressions` | Redirects to `/workspace` |

## API Surface

### Authentication

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/google/login`
- `GET /api/auth/google/login/callback`
- `GET /api/auth/google/connect`
- `GET /api/auth/google/callback`
- `GET /api/auth/eligibility-status`
- `POST /api/auth/verify-eligibility`
- `POST /api/auth/report-ineligible`

### Imports

- `POST /api/imports`
- `PATCH /api/imports/[id]`
- `DELETE /api/imports/[id]`
- `GET /api/imports/[id]/columns`
- `POST /api/imports/[id]/mapping`
- `POST /api/imports/[id]/template-fields`

### Templates

- `GET /api/templates`
- `POST /api/templates`
- `POST /api/templates/enhance`

### Sequences / campaigns

- `POST /api/campaigns`
- `PATCH /api/campaigns/[id]`
- `DELETE /api/campaigns/[id]`
- `POST /api/campaigns/[id]/validate`
- `POST /api/campaigns/[id]/launch`
- `GET /api/campaigns/[id]/status`
- `GET /api/campaigns/[id]/attachments/[attachmentIndex]`

### Finder

- `POST /api/email-finder`
- `POST /api/domain-search`
- `GET /api/domain-search/[id]`
- `POST /api/save-api-key`

### Background processing and webhooks

- `POST /api/send`
- `GET /api/cron/campaigns`
- `POST /api/cron/campaigns`
- `POST /api/webhooks/resend`

### Health

- `GET /api/health`

### Admin

- `GET /api/admin/users`
- `PATCH /api/admin/users/[id]` — updates per-user controls, restricts, or unrestricts users
- `DELETE /api/admin/users/[id]`
- `GET /api/admin/system-health`

### Legacy/internal suppressions surface

- `GET /api/suppressions`
- `POST /api/suppressions`
- `DELETE /api/suppressions/[id]`

## Data Model Summary

| Model | Purpose |
| --- | --- |
| `User` | Operator/admin account plus auth state, policy acceptance timestamps, eligibility blocks, and per-user restrictions/settings |
| `SenderProfile` | Connected Gmail sender identity |
| `Import` | Uploaded spreadsheet metadata |
| `ImportColumn` | Normalized column definitions |
| `ImportRow` | Row-level imported audience data |
| `Mapping` | Import-to-template field mapping |
| `Template` | Subject/body, format, preview payload, and variable manifest |
| `Campaign` | Sequence definition tying import, mapping, template, sender, and schedule together |
| `CampaignRun` | A specific execution of a sequence |
| `RecipientJob` | Per-recipient delivery state, retry/error metadata, and provider references |
| `InboundReply` | Reply records matched back to sent outreach |
| `ProviderEvent` | Normalized provider webhook event data |
| `Suppression` | Legacy/internal suppression records |
| `RateLimitWindow` | Per-user send guardrails |
| `AuditLog` | Admin and operational audit records |
| `HunterDomainSearch` | Stored Finder domain search history |

## Repository Guide

```text
.
├── .nvmrc
├── README.md
├── next.config.mjs
├── package.json
├── prisma
│   ├── migrations
│   └── schema.prisma
├── src
│   ├── app
│   │   ├── (app)
│   │   │   ├── admin
│   │   │   │   ├── restrictions
│   │   │   │   ├── system-health
│   │   │   │   ├── users
│   │   │   │   ├── admin-workspace.tsx
│   │   │   │   ├── page.module.css
│   │   │   │   └── page.tsx
│   │   │   ├── campaigns
│   │   │   ├── finder
│   │   │   ├── imports
│   │   │   ├── sequences
│   │   │   ├── suppressions
│   │   │   ├── templates
│   │   │   └── workspace
│   │   ├── api
│   │   ├── abuse
│   │   ├── faq
│   │   ├── login
│   │   ├── signup
│   │   ├── track
│   │   ├── unsubscribe
│   │   ├── privacy
│   │   ├── terms
│   │   └── verify-eligibility
│   ├── components
│   │   ├── dashboard
│   │   ├── suppressions
│   │   ├── campaign-builder.tsx
│   │   ├── hunter-dashboard.tsx
│   │   ├── mapping-library.tsx
│   │   └── templates-workspace.tsx
│   ├── lib
│   ├── services
│   └── workers
├── uploads
├── tsconfig.json
└── vitest.config.ts
```

### Important directories

- `src/app/page.tsx`: marketing landing page
- `src/app/verify-eligibility`: adult eligibility and policy confirmation screen
- `src/app/abuse/page.tsx`: Anti-Abuse Policy page
- `src/app/api/auth/verify-eligibility/route.ts`: records adult, terms, privacy, and anti-abuse acceptance
- `src/app/api/auth/report-ineligible/route.ts`: records self-reported under-18/ineligible accounts
- `src/app/api/auth/eligibility-status/route.ts`: returns verification, blocked, restricted, and policy status
- `src/app/(app)/workspace`: overview dashboard
- `src/app/(app)/campaigns`: active sequence list and detail surface
- `src/app/(app)/templates`: template workspace
- `src/app/(app)/finder`: Finder workspace
- `src/app/(app)/imports`: import/mapping workflow
- `src/app/(app)/admin/admin-workspace.tsx`: all admin client components — `AdminOverviewSection`, `AdminUsersSection`, `AdminRestrictionsSection`, `AdminSystemHealthSection`
- `src/app/(app)/admin/page.tsx`: admin overview page (server component, fetches metrics)
- `src/app/(app)/admin/users/page.tsx`: user management page
- `src/app/(app)/admin/restrictions/page.tsx`: restrictions management page
- `src/app/(app)/admin/system-health/page.tsx`: system health page
- `src/components/nav.tsx`: app sidebar — shows admin sub-navigation when `isAdmin=true`
- `src/components/dashboard`: overview cards, activity, and sequence panels
- `src/lib/templates.ts`: template parsing, rendering, and preview logic
- `src/services/campaigns.ts`: sequence launch and processing logic
- `src/services/replies.ts`: Gmail reply sync and matching
- `src/services/hunter-keys.ts`: Hunter key storage
- `src/services/hunter-domain-searches.ts`: Finder history layer
- `prisma/migrations/20260612235800_user_compliance_fields`: adds the user compliance and restriction columns used by the eligibility/admin flows

## Environment Variables

Create a local `.env` file at the repo root with the values below. Secrets and sample env files are intentionally not committed to the repo.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Prisma/PostgreSQL connection |
| `DATABASE_URL_UNPOOLED` | Recommended | Direct Prisma connection for migrations |
| `REDIS_URL` | Yes | Redis/BullMQ/rate-limit backend |
| `SESSION_SECRET` | Yes | JWT signing for session cookies ONLY. Must NOT be reused for any other purpose. |
| `TRACKING_SECRET` | Required in production | JWT signing for open/click/unsubscribe tracking tokens. Must be different from `SESSION_SECRET` — tracking tokens are sent in every email and are not secret. |
| `MAIL_PROVIDER` | Yes | Mail backend selector, typically `gmail` |
| `GOOGLE_CLIENT_ID` | For Google auth | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | For Google auth | Google OAuth client secret |
| `OPENAI_API_KEY` | Optional | AI enhancement and spam cleanup |
| `HUNTER_KEY_ENCRYPTION_SECRET` | Required in production | Encrypts stored Hunter API keys. Must NOT be the same as `SESSION_SECRET`. |
| `CRON_SECRET` | Required in production | Protects `/api/cron/campaigns`. With this unset, the cron route fails closed in production. |
| `RESEND_WEBHOOK_SECRET` | Required in production for Resend | HMAC secret. Webhook fails closed in production when unset. |
| `APP_BASE_URL` | Yes | Base URL used for redirects and tracking links |
| `OBJECT_STORAGE_MODE` | Yes | Storage backend: `local` for the local filesystem, `r2` for Cloudflare R2 |
| `LOCAL_UPLOAD_DIR` | Yes | Local upload destination, used when `OBJECT_STORAGE_MODE=local` |
| `CLOUDFLARE_R2_ACCOUNT_ID` | When `OBJECT_STORAGE_MODE=r2` | Cloudflare account id used for the R2 S3-compatible endpoint |
| `CLOUDFLARE_R2_IMPORTS_BUCKET` | When `OBJECT_STORAGE_MODE=r2` | R2 bucket name for import spreadsheets (CSV/XLSX) |
| `CLOUDFLARE_R2_ATTACHMENTS_BUCKET` | When `OBJECT_STORAGE_MODE=r2` | R2 bucket name for sequence attachments/resumes |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | When `OBJECT_STORAGE_MODE=r2` | R2 API access key id (server-side only) |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | When `OBJECT_STORAGE_MODE=r2` | R2 API secret access key (server-side only) |
| `CLOUDFLARE_R2_PUBLIC_BASE_URL` | Optional | Public base URL for a bucket; only set if objects are served publicly |
| `DEFAULT_FROM_EMAIL` | Optional | Default sender metadata |
| `DEFAULT_FROM_NAME` | Optional | Default sender display name |
| `ADMIN_EMAIL` | Optional | Bootstrap admin email |
| `ADMIN_PASSWORD` | Optional | Bootstrap admin password |
| `RESEND_API_KEY` | Optional | Reserved for provider/webhook expansion |
| `GMAIL_DAILY_SEND_SAFETY_LIMIT` | Optional | Successful Gmail sends allowed per sender per rolling 24h. Defaults to `450`. |
| `GMAIL_SENDS_PER_MINUTE` | Optional | Max Gmail sends per minute **per connected sender**. Defaults to `3`. Parallel sequences for the same sender share this window; it is separate from the rolling 24h daily cap. Keep this conservative — Gmail throttles sustained API sends well below its documented per-second quota, and a higher value can mass-fail large sequences. |
| `GMAIL_SENDER_CONCURRENCY` | Optional | Max simultaneous Gmail sends the worker runs. Defaults to `2`. Prevents bursts of concurrent requests from one mailbox. |

### Security deployment notes

- Generate each secret with `openssl rand -hex 32`.
- Deploy Prisma migration `20260612235800_user_compliance_fields` before serving the age-safety build; without it Prisma will query missing `User` columns such as `adultVerifiedAt`.
- **Rotate `SESSION_SECRET` after deploying this release.** Tracking tokens that were issued in older releases were signed with `SESSION_SECRET`; rotating it invalidates any leaked tracking tokens that could have been replayed as session cookies.
- Set `TRACKING_SECRET` to a separate value from `SESSION_SECRET` before issuing the first new tracking link.
- Set `CRON_SECRET` before deploying to production — the cron route refuses to run without it.
- Set `HUNTER_KEY_ENCRYPTION_SECRET` before any user saves their first Hunter API key, otherwise existing keys cannot be decrypted after a future rotation.
- Confirm response security headers are returned by the deployed host (HSTS, CSP, X-Frame-Options, etc. are emitted by `next.config.mjs`).
- Admin privileges are sourced from the DB `users.isAdmin` flag only. Use `ADMIN_EMAIL` + `ADMIN_PASSWORD` to bootstrap the first admin via the seed; later changes must go through DB-level updates.

## Local Development

### Prerequisites

- Node.js `20.x`
- npm `10+`
- PostgreSQL
- Redis

### Setup

```bash
npm install
# create a local .env using the variables listed above
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

The Node version is pinned in `.nvmrc` (`20`).

### Useful extra processes

```bash
npm run worker
npm run scheduler
```

### Tests

Vitest covers the `src/lib` regression surface (auth, scheduling, templates, validation, retry policy, spam analysis, and friends).

```bash
npm test            # one-shot run
npm run test:watch  # watch mode
```

### Notes

- The app can process campaign work inline during launches and status refreshes, so local development still works even without a fully separate worker setup.
- `/api/cron/campaigns` can also advance pending campaign work and trigger reply sync.
- Uploads default to the local `uploads/` directory. With `OBJECT_STORAGE_MODE=local`, import spreadsheets and sequence attachments are written under `LOCAL_UPLOAD_DIR`.
- Production deployments (for example on Vercel) can set `OBJECT_STORAGE_MODE=r2` to store the same files in Cloudflare R2 instead. Existing local upload records keep working in either mode.
- Linting is configured through `next lint`. Type checks run via `npx tsc --noEmit`.

## Cloudflare R2 Object Storage

Sendloom can store import spreadsheets and sequence attachments/resumes in Cloudflare R2 instead of the local filesystem. R2 is recommended for production and Vercel deployments, where the local filesystem is ephemeral. All R2 access happens server-side; credentials are never exposed to the browser.

Two separate R2 buckets are used so import spreadsheets and sequence attachments are kept apart:

- **Imports bucket** — CSV/XLSX files uploaded through the import workflow.
- **Attachments bucket** — resume/attachment files uploaded for sequences.

Local development continues to use the local filesystem with `OBJECT_STORAGE_MODE=local`.

### Setup steps

1. **Create two R2 buckets.** In the Cloudflare dashboard, open **R2** and create one bucket for import spreadsheets and another for sequence attachments (for example, `sendloom-imports` and `sendloom-attachments`).
2. **Create an R2 API token.** Under **R2 → Manage R2 API Tokens**, create a token with object read/write permissions for both buckets. Note the **Access Key ID** and **Secret Access Key**.
3. **Set the environment variables** (in Vercel project settings, or your hosting environment):
   - `OBJECT_STORAGE_MODE=r2`
   - `CLOUDFLARE_R2_ACCOUNT_ID` — your Cloudflare account id
   - `CLOUDFLARE_R2_IMPORTS_BUCKET` — the bucket name for import spreadsheets
   - `CLOUDFLARE_R2_ATTACHMENTS_BUCKET` — the bucket name for sequence attachments
   - `CLOUDFLARE_R2_ACCESS_KEY_ID` — the token's access key id
   - `CLOUDFLARE_R2_SECRET_ACCESS_KEY` — the token's secret access key
   - `CLOUDFLARE_R2_PUBLIC_BASE_URL` — optional; only set if a bucket is served publicly
4. **Deploy.** Sendloom uses Cloudflare's S3-compatible endpoint (`https://<account-id>.r2.cloudflarestorage.com`, region `auto`). When `OBJECT_STORAGE_MODE=r2`, the five required `CLOUDFLARE_R2_*` variables (account id, both bucket names, access key id, and secret) must be present or the server will fail fast on startup.

Attachments are still downloaded through the authenticated `/api/campaigns/[id]/attachments/[attachmentIndex]` route, so ownership checks remain in force regardless of storage mode.
