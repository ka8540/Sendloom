import type { Metadata } from "next";
import { Fragment, type CSSProperties } from "react";
import { Check } from "lucide-react";
import Link from "next/link";

import { BrandText } from "@/components/brand-text";
import { LandingCommandCenter } from "@/components/landing-command-center";
import { LandingHeroFlow } from "@/components/landing-hero-flow";
import { LandingMotion } from "@/components/landing-motion";
import { LandingNav } from "@/components/landing-nav";
import { LandingPointerFX } from "@/components/landing-pointer-fx";
import { integrations } from "@/components/marketing/integration-marks";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { SendloomLogo } from "@/components/sendloom-logo";
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
 *   1. Layout families do not repeat. Hero (split copy/visual), integration strip
 *      (inline row), chapter 01 (sticky-scroll story), chapter 02 (offset split),
 *      chapter 03 (full-bleed visual), safety (two-column list), CTA (panel).
 *      Seven sections, seven distinct compositions.
 *   2. Exactly three chapter labels exist on the page. They are the only
 *      small-caps labels above headlines; the hero deliberately has none.
 */

/* The site answers on both the apex and the www host, so the home page names
   one of them as canonical rather than letting the two compete as duplicates.
   Resolved against the metadataBase set in the root layout. */
export const metadata: Metadata = {
  alternates: {
    canonical: "/"
  }
};

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
 * Feature cells carry no CTA of their own. Every one of them would have
 * pointed at /signup, and three different labels for a single destination is
 * duplicate intent dressed up as variety. The page has one primary action,
 * worded identically in the hero and the closing panel.
 */
/*
 * Data chapter stories. DOM order is the mobile/screen-reader order:
 * headline, then each story's copy immediately followed by its product
 * visual. On desktop with motion allowed, LandingMotion sets
 * [data-story="enhanced"] and CSS overlaps the three copies into one cell
 * and the three visuals into a second sticky column.
 */
const dataStories = [
  {
    index: "01",
    title: "Imports",
    body: "Upload a CSV or XLSX, map your fields once, and keep every column intact for the sends that follow.",
    meta: "CSV, XLSX, field mapping"
  },
  {
    index: "02",
    title: "Discover",
    body: "Search by company, role, and location, then review inferred work contacts before they enter a run.",
    meta: "Company, role, location"
  },
  {
    index: "03",
    title: "Email enrichment",
    body: "Run name-plus-domain and domain-wide lookups with your own Hunter API key without leaving the workspace.",
    meta: "Bring your own API key"
  }
] as const;

/* Stagger helper for the product visuals: each revealed element carries its
   transition delay as a custom property so no per-item classes are needed.
   Scaled down so a freshly activated card finishes revealing quickly. */
