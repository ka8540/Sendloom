import { Mail } from "lucide-react";
import Link from "next/link";

import faqStyles from "@/app/faq/page.module.css";
import legalStyles from "@/app/legal.module.css";
import { FaqList } from "@/components/faq-list";
import { LandingNav } from "@/components/landing-nav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

const faqNavItems = [
  { href: "/", label: "Home" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/abuse", label: "Abuse" },
  { href: "/faq", label: "FAQ" },
  { href: "mailto:ka8540@g.rit.edu", label: "Contact" }
] as const;

const quickFacts = [
  {
    title: "Imports",
    body: "Bring in CSV or XLSX files, preview rows, and map spreadsheet columns into outreach fields."
  },
  {
    title: "Finder",
    body: "Use Hunter-powered lookup tools to search by name, domain, or company domain."
  },
  {
    title: "Templates",
    body: "Work with plain text, HTML, JSON, merge variables, previews, and AI-assisted copy cleanup."
  },
  {
    title: "Sequences",
    body: "Connect Gmail, validate sends, schedule outreach, and track progress from one workspace."
  }
] as const;

const highlights = [
  {
    label: "Formats",
    value: "CSV + XLSX",
    detail: "Supported spreadsheet uploads for building contact lists."
  },
  {
    label: "Senders",
    value: "Google OAuth",
    detail: "Gmail connects through authorized sender profiles, not stored passwords."
  },
  {
    label: "Visibility",
    value: "Live tracking",
    detail: "Replies, opens, delivery state, failures, and sequence progress stay visible."
  }
] as const;

const faqSections = [
  {
    id: "getting-started",
    title: "Getting started",
    items: [
      {
        question: "What is Sendloom?",
        answer:
          "Sendloom is an outreach operations platform that helps you import contacts, find missing emails, write messages, connect Gmail, launch sequences, and track outreach from one workspace."
      },
      {
        question: "Who is Sendloom built for?",
        answer:
          "Sendloom is built for students, founders, recruiters, small teams, agencies, and operators who need a cleaner way to manage personalized outreach without jumping between multiple tools."
      },
      {
        question: "Can students use Sendloom for job or internship outreach?",
        answer:
          "Yes. Students can use Sendloom to organize target companies, write personalized emails, connect Gmail, and track replies for internship, referral, and networking outreach."
      },
      {
        question: "Does Sendloom replace spreadsheets?",
        answer:
          "Sendloom does not completely replace spreadsheets, but it removes the messy workflow of managing contacts, templates, sending, and tracking across separate files and tools."
      }
    ]
  },
  {
    id: "imports-and-finder",
    title: "Imports and Finder",
    items: [
      {
        question: "What file types can I import?",
        answer:
          "Sendloom supports CSV and XLSX uploads so users can bring in contact lists from spreadsheets and map columns to template fields."
      },
      {
        question: "Can Sendloom detect my spreadsheet columns?",
        answer:
          "Yes. Sendloom includes column detection, preview rows, template-field selection, and mapping review so users can connect imported data to email templates."
      },
      {
        question: "What is Finder?",
        answer:
          "Finder helps users discover missing email addresses using Hunter-powered email finder and domain search features."
      },
      {
        question: "Do I need my own Hunter API key?",
        answer:
          "Sendloom supports per-user Hunter API key storage. Users can add their own Hunter key to use Finder and domain search features."
      },
      {
        question: "Can I search for emails by name and domain?",
        answer:
          "Yes. Finder supports email lookups using a person's name and company domain when Hunter data is available."
      },
      {
        question: "Can I search for contacts from a company domain?",
        answer:
          "Yes. Domain search allows users to discover available contacts associated with a company domain."
      }
    ]
  },
  {
    id: "discover",
    title: "Discover",
    items: [
      {
        question: "What is Discover?",
        answer:
          "Discover helps you find relevant professional profiles and infer likely work email addresses, so you can build a focused outreach list. It can draw on public professional information, company and domain patterns, source evidence, and provider results."
      },
      {
        question: "Are Discover emails verified?",
        answer:
          "Not always. Many Discover email addresses are inferred from names, company domains, and common patterns. Inferred addresses are best guesses, not guaranteed-verified contacts, so treat them as a starting point."
      },
      {
        question: "How should I use inferred emails?",
        answer:
          "Use them responsibly. Review each result, confirm the contact is a good fit, and make sure your outreach is lawful and appropriate before you send. Inferred emails are meant to help you research, not to enable bulk or unsolicited messaging."
      },
      {
        question: "Why do some people show unavailable emails?",
        answer:
          "Some profiles do not have a usable inferred email. This can happen when there is not enough public evidence, the company pattern is unclear, or providers return no reliable match. Those people are shown without a usable address rather than with a guessed one."
      },
      {
        question: "What does Add more people do?",
        answer:
          "Add more people expands an existing search to surface additional relevant profiles for the same target. It continues from where the search left off, within the limits that apply to your account."
      },
      {
        question: "Can I export or import Discover results?",
        answer:
          "Yes. You can export Discover results and bring the people you select into your imports, so they can flow into templates and sequences like any other contact list."
      },
      {
        question: "How do I report wrong Discover data?",
        answer:
          "If a Discover result looks wrong, confusing, or out of date, open the guide button on the Discover page and choose “Report issue.” Pick a type such as Wrong data, describe what you saw, and send it for review."
      }
    ]
  },
  {
    id: "templates-and-copy",
    title: "Templates and copy",
    items: [
      {
        question: "What template formats does Sendloom support?",
        answer:
          "Sendloom supports plain text, HTML, and JSON templates, giving users flexibility based on their outreach style and workflow."
      },
      {
        question: "Can I preview emails before sending?",
        answer:
          "Yes. Sendloom includes live preview support so users can review how a template will look before launching a sequence."
      },
      {
        question: "Does Sendloom support merge variables?",
        answer:
          "Yes. Sendloom detects merge variables and lets users map spreadsheet fields into personalized email templates."
      },
      {
        question: "Can Sendloom help improve my email copy?",
        answer:
          "Yes. Sendloom includes AI help for improving subject lines and email bodies, plus tools for cleaning up risky or spammy wording."
      },
      {
        question: "What is spam-risk cleanup?",
        answer:
          "Spam-risk cleanup helps identify and improve email copy that may look too promotional, aggressive, or likely to trigger spam filters."
      },
      {
        question: "Does Sendloom preserve formatting in plain-text emails?",
        answer:
          "Yes. Plain-text templates preserve paragraphs, bullet lists, and numbered lists when users paste email copy into the editor."
      }
    ]
  },
  {
    id: "gmail-sending",
    title: "Gmail sending",
    items: [
      {
        question: "How does Gmail sending work?",
        answer:
          "Sendloom sends through connected Gmail sender profiles using Google OAuth, so emails are sent from the user's own Gmail or Google Workspace account."
      },
      {
        question: "Does Sendloom store my Gmail password?",
        answer:
          "No. Sendloom uses Google OAuth for sender connection and does not ask users to store their Gmail password."
      },
      {
        question: "Can I choose which Gmail account sends a sequence?",
        answer:
          "Yes. Users can select a connected Gmail sender profile before launching a sequence."
      }
    ]
  },
  {
    id: "sequences-and-scheduling",
    title: "Sequences and scheduling",
    items: [
      {
        question: "What is a sequence?",
        answer: "A sequence is an outreach run created from an import, mapping, template, sender, and schedule."
      },
      {
        question: "Can I validate a sequence before launching?",
        answer:
          "Yes. Sendloom includes validation before launch so users can catch setup issues before emails are sent."
      },
      {
        question: "Can I schedule outreach?",
        answer: "Yes. Sendloom supports immediate, one-time, and recurring schedules for outreach sequences."
      },
      {
        question: "Can I pause or resume a sequence?",
        answer:
          "Yes. Users can launch, pause, resume, relaunch, and delete sequences from the sequence workspace."
      },
      {
        question: "Does Sendloom support attachments?",
        answer:
          "Yes. Sendloom supports attachments for sequences when users need to include files such as resumes, PDFs, or supporting documents."
      }
    ]
  },
  {
    id: "tracking-and-admin",
    title: "Tracking and administration",
    items: [
      {
        question: "What can I track in Sendloom?",
        answer:
          "Sendloom tracks sequence progress, delivery state, recipient activity, replies, opens, failures, and attention states from the Overview and sequence detail pages."
      },
      {
        question: "Does the dashboard update while a sequence is running?",
        answer:
          "Yes. Overview cards refresh while launches are active, so users can monitor progress without manually reloading the page."
      },
      {
        question: "Can Sendloom track replies?",
        answer:
          "Yes. Reply syncing is tied to connected Gmail senders, and reply counts are shown inside sequence detail views."
      },
      {
        question: "Are opens and clicks tracked?",
        answer:
          "Sendloom includes open and click tracking routes. Open tracking works through a tracking pixel added to rendered HTML email output."
      },
      {
        question: "What can admins manage?",
        answer: "Admin users can manage account-level restrictions and user controls from the Admin page."
      },
      {
        question: "Is Sendloom only for sales teams?",
        answer:
          "No. Sendloom can support sales outreach, recruiting, student job outreach, founder networking, partnership outreach, and other structured communication workflows."
      }
    ]
  },
  {
    id: "reporting-and-support",
    title: "Reporting and support",
    items: [
      {
        question: "How do I report a problem?",
        answer:
          "You can report a problem from the help/guide menu inside Sendloom dashboards. Open the guide button on a workspace page and choose “Report issue.” You can use this for bugs, confusing UI, wrong data, loading problems, guide or tour issues, or anything that feels broken. You do not need to wait for an error message."
      },
      {
        question: "What should I include in a report?",
        answer:
          "Describe what you were trying to do and what happened. Reports are meant for product and support review, so keep them focused on the problem. Please do not paste passwords, API keys, OAuth tokens, private contact lists, or sensitive email contents into the description."
      },
      {
        question: "Is a manual report the same as the automatic error report?",
        answer:
          "No. If the app shows an automatic error report after something fails, that is separate from a manual report. You can still open “Report issue” yourself at any time, even when nothing has visibly broken."
      }
    ]
  }
] as const;

export default function FaqPage() {
  return (
    <main id="top" className={legalStyles.page}>
      <LandingNav items={faqNavItems} />

      <div className={legalStyles.frame}>
        <header className={legalStyles.hero}>
          <span className={legalStyles.eyebrow}>Support</span>
          <h1 className={legalStyles.title}>Frequently Asked Questions</h1>
          <p className={legalStyles.description}>
            Answers to common questions about importing contacts, finding emails, writing templates, connecting Gmail,
            launching sequences, and tracking outreach in Sendloom.
          </p>

          <div className={legalStyles.heroActions}>
            <Link className="button" href="/">
              Back to home
            </Link>
            <Link className="button secondary" href="/privacy">
              Read privacy policy
            </Link>
          </div>

          <div className={legalStyles.quickFacts}>
            {quickFacts.map((fact) => (
              <article key={fact.title} className={legalStyles.quickFactCard}>
                <strong>{fact.title}</strong>
                <span>{fact.body}</span>
              </article>
            ))}
          </div>
        </header>

        <div className={legalStyles.layout}>
          <aside className={legalStyles.sidebar}>
            <section className={legalStyles.sidebarCard}>
              <h2 className={legalStyles.sidebarTitle}>Browse topics</h2>
              <nav className={legalStyles.contents} aria-label="FAQ sections">
                {faqSections.map((section) => (
                  <a key={section.id} href={`#${section.id}`}>
                    {section.title}
                  </a>
                ))}
              </nav>
            </section>

            <section className={legalStyles.sidebarCard}>
              <h2 className={legalStyles.sidebarTitle}>Key points</h2>
              <div className={legalStyles.highlights}>
                {highlights.map((highlight) => (
                  <article key={highlight.label} className={legalStyles.highlight}>
                    <span className={legalStyles.highlightLabel}>{highlight.label}</span>
                    <strong className={legalStyles.highlightValue}>{highlight.value}</strong>
                    <p className={legalStyles.highlightDetail}>{highlight.detail}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className={legalStyles.sidebarCard}>
              <h2 className={legalStyles.sidebarTitle}>Built for</h2>
              <ul className={legalStyles.commitments}>
                <li>Students and job seekers</li>
                <li>Founders and operators</li>
                <li>Recruiters and agencies</li>
                <li>Small teams managing structured outreach</li>
              </ul>
            </section>
          </aside>

          <article className={legalStyles.article}>
            <header className={legalStyles.articleHeader}>
              <p className={legalStyles.articleEyebrow}>FAQ</p>
              <h2 className={legalStyles.articleTitle}>Common questions, direct answers.</h2>
              <p className={legalStyles.articleIntro}>
                The sections below cover the full Sendloom workflow, from first import through Finder, templates, Gmail,
                sequences, and reporting.
              </p>
            </header>

            <FaqList sections={faqSections} />

            <section className={faqStyles.contactSection} aria-labelledby="faq-contact-title">
              <div className={faqStyles.contactCopy}>
                <p className={faqStyles.contactEyebrow}>Need more help?</p>
                <h3 id="faq-contact-title">Still have questions?</h3>
                <p>If you have another question about Sendloom, contact us and we will help you find the right answer.</p>
              </div>

              <a className={faqStyles.contactButton} href="mailto:ka8540@g.rit.edu">
                <Mail aria-hidden="true" />
                Contact us
              </a>
            </section>
          </article>
        </div>

      </div>

      <MarketingFooter />
    </main>
  );
}
