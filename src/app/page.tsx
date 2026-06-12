import {
  Activity,
  CalendarClock,
  FileSpreadsheet,
  FileText,
  Mail,
  PenLine,
  Radar,
  Search,
  Upload,
  Workflow
} from "lucide-react";
import Link from "next/link";

import { AnimatedEmailPath } from "@/components/AnimatedEmailPath";
import { BrandText, renderBrandText } from "@/components/brand-text";
import { LandingCommandCenter } from "@/components/landing-command-center";
import { LandingHeroFlow } from "@/components/landing-hero-flow";
import { LandingMotion } from "@/components/landing-motion";
import { LandingNav } from "@/components/landing-nav";
import { LandingPointerFX } from "@/components/landing-pointer-fx";
import { SendloomLogo } from "@/components/sendloom-logo";

import styles from "@/app/landing.module.css";

const HEADLINE_WORDS = ["Cold", "outreach", "that", "feels", "crafted,", "not", "sprayed."] as const;

/* Weaves through the six step dots: x at each column centre (1200-unit
   reference width), y alternating 26/58 to match the staggered card rows.
   Horizontal tangents at every dot keep the wave smooth. */
const WORKFLOW_RAIL_PATH =
  "M 92 26 C 194 26 194 58 295 58 S 397 26 498 26 S 600 58 702 58 S 803 26 905 26 S 1006 58 1108 58";

const chaosTools = [
  { tag: "Spreadsheets", note: "Leads scattered across CSV exports nobody trusts." },
  { tag: "Gmail tabs", note: "Sending one-by-one and losing track of who replied." },
  { tag: "Hunter.io", note: "Missing emails looked up in yet another window." },
  { tag: "Template docs", note: "Copy living in a doc, pasted in by hand each time." },
  { tag: "Reminders", note: "Follow-ups set manually, then quietly forgotten." },
  { tag: "Tracking sheet", note: "Delivery state guessed at from memory." }
] as const;

const workflowSteps = [
  {
    index: "01",
    icon: Upload,
    title: "Import",
    body: "Upload a CSV or XLSX, detect columns instantly, and keep every row structured for the sends that follow."
  },
  {
    index: "02",
    icon: Search,
    title: "Enrich",
    body: "Fill the gaps with name-plus-domain or domain-wide lookups using your own hunter.io API key, without leaving the workspace."
  },
  {
    index: "03",
    icon: PenLine,
    title: "Template",
    body: "Write in plain text, HTML, or structured JSON with merge variables and inline AI help, then preview it as a real email."
  },
  {
    index: "04",
    icon: Workflow,
    title: "Sequence",
    body: "Pair the list with a sender and template, set the send window, and assemble the run on one surface."
  },
  {
    index: "05",
    icon: CalendarClock,
    title: "Follow-up",
    body: "Schedule the next touch with controlled pacing so timing stays deliberate instead of frantic."
  },
  {
    index: "06",
    icon: Activity,
    title: "Track",
    body: "Watch delivery, opens, clicks, replies, and retries stay attached to the campaign that produced them."
  }
] as const;

const capabilities = [
  {
    icon: FileSpreadsheet,
    title: "Lead imports",
    body: "Bring in CSV and XLSX files, map fields once, and keep row data intact for every downstream send.",
    tags: ["CSV", "XLSX", "Field mapping"]
  },
  {
    icon: Radar,
    title: "Hunter.io enrichment",
    body: "Run name-plus-domain and domain-wide lookups with your own API key so the finder lives inside the flow.",
    tags: ["Find email", "Domain search", "Bring your own key"]
  },
  {
    icon: FileText,
    title: "Template intelligence",
    body: "Switch between plain text, HTML, and JSON while merge variables, attachments, and AI-polished copy stay aligned.",
    tags: ["Plain text", "HTML", "JSON"]
  },
  {
    icon: Mail,
    title: "Gmail-connected sending",
    body: "Send from the mailbox you already trust through Google OAuth, with sender profiles and live run status.",
    tags: ["Google OAuth", "Sender profiles", "Live status"]
  },
  {
    icon: CalendarClock,
    title: "Follow-up scheduling",
    body: "Add follow-ups with controlled pacing and send-window guardrails so the cadence stays measured.",
    tags: ["Send windows", "Cadence", "Pacing guardrails"]
  },
  {
    icon: Activity,
    title: "Delivery visibility",
    body: "Keep opens, clicks, replies, retries, and recipient status visible from the system that launches the run.",
    tags: ["Opens & clicks", "Replies", "Retries"]
  }
] as const;