const delay = (seconds: number) => ({ "--d": `${seconds * 0.7}s` }) as CSSProperties;

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

  /* The three product visuals for the Data chapter, in story order. Rendered
     as static markup; LandingMotion deals them as a deck on desktop. All
     names and companies are fictional. */
  const dataVisuals = [
    <article key="imports" className={styles.dataCard} data-story-card aria-label="Imports: mapping a CSV to contact fields">
      <div className={styles.winBar}>
        <SendloomLogo className={styles.winMark} />
        <span className={styles.winTitle}>Imports</span>
        <span className={styles.winMeta}>your_list.csv</span>
      </div>
      <div className={styles.winBody}>
        <div className={`${styles.winIntro} ${styles.rv}`} style={delay(0.05)}>
          <div>
            <p className={styles.winScreenTitle}>Map fields</p>
            <p className={styles.winSub}>Match your file columns to Sendloom.</p>
          </div>
          <span className={styles.winCount}>228 contacts</span>
        </div>
        <div className={`${styles.winHead} ${styles.rv}`} style={delay(0.14)}>
          <span>CSV column</span>
          <span>Sendloom field</span>
          <span aria-hidden="true" />
        </div>
        {[
          ["first_name", "First Name"],
          ["last_name", "Last Name"],
          ["email", "Email"],
          ["company", "Company"],
          ["location", "Location"]
        ].map(([column, field], row) => (
          <div key={column} className={`${styles.winRow} ${styles.rv}`} style={delay(0.2 + row * 0.06)}>
            <span className={styles.srcField}>{column}</span>
            <span className={styles.fieldControl}>
              {field}
              <i className={styles.chev} aria-hidden="true" />
            </span>
            <span className={styles.rowStatus}>
              <Check aria-hidden="true" />
            </span>
          </div>
        ))}
      </div>
      <div className={`${styles.winFoot} ${styles.rv}`} style={delay(0.55)}>
        <span className={styles.footOk}>
          <Check aria-hidden="true" />
          5 of 5 mapped
        </span>
        <span className={styles.chipReady}>Ready</span>
      </div>
    </article>,

    <article key="discover" className={styles.dataCard} data-story-card aria-label="Discover: searching contacts by company, role, and location">
      <div className={styles.winBar}>
        <SendloomLogo className={styles.winMark} />
        <span className={styles.winTitle}>Discover</span>
        <span className={styles.winMeta}>12 results</span>
      </div>
      <div className={styles.winBody}>
        <div className={`${styles.filterRow} ${styles.rv}`} style={delay(0.05)}>
          {[
            ["Company", "Stripe"],
            ["Role", "Software Engineer"],
            ["Location", "San Francisco"]
          ].map(([label, value]) => (
            <span key={label} className={styles.filterField}>
              <span className={styles.filterLabel}>{label}</span>
              {value}
            </span>
          ))}
        </div>
        <div className={`${styles.winHead} ${styles.headPeople} ${styles.rv}`} style={delay(0.14)}>
          <span aria-hidden="true" />
          <span>Person</span>
          <span>Role</span>
          <span className={styles.colCompany}>Company</span>
          <span className={styles.colLocation}>Location</span>
        </div>
        {[
          ["Maya Chen", "Software Engineer", "Stripe", "San Francisco", true],
          ["Ethan Miller", "Backend Engineer", "Stripe", "New York", false],
          ["Priya Shah", "Platform Engineer", "Stripe", "Seattle", false]
        ].map(([name, role, company, location, selected], row) => (
          <div
            key={name as string}
            className={
              selected
                ? `${styles.winRow} ${styles.rowPeople} ${styles.winRowSelected} ${styles.rv}`
                : `${styles.winRow} ${styles.rowPeople} ${styles.rv}`
            }
            style={delay(0.2 + row * 0.07)}
          >
            <span className={styles.selBox} aria-hidden="true">
              {selected ? <Check /> : null}
            </span>
            <span className={styles.personName}>{name}</span>
            <span className={styles.cellMuted}>{role}</span>
            <span className={`${styles.cellMuted} ${styles.colCompany}`}>{company}</span>
            <span className={`${styles.cellMuted} ${styles.colLocation}`}>{location}</span>
          </div>
        ))}
      </div>
      <div className={`${styles.winFoot} ${styles.rv}`} style={delay(0.5)}>
        <span>1 selected</span>
        <span className={styles.footAction}>Add selected to import</span>
      </div>
    </article>,

    <article key="enrichment" className={styles.dataCard} data-story-card aria-label="Email enrichment: resolving a missing address">
      <div className={styles.winBar}>
        <SendloomLogo className={styles.winMark} />
        <span className={styles.winTitle}>Email enrichment</span>
        <span className={styles.winMeta}>Hunter connected</span>
      </div>
      <div className={styles.winBody}>
        <div className={`${styles.winIntro} ${styles.rv}`} style={delay(0.05)}>
          <div>
            <p className={styles.winScreenTitle}>Work emails</p>
            <p className={styles.winSub}>Fill missing work emails.</p>
          </div>
          <span className={styles.winCount}>3 contacts</span>
        </div>
        <div className={`${styles.enrichProgress} ${styles.rv}`} style={delay(0.12)}>
          <span className={styles.enrichTrack} aria-hidden="true">
            <span className={styles.enrichFill} />
          </span>
          <span>2 of 3 resolved</span>
        </div>
        <div className={`${styles.enrichRow} ${styles.rv}`} style={delay(0.2)}>
          <span className={styles.avatar} aria-hidden="true">MC</span>
          <span className={styles.enrichWho}>
            <span className={styles.personName}>Maya Chen</span>
            <span className={styles.cellMuted}>Stripe</span>
          </span>
          <span className={styles.mailField}>maya@stripe.com</span>
          <span className={`${styles.statusChip} ${styles.statusFound}`}>Found</span>
        </div>
        <div className={`${styles.enrichRow} ${styles.rv}`} style={delay(0.27)}>
          <span className={styles.avatar} aria-hidden="true">EM</span>
          <span className={styles.enrichWho}>
            <span className={styles.personName}>Ethan Miller</span>
            <span className={styles.cellMuted}>Linear</span>
          </span>
          <span className={styles.swapCell}>
            <span className={`${styles.mailField} ${styles.mailFieldEmpty} ${styles.swapPending}`}>
              <i className={styles.searchDot} aria-hidden="true" />
              Searching
            </span>
            <span className={`${styles.mailField} ${styles.swapFound}`}>ethan@linear.com</span>
          </span>
          <span className={`${styles.swapCell} ${styles.swapStatus}`}>
            <span className={`${styles.statusChip} ${styles.statusSearching} ${styles.swapPending}`}>Searching</span>
            <span className={`${styles.statusChip} ${styles.statusFound} ${styles.swapFound}`}>Found</span>
          </span>
        </div>
        <div className={`${styles.enrichRow} ${styles.rv}`} style={delay(0.34)}>
          <span className={styles.avatar} aria-hidden="true">PS</span>
          <span className={styles.enrichWho}>
            <span className={styles.personName}>Priya Shah</span>
            <span className={styles.cellMuted}>Figma</span>
          </span>
          <span className={styles.mailField}>priya@figma.com</span>
          <span className={`${styles.statusChip} ${styles.statusFound}`}>Found</span>
        </div>
      </div>
      <div className={`${styles.winFoot} ${styles.rv}`} style={delay(0.5)}>
        <span>Hunter name + domain lookups</span>
        <span className={styles.chipReady}>Ready</span>
      </div>
    </article>
  ];

  // Anchor contract for the nav and footer. Every in-page link on the public
  // surface resolves to one of these, and they appear in document order so the
  // nav's active-section indicator advances left to right as you scroll:
  //
  //   #home          hero              nav "Home"
  //   #why-sendloom  chapter 01, Data  nav "Why Sendloom"
  //   #workflow      chapter 02, Seq.  nav "Workflow", hero "See how it works"
  //   #contact       footer            nav "Contact"
  //
  // `id="top"` stays for any saved link to the old target, and the skip link
  // in the root layout targets #main-content, hence the extra anchors.
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
      <section className={styles.hero} id="home">
        <div className={styles.heroInner}>
          {/* Words rise in one by one on load (GSAP, motion permitting);
              without JS they render as plain text. */}
          <h1 className={styles.heroHeadline}>
            <span data-hero-word>Cold</span> <span data-hero-word>outreach</span>
            <br />
            <span data-hero-word>that</span> <span data-hero-word>feels</span>
            <br />
            <em className={styles.emphasis}>
              <span data-hero-word>crafted,</span>
            </em>
            <br />
            <span data-hero-word>not</span> <span data-hero-word>sprayed.</span>
          </h1>
          <p className={styles.heroLede} data-reveal>
            Import a list, fill the missing addresses, and run a paced sequence from your own
            Gmail. One workspace, start to finish.
          </p>
          <div className={styles.heroActions} data-reveal>
            <Link className={styles.buttonPrimary} href="/signup">
              Get started for free
            </Link>
            <a className={styles.buttonGhost} href="#why-sendloom">
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
          Inline row. Real integrations, not invented customer logos. Marks are
          the vendors' own multi-colour artwork, inlined — see
          components/marketing/integration-marks. */}
      <section className={styles.strip} aria-label="Supported integrations">
        <p className={styles.stripLabel}>Works with the tools you already send from</p>
        <ul className={styles.stripList}>
          {integrations.map(({ Mark, name, slug }) => (
            <li key={slug} className={styles.stripItem}>
              <Mark className={styles.stripMark} />
              <span className={styles.stripName}>{name}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ==================== CHAPTER 01 - DATA ====================
          Sticky-scroll product story. Left: stable editorial copy with one
          active story swapping under it. Right: a deck of product visuals
          dealt through by scroll position. Without JS (or with reduced
          motion) the same DOM renders as a plain stacked section — see the
          [data-story="enhanced"] rules in the stylesheet. */}
      <section className={`${styles.chapter} ${styles.dataStory}`} id="why-sendloom" data-story>
        <div className={styles.dataStage}>
          <header className={styles.dataHead}>
            <p className={styles.chapterLabel}>
              <span className={styles.chapterIndex}>{chapters.data.index}</span>
              {chapters.data.label}
            </p>
            <h2 className={styles.chapterTitle}>
              {chapters.data.headline.lead}{" "}
              <em className={styles.emphasis}>{chapters.data.headline.emphasis}</em>
            </h2>
            <p className={styles.chapterIntro}>{chapters.data.intro}</p>
          </header>

          {/* Copy and visuals interleave so the unenhanced (mobile / no-JS /
              reduced-motion) flow reads story → demo, story → demo. The
              enhanced desktop grid lifts the steps into one left-hand cell
              and the cards into the right column. */}
          {dataStories.map((story, i) => (
            <Fragment key={story.title}>
              <div className={styles.dataStep} data-story-step>
                <p className={styles.dataStepIndex}>{story.index}</p>
                <h3 className={styles.dataStepTitle}>{story.title}</h3>
                <p className={styles.dataStepBody}>{story.body}</p>
                <p className={styles.cellMeta}>{story.meta}</p>
              </div>
              {dataVisuals[i]}
            </Fragment>
          ))}

          <div className={styles.dataProgress} aria-hidden="true">
            {dataStories.map((story) => (
              <span key={story.index} className={styles.dataProgSeg}>
                <span className={styles.dataProgFill} data-story-fill />
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ================== CHAPTER 02 - SEQUENCES ==================
          Offset split: sticky headline column, stacked feature rows.
          Target of both the nav's "Workflow" link and the hero's
          "See how it works". */}
      <section className={styles.chapter} id="workflow">
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
            <div key={point.title} className={styles.safetyFeature} data-reveal>
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
