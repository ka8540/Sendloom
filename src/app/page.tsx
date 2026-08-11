import Link from "next/link";

import { BrandText } from "@/components/brand-text";
import { LandingCommandCenter } from "@/components/landing-command-center";
import { LandingHeroFlow } from "@/components/landing-hero-flow";
import { LandingMotion } from "@/components/landing-motion";
import { LandingNav } from "@/components/landing-nav";
import { LandingPointerFX } from "@/components/landing-pointer-fx";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { redirectAuthenticatedToWorkspace } from "@/lib/auth";

import styles from "@/app/landing.module.css";

/*
 * Landing page.
 *
 * Structure follows a chaptered marketing narrative: a centred hero, an honest
 * integration strip, then three numbered chapters (Data / Sequences / Control)
 * that each open with a headline carrying one italicised emphasis phrase.
 *
 * Two deliberate constraints govern this file:
 *
 *   1. Layout families do not repeat. Hero (centred stack), integration strip
 *      (inline row), chapter 01 (asymmetric bento), chapter 02 (offset split),
 *      chapter 03 (full-bleed visual), safety (two-column list), CTA (panel).
 *      Seven sections, seven distinct compositions.
 *   2. Exactly three chapter labels exist on the page. They are the only
 *      small-caps labels above headlines; the hero deliberately has none.
 */

type Chapter = {
  index: string;
  label: string;
  /* Headline is split so the emphasis run can be italicised in the same
     family. Faux-oblique or a second font family would read as a mistake. */
  headline: { lead: string; emphasis: string; trail?: string };
  intro: string;
};

const chapters: Record<"data" | "sequences" | "control", Chapter> = {
  data: {
    index: "01",
    label: "Data",
    headline: { lead: "Find the people worth writing to.", emphasis: "In minutes." },
    intro:
      "Bring your own list or build one inside the workspace. Every row keeps its structure through import, enrichment, and the sends that follow."
  },
  sequences: {
    index: "02",
    label: "Sequences",
    headline: { lead: "Cold email that stays", emphasis: "measured", trail: "." },
    intro:
      "Write once, pair it with a sender, and let the run pace itself. Follow-ups are scheduled deliberately rather than fired off in a burst."
  },
  control: {
    index: "03",
    label: "Control",
    headline: { lead: "Know what happened.", emphasis: "And why." },
    intro:
      "Delivery, opens, clicks, replies, and retries stay attached to the run that produced them, on the same screen that launched it."
  }
};

/*
 * Integration strip.
 *
 * These are real integrations Sendloom supports, not customer logos. A
 * "trusted by" wall of invented company names on a product without public
 * customers would be a fabrication, so the strip answers a question a visitor
 * actually has: does this work with what I already use?
 *
 * Marks come from Simple Icons, which serves single-colour SVGs by slug.
 */
const integrations = [
  { slug: "gmail", name: "Gmail" },
  { slug: "google", name: "Google Workspace" },
  { slug: "googlesheets", name: "Google Sheets" },
  { slug: "microsoftexcel", name: "Microsoft Excel" },
  { slug: "googledrive", name: "Google Drive" }
] as const;

/*
 * Feature cells carry no CTA of their own. Every one of them would have
 * pointed at /signup, and three different labels for a single destination is
 * duplicate intent dressed up as variety. The page has one primary action,
 * worded identically in the hero and the closing panel.
 */
const dataFeatures = [
  {
    title: "Imports",
    body: "Upload a CSV or XLSX, map fields once, and keep every column intact for the sends that follow.",
    meta: "CSV, XLSX, field mapping"
  },
  {
    title: "Discover",
    body: "Search by company, role, and location, then review inferred work contacts before any of them enter a run.",
    meta: "Company, role, location"
  },
  {
    title: "Email enrichment",
    body: "Run name-plus-domain and domain-wide lookups with your own hunter.io key, without leaving the workspace.",
    meta: "Bring your own API key"
  }
] as const;

