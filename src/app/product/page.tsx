import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, FileText, Search, Upload, Workflow } from "lucide-react";

import landingStyles from "@/app/landing.module.css";
import { LandingMotion } from "@/components/landing-motion";
import { LandingNav } from "@/components/landing-nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { ProductDemoVideo } from "./product-demo-video";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Product Tour",
  description:
    "See how Sendloom helps you discover contacts, import prospects, create templates, and build outreach sequences.",
  alternates: { canonical: "/product" }
};

const PRODUCT_VIDEOS = {
  discover: "https://pub-9400568eaa014d6cbfd93f37668641cd.r2.dev/auth/ProductPage/Discover-Part.mp4",
  import: "https://pub-9400568eaa014d6cbfd93f37668641cd.r2.dev/auth/ProductPage/Import-part.mp4",
  templates: "https://pub-9400568eaa014d6cbfd93f37668641cd.r2.dev/auth/ProductPage/Template-part.mp4",
  sequences: "https://pub-9400568eaa014d6cbfd93f37668641cd.r2.dev/auth/ProductPage/Sequence-part.mp4"
} as const;

const navItems = [
  { href: "/#home", label: "Home" },
  { href: "/#why-sendloom", label: "Why Sendloom" },
  { href: "/#workflow", label: "Workflow" },
  { href: "#contact", label: "Contact" }
] as const;

const features = [
  {
    id: "discover",
    number: "01",
    label: "Discover people",
    title: ["Find the right contacts", "without the busywork."],
    description:
      "Search for the people you want to reach and add relevant contacts directly to your Sendloom workflow.",
    points: ["Search for relevant people", "Review contact information", "Add contacts to your lists"],
    video: PRODUCT_VIDEOS.discover,
    videoTitle: "Sendloom Discover product demonstration"
  },
  {
    id: "import",
    number: "02",
    label: "Import contacts",
    title: ["Bring your existing", "contacts into Sendloom."],
    description:
      "Upload an existing contact list and bring your prospects into Sendloom so they are ready for templates and sequences.",
    points: ["Upload your contact list", "Map your contact data", "Prepare contacts for outreach"],
    video: PRODUCT_VIDEOS.import,
    videoTitle: "Sendloom contact import product demonstration"
  },
  {
    id: "templates",
    number: "03",
    label: "Create templates",
    title: ["Create reusable outreach", "without starting over."],
    description:
      "Build reusable email templates for your outreach and keep your messaging consistent across sequences.",
    points: ["Create reusable templates", "Personalize your outreach", "Reuse templates across sequences"],
    video: PRODUCT_VIDEOS.templates,
    videoTitle: "Sendloom email template product demonstration"
  },
  {
    id: "sequences",
    number: "04",
    label: "Build a sequence",
    title: ["Turn contacts into", "conversations."],
    description:
      "Choose your contacts, select your outreach, configure follow-ups, and launch a structured sequence.",
    points: ["Build multi-step sequences", "Configure follow-ups", "Schedule and launch outreach"],
    video: PRODUCT_VIDEOS.sequences,
    videoTitle: "Sendloom sequence builder product demonstration"
  }
] as const;

const workflow = [
  { label: "Discover", icon: Search },
  { label: "Import", icon: Upload },
  { label: "Templates", icon: FileText },
  { label: "Sequences", icon: Workflow }
] as const;

export default function ProductPage() {
  return (
    <main id="main-content" className={`${landingStyles.page} ${styles.page}`}>
      <LandingMotion />
      <LandingNav items={navItems} />

      <section className={styles.hero} aria-labelledby="product-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow} data-reveal>Product tour</p>
          <h1 id="product-title" className={styles.heroTitle}>
            <span data-hero-word>See</span>{" "}
            <span data-hero-word>Send<span className={styles.heroBrandAccent}>loom</span></span>
            <br />
            <em data-hero-word>in action.</em>
          </h1>
          <p className={styles.heroDescription} data-reveal>
            From finding the right people to sending structured outreach, see the complete Sendloom workflow.
          </p>
          <Link className={landingStyles.buttonPrimary} href="/signup" data-reveal>
            Start for free <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className={styles.heroMedia} data-reveal>
          <div className={styles.mediaKicker}>
            <span className={styles.mediaLine} />
            See the workflow
          </div>
          <ProductDemoVideo src={PRODUCT_VIDEOS.sequences} title="Preview of Sendloom's sequence builder" hero />
          <p className={styles.mediaCaption}>Build a sequence, from first contact to follow-up.</p>
        </div>
      </section>

      <nav className={styles.featureNav} aria-label="Product tour sections" data-reveal>
        <span className={styles.featureNavLabel}>Explore the product</span>
        <div className={styles.featureNavLinks}>
          <a href="#discover">Discover</a>
          <a href="#import">Import</a>
          <a href="#templates">Templates</a>
          <a href="#sequences">Sequences</a>
        </div>
      </nav>

      <div className={styles.features}>
        {features.map((feature, index) => (
          <section
            key={feature.id}
            id={feature.id}
            className={`${styles.feature} ${index % 2 === 1 ? styles.featureReverse : ""}`}
            aria-labelledby={`${feature.id}-title`}
          >
            <div className={styles.featureCopy} data-reveal>
              <p className={styles.featureEyebrow}>
                <span>{feature.number}</span>
                {feature.label}
              </p>
              <h2 id={`${feature.id}-title`} className={styles.featureTitle}>
                {feature.title[0]}{" "}<em>{feature.title[1]}</em>
              </h2>
              <p className={styles.featureDescription}>{feature.description}</p>
              <ul className={styles.featurePoints}>
                {feature.points.map((point) => (
                  <li key={point}><Check size={16} strokeWidth={2} aria-hidden="true" />{point}</li>
                ))}
              </ul>
            </div>
            <div className={styles.featureMedia} data-reveal>
              <ProductDemoVideo src={feature.video} title={feature.videoTitle} />
              <p className={styles.featureCaption}><span>{feature.number} / 04</span>{feature.label}</p>
            </div>
          </section>
        ))}
      </div>

      <section className={styles.workflow} aria-labelledby="workflow-title">
        <div className={styles.workflowIntro} data-reveal>
          <p className={styles.eyebrow}>The full picture</p>
          <h2 id="workflow-title" className={styles.workflowTitle}>A complete outreach <em>workflow.</em></h2>
          <p>Find the right people, bring in your contacts, create your outreach, and launch a sequence — all in one place.</p>
        </div>
        <ol className={styles.workflowSteps} data-reveal>
          {workflow.map(({ label, icon: Icon }, index) => (
            <li key={label}>
              <span className={styles.workflowIcon}><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className={styles.workflowStepNumber}>0{index + 1}</span>
              <strong>{label}</strong>
              {index < workflow.length - 1 ? <ArrowRight className={styles.workflowArrow} size={19} aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.cta} aria-labelledby="product-cta-title">
        <div className={styles.ctaInner} data-reveal>
          <p className={styles.eyebrow}>Your next move</p>
          <h2 id="product-cta-title">Ready to put it <em>all together?</em></h2>
          <p>Take your contacts from first search to a thoughtful sequence.</p>
          <Link className={landingStyles.buttonPrimary} href="/signup">
            Start for free <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