const trustPoints = [
  {
    title: "Gmail-connected sending",
    body: "Launch from your own connected mailbox through Google OAuth, not an anonymous relay."
  },
  {
    title: "Safe pacing",
    body: "Sendloom automatically paces and spaces out sends from each connected Gmail account to reduce throttling, with daily safety controls that help prevent runaway sends."
  },
  {
    title: "Validation before launch",
    body: "Check the list, sender, and template together before anything leaves the workspace."
  },
  {
    title: "Retries & failure visibility",
    body: "Failed sends surface with their retry state instead of disappearing into a silent log."
  },
  {
    title: "Follow-up control",
    body: "Decide the timing and stop a sequence the moment a reply changes the plan."
  },
  {
    title: "Ownership of workflows",
    body: "Imports, templates, senders, and runs stay yours, in one place you can see and audit."
  }
];

export default function LandingPage() {
  return (
    <main id="top" className={styles.page}>
      <AnimatedEmailPath />
      <LandingMotion />
      <LandingPointerFX />
      {/* Kept outside .frame so no animated/transformed ancestor can capture
          the fixed nav or interfere with its backdrop-filter. */}
      <LandingNav />
      <div className={styles.frame}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow} data-reveal>
              Outreach operations, one workspace
            </div>
            <h1 className={styles.headline}>
              <span className={styles.headlineLine}>
                {HEADLINE_WORDS.slice(0, 4).map((word) => (
                  <span key={word} className={styles.headlineWord} data-hero-word>
                    {word}
                  </span>
                ))}
              </span>
              <span className={styles.headlineLine}>
                {HEADLINE_WORDS.slice(4).map((word) => (
                  <span
                    key={word}
                    className={`${styles.headlineWord}${word === "crafted," ? ` ${styles.headlineAccent}` : ""}`}
                    data-hero-word
                  >
                    {word}
                  </span>
                ))}
              </span>
            </h1>
            <p className={styles.lede} data-reveal>
              Import leads, enrich contacts, write templates, schedule follow-ups, send through a connected Gmail
              sender, and track every sequence from one calm command center. <BrandText>Sendloom</BrandText> keeps the
              whole outbound run in a single place.
            </p>

            <div className={styles.ctaRow} data-reveal>
              <Link className={styles.primaryButton} href="/signup">
                Start building
              </Link>
              <a className={styles.ghostButton} href="#workflow">
                See how it works
              </a>
            </div>

            <ul className={styles.heroMeta} data-reveal>
              <li>Gmail-connected sender</li>
              <li>hunter.io finder built in</li>
              <li>Plain text · HTML · JSON</li>
            </ul>
          </div>

          <div className={styles.heroVisual} data-reveal>
            <LandingHeroFlow />
          </div>

          <a className={styles.scrollCue} href="#chaos" aria-label="Scroll to learn more">
            <span>Scroll</span>
            <span className={styles.scrollCueLine} aria-hidden="true" />
          </a>
        </section>

        <section className={styles.chaos} id="chaos">
          <div className={styles.sectionHeader} data-reveal>
            <p className={styles.sectionEyebrow}>The usual setup</p>
            <h2 className={styles.sectionTitle}>Six tabs, one fragile process.</h2>
            <p className={styles.sectionText}>
              Most outbound runs are stitched together by memory: a spreadsheet here, a finder there, templates in a
              doc, and follow-ups living on sticky notes. Every handoff is a place for the sequence to break.
            </p>
          </div>

          <div className={styles.chaosLayout}>
            <div className={styles.chaosGrid}>
              {chaosTools.map((tool) => (
                <article key={tool.tag} className={styles.chaosCard} data-chaos>
                  <span className={styles.chaosTag}>{tool.tag}</span>
                  <span className={styles.chaosNote}>{tool.note}</span>
                </article>
              ))}
            </div>

            <div className={styles.chaosArrow} aria-hidden="true">
              <span className={styles.chaosArrowLine} />
              <span className={styles.chaosArrowLabel}>becomes</span>
            </div>

            <article className={styles.unifiedCard} data-reveal>
              <div className={styles.unifiedMark}>
                <SendloomLogo className={styles.unifiedLogo} />
                <strong>
                  <BrandText>Sendloom</BrandText>
                </strong>
              </div>
              <p>
                One workspace where the list, the finder, the template, the sender, the schedule, and the tracking all
                share the same source of truth.
              </p>
              <span className={styles.unifiedChip}>Import → Enrich → Template → Sequence → Follow-up → Track</span>
            </article>
          </div>
        </section>

        <section className={styles.section} id="workflow">
          <div className={styles.sectionHeader} data-reveal>
            <p className={styles.sectionEyebrow}>How it flows</p>
            <h2 className={styles.sectionTitle}>From raw list to a live sequence, in one continuous line.</h2>
            <p className={styles.sectionText}>
              Each step hands off cleanly to the next, so you never re-export, re-paste, or rebuild context to keep a
              run moving.
            </p>
          </div>

          <div className={styles.workflowTrack} data-workflow>
            {/* The thread: a woven rail curving through the step dots, drawn
                on scroll, with a glowing packet travelling it on a loop. The
                point heights match the alternating card stagger below. */}
            <svg
              className={styles.workflowRail}
              viewBox="0 0 1200 80"
              fill="none"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path className={styles.workflowRailBase} d={WORKFLOW_RAIL_PATH} pathLength={1000} />
              <path
                className={styles.workflowRailActive}
                d={WORKFLOW_RAIL_PATH}
                pathLength={1000}
                data-workflow-line
              />
              <g className={styles.workflowPacket} data-workflow-packet>
                <circle className={styles.workflowPacketGlow} r="9" />
                <circle className={styles.workflowPacketCore} r="3.5" />
              </g>
            </svg>
            <ol className={styles.workflowSteps}>
              {workflowSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.index} className={styles.workflowStep} data-step data-active="true" data-reveal>
                    <span className={styles.workflowDot} aria-hidden="true" />
                    <div className={`${styles.workflowCard} ${styles.fxCard}`} data-card-fx>
                      <span className={styles.workflowIndex} aria-hidden="true">
                        {step.index}
                      </span>
                      <span className={styles.workflowIcon} aria-hidden="true">
                        <Icon strokeWidth={1.7} />
                      </span>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader} data-reveal>
            <p className={styles.sectionEyebrow}>Capabilities</p>
            <h2 className={styles.sectionTitle}>Everything the run needs, on one surface.</h2>
            <p className={styles.sectionText}>
              The pieces that usually live in five disconnected tools are designed to work together inside{" "}
              <BrandText>Sendloom</BrandText>.
            </p>
          </div>

          <div className={styles.capGrid}>
            {capabilities.map((capability) => {
              const Icon = capability.icon;
              return (
                <article
                  key={capability.title}
                  className={`${styles.capCard} ${styles.fxCard}`}
                  data-reveal
                  data-card-fx
                >
                  <span className={styles.capIcon} aria-hidden="true">
                    <Icon strokeWidth={1.7} />
                  </span>
                  <h3>{capability.title}</h3>
                  <p>{renderBrandText(capability.body)}</p>
                  <div className={styles.capTags}>
                    {capability.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader} data-reveal>
            <p className={styles.sectionEyebrow}>The command center</p>
            <h2 className={styles.sectionTitle}>See the whole run from one calm screen.</h2>
            <p className={styles.sectionText}>
              Sequence health, delivery status, recipient activity, the template behind the send, and follow-up timing,
              all visible together instead of guessed at across tabs.
            </p>
          </div>

          <div className={styles.commandWrap} data-reveal>
            <LandingCommandCenter />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader} data-reveal>
            <p className={styles.sectionEyebrow}>Controlled, not sprayed</p>
            <h2 className={styles.sectionTitle}>Built for deliberate outreach.</h2>
            <p className={styles.sectionText}>
              <BrandText>Sendloom</BrandText> is shaped around control: send from a mailbox you own, pace the run, check
              before you launch, and keep failures visible.
            </p>
          </div>

          <div className={styles.trustWrap}>
            <div className={styles.trustOrbit} aria-hidden="true">
              <span className={styles.trustOrbitRing} />
              <span className={styles.trustOrbitRingAlt} />
            </div>
            <div className={styles.trustGrid}>
              {trustPoints.map((point) => (
                <article
                  key={point.title}
                  className={`${styles.trustCard} ${styles.fxCard}`}
                  data-reveal
                  data-card-fx
                >
                  <span className={styles.trustMark} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        className={styles.trustCheckPath}
                        d="M5 12.5l4.2 4.2L19 7"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <h3>{point.title}</h3>
                  <p>{renderBrandText(point.body)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.ctaSection}>
          <div className={styles.ctaShell} data-reveal>
            <span className={styles.ctaSpin} aria-hidden="true" />
            <article className={styles.ctaPanel}>
              <span className={`${styles.ctaAurora} ${styles.ctaAuroraGreen}`} aria-hidden="true" />
              <span className={`${styles.ctaAurora} ${styles.ctaAuroraBlue}`} aria-hidden="true" />
              <p className={styles.sectionEyebrow}>Ready when you are</p>
              <h2>Build your next outreach run in one place.</h2>
              <p className={styles.ctaLede}>
                Connect Gmail, import a list, write the template, and launch the sequence from a single login. The
                fastest way to understand <BrandText>Sendloom</BrandText> is to put your own list through it.
              </p>

              <div className={styles.ctaActions}>
                <Link className={styles.primaryButton} href="/signup">
                  Get started
                </Link>
                <a className={styles.ghostButton} href="#workflow">
                  See workflow
                </a>
              </div>
            </article>
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerTop}>
            <div className={styles.footerBrandBlock}>
              <div className={styles.footerBrand}>
                <SendloomLogo className={styles.footerBrandMark} />
                <div>
                  <strong>
                    <BrandText>Sendloom</BrandText>
                  </strong>
                  <span>Outreach operations with one source of truth.</span>
                </div>
              </div>
              <p className={styles.footerCopy}>
                Built for small teams who want imports, templates, sender setup, launch, and run visibility in one calm
                system.
              </p>
            </div>

            <div className={styles.footerColumns}>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Product</span>
                <a href="#workflow">Workflow</a>
                <a href="#chaos">Why it works</a>
                <Link href="/signup">
                  Try <BrandText>Sendloom</BrandText>
                </Link>
              </div>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Access</span>
                <Link href="/login">Login</Link>
                <Link href="/signup">Create account</Link>
                <Link href="/workspace">Dashboard</Link>
              </div>
              <div className={styles.footerColumn}>
                <span className={styles.footerHeading}>Legal</span>
                <Link href="/privacy">Privacy</Link>
                <Link href="/terms">Terms</Link>
                <Link href="/faq">FAQ</Link>
                <a href="mailto:hello@sendloom.net">Contact</a>
              </div>
            </div>
          </div>

          <div className={styles.footerBottom}>
            <span>
              <BrandText>Sendloom</BrandText>.net
            </span>
            <div className={styles.footerLinks}>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/faq">FAQ</Link>
              <Link href="/login">Login</Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