const sequenceFeatures = [
  {
    title: "Write it once.",
    body: "Plain text, HTML, or structured JSON, with merge variables, attachments, and inline AI help. Preview it as a real email before it goes anywhere.",
    meta: "Plain text, HTML, JSON"
  },
  {
    title: "Send from your own inbox.",
    body: "Connect Gmail or Google Workspace through OAuth and send from the mailbox your recipients already recognise, not an anonymous relay.",
    meta: "Google OAuth, sender profiles"
  },
  {
    title: "Follow up on purpose.",
    body: "Set the send window and cadence, then stop the sequence the moment a reply changes the plan.",
    meta: "Send windows, pacing guardrails"
  }
] as const;

/*
 * Safety points. Deliberately not presented as cards: these are claims about
 * how the product behaves, and a bordered box around each one would add
 * visual weight without adding meaning.
 */
const safetyPoints = [
  {
    title: "Paced by default",
    body: "Sends are spaced across each connected Gmail account to reduce throttling, with daily limits that stop a runaway run."
  },
  {
    title: "Checked before launch",
    body: "The list, sender, and template are validated together before anything leaves the workspace."
  },
  {
    title: "Failures stay visible",
    body: "Failed sends surface with their retry state instead of disappearing into a log nobody reads."
  },
  {
    title: "Bounces handled",
    body: "Hard bounces are classified and suppressed automatically so the same bad address is not tried twice."
  },
  {
    title: "Replies pause the run",
    body: "A reply can stop the remaining follow-ups for that recipient, so nobody gets chased after answering."
  },
  {
    title: "Yours to audit",
    body: "Imports, templates, senders, and runs stay in one place you can inspect at any time."
  }
] as const;

