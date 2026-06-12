import { LegalPage } from "@/components/legal-page";

const highlights = [
  {
    label: "Zero tolerance",
    value: "Enforced",
    detail: "Sendloom enforces restrictions when abuse rules are violated."
  },
  {
    label: "Scope",
    value: "All users",
    detail: "Every account is subject to these rules, regardless of volume or tenure."
  },
  {
    label: "Reporting",
    value: "Open",
    detail: "Anyone can report abuse or misuse through the support contact listed on this site."
  }
] as const;

const quickFacts = [
  {
    title: "No spam",
    body: "Do not use Sendloom to send unsolicited bulk email, deceptive messages, or messages to purchased/scraped lists without lawful basis."
  },
  {
    title: "No harassment",
    body: "Do not use Sendloom to threaten, intimidate, stalk, or harass any individual or organization."
  },
  {
    title: "No minors",
    body: "Do not use Sendloom to contact minors, collect data about minors, or produce content involving minors."
  },
  {
    title: "No deception",
    body: "Do not use Sendloom for phishing, impersonation, credential theft, or to distribute malware."
  }
] as const;

const sections = [
  {
    id: "prohibited-uses",
    title: "Prohibited uses",
    bullets: [
      "Spam: unsolicited bulk messaging, deceptive subject lines, or misleading sender identity.",
      "Harassment: threats, intimidation, stalking, or targeted abuse of any individual.",
      "Illegal outreach: messaging that violates applicable law in any jurisdiction.",
      "Contacting minors: using Sendloom to reach individuals known or believed to be under 18.",
      "Phishing and impersonation: pretending to be another person, company, or organization to deceive recipients.",
      "Credential theft: attempting to collect passwords, security codes, or personal credentials through outreach.",
      "Malware distribution: including links to or attachments containing viruses, trojans, ransomware, or other harmful software.",
      "Hate speech and threats: promoting violence, discrimination, or hatred against any group.",
      "Sexual content involving minors: absolutely prohibited, reported to authorities.",
      "Selling or sourcing child data: collecting, purchasing, or using data about individuals under 18.",
      "Unlawful contact scraping: using contacts obtained through scraping, hacking, or other unauthorized means.",
      "Suppression bypass: circumventing unsubscribe requests, suppression lists, or opt-out mechanisms.",
      "Google policy violations: any use that violates Google's Gmail API Terms of Service or Acceptable Use Policy."
    ]
  },
  {
    id: "enforcement",
    title: "Enforcement",
    paragraphs: [
      "When Sendloom identifies a violation, the account may be restricted, suspended, or permanently terminated depending on severity.",
      "Sendloom reserves the right to restrict first and investigate second when the potential for harm is immediate."
    ]
  },
  {
    id: "reporting",
    title: "Reporting abuse",
    paragraphs: [
      "Report abuse or misuse through the support contact listed on this site.",
      "If you have received unwanted communication sent through Sendloom, please include the sender email and message details in your report."
    ]
  },
  {
    id: "cooperation",
    title: "Cooperation with authorities",
    paragraphs: [
      "Sendloom will cooperate with law enforcement authorities when legally required and when activity on the platform poses a credible risk of harm."
    ]
  },
  {
    id: "review-notice",
    title: "Legal review notice",
    paragraphs: [
      "This policy is provided for transparency and operational guidance. It should be reviewed by qualified legal counsel before reliance in any regulated context."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    paragraphs: ["If you have questions about this policy, contact Sendloom at ka8540@g.rit.edu."]
  }
] as const;

export default function AbusePage() {
  return (
    <LegalPage
      commitments={[
        "Accounts found violating these rules may be restricted or permanently suspended.",
        "Sendloom actively monitors for patterns that suggest misuse.",
        "Report abuse or misuse through the support contact listed on this site."
      ]}
      description="This Anti-Abuse Policy defines how Sendloom must and must not be used, and what happens when those rules are broken."
      eyebrow="Platform integrity"
      guideBody="This policy covers the rules every Sendloom user must follow, the actions that are explicitly prohibited, and what happens when those rules are broken."
      guideTitle="The essentials"
      highlights={highlights}
      lastUpdated="June 12, 2026"
      quickFacts={quickFacts}
      relatedHref="/terms"
      relatedLabel="Read terms"
      sectionBody="The sections below detail the specific types of activity that are prohibited on Sendloom, how enforcement works, and how to report abuse."
      sectionEyebrow="Policy details"
      sectionTitle="What is not allowed and what happens when rules are broken."
      sections={sections}
      title="Anti-Abuse Policy"
    />
  );
}
