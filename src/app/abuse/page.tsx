import { LegalPage } from "@/components/legal-page";
import { LEGAL_POLICIES } from "@/lib/legal-policies";

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

export default function AbusePage() {
  const policy = LEGAL_POLICIES.abuse;

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
      lastUpdated={policy.lastUpdated}
      quickFacts={quickFacts}
      relatedHref="/terms"
      relatedLabel="Read terms"
      sectionBody="The sections below detail the specific types of activity that are prohibited on Sendloom, how enforcement works, and how to report abuse."
      sectionEyebrow="Policy details"
      sectionTitle="What is not allowed and what happens when rules are broken."
      sections={policy.sections}
      title={policy.title}
    />
  );
}