export default async function LandingPage() {
  // Send already-authenticated visitors straight to their workspace instead of
  // showing the public landing page; logged-out visitors still get the landing
  // page. See `redirectAuthenticatedToWorkspace` for the validity rules.
  await redirectAuthenticatedToWorkspace();

  // `id="top"` is the target of the nav's "Home" link, so it stays. The skip
  // link in the root layout targets #main-content, hence both anchors.
  return (
    <main id="top" className={styles.page}>
      <span id="main-content" />
      <LandingMotion />
      <LandingPointerFX />
      {/* Kept outside .frame so no animated/transformed ancestor can capture
          the fixed nav or interfere with its backdrop-filter. */}
      <LandingNav />

      {/* ============================ HERO ============================
          Four text elements only: headline, subtext, actions, micro-note.
          No eyebrow, so the three chapter labels below stay the page's
          entire budget of small-caps labels. */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.heroHeadline} data-reveal>
            Cold outreach that feels{" "}
            <em className={styles.emphasis}>crafted</em>, not sprayed.
          </h1>
          <p className={styles.heroLede} data-reveal>
            Import a list, fill the missing addresses, and run a paced sequence from your own
            Gmail. One workspace, start to finish.
          </p>
          <div className={styles.heroActions} data-reveal>
            <Link className={styles.buttonPrimary} href="/signup">
              Get started for free
            </Link>
            <a className={styles.buttonGhost} href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className={styles.heroNote} data-reveal>
            No credit card required. Connect the mailbox you already send from.
          </p>
        </div>

        <div className={styles.heroVisual} data-reveal>
          <LandingHeroFlow />
        </div>
      </section>

      {/* ====================== INTEGRATION STRIP ======================
          Inline row. Real integrations, not invented customer logos. */}
      <section className={styles.strip} aria-label="Supported integrations">
        <p className={styles.stripLabel}>Works with the tools you already send from</p>
        <ul className={styles.stripList}>
          {integrations.map((tool) => (
            <li key={tool.slug}>
              {/* Simple Icons serves a single-colour SVG per slug. currentColor
                  is not supported by the CDN, so the mark is masked instead,
                  which lets one asset work in both themes. */}
              <span
                className={styles.stripMark}
                role="img"
                aria-label={tool.name}
                style={{
                  maskImage: `url(https://cdn.simpleicons.org/${tool.slug})`,
                  WebkitMaskImage: `url(https://cdn.simpleicons.org/${tool.slug})`
                }}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* ==================== CHAPTER 01 - DATA ====================
          Asymmetric bento: three items, three cells, first spans wide. */}
      <section className={styles.chapter} id="how-it-works">
        <ChapterHead chapter={chapters.data} />

        <div className={styles.bento}>
          {dataFeatures.map((feature, i) => (
            <article
              key={feature.title}
              className={i === 0 ? `${styles.bentoCell} ${styles.bentoCellWide}` : styles.bentoCell}
              data-reveal
            >
              <h3 className={styles.cellTitle}>{feature.title}</h3>
              <p className={styles.cellBody}>{feature.body}</p>
              <p className={styles.cellMeta}>{feature.meta}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ================== CHAPTER 02 - SEQUENCES ==================
          Offset split: sticky headline column, stacked feature rows. */}
      <section className={styles.chapter}>
        <div className={styles.split}>
          <div className={styles.splitAside}>
            <ChapterHead chapter={chapters.sequences} />
          </div>

          <ol className={styles.steps}>
            {sequenceFeatures.map((feature) => (
              <li key={feature.title} className={styles.step} data-reveal>
                <h3 className={styles.stepTitle}>{feature.title}</h3>
                <p className={styles.stepBody}>{feature.body}</p>
                <p className={styles.cellMeta}>{feature.meta}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* =================== CHAPTER 03 - CONTROL ===================
          Full-bleed product visual under a centred head. */}
      <section className={styles.chapter}>
        <ChapterHead chapter={chapters.control} centered />
        <div className={styles.showcase} data-reveal>
          <LandingCommandCenter />
        </div>
      </section>

      {/* ========================== SAFETY ==========================
          Two-column definition list. No cards: these are claims, and a
          border around each would add weight without meaning. */}
      <section className={styles.safety}>
        <h2 className={styles.safetyTitle} data-reveal>
          Built for deliberate outreach.
        </h2>
        <dl className={styles.safetyGrid}>
          {safetyPoints.map((point) => (
            <div key={point.title} className={styles.safetyItem} data-reveal>
              <dt className={styles.safetyTerm}>{point.title}</dt>
              <dd className={styles.safetyBody}>{point.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ============================ CTA ============================
          Single action. The secondary "see how it works" intent already
          fired in the hero, so repeating it here would be duplicate intent. */}
      <section className={styles.closing}>
        <div className={styles.closingPanel} data-reveal>
          <h2 className={styles.closingTitle}>
            Put your own list through <BrandText>Sendloom</BrandText>.
          </h2>
          <p className={styles.closingBody}>
            Connect Gmail, import a list, write the template, and launch the sequence from a
            single login.
          </p>
          <Link className={styles.buttonPrimary} href="/signup">
            Get started for free
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}

/*
 * Chapter head. The numbered label is the page's only recurring small-caps
 * device and appears exactly three times, once per chapter.
 */
function ChapterHead({ chapter, centered = false }: { chapter: Chapter; centered?: boolean }) {
  return (
    <header
      className={centered ? `${styles.chapterHead} ${styles.chapterHeadCentered}` : styles.chapterHead}
      data-reveal
    >
      <p className={styles.chapterLabel}>
        <span className={styles.chapterIndex}>{chapter.index}</span>
        {chapter.label}
      </p>
      <h2 className={styles.chapterTitle}>
        {chapter.headline.lead} <em className={styles.emphasis}>{chapter.headline.emphasis}</em>
        {chapter.headline.trail}
      </h2>
      <p className={styles.chapterIntro}>{chapter.intro}</p>
    </header>
  );
}
